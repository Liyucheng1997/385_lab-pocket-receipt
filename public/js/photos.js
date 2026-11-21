// 小票照片：压缩后存在 IndexedDB（localStorage 放不下图片），记录里只存照片 id
// 登录账号后照片同时上传到服务器，换设备时按需取回
import { localUser, NS } from './session.js';

const ANON_DB = 'ledger-photos';
const DB = localUser ? `${ANON_DB}-${localUser.id}` : ANON_DB;
const STORE = 'p';
const MAX_SIDE = 1280;
const QUEUE_KEY = `${NS}.photoQueue`;

function open(name = DB) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run(mode, fn, name) {
  const db = await open(name);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function shrink(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/jpeg', 0.72);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// 存一组图片（data URL），返回照片 id；存不下时返回已成功的部分
export async function savePhotos(dataUrls) {
  const ids = [];
  for (const url of dataUrls.slice(0, 6)) {
    try {
      const blob = await shrink(url);
      const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      await run('readwrite', (s) => s.put(blob, id));
      ids.push(id);
    } catch { /* 存储不可用时不保存照片 */ }
  }
  enqueue(ids);
  return ids;
}

// ---------- 上传队列（账号模式） ----------
function queue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
}
function setQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* 忽略 */ }
}
function enqueue(ids) {
  if (!localUser || !ids.length) return;
  setQueue([...queue(), ...ids]);
  flushPhotos().catch(() => {});
}

let uploading = null;
// 把还没传上去的照片传到服务器；网络不通时抛错，留到下次
export function flushPhotos() {
  if (!localUser) return Promise.resolve();
  uploading ||= (async () => {
    try {
      for (const id of queue()) {
        const blob = await run('readonly', (s) => s.get(id)).catch(() => null);
        if (blob) {
          const r = await fetch(`api/photos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
          if (r.status === 401 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
        }
        setQueue(queue().filter((x) => x !== id));
      }
    } finally {
      uploading = null;
    }
  })();
  return uploading;
}

// 首次登录导入本机旧数据时，把旧照片也搬过来
export async function importAnonPhotos(ids) {
  const moved = [];
  for (const id of ids) {
    try {
      const blob = await run('readonly', (s) => s.get(id), ANON_DB);
      if (!blob) continue;
      await run('readwrite', (s) => s.put(blob, id));
      moved.push(id);
    } catch { /* 读不到就跳过 */ }
  }
  enqueue(moved);
}

const urls = new Map();
export async function photoUrl(id) {
  if (urls.has(id)) return urls.get(id);
  try {
    let blob = await run('readonly', (s) => s.get(id));
    if (!blob && localUser) {
      const r = await fetch(`api/photos/${id}`);
      if (r.ok) {
        blob = await r.blob();
        run('readwrite', (s) => s.put(blob, id)).catch(() => {});
      }
    }
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  } catch {
    return null;
  }
}

export function deletePhotos(ids) {
  if (!ids?.length) return;
  run('readwrite', (s) => { ids.forEach((id) => s.delete(id)); }).catch(() => {});
  if (localUser) ids.forEach((id) => fetch(`api/photos/${id}`, { method: 'DELETE' }).catch(() => {}));
}

export function clearPhotos() {
  run('readwrite', (s) => s.clear()).catch(() => {});
}
