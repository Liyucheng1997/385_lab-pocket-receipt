// 账号模式：注册 / 登录 / 会话，以及每个用户的记录、设置、小票照片（全部存成 DATA_DIR 下的文件）
//   users.json            用户表（密码只存 scrypt 哈希）
//   sessions.json         登录会话（只存令牌的 SHA-256）
//   u/<uid>/data.json     { rev, tx, settings }
//   u/<uid>/photos/*.jpg  小票照片
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

const COOKIE = 'ledger_sid';
const SESSION_MS = 90 * 24 * 3600 * 1000;
const NAME_RE = /^[\p{L}\p{N}_.-]{2,20}$/u;
const ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const MAX_TX = 50000;
const MAX_SYNC_BODY = 20 * 1024 * 1024;
const MAX_PHOTO = 2 * 1024 * 1024;
const MAX_PHOTOS = 3000;
const MAX_SETTINGS = 200 * 1024;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };

function readJson(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
  return JSON.parse(raw); // 文件损坏时直接报错，避免用空数据覆盖
}

function writeJson(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

export function readBuf(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new HttpError(413, 'too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, max = 64 * 1024) {
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) fail(415, 'bad_request');
  try {
    const v = JSON.parse((await readBuf(req, max)).toString('utf8'));
    if (!v || typeof v !== 'object') throw new Error('not object');
    return v;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return fail(400, 'bad_request');
  }
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nameKey = (name) => name.normalize('NFKC').toLowerCase();

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return { salt, hash };
}

async function checkPassword(user, password) {
  const { hash } = await hashPassword(String(password), user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

export function createAccounts({ dataDir, inviteCode = '', trustProxy = false, recognizeDaily = 100 }) {
  fs.mkdirSync(path.join(dataDir, 'u'), { recursive: true });
  const usersFile = path.join(dataDir, 'users.json');
  const sessionsFile = path.join(dataDir, 'sessions.json');

  const users = new Map(readJson(usersFile, []).map((u) => [u.id, u]));
  const byName = new Map([...users.values()].map((u) => [nameKey(u.name), u]));
  const sessions = new Map(Object.entries(readJson(sessionsFile, {})));
  const saveUsers = () => writeJson(usersFile, [...users.values()]);
  const saveSessions = () => writeJson(sessionsFile, Object.fromEntries(sessions));

  // ---------- 限流（内存计数） ----------
  const buckets = new Map();
  function hit(key, max, windowMs) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.n++;
    return b.n <= max;
  }
  const peek = (key, max) => { const b = buckets.get(key); return !b || b.reset < Date.now() || b.n < max; };
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
    let dirty = false;
    for (const [k, s] of sessions) if (s.exp < now) { sessions.delete(k); dirty = true; }
    if (dirty) saveSessions();
  }, 10 * 60 * 1000).unref();

  const ipOf = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const isHttps = (req) => !!req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');

  // ---------- 会话 ----------
  function tokenOf(req) {
    const m = /(?:^|;\s*)ledger_sid=([A-Za-z0-9_-]{20,80})/.exec(req.headers.cookie || '');
    return m ? m[1] : '';
  }

  function userOf(req) {
    const token = tokenOf(req);
    if (!token) return null;
    const s = sessions.get(sha(token));
    if (!s || s.exp < Date.now()) return null;
    return users.get(s.uid) || null;
  }

  function setCookie(req, res, token, maxAgeMs) {
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${isHttps(req) ? '; Secure' : ''}`);
  }

  function startSession(req, res, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(sha(token), { uid: user.id, exp: Date.now() + SESSION_MS });
    saveSessions();
    setCookie(req, res, token, SESSION_MS);
  }

  function dropSessions(uid, exceptHash) {
    for (const [k, s] of sessions) if (s.uid === uid && k !== exceptHash) sessions.delete(k);
    saveSessions();
  }

  const publicUser = (u) => (u ? { id: u.id, name: u.name } : null);

  // ---------- 用户数据 ----------
  const cache = new Map();
  const userDir = (uid) => path.join(dataDir, 'u', uid);
  const photoDir = (uid) => path.join(userDir(uid), 'photos');

  function loadData(uid) {
    let d = cache.get(uid);
    if (!d) {
      d = readJson(path.join(userDir(uid), 'data.json'), { rev: 0, tx: [], settings: {} });
      cache.set(uid, d);
      if (cache.size > 100) cache.delete(cache.keys().next().value);
    }
    return d;
  }

  function saveData(uid, d) {
    fs.mkdirSync(userDir(uid), { recursive: true });
    writeJson(path.join(userDir(uid), 'data.json'), d);
  }

  const validTx = (t) => t && typeof t === 'object' && typeof t.id === 'string' && ID_RE.test(t.id)
    && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isFinite(t.amount);

  function applyOps(uid, ops) {
    if (!Array.isArray(ops) || !ops.length || ops.length > 500) fail(400, 'bad_request');
    const d = loadData(uid);
    let tx = d.tx;
    let settings = d.settings;
    for (const op of ops) {
      if (!op || typeof op !== 'object') fail(400, 'bad_request');
      if (op.op === 'upsert') {
        if (!Array.isArray(op.items) || !op.items.every(validTx)) fail(400, 'bad_request');
        const incoming = new Map(op.items.map((t) => [t.id, t]));
        tx = tx.map((t) => { const n = incoming.get(t.id); if (n) incoming.delete(t.id); return n || t; });
        tx = [...incoming.values(), ...tx];
      } else if (op.op === 'remove') {
        if (!Array.isArray(op.ids)) fail(400, 'bad_request');
        const ids = new Set(op.ids);
        tx = tx.filter((t) => !ids.has(t.id));
      } else if (op.op === 'settings') {
        if (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch)) fail(400, 'bad_request');
        settings = { ...settings, ...op.patch };
      } else if (op.op === 'replace' || op.op === 'clear') {
        const list = op.op === 'clear' ? [] : op.tx;
        if (!Array.isArray(list) || !list.every(validTx)) fail(400, 'bad_request');
        tx = list;
        if (op.settings && typeof op.settings === 'object' && !Array.isArray(op.settings)) settings = op.settings;
        if (op.op === 'clear') fs.rmSync(photoDir(uid), { recursive: true, force: true });
      } else {
        fail(400, 'bad_request');
      }
    }
    if (tx.length > MAX_TX || JSON.stringify(settings).length > MAX_SETTINGS) fail(413, 'too_large');
    d.tx = tx;
    d.settings = settings;
    d.rev++;
    saveData(uid, d);
    return d.rev;
  }

  // ---------- 接口 ----------
  function json(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  function checkCredentials(name, password) {
    if (typeof name !== 'string' || !NAME_RE.test(name.trim())) fail(400, 'bad_name');
    if (typeof password !== 'string' || password.length < 6 || password.length > 200) fail(400, 'bad_password');
  }

  async function register(req, res) {
    const body = await readJsonBody(req);
    if (!hit(`reg:${ipOf(req)}`, 10, 3600e3)) fail(429, 'too_many');
    checkCredentials(body.name, body.password);
    if (inviteCode && body.invite !== inviteCode) fail(403, 'bad_invite');
    const name = body.name.trim();
    if (byName.has(nameKey(name))) fail(409, 'name_taken');
    const user = { id: crypto.randomBytes(9).toString('base64url'), name, ...(await hashPassword(body.password)), createdAt: Date.now() };
    if (byName.has(nameKey(name))) fail(409, 'name_taken'); // 哈希期间可能有并发注册
    users.set(user.id, user);
    byName.set(nameKey(name), user);
    saveUsers();
    startSession(req, res, user);
    console.log(`[account] 新用户 ${name}`);
    json(res, 200, { ok: true, user: publicUser(user) });
  }

  async function login(req, res) {
    const body = await readJsonBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const key = `login:${ipOf(req)}:${nameKey(name)}`;
    // 按「IP+用户名」「IP」「用户名」三层限制失败次数；最后一层在代理头被伪造时仍然有效
    const nameLimit = `login-name:${nameKey(name)}`;
    if (!peek(key, 10) || !peek(`login:${ipOf(req)}`, 60) || !peek(nameLimit, 40)) fail(429, 'too_many');
    const user = byName.get(nameKey(name));
    // 用户不存在时也算一次哈希，避免通过耗时判断用户名是否存在
    const ok = user ? await checkPassword(user, body.password ?? '') : (await hashPassword(String(body.password ?? '')), false);
    if (!ok) {
      hit(key, 10, 15 * 60e3);
      hit(`login:${ipOf(req)}`, 60, 15 * 60e3);
      hit(nameLimit, 40, 15 * 60e3);
      fail(401, 'bad_login');
    }
    startSession(req, res, user);
    json(res, 200, { ok: true, user: publicUser(user) });
  }

  function logout(req, res) {
    const token = tokenOf(req);
    if (token && sessions.delete(sha(token))) saveSessions();
    setCookie(req, res, 'x', 0);
    json(res, 200, { ok: true });
  }

  async function changePassword(req, res, user) {
    const body = await readJsonBody(req);
    if (!hit(`pw:${user.id}`, 10, 15 * 60e3)) fail(429, 'too_many');
    if (!(await checkPassword(user, body.old ?? ''))) fail(401, 'bad_login');
    checkCredentials(user.name, body.password);
    Object.assign(user, await hashPassword(body.password));
    saveUsers();
    dropSessions(user.id, sha(tokenOf(req))); // 其他设备需要重新登录
    json(res, 200, { ok: true });
  }

  async function deleteAccount(req, res, user) {
    const body = await readJsonBody(req);
    if (!hit(`pw:${user.id}`, 10, 15 * 60e3)) fail(429, 'too_many');
    if (!(await checkPassword(user, body.password ?? ''))) fail(401, 'bad_login');
    users.delete(user.id);
    byName.delete(nameKey(user.name));
    saveUsers();
    dropSessions(user.id);
    cache.delete(user.id);
    fs.rmSync(userDir(user.id), { recursive: true, force: true });
    setCookie(req, res, 'x', 0);
    console.log(`[account] 已注销 ${user.name}`);
    json(res, 200, { ok: true });
  }

  async function photo(req, res, user, id) {
    if (!/^[a-z0-9]{4,40}$/.test(id)) fail(400, 'bad_request');
    const file = path.join(photoDir(user.id), `${id}.jpg`);
    if (req.method === 'GET') {
      if (!fs.existsSync(file)) fail(404, 'not_found');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.method === 'PUT') {
      const buf = await readBuf(req, MAX_PHOTO);
      if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) fail(400, 'bad_request');
      fs.mkdirSync(photoDir(user.id), { recursive: true });
      if (!fs.existsSync(file) && fs.readdirSync(photoDir(user.id)).length >= MAX_PHOTOS) fail(413, 'too_large');
      fs.writeFileSync(file, buf);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      fs.rmSync(file, { force: true });
      return json(res, 200, { ok: true });
    }
    fail(405, 'bad_request');
  }

  // 处理账号相关接口；不是这里管的路径返回 false
  async function handle(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    try {
      if (p === '/api/session' && m === 'GET') return json(res, 200, { accounts: true, invite: !!inviteCode, user: publicUser(userOf(req)) });
      if (p === '/api/auth/register' && m === 'POST') return await register(req, res);
      if (p === '/api/auth/login' && m === 'POST') return await login(req, res);
      if (p === '/api/auth/logout' && m === 'POST') return logout(req, res);

      const isData = p === '/api/data' || p === '/api/sync' || p.startsWith('/api/photos/') || p === '/api/auth/password' || p === '/api/auth/delete';
      if (!isData) return false;
      const user = userOf(req);
      if (!user) fail(401, 'unauthorized');

      if (p === '/api/auth/password' && m === 'POST') return await changePassword(req, res, user);
      if (p === '/api/auth/delete' && m === 'POST') return await deleteAccount(req, res, user);
      if (p === '/api/data' && m === 'GET') {
        const d = loadData(user.id);
        if (url.searchParams.get('rev') === String(d.rev)) return json(res, 200, { ok: true, same: true, rev: d.rev });
        return json(res, 200, { ok: true, rev: d.rev, tx: d.tx, settings: d.settings });
      }
      if (p === '/api/sync' && m === 'POST') {
        const body = await readJsonBody(req, MAX_SYNC_BODY);
        return json(res, 200, { ok: true, rev: applyOps(user.id, body.ops) });
      }
      if (p.startsWith('/api/photos/')) return await photo(req, res, user, p.slice('/api/photos/'.length));
      fail(405, 'bad_request');
    } catch (e) {
      if (!(e instanceof HttpError)) { console.error('[account]', e); return json(res, 500, { ok: false, code: 'server', error: 'server' }); }
      return json(res, e.status, { ok: false, code: e.code, error: e.code });
    }
    return true;
  }

  // 每个用户每天的 AI 识别次数上限
  const allowRecognize = (uid) => hit(`ai:${uid}:${new Date().toISOString().slice(0, 10)}`, recognizeDaily, 24 * 3600e3);

  return { handle, userOf, allowRecognize, userCount: () => users.size };
}
