// 数据层：记录与设置保存在 localStorage（小票照片在 IndexedDB，见 photos.js）
// 登录账号后这里是本机缓存，每次改动同时交给 cloud.js 同步到服务器
import { deletePhotos, clearPhotos } from './photos.js';
import { NS, ANON_NS } from './session.js';

const TX_KEY = `${NS}.tx`;
const SETTINGS_KEY = `${NS}.settings`;

let syncHook = null;
export function setSyncHook(fn) { syncHook = fn; }
const push = (op) => { if (syncHook) syncHook(op); };

const DEFAULT_ACCOUNTS = [
  { id: 'cash', kind: 'cash', name: '', init: 0 },
  { id: 'alipay', kind: 'alipay', name: '', init: 0 },
  { id: 'wechat', kind: 'wechat', name: '', init: 0 },
  { id: 'bank', kind: 'bank', name: '', init: 0 },
  { id: 'credit', kind: 'credit', name: '', init: 0 },
];

export const DEFAULT_SETTINGS = {
  lang: 'zh-CN', currency: 'CNY', theme: 'system', budget: 0, catBudgets: {}, voiceLang: '', apiModel: 'claude-opus-5-5',
  accounts: DEFAULT_ACCOUNTS, lastAccount: '', recurring: [],
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 隐私模式等情况下忽略 */ }
}

const state = {
  tx: load(TX_KEY, []),
  settings: { ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}) },
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of [...listeners]) fn();
}

export const settings = () => state.settings;
export const allTx = () => state.tx;

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  persist(SETTINGS_KEY, state.settings);
  push({ op: 'settings', patch });
  emit();
}

// 用服务器上的数据覆盖本机缓存（不再回传）
export function applyRemote(tx, remoteSettings) {
  state.tx = Array.isArray(tx) ? tx : [];
  state.settings = { ...DEFAULT_SETTINGS, ...(remoteSettings || {}) };
  persist(SETTINGS_KEY, state.settings);
  saveTx();
}

// 登录前留在这台设备上的数据（用于首次登录时导入）
export function anonData() {
  return { tx: load(`${ANON_NS}.tx`, []), settings: load(`${ANON_NS}.settings`, {}) };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

const TYPES = new Set(['expense', 'income', 'transfer']);

function normalize(t) {
  const type = TYPES.has(t.type) ? t.type : 'expense';
  const out = {
    id: t.id || uid(),
    type,
    amount: round2(Math.abs(t.amount)),
    category: type === 'transfer' ? 'transfer' : t.category,
    note: (t.note || '').trim(),
    merchant: (t.merchant || '').trim(),
    date: t.date,
    time: t.time || '',
    account: t.account || '',
    source: t.source || 'manual',
    createdAt: t.createdAt || Date.now(),
  };
  if (type === 'transfer') out.toAccount = t.toAccount || '';
  if (Array.isArray(t.photos) && t.photos.length) out.photos = t.photos.slice(0, 6);
  if (Array.isArray(t.items) && t.items.length) {
    out.items = t.items.slice(0, 60).map((i) => ({ name: String(i.name || '').trim(), amount: round2(Number(i.amount) || 0) })).filter((i) => i.name);
  }
  if (t.origCurrency && t.origCurrency !== state.settings.currency) {
    out.origCurrency = t.origCurrency;
    out.origAmount = round2(t.origAmount);
    out.rate = Number(t.rate) || 0;
  }
  return out;
}

function saveTx() {
  persist(TX_KEY, state.tx);
  emit();
}

export function addTx(list) {
  const items = (Array.isArray(list) ? list : [list]).map(normalize);
  state.tx = [...items, ...state.tx];
  push({ op: 'upsert', items });
  saveTx();
  return items;
}

export function updateTx(id, patch) {
  state.tx = state.tx.map((t) => (t.id === id ? normalize({ ...t, ...patch, id }) : t));
  const now = state.tx.find((t) => t.id === id);
  if (now) push({ op: 'upsert', items: [now] });
  saveTx();
}

export function removeTx(id) {
  const gone = state.tx.find((t) => t.id === id);
  state.tx = state.tx.filter((t) => t.id !== id);
  // 照片可能被同一张账单的多条记录共用，没人引用了才删
  if (gone?.photos?.length) {
    const used = new Set(state.tx.flatMap((t) => t.photos || []));
    deletePhotos(gone.photos.filter((p) => !used.has(p)));
  }
  push({ op: 'remove', ids: [id] });
  saveTx();
}

export function replaceAll(tx, newSettings) {
  if (newSettings) state.settings = { ...DEFAULT_SETTINGS, ...newSettings };
  state.tx = tx.map(normalize);
  persist(SETTINGS_KEY, state.settings);
  push({ op: 'replace', tx: state.tx, settings: newSettings ? state.settings : undefined });
  saveTx();
}

export function clearAll() {
  const s = state.settings;
  state.tx = [];
  state.settings = { ...DEFAULT_SETTINGS, lang: s.lang, theme: s.theme, currency: s.currency, apiModel: s.apiModel };
  clearPhotos();
  persist(SETTINGS_KEY, state.settings);
  push({ op: 'clear', settings: state.settings });
  saveTx();
}

// 按日期区间（含首尾，YYYY-MM-DD）筛选
export function txBetween(from, to) {
  return state.tx.filter((t) => t.date >= from && t.date <= to);
}

export function sum(list, type) {
  return round2(list.reduce((s, t) => (t.type === type ? s + t.amount : s), 0));
}

// 同一天内按时间、创建时间倒序
export function sortTx(list) {
  return [...list].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time) || b.createdAt - a.createdAt);
}

// ---------- 周期记账 ----------
const pad = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function nextDate(dateStr, every, anchor) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (every === 'week') return toYmd(new Date(y, m - 1, d + 7));
  const last = new Date(y, m + 1, 0).getDate(); // 下个月的天数
  return toYmd(new Date(y, m, Math.min(anchor || d, last)));
}

// 以一条刚记下的记录为模板，之后每周 / 每月自动记一笔
export function addRecurring(tx, every) {
  const anchor = Number(tx.date.slice(8));
  const rule = {
    id: uid(), every, anchor, next: nextDate(tx.date, every, anchor),
    tpl: { type: tx.type, category: tx.category, amount: tx.amount, note: tx.note, merchant: tx.merchant || '', account: tx.account || '' },
  };
  updateSettings({ recurring: [...(state.settings.recurring || []), rule] });
}

export function removeRecurring(id) {
  updateSettings({ recurring: (state.settings.recurring || []).filter((r) => r.id !== id) });
}

// 启动时补记到期的周期记录，返回补记的笔数
export function runRecurring() {
  const today = toYmd(new Date());
  const made = [];
  const have = new Set(state.tx.map((t) => t.id));
  const rules = (state.settings.recurring || []).map((r) => {
    let next = r.next;
    for (let i = 0; i < 120 && next <= today; i++) {
      // 固定 id：多台设备同时补记时不会重复
      const id = `r${r.id}${next.replace(/-/g, '')}`;
      if (!have.has(id)) made.push({ ...r.tpl, id, date: next, source: 'auto' });
      next = nextDate(next, r.every, r.anchor);
    }
    return next === r.next ? r : { ...r, next };
  });
  if (rules.every((r, i) => r === state.settings.recurring[i])) return 0;
  state.settings = { ...state.settings, recurring: rules };
  persist(SETTINGS_KEY, state.settings);
  push({ op: 'settings', patch: { recurring: rules } });
  if (made.length) addTx(made);
  else emit();
  return made.length;
}
