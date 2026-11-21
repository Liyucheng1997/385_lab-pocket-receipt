// 账号与云端同步（服务器开启账号模式时才生效）
// 每次改动先落到本机缓存，再作为一条“操作”排队发给服务器；断网时留在队列里，联网后补发。
import { localUser, NS, setLocalUser } from './session.js';
import { allTx, settings, setSyncHook, applyRemote, updateSettings, replaceAll, anonData } from './store.js';
import { flushPhotos, importAnonPhotos, clearPhotos } from './photos.js';

const QUEUE_KEY = `${NS}.queue`;
const REV_KEY = `${NS}.rev`;
const ASKED_KEY = `${NS}.importAsked`;

const ls = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 忽略 */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* 忽略 */ } },
};

let info = { accounts: false, invite: false, user: localUser };
export const cloudInfo = () => info;
export const cloudUser = () => localUser;

// synced / syncing / pending / offline
let status = 'synced';
const listeners = new Set();
export const syncStatus = () => status;
export const pendingCount = () => ls.get(QUEUE_KEY, []).length;
export function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setStatus(s) {
  if (s === status) return;
  status = s;
  listeners.forEach((f) => f(s));
}

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let j;
  try { j = await r.json(); } catch { j = { ok: false, code: 'server' }; }
  j.status = r.status;
  return j;
}

// ---------- 启动：确认登录状态 ----------
async function fetchSession() {
  // 纯静态托管（GitHub Pages）没有服务端
  if (location.hostname.endsWith('github.io') || location.protocol === 'file:') return null;
  try {
    const r = await fetch('api/session', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const j = r.ok ? await r.json() : null;
    return j && typeof j.accounts === 'boolean' ? j : null;
  } catch {
    return null;
  }
}

function switchUser(user) {
  setLocalUser(user);
  location.reload();
  return 'reload';
}

// 返回 'app'（照常进入）/ 'auth'（需要登录）/ 'reload'（正在刷新）
export async function boot() {
  const s = await fetchSession();
  if (!s) return 'app'; // 没有服务端或暂时连不上：用本机数据
  info = { accounts: s.accounts, invite: !!s.invite, user: s.user || null };
  if (!s.accounts) return localUser ? switchUser(null) : 'app';
  if (!s.user) return localUser ? switchUser(null) : 'auth';
  if (!localUser || localUser.id !== s.user.id) return switchUser(s.user);
  return 'app';
}

// ---------- 账号 ----------
export async function signIn(mode, { name, password, invite }) {
  const r = await api(mode === 'register' ? 'api/auth/register' : 'api/auth/login', { name, password, invite });
  if (!r.ok) throw new Error(r.code || 'server');
  switchUser(r.user);
}

export async function changePassword(old, password) {
  const r = await api('api/auth/password', { old, password });
  if (!r.ok) throw new Error(r.code || 'server');
}

function dropLocalCache() {
  for (const k of ['tx', 'settings', 'queue', 'rev', 'importAsked', 'photoQueue']) ls.del(`${NS}.${k}`);
  clearPhotos();
}

// 退出登录；还有没同步上去的改动时返回 false（force 为真则放弃这些改动）
export async function signOut(force = false) {
  await flush();
  if (pendingCount() && !force) return false;
  await api('api/auth/logout', {}).catch(() => {});
  dropLocalCache();
  switchUser(null);
  return true;
}

export async function deleteAccount(password) {
  const r = await api('api/auth/delete', { password });
  if (!r.ok) throw new Error(r.code || 'server');
  dropLocalCache();
  switchUser(null);
}

// ---------- 同步 ----------
let timer = 0;
function enqueue(op) {
  ls.set(QUEUE_KEY, [...ls.get(QUEUE_KEY, []), op]);
  setStatus('pending');
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

let flushing = null;
export function flush() {
  if (!localUser) return Promise.resolve();
  flushing ||= doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush() {
  try {
    let stale = false;
    for (;;) {
      const batch = ls.get(QUEUE_KEY, []).slice(0, 100);
      if (!batch.length) break;
      setStatus('syncing');
      const r = await api('api/sync', { ops: batch });
      if (r.status === 401) return switchUser(null);
      if (!r.ok && r.status >= 500) throw new Error('server');
      // 服务器拒收的操作（格式不对、超限）丢掉，随后以服务器为准
      ls.set(QUEUE_KEY, ls.get(QUEUE_KEY, []).slice(batch.length));
      if (r.ok) {
        if (r.rev !== ls.get(REV_KEY, -1) + 1) stale = true;
        ls.set(REV_KEY, r.rev);
      } else {
        stale = true;
      }
    }
    await flushPhotos();
    if (stale) { ls.set(REV_KEY, -1); await pull(); }
    setStatus('synced');
  } catch {
    setStatus(navigator.onLine === false ? 'offline' : 'pending');
  }
  return null;
}

// 拉取服务器上的最新数据（本机还有没发出去的改动时先不拉，避免覆盖）
export async function pull() {
  if (!localUser || pendingCount()) return false;
  const r = await api(`api/data?rev=${ls.get(REV_KEY, -1)}`);
  if (r.status === 401) { switchUser(null); return false; }
  if (!r.ok) throw new Error('server');
  if (r.same || pendingCount()) return true;
  ls.set(REV_KEY, r.rev);
  applyRemote(r.tx, r.settings);
  return true;
}

export async function syncNow() {
  await flush();
  try { await pull(); } catch { setStatus('offline'); }
  return status === 'synced';
}

// 新账号第一次登录：沿用这台设备的语言等偏好；本机原来有记录的话问一下要不要导入
async function firstRun(confirmImport) {
  if (ls.get(REV_KEY, -1) !== 0 || allTx().length || ls.get(ASKED_KEY, false)) return;
  ls.set(ASKED_KEY, true);
  const anon = anonData();
  const prefs = {};
  for (const k of ['lang', 'theme', 'currency']) if (anon.settings[k] && anon.settings[k] !== settings()[k]) prefs[k] = anon.settings[k];
  if (anon.tx.length && (await confirmImport(anon.tx.length))) {
    replaceAll(anon.tx, { ...anon.settings });
    importAnonPhotos([...new Set(anon.tx.flatMap((t) => t.photos || []))]);
  } else if (Object.keys(prefs).length) {
    updateSettings(prefs);
  }
}

// 登录状态下启动同步；afterFirstSync 在第一次同步尝试结束后调用（无论成败）
export async function startSync({ confirmImport, afterFirstSync }) {
  if (!localUser) return;
  try {
    await flush();
    await pull();
    await firstRun(confirmImport);
  } catch {
    setStatus('offline');
  }
  afterFirstSync?.();
  const tick = () => { if (document.visibilityState === 'visible') syncNow(); };
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('online', tick);
  setInterval(tick, 60000);
}

if (localUser) {
  setSyncHook(enqueue);
  if (pendingCount()) status = 'pending';
}
