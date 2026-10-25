// 识别客户端：两种引擎，同一个 recognize()
//   local —— 本机 npm start 时走 server.js → Claude Code（订阅额度）
//   api   —— 浏览器用用户自己的 API Key 直连 Anthropic API，部署成静态网站时就是这种
//   + 图片压缩 + 离线兜底解析
import Anthropic from '@anthropic-ai/sdk';
import { settings } from './store.js';
import { getLang } from './i18n.js';
import { categoryIds } from './categories.js';
import { ymd, addDays } from './format.js';
import { buildSchema, buildSystemPrompt, buildContent, extractJson } from './prompt.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
];
// 安全分类器误拒时由服务端自动换模型续答（Haiku 没有服务端兜底）
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const LOCAL_MODEL = 'claude-opus-5-5';
const APIKEY_KEY = 'ledger.v1.apiKey';

export function getApiKey() {
  try { return localStorage.getItem(APIKEY_KEY) || ''; } catch { return ''; }
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(APIKEY_KEY, key);
    else localStorage.removeItem(APIKEY_KEY);
  } catch { /* 隐私模式等情况下忽略 */ }
  checkHealth();
}

const apiModel = () => (MODELS.some((m) => m.id === settings().apiModel) ? settings().apiModel : MODELS[0].id);

export function modelLabel() {
  const id = health.mode === 'api' ? apiModel() : health.model || LOCAL_MODEL;
  return MODELS.find((m) => m.id === id)?.label || id;
}

// state: ok / nokey / nologin / nocli / checking；mode: local / api
let health = { state: 'unknown', mode: 'api', local: false };
const healthListeners = new Set();

export function aiHealth() {
  return health;
}

export function onHealth(fn) {
  healthListeners.add(fn);
  return () => healthListeners.delete(fn);
}

function setHealth(next) {
  health = next;
  healthListeners.forEach((f) => f(health));
}

let localProbe = null;
async function probeLocal() {
  // 本地服务只会跑在本机或局域网；部署到 GitHub Pages 时不去探测，避免控制台 404
  if (location.hostname.endsWith('github.io') || location.protocol === 'file:') return null;
  try {
    const r = await fetch('api/health', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function checkHealth() {
  setHealth({ ...health, state: 'checking' });
  localProbe = await probeLocal();
  const local = !!localProbe;
  if (local && localProbe.cli && localProbe.loggedIn) return setHealth({ state: 'ok', mode: 'local', local, model: localProbe.model });
  if (getApiKey()) return setHealth({ state: 'ok', mode: 'api', local });
  const state = !local ? 'nokey' : !localProbe.cli ? 'nocli' : 'nologin';
  return setHealth({ state, mode: local ? 'local' : 'api', local });
}

export async function recognize({ files, text, signal }) {
  const s = settings();
  const req = { files, text, lang: getLang(), currency: s.currency, today: ymd(), categories: categoryIds() };
  return health.mode === 'local' && health.state === 'ok' ? recognizeLocal(req, signal) : recognizeApi(req, signal);
}

async function recognizeLocal(req, signal) {
  const r = await fetch('api/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
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

const API_ERRORS = {
  'zh-CN': { key: '请先在「我的 → 智能识别」里填写 Anthropic API Key', auth: 'API Key 无效或已失效，请检查后重新填写', rate: '请求过于频繁或额度不足，请稍后再试', overloaded: 'Claude 服务繁忙，请稍后再试', network: '无法连接 api.anthropic.com，请检查网络', refusal: 'Claude 拒绝处理这份内容', truncated: '识别结果过长被截断，请减少文件数量' },
  en: { key: 'Add your Anthropic API key under Me → Smart recognition first', auth: 'The API key is invalid or revoked — please check it', rate: 'Too many requests or out of credit — try again later', overloaded: 'Claude is busy — try again later', network: 'Cannot reach api.anthropic.com — check your connection', refusal: 'Claude declined to process this content', truncated: 'The result was cut off — try fewer files' },
  ja: { key: '先に「マイ → スマート認識」で Anthropic API キーを入力してください', auth: 'API キーが無効です。確認してください', rate: 'リクエストが多すぎるかクレジット不足です。しばらくしてから再試行してください', overloaded: 'Claude が混雑しています。しばらくしてから再試行してください', network: 'api.anthropic.com に接続できません', refusal: 'Claude がこの内容の処理を断りました', truncated: '結果が長すぎて途中で切れました。ファイル数を減らしてください' },
};
const apiError = (k) => new Error((API_ERRORS[getLang()] || API_ERRORS['zh-CN'])[k]);

async function recognizeApi(req, signal) {
  const apiKey = getApiKey();
  if (!apiKey) throw apiError('key');
  const content = buildContent(req.files, req.text);
  if (!content) throw new Error('没有可识别的内容');
  const model = apiModel();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const params = {
    model,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: buildSchema(req.categories) } },
    system: buildSystemPrompt(req),
    messages: [{ role: 'user', content }],
  };
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let msg;
  try {
    msg = await client.beta.messages.stream(params, { signal }).finalMessage();
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw apiError('auth');
    if (e instanceof Anthropic.RateLimitError) throw apiError('rate');
    if (e instanceof Anthropic.APIConnectionError) throw apiError('network');
    if (e instanceof Anthropic.InternalServerError) throw apiError('overloaded');
    if (e instanceof Anthropic.APIError) throw new Error(e.error?.error?.message || e.message);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw apiError('refusal');
  if (msg.stop_reason === 'max_tokens') throw apiError('truncated');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = extractJson(text);
  data.model = msg.model || model;
  data.transactions = (data.transactions || []).filter((t) => Number(t.amount) > 0);
  return data;
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
