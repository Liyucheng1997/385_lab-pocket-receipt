// 记录详情：查看完整消费信息，可切换到编辑模式修改
import { h, openSheet, toast, confirmDialog, catTile, catName, seg } from '../ui.js';
import { icon } from '../icons.js';
import { t, getLang } from '../i18n.js';
import { CATEGORIES, defaultCategory, isCategoryOfType } from '../categories.js';
import { allTx, updateTx, removeTx, settings } from '../store.js';
import { money, moneyCode, currencySymbol, parseYmd, ymd } from '../format.js';

const round2 = (n) => Math.round(n * 100) / 100;

function fullDate(dateStr) {
  return new Intl.DateTimeFormat(getLang(), { dateStyle: 'full' }).format(parseYmd(dateStr));
}

function recordedAt(ms) {
  return new Intl.DateTimeFormat(getLang(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

export function openDetail(tx) {
  let id = tx.id;
  const current = () => allTx().find((x) => x.id === id);
  const sheet = openSheet({ title: '', full: true, className: 'detail-sheet' });

  function setHeader(title, right) {
    sheet.setTitle(title);
    sheet.body.scrollTop = 0;
    const actions = sheet.el.querySelector('.sheet-actions');
    actions.querySelector('.detail-head-btn')?.remove();
    if (right) actions.prepend(right);
  }

  // ---------- 查看 ----------
  function renderView() {
    const x = current();
    if (!x) { sheet.close(); return; }
    const base = settings().currency;
    setHeader(t(x.type === 'income' ? 'detail.incomeTitle' : 'detail.expenseTitle'),
      h('button', { class: 'btn btn-ghost btn-sm detail-head-btn', onclick: renderEdit }, t('edit')));

    const row = (label, value, opts = {}) => h('div', { class: 'detail-row' },
      h('span', { class: 'detail-label' }, label),
      h('span', { class: `detail-value ${opts.muted ? 'muted' : ''} ${opts.multiline ? 'multiline' : ''}` }, value));

    const docCur = x.origCurrency || base;
    const items = x.items || [];

    sheet.setContent(h('div', { class: 'detail' },
      h('div', { class: 'detail-hero' },
        catTile(x.category, { size: 56, active: true }),
        h('div', { class: 'detail-cat' }, catName(x.category)),
        h('div', { class: `detail-amount tabular ${x.type}` }, `${x.type === 'income' ? '+' : '-'}${money(x.amount)}`),
        x.origCurrency && h('div', { class: 'detail-orig tabular' },
          moneyCode(x.origAmount, x.origCurrency),
          h('span', null, `1 ${x.origCurrency} ≈ ${x.rate} ${base}`))),

      h('div', { class: 'card detail-card' },
        row(t('detail.merchant'), x.merchant || t('detail.none'), { muted: !x.merchant }),
        row(t('detail.note'), x.note || t('detail.none'), { muted: !x.note, multiline: true }),
        row(t('detail.date'), fullDate(x.date)),
        row(t('detail.time'), x.time || t('detail.none'), { muted: !x.time }),
        row(t('detail.source'), h('span', { class: 'detail-source' }, icon(x.source === 'voice' ? 'mic' : x.source === 'scan' ? 'receipt' : 'pencil', 14), t(`source.${x.source}`))),
        row(t('detail.created'), recordedAt(x.createdAt), { muted: true })),

      items.length > 0 && h('div', { class: 'card detail-card' },
        h('div', { class: 'detail-items-head' }, h('span', null, t('detail.items')), h('span', { class: 'muted' }, t('detail.itemsN', { n: items.length }))),
        items.map((it) => h('div', { class: 'detail-item' },
          h('span', null, it.name),
          h('span', { class: `tabular ${it.amount < 0 ? 'discount' : ''}` }, moneyCode(it.amount, docCur)))),
        h('div', { class: 'detail-item total' },
          h('span', null, t('detail.total')),
          h('b', { class: 'tabular' }, moneyCode(x.origCurrency ? x.origAmount : x.amount, docCur)))),

      h('div', { class: 'detail-actions' },
        h('button', { class: 'btn btn-primary btn-lg block', onclick: renderEdit }, icon('pencil', 17), t('edit')),
        h('button', { class: 'btn btn-danger btn-lg block', onclick: onDelete }, icon('trash', 17), t('delete')))));
  }

  // ---------- 编辑 ----------
  function renderEdit() {
    const x = current();
    const base = settings().currency;
    const foreign = !!x.origCurrency;
    const st = {
      type: x.type,
      category: x.category,
      amount: String(foreign ? x.origAmount : x.amount),
      rate: String(x.rate ?? 1),
      merchant: x.merchant || '',
      note: x.note || '',
      date: x.date,
      time: x.time || '',
    };
    setHeader(t('entry.edit'), null);

    const grid = h('div', { class: 'cat-grid compact' });
    const conv = h('span', { class: 'detail-conv tabular' });
    const baseAmount = () => round2((parseFloat(st.amount) || 0) * (foreign ? parseFloat(st.rate) || 0 : 1));
    const refreshConv = () => { if (foreign) conv.textContent = t('ai.converted', { v: money(baseAmount(), base) }); };

    const renderGrid = () => grid.replaceChildren(...CATEGORIES[st.type].map((c) =>
      h('button', { class: `cat-item ${c.id === st.category ? 'active' : ''}`, onclick: () => { st.category = c.id; renderGrid(); } },
        catTile(c.id, { size: 40, active: c.id === st.category }), h('span', null, catName(c.id)))));

    const typeSeg = h('div');
    const renderSeg = () => typeSeg.replaceChildren(seg([
      { value: 'expense', label: t('expense') },
      { value: 'income', label: t('income') },
    ], st.type, (v) => {
      st.type = v;
      if (!isCategoryOfType(st.category, v)) st.category = defaultCategory(v);
      renderSeg();
      renderGrid();
    }, 'seg-wide'));

    const field = (label, control) => h('label', { class: 'edit-field' }, h('span', { class: 'edit-label' }, label), control);
    const text = (key, placeholder, max = 80) => h('input', {
      class: 'edit-input', value: st[key], placeholder, maxLength: max,
      oninput: (e) => (st[key] = e.target.value),
    });

    const amountInput = h('input', {
      class: 'edit-input edit-amount tabular', inputMode: 'decimal', value: st.amount,
      oninput: (e) => { st.amount = e.target.value.replace(/[^\d.]/g, ''); refreshConv(); },
    });

    function save() {
      const amount = baseAmount();
      if (!(amount > 0) || !(parseFloat(st.amount) > 0)) { toast(t('entry.amountRequired'), 'error'); return; }
      updateTx(id, {
        type: st.type,
        category: st.category,
        amount,
        merchant: st.merchant,
        note: st.note,
        date: st.date || x.date,
        time: st.time,
        ...(foreign ? { origAmount: parseFloat(st.amount), rate: parseFloat(st.rate) || 0 } : {}),
      });
      toast(t('entry.updated'), 'success');
      renderView();
    }

    renderSeg();
    renderGrid();
    refreshConv();
    sheet.setContent(h('div', { class: 'detail edit' },
      typeSeg,
      h('div', { class: 'field-label' }, t('budget.category')),
      grid,
      h('div', { class: 'card edit-card' },
        field(foreign ? t('detail.origAmount') : t('detail.amount'),
          h('span', { class: 'edit-amount-wrap' }, h('span', { class: 'muted' }, foreign ? x.origCurrency : currencySymbol()), amountInput)),
        foreign && field(t('detail.rate'),
          h('span', { class: 'edit-amount-wrap' },
            h('span', { class: 'muted' }, `1 ${x.origCurrency} ≈`),
            h('input', { class: 'edit-input edit-rate tabular', inputMode: 'decimal', value: st.rate, oninput: (e) => { st.rate = e.target.value.replace(/[^\d.]/g, ''); refreshConv(); } }),
            h('span', { class: 'muted' }, base))),
        foreign && h('div', { class: 'edit-conv-row' }, conv),
        field(t('detail.merchant'), text('merchant', t('detail.none'))),
        field(t('detail.note'), text('note', t('entry.note'), 120)),
        field(t('detail.date'), h('input', { type: 'date', class: 'edit-input', value: st.date, max: ymd(), onchange: (e) => (st.date = e.target.value) })),
        field(t('detail.time'), h('input', { type: 'time', class: 'edit-input', value: st.time, onchange: (e) => (st.time = e.target.value) }))),
      h('div', { class: 'detail-actions' },
        h('button', { class: 'btn btn-primary btn-lg block', onclick: save }, t('save')),
        h('button', { class: 'btn btn-lg block', onclick: renderView }, t('cancel')))));
  }

  async function onDelete() {
    if (await confirmDialog({ title: t('entry.deleteConfirm'), okText: t('delete'), danger: true, iconName: 'trash' })) {
      removeTx(id);
      toast(t('entry.deleted'));
      sheet.close();
    }
  }

  renderView();
  return sheet;
}
