#!/usr/bin/env node
/**
 * 阵容体检：回答「产品线里有没有过时机型混进在售池」。
 *
 *   node scripts/qa/stale-lineup.mjs# 全部产品线
 *   node scripts/qa/stale-lineup.mjs --age 720         # 超过 720 天算过时
 *   node scripts/qa/stale-lineup.mjs --same-generation # 只看同代竞品互比
 *
 * 为什么需要它
 * ------------
 * 池子由「发布日期窗口」决定（默认 windowStart= 2024-09-01），窗口是固定的。
 * 但时间会走：今天在窗口内的机型，一年后会变成「两年前的手机」。
 * 届时会出现两个问题，而**没有人会主动来看**：
 *
 *   1. 排行榜被老机型占榜——一颗 2021 年的芯片仍然「最轻薄」，
 *      因为窗口里没有更薄的。不发冠比发错冠好，但发冠理由不成立更糟。
 *   2. 「今日格局」这个标题名不副实——榜首是三年前的机器。
 *
 * 所以这个脚本回答：**池子里最老的是谁？各产品线的首尾跨度是多少？
 * 有没有同代竞品在互相碾压（说明该换代了）？**
 *
 * 它不自动删数据（那是 sync/index.mjs 的窗口过滤职责，且需要人工确认），
 * 只负责把「该看这件事」这件事摆到眼前。
 */

import { metricValue } from '../lib/derive.mjs';
import { pick } from '../lib/specs.mjs';
import { loadProducts, section, c, table, brandZh, pct, verdict } from './lib.mjs';

const argv = process.argv.slice(2);
const ageArg = argv.indexOf('--age');
const MAX_AGE_DAYS = ageArg >= 0 ? Number(argv[ageArg + 1]) : 730;
const SAME_GEN = argv.includes('--same-generation');

const products = loadProducts();
const today = Date.now();
const daysSince = (p) =>
  p.releaseDate ? Math.floor((today - Date.parse(p.releaseDate)) / 86400000) : null;

/* ------------------------------------------------------------------ *
 * 1. 池子年龄分布
 * ------------------------------------------------------------------ */
section('在售池年龄分布');

const dated = products.filter((p) => p.releaseDate).map((p) => ({ p, d: daysSince(p) }));
const undated = products.filter((p) => !p.releaseDate);

if (undated.length) {
  console.log(
    c.yellow(
      `⚠️  ${undated.length} 台没有发布日期，无法判断时新：${undated
        .map((p) => p.name)
        .slice(0, 5)
        .join('、')}`,
    ),
  );
  console.log(
    c.dim('   数据来自 data/release-dates.json（人工核对的取证表），补进去就能参与本检查。'),
  );
  console.log('');
}

/**
 * 年龄分桶。按**下界**筛（lo <= d <= hi），而不是只用上界——
 * 第一版只写 max，结果「2–3 年」和「超过 3 年」都是 60，看着像 bug 其实是筛选条件错了。
 */
const buckets = [
  { label: '一年内', lo: 0, hi: 365 },
  { label: '1–2 年', lo: 366, hi: 730 },
  { label: '2–3 年', lo: 731, hi: 1095 },
  { label: '超过 3 年', lo: 1096, hi: Infinity },
];
const dist = buckets.map((b) => ({
  label: b.label,
  n: dated.filter((x) => x.d >= b.lo && x.d <= b.hi).length,
}));
console.log(
  `池内 ${products.length} 台 · 有发布日期 ${dated.length} 台 · 窗口起点见 data/products.json 的 windowStart`,
);
console.log('');
// 分桶是互斥的，加起来必须等于总数——不检查的话桶写错了我也看不见
const bucketSum = dist.reduce((a, b) => a + b.n, 0);
if (dated.length && bucketSum !== dated.length) {
  console.log(c.red(`⚠️  分桶合计 ${bucketSum} ≠ 有发布日期 ${dated.length} 台，分桶条件写错了`));
  console.log('');
}
table(
  ['发布至今', '台数', '占比', ''],
  dist.map((b) => [
    b.label,
    String(b.n),
    pct(b.n / Math.max(dated.length, 1)),
    '█'.repeat(Math.round((b.n / Math.max(dated.length, 1)) * 24)),
  ]),
);

/* ------------------------------------------------------------------ *
 * 2. 产品线：同代是否还有竞争力
 * ------------------------------------------------------------------ */
section('产品线阵容');

const lines = new Map();
for (const p of products) {
  const key = `${p.brand} / ${p.line ?? '未分线'}`;
  if (!lines.has(key)) lines.set(key, []);
  lines.get(key).push(p);
}

const lineRows = [];
for (const [key, list] of lines) {
  const ds = list
    .map(daysSince)
    .filter((d) => d !== null)
    .sort((a, b) => b - a);
  const newest = list.reduce(
    (a, b) => (Date.parse(b.releaseDate ?? 0) > Date.parse(a.releaseDate ?? 0) ? b : a),
    list[0],
  );
  lineRows.push({
    key,
    n: list.length,
    newest: newest.name,
    newestDate: newest.releaseDate ?? '—',
    // 该产品线里最老的一台是否已经过时
    oldestDays: ds.length ? ds[0] : null,
    staleCount: ds.filter((d) => d > MAX_AGE_DAYS).length,
    staleRate: ds.length ? ds.filter((d) => d > MAX_AGE_DAYS).length / ds.length : 0,
  });
}
lineRows.sort((a, b) => b.staleRate - a.staleRate || b.n - a.n);

table(
  ['产品线', '台数', '最新一台', '最新发布', '最老(天)', '过时台数'],
  lineRows.map((r) => [
    r.key,
    String(r.n),
    r.newest,
    r.newestDate,
    r.oldestDays === null ? '—' : String(r.oldestDays),
    r.staleCount ? c.yellow(`${r.staleCount}/${r.n}`) : c.green('0'),
  ]),
);

/* ------------------------------------------------------------------ *
 * 3. 全池最老的机型——它们在撑哪些头衔
 * ------------------------------------------------------------------ */
section(`过时机型（超过 ${MAX_AGE_DAYS} 天）`);

const stale = dated.filter((x) => x.d > MAX_AGE_DAYS).sort((a, b) => b.d - a.d);
if (!stale.length) {
  console.log(c.green(`✅ 池内没有超过 ${MAX_AGE_DAYS} 天的机型。`));
} else {
  console.log(`${stale.length} 台。这些机型仍在参与全部排名与分位计算——`);
  console.log(c.dim('每一条都值得看一眼：它现在的名次，三年后还成立吗？'));
  console.log('');
  table(
    ['机型', '品牌', '发布于', '天数', '当前该维度排名'],
    stale
      .slice(0, 20)
      .map(({ p, d }) => [p.name, brandZh(p.brand), p.releaseDate, String(d), rankNotes(p)]),
  );
  if (stale.length > 20)
    console.log(c.dim(`\n…另有 ${stale.length - 20} 台，用 --age 调阈值或看完整清单`));

  // 重点提示：这些老机型是否正在撑着头衔
  console.log('');
  console.log(c.bold('它们撑着的头衔：'));
  const holders = stale
    .map(({ p }) => {
      const notes = rankNotes(p);
      return notes === '—' ? null : { name: p.name, notes };
    })
    .filter(Boolean);
  if (!holders.length) {
    console.log(c.dim('  没有。过期机型目前不占任何榜首。'));
  } else {
    for (const h of holders) console.log(`  ${c.yellow('·')} ${h.name} — ${h.notes}`);
    console.log('');
    console.log(c.dim('  某头衔被一台过时机型占着，说明该维度已经很久没有新机型参赛。'));
    console.log(c.dim('  这不是数据错误，是产品事实——但它让「最轻」这类标题失去了时效性。'));
  }
}

/* ------------------------------------------------------------------ *
 * 4. 同代互比：自家新一代是否已被自家上一代压制
 * ------------------------------------------------------------------ */
if (SAME_GEN) {
  section('同代互比（按品牌分组，看最新 5 台的尺寸/重量/电池）');

  for (const b of [...new Set(products.map((p) => p.brand))]) {
    const list = products
      .filter((p) => p.brand === b && p.releaseDate)
      .sort((a, c) => Date.parse(c.releaseDate) - Date.parse(a.releaseDate))
      .slice(0, 5);
    if (!list.length) continue;
    console.log('');
    console.log(`${c.bold(brandZh(b))}`);
    table(
      ['机型', '发布', '厚度', '重量', '电池', '屏幕'],
      list.map((p) => [
        p.name,
        p.releaseDate,
        fmt(pick(p, 'body.thicknessMm'), 'mm'),
        fmt(pick(p, 'body.weightG'), 'g'),
        fmt(pick(p, 'battery.capacityMah'), 'mAh'),
        fmt(pick(p, 'display.sizeIn'), '"'),
      ]),
    );
  }
  console.log('');
  console.log(c.dim('读法：厚度/重量/电池越小越好，屏幕越大越好。'));
  console.log(
    c.dim('  若最新一台在某个维度上全面不如上一代，多半是官网还没更新或新机确实没提升，'),
  );
  console.log(c.dim('  两种情况都不该由本脚本下结论——去看 _work/*.raw.json 的原文确认。'));
}

section('结论');
const worstStale = lineRows[0];
console.log(`池子年龄中位数 ${median(dated.map((x) => x.d))} 天`);
console.log(
  `过时机型 ${stale.length}/${dated.length} 台` +
    (worstStale?.staleRate > 0
      ? `，最严重的产品线是 ${worstStale.key}（${pct(worstStale.staleRate, 0)} 过时）`
      : ''),
);

verdict(
  stale.length === 0,
  `池内机型都在 ${MAX_AGE_DAYS} 天以内`,
  `${stale.length} 台机型已超过 ${MAX_AGE_DAYS} 天，继续占着排名；建议复核窗口起点 windowStart`,
);

/* ---------------- 局部 ---------------- */

/** 这台机在哪些维度上拿第一（用来判断它撑着什么头衔） */
function rankNotes(p) {
  const notes = [];
  const dims = [
    ['最轻', 'weightG', 'low'],
    ['最薄', 'thicknessMm', 'low'],
    ['屏幕最大', 'screenIn', 'high'],
    ['电池最大', 'batteryMah', 'high'],
    ['充电最快', 'wiredChargeW', 'high'],
  ];
  for (const [label, key, dir] of dims) {
    const v = metricValue(p, key);
    if (v === null) continue;
    const best = products.reduce((acc, q) => {
      const qv = metricValue(q, key);
      if (qv === null) return acc;
      if (!acc) return { q, qv };
      const better = dir === 'low' ? qv < acc.qv : qv > acc.qv;
      return better ? { q, qv } : acc;
    }, null);
    if (best?.q.id === p.id) notes.push(label);
  }
  return notes.length ? notes.join(' / ') : '—';
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function fmt(v, unit) {
  return v === null || v === undefined || v === '' ? c.dim('—') : `${v} ${unit}`;
}
