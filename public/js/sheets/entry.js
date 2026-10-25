// 记一笔 / 编辑记录：分类网格 + 数字键盘
import { h, openSheet, toast, confirmDialog, catTile, catName, seg } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { CATEGORIES, defaultCategory, isCategoryOfType } from '../categories.js';
import { addTx, updateTx, removeTx } from '../store.js';
import { money, moneyCode, currencySymbol, ymd, nowHm, shortDate } from '../format.js';
import { openScan, openVoice } from './ai.js';

const MAX_INT = 9;

function evaluate(expr) {
  const parts = expr.match(/[+-]?[^+-]+/g) || [];
  const total = parts.reduce((s, p) => s + (parseFloat(p) || 0), 0);
  return Math.round(total * 100) / 100;
}

export function openEntry(existing) {
  const editing = !!existing;
  const st = {
    type: existing?.type || 'expense',
    category: existing?.category || defaultCategory('expense'),
    expr: existing ? String(existing.amount) : '',
    note: existing?.note || '',
    date: existing?.date || ymd(),
  };
  if (existing && !st.note && existing.merchant) st.note = existing.merchant;

  const sheet = openSheet({
    title: '',
    full: true,
    className: 'entry-sheet',
    headerRight: editing
      ? h('button', { class: 'icon-btn danger', 'aria-label': t('delete'), onclick: onDelete }, icon('trash', 18))
      : [
          h('button', { class: 'icon-btn', 'aria-label': t('home.scan'), onclick: () => { sheet.close(); openScan(); } }, icon('receipt', 19)),
          h('button', { class: 'icon-btn', 'aria-label': t('home.voice'), onclick: () => { sheet.close(); openVoice(); } }, icon('mic', 19)),
        ],
  });

  const titleEl = sheet.el.querySelector('.sheet-title');
  const grid = h('div', { class: 'cat-grid' });
  const amountEl = h('div', { class: 'entry-amount tabular' });
  const selCat = h('div', { class: 'entry-cat' });
  const noteInput = h('input', {
    class: 'entry-note', placeholder: t('entry.note'), maxLength: 60, value: st.note,
    oninput: (e) => (st.note = e.target.value),
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
  });
  const dateInput = h('input', {
    type: 'date', class: 'sr-only', value: st.date, max: ymd(),
    onchange: (e) => { if (e.target.value) { st.date = e.target.value; renderDate(); } },
  });
  const dateLabel = h('span');
  const dateChip = h('button', { class: 'chip entry-date', onclick: () => (dateInput.showPicker ? dateInput.showPicker() : dateInput.click()) }, icon('calendar', 14), dateLabel, dateInput);
  const doneKey = h('button', { class: 'key key-done', onclick: onDone });

  function renderTitle() {
    titleEl.replaceChildren(seg([
      { value: 'expense', label: t('expense') },
      { value: 'income', label: t('income') },
    ], st.type, (v) => {
      st.type = v;
      if (!isCategoryOfType(st.category, v)) st.category = defaultCategory(v);
      renderTitle();
      renderGrid();
      renderAmount();
    }));
  }

  function renderGrid() {
    grid.replaceChildren(...CATEGORIES[st.type].map((c) =>
      h('button', { class: `cat-item ${c.id === st.category ? 'active' : ''}`, onclick: () => { st.category = c.id; renderGrid(); renderAmount(); } },
        catTile(c.id, { size: 46, active: c.id === st.category }),
        h('span', null, catName(c.id)))));
  }

  function renderAmount() {
    selCat.replaceChildren(catTile(st.category, { size: 30, active: true }), h('span', null, catName(st.category)));
    amountEl.classList.toggle('income', st.type === 'income');
    amountEl.textContent = st.expr ? `${currencySymbol()}${st.expr}` : money(0);
    const hasOp = /\d[+-]/.test(st.expr);
    doneKey.textContent = hasOp ? '=' : t('entry.done');
  }

  function renderDate() {
    const today = ymd();
    dateLabel.textContent = st.date === today ? t('today') : shortDate(st.date);
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
    const data = { type: st.type, category: st.category, amount, note: st.note, date: st.date };
    if (editing) {
      if (amount !== existing.amount) Object.assign(data, { origCurrency: undefined, origAmount: undefined, rate: undefined });
      updateTx(existing.id, data);
      toast(t('entry.updated'), 'success');
    } else {
      addTx({ ...data, time: st.date === ymd() ? nowHm() : '', source: 'manual' });
      toast(t('entry.saved'), 'success');
    }
    sheet.close();
  }

  async function onDelete() {
    if (await confirmDialog({ title: t('entry.deleteConfirm'), okText: t('delete'), danger: true, iconName: 'trash' })) {
      removeTx(existing.id);
      toast(t('entry.deleted'));
      sheet.close();
    }
  }

  const key = (label, k, cls = '') => h('button', { class: `key ${cls}`, onclick: () => press(k) }, label);
  const keypad = h('div', { class: 'keypad' },
    key('7', '7'), key('8', '8'), key('9', '9'), key(icon('backspace', 22), 'back', 'key-fn'),
    key('4', '4'), key('5', '5'), key('6', '6'), key('+', '+', 'key-fn'),
    key('1', '1'), key('2', '2'), key('3', '3'), key('−', '-', 'key-fn'),
    key('.', '.'), key('0', '0'), doneKey);

  const orig = existing?.origCurrency
    ? h('div', { class: 'entry-orig' }, t('entry.orig', { v: moneyCode(existing.origAmount, existing.origCurrency) }))
    : null;

  sheet.setContent([
    grid,
    h('div', { class: 'entry-panel' },
      h('div', { class: 'entry-row' }, selCat, amountEl),
      orig,
      h('div', { class: 'entry-row' }, dateChip, noteInput),
      keypad),
  ]);

  // 实体键盘输入
  const onKey = (e) => {
    if (document.activeElement === noteInput) return;
    if (/^[0-9.+-]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') onDone();
  };
  document.addEventListener('keydown', onKey);
  const obs = new MutationObserver(() => { if (!document.body.contains(sheet.el)) { document.removeEventListener('keydown', onKey); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });

  renderTitle();
  renderGrid();
  renderAmount();
  renderDate();
  return sheet;
}
