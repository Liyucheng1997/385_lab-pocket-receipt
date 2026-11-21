// 我的：语言、本位币、外观、识别引擎状态、数据导入导出
import { h, mount, seg, cell, toast, confirmDialog, downloadText, catName, catTile, openSheet } from '../ui.js';
import { icon } from '../icons.js';
import { t, LANGS, getLang } from '../i18n.js';
import { allTx, settings, updateSettings, replaceAll, clearAll, sortTx, removeRecurring } from '../store.js';
import { CURRENCIES, currencyName, ymd, addDays, money, shortDate } from '../format.js';
import { accountNameById } from '../accounts.js';
import { openBudget } from './budget.js';
import { aiHealth, checkHealth, modelLabel, MODELS, getApiKey, setApiKey } from '../recognize.js';
import { cloudUser, syncStatus, pendingCount, syncNow, signOut, changePassword, deleteAccount } from '../cloud.js';

function pwInput(placeholder, autocomplete) {
  return h('input', { class: 'input', type: 'password', autocomplete, maxLength: 200, placeholder });
}

function openPassword() {
  const sheet = openSheet({ title: t('cloud.password') });
  const old = pwInput(t('cloud.oldPw'), 'current-password');
  const next = pwInput(t('cloud.newPw'), 'new-password');
  const save = async () => {
    if (next.value.length < 6) return toast(t('auth.err.bad_password'), 'error');
    try {
      await changePassword(old.value, next.value);
      toast(t('cloud.pwChanged'), 'success');
      sheet.close();
    } catch (e) {
      toast(t(`auth.err.${e.message}`), 'error');
    }
    return null;
  };
  sheet.setContent(h('div', { class: 'detail pw-form' }, old, next,
    h('div', { class: 'acct-note' }, t('cloud.pwNote')),
    h('button', { class: 'btn btn-primary btn-lg', onclick: save }, t('save'))));
}

function openDeleteAccount() {
  const sheet = openSheet({ title: t('cloud.delete') });
  const pw = pwInput(t('auth.password'), 'current-password');
  const go = async () => {
    try {
      await deleteAccount(pw.value);
    } catch (e) {
      toast(t(`auth.err.${e.message}`), 'error');
    }
  };
  sheet.setContent(h('div', { class: 'detail pw-form' },
    h('div', { class: 'acct-note' }, t('cloud.deleteNote')), pw,
    h('button', { class: 'btn btn-danger btn-lg', onclick: go }, t('cloud.delete'))));
}

async function logout() {
  if (await signOut()) return;
  if (await confirmDialog({ title: t('cloud.logoutPending'), message: t('cloud.logoutPendingMsg', { n: pendingCount() }), okText: t('cloud.logout'), danger: true, iconName: 'info' })) signOut(true);
}

function accountCard(user) {
  const st = syncStatus();
  return [
    h('div', { class: 'group-title' }, t('cloud.account')),
    h('div', { class: 'card cells' },
      cell({ iconName: 'refresh', label: t('cloud.sync'), right: h('span', { class: `status ${st === 'synced' ? 'ok' : st === 'offline' ? 'bad' : 'warn'}` }, t(`cloud.${st}`)), onClick: async () => { toast(t((await syncNow()) ? 'cloud.synced' : 'cloud.offline')); } }),
      cell({ iconName: 'key', label: t('cloud.password'), onClick: openPassword }),
      cell({ iconName: 'user', label: t('cloud.logout'), value: user.name, onClick: logout }),
      cell({ iconName: 'trash', label: t('cloud.delete'), danger: true, onClick: openDeleteAccount })),
  ];
}

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
  const map = { ok: ['ok', 'ai.ok'], nokey: ['warn', 'ai.noKey'], nologin: ['warn', 'ai.notLogged'], nocli: ['bad', 'ai.noCli'], checking: ['', 'ai.checking'], unknown: ['', 'ai.checking'] };
  const [cls, key] = map[s] || map.unknown;
  return h('span', { class: `status ${cls}` }, t(key));
}

// API Key 输入：失焦或回车时保存，只存在本机浏览器
function apiKeyCell() {
  const saved = getApiKey();
  const input = h('input', {
    class: 'cell-input', type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'sk-ant-…',
    value: saved, 'aria-label': 'Anthropic API Key',
    onchange: (e) => {
      const v = e.target.value.trim();
      if (v === getApiKey()) return;
      setApiKey(v);
      toast(t(v ? 'me.keySaved' : 'me.keyCleared'), 'success');
    },
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
  });
  return h('label', { class: 'cell' }, h('span', { class: 'cell-ico' }, icon('key', 18)), h('span', { class: 'cell-label' }, 'API Key'), input);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const rows = sortTx(allTx()).map((tx) => [
    tx.date, tx.time, t(tx.type), catName(tx.category), tx.type === 'expense' ? -tx.amount : tx.amount,
    tx.origAmount ?? '', tx.origCurrency ?? '', tx.merchant, tx.note, t(`source.${tx.source}`),
    tx.type === 'transfer' ? `${accountNameById(tx.account)} → ${accountNameById(tx.toAccount)}` : accountNameById(tx.account),
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
      replaceAll(data.tx.filter((x) => x && x.date && x.amount > 0 && (x.category || x.type === 'transfer')), data.settings);
      toast(t('me.restored', { n: data.tx.length }), 'success');
    } catch {
      toast(t('me.restoreBad'), 'error');
    }
  };
  input.click();
}

// 连续记账天数：从今天（或昨天）往回数
function streak(dates) {
  let d = new Date();
  if (!dates.has(ymd(d))) d = addDays(d, -1);
  let n = 0;
  while (dates.has(ymd(d))) { n++; d = addDays(d, -1); }
  return n;
}

function openRecurring() {
  const sheet = openSheet({ title: t('rec.title') });
  const draw = () => {
    const rules = settings().recurring || [];
    sheet.setContent(h('div', { class: 'detail' },
      rules.length
        ? h('div', { class: 'card cells' }, rules.map((r) => h('div', { class: 'cell rec-row' },
            catTile(r.tpl.category, { size: 38 }),
            h('span', { class: 'cell-label' }, r.tpl.note || r.tpl.merchant || catName(r.tpl.category),
              h('small', null, `${t(`repeat.${r.every}`)} · ${t('rec.next', { d: shortDate(r.next) })}`)),
            h('b', { class: 'tabular' }, `${r.tpl.type === 'income' ? '+' : '-'}${money(r.tpl.amount)}`),
            h('button', { class: 'icon-btn danger', 'aria-label': t('delete'), onclick: () => { removeRecurring(r.id); draw(); } }, icon('trash', 17)))))
        : h('div', { class: 'empty small' }, icon('repeat', 28, 1.5), t('rec.empty')),
      h('div', { class: 'acct-note' }, t('rec.hint'))));
  };
  draw();
}

export function renderMe(root) {
  const s = settings();
  const tx = allTx();
  const dates = new Set(tx.map((x) => x.date));
  const days = dates.size;
  const { state: health, mode, engine } = aiHealth();
  const user = cloudUser();

  mount(root,
    h('header', { class: 'page-head' }, h('h1', { class: 'page-title' }, t('tab.me'))),
    h('div', { class: 'hero profile' },
      h('div', { class: 'profile-top' },
        h('div', { class: 'logo-mark' }, icon('receipt', 24, 2)),
        h('div', null, h('div', { class: 'profile-name' }, user ? user.name : t('app.name')), h('div', { class: 'profile-sub' }, user ? t('cloud.slogan') : t('me.slogan')))),
      h('div', { class: 'profile-stats' },
        h('div', null, h('b', { class: 'tabular' }, String(streak(dates))), h('span', null, t('me.streak'))),
        h('div', null, h('b', { class: 'tabular' }, String(days)), h('span', null, t('me.days'))),
        h('div', null, h('b', { class: 'tabular' }, String(tx.length)), h('span', null, t('me.count'))))),

    user && accountCard(user),

    h('div', { class: 'group-title' }, t('me.tools')),
    h('div', { class: 'card cells' },
      cell({ iconName: 'target', label: t('budget.title'), value: s.budget > 0 ? money(s.budget) : t('me.unset'), onClick: () => openBudget() }),
      cell({ iconName: 'repeat', label: t('rec.title'), value: (s.recurring || []).length ? String(s.recurring.length) : '', onClick: openRecurring })),

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
      cell({ iconName: 'sparkles', label: h('span', null, t('me.engine'), h('small', null, `${modelLabel()} · ${mode !== 'local' ? t('ai.engineApi') : engine === 'api' ? t('ai.engineServer') : t('ai.engineLocal')}`)), right: statusDot() }),
      mode === 'local' && health !== 'ok' && health !== 'checking' && h('div', { class: 'cell-note' }, t('ai.loginHint'), h('code', { class: 'cmd' }, 'claude auth login')),
      cell({ iconName: 'refresh', label: t('me.check'), onClick: () => checkHealth() })),
    // 本地订阅已连通时不需要 Key；否则（网页版）在这里填写
    !(mode === 'local' && health === 'ok') && h('div', { class: 'card cells api-card' },
      apiKeyCell(),
      selectCell({ iconName: 'cpu', label: t('me.model'), value: MODELS.some((m) => m.id === s.apiModel) ? s.apiModel : MODELS[0].id, options: MODELS.map((m) => ({ value: m.id, label: m.label })), onChange: (v) => updateSettings({ apiModel: v }) }),
      h('div', { class: 'cell-note' }, t('me.keyNote'), h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, t('me.keyGet')))),

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
    h('div', { class: 'card about' }, t(user ? 'cloud.aboutText' : 'me.aboutText')),
  );
}
