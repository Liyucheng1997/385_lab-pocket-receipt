// 预算：月总预算环 + 分类预算
import { h, openSheet, toast, catTile, catName } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { CATEGORIES } from '../categories.js';
import { txBetween, sum, settings, updateSettings } from '../store.js';
import { money, currencySymbol, monthRange } from '../format.js';

function ring(ratio, over) {
  const R = 64;
  const C = 2 * Math.PI * R;
  const p = Math.min(1, Math.max(0, ratio));
  return h('div', {
    class: 'ring',
    html: `<svg width="156" height="156" viewBox="0 0 156 156"><circle cx="78" cy="78" r="${R}" class="ring-track"/><circle cx="78" cy="78" r="${R}" class="ring-val ${over ? 'over' : ''}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}" transform="rotate(-90 78 78)"/></svg>`,
  });
}

function amountSheet({ title, value, onSave, onRemove, category }) {
  const st = { category };
  const sheet = openSheet({ title });
  const input = h('input', { class: 'input amount-input tabular', inputMode: 'decimal', placeholder: '0', value: value ? String(value) : '' });
  const grid = category !== undefined ? h('div', { class: 'cat-grid compact' }) : null;
  const renderGrid = () => grid?.replaceChildren(...CATEGORIES.expense.map((c) =>
    h('button', { class: `cat-item ${c.id === st.category ? 'active' : ''}`, onclick: () => { st.category = c.id; renderGrid(); } },
      catTile(c.id, { size: 40, active: c.id === st.category }), h('span', null, catName(c.id)))));
  renderGrid();
  const save = () => {
    const v = Math.round((parseFloat(input.value) || 0) * 100) / 100;
    onSave(v, st.category);
    toast(t('budget.saved'), 'success');
    sheet.close();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  sheet.setContent(h('div', { class: 'form budget-form' },
    grid && h('div', { class: 'field-label' }, t('budget.category')),
    grid,
    h('div', { class: 'field-label' }, t('budget.amount')),
    h('div', { class: 'amount-field' }, h('span', null, currencySymbol()), input),
    h('button', { class: 'btn btn-primary btn-lg block', onclick: save }, t('save')),
    onRemove && h('button', { class: 'btn btn-danger btn-lg block', onclick: () => { onRemove(); sheet.close(); } }, t('budget.remove'))));
  setTimeout(() => input.focus(), 250);
}

export function renderBudget(root) {
  const now = new Date();
  const [from, to] = monthRange(now.getFullYear(), now.getMonth());
  const list = txBetween(from, to);
  const spent = sum(list, 'expense');
  const { budget, catBudgets } = settings();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  const left = budget - spent;

  const editTotal = () => amountSheet({ title: t('budget.month'), value: budget, onSave: (v) => updateSettings({ budget: v }) });

  const main = budget > 0
    ? h('div', { class: 'card budget-main' },
        h('div', { class: 'budget-head' },
          h('div', { class: 'card-title' }, t('budget.month')),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: editTotal }, t('edit'))),
        h('div', { class: 'budget-body' },
          h('div', { class: 'ring-wrap' },
            ring(spent / budget, left < 0),
            h('div', { class: 'ring-center' },
              h('span', null, left < 0 ? t('budget.over') : t('budget.left')),
              h('b', { class: `tabular ${left < 0 ? 'over' : ''}` }, money(Math.abs(left))),
              h('small', { class: 'tabular' }, `${Math.round((spent / budget) * 100)}%`))),
          h('div', { class: 'budget-facts' },
            h('div', null, h('span', null, t('budget.month')), h('b', { class: 'tabular' }, money(budget))),
            h('div', null, h('span', null, t('budget.spent')), h('b', { class: 'tabular' }, money(spent))),
            h('div', null, h('span', null, t('budget.daysLeft', { n: daysLeft })), h('b', { class: 'tabular' }, left > 0 ? t('budget.daily', { v: money(left / daysLeft) }) : '—')))))
    : h('div', { class: 'card budget-empty' },
        h('div', { class: 'ai-hero-ico' }, icon('target', 28)),
        h('div', { class: 'card-title' }, t('budget.notSet')),
        h('button', { class: 'btn btn-primary', onclick: editTotal }, t('budget.set')));

  const catSpent = (id) => sum(list.filter((tx) => tx.category === id), 'expense');
  const catRows = Object.entries(catBudgets || {}).filter(([, v]) => v > 0).map(([id, v]) => {
    const s = catSpent(id);
    const over = s > v;
    return h('button', {
      class: 'rank-row',
      onclick: () => amountSheet({
        title: catName(id), value: v,
        onSave: (nv) => updateSettings({ catBudgets: { ...settings().catBudgets, [id]: nv } }),
        onRemove: () => { const c = { ...settings().catBudgets }; delete c[id]; updateSettings({ catBudgets: c }); },
      }),
    },
      catTile(id, { size: 36 }),
      h('div', { class: 'rank-main' },
        h('div', { class: 'rank-line' },
          h('span', null, catName(id)),
          h('b', { class: `tabular ${over ? 'over' : ''}` }, `${money(s)} / ${money(v)}`)),
        h('div', { class: 'bar' }, h('i', { class: over ? 'over' : '', style: { width: `${Math.min(100, (s / v) * 100)}%` } }))));
  });

  root.replaceChildren(
    h('header', { class: 'page-head' }, h('h1', { class: 'page-title' }, t('budget.title'))),
    main,
    h('div', { class: 'card rank-card' },
      h('div', { class: 'card-title' }, t('budget.categories')),
      catRows.length ? catRows : h('div', { class: 'empty small' }, t('budget.catEmpty')),
      h('button', {
        class: 'btn btn-ghost block add-cat-budget',
        onclick: () => amountSheet({
          title: t('budget.addCategory'), category: 'food',
          onSave: (v, id) => updateSettings({ catBudgets: { ...settings().catBudgets, [id]: v } }),
        }),
      }, icon('plus', 16, 2), t('budget.addCategory'))),
  );
}
