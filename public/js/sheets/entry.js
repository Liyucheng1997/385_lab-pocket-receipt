// 记一笔：支出 / 收入 / 转账，分类网格 + 数字键盘
import { h, mount, openSheet, toast, catTile, catName, seg } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { CATEGORIES, defaultCategory, isCategoryOfType } from '../categories.js';
import { addTx, addRecurring, updateSettings } from '../store.js';
import { money, currencySymbol, ymd, nowHm, shortDate } from '../format.js';
import { accounts, getAccount, accountName, acctTile, defaultAccount, accountSelect } from '../accounts.js';

const MAX_INT = 9;
const REPEATS = ['', 'week', 'month'];

function evaluate(expr) {
  const parts = expr.match(/[+-]?[^+-]+/g) || [];
  const total = parts.reduce((s, p) => s + (parseFloat(p) || 0), 0);
  return Math.round(total * 100) / 100;
}

export function openEntry(preset) {
  // 也会被直接当作点击回调使用，这时收到的是事件对象
  const init = preset && !(preset instanceof Event) ? preset : {};
  const acct = defaultAccount();
  const st = {
    type: init.type || 'expense',
    category: defaultCategory('expense'),
    expr: '',
    note: '',
    date: init.date || ymd(),
    account: init.account || acct,
    toAccount: accounts().find((a) => a.id !== (init.account || acct))?.id || '',
    repeat: '',
  };

  const sheet = openSheet({ title: '', full: true, className: 'entry-sheet' });
  const titleEl = sheet.el.querySelector('.sheet-title');
  const top = h('div', { class: 'entry-top' });
  const amountEl = h('div', { class: 'entry-amount tabular' });
  const selCat = h('div', { class: 'entry-cat' });
  const chips = h('div', { class: 'entry-chips' });
  const noteInput = h('input', {
    class: 'entry-note', placeholder: t('entry.note'), maxLength: 60,
    oninput: (e) => (st.note = e.target.value),
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
  });
  const dateInput = h('input', {
    type: 'date', class: 'sr-only', value: st.date, max: ymd(),
    onchange: (e) => { if (e.target.value) { st.date = e.target.value; renderChips(); } },
  });
  const doneKey = h('button', { class: 'key key-done', onclick: onDone });

  function renderTitle() {
    titleEl.replaceChildren(seg([
      { value: 'expense', label: t('expense') },
      { value: 'income', label: t('income') },
      { value: 'transfer', label: t('transfer') },
    ], st.type, (v) => {
      st.type = v;
      if (v !== 'transfer' && !isCategoryOfType(st.category, v)) st.category = defaultCategory(v);
      renderAll();
    }));
  }

  function acctBox(label, key) {
    const a = getAccount(st[key]);
    return h('label', { class: 'acct-box' },
      h('small', null, label),
      h('span', { class: 'acct-box-main' }, acctTile(a, 40), h('b', null, accountName(a)), icon('down', 14, 2.2)),
      accountSelect(st[key], (v) => { st[key] = v; renderAll(); }, { none: false }));
  }

  function renderTop() {
    if (st.type === 'transfer') {
      top.className = 'entry-top transfer-box';
      top.replaceChildren(
        acctBox(t('transfer.from'), 'account'),
        h('button', { class: 'swap-btn', 'aria-label': t('transfer'), onclick: () => { [st.account, st.toAccount] = [st.toAccount, st.account]; renderAll(); } }, icon('swap', 18, 2)),
        acctBox(t('transfer.to'), 'toAccount'),
        h('p', { class: 'transfer-hint' }, t('transfer.hint')));
      return;
    }
    top.className = 'entry-top cat-grid';
    top.replaceChildren(...CATEGORIES[st.type].map((c) =>
      h('button', { class: `cat-item ${c.id === st.category ? 'active' : ''}`, onclick: () => { st.category = c.id; renderAll(); } },
        catTile(c.id, { size: 44, active: c.id === st.category }),
        h('span', null, catName(c.id)))));
  }

  function renderAmount() {
    const cat = st.type === 'transfer' ? 'transfer' : st.category;
    selCat.replaceChildren(catTile(cat, { size: 32, active: true }), h('span', null, catName(cat)));
    amountEl.className = `entry-amount tabular ${st.type}`;
    amountEl.textContent = st.expr ? `${currencySymbol()}${st.expr}` : money(0);
    doneKey.textContent = /\d[+-]/.test(st.expr) ? '=' : t('entry.done');
  }

  function renderChips() {
    const transfer = st.type === 'transfer';
    mount(chips,
      h('button', { class: 'chip', onclick: () => (dateInput.showPicker ? dateInput.showPicker() : dateInput.click()) },
        icon('calendar', 14), st.date === ymd() ? t('today') : shortDate(st.date), dateInput),
      !transfer && h('label', { class: 'chip' }, icon('wallet', 14), accountName(getAccount(st.account)),
        accountSelect(st.account, (v) => { st.account = v; renderChips(); })),
      !transfer && h('button', { class: `chip ${st.repeat ? 'active' : ''}`, onclick: () => { st.repeat = REPEATS[(REPEATS.indexOf(st.repeat) + 1) % REPEATS.length]; renderChips(); } },
        icon('repeat', 14), t(`repeat.${st.repeat || 'none'}`)));
  }

  function renderAll() {
    renderTitle();
    renderTop();
    renderAmount();
    renderChips();
  }

  function press(k) {
    let e = st.expr;
    if (k === 'back') e = e.slice(0, -1);
    else if (k === '+' || k === '-') {
      if (!e) return;
      if (/[+-]$/.test(e)) e = e.slice(0, -1);
      e += k;
    } else {
      const cur = e.split(/[+-]/).pop();
      if (k === '.') {
        if (cur.includes('.')) return;
        e += cur === '' ? '0.' : '.';
      } else {
        if (/\.\d{2}$/.test(cur)) return;
        if (!cur.includes('.') && cur.replace(/^0/, '').length >= MAX_INT) return;
        if (cur === '0') e = e.slice(0, -1);
        e += k;
      }
    }
    st.expr = e;
    renderAmount();
  }

  function onDone() {
    if (/\d[+-]/.test(st.expr)) {
      const v = evaluate(st.expr);
      st.expr = v > 0 ? String(v) : '';
      renderAmount();
      return;
    }
    const amount = evaluate(st.expr);
    if (!(amount > 0)) {
      toast(t('entry.amountRequired'), 'error');
      return;
    }
    const time = st.date === ymd() ? nowHm() : '';
    if (st.type === 'transfer') {
      if (!st.account || !st.toAccount || st.account === st.toAccount) {
        toast(t('transfer.same'), 'error');
        return;
      }
      addTx({ type: 'transfer', amount, account: st.account, toAccount: st.toAccount, note: st.note, date: st.date, time });
    } else {
      const [saved] = addTx({ type: st.type, category: st.category, amount, note: st.note, date: st.date, time, account: st.account, source: 'manual' });
      if (st.repeat) addRecurring(saved, st.repeat);
      if (st.account) updateSettings({ lastAccount: st.account });
    }
    toast(t(st.repeat && st.type !== 'transfer' ? 'entry.savedRepeat' : 'entry.saved'), 'success');
    sheet.close();
  }

  const key = (label, k, cls = '') => h('button', { class: `key ${cls}`, onclick: () => press(k) }, label);
  const keypad = h('div', { class: 'keypad' },
    key('7', '7'), key('8', '8'), key('9', '9'), key(icon('backspace', 22), 'back', 'key-fn'),
    key('4', '4'), key('5', '5'), key('6', '6'), key('+', '+', 'key-fn'),
    key('1', '1'), key('2', '2'), key('3', '3'), key('−', '-', 'key-fn'),
    key('.', '.'), key('0', '0'), doneKey);

  sheet.setContent([
    top,
    h('div', { class: 'entry-panel' },
      h('div', { class: 'entry-row' }, selCat, amountEl),
      chips,
      noteInput,
      keypad),
  ]);

  // 实体键盘输入
  const onKey = (e) => {
    if (document.activeElement === noteInput || document.activeElement?.tagName === 'SELECT') return;
    if (/^[0-9.+-]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') onDone();
  };
  document.addEventListener('keydown', onKey);
  const obs = new MutationObserver(() => { if (!document.body.contains(sheet.el)) { document.removeEventListener('keydown', onKey); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });

  renderAll();
  return sheet;
}
