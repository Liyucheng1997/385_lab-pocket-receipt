// 记账本地服务：静态文件 + 账单/语音识别接口
// 识别通过本机 Claude Code CLI（订阅额度）完成，不需要 API Key。
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3850);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || PORT + 1);
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const TIMEOUT_MS = Number(process.env.RECOGNIZE_TIMEOUT_MS || 240000);
const MAX_BODY = 40 * 1024 * 1024;
const MAX_JOBS = 2;

const LANG_NAMES = {
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  en: 'English',
  ja: 'Japanese (日本語)',
};

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

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// ---------- Claude CLI ----------

// 子进程环境：从 Claude Code / 桌面版里启动服务时会继承宿主的会话变量（含 ANTHROPIC_BASE_URL），
// 去掉它们，让 claude CLI 使用自己 `claude auth login` 的登录
const HOSTED = !!(process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT);
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
  if (Date.now() - authCache.at < 30000 && authCache.value) return authCache.value;
  let value;
  try {
    const { out } = await runClaude(['auth', 'status'], '', 20000);
    const j = JSON.parse(out);
    value = { cli: true, loggedIn: !!j.loggedIn, authMethod: j.authMethod, model: MODEL };
  } catch (e) {
    value = { cli: !/未找到/.test(e.message), loggedIn: false, model: MODEL, error: e.message };
  }
  authCache = { at: Date.now(), value };
  return value;
}

function buildSchema(categories) {
  const expense = categories.expense;
  const income = categories.income;
  return {
    type: 'object',
    properties: {
      document_type: { type: 'string', enum: ['receipt', 'invoice', 'statement', 'voice', 'other'] },
      source_language: { type: 'string', description: 'BCP-47 code of the source text, e.g. ja, en, zh-CN' },
      message: { type: 'string', description: 'Short note to the user in the output language; empty if nothing to say' },
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['expense', 'income'] },
            amount: { type: 'number', description: 'Positive amount in the document currency' },
            currency: { type: 'string', description: 'ISO 4217 code of the document currency' },
            rate_to_base: { type: 'number', description: 'Approximate value of 1 unit of currency in the base currency; 1 if same' },
            category: { type: 'string', enum: [...expense, ...income] },
            merchant: { type: 'string' },
            note: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            time: { type: 'string', description: 'HH:MM, empty if unknown' },
            items: {
              type: 'array',
              description: 'Purchased line items of a single receipt; [] for statements and speech',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Item name in the output language' },
                  amount: { type: 'number', description: 'Line total in the document currency; discounts negative' },
                },
                required: ['name', 'amount'],
              },
            },
          },
          required: ['type', 'amount', 'currency', 'rate_to_base', 'category', 'merchant', 'note', 'date', 'time', 'items'],
        },
      },
    },
    required: ['document_type', 'source_language', 'message', 'transactions'],
  };
}

function buildSystemPrompt({ lang, currency, today, categories }) {
  const langName = LANG_NAMES[lang] || LANG_NAMES['zh-CN'];
  return `You are the recognition engine of a personal bookkeeping app. Turn receipts, invoices, bill/statement screenshots or a spoken description into bookkeeping records.

Today is ${today}. The user's base currency is ${currency}. Output language: ${langName}.

Rules:
- Documents may be in any language. Write "merchant", "note" and "message" in ${langName}. Translate them; for well-known brands keep the original name next to the translation if it helps recognition (e.g. "罗森 Lawson").
- A single purchase receipt or invoice = ONE transaction. amount = the final total actually paid (after discounts and tax, before cash change). The note briefly lists the main items (at most ~4), e.g. "饭团、绿茶、炸鸡块等".
- For a single receipt also fill "items" with every purchased line (translated name, line total in the document currency; discounts as negative lines). Leave tax-included notes, change and payment lines out. For statements and speech "items" is [].
- "merchant" is the shop/payee name only; "note" is a short description and must not repeat the merchant.
- A statement or bill list (bank, credit card, Alipay, WeChat Pay, PayPal…) = one transaction per line item. Skip balances, subtotals and summary rows.
- Several images may belong to the same long receipt; do not double count.
- type: "expense" for spending; "income" for salary, refunds, red packets received, transfers received, interest, etc.
- amount is always positive, in the document's own currency. currency is its ISO 4217 code (¥ on a Japanese receipt is JPY; ¥/元 on a Chinese receipt is CNY).
- rate_to_base: 1 if the currency equals ${currency}; otherwise your best approximate exchange rate (1 unit of the document currency in ${currency}).
- category must be one of the ids below; pick the closest, fall back to "other" / "other_income".
  Expense ids: ${categories.expense.join(', ')}
  Income ids: ${categories.income.join(', ')}
- date as YYYY-MM-DD. If the year is missing infer the most recent past date; if no date at all use today. Resolve relative dates in speech ("昨天", "last Friday") against today. time as HH:MM or "".
- For speech, the text may contain several records ("午饭35，打车20") — return each one. If no currency is mentioned assume ${currency}.
- If nothing can be recognised, return an empty transactions array and explain why in "message".
Return only the structured result.`;
}

function extractJson(text) {
  const s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('识别结果格式异常');
  return JSON.parse(s.slice(a, b + 1));
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

  const content = [];
  for (const f of (body.files || []).slice(0, 6)) {
    if (IMAGE_TYPES.has(f.mediaType)) content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } });
    else if (f.mediaType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } });
  }
  const text = String(body.text || '').slice(0, 2000).trim();
  if (!content.length && !text) throw new Error('没有可识别的内容');
  content.push({
    type: 'text',
    text: text
      ? `Spoken bookkeeping input (transcribed):\n"""${text}"""`
      : 'Recognise the attached bill(s) and return the bookkeeping records.',
  });

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
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

async function handler(req, res) {
  try {
    if (req.url === '/api/health' && req.method === 'GET') return sendJson(res, 200, await authStatus());
    if (req.url === '/api/recognize' && req.method === 'POST') {
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

http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log(`\n  记账本已启动  http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  局域网访问    http://${ip}:${PORT}`);
  console.log(`  识别模型      ${MODEL}（本地 Claude Code 订阅）\n`);
});

// 手机通过局域网使用麦克风需要 HTTPS：放入 certs/key.pem 与 certs/cert.pem 即自动开启
const keyFile = path.join(ROOT, 'certs', 'key.pem');
const certFile = path.join(ROOT, 'certs', 'cert.pem');
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler).listen(HTTPS_PORT, '0.0.0.0', () => {
    for (const ip of lanAddresses()) console.log(`  HTTPS 访问    https://${ip}:${HTTPS_PORT}`);
  });
}
