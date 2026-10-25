// 金额与日期格式化
import { getLang } from './i18n.js';
import { settings } from './store.js';

export const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'HKD', 'TWD', 'GBP', 'KRW', 'SGD', 'AUD', 'CAD', 'THB', 'MYR', 'CHF'];

const fmtCache = new Map();
function nf(currency, compact) {
  const key = `${getLang()}|${currency}|${compact}`;
  if (!fmtCache.has(key)) {
    let f;
    try {
      f = new Intl.NumberFormat(getLang(), {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
      });
    } catch {
      f = new Intl.NumberFormat(getLang(), { style: 'currency', currency });
    }
    fmtCache.set(key, f);
  }
  return fmtCache.get(key);
}

export function money(n, currency = settings().currency) {
  return nf(currency, false).format(n || 0);
}

// 外币原值用币种代码显示，避免 ¥（人民币/日元）混淆
export function moneyCode(n, currency) {
  try {
    return new Intl.NumberFormat(getLang(), { style: 'currency', currency, currencyDisplay: 'code' }).format(n || 0);
  } catch {
    return `${currency} ${n}`;
  }
}

export function moneyCompact(n, currency = settings().currency) {
  return nf(currency, true).format(n || 0);
}

export function currencySymbol(currency = settings().currency) {
  const part = nf(currency, false).formatToParts(0).find((p) => p.type === 'currency');
  return part ? part.value : currency;
}

export function currencyName(code) {
  try {
    return new Intl.DisplayNames([getLang()], { type: 'currency' }).of(code);
  } catch {
    return code;
  }
}

export function languageName(code) {
  try {
    return new Intl.DisplayNames([getLang()], { type: 'language' }).of(code);
  } catch {
    return code;
  }
}

// 本地时区的 YYYY-MM-DD
export function ymd(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function nowHm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function monthRange(y, m) {
  const last = new Date(y, m + 1, 0).getDate();
  const p = (n) => String(n).padStart(2, '0');
  return [`${y}-${p(m + 1)}-01`, `${y}-${p(m + 1)}-${p(last)}`];
}

export function monthLabel(y, m) {
  return new Intl.DateTimeFormat(getLang(), { year: 'numeric', month: 'long' }).format(new Date(y, m, 1));
}

export function shortMonth(m) {
  return new Intl.DateTimeFormat(getLang(), { month: 'short' }).format(new Date(2000, m, 1));
}

export function dayLabel(dateStr) {
  const d = parseYmd(dateStr);
  return new Intl.DateTimeFormat(getLang(), { month: 'short', day: 'numeric', weekday: 'short' }).format(d);
}

export function shortDate(dateStr) {
  return new Intl.DateTimeFormat(getLang(), { month: 'short', day: 'numeric' }).format(parseYmd(dateStr));
}

export function weekdayShort(d) {
  return new Intl.DateTimeFormat(getLang(), { weekday: 'narrow' }).format(d);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// 周一为一周的开始
export function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (x.getDay() + 6) % 7;
  return addDays(x, -wd);
}
