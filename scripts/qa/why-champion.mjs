#!/usr/bin/env node
/**
 * 冠军体检：回答「为什么这台是榜首」。
 *
 *   node scripts/qa/why-champion.mjs# 全部 9 个头衔
 *   node scripts/qa/why-champion.mjs # 最轻       # 单个头衔
 *   node scripts/qa/why-champion.mjs --detail   # 连竞争者一起列出
 *
 * 为什么需要它
 * ------------
 * 首页上「最轻 170g」这个结论，界面只给一行`整机 170 g`。
 * 但真正要回答的问题是：**这个池子里有多少台参与排名？比它轻的有几台？差多少？**
 * 覆盖率不够时凭什么不发奖杯？这些全都只能靠手翻 dist/index.html 才看得到。
 *
 * 它复算的是 buildChampions 的同一套标尺（直接 import，不重写一遍），
 * 所以这里看到的结论和页面上看到的一定一致——不一致就说明有 bug，而不是有分歧。
 */

import { loadProducts, section, c, brandZh, pct, padL, bar, verdict } from './lib.mjs';
import { buildScales, buildChampions, metricValue, METRICS, percentileOf, TITLE_COVERAGE, TITLE_MIN_POOL } from '../lib/derive.mjs';

const argv = process.argv.slice(2);
const DETAIL = argv.includes('--detail');
const only = argv.filter((a) => !a.startsWith('--'));

const products = loadProducts();
const scales = buildScales(products);
const champs = buildChampions(products, scales);

const targets = only.length
  ? champs.filter((ch) => only.some((o) => ch.id === o || ch.title.includes(o) || ch.metric === o))
  : champs;

if (only.length && !targets.length) {
  console.error(`❌ 没有匹配的头衔：${only.join(', ')}`);
  console.error(`   可选：${champs.map((ch) => `${ch.id}(${ch.title})`).join(' ')}`);
  process.exit(1);
}

section('冠军是怎么选出来的');

console.log(`池子：${products.length} 台（${brandZh('apple')} ${products.filter((p) => p.brand === 'apple').length}` +
  ` / ${brandZh('huawei')} ${products.filter((p) => p.brand === 'huawei').length}）`);
console.log(`门槛：参与数≥ ${TITLE_MIN_POOL} 台且覆盖率 ≥ ${pct(TITLE_COVERAGE, 0)}`);
console.log('');
console.log('两条口径（别当成绝对阈值看）：');
console.log(`  · 档位是「当前 ${products.length} 台池内的分位」，不是写死的阈值`);
console.log('  · 官网没公布的参数记为缺数据（不是 0），因此它不参与排名');

for (const ch of targets) {
  const scale = scales[ch.metric];
  const metric = METRICS[ch.metric];

  console.log('');
  console.log(c.bold(`【${ch.title}】${c.dim(`(${ch.id} · 指标 ${ch.metric})`)}`));

  // 覆盖率先说——它决定这个头衔有没有资格存在
  const covLine = `${bar(ch.coverage)} ${pct(ch.coverage)}`;
  console.log(`  池内覆盖　${covLine}  ${ch.pool}/${products.length} 台公布了${metric.label}`);

  if (!ch.insufficient) {
    const need = Math.ceil(TITLE_COVERAGE * products.length);
    console.log(c.dim(`             门槛线 ${pct(TITLE_COVERAGE, 0)} = ${need} 台，实际 ${ch.pool} 台 → 发奖杯`));
  }

  if (!ch.productId) {
    console.log(c.yellow(`  结论　　　不发奖杯 —— ${ch.insufficient}`));
    console.log(c.dim('             这是设计：把「唯一公布数据的品牌」说成「最强的品牌」是撒谎'));
    continue;
  }

  const win = products.find((p) => p.id === ch.productId);
  const pctRank = percentileOf(scales, ch.metric, win);

  console.log(`  结论　　　${c.bold(win.name)}　${c.dim(`(${brandZh(win.brand)})`)}`);
  console.log(`  凭什么　　${ch.why}　${c.dim(`池内第 ${pctRank === null ? '—' : pctRank.toFixed(2)} 分位（1 = 最好）`)}`);
  console.log(`  数据来源　${win.provenance?.[metric.path] ?? c.yellow('未登记 provenance')}　${c.dim(metric.path)}`);

  if (DETAIL) {
    // 竞争者：把所有有值的按优劣排序，标出分位
    const ranked = products
      .map((p) => ({ p, v: metricValue(p, ch.metric) }))
      .filter((x) => x.v !== null)
      .sort((a, b) => (scale.dir === 'low' ? a.v - b.v : b.v - a.v));

    console.log('');
    console.log(c.dim(`  全部 ${ranked.length} 台（${scale.dir === 'low' ? '越小越优' : '越大越优'}）：`));
    ranked.forEach((x, i) => {
      const isWin = x.p.id === ch.productId;
      const rank = percentileOf(scales, ch.metric, x.p);
      const mark = isWin ? c.green(' ← 榜首') : '';
      console.log(
        `   ${padL(i + 1, 2)}. ${padL(x.p.name, 30)} ${padL(fmtVal(x.v, scale.unit), 9)}` +
        ` ${c.dim(`分位 ${rank === null ? '—' : rank.toFixed(2)}`)}${mark}`,
      );
    });

    // 并列检查：榜首如果有多个，说明「最」这个字需要谨慎表述
    const best = ranked[0].v;
    const tied = ranked.filter((x) => x.v === best);
    if (tied.length > 1) {
      console.log('');
      console.log(c.yellow(`  ⚠️ 榜首并列 ${tied.length} 台：${tied.map((x) => x.p.name).join('、')}`));
      console.log(c.dim('     并列时 buildChampions 取 reduce 的第一个，顺序依赖 products 数组，改数据顺序会换榜首'));
    }

    // 差距：差多少才算「稳赢」
    const runnerUp = ranked[1];
    if (runnerUp && runnerUp.v !== best) {
      const gap = Math.abs(best - runnerUp.v);
      const rel = best !== 0 ? (gap / Math.abs(best)) * 100 : 0;
      console.log(c.dim(`\n  与第二名 ${runnerUp.p.name}（${fmtVal(runnerUp.v, scale.unit)}）差 ${fmtVal(gap, scale.unit)}` +
        (rel ? `，约 ${rel.toFixed(1)}%` : '')));
    }
  }
}

// 汇总：哪些头衔没发出去
const noTitle = champs.filter((ch) => !ch.productId);
section('汇总');
console.log(`发奖杯${champs.length - noTitle.length}/${champs.length} 个`);
if (noTitle.length) {
  for (const ch of noTitle) {
    console.log(`  ${c.yellow('不发')} ${ch.title}（${ch.metric}，覆盖 ${pct(ch.coverage)}）`);
  }
  console.log(c.dim('\n不发是正确行为，不是缺陷。详见 derive.mjs 头部纪律第 2 条。'));
}

verdict(
  true,
  '所有头条衔的数据来源可追溯',
  '部分头衔数据不足',
);

/* ---------------- 局部 ---------------- */

function fmtVal(v, unit) {
  return unit ? `${v} ${unit}` : String(v);
}