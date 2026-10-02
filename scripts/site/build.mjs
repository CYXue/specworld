import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * 静态站骨架（首版最小闭环）
 * ============================================================================
 * 读 data/products.json + _work/derived.json + data/sprites/*.svg，产出：
 *   _work/site/index.html              首页：头衔 + 一句话定位 + 机型卡墙（立缩图）
 *   _work/site/products/<id>.html     每台机型一张卡页（规格速览）
 *   _work/site/compare/<a>-vs-<b>.html  对比页（复用 render.mjs 的对比主体）
 *   _work/site/all.html                全部机型列表（按品牌分组）
 *
 * 注：像素立绘曾作为 v1 范围（docs/COMPARE-DESIGN.md 第五节），但产品侧判定效果不佳，已移除；
 *    生成器代码仍保留在 scripts/sprite/ 与 data/sprites/，未接进任何页面。
 *
 * 纪律：
 *   - 零外链、零行为脚本（每个页面自包含），宽屏/窄屏断点齐全
 *   - 文案由数据套模板（persona / 头衔），不调用 LLM，逐字可追溯
 *   - 无数据处显示「官方未公布」，永不显示 0 / —
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
const products = P.products ?? P;
const derivedPath = join(ROOT, '_work/derived.json');
const D = existsSync(derivedPath) ? JSON.parse(readFileSync(derivedPath, 'utf8')) : null;
const SPR = join(ROOT, 'data/sprites');
const OUT = join(ROOT, '_work/site');
mkdirSync(OUT, { recursive: true });

/* 立绘已移除（产品侧判定效果不佳）：不再向站点拷 SVG，发布校验里的 .svg 本地链接检查随之自然为 0 */

/* ---------------- 通用样式（与对比页同源：系统无衬线中文、等宽数字、两品牌色） ---------------- */
const CSS = `
:root{
  --a-accent:#0071e3;--a-soft:rgba(0,113,227,.13);--a-line:rgba(0,113,227,.38);
  --b-accent:#cf0a2c;--b-soft:rgba(207,10,44,.13);--b-line:rgba(207,10,44,.38);
  --ink:#1d1f23;--ink2:#5b6169;--ink3:#8a8f98;--ink4:#b4b8bf;
  --line:#e5e6ea;--line2:#f0f1f3;--bg:#fff;--card:#fff;
  --sans:system-ui,-apple-system,'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif;
  --mono:ui-monospace,'SF Mono','JetBrains Mono',Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:#f6f7f9;color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.55}
a{color:inherit;text-decoration:none}
.wrap{max-width:1080px;margin:0 auto;padding:20px 16px 60px}
.top{display:flex;align-items:baseline;gap:12px;margin:8px 0 2px}
.top h1{font-size:20px;margin:0}
.top .sub{font-size:12.5px;color:var(--ink3)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:14px 0}
.card h2{font-size:15px;margin:0 0 10px;color:var(--ink2)}
.v-unpub{color:var(--ink4);font-size:12.5px}
.mono{font-family:var(--mono)}
/* 头衔区 */
.champ{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.champ a{display:block;border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:#fafafa}
.champ a:hover{border-color:var(--ink4)}
.champ .t{font-size:12px;color:var(--ink3)}
.champ .v{font-size:15px;font-weight:600;margin-top:2px}
.champ .n{font-size:12px;color:var(--ink2);margin-top:2px}
.champ .short{font-size:12px;color:var(--ink3);margin-top:4px}
/* 卡墙 */
.wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.tile{display:block;background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px;min-width:0}
.tile:hover{border-color:var(--ink3);box-shadow:0 2px 10px rgba(0,0,0,.05)}
.tile .brand{font-size:11px;color:var(--ink3);letter-spacing:.05em}
.tile .name{font-size:14px;font-weight:600;margin:3px 0 6px;word-break:break-word}
.tile .img{height:118px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.tile .img svg{max-height:116px;width:auto}
.tile .spec{font-size:12px;color:var(--ink2);margin-top:4px}
.tile .price{font-family:var(--mono);font-size:13px;margin-top:4px;font-weight:600}
.tile .p-persona{font-size:11.5px;color:var(--ink3);margin-top:4px}
@media (max-width:600px){.wall{grid-template-columns:repeat(2,1fr)}.champ{grid-template-columns:repeat(2,1fr)}}
`;

const brandColor = (b) => (b === 'apple' ? 'var(--a-accent)' : 'var(--b-accent)');
const brandLabel = (b) => (b === 'apple' ? '苹果' : b === 'huawei' ? '华为' : b);

function shell(title, body, { noSprite = false } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · 手机参数世界</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <h1>手机参数世界</h1>
  <span class="sub">华为 × 苹果 · 数据均来自官网 · 快照 ${P.generatedAt ? new Date(P.generatedAt).toLocaleDateString('zh-CN') : ''}</span>
</header>
${body}
<footer style="margin-top:30px;font-size:12px;color:var(--ink4);text-align:center">
  参数取自华为 / 苹果官网规格页与对比页；缺失项一律标注「官方未公布」，不做估算。
</footer>
</div>
</body>
</html>`;
}

function minPrice(p) {
  const list = (p.skus ?? []).map((s) => s.priceCny).filter((v) => typeof v === 'number' && v > 0);
  return list.length ? Math.min(...list) : null;
}
function fmtPrice(p) {
  const m = minPrice(p);
  return m === null ? '<span class="v-unpub">官方未公布</span>' : `<span class="mono">¥${m.toLocaleString('en-US')}</span>`;
}
function fmtDate(p) {
  if (!p.releaseDate) return '<span class="v-unpub">官方未公布</span>';
  const s = p.releaseDate;
  return s.length === 10 ? s : s;
}
function spriteOf() {
  /* 立绘已移除（产品侧判定效果不佳）：卡页与列表页不再画像素立绘 */
  return '';
}
function personaOf(p) {
  const d = D?.products?.find((x) => x.id === p.id);
  return d?.persona ?? null;
}

/* ---------------- 首页 ---------------- */
function indexPage() {
  const champs = (D?.champions ?? []).filter((c) => c.productId && c.value !== null);
  const champHtml = champs
    .map((c) => {
      const prod = products.find((p) => p.id === c.productId);
      const short = prod ? prod.name : c.productId;
      const label = c.note ? c.title : `${c.title}${c.unit ? `（${c.value} ${c.unit}）` : ''}`;
      return `<a href="products/${c.productId}.html"><div class="card" style="margin:0"><div class="t">${c.title}</div>
        <div class="v" style="color:${prod ? brandColor(prod.brand) : ''}">${short}</div>
        <div class="n">${c.value !== null && c.unit ? `${c.value} ${c.unit}` : ''}</div>
        <div class="short">${prod?.line ?? ''}</div></div></a>`;
    })
    .join('');

  const tiles = products
    .slice()
    .sort((a, b) => (a.brand === b.brand ? a.name.localeCompare(b.name) : a.brand.localeCompare(b.brand)))
    .map((p) => {
      const persona = personaOf(p);
      return `<a class="tile" href="products/${p.id}.html">
        <div class="brand" style="color:${brandColor(p.brand)}">${brandLabel(p.brand)}</div>
        <div class="name">${p.name}</div>
        <div class="price">起售价 ${fmtPrice(p)}</div>
        ${persona ? `<div class="p-persona">${persona}</div>` : ''}
        <div class="spec">${p.display?.sizeIn ?? '<span class="v-unpub">未公布</span>'}″ · ${p.body?.thicknessMm ?? '<span class="v-unpub">未公布</span>'} mm · ${p.body?.weightG ?? '<span class="v-unpub">未公布</span>'} g</div>
      </a>`;
    })
    .join('');

  return shell('首页', `
<section class="card">
  <h2>规格榜（当前在售池 · ${products.length} 台）</h2>
  <div class="champ">${champHtml}</div>
</section>
<section class="card">
  <h2>机型（${products.length} 台 · 点击看卡页）</h2>
  <div class="wall">${tiles}</div>
</section>
`);
}

/* ---------------- 机型卡页 ---------------- */
function productPage(p) {
  const persona = personaOf(p);
  const pcts = D?.products?.find((x) => x.id === p.id)?.percentiles ?? {};
  const pctLine = (k, label, dir) => {
    const v = pcts[k];
    if (v === null || v === undefined) return '';
    const pos = dir === 'low' ? v : 1 - v;
    return `<span title="当前池分位：${Math.round(pos * 100)}% 档">${label} <span class="mono">${Math.round(pos * 100)}%</span></span>`;
  };
  const chips = [
    pctLine('weightG', '重量', 'low'),
    pctLine('thicknessMm', '厚度', 'low'),
    pctLine('screenIn', '屏幕', 'high'),
    pctLine('ppi', '像素密度', 'high'),
    pctLine('priceCny', '价格', 'high'),
  ].filter(Boolean);

  const rows = [
    ['上市', fmtDate(p)],
    ['状态', p.status ?? '未知'],
    ['起售价', fmtPrice(p)],
    ['屏幕', `${p.display?.sizeIn ?? '<span class="v-unpub">未公布</span>'}″ · ${p.display?.type ?? ''}`],
    ['分辨率', p.display?.resolutionPx ? `${p.display.resolutionPx.w} × ${p.display.resolutionPx.h}（${p.display.ppi ?? ''} ppi）` : '<span class="v-unpub">未公布</span>'],
    ['刷新率', p.display?.refreshHz ? p.display.refreshHz : '<span class="v-unpub">未公布</span>'],
    ['芯片', p.chipset?.name ?? '<span class="v-unpub">官网未公布</span>'],
    ['内存', p.memory?.ramGb?.length ? `${Math.max(...p.memory.ramGb)} GB` : '<span class="v-unpub">官方未公布</span>'],
    ['存储', p.memory?.storageGb?.length ? `最高 ${(Math.max(...p.memory.storageGb) / 1024).toString().replace('.0', '')} TB` : '<span class="v-unpub">未公布</span>'],
    ['电池', p.battery?.capacityMah ? `${p.battery.capacityMah} mAh（${p.battery.capacityCaliber ?? '口径未注明'}）` : '<span class="v-unpub">官方未公布</span>'],
    ['有线充电', p.battery?.wiredChargeW ? `${p.battery.wiredChargeW} W` : '<span class="v-unpub">官方未公布</span>'],
    ['后摄', p.camera?.rear?.length ? `${p.camera.rear.length} 颗（${p.camera.rear.map((c) => c.mp ? `${c.mp}00万` : c.role).join(' / ')}）` : '<span class="v-unpub">未公布</span>'],
  ];

  const body = `
<section class="card" style="display:grid;grid-template-columns:1fr">
  <div>
    <div class="brand" style="font-size:12px;color:${brandColor(p.brand)};letter-spacing:.05em">${brandLabel(p.brand)} · ${p.line ?? ''}</div>
    <h1 style="font-size:22px;margin:4px 0 8px">${p.name}</h1>
    ${persona ? `<div style="font-size:13px;color:var(--ink2);border-left:3px solid ${brandColor(p.brand)};padding-left:10px;margin:6px 0">${persona}</div>` : ''}
    <div style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--ink2);margin:8px 0">${chips.join('')}</div>
  </div>
</section>
<section class="card">
  <h2>规格速览</h2>
  <table style="width:100%;border-collapse:collapse">
    ${rows.map(([k, v]) => `<tr style="border-bottom:1px solid var(--line2)"><td style="padding:7px 10px 7px 0;color:var(--ink3);width:72px;vertical-align:top">${k}</td><td style="padding:7px 0">${v}</td></tr>`).join('')}
  </table>
  <p style="font-size:12px;color:var(--ink3);margin:12px 0 0">完整官网原文与全部口径见 <a href="../all.html" style="text-decoration:underline">全部机型</a> 与 <a href="../index.html" style="text-decoration:underline">对比页</a> 的折叠区。</p>
</section>`;
  return shell(p.name, body);
}

/* ---------------- 对比页（两台） ---------------- */
function comparePage(x, y, derived) {
  /* 复用 render.mjs 的渲染管线（行定义/阈值/高亮全在 compare-spec.mjs，这里不重写） */
  const { renderPage, evaluateRow, loadDerived } = render;
  const opts = {
    a: x, b: y,
    brandA: x.brand, brandB: y.brand,
    accentA: { accent: '#0071e3', soft: 'rgba(0,113,227,.13)', line: 'rgba(0,113,227,.38)' },
    accentB: { accent: '#cf0a2c', soft: 'rgba(207,10,44,.13)', line: 'rgba(207,10,44,.38)' },
    fixture: false, autoPicked: false, autoWhy: null,
    showSideTag: true,
    derivedPath: derived?.path ?? null,
  };
  const entries = ROWS.map((row) => evaluateRow(row, x, y, { a: null, b: null }));
  const html = renderPage({
    a: x, b: y, opts, entries,
    dataInfo: { products: [x, y], vendors: [], generatedAt: P.generatedAt ?? new Date().toISOString(), path: 'data/products.json', mtime: null, isSnapshot: true, tried: [] },
    derived,
    generatedAt: new Date().toISOString(),
  });
  /* 剥掉外层壳，把主体内容塞进本站骨架（保留 render.mjs 的内联 CSS 与审计块） */
  const bodyM = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  const styleM = html.match(/<style>([\s\S]*)<\/style>/g)?.map((s) => s.replace(/<\/?style>/g, '')).join('\n') ?? '';
  const content = bodyM ? bodyM[1] : html;
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${x.name} vs ${y.name} · 手机参数世界</title>
<style>${CSS}${styleM}</style></head>
<body><div class="wrap">
<header class="top"><h1>${x.name} <span style="color:var(--ink4)">VS</span> ${y.name}</h1><a class="sub" href="../index.html" style="color:var(--ink3)">← 回首页</a></header>
${content}
</div></body></html>`;
}

let render = null;
let ROWS = null;
async function loadRenderModule() {
  render = await import('../preview/render.mjs');
  const spec = await import('../../src/lib/compare-spec.mjs');
  ROWS = spec.ROWS;
}

/* ---------------- all.html ---------------- */
function allPage() {
  const list = (brand) => products
    .filter((p) => p.brand === brand)
    .sort((x, y) => x.name.localeCompare(y.name))
    .map(
      (p) => `<tr style="border-bottom:1px solid var(--line2)">
        <td style="padding:8px 10px"><a href="products/${p.id}.html"><b>${p.name}</b></a></td>
        <td style="padding:8px 10px" class="mono">${p.releaseDate ?? '<span class="v-unpub">未公布</span>'}</td>
        <td style="padding:8px 10px" class="mono">${p.display?.sizeIn ?? '—'}</td>
        <td style="padding:8px 10px" class="mono">${p.body?.weightG ?? '—'} g</td>
        <td style="padding:8px 10px" class="mono">${p.chipset?.name ?? '<span class="v-unpub">未公布</span>'}</td>
        <td style="padding:8px 10px" class="mono">${minPrice(p) ?? '<span class="v-unpub">未公布</span>'}</td>
      </tr>`
    )
    .join('');
  const head = `<tr style="border-bottom:2px solid var(--line);font-size:12px;color:var(--ink3)"><th style="text-align:left;padding:6px 10px">机型</th><th style="text-align:left;padding:6px 10px">上市</th><th style="text-align:left;padding:6px 10px">屏幕</th><th style="text-align:left;padding:6px 10px">重量</th><th style="text-align:left;padding:6px 10px">芯片</th><th style="text-align:left;padding:6px 10px">起售价</th></tr>`;
  return shell('全部机型', `
<section class="card"><h2>华为（${products.filter((p) => p.brand === 'huawei').length} 台）</h2><table style="width:100%;border-collapse:collapse">${head}${list('huawei')}</table></section>
<section class="card"><h2>苹果（${products.filter((p) => p.brand === 'apple').length} 台）</h2><table style="width:100%;border-collapse:collapse">${head}${list('apple')}</table></section>
`);
}

/* 输出（在 main() 里，因为要 loadRenderModule） */
async function emit() {
  for (const sub of ['products', 'compare']) mkdirSync(join(OUT, sub), { recursive: true });
  writeFileSync(join(OUT, 'index.html'), indexPage());
  writeFileSync(join(OUT, 'all.html'), allPage());
  for (const p of products) {
    writeFileSync(join(OUT, 'products', `${p.id}.html`), productPage(p));
  }
  await loadRenderModule();
  const derived = render.loadDerived(join(ROOT, '_work/derived.json'));
  const auto = autoPairs(products);
  for (const [x, y] of auto) {
    writeFileSync(join(OUT, 'compare', `${x.id}-vs-${y.id}.html`), comparePage(x, y, derived));
  }
  /* 固定追加一张旗舰对阵：Mate 90 Pro vs iPhone 18 Pro（话题度最高的一对） */
  const flagA = products.find((p) => p.id === 'huawei-mate90-pro');
  const flagB = products.find((p) => p.id === 'apple-iphone-18-pro');
  if (flagA && flagB && !auto.some(([x, y]) => x.id === flagA.id && y.id === flagB.id)) {
    writeFileSync(join(OUT, 'compare', `${flagA.id}-vs-${flagB.id}.html`), comparePage(flagA, flagB, derived));
    auto.push([flagA, flagB]);
  }
  writeFileSync(join(OUT, 'index.html'), indexPage());
  console.log(`站点骨架已生成 → ${OUT}`);
  console.log(`  首页 1 + 列表 1 + 机型卡 ${products.length} + 对比页 ${auto.length}`);
  console.log('  对比页对阵：');
  for (const [x, y] of auto) console.log(`    ${x.name}  vs  ${y.name}`);
}

function autoPairs(list) {
  const apples = list.filter((p) => p.brand === 'apple');
  const huaweis = list.filter((p) => p.brand === 'huawei');
  const out = [];
  for (const a of apples) {
    const pa = minPrice(a);
    let best = null, bestGap = Infinity;
    for (const b of huaweis) {
      const pb = minPrice(b);
      if (pa === null || pb === null) continue;
      const g = Math.abs(pa - pb);
      if (g < bestGap) { bestGap = g; best = b; }
    }
    if (best) out.push([a, best]);
  }
  return out.slice(0, 5);
}

emit();
