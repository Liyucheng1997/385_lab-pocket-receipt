// 数据层：记录与设置保存在 localStorage
const TX_KEY = 'ledger.v1.tx';
const SETTINGS_KEY = 'ledger.v1.settings';

export const DEFAULT_SETTINGS = { lang: 'zh-CN', currency: 'CNY', theme: 'system', budget: 0, catBudgets: {}, voiceLang: '', apiModel: 'claude-opus-5-5' };

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
  for (const fn of listeners) fn();
}

export const settings = () => state.settings;
export const allTx = () => state.tx;

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  persist(SETTINGS_KEY, state.settings);
  emit();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normalize(t) {
  const out = {
    id: t.id || uid(),
    type: t.type === 'income' ? 'income' : 'expense',
    amount: round2(Math.abs(t.amount)),
    category: t.category,
    note: (t.note || '').trim(),
    merchant: (t.merchant || '').trim(),
    date: t.date,
    time: t.time || '',
    source: t.source || 'manual',
    createdAt: t.createdAt || Date.now(),
  };
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

export function addTx(list) {
  const items = (Array.isArray(list) ? list : [list]).map(normalize);
  state.tx = [...items, ...state.tx];
  persist(TX_KEY, state.tx);
  emit();
  return items;
}

export function updateTx(id, patch) {
  state.tx = state.tx.map((t) => (t.id === id ? normalize({ ...t, ...patch, id }) : t));
  persist(TX_KEY, state.tx);
  emit();
}

export function removeTx(id) {
  state.tx = state.tx.filter((t) => t.id !== id);
  persist(TX_KEY, state.tx);
  emit();
}

export function replaceAll(tx, newSettings) {
  state.tx = tx.map(normalize);
  if (newSettings) state.settings = { ...DEFAULT_SETTINGS, ...newSettings };
  persist(TX_KEY, state.tx);
  persist(SETTINGS_KEY, state.settings);
  emit();
}

export function clearAll() {
  state.tx = [];
  state.settings = { ...DEFAULT_SETTINGS, lang: state.settings.lang, theme: state.settings.theme, currency: state.settings.currency, apiModel: state.settings.apiModel };
  persist(TX_KEY, state.tx);
  persist(SETTINGS_KEY, state.settings);
  emit();
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
