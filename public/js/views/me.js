// 我的：语言、本位币、外观、识别引擎状态、数据导入导出
import { h, seg, cell, toast, confirmDialog, downloadText, catName } from '../ui.js';
import { icon } from '../icons.js';
import { t, LANGS, getLang } from '../i18n.js';
import { allTx, settings, updateSettings, replaceAll, clearAll, sortTx } from '../store.js';
import { CURRENCIES, currencyName, ymd } from '../format.js';
import { aiHealth, checkHealth, MODEL_LABEL } from '../recognize.js';

function selectCell({ iconName, label, value, options, onChange, note }) {
  const sel = h('select', { class: 'cell-select', 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  const current = options.find((o) => o.value === value)?.short ?? options.find((o) => o.value === value)?.label;
  return h('label', { class: 'cell' },
    h('span', { class: 'cell-ico' }, icon(iconName, 18)),
    h('span', { class: 'cell-label' }, label, note && h('small', null, note)),
    h('span', { class: 'cell-value' }, current),
    h('span', { class: 'cell-chev' }, icon('down', 16)),
    sel);
}

function statusDot() {
  const s = aiHealth().state;
  const map = { ok: ['ok', 'ai.ok'], nologin: ['warn', 'ai.notLogged'], noserver: ['bad', 'ai.noServer'], nocli: ['bad', 'ai.noCli'], checking: ['', 'ai.checking'], unknown: ['', 'ai.checking'] };
  const [cls, key] = map[s] || map.unknown;
  return h('span', { class: `status ${cls}` }, t(key));
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const rows = sortTx(allTx()).map((tx) => [
    tx.date, tx.time, t(tx.type), catName(tx.category), tx.type === 'expense' ? -tx.amount : tx.amount,
    tx.origAmount ?? '', tx.origCurrency ?? '', tx.merchant, tx.note, t(`source.${tx.source}`),
  ].map(csvEscape).join(','));
  downloadText(`ledger-${ymd()}.csv`, `﻿${t('csv.header')}\n${rows.join('\n')}`, 'text/csv');
  toast(t('me.exported'), 'success');
}

function backup() {
  downloadText(`ledger-backup-${ymd()}.json`, JSON.stringify({ app: 'pocket-ledger', version: 1, exportedAt: new Date().toISOString(), settings: settings(), tx: allTx() }, null, 2), 'application/json');
  toast(t('me.exported'), 'success');
}

function restore() {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (!Array.isArray(data.tx)) throw new Error('bad');
      replaceAll(data.tx.filter((x) => x && x.date && x.amount > 0 && x.category), data.settings);
      toast(t('me.restored', { n: data.tx.length }), 'success');
    } catch {
      toast(t('me.restoreBad'), 'error');
    }
  };
  input.click();
}

export function renderMe(root) {
  const s = settings();
  const tx = allTx();
  const days = new Set(tx.map((x) => x.date)).size;
  const health = aiHealth().state;

  root.replaceChildren(
    h('header', { class: 'page-head' }, h('h1', { class: 'page-title' }, t('tab.me'))),
    h('div', { class: 'card profile' },
      h('div', { class: 'logo-mark' }, icon('wallet', 24, 2)),
      h('div', { class: 'profile-name' }, t('app.name')),
      h('div', { class: 'profile-stats' },
        h('div', null, h('b', { class: 'tabular' }, String(days)), h('span', null, t('me.days'))),
        h('div', null, h('b', { class: 'tabular' }, String(tx.length)), h('span', null, t('me.count'))))),

    h('div', { class: 'group-title' }, t('me.general')),
    h('div', { class: 'card cells' },
      selectCell({ iconName: 'globe', label: t('me.language'), value: getLang(), options: LANGS.map((l) => ({ value: l.id, label: l.label })), onChange: (v) => updateSettings({ lang: v }) }),
      selectCell({
        iconName: 'coins', label: t('me.currency'), value: s.currency, note: t('me.currencyNote'),
        options: CURRENCIES.map((c) => ({ value: c, label: `${c} · ${currencyName(c)}`, short: c })),
        onChange: (v) => updateSettings({ currency: v }),
      }),
      cell({
        iconName: 'moon', label: t('me.theme'),
        right: seg([
          { value: 'light', label: t('theme.light') },
          { value: 'dark', label: t('theme.dark') },
          { value: 'system', label: t('theme.system') },
        ], s.theme, (v) => updateSettings({ theme: v }), 'seg-sm'),
      })),

    h('div', { class: 'group-title' }, t('me.ai')),
    h('div', { class: 'card cells' },
      cell({ iconName: 'sparkles', label: h('span', null, t('me.engine'), h('small', null, `${MODEL_LABEL} · Claude Code`)), right: statusDot() }),
      health !== 'ok' && health !== 'checking' && h('div', { class: 'cell-note' }, t('ai.loginHint'), h('code', { class: 'cmd' }, 'claude auth login')),
      cell({ iconName: 'refresh', label: t('me.check'), onClick: () => checkHealth() })),

    h('div', { class: 'group-title' }, t('me.data')),
    h('div', { class: 'card cells' },
      cell({ iconName: 'download', label: t('me.exportCsv'), onClick: exportCsv }),
      cell({ iconName: 'file', label: t('me.backup'), onClick: backup }),
      cell({ iconName: 'upload', label: t('me.restore'), onClick: restore }),
      cell({
        iconName: 'trash', label: t('me.clear'), danger: true,
        onClick: async () => {
          if (await confirmDialog({ title: t('me.clear'), message: t('me.clearConfirm'), okText: t('delete'), danger: true, iconName: 'trash' })) {
            clearAll();
            toast(t('me.cleared'));
          }
        },
      })),

    h('div', { class: 'group-title' }, t('me.about')),
    h('div', { class: 'card about' }, t('me.aboutText')),
  );
}
