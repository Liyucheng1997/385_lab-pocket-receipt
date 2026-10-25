// 明细：月度概览 + 快捷入口 + 按日分组的记录
import { h, openSheet, catTile, catName } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { allTx, txBetween, sum, sortTx, settings } from '../store.js';
import { money, moneyCode, monthRange, monthLabel, dayLabel, ymd, addDays } from '../format.js';
import { openEntry } from '../sheets/entry.js';
import { openDetail } from '../sheets/detail.js';
import { openScan, openVoice } from '../sheets/ai.js';

const now = new Date();
const view = { y: now.getFullYear(), m: now.getMonth() };

export function txRow(tx) {
  const title = catName(tx.category);
  const sub = [tx.merchant, tx.note].filter(Boolean).join(' · ');
  return h('button', { class: 'tx-row', onclick: () => openDetail(tx) },
    catTile(tx.category, { size: 38 }),
    h('div', { class: 'tx-main' },
      h('div', { class: 'tx-title' }, title, tx.source !== 'manual' && h('span', { class: 'tx-badge', title: t(`source.${tx.source}`) }, icon(tx.source === 'voice' ? 'mic' : 'receipt', 11, 2))),
      sub && h('div', { class: 'tx-sub' }, sub)),
    h('div', { class: 'tx-right' },
      h('div', { class: `tx-amount tabular ${tx.type}` }, `${tx.type === 'income' ? '+' : '-'}${money(tx.amount)}`),
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
        new Intl.DateTimeFormat(document.documentElement.lang, { month: 'short' }).format(new Date(year, m, 1)));
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
    const hits = allTx().filter((tx) => [tx.note, tx.merchant, catName(tx.category), String(tx.amount)].some((s) => s && s.toLowerCase().includes(q)));
    results.replaceChildren(...(hits.length ? groupedList(hits.slice(0, 200)) : [h('div', { class: 'empty small' }, t('search.empty'))]));
  }
  sheet.setContent([h('div', { class: 'search-bar' }, icon('search', 18), input), results]);
  setTimeout(() => input.focus(), 250);
}

export function renderHome(root, rerender) {
  const [from, to] = monthRange(view.y, view.m);
  const list = txBetween(from, to);
  const exp = sum(list, 'expense');
  const inc = sum(list, 'income');
  const budget = settings().budget;
  const isCurrent = view.y === now.getFullYear() && view.m === now.getMonth();

  const budgetBar = budget > 0 && isCurrent
    ? h('div', { class: 'sum-budget' },
        h('div', { class: 'bar' }, h('i', { class: exp > budget ? 'over' : '', style: { width: `${Math.min(100, (exp / budget) * 100)}%` } })),
        h('span', { class: exp > budget ? 'over' : '' }, exp > budget ? t('home.budgetOver', { v: money(exp - budget) }) : t('home.budgetLeft', { v: money(budget - exp) })))
    : null;

  root.replaceChildren(
    h('header', { class: 'page-head' },
      h('button', { class: 'month-btn', onclick: () => openMonthPicker(rerender) }, monthLabel(view.y, view.m), icon('down', 16, 2)),
      h('button', { class: 'tb-round', 'aria-label': t('search'), onclick: openSearch }, icon('search', 18))),
    h('div', { class: 'card summary' },
      h('div', { class: 'sum-label' }, isCurrent ? t('home.monthExpense') : `${t('expense')} · ${monthLabel(view.y, view.m)}`),
      h('div', { class: 'sum-big tabular' }, money(exp)),
      h('div', { class: 'sum-row' },
        h('div', null, h('span', { class: 'muted' }, t('income')), h('b', { class: 'tabular' }, money(inc))),
        h('div', null, h('span', { class: 'muted' }, t('balance')), h('b', { class: 'tabular' }, money(inc - exp)))),
      budgetBar),
    h('div', { class: 'quick' },
      h('button', { class: 'quick-btn', onclick: () => openEntry() }, h('span', { class: 'quick-ico' }, icon('pencil', 20)), t('home.manual')),
      h('button', { class: 'quick-btn', onclick: openScan }, h('span', { class: 'quick-ico' }, icon('receipt', 20)), t('home.scan')),
      h('button', { class: 'quick-btn', onclick: openVoice }, h('span', { class: 'quick-ico' }, icon('mic', 20)), t('home.voice'))),
    ...(list.length
      ? groupedList(list)
      : [h('div', { class: 'empty' }, icon('list', 34, 1.4), h('div', null, t('home.empty')), h('div', { class: 'empty-hint' }, t('home.emptyHint')))]),
  );
}
