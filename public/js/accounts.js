// 账户：现金 / 支付宝 / 微信 / 储蓄卡 / 信用卡…，余额 = 初始余额 + 收入 − 支出 ± 转账
import { h, tile } from './ui.js';
import { t } from './i18n.js';
import { settings, allTx } from './store.js';

export const ACCOUNT_KINDS = {
  cash: { icon: 'cash', color: '#37b85c' },
  alipay: { icon: 'wallet', color: '#1677ff' },
  wechat: { icon: 'chat', color: '#07c160' },
  bank: { icon: 'bank', color: '#f0a800' },
  credit: { icon: 'card', color: '#f0524f' },
  other: { icon: 'coins', color: '#8e99a8' },
};

export const accounts = () => settings().accounts || [];
export const getAccount = (id) => accounts().find((a) => a.id === id) || null;
export const accountName = (a) => (a ? a.name || t(`acct.${a.kind}`) : t('acct.none'));
export const accountNameById = (id) => (getAccount(id) ? accountName(getAccount(id)) : '');

export function acctTile(a, size = 38) {
  const k = ACCOUNT_KINDS[a?.kind] || ACCOUNT_KINDS.other;
  return tile(k.icon, k.color, size);
}

export function balances() {
  const m = new Map(accounts().map((a) => [a.id, Number(a.init) || 0]));
  const add = (id, v) => { if (m.has(id)) m.set(id, m.get(id) + v); };
  for (const x of allTx()) {
    if (x.type === 'transfer') {
      add(x.account, -x.amount);
      add(x.toAccount, x.amount);
    } else add(x.account, x.type === 'income' ? x.amount : -x.amount);
  }
  for (const [k, v] of m) m.set(k, Math.round(v * 100) / 100);
  return m;
}

export const defaultAccount = () => getAccount(settings().lastAccount)?.id || accounts()[0]?.id || '';
export const accountByKind = (kind) => accounts().find((a) => a.kind === kind)?.id || '';

// 叠在按钮上的透明原生下拉框，手机上会弹出系统选择器
export function accountSelect(value, onChange, { none = true } = {}) {
  return h('select', { class: 'cat-select-native', 'aria-label': t('acct.account'), onchange: (e) => onChange(e.target.value) },
    none && h('option', { value: '', selected: !value }, t('acct.none')),
    accounts().map((a) => h('option', { value: a.id, selected: a.id === value }, accountName(a))));
}
