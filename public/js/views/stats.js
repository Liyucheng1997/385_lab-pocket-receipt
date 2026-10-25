// 统计：周 / 月 / 年 趋势 + 分类排行
import { h, seg, openSheet, catTile, catName } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { txBetween, sum } from '../store.js';
import { money, moneyCompact, ymd, parseYmd, monthRange, monthLabel, shortMonth, shortDate, weekdayShort, addDays, startOfWeek } from '../format.js';
import { groupedList } from './home.js';

const view = { period: 'month', offset: 0, type: 'expense' };
const SVG = 'http://www.w3.org/2000/svg';

function svg(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}

// 计算当前周期：区间、桶（每根柱子）和标题
function periodInfo() {
  const today = new Date();
  if (view.period === 'week') {
    const start = addDays(startOfWeek(today), view.offset * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return {
      from: ymd(days[0]), to: ymd(days[6]),
      title: t('stats.weekOf', { a: shortDate(ymd(days[0])), b: shortDate(ymd(days[6])) }),
      buckets: days.map((d) => ({ key: ymd(d), label: weekdayShort(d), tip: shortDate(ymd(d)), match: (tx) => tx.date === ymd(d) })),
      unitDays: true,
    };
  }
  if (view.period === 'month') {
    const d = new Date(today.getFullYear(), today.getMonth() + view.offset, 1);
    const [from, to] = monthRange(d.getFullYear(), d.getMonth());
    const n = parseYmd(to).getDate();
    const marks = new Set([1, 5, 10, 15, 20, 25, n]);
    return {
      from, to, title: monthLabel(d.getFullYear(), d.getMonth()),
      buckets: Array.from({ length: n }, (_, i) => {
        const key = ymd(new Date(d.getFullYear(), d.getMonth(), i + 1));
        return { key, label: marks.has(i + 1) ? String(i + 1) : '', tip: shortDate(key), match: (tx) => tx.date === key };
      }),
      unitDays: true,
    };
  }
  const y = today.getFullYear() + view.offset;
  return {
    from: `${y}-01-01`, to: `${y}-12-31`, title: String(y),
    buckets: Array.from({ length: 12 }, (_, m) => {
      const p = `${y}-${String(m + 1).padStart(2, '0')}`;
      return { key: p, label: shortMonth(m), tip: monthLabel(y, m), match: (tx) => tx.date.startsWith(p) };
    }),
    unitDays: false,
  };
}

function barChart(buckets, values, width) {
  const H = 150;
  const top = 18;
  const bottom = 22;
  const plotH = H - top - bottom;
  const n = buckets.length;
  const slot = width / n;
  const barW = Math.max(3, Math.min(22, slot * 0.56));
  const max = Math.max(...values, 0);
  const todayKey = ymd();

  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'chart-tip' });
  const s = svg('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'img' });

  // 网格：基线 + 最大值线
  for (const f of [0, 0.5, 1]) {
    const y = top + plotH * (1 - f);
    s.append(svg('line', { x1: 0, x2: width, y1: y, y2: y, class: f === 0 ? 'axis' : 'grid' }));
  }
  if (max > 0) {
    const lbl = svg('text', { x: width, y: top - 6, class: 'grid-label', 'text-anchor': 'end' });
    lbl.textContent = moneyCompact(max);
    s.append(lbl);
  }

  const bars = [];
  buckets.forEach((b, i) => {
    const v = values[i];
    const cx = slot * i + slot / 2;
    const bh = max > 0 ? Math.max(v > 0 ? 3 : 0, (v / max) * plotH) : 0;
    const x = cx - barW / 2;
    const y = top + plotH - bh;
    const r = Math.min(4, barW / 2, bh);
    if (bh > 0) {
      const path = svg('path', {
        d: `M${x},${top + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${top + plotH} Z`,
        class: 'bar',
      });
      s.append(path);
      bars[i] = path;
    }
    if (b.label) {
      const tx = svg('text', { x: cx, y: H - 6, class: `x-label ${b.key === todayKey ? 'today' : ''}`, 'text-anchor': 'middle' });
      tx.textContent = b.label;
      s.append(tx);
    }
    // 命中区域比柱子大
    const hit = svg('rect', { x: slot * i, y: 0, width: slot, height: H, fill: 'transparent' });
    const show = () => {
      wrap.classList.add('hovering');
      bars.forEach((p) => p && p.classList.remove('hi'));
      bars[i]?.classList.add('hi');
      tip.replaceChildren(h('span', null, b.tip), h('b', { class: 'tabular' }, money(v)));
      tip.style.left = `${Math.min(Math.max(cx, 50), width - 50)}px`;
      tip.style.top = `${Math.max(0, y - 46)}px`;
      tip.classList.add('show');
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerdown', show);
    s.append(hit);
  });
  wrap.addEventListener('pointerleave', () => {
    wrap.classList.remove('hovering');
    bars.forEach((p) => p && p.classList.remove('hi'));
    tip.classList.remove('show');
  });
  wrap.append(s, tip);
  return wrap;
}

export function renderStats(root, rerender) {
  const info = periodInfo();
  const list = txBetween(info.from, info.to).filter((tx) => tx.type === view.type);
  const total = sum(list, view.type);
  const values = info.buckets.map((b) => list.reduce((s, tx) => (b.match(tx) ? s + tx.amount : s), 0));

  // 日均按已经过去的天数计算
  const todayStr = ymd();
  let avg;
  if (info.unitDays) {
    const elapsed = info.buckets.filter((b) => b.key <= todayStr).length || info.buckets.length;
    avg = total / elapsed;
  } else {
    const months = info.buckets.filter((b) => `${b.key}-01` <= todayStr).length || 12;
    avg = total / months;
  }

  const byCat = new Map();
  for (const tx of list) byCat.set(tx.category, (byCat.get(tx.category) || 0) + tx.amount);
  const ranking = [...byCat].sort((a, b) => b[1] - a[1]);
  const top = ranking[0]?.[1] || 1;
  const typeLabel = t(view.type);
  const chartWidth = Math.min(window.innerWidth, 480) - 72;

  const set = (patch) => { Object.assign(view, patch); rerender(); };

  root.replaceChildren(
    h('header', { class: 'page-head' },
      h('h1', { class: 'page-title' }, t('tab.stats')),
      seg([{ value: 'expense', label: t('expense') }, { value: 'income', label: t('income') }], view.type, (v) => set({ type: v }), 'seg-sm')),
    h('div', { class: 'stats-period' },
      seg([
        { value: 'week', label: t('stats.week') },
        { value: 'month', label: t('stats.month') },
        { value: 'year', label: t('stats.year') },
      ], view.period, (v) => set({ period: v, offset: 0 }), 'seg-wide'),
      h('div', { class: 'period-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'prev', onclick: () => set({ offset: view.offset - 1 }) }, icon('left', 18)),
        h('span', { class: 'tabular' }, info.title),
        h('button', { class: 'icon-btn', 'aria-label': 'next', disabled: view.offset >= 0, onclick: () => set({ offset: view.offset + 1 }) }, icon('right', 18)))),
    h('div', { class: 'card stat-card' },
      h('div', { class: 'stat-tiles' },
        h('div', null, h('span', null, t('stats.total', { t: typeLabel })), h('b', { class: 'tabular' }, money(total))),
        h('div', null, h('span', null, info.unitDays ? t('stats.avg') : t('stats.avgMonth')), h('b', { class: 'tabular' }, money(avg))),
        h('div', null, h('span', null, t('stats.count')), h('b', { class: 'tabular' }, String(list.length)))),
      h('div', { class: 'card-sub' }, t('stats.trend')),
      barChart(info.buckets, values, chartWidth)),
    h('div', { class: 'card rank-card' },
      h('div', { class: 'card-title' }, t('stats.ranking')),
      ranking.length
        ? ranking.map(([cat, amt]) => h('button', { class: 'rank-row', onclick: () => openCategory(cat, list, info.title) },
            catTile(cat, { size: 36 }),
            h('div', { class: 'rank-main' },
              h('div', { class: 'rank-line' },
                h('span', null, catName(cat), h('em', { class: 'tabular' }, `${((amt / total) * 100).toFixed(1)}%`)),
                h('b', { class: 'tabular' }, money(amt))),
              h('div', { class: 'bar' }, h('i', { style: { width: `${(amt / top) * 100}%` } })))))
        : h('div', { class: 'empty small' }, icon('chart', 30, 1.4), t('stats.empty', { t: typeLabel }))),
  );
}

function openCategory(cat, list, title) {
  const items = list.filter((tx) => tx.category === cat);
  openSheet({ title: `${catName(cat)} · ${title}`, full: true, content: h('div', { class: 'cat-detail' }, groupedList(items)) });
}
