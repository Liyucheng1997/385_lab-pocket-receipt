// 当前登录的账号（账号模式下才有）。本机缓存按账号分开存放，换账号时整页刷新。
const USER_KEY = 'ledger.v1.user';
const BASE = 'ledger.v1';

function read() {
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY));
    return u && typeof u.id === 'string' && /^[\w-]{1,48}$/.test(u.id) ? u : null;
  } catch {
    return null;
  }
}

export const localUser = read();
// 未登录（或没开账号模式）时沿用原来的键名，老数据不受影响
export const NS = localUser ? `${BASE}.u.${localUser.id}` : BASE;
export const ANON_NS = BASE;

export function setLocalUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, name: user.name }));
    else localStorage.removeItem(USER_KEY);
  } catch { /* 存储不可用时忽略 */ }
}
