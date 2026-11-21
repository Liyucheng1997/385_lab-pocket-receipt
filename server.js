// 记账服务：静态文件 + 账单/语音识别接口 +（可选）账号与云端数据
// 识别：本机默认走 Claude Code CLI（订阅额度）；设置了 ANTHROPIC_API_KEY（或 LEDGER_API_KEY）时由服务端直连 Anthropic API。
// 账号模式：ACCOUNTS=1 或 --accounts 开启，多人各用各的账号，记录保存在 DATA_DIR（默认 ./data）。
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAccounts } from './lib/accounts.js';
import { LANG_NAMES, buildSchema, buildSystemPrompt, buildContent, extractJson } from './public/js/prompt.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const PORT = Number(opt('port') || process.env.PORT || 3850);
const HOST = process.env.HOST || '0.0.0.0';
const HTTPS_PORT = Number(process.env.HTTPS_PORT || PORT + 1);
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const TIMEOUT_MS = Number(process.env.RECOGNIZE_TIMEOUT_MS || 240000);
const MAX_BODY = 40 * 1024 * 1024;
const MAX_JOBS = 2;

// 从 Claude Code / 桌面版里启动时会继承宿主的会话变量，那时的 ANTHROPIC_API_KEY 不是给本服务用的
const HOSTED = !!(process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT);
const API_KEY = process.env.LEDGER_API_KEY || (!HOSTED && process.env.ANTHROPIC_API_KEY) || '';

const ACCOUNTS = flag('accounts') || /^(1|true|on)$/i.test(process.env.ACCOUNTS || '');
const DATA_DIR = path.resolve(opt('data') || process.env.DATA_DIR || path.join(ROOT, 'data'));
const accounts = ACCOUNTS ? createAccounts({
  dataDir: DATA_DIR,
  inviteCode: process.env.INVITE_CODE || '',
  trustProxy: /^(1|true|on)$/i.test(process.env.TRUST_PROXY || ''),
  recognizeDaily: Number(process.env.RECOGNIZE_DAILY_LIMIT || 100),
}) : null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---------- Claude CLI ----------

// 子进程环境：从 Claude Code / 桌面版里启动服务时会继承宿主的会话变量（含 ANTHROPIC_BASE_URL），
// 去掉它们，让 claude CLI 使用自己 `claude auth login` 的登录
function childEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^claude/i.test(k) && k !== 'CLAUDE_CONFIG_DIR') delete env[k];
    else if (HOSTED && k === 'ANTHROPIC_BASE_URL') delete env[k];
  }
  return env;
}

function runClaude(args, stdinText, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd: os.tmpdir(), env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('识别超时，请稍后重试')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT' ? '未找到 claude 命令，请先安装 Claude Code CLI' : e.message));
    });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on('error', () => {});
    child.stdin.end(stdinText ?? '');
  });
}

let authCache = { at: 0, value: null };
async function authStatus() {
  if (API_KEY) return { cli: true, loggedIn: true, engine: 'api', model: MODEL };
  if (Date.now() - authCache.at < 30000 && authCache.value) return authCache.value;
  let value;
  try {
    const { out } = await runClaude(['auth', 'status'], '', 20000);
    const j = JSON.parse(out);
    value = { cli: true, loggedIn: !!j.loggedIn, authMethod: j.authMethod, model: MODEL };
  } catch (e) {
    value = { cli: !/未找到/.test(e.message), loggedIn: false, model: MODEL, error: e.message };
    // 服务器上没装 CLI 也没配 Key：告诉前端这里不提供识别，让用户填自己的 API Key
    if (accounts && !value.cli) value = { cli: false, loggedIn: false, engine: 'none', model: MODEL };
  }
  authCache = { at: Date.now(), value };
  return value;
}

let running = 0;
async function recognize(body) {
  const categories = {
    expense: sanitizeIds(body.categories?.expense, ['other']),
    income: sanitizeIds(body.categories?.income, ['other_income']),
  };
  const lang = LANG_NAMES[body.lang] ? body.lang : 'zh-CN';
  const currency = /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'CNY';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);

  const content = buildContent(body.files, body.text);
  if (!content) throw new Error('没有可识别的内容');

  if (API_KEY) return recognizeApi({ lang, currency, today, categories }, content);

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', MODEL,
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--system-prompt', buildSystemPrompt({ lang, currency, today, categories }),
    '--json-schema', JSON.stringify(buildSchema(categories)),
  ];
  const input = JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';

  if (running >= MAX_JOBS) throw new Error('识别任务较多，请稍后再试');
  running++;
  let res;
  try {
    res = await runClaude(args, input, TIMEOUT_MS);
  } finally {
    running--;
  }

  let result = null;
  for (const line of res.out.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === 'result') result = j;
    } catch { /* 非 JSON 行忽略 */ }
  }
  if (!result) throw new Error(friendlyError(res.err || res.out) || `Claude CLI 退出（${res.code}）`);
  if (result.is_error) {
    authCache.at = 0;
    throw new Error(friendlyError(result.result) || '识别失败');
  }
  const data = result.structured_output ?? extractJson(result.result);
  data.model = Object.keys(result.modelUsage || {})[0] || MODEL;
  data.transactions = (data.transactions || []).filter((t) => Number(t.amount) > 0);
  return data;
}

// 服务端直连 Anthropic API（部署到服务器时用），参数与浏览器端 recognize.js 保持一致
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
async function recognizeApi(ctx, content) {
  const body = {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: buildSchema(ctx.categories) } },
    system: buildSystemPrompt(ctx),
    messages: [{ role: 'user', content }],
  };
  const headers = { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' };
  if (FALLBACK_MODELS.has(MODEL)) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }
  if (running >= MAX_JOBS * 2) throw new Error('识别任务较多，请稍后再试');
  running++;
  let r;
  let j;
  try {
    r = await fetch(`${process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    j = await r.json();
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? '识别超时，请稍后重试' : '无法连接 Claude 服务，请稍后再试');
  } finally {
    running--;
  }
  if (!r.ok) {
    console.error('[recognize] API', r.status, j?.error?.message);
    if (r.status === 401 || r.status === 403) throw new Error('服务器的 API Key 无效，请联系管理员');
    if (r.status === 429) throw new Error('请求过于频繁或额度不足，请稍后再试');
    if (r.status >= 500) throw new Error('Claude 服务繁忙，请稍后再试');
    throw new Error(String(j?.error?.message || `HTTP ${r.status}`).slice(0, 200));
  }
  if (j.stop_reason === 'refusal') throw new Error('Claude 拒绝处理这份内容');
  if (j.stop_reason === 'max_tokens') throw new Error('识别结果过长被截断，请减少文件数量');
  const data = extractJson((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
  data.model = j.model || MODEL;
  data.transactions = (data.transactions || []).filter((t) => Number(t.amount) > 0);
  return data;
}

function sanitizeIds(list, fallback) {
  const ids = Array.isArray(list) ? list.filter((x) => typeof x === 'string' && /^[a-z0-9_]{1,32}$/.test(x)) : [];
  for (const f of fallback) if (!ids.includes(f)) ids.push(f);
  return ids.slice(0, 60);
}

function friendlyError(msg) {
  const m = String(msg || '').trim();
  if (/OAuth|authenticate|log ?in|not logged/i.test(m)) return 'Claude Code 未登录或登录已过期，请在终端运行 claude auth login';
  if (/rate|limit|quota|usage/i.test(m)) return 'Claude 订阅额度暂时用尽，请稍后再试';
  return m.split('\n')[0].slice(0, 200);
}

// ---------- HTTP ----------

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('文件过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(PUBLIC, 'index.html');
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    if (accounts) {
      if ((await accounts.handle(req, res, url)) !== false) return;
    } else if (url.pathname === '/api/session') {
      return sendJson(res, 200, { accounts: false });
    }
    if (req.url === '/api/health' && req.method === 'GET') return sendJson(res, 200, await authStatus());
    if (req.url === '/api/recognize' && req.method === 'POST') {
      if (accounts) {
        const user = accounts.userOf(req);
        if (!user) return sendJson(res, 401, { ok: false, error: '请先登录' });
        if (!accounts.allowRecognize(user.id)) return sendJson(res, 429, { ok: false, error: '今天的识别次数已用完，明天再试' });
      }
      const body = JSON.parse(await readBody(req));
      const t0 = Date.now();
      const result = await recognize(body);
      console.log(`[recognize] ${result.model} · ${result.transactions.length} 条 · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return sendJson(res, 200, { ok: true, result });
    }
    if (req.url.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'Not found' });
    serveStatic(req, res);
  } catch (e) {
    console.error('[error]', e.message);
    sendJson(res, 500, { ok: false, error: e.message });
  }
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

http.createServer(handler).listen(PORT, HOST, () => {
  console.log(`
  记账本已启动  http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') for (const ip of lanAddresses()) console.log(`  局域网访问    http://${ip}:${PORT}`);
  console.log(`  识别模型      ${MODEL}（${API_KEY ? 'Anthropic API' : '本地 Claude Code 订阅'}）`);
  if (accounts) console.log(`  账号模式      已开启 · ${accounts.userCount()} 个用户 · 数据目录 ${DATA_DIR}${process.env.INVITE_CODE ? ' · 注册需要邀请码' : ''}`);
  console.log('');
});

// 手机通过局域网使用麦克风需要 HTTPS：放入 certs/key.pem 与 certs/cert.pem 即自动开启
const keyFile = path.join(ROOT, 'certs', 'key.pem');
const certFile = path.join(ROOT, 'certs', 'cert.pem');
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler).listen(HTTPS_PORT, HOST, () => {
    for (const ip of lanAddresses()) console.log(`  HTTPS 访问    https://${ip}:${HTTPS_PORT}`);
  });
}
