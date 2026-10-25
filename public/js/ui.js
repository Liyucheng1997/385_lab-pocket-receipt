// 轻量 DOM 工具：h()、底部弹层、确认框、提示
import { icon } from './icons.js';
import { t } from './i18n.js';
import { getCategory } from './categories.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function catName(id) {
  return t(`cat.${id}`);
}

export function catTile(id, { size = 38, active = false } = {}) {
  const c = getCategory(id);
  return h('span', { class: `cat-tile${active ? ' active' : ''}`, style: { width: `${size}px`, height: `${size}px` } }, icon(c.icon, Math.round(size * 0.5)));
}

// ---------- 提示 ----------
let toastHost;
export function toast(msg, kind = '') {
  if (!toastHost) toastHost = document.body.appendChild(h('div', { class: 'toast-host' }));
  const el = h('div', { class: `toast ${kind ? `toast-${kind}` : ''}` }, msg);
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, kind === 'error' ? 3600 : 2000);
}

// ---------- 底部弹层 ----------
const stack = [];

export function openSheet({ title, content, className = '', headerRight, onClose, full = false }) {
  const overlay = h('div', { class: 'sheet-overlay' });
  const body = h('div', { class: 'sheet-body' });
  const closeBtn = h('button', { class: 'modal-x', 'aria-label': t('close'), onclick: () => close() }, icon('x', 16, 2));
  const header = title != null
    ? h('div', { class: 'sheet-header' }, h('div', { class: 'sheet-title' }, title), h('div', { class: 'sheet-actions' }, headerRight, closeBtn))
    : null;
  const sheet = h('div', { class: `sheet ${full ? 'sheet-full' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-grip' }), header, body);
  overlay.append(sheet);
  document.body.append(overlay);

  let closed = false;
  const api = {
    el: sheet,
    body,
    setTitle(s) {
      const el = sheet.querySelector('.sheet-title');
      if (el) el.textContent = s;
    },
    setContent(node) {
      body.replaceChildren(...[node].flat());
    },
    close,
  };
  function close() {
    if (closed) return;
    closed = true;
    stack.splice(stack.indexOf(api), 1);
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 220);
    onClose?.();
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  enableDragToClose(sheet, close);
  stack.push(api);
  if (content) api.setContent(typeof content === 'function' ? content(api) : content);
  return api;
}

// 下拉手柄关闭
function enableDragToClose(sheet, close) {
  const grip = sheet.querySelector('.sheet-grip');
  let y0 = null;
  let dy = 0;
  const start = (e) => { y0 = e.touches ? e.touches[0].clientY : e.clientY; dy = 0; sheet.style.transition = 'none'; };
  const move = (e) => {
    if (y0 == null) return;
    dy = Math.max(0, (e.touches ? e.touches[0].clientY : e.clientY) - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) close();
  };
  for (const el of [grip, sheet.querySelector('.sheet-header')].filter(Boolean)) {
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('mousedown', start);
  }
  window.addEventListener('touchmove', move, { passive: true });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchend', end);
  window.addEventListener('mouseup', end);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
});

// ---------- 确认框 ----------
export function confirmDialog({ title, message, okText = t('confirm'), danger = false, iconName = 'info' }) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'modal-overlay' });
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.append(
      h('div', { class: 'modal confirm' },
        h('div', { class: `confirm-ico ${danger ? 'danger' : ''}` }, icon(iconName, 24)),
        h('div', { class: 'confirm-title' }, title),
        message && h('div', { class: 'confirm-msg' }, message),
        h('div', { class: 'confirm-btns' },
          h('button', { class: 'btn', onclick: () => done(false) }, t('cancel')),
          h('button', { class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, onclick: () => done(true) }, okText))));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    document.body.append(overlay);
  });
}

// ---------- 分段控件 ----------
export function seg(options, value, onChange, cls = '') {
  return h('div', { class: `seg ${cls}` },
    options.map((o) => h('button', { class: o.value === value ? 'active' : '', onclick: () => o.value !== value && onChange(o.value) }, o.label)));
}

// 设置项行
export function cell({ iconName, label, value, onClick, right, danger = false }) {
  return h(onClick ? 'button' : 'div', { class: `cell ${danger ? 'danger' : ''}`, onclick: onClick },
    iconName && h('span', { class: 'cell-ico' }, icon(iconName, 18)),
    h('span', { class: 'cell-label' }, label),
    right ?? h('span', { class: 'cell-value' }, value ?? ''),
    onClick && !right && h('span', { class: 'cell-chev' }, icon('right', 16)));
}

// 下载文本文件
export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
