// 资产：净资产概览 + 各账户余额 + 转账 + 预算入口
import { h, openSheet, toast, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { allTx, txBetween, sum, settings, updateSettings, uid } from '../store.js';
import { money, currencySymbol, monthRange } from '../format.js';
import { ACCOUNT_KINDS, accounts, accountName, acctTile, balances } from '../accounts.js';
import { groupedList } from './home.js';
import { openEntry } from '../sheets/entry.js';
import { openBudget } from './budget.js';

const parseAmount = (s) => Math.round((parseFloat(String(s).replace(/[^\d.-]/g, '')) || 0) * 100) / 100;

function openAccount(acct) {
  const isNew = !acct;
  const st = { kind: acct?.kind || 'bank', name: acct?.name || '', init: acct ? String(acct.init || '') : '' };
  const sheet = openSheet({ title: isNew ? t('acct.add') : accountName(acct), full: !isNew });
  const kinds = h('div', { class: 'chips-row' });
  const nameInput = h('input', { class: 'edit-input', value: st.name, maxLength: 20, oninput: (e) => (st.name = e.target.value) });
  const renderKinds = () => {
    kinds.replaceChildren(...Object.keys(ACCOUNT_KINDS).map((k) =>
      h('button', { class: `chip ${k === st.kind ? 'active' : ''}`, onclick: () => { st.kind = k; renderKinds(); } }, t(`acct.${k}`))));
    nameInput.placeholder = t(`acct.${st.kind}`);
  };
  renderKinds();

  function save() {
    const data = { kind: st.kind, name: st.name.trim(), init: parseAmount(st.init) };
    const list = accounts();
    updateSettings({ accounts: isNew ? [...list, { id: uid(), ...data }] : list.map((a) => (a.id === acct.id ? { ...a, ...data } : a)) });
    toast(t('acct.saved'), 'success');
    sheet.close();
  }

  async function remove() {
    if (!(await confirmDialog({ title: t('acct.deleteConfirm', { n: accountName(acct) }), message: t('acct.deleteNote'), okText: t('delete'), danger: true, iconName: 'trash' }))) return;
    updateSettings({ accounts: accounts().filter((a) => a.id !== acct.id) });
    sheet.close();
  }

  const field = (label, control) => h('label', { class: 'edit-field' }, h('span', { class: 'edit-label' }, label), control);
  const records = isNew ? [] : allTx().filter((x) => x.account === acct.id || x.toAccount === acct.id);

  sheet.setContent(h('div', { class: 'detail' },
    h('div', { class: 'field-label' }, t('acct.kind')),
    kinds,
    h('div', { class: 'card edit-card' },
      field(t('acct.name'), nameInput),
      field(t('acct.init'), h('span', { class: 'edit-amount-wrap' }, h('span', { class: 'muted' }, currencySymbol()),
        h('input', { class: 'edit-input edit-amount tabular', inputMode: 'decimal', placeholder: '0', value: st.init, oninput: (e) => (st.init = e.target.value) })))),
    h('div', { class: 'acct-note' }, t('acct.initNote')),
    h('div', { class: 'detail-actions' },
      h('button', { class: 'btn btn-primary btn-lg', onclick: save }, t('save')),
      !isNew && accounts().length > 1 && h('button', { class: 'btn btn-danger btn-lg', 'aria-label': t('delete'), onclick: remove }, icon('trash', 17))),
    !isNew && h('div', { class: 'field-label acct-records' }, t('acct.records', { n: records.length })),
    !isNew && (records.length ? h('div', { class: 'cat-detail' }, groupedList(records.slice(0, 100))) : h('div', { class: 'empty small' }, t('acct.noRecords')))));
}

export function renderAssets(root) {
  const bal = balances();
  const list = accounts();
  const values = list.map((a) => bal.get(a.id) || 0);
  const assets = values.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const debt = values.filter((v) => v < 0).reduce((a, b) => a + b, 0);

  const now = new Date();
  const [from, to] = monthRange(now.getFullYear(), now.getMonth());
  const spent = sum(txBetween(from, to), 'expense');
  const budget = settings().budget;

  root.replaceChildren(
    h('header', { class: 'page-head' },
      h('h1', { class: 'page-title' }, t('tab.assets')),
      h('button', { class: 'btn btn-soft', onclick: () => openEntry({ type: 'transfer' }) }, icon('swap', 15, 2.2), t('transfer'))),
    h('div', { class: 'hero' },
      h('div', { class: 'hero-label' }, t('assets.net')),
      h('div', { class: 'hero-big tabular' }, money(assets + debt)),
      h('div', { class: 'hero-row' },
        h('div', null, h('span', null, t('assets.total')), h('b', { class: 'tabular' }, money(assets))),
        h('div', null, h('span', null, t('assets.debt')), h('b', { class: 'tabular' }, money(Math.abs(debt)))))),
    h('div', { class: 'group-title' }, t('assets.accounts')),
    h('div', { class: 'card cells' },
      list.map((a) => {
        const v = bal.get(a.id) || 0;
        return h('button', { class: 'cell acct-row', onclick: () => openAccount(a) },
          acctTile(a, 38),
          h('span', { class: 'cell-label' }, accountName(a), a.name && h('small', null, t(`acct.${a.kind}`))),
          h('b', { class: `tabular ${v < 0 ? 'neg' : ''}` }, money(v)),
          h('span', { class: 'cell-chev' }, icon('right', 16)));
      }),
      h('button', { class: 'cell acct-add', onclick: () => openAccount(null) }, icon('plus', 16, 2.2), t('acct.add'))),
    h('div', { class: 'group-title' }, t('budget.title')),
    h('button', { class: 'card budget-mini', onclick: openBudget },
      h('div', { class: 'budget-mini-line' },
        h('span', null, t('budget.month')),
        h('b', { class: 'tabular' }, budget > 0 ? `${money(spent)} / ${money(budget)}` : t('budget.set')),
        h('span', { class: 'cell-chev' }, icon('right', 16))),
      budget > 0 && h('div', { class: 'bar' }, h('i', { class: spent > budget ? 'over' : '', style: { width: `${Math.min(100, (spent / budget) * 100)}%` } }))),
  );
}
