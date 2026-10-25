// 识别接口客户端 + 图片压缩 + 离线兜底解析
import { settings } from './store.js';
import { getLang } from './i18n.js';
import { categoryIds } from './categories.js';
import { ymd, addDays } from './format.js';

export const MODEL_LABEL = 'Claude Opus 5.5';

let health = { state: 'unknown' };
const healthListeners = new Set();

export function aiHealth() {
  return health;
}

export function onHealth(fn) {
  healthListeners.add(fn);
  return () => healthListeners.delete(fn);
}

export async function checkHealth() {
  health = { state: 'checking' };
  healthListeners.forEach((f) => f(health));
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const j = await r.json();
    health = { state: !j.cli ? 'nocli' : j.loggedIn ? 'ok' : 'nologin', model: j.model };
  } catch {
    health = { state: 'noserver' };
  }
  healthListeners.forEach((f) => f(health));
  return health;
}

export async function recognize({ files, text, signal }) {
  const s = settings();
  const r = await fetch('/api/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, text, lang: getLang(), currency: s.currency, today: ymd(), categories: categoryIds() }),
    signal,
  });
  let j;
  try {
    j = await r.json();
  } catch {
    throw new Error(`HTTP ${r.status}`);
  }
  if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.result;
}

// ---------- 文件处理 ----------

const MAX_SIDE = 2400;

export async function fileToPayload(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 15 * 1024 * 1024) throw new Error('PDF > 15MB');
    return { mediaType: 'application/pdf', data: await toBase64(file), name: file.name, preview: null };
  }
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) throw new Error('unsupported');
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const hgt = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, hgt);
  ctx.drawImage(img, 0, 0, w, hgt);
  URL.revokeObjectURL(img.src);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  return { mediaType: 'image/jpeg', data: dataUrl.split(',')[1], name: file.name, preview: dataUrl };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('unsupported'));
    img.src = URL.createObjectURL(file);
  });
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// ---------- 离线兜底：Claude 不可用时按关键词解析语音文本 ----------

const KEYWORDS = [
  ['salary', /工资|薪水|月薪|salary|paycheck|給料|給与/i],
  ['bonus', /奖金|年终|bonus|ボーナス/i],
  ['refund', /退款|返现|refund|返金/i],
  ['gift', /红包|礼金|收到.*转账|お年玉/i],
  ['investment', /理财|利息|分红|股票|基金|interest|dividend|配当/i],
  ['parttime', /兼职|外快|副业|freelance|副業/i],
  ['food', /饭|餐|早饭|午饭|晚饭|早餐|午餐|晚餐|外卖|食堂|火锅|lunch|dinner|breakfast|meal|ランチ|ご飯|夕食|朝食/i],
  ['snack', /奶茶|咖啡|饮料|零食|水果|coffee|tea|snack|コーヒー|お茶|おやつ/i],
  ['transport', /打车|出租|地铁|公交|高铁|火车|加油|停车|滴滴|taxi|uber|bus|subway|metro|train|gas|タクシー|電車|バス/i],
  ['shopping', /买|购物|淘宝|京东|网购|shopping|amazon|買い物/i],
  ['daily', /日用|超市|纸巾|洗发|supermarket|grocer|スーパー|日用品/i],
  ['housing', /房租|租金|物业|rent|家賃/i],
  ['utilities', /水费|电费|燃气|煤气|electric|water bill|電気|ガス|水道/i],
  ['telecom', /话费|流量|宽带|phone bill|internet|携帯|通信/i],
  ['entertainment', /电影|游戏|KTV|演唱会|movie|game|concert|映画|ゲーム/i],
  ['clothing', /衣服|鞋|裤|外套|clothes|shoes|服|靴/i],
  ['medical', /医院|药|看病|体检|hospital|medicine|doctor|病院|薬/i],
  ['education', /书|课程|学费|培训|book|course|tuition|本|授業/i],
  ['travel', /旅游|酒店|机票|民宿|hotel|flight|travel|ホテル|旅行/i],
  ['beauty', /理发|美容|化妆|美甲|haircut|salon|美容院/i],
  ['sports', /健身|运动|游泳|gym|fitness|ジム/i],
  ['social', /请客|聚餐|份子|送礼|gift for|飲み会/i],
  ['pets', /猫|狗|宠物|pet|ペット/i],
];
const INCOME_IDS = new Set(categoryIds().income);

export function localParse(text) {
  const today = new Date();
  const segments = text.split(/[,，。;；、\n]|\band\b|然后|还有/i).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const seg of segments) {
    const m = seg.match(/(\d+(?:\.\d+)?)\s*(万|千|k|K)?/);
    if (!m) continue;
    let amount = parseFloat(m[1]);
    if (m[2] === '万') amount *= 10000;
    else if (m[2]) amount *= 1000;
    if (!(amount > 0)) continue;
    const hit = KEYWORDS.find(([, re]) => re.test(seg));
    const category = hit ? hit[0] : 'other';
    let date = ymd(today);
    if (/前天|一昨日|day before yesterday/i.test(seg)) date = ymd(addDays(today, -2));
    else if (/昨天|昨日|yesterday/i.test(seg)) date = ymd(addDays(today, -1));
    const income = INCOME_IDS.has(category) || /收入|到账|入账|received|income/i.test(seg);
    out.push({
      type: income ? 'income' : 'expense',
      amount,
      currency: settings().currency,
      rate_to_base: 1,
      category: income && !INCOME_IDS.has(category) ? 'other_income' : category,
      merchant: '',
      note: seg.replace(m[0], '').replace(/[元块圆¥$€￥]|yuan|dollars?|円/gi, '').trim(),
      date,
      time: '',
    });
  }
  return { document_type: 'voice', source_language: '', message: '', transactions: out };
}
