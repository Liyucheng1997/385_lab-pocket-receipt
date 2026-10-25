// 识别提示词与输出结构：浏览器（API 直连）和 server.js（本地 Claude Code）共用，不依赖浏览器环境
export const LANG_NAMES = {
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  en: 'English',
  ja: 'Japanese (日本語)',
};

export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function buildSchema(categories) {
  const expense = categories.expense;
  const income = categories.income;
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      document_type: { type: 'string', enum: ['receipt', 'invoice', 'statement', 'voice', 'other'] },
      source_language: { type: 'string', description: 'BCP-47 code of the source text, e.g. ja, en, zh-CN' },
      message: { type: 'string', description: 'Short note to the user in the output language; empty if nothing to say' },
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['expense', 'income'] },
            amount: { type: 'number', description: 'Positive amount in the document currency' },
            currency: { type: 'string', description: 'ISO 4217 code of the document currency' },
            rate_to_base: { type: 'number', description: 'Approximate value of 1 unit of currency in the base currency; 1 if same' },
            category: { type: 'string', enum: [...expense, ...income] },
            merchant: { type: 'string' },
            note: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            time: { type: 'string', description: 'HH:MM, empty if unknown' },
            items: {
              type: 'array',
              description: 'Purchased line items of a single receipt; [] for statements and speech',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', description: 'Item name in the output language' },
                  amount: { type: 'number', description: 'Line total in the document currency; discounts negative' },
                },
                required: ['name', 'amount'],
              },
            },
          },
          required: ['type', 'amount', 'currency', 'rate_to_base', 'category', 'merchant', 'note', 'date', 'time', 'items'],
        },
      },
    },
    required: ['document_type', 'source_language', 'message', 'transactions'],
  };
}

export function buildSystemPrompt({ lang, currency, today, categories }) {
  const langName = LANG_NAMES[lang] || LANG_NAMES['zh-CN'];
  return `You are the recognition engine of a personal bookkeeping app. Turn receipts, invoices, bill/statement screenshots or a spoken description into bookkeeping records.

Today is ${today}. The user's base currency is ${currency}. Output language: ${langName}.

Rules:
- Documents may be in any language. Write "merchant", "note" and "message" in ${langName}. Translate them; for well-known brands keep the original name next to the translation if it helps recognition (e.g. "罗森 Lawson").
- A single purchase receipt or invoice = ONE transaction. amount = the final total actually paid (after discounts and tax, before cash change). The note briefly lists the main items (at most ~4), e.g. "饭团、绿茶、炸鸡块等".
- For a single receipt also fill "items" with every purchased line (translated name, line total in the document currency; discounts as negative lines). Leave tax-included notes, change and payment lines out. For statements and speech "items" is [].
- "merchant" is the shop/payee name only; "note" is a short description and must not repeat the merchant.
- A statement or bill list (bank, credit card, Alipay, WeChat Pay, PayPal…) = one transaction per line item. Skip balances, subtotals and summary rows.
- Several images may belong to the same long receipt; do not double count.
- type: "expense" for spending; "income" for salary, refunds, red packets received, transfers received, interest, etc.
- amount is always positive, in the document's own currency. currency is its ISO 4217 code (¥ on a Japanese receipt is JPY; ¥/元 on a Chinese receipt is CNY).
- rate_to_base: 1 if the currency equals ${currency}; otherwise your best approximate exchange rate (1 unit of the document currency in ${currency}).
- category must be one of the ids below; pick the closest, fall back to "other" / "other_income".
  Expense ids: ${categories.expense.join(', ')}
  Income ids: ${categories.income.join(', ')}
- date as YYYY-MM-DD. If the year is missing infer the most recent past date; if no date at all use today. Resolve relative dates in speech ("昨天", "last Friday") against today. time as HH:MM or "".
- For speech, the text may contain several records ("午饭35，打车20") — return each one. If no currency is mentioned assume ${currency}.
- If nothing can be recognised, return an empty transactions array and explain why in "message".
Return only the structured result.`;
}

// 用户消息：附件（图片 / PDF）在前，说明文字在后
export function buildContent(files, text) {
  const content = [];
  for (const f of (files || []).slice(0, 6)) {
    if (IMAGE_TYPES.has(f.mediaType)) content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } });
    else if (f.mediaType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } });
  }
  const spoken = String(text || '').slice(0, 2000).trim();
  if (!content.length && !spoken) return null;
  content.push({
    type: 'text',
    text: spoken
      ? `Spoken bookkeeping input (transcribed):\n"""${spoken}"""`
      : 'Recognise the attached bill(s) and return the bookkeeping records.',
  });
  return content;
}

export function extractJson(text) {
  const s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('识别结果格式异常');
  return JSON.parse(s.slice(a, b + 1));
}
