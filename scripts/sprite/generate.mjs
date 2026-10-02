#!/usr/bin/env node
/**
 * 数据驱动的像素立绘生成器
 * ============================================================================
 * 每台机器画一张手机（正面 + 背面），SVG 内联进页面，零外链。
 *
 * 设计纪律（与 COMPARE-DESIGN.md 同源）：
 *   1. **一切几何由数据算出**，不手绘：机身宽高比 ← 屏幕对角线，镜头数量 ← 后摄数，
 *      机身圆角 ← 厚度（越薄越方正）。任何一台机器的图，改一个字段就跟着变。
 *   2. **配色不编造**：数据里的 `body.colors` 目前两边都没抓到 → 背面用品牌中性色
 *      （苹果银灰 / 华为石墨），正面屏幕用深灰。**将来官网配色进数据，这里自动用真色。**
 *   3. **折叠机特判**：宽度 ≥ 7.5 英寸判为折叠（Mate X 系列 / Pocket 系列），
 *      画成展开态双屏，避免把 8 英寸画成一块砖。
 *   4. 输出 SVG 字符串（供内联）与 .svg 文件（供列表页），两种都要。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 画布固定 160×320，让所有立绘并排时不会忽大忽小 */
const CANVAS = { w: 160, h: 320 };

/** 品牌中性色（数据没配色时兜底，不算编造——它是「未公布配色」的视觉表达） */
const NEUTRAL = {
  apple: { back: '#d6d9de', backEdge: '#9aa0a8', screen: '#1c1e21', screenGlow: '#2a2d31' },
  huawei: { back: '#3a3d42', backEdge: '#17181a', screen: '#1c1e21', screenGlow: '#2a2d31' },
};

/**
 * 把一台机器的契约记录算成一组绘制参数。
 * 这是「数据 → 几何」的唯一映射点，全部有依据，没有一个是手绘的。
 */
export function layout(product) {
  const brand = product.brand;
  const pal = NEUTRAL[brand] ?? NEUTRAL.huawei;

  const sizeIn = product.display?.sizeIn ?? 6.5;
  const thicknessMm = product.body?.thicknessMm ?? 8;
  const weightG = product.body?.weightG ?? 200;
  const rear = (product.camera?.rear ?? []).length;
  const foldable = sizeIn >= 7.5 || /fold|pocket|x\d/i.test(product.line ?? '');

  /* 对角线(英寸) → 像素，画布内留 12px 边距 */
  const pxPerInch = (CANVAS.h - 24) / Math.max(sizeIn, 6.9);
  const diagPx = sizeIn * pxPerInch;

  /* 宽高比：真实手机 ≈ 0.46–0.49。折叠机展开态更宽（≈0.72）。
     厚度/重量不参与宽高比（那是侧视图的事），只参与圆角与描边宽度。 */
  const ratio = foldable ? 0.72 : 0.47;
  let w = diagPx * ratio / Math.sqrt(1 + ratio * ratio);
  let h = diagPx * Math.sqrt(1 + ratio * ratio) / Math.sqrt(1 + ratio * ratio) * (1 / ratio);
  /* 简化：w = diag * ratio / √(1+ratio²)，h = diag / √(1+ratio²) */
  const f = Math.sqrt(1 + ratio * ratio);
  w = (diagPx / f) * ratio;
  h = diagPx / f;
  /* 折叠机宽度超过画布就整体缩放，高度等比 */
  if (w > CANVAS.w - 24) {
    const s = (CANVAS.w - 24) / w;
    w *= s;
    h *= s;
  }
  const x = (CANVAS.w - w) / 2;
  const y = (CANVAS.h - h) / 2;

  /* 越薄越方正：圆角 6 → 12（厚度 6mm→12mm 线性） */
  const corner = 6 + ((thicknessMm - 6) / 6) * 6;

  /* 描边宽度代表厚度感（侧影），越厚描边越粗 */
  const strokeW = Math.max(1.5, (thicknessMm / 8) * 2.2);

  /* 后摄布局：按数量分档（1/2/3/≥4），数量 0 = 官网没写 → 画 1 个占位圆并标「?」 */
  const camUnknown = rear === 0;
  const camCount = camUnknown ? 1 : Math.min(rear, 4);

  /* 屏幕刘海/挖孔：Apple 近几代是灵动岛，华为是挖孔。用品牌兜底即可，不算编造。 */
  const notch = brand === 'apple' ? 'island' : 'punch';

  return {
    product,
    brand,
    pal,
    foldable,
    camUnknown,
    camCount,
    notch,
    rect: { x, y, w, h, r: corner },
    strokeW,
    sizeIn,
    thicknessMm,
    weightG,
    rear,
  };
}

/** 把一台机器的立绘渲染成内联 SVG 字符串（正面 + 背面并排）。 */
export function renderSprite(product, { scale = 1 } = {}) {
  const L = layout(product);
  const s = scale;
  const pad = 10 * s;

  /* 正面：屏幕 + 边框 + 刘海/挖孔 */
  const front = drawFace(L, s, 'front');
  const back = drawFace(L, s, 'back');

  const totalW = CANVAS.w * s + pad * s + CANVAS.w * s + 16 * s;
  const totalH = CANVAS.h * s + 28 * s;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}" role="img" aria-label="${escAttr(product.name)} 正反面立绘" data-id="${escAttr(product.id)}">
  <g transform="translate(${pad * s},0)">
    ${front}
    ${caption('正面', L, s)}
  </g>
  <g transform="translate(${(CANVAS.w + pad + 16) * s},0)">
    ${back}
    ${caption('背面', L, s)}
  </g>
</svg>`;
}

/** 画布内并排两个手机时的左右间距（与 renderSprite 保持一致） */
export function padOf(scale = 1) {
  return 10 * scale;
}

function drawFace(L, s, side) {
  const { rect, pal, notch, camCount, camUnknown, foldable, strokeW, rear } = L;
  const r = rect;
  const rx = r.x * s, ry = r.y * s, rw = r.w * s, rh = r.h * s, rr = r.r * s;
  const sw = strokeW * s;

  if (side === 'front') {
    /* 折叠机正面：中间一条折痕 */
    const foldLine = foldable
      ? `<line x1="${rx + rw / 2}" y1="${ry + 8 * s}" x2="${rx + rw / 2}" y2="${ry + rh - 8 * s}" stroke="${pal.backEdge}" stroke-width="${1.2 * s}" opacity="0.55"/>`
      : '';
    const island =
      notch === 'island'
        ? `<rect x="${rx + rw / 2 - 16 * s}" y="${ry + 6 * s}" width="${32 * s}" height="${8 * s}" rx="${4 * s}" fill="#000"/>`
        : '';
    const punch =
      notch === 'punch'
        ? `<circle cx="${rx + rw / 2}" cy="${ry + 9 * s}" r="${3.4 * s}" fill="#000"/>`
        : '';
    /* 屏幕渐变（顶部微亮） */
    return `<defs>
      <linearGradient id="scr" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${pal.screenGlow}"/>
        <stop offset="0.5" stop-color="${pal.screen}"/>
        <stop offset="1" stop-color="${pal.screen}"/>
      </linearGradient>
    </defs>
    <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${rr}" fill="url(#scr)" stroke="${pal.backEdge}" stroke-width="${sw}"/>
    <rect x="${rx + 2 * s}" y="${ry + 2 * s}" width="${rw - 4 * s}" height="${rh - 4 * s}" rx="${rr - 2 * s}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="${1 * s}"/>
    ${island}${punch}${foldLine}`;
  }

  /* 背面 */
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  /* 摄像头模块：数量越多，模块越靠上、越大。位置永远在左上，与真实排布一致。 */
  let cams = '';
  if (camUnknown) {
    const d = 10 * s;
    cams = `<circle cx="${(r.x + 16 * s)}" cy="${(r.y + 16 * s)}" r="${d}" fill="#000" opacity="0.85"/>
      <text x="${r.x + 16 * s}" y="${r.y + 16 * s + 3 * s}" text-anchor="middle" font-size="${8 * s}" fill="#fff" font-family="ui-monospace,monospace">?</text>`;
  } else {
    /* 单列排布（1–3 颗）或 2×2 田字（4 颗） */
    const big = 11 * s, small = 8 * s, gap = 6 * s;
    const ox = r.x + 14 * s, oy = r.y + 14 * s;
    if (camCount === 1) {
      cams = `<circle cx="${ox + big}" cy="${oy + big}" r="${big}" fill="#000"/>
        <circle cx="${ox + big}" cy="${oy + big}" r="${big * 0.62}" fill="#111" stroke="rgba(255,255,255,0.25)" stroke-width="${1*s}"/>`;
    } else if (camCount === 2) {
      cams = [0, 1]
        .map((i) => {
          const r2 = i === 0 ? big : small;
          return `<circle cx="${ox + r2}" cy="${oy + r2}" r="${r2}" fill="#000"/>
            <circle cx="${ox + r2}" cy="${oy + r2}" r="${r2 * 0.62}" fill="#111" stroke="rgba(255,255,255,0.25)" stroke-width="${1*s}"/>`;
        })
        .join('');
      cams += `<circle cx="${ox + small + 4 * s}" cy="${oy + small * 2 + 10 * s}" r="${small * 0.5}" fill="#000"/>`;
    } else if (camCount === 3) {
      cams = [
        [big, 0], [big, 1], [small, 2],
      ]
        .map(([r2, i]) => {
          const cxp = ox + r2 + (i === 2 ? 4 * s : 0);
          const cyp = oy + r2 + i * (big + gap) * 0.8;
          return `<circle cx="${cxp}" cy="${cyp}" r="${r2}" fill="#000"/>
            <circle cx="${cxp}" cy="${cyp}" r="${r2 * 0.62}" fill="#111" stroke="rgba(255,255,255,0.25)" stroke-width="${1*s}"/>`;
        })
        .join('');
    } else {
      /* 4 颗：2×2 田字 */
      const d2 = 9 * s;
      [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([i, j]) => {
        const cxp = ox + d2 + i * (d2 * 2 + 4 * s);
        const cyp = oy + d2 + j * (d2 * 2 + 4 * s);
        cams += `<circle cx="${cxp}" cy="${cyp}" r="${d2}" fill="#000"/>
          <circle cx="${cxp}" cy="${cyp}" r="${d2 * 0.6}" fill="#111" stroke="rgba(255,255,255,0.25)" stroke-width="${1*s}"/>`;
      });
    }
  }

  /* 品牌 logo 占位：一个细圆环，不写品牌字（避免商标），位置居中偏上 */
  const logo = `<circle cx="${cx * s}" cy="${(cy - 30) * s}" r="${10 * s}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="${1.4 * s}"/>`;

  return `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${rr}" fill="${pal.back}" stroke="${pal.backEdge}" stroke-width="${sw}"/>
    <rect x="${rx + 2*s}" y="${ry + 2*s}" width="${rw - 4*s}" height="${rh - 4*s}" rx="${rr - 2*s}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="${1*s}"/>
    ${cams}
    ${logo}`;
}

function caption(text, L, s) {
  const note = L.camUnknown ? '（后摄数未公布）' : '';
  const fold = L.foldable ? ' · 折叠' : '';
  return `<text x="${CANVAS.w * s / 2}" y="${CANVAS.h * s + 14 * s}" text-anchor="middle"
      font-family="system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif"
      font-size="${11 * s}" fill="#8a8f98">${text}${fold}${note}</text>`;
}

function escAttr(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 把一台机器的立绘写成独立 .svg 文件（列表页用）。 */
/** 把一台机器的立绘写成独立 .svg 文件（列表页用）。 */
export function writeSpriteFile(product, outPath, { scale = 1 } = {}) {
  const s = scale;
  const totalW = CANVAS.w * s + 10 * s + CANVAS.w * s + 16 * s;
  const totalH = CANVAS.h * s + 28 * s;
  const inner = renderSprite(product, { scale }).replace(
    /^<svg[\s\S]*?data-id="[^"]*">\s*/,
    ''
  ).replace(/\s*<\/svg>$/, '');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">
${inner}
</svg>
`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, svg, 'utf8');
  return outPath;
}

/** CLI：node scripts/sprite/generate.mjs [--out data/sprites] */
async function main() {
  const data = JSON.parse((await import('node:fs')).readFileSync(join(ROOT, 'data', 'products.json'), 'utf8'));
  const products = data.products ?? data;
  const outDir = join(ROOT, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'data/sprites');
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const p of products) {
    writeSpriteFile(p, join(outDir, `${p.id}.svg`));
    n += 1;
  }
  console.log(`已生成 ${n} 张立绘 → ${outDir}`);
  /* 抽 3 台自证几何正确 */
  for (const id of ['apple-iphone-18-pro', 'huawei-mate90-pro', 'huawei-mate-x7']) {
    const p = products.find((x) => x.id === id);
    if (!p) continue;
    const L = layout(p);
    console.log(`  ${id}: 折叠=${L.foldable} 后摄=${L.rear} 尺寸=${L.sizeIn}″ 厚=${L.thicknessMm}mm → 画布内 ${L.rect.w.toFixed(1)}×${L.rect.h.toFixed(1)}px`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
