// 记录详情：查看完整消费信息（含小票照片、逐项明细），可切换到编辑模式修改
import { h, openSheet, toast, confirmDialog, catTile, catName, seg, openImage } from '../ui.js';
import { icon } from '../icons.js';
import { t, getLang } from '../i18n.js';
import { CATEGORIES, defaultCategory, isCategoryOfType } from '../categories.js';
import { allTx, addTx, updateTx, removeTx, settings } from '../store.js';
import { money, moneyCode, currencySymbol, parseYmd, ymd, nowHm } from '../format.js';
import { getAccount, accountName, accountNameById, accountSelect } from '../accounts.js';
import { photoUrl } from '../photos.js';

const round2 = (n) => Math.round(n * 100) / 100;
const SOURCE_ICON = { scan: 'scan', voice: 'mic', auto: 'repeat', manual: 'pencil' };

function fullDate(dateStr) {
  return new Intl.DateTimeFormat(getLang(), { dateStyle: 'full' }).format(parseYmd(dateStr));
}

function recordedAt(ms) {
  return new Intl.DateTimeFormat(getLang(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

function photoStrip(ids) {
  const strip = h('div', { class: 'photo-strip' });
  ids.forEach(async (id) => {
    const url = await photoUrl(id);
    if (url) strip.append(h('button', { class: 'photo', onclick: () => openImage(url) }, h('img', { src: url, alt: '' })));
  });
  return strip;
}

export function openDetail(tx) {
  const id = tx.id;
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
    const transfer = x.type === 'transfer';
    setHeader(t(`detail.${x.type}Title`),
      h('button', { class: 'btn btn-ghost btn-sm detail-head-btn', onclick: renderEdit }, t('edit')));

    const row = (label, value, opts = {}) => h('div', { class: 'detail-row' },
      h('span', { class: 'detail-label' }, label),
      h('span', { class: `detail-value ${opts.muted ? 'muted' : ''} ${opts.multiline ? 'multiline' : ''}` }, value));

    const docCur = x.origCurrency || base;
    const items = x.items || [];
    const acct = accountNameById(x.account);

    sheet.setContent(h('div', { class: 'detail' },
      h('div', { class: 'detail-hero' },
        catTile(x.category, { size: 60, active: true }),
        h('div', { class: 'detail-cat' }, catName(x.category)),
        h('div', { class: `detail-amount tabular ${x.type}` }, `${transfer ? '' : x.type === 'income' ? '+' : '-'}${money(x.amount)}`),
        x.origCurrency && h('div', { class: 'detail-orig tabular' },
          moneyCode(x.origAmount, x.origCurrency),
          h('span', null, `1 ${x.origCurrency} ≈ ${x.rate} ${base}`))),

      x.photos?.length > 0 && photoStrip(x.photos),

      h('div', { class: 'card detail-card' },
        transfer
          ? row(t('acct.account'), `${acct || t('acct.none')} → ${accountNameById(x.toAccount) || t('acct.none')}`)
          : [
              row(t('detail.merchant'), x.merchant || t('detail.none'), { muted: !x.merchant }),
              row(t('acct.account'), acct || t('acct.none'), { muted: !acct }),
            ],
        row(t('detail.note'), x.note || t('detail.none'), { muted: !x.note, multiline: true }),
        row(t('detail.date'), fullDate(x.date)),
        row(t('detail.time'), x.time || t('detail.none'), { muted: !x.time }),
        row(t('detail.source'), h('span', { class: 'detail-source' }, icon(SOURCE_ICON[x.source] || 'pencil', 14), t(`source.${x.source}`))),
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
        h('button', { class: 'btn btn-primary btn-lg', onclick: renderEdit }, icon('pencil', 17), t('edit')),
        h('button', { class: 'btn btn-lg', onclick: onCopy }, icon('copy', 17), t('detail.again')),
        h('button', { class: 'btn btn-danger btn-lg', 'aria-label': t('delete'), onclick: onDelete }, icon('trash', 17)))));
  }

  // 以今天的日期再记一笔相同的
  function onCopy() {
    const { id: _id, createdAt: _c, photos: _p, ...rest } = current();
    addTx({ ...rest, date: ymd(), time: nowHm(), source: 'manual' });
    toast(t('detail.copied'), 'success');
    sheet.close();
  }

  // ---------- 编辑 ----------
  function renderEdit() {
    const x = current();
    const base = settings().currency;
    const foreign = !!x.origCurrency;
    const transfer = x.type === 'transfer';
    const st = {
      type: x.type,
      category: x.category,
      amount: String(foreign ? x.origAmount : x.amount),
      rate: String(x.rate ?? 1),
      merchant: x.merchant || '',
      note: x.note || '',
      date: x.date,
      time: x.time || '',
      account: x.account || '',
      toAccount: x.toAccount || '',
    };
    setHeader(t('entry.edit'), null);

    const grid = h('div', { class: 'cat-grid compact' });
    const conv = h('span', { class: 'detail-conv tabular' });
    const baseAmount = () => round2((parseFloat(st.amount) || 0) * (foreign ? parseFloat(st.rate) || 0 : 1));
    const refreshConv = () => { if (foreign) conv.textContent = t('ai.converted', { v: money(baseAmount(), base) }); };

    const renderGrid = () => grid.replaceChildren(...(CATEGORIES[st.type] || []).map((c) =>
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
    const acctField = (label, key, none) => {
      const val = h('span', { class: 'edit-select' });
      const show = () => val.replaceChildren(accountName(getAccount(st[key])), icon('down', 14, 2.2));
      show();
      return field(label, [val, accountSelect(st[key], (v) => { st[key] = v; show(); }, { none })]);
    };

    const amountInput = h('input', {
      class: 'edit-input edit-amount tabular', inputMode: 'decimal', value: st.amount,
      oninput: (e) => { st.amount = e.target.value.replace(/[^\d.]/g, ''); refreshConv(); },
    });

    function save() {
      const amount = baseAmount();
      if (!(amount > 0) || !(parseFloat(st.amount) > 0)) { toast(t('entry.amountRequired'), 'error'); return; }
      if (transfer && (!st.account || st.account === st.toAccount)) { toast(t('transfer.same'), 'error'); return; }
      updateTx(id, {
        type: st.type,
        category: st.category,
        amount,
        merchant: st.merchant,
        note: st.note,
        date: st.date || x.date,
        time: st.time,
        account: st.account,
        toAccount: st.toAccount,
        ...(foreign ? { origAmount: parseFloat(st.amount), rate: parseFloat(st.rate) || 0 } : {}),
      });
      toast(t('entry.updated'), 'success');
      renderView();
    }

    if (!transfer) { renderSeg(); renderGrid(); }
    refreshConv();
    sheet.setContent(h('div', { class: 'detail edit' },
      !transfer && [typeSeg, h('div', { class: 'field-label' }, t('budget.category')), grid],
      h('div', { class: 'card edit-card' },
        field(foreign ? t('detail.origAmount') : t('detail.amount'),
          h('span', { class: 'edit-amount-wrap' }, h('span', { class: 'muted' }, foreign ? x.origCurrency : currencySymbol()), amountInput)),
        foreign && field(t('detail.rate'),
          h('span', { class: 'edit-amount-wrap' },
            h('span', { class: 'muted' }, `1 ${x.origCurrency} ≈`),
            h('input', { class: 'edit-input edit-rate tabular', inputMode: 'decimal', value: st.rate, oninput: (e) => { st.rate = e.target.value.replace(/[^\d.]/g, ''); refreshConv(); } }),
            h('span', { class: 'muted' }, base))),
        foreign && h('div', { class: 'edit-conv-row' }, conv),
        transfer
          ? [acctField(t('transfer.from'), 'account', false), acctField(t('transfer.to'), 'toAccount', false)]
          : [field(t('detail.merchant'), text('merchant', t('detail.none'))), acctField(t('acct.account'), 'account', true)],
        field(t('detail.note'), text('note', t('entry.note'), 120)),
        field(t('detail.date'), h('input', { type: 'date', class: 'edit-input', value: st.date, max: ymd(), onchange: (e) => (st.date = e.target.value) })),
        field(t('detail.time'), h('input', { type: 'time', class: 'edit-input', value: st.time, onchange: (e) => (st.time = e.target.value) }))),
      h('div', { class: 'detail-actions col' },
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
