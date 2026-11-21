// 明细：月度概览 + AI 记账入口 + 列表 / 日历两种视图
import { h, mount, openSheet, catTile, catName } from '../ui.js';
import { icon } from '../icons.js';
import { t, getLang } from '../i18n.js';
import { allTx, txBetween, sum, sortTx, settings } from '../store.js';
import { money, moneyCode, numCompact, monthRange, monthLabel, dayLabel, ymd, addDays, weekdayShort } from '../format.js';
import { accountNameById } from '../accounts.js';
import { openEntry } from '../sheets/entry.js';
import { openDetail } from '../sheets/detail.js';
import { openScan, openVoice } from '../sheets/ai.js';
import { openBudget } from './budget.js';

const now = new Date();
const view = { y: now.getFullYear(), m: now.getMonth(), mode: 'list', day: ymd() };

const SOURCE_ICON = { scan: 'scan', voice: 'mic', auto: 'repeat' };

export function txRow(tx) {
  const cat = catName(tx.category);
  const transfer = tx.type === 'transfer';
  const title = transfer ? cat : tx.merchant || tx.note || cat;
  const sub = transfer
    ? [`${accountNameById(tx.account) || '—'} → ${accountNameById(tx.toAccount) || '—'}`, tx.note]
    : [title !== cat && cat, tx.merchant && tx.note, accountNameById(tx.account)];
  const sign = transfer ? '' : tx.type === 'income' ? '+' : '-';
  return h('button', { class: 'tx-row', onclick: () => openDetail(tx) },
    catTile(tx.category, { size: 40 }),
    h('div', { class: 'tx-main' },
      h('div', { class: 'tx-title' }, h('span', null, title),
        SOURCE_ICON[tx.source] && h('span', { class: `tx-badge ${tx.source}`, title: t(`source.${tx.source}`) }, icon(SOURCE_ICON[tx.source], 11, 2.2))),
      h('div', { class: 'tx-sub' }, sub.filter(Boolean).join(' · '))),
    h('div', { class: 'tx-right' },
      h('div', { class: `tx-amount tabular ${tx.type}` }, `${sign}${money(tx.amount)}`),
      tx.origCurrency && h('div', { class: 'tx-orig tabular' }, moneyCode(tx.origAmount, tx.origCurrency))));
}

export function groupedList(list) {
  const groups = new Map();
  for (const tx of sortTx(list)) {
    if (!groups.has(tx.date)) groups.set(tx.date, []);
    groups.get(tx.date).push(tx);
  }
  const today = ymd();
  const yest = ymd(addDays(new Date(), -1));
  return [...groups].map(([date, items]) => {
    const exp = sum(items, 'expense');
    const inc = sum(items, 'income');
    const label = date === today ? t('today') : date === yest ? t('yesterday') : dayLabel(date);
    return h('section', { class: 'day-group' },
      h('div', { class: 'day-head' },
        h('span', null, label),
        h('span', { class: 'day-sum tabular' },
          exp > 0 && t('day.expense', { v: money(exp) }),
          exp > 0 && inc > 0 && '  ',
          inc > 0 && t('day.income', { v: money(inc) }))),
      h('div', { class: 'card tx-card' }, items.map(txRow)));
  });
}

function openMonthPicker(onPick) {
  let year = view.y;
  const sheet = openSheet({ title: t('month.pick') });
  const render = () => sheet.setContent(h('div', { class: 'month-picker' },
    h('div', { class: 'mp-year' },
      h('button', { class: 'icon-btn', onclick: () => { year--; render(); } }, icon('left', 18)),
      h('span', { class: 'tabular' }, String(year)),
      h('button', { class: 'icon-btn', disabled: year >= now.getFullYear(), onclick: () => { year++; render(); } }, icon('right', 18))),
    h('div', { class: 'mp-grid' }, Array.from({ length: 12 }, (_, m) => {
      const future = year > now.getFullYear() || (year === now.getFullYear() && m > now.getMonth());
      const active = year === view.y && m === view.m;
      return h('button', { class: `mp-cell ${active ? 'active' : ''}`, disabled: future, onclick: () => { view.y = year; view.m = m; sheet.close(); onPick(); } },
        new Intl.DateTimeFormat(getLang(), { month: 'short' }).format(new Date(year, m, 1)));
    }))));
  render();
}

function openSearch() {
  const sheet = openSheet({ title: t('search'), full: true });
  const results = h('div', { class: 'search-results' });
  const input = h('input', { class: 'input search-input', type: 'search', placeholder: t('search.placeholder'), oninput: run });
  function run() {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.replaceChildren(); return; }
    const hits = allTx().filter((tx) => [tx.note, tx.merchant, catName(tx.category), accountNameById(tx.account), String(tx.amount), ...(tx.items || []).map((i) => i.name)]
      .some((s) => s && s.toLowerCase().includes(q)));
    const total = sum(hits, 'expense');
    results.replaceChildren(...(hits.length
      ? [h('div', { class: 'search-sum' }, t('search.sum', { n: hits.length, v: money(total) })), ...groupedList(hits.slice(0, 200))]
      : [h('div', { class: 'empty small' }, t('search.empty'))]));
  }
  sheet.setContent([h('div', { class: 'search-bar' }, icon('search', 18), input), results]);
  setTimeout(() => input.focus(), 250);
}

// 月历：每天显示支出，点某一天看当天的记录
function calendar(list, rerender) {
  const first = new Date(view.y, view.m, 1);
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const byDay = new Map();
  for (const tx of list) {
    const d = byDay.get(tx.date) || { exp: 0, inc: 0 };
    if (tx.type === 'expense') d.exp += tx.amount;
    else if (tx.type === 'income') d.inc += tx.amount;
    byDay.set(tx.date, d);
  }
  const today = ymd();
  const monday = addDays(new Date(2024, 0, 1), 0); // 2024-01-01 是周一
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('span'));
  for (let d = 1; d <= days; d++) {
    const key = ymd(new Date(view.y, view.m, d));
    const v = byDay.get(key);
    cells.push(h('button', {
      class: `cal-cell ${key === today ? 'today' : ''} ${key === view.day ? 'sel' : ''}`,
      disabled: key > today,
      onclick: () => { view.day = key; rerender(); },
    },
      h('b', null, String(d)),
      h('span', { class: 'cal-exp tabular' }, v?.exp ? `-${numCompact(v.exp)}` : ''),
      h('span', { class: 'cal-inc tabular' }, v?.inc ? `+${numCompact(v.inc)}` : '')));
  }
  const dayList = list.filter((tx) => tx.date === view.day);
  const inMonth = view.day >= ymd(first) && view.day <= ymd(new Date(view.y, view.m, days));
  return [
    h('div', { class: 'card cal' },
      h('div', { class: 'cal-week' }, Array.from({ length: 7 }, (_, i) => h('span', null, weekdayShort(addDays(monday, i))))),
      h('div', { class: 'cal-grid' }, cells)),
    ...(dayList.length
      ? groupedList(dayList)
      : [h('div', { class: 'empty small' },
          inMonth ? t('cal.empty', { d: dayLabel(view.day) }) : t('cal.pick'),
          inMonth && h('button', { class: 'btn btn-soft', onclick: () => openEntry({ date: view.day }) }, icon('plus', 15, 2.2), t('cal.add')))]),
  ];
}

export function renderHome(root, rerender) {
  const [from, to] = monthRange(view.y, view.m);
  const list = txBetween(from, to);
  const exp = sum(list, 'expense');
  const inc = sum(list, 'income');
  const budget = settings().budget;
  const isCurrent = view.y === now.getFullYear() && view.m === now.getMonth();
  const todayExp = sum(list.filter((tx) => tx.date === ymd()), 'expense');
  const over = exp > budget;

  const budgetBar = isCurrent && (budget > 0
    ? h('button', { class: 'hero-budget', onclick: openBudget },
        h('div', { class: 'hero-budget-line' },
          h('span', null, over ? t('home.budgetOver', { v: money(exp - budget) }) : t('home.budgetLeft', { v: money(budget - exp) })),
          h('span', { class: 'tabular' }, `${Math.round((exp / budget) * 100)}%`)),
        h('div', { class: 'bar' }, h('i', { class: over ? 'over' : '', style: { width: `${Math.min(100, (exp / budget) * 100)}%` } })))
    : h('button', { class: 'hero-budget-set', onclick: openBudget }, icon('target', 14, 2), t('budget.set'), icon('right', 14, 2)));

  const setMode = (mode) => { view.mode = mode; if (isCurrent) view.day = ymd(); rerender(); };

  mount(root,
    h('header', { class: 'page-head' },
      h('button', { class: 'month-btn', onclick: () => openMonthPicker(rerender) }, monthLabel(view.y, view.m), icon('down', 16, 2.4)),
      h('div', { class: 'head-actions' },
        h('button', { class: `tb-round ${view.mode === 'calendar' ? 'on' : ''}`, 'aria-label': t('cal.title'), onclick: () => setMode(view.mode === 'calendar' ? 'list' : 'calendar') }, icon(view.mode === 'calendar' ? 'list' : 'calendar', 18)),
        h('button', { class: 'tb-round', 'aria-label': t('search'), onclick: openSearch }, icon('search', 18)))),
    h('div', { class: 'hero' },
      h('div', { class: 'hero-label' }, isCurrent ? t('home.monthExpense') : `${monthLabel(view.y, view.m)} · ${t('expense')}`),
      h('div', { class: 'hero-big tabular' }, money(exp)),
      h('div', { class: 'hero-row' },
        h('div', null, h('span', null, t('income')), h('b', { class: 'tabular' }, money(inc))),
        h('div', null, h('span', null, t('balance')), h('b', { class: 'tabular' }, money(inc - exp))),
        isCurrent && h('div', null, h('span', null, t('home.today')), h('b', { class: 'tabular' }, money(todayExp)))),
      budgetBar),
    h('div', { class: 'card ai-card' },
      h('button', { class: 'ai-main', onclick: () => openScan({ start: 'camera' }) },
        h('span', { class: 'ai-main-ico' }, icon('camera', 24, 2)),
        h('span', { class: 'ai-main-text' }, h('b', null, t('home.snap')), h('small', null, t('home.snapHint'))),
        h('span', { class: 'ai-tag' }, icon('sparkles', 12, 2), 'AI')),
      h('div', { class: 'ai-subs' },
        h('button', { onclick: () => openScan({ start: 'pick' }) }, icon('image', 18), t('home.album')),
        h('button', { onclick: () => openVoice() }, icon('mic', 18), t('home.voice')),
        h('button', { onclick: () => openEntry() }, icon('pencil', 18), t('home.manual')))),
    ...(view.mode === 'calendar'
      ? calendar(list, rerender)
      : list.length
        ? groupedList(list)
        : [h('div', { class: 'empty' }, h('div', { class: 'empty-ico' }, icon('receipt', 30, 1.6)), h('div', null, t('home.empty')), h('div', { class: 'empty-hint' }, t('home.emptyHint')))]),
  );
}
