#!/usr/bin/env node
/**
 * 像素立绘审查表：把 60 台机器的立绘排成一张能肉眼扫的对照页。
 *
 *   node scripts/sprite/review.mjs                # 2× 放大，出 _work/sprite-review/
 *   node scripts/sprite/review.mjs --scale 4      # 4× 放大，逐像素看清描边
 *
 * 为什么需要它
 * ------------
 * 立绘的每一根线都由数据算出（宽高比 ← 屏幕对角线、镜头数 ← 后摄数、
 * 圆角 ← 厚度、描边 ← 厚度）。改`generate.mjs` 里任何一个阈值或公式，
 * 影响的是**全部 60 张图** —— 而这类改动：
 *
 *   - 单测抓不到（layout() 返回的数仍然是合法数字，只是画错了）
 *   - 产物闸门抓不到（SVG 结构完整、无外链、无模糊）
 *   - 像素风扫描抓不到（圆角/模糊/字号都合规）
 *
 * 也就是说：改完阈值之后，除了「人看一眼」没有别的防线。
 * 这个脚本就是把那一眼变便宜 —— 一页看全60 台，按几何特征分组，
 * ���一台旁边直接写明它的几何依据（尺寸/厚度/后摄/折叠判据）。
 *
 * 分组是重点。按 id 排序只能看出「整体像不像」，
 * 按**几何特征**分组才能一眼看出「这一类画错了」：
 * 比如折叠档里混进了一台直板机，说明 isFoldable判据或尺寸字段出了问题。
 *
 * 产物落在 _work/（gitignore），不进版本库——它是给人看的，不是发布物。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout, writeSpriteFile } from './generate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(ROOT, '_work/sprite-review');

const argv = process.argv.slice(2);
const scaleArg = argv.indexOf('--scale');
const SCALE = scaleArg >= 0 ? Number(argv[scaleArg + 1]) || 2 : 2;

/**
 * 分组判据：**按驱动几何的字段**分，不按品牌分。
 * 品牌分组看不出画法问题，几何分组能 —— 同一组的机器应当长得非常像。
 */
function groupOf(L) {
  if (L.foldable) return 'foldable';
  const t = L.thicknessMm;
  if (t < 7) return 'thin'; // 圆角小、描边细
  if (t < 9) return 'mid';
  return 'thick'; // 圆角大、描边粗
}

const GROUP_LABEL = {
  foldable: '折叠机（宽高比 0.72，展开态双屏）',
  thin: '轻薄档（厚度 < 7mm，圆角最小、描边最细）',
  mid: '标准档（7–9mm）',
  thick: '厚实档（≥ 9mm，圆角最大、描边最粗）',
};

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 一台机器的判据说明：让人能核对「图上画的对不对」 */
function factsOf(L) {
  const bits = [
    `${L.sizeIn}″`,
    `厚 ${L.thicknessMm}mm`,
    `重 ${L.weightG}g`,
  ];
  // 后摄数量是镜头数的唯一依据，且「官网没写」走占位分支，必须标出来
  bits.push(L.camUnknown ? '后摄 ?（官网未公布，画占位）' : `后摄 ${L.rear}`);
  if (L.foldable) bits.push('折叠判据命中');
  return bits;
}

async function main() {
  const snapPath = join(ROOT, 'data/products.json');
  if (!existsSync(snapPath)) {
    console.error('❌ 找不到 data/products.json，先跑 node scripts/pipeline.mjs --data-only');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(snapPath, 'utf8'));
  const products = data.products ?? data;
  if (!products.length) {
    console.error('❌ 快照里没有机型');
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // 按几何分组，组内按 id 排 —— 保证同一批输入两次跑出的文件字节一致
  const rows = products
    .map((p) => ({ p, L: layout(p), group: groupOf(layout(p)) }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.p.id.localeCompare(b.p.id));

  // 出图：每台一张放大 SVG，供页面用 <img> 引（这样页面不必内联 60 段 SVG）
  for (const { p } of rows) {
    writeSpriteFile(p, join(OUT_DIR, `${p.id}.svg`), { scale: SCALE });
  }

  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group).push(r);
  }

  const sections = [...groups.entries()]
    .map(([g, list]) => {
      const ids = new Set(list.map((r) => r.p.id));
      const cs = rows
        .filter((r) => ids.has(r.p.id))
        .map(
          ({ p, L }) => `<figure class="card">
  <img src="${esc(p.id)}.svg" alt="${esc(p.nameZh || p.id)}" width="${160 * SCALE}" height="${(320 + 28) * SCALE}">
  <figcaption>
    <b>${esc(p.nameZh || p.name || p.id)}</b>
    <span class="id">${esc(p.id)}</span>
    <span class="facts">${esc(factsOf(L).join(' · '))}</span>
    <span class="geom">画布内 ${L.rect.w.toFixed(1)}×${L.rect.h.toFixed(1)}px · 圆角 ${L.rect.r.toFixed(1)} · 描边 ${L.strokeW.toFixed(1)}</span>
  </figcaption>
</figure>`,
        )
        .join('\n');
      return `<section>
  <h2>${esc(GROUP_LABEL[g] ?? g)}<span class="count">${list.length} 台</span></h2>
  <div class="grid">
${cs}
  </div>
</section>`;
    })
    .join('\n');

  // 覆盖面自述：哪台没画、后摄数据缺多少，一眼看到
  const camUnknown = products.filter((p) => layout(p).camUnknown);
  const foldable = products.filter((p) => layout(p).foldable);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>像素立绘审查表 · ${products.length} 台</title>
<style>
  /*审查页不是站点，不受像素风四条硬规矩约束（它不进产物、不入库），
     但仍然用等宽字体 + 单线框，方便逐像素核对。 */
  body { background: #14161a; color: #e6e6e6; font: 13px/1.6 ui-monospace, "Cascadia Code", Consolas, monospace; margin: 0; padding: 24px; }
  h1 { font-size: 15px; font-weight: 500; margin: 0 0 4px; }
  .meta { color: #8b8f96; margin-bottom: 20px; }
  .meta b { color: #e6e6e6; font-weight: 500; }
  section { margin-bottom: 28px; }
  h2 { font-size: 13px; font-weight: 500; color: #c8ccd2; border-bottom: 1px solid #2c3036;
       padding-bottom: 6px; margin: 0 0 12px; display: flex; justify-content: space-between; }
  .count { color: #8b8f96; }
  .grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .card { margin: 0; background: #1c1f24; border: 1px solid #2c3036; width: 356px; }
  .card img { display: block; image-rendering: pixelated; background: #14161a; }
  figcaption { padding: 8px 10px; border-top: 1px solid #2c3036; display: grid; gap: 2px; }
  figcaption b { font-weight: 500; color: #f0f0f0; }
  .id { color: #6b7078; }
  .facts { color: #9aa0a8; }
  .geom { color: #6b7078; }
  .note { color: #8b8f96; border-left: 2px solid #2c3036; padding-left: 10px; margin: 0 0 20px; }
</style>
</head>
<body>
<h1>像素立绘审查表</h1>
<p class="meta">
  <b>${products.length}</b> 台（苹果 ${products.filter((p) => p.brand === 'apple').length} / 华为 ${products.filter((p) => p.brand === 'huawei').length}）
  · 放大 <b>${SCALE}×</b> · 折叠判据命中 <b>${foldable.length}</b> 台
  · 后摄数量官网未公布 <b>${camUnknown.length}</b> 台（画占位圆+ 问号）
</p>
<p class="note">
  怎么用：<b>同组内的机器必须长得非常像</b>。若折叠档里混进一台直板机，说明 isFoldable 判据或
  display.sizeIn 字段出了问题；若某台的圆角明显比同组其它台大，说明厚度字段或圆角公式出了问题。
  图上每张卡下面写明了它的几何依据 —— 对不上就是 bug。
  <br>这个页面是给人看的，不进版本库（产物在 _work/）。
</p>
${sections}
</body>
</html>
`;

  writeFileSync(join(OUT_DIR, 'index.html'), html, 'utf8');

  console.log(`已生成审查表 → ${join(OUT_DIR, 'index.html')}`);
  console.log(`  ${products.length} 台 · ${SCALE}× 放大 · ${groups.size} 个几何分组`);
  for (const [g, list] of groups) console.log(`  ${GROUP_LABEL[g] ?? g}：${list.length} 台`);
  if (camUnknown.length) {
    console.log(`\n  ⚠️ 后摄数量官网未公布（走占位分支）：${camUnknown.map((p) => p.id).join(', ')}`);
  }
  console.log('\n  打开 index.html 肉眼核对：同组机器应当长得非常像。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});