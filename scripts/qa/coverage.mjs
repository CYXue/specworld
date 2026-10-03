#!/usr/bin/env node
/**
 * 覆盖率体检：回答「哪些字段大面积缺数据」。
 *
 *   node scripts/qa/coverage.mjs              # 全字段
 *   node scripts/qa/coverage.mjs --by-brand   # 拆品牌看（差异才是真信号）
 *   node scripts/qa/coverage.mjs --gaps-only  # 只列低于门槛的字段
 *
 * 为什么需要它
 * ------------
 * 缺数据分两种，混在一起看会误判：
 *
 *   **品牌性缺口** —— 苹果官网不公布电池容量。缺 13/60 台。
 *     这是官网的结构性事实，改解析器也补不上。正确的应对是「如实说明不排名」
 *     （derive.mjs 的覆盖率门槛已经这么做了）。
 *
 *   **解析性缺口** —— 全站只有2 台缺某个字段。
 *     这通常意味着解析器在某一种页面写法上失手了，是**可以修的bug**。
 *
 * 所以本脚本的价值不是列出「谁缺」，而是**把这两类分开**：
 * 品牌性缺口写进 docs/DATA-CONTRACT.md 作为已知事实，
 * 解析性缺口则是待修的队列。
 */

import { loadProducts, section, c, table, brandZh, pct, bar, ratioColor, verdict } from './lib.mjs';
import { REQUIRED_PATHS } from '../sync/validate.mjs';

const argv = process.argv.slice(2);
const BY_BRAND = argv.includes('--by-brand');
const GAPS_ONLY = argv.includes('--gaps-only');

/** 低于此覆盖率视为「值得查」 */
const GAP_THRESHOLD = 0.9;

const products = loadProducts();
const brands = [...new Set(products.map((p) => p.brand))];

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const has = (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);

/**
 * 要体检的字段清单从数据里反推，而不是写死。
 * 写死的问题是：新增字段忘了加进清单，覆盖率报告就假装它不存在。
 */
function fieldsOf(product) {
  const out = [];
  for (const [k, v] of Object.entries(product)) {
    if (['id', 'slug', 'brand', 'line', 'name', 'provenance', 'sources'].includes(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        if (k2 === 'rear' && Array.isArray(v2)) { out.push(`${k}.${k2}[]`); continue; }
        out.push(`${k}.${k2}`);
      }
    } else {
      out.push(k);
    }
  }
  return out;
}

/** 全体字段并集（顺序稳定：取第一台的顺序，再补后面新增的） */
const allFields = [];
{
  const seen = new Set();
  for (const p of products) {
    for (const f of fieldsOf(p)) {
      if (seen.has(f)) continue;
      seen.add(f);
      allFields.push(f);
    }
  }
}

const isRequired = new Set(REQUIRED_PATHS);
const hasVal = (p, f) => {
  if (f.endsWith('[]')) return has(get(p, f.slice(0, -2)));
  return has(get(p, f));
};

const covOf = (list, f) => (list.length ? list.filter((p) => hasVal(p, f)).length / list.length : 0);

section('字段覆盖率总览');
console.log(`池子 ${products.length} 台 · 共 ${allFields.length} 个字段`);
console.log(c.dim('覆盖率 = 有该字段值的机型数 / 池子大小。缺数据记为「缺」，不是 0。'));
console.log('');
console.log(c.dim('绿色 ≥90% ｜ 黄色 ≥60% ｜ 红色 <60%。★ = 闸门必填字段。'));

const rows = allFields
  .map((f) => ({ f, cov: covOf(products, f), missing: products.length - products.filter((p) => hasVal(p, f)).length }))
  .filter((r) => !GAPS_ONLY || r.cov < GAP_THRESHOLD || isRequired.has(r.f))
  .sort((a, b) => a.cov - b.cov || a.f.localeCompare(b.f));

table(
  ['', '字段', '覆盖率', '已填/总数', '缺', '', '品牌差异'],
  rows.map((r) => {
    const byBrand = brands
      .map((b) => {
        const list = products.filter((p) => p.brand === b);
        return `${brandZh(b)} ${pct(covOf(list, r.f), 0)}`;
      })
      .join('  ');
    // 品牌差异大 = 一个品牌全有一个全无 = 结构性；都低 = 可能都没公布
    const spreads = brands.map((b) => covOf(products.filter((p) => p.brand === b), r.f));
    const spread = Math.max(...spreads) - Math.min(...spreads);
    const gapMark = spread > 0.5 ? c.yellow('← 一方全无') : '';
    return [
      isRequired.has(r.f) ? c.yellow('★') : ' ',
      r.f,
      ratioColor(r.cov)(pct(r.cov).padStart(6)),
      `${products.length - r.missing}/${products.length}`,
      r.missing ? c.yellow(String(r.missing)) : '0',
      bar(r.cov, 12),
      `${byBrand}${gapMark}`,
    ];
  }),
);

/* ---------------- 分类：结构性 vs 解析性 ---------------- */

section('缺口分类');

/**
 * 分类的判据必须是「谁有谁没有」，不是「谁缺」。
 *
 * 踩过的坑（2026-10-03 第一版）：我最初按「缺失台数最多的品牌是结构性」来分，
 * 结果把苹果 13 台的正常字段（chipset.name / body.ipRating / display.protection）
 * 全判成「解析器失手」——因为苹果台数少，任何苹果独有的字段看起来都像「只有它缺」。
 * 但真相正好相反：**是华为官网不公布芯片制程、机身材料、防护玻璃**，
 * 苹果 13 台全都有值。所以判据必须是「某品牌覆盖率接近 0、另一品牌接近 1」。
 */
const gaps = allFields
  .map((f) => {
    const cov = covOf(products, f);
    if (cov >= GAP_THRESHOLD) return null;
    const per = brands.map((b) => ({ b, cov: covOf(products.filter((p) => p.brand === b), f) }));
    const hi = Math.max(...per.map((x) => x.cov));
    const lo = Math.min(...per.map((x) => x.cov));
    return {
      f,
      cov,
      hiBrand: per.find((x) => x.cov === hi)?.b,
      hasBrands: per.filter((x) => x.cov > 0.5).map((x) => brandZh(x.b)),
      noneBrands: per.filter((x) => x.cov <= 0.5).map((x) => brandZh(x.b)),
      ids: products.filter((p) => !hasVal(p, f)).map((p) => p.id),
      // 一个品牌接近满、另一个接近零 → 官网差异（结构性）
      // 全站都缺 → 无人公布，可能是「没人公布」也可能是「没人解析」
      type: hi - lo > 0.5 ? 'structural' : hi > 0.5 ? 'partial' : 'nobody',
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.cov - b.cov);

/** 结构性：品牌间一个满一个零 —— 官网不公布，改解析器也补不上 */
const structural = gaps.filter((g) => g.type === 'structural');
/** 全站皆零：要么官网确实没人公布，要么解析器对所有品牌都失手了 —— 需要人判断 */
const nobody = gaps.filter((g) => g.type === 'nobody');
/** 同一品牌内部分化：这一类最可疑，通常是某几种页面写法没解析到 */
const partial = gaps.filter((g) => g.type === 'partial');

console.log(`${c.yellow('① 结构性缺口')} ${structural.length} 个 —— 一个品牌全有、另一个全无，是官网不公布：`);
if (!structural.length) console.log(c.dim('  （无）'));
for (const g of structural) {
  console.log(`  ${g.f.padEnd(28)} ${pct(g.cov).padStart(6)}  ${g.hasBrands.join('/')} 有，${g.noneBrands.join('/')} 全缺`);
}
console.log(c.dim('  应对：覆盖率门槛已在 derive.mjs 生效（不发奖杯），页面如实说明「官方数据不足」。'));

console.log('');
console.log(`${c.yellow('② 全站皆零')} ${nobody.length} 个 —— 没人公布，或解析器对所有品牌都失手：`);
if (!nobody.length) console.log(c.dim('  （无）'));
for (const g of nobody) {
  console.log(`  ${g.f.padEnd(28)} ${pct(g.cov).padStart(6)}  缺 ${g.ids.length} 台`);
}
console.log(c.dim('  应对：先确认官网到底有没有这个字段（翻 _work/*.raw.json 的 raw 原文），'));
console.log(c.dim('        官网有而我们没有 → 解析器缺分支；官网也没有 → 写进 DATA-CONTRACT.md 当已知事实。'));

console.log('');
console.log(`${c.blue('③ 同品牌内部分化')} ${partial.length} 个 —— 最可疑，通常是某几种页面写法漏了解析：`);
if (!partial.length) console.log(c.dim('  （无）'));
for (const g of partial) {
  console.log(`  ${g.f.padEnd(28)} ${pct(g.cov).padStart(6)}  缺 ${g.ids.length} 台`);
  console.log(c.dim(`     ${g.ids.slice(0, 6).join(', ')}${g.ids.length > 6 ? ` …共 ${g.ids.length} 台` : ''}`));
}
console.log(c.dim('  应对：看这批机型的 raw 原文与能解析出来的有何不同，通常能一眼看出页面写法差异。'));

/* ---------------- 品牌差异 ---------------- */

if (BY_BRAND) {
  section('按品牌拆开看');
  console.log(c.dim('同一字段在两个品牌间差得多，通常意味着「某一方不公布」，而不是「解析器对某一方失手」。'));
  console.log('');

  const brandRows = [];
  for (const f of allFields) {
    const covs = brands.map((b) => ({ b, cov: covOf(products.filter((p) => p.brand === b), f) }));
    const spread = Math.max(...covs.map((x) => x.cov)) - Math.min(...covs.map((x) => x.cov));
    if (spread < 0.3) continue;
    brandRows.push({ f, spread, covs });
  }
  brandRows.sort((a, b) => b.spread - a.spread);

  table(
    ['字段', ...brands.map((b) => brandZh(b)), '差距'],
    brandRows.map((r) => [
      r.f,
      ...r.covs.map((x) => ratioColor(x.cov)(pct(x.cov).padStart(6))),
      c.yellow(pct(r.spread, 0)),
    ]),
  );
  console.log(c.dim(`\n共 ${brandRows.length} 个字段存在 ≥30% 的品牌差异。`));
}

/* ---------------- 必填字段专项 ---------------- */

section('闸门必填字段体检');
const reqRows = REQUIRED_PATHS.map((f) => {
  const list = products.filter((p) => hasVal(p, f));
  const noProv = list.filter((p) => !p.provenance?.[f]);
  return { f, cov: covOf(products, f), count: list.length, noProv: noProv.length };
});
table(
  ['必填字段', '覆盖率', '已填', '缺 provenance'],
  reqRows.map((r) => [
    r.f,
    ratioColor(r.cov)(pct(r.cov).padStart(6)),
    `${r.count}/${products.length}`,
    r.noProv ? c.red(String(r.noProv)) : c.green('0'),
  ]),
);
const anyMissing = reqRows.filter((r) => r.cov < 1);
if (anyMissing.length) {
  console.log('');
  console.log(c.yellow(`注意：${anyMissing.length} 个必填字段覆盖率 <100%。`));
  console.log(c.dim('  闸门第 12 条会在覆盖率较上一版下跌超过 5 个百分点时拦下，'));
  console.log(c.dim('  但「一直缺这几台」不会触发它——那是官网事实，不是回归。'));
}

verdict(
  partial.length === 0,
  partial.length === 0 ? '没有「同品牌内部分化」的字段，解析器未见失手' : '',
  `${partial.length} 个字段在同一品牌内部分化，见上方 ③ 清单`,
);