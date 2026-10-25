// 账单识别 / 语音记账 / 结果确认
import { h, openSheet, toast, catTile, catName } from '../ui.js';
import { icon } from '../icons.js';
import { t, getLang } from '../i18n.js';
import { CATEGORIES, isCategoryOfType } from '../categories.js';
import { addTx, settings, updateSettings } from '../store.js';
import { money, ymd, languageName } from '../format.js';
import { recognize, fileToPayload, localParse, aiHealth, modelLabel } from '../recognize.js';

const MAX_FILES = 6;

// Claude 未连接时的提示条
function offlineHint() {
  const { state } = aiHealth();
  if (state === 'ok' || state === 'checking' || state === 'unknown') return null;
  const msg = state === 'nokey' ? t('ai.keyHint') : [t(state === 'nocli' ? 'ai.noCli' : 'ai.notLogged'), ' · ', t('ai.loginHint')];
  return h('div', { class: 'hint-bar' }, icon('info', 16), h('div', null, msg));
}

// ---------- 账单识别 ----------
export function openScan() {
  const files = [];
  const sheet = openSheet({ title: t('scan.title'), className: 'ai-sheet' });

  const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr-only', onchange: (e) => addFiles(e.target.files) });
  const pickInput = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, class: 'sr-only', onchange: (e) => addFiles(e.target.files) });

  async function addFiles(list) {
    for (const f of list) {
      if (files.length >= MAX_FILES) { toast(t('scan.tooMany'), 'error'); break; }
      try {
        files.push(await fileToPayload(f));
      } catch {
        toast(t('scan.unsupported'), 'error');
      }
    }
    cameraInput.value = '';
    pickInput.value = '';
    renderPick();
  }

  function renderPick() {
    const thumbs = files.length
      ? h('div', { class: 'thumbs' }, files.map((f, i) =>
          h('div', { class: 'thumb' },
            f.preview ? h('img', { src: f.preview, alt: '' }) : h('div', { class: 'thumb-pdf' }, icon('file', 26), h('span', null, f.name)),
            h('button', { class: 'thumb-x', 'aria-label': t('delete'), onclick: () => { files.splice(i, 1); renderPick(); } }, icon('x', 12, 2.5)))))
      : null;

    sheet.setContent(h('div', { class: 'ai-pick' },
      offlineHint(),
      !files.length && h('div', { class: 'ai-hero' }, h('div', { class: 'ai-hero-ico' }, icon('receipt', 30)), h('p', null, t('scan.desc'))),
      thumbs,
      h('div', { class: 'pick-btns' },
        h('button', { class: 'pick-btn', onclick: () => cameraInput.click() }, icon('camera', 22), t('scan.camera')),
        h('button', { class: 'pick-btn', onclick: () => pickInput.click() }, icon('image', 22), files.length ? t('scan.add') : t('scan.pick'))),
      cameraInput, pickInput,
      h('button', { class: 'btn btn-primary btn-lg block', disabled: !files.length, onclick: run }, icon('sparkles', 18), t('scan.start'))));
  }

  function run() {
    runRecognition(sheet, { files: files.map(({ mediaType, data }) => ({ mediaType, data })) }, 'scan', renderPick);
  }

  renderPick();
  return sheet;
}

// ---------- 语音记账 ----------
const VOICE_LANGS = [
  { id: 'zh-CN', label: '中文' },
  { id: 'en-US', label: 'English' },
  { id: 'ja-JP', label: '日本語' },
  { id: 'ko-KR', label: '한국어' },
  { id: 'yue-Hant-HK', label: '粵語' },
];

export function openVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const sheet = openSheet({ title: t('voice.title'), className: 'ai-sheet', onClose: () => stop() });
  const defaultLang = { 'zh-CN': 'zh-CN', en: 'en-US', ja: 'ja-JP' }[getLang()];
  let lang = settings().voiceLang || defaultLang;
  let rec = null;
  let listening = false;
  let finalText = '';

  const textarea = h('textarea', { class: 'input voice-text', rows: 3, placeholder: t('voice.example') });
  const status = h('div', { class: 'voice-status' });
  const micBtn = h('button', { class: 'mic-btn', 'aria-label': t('voice.tap'), onclick: toggle });
  const langRow = h('div', { class: 'chips-row' });

  function renderLangs() {
    langRow.replaceChildren(...VOICE_LANGS.map((l) =>
      h('button', { class: `chip ${l.id === lang ? 'active' : ''}`, onclick: () => { lang = l.id; updateSettings({ voiceLang: l.id }); stop(); renderLangs(); } }, l.label)));
  }

  function renderMic() {
    micBtn.classList.toggle('on', listening);
    micBtn.replaceChildren(icon(listening ? 'stop' : 'mic', 30, 2));
    status.textContent = !SR ? t('voice.unsupported') : listening ? t('voice.listening') : t('voice.tap');
    status.classList.toggle('warn', !SR);
  }

  function toggle() {
    if (!SR) { textarea.focus(); return; }
    listening ? stop() : start();
  }

  function start() {
    rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    finalText = textarea.value ? `${textarea.value.trim()} ` : '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      textarea.value = finalText + interim;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast(t('voice.denied'), 'error');
      else if (e.error === 'network') toast(t('voice.network'), 'error');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast(e.error, 'error');
    };
    rec.onend = () => { listening = false; renderMic(); };
    try {
      rec.start();
      listening = true;
    } catch {
      listening = false;
    }
    renderMic();
  }

  function stop() {
    if (rec) {
      rec.onend = null;
      try { rec.stop(); } catch { /* 已停止 */ }
      rec = null;
    }
    listening = false;
    if (document.body.contains(micBtn)) renderMic();
  }

  function parse() {
    stop();
    const text = textarea.value.trim();
    if (!text) { toast(t('voice.empty'), 'error'); return; }
    runRecognition(sheet, { text }, 'voice', render);
  }

  function render() {
    renderLangs();
    renderMic();
    sheet.setContent(h('div', { class: 'voice' },
      h('div', { class: 'field-label' }, t('voice.lang')),
      langRow,
      h('div', { class: 'mic-wrap' }, micBtn, status),
      h('div', { class: 'field-label' }, t('voice.input')),
      textarea,
      h('button', { class: 'btn btn-primary btn-lg block', onclick: parse }, icon('sparkles', 18), t('voice.parse'))));
  }

  render();
  return sheet;
}

// ---------- 识别流程（共用） ----------
function runRecognition(sheet, payload, source, back) {
  const ctrl = new AbortController();
  const t0 = Date.now();
  const elapsed = h('div', { class: 'ai-elapsed tabular' }, t('ai.elapsed', { n: 0 }));
  const timer = setInterval(() => (elapsed.textContent = t('ai.elapsed', { n: Math.round((Date.now() - t0) / 1000) })), 1000);
  const cancel = () => { ctrl.abort(); clearInterval(timer); back(); };

  sheet.setContent(h('div', { class: 'ai-loading' },
    h('div', { class: 'ai-orb' }, icon('sparkles', 30)),
    h('div', { class: 'ai-loading-title' }, t('ai.working')),
    h('div', { class: 'ai-loading-sub' }, t(aiHealth().mode === 'local' ? 'ai.model' : 'ai.modelApi', { m: modelLabel() })),
    elapsed,
    h('button', { class: 'btn', onclick: cancel }, t('cancel'))));

  recognize({ ...payload, signal: ctrl.signal })
    .then((result) => {
      clearInterval(timer);
      if (!document.body.contains(sheet.el)) return;
      showReview(sheet, result, source, back);
    })
    .catch((err) => {
      clearInterval(timer);
      if (ctrl.signal.aborted || !document.body.contains(sheet.el)) return;
      // 语音文本可以离线兜底
      if (payload.text) {
        const local = localParse(payload.text);
        if (local.transactions.length) {
          local.message = `${t('ai.offline')}（${err.message}）`;
          showReview(sheet, local, source, back);
          return;
        }
      }
      sheet.setContent(h('div', { class: 'ai-error' },
        h('div', { class: 'confirm-ico danger' }, icon('info', 24)),
        h('div', { class: 'confirm-title' }, t('ai.failed')),
        h('div', { class: 'confirm-msg' }, err.message),
        /登录|login|ログイン/i.test(err.message) && h('code', { class: 'cmd' }, 'claude auth login'),
        h('button', { class: 'btn btn-primary btn-lg block', onclick: back }, t('ai.retry'))));
    });
}

function showReview(sheet, result, source, back) {
  const base = settings().currency;
  const items = (result.transactions || []).map((x) => {
    // 分类决定收支类型；分类无效时按 type 回落到"其他"
    const inc = isCategoryOfType(x.category, 'income');
    const exp = isCategoryOfType(x.category, 'expense');
    const type = inc ? 'income' : exp ? 'expense' : x.type === 'income' ? 'income' : 'expense';
    const currency = (x.currency || base).toUpperCase();
    return {
      checked: true,
      type,
      category: inc || exp ? x.category : type === 'income' ? 'other_income' : 'other',
      amount: String(x.amount),
      currency,
      rate: currency === base ? 1 : Number(x.rate_to_base) || 1,
      note: x.note || '',
      merchant: x.merchant || '',
      lineItems: Array.isArray(x.items) ? x.items.filter((i) => i && i.name) : [],
      date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : ymd(),
      time: x.time || '',
    };
  });
  sheet.setTitle(t('ai.review'));

  const list = h('div', { class: 'review-list' });
  const saveBtn = h('button', { class: 'btn btn-primary btn-lg block', onclick: save });

  function baseAmount(it) {
    const a = parseFloat(it.amount) || 0;
    return Math.round(a * (it.currency === base ? 1 : it.rate) * 100) / 100;
  }

  function updateSave() {
    const n = items.filter((i) => i.checked && parseFloat(i.amount) > 0).length;
    saveBtn.textContent = t('ai.saveN', { n });
    saveBtn.disabled = !n;
  }

  function categorySelect(it, onChange) {
    const sel = h('select', { class: 'cat-select-native', 'aria-label': t('budget.category') },
      ['expense', 'income'].map((type) => h('optgroup', { label: t(type) },
        CATEGORIES[type].map((c) => h('option', { value: `${type}:${c.id}`, selected: it.type === type && it.category === c.id }, catName(c.id))))));
    sel.addEventListener('change', () => {
      const [type, id] = sel.value.split(':');
      it.type = type;
      it.category = id;
      onChange();
    });
    return sel;
  }

  function card(it) {
    const el = h('div', { class: `review-card ${it.checked ? '' : 'off'}` });
    const converted = h('div', { class: 'review-conv tabular' });
    const refreshConv = () => {
      if (it.currency !== base) converted.textContent = t('ai.converted', { v: money(baseAmount(it), base) });
    };
    const render = () => {
      el.className = `review-card ${it.checked ? '' : 'off'}`;
      refreshConv();
      el.replaceChildren(...[
        h('div', { class: 'review-top' },
          h('button', { class: `check ${it.checked ? 'on' : ''}`, 'aria-pressed': String(it.checked), onclick: () => { it.checked = !it.checked; render(); updateSave(); } }, icon('check', 14, 3)),
          h('label', { class: 'review-cat' },
            catTile(it.category, { size: 34, active: true }),
            h('span', null, catName(it.category)),
            icon('down', 14),
            categorySelect(it, render)),
          h('div', { class: `review-amount ${it.type}` },
            h('span', { class: 'review-cur' }, it.type === 'income' ? `+ ${it.currency}` : it.currency),
            h('input', {
              class: 'review-amount-input tabular', inputMode: 'decimal', value: it.amount,
              oninput: (e) => { it.amount = e.target.value.replace(/[^\d.]/g, ''); refreshConv(); updateSave(); },
            }))),
        it.currency !== base && h('div', { class: 'review-rate' },
          h('span', null, `1 ${it.currency} ≈`),
          h('input', { class: 'rate-input tabular', inputMode: 'decimal', value: String(it.rate), oninput: (e) => { it.rate = parseFloat(e.target.value) || 0; refreshConv(); } }),
          h('span', null, base),
          converted),
        h('div', { class: 'review-fields' },
          h('input', { class: 'input review-note', value: it.merchant, placeholder: t('detail.merchant'), oninput: (e) => (it.merchant = e.target.value) }),
          h('input', { class: 'input review-note', value: it.note, placeholder: t('entry.note'), oninput: (e) => (it.note = e.target.value) })),
        h('div', { class: 'review-meta' },
          icon('calendar', 14),
          h('input', { type: 'date', class: 'review-date', value: it.date, onchange: (e) => (it.date = e.target.value || it.date) }),
          it.time && h('span', { class: 'muted' }, it.time),
          it.lineItems.length > 0 && h('span', { class: 'review-items' }, icon('list', 14), t('detail.itemsN', { n: it.lineItems.length }))),
      ].filter(Boolean));
    };
    render();
    return el;
  }

  function save() {
    const chosen = items.filter((i) => i.checked && parseFloat(i.amount) > 0);
    addTx(chosen.map((it) => ({
      type: it.type,
      category: it.category,
      amount: baseAmount(it),
      merchant: it.merchant,
      note: it.note,
      items: it.lineItems,
      date: it.date,
      time: it.time,
      source,
      ...(it.currency !== base ? { origCurrency: it.currency, origAmount: parseFloat(it.amount), rate: it.rate } : {}),
    })));
    toast(t('ai.savedN', { n: chosen.length }), 'success');
    sheet.close();
  }

  list.append(...items.map(card));
  const src = result.source_language && !String(result.source_language).toLowerCase().startsWith(getLang().slice(0, 2))
    ? h('div', { class: 'review-src' }, icon('globe', 14), t('ai.source', { l: languageName(result.source_language) }))
    : null;

  if (!items.length) {
    sheet.setContent(h('div', { class: 'ai-error' },
      h('div', { class: 'confirm-ico' }, icon('info', 24)),
      h('div', { class: 'confirm-title' }, t('ai.none')),
      result.message && h('div', { class: 'confirm-msg' }, result.message),
      h('button', { class: 'btn btn-primary btn-lg block', onclick: back }, t('ai.retry'))));
    return;
  }

  updateSave();
  sheet.setContent(h('div', { class: 'review' },
    (result.message || src) && h('div', { class: 'review-msg' }, src, result.message && h('div', null, result.message)),
    list,
    h('div', { class: 'review-footer' }, saveBtn)));
}
