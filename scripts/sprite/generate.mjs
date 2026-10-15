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
 *   3. **折叠机特判**：按官网尺寸原文里是否出现「折叠态/展开态/三屏态」判定，
 *      画成展开态双屏。
 *      ⚠️ 这里曾用 `sizeIn >= 7.5` 判定，**是错的**——折叠机的主屏尺寸正常只有
 *      5.4–6.5 英寸（Pura X 是 6.3、Mate XT 2 是 6.5），门槛设7.5 会把三台真折叠机
 *      画成直板。反过来8 英寸平板会误判成折叠机。
 *      正确判据与前端 `src/lib/catalog.ts` 的 `isFoldable` 同源（官网原文），
 *      两处必须一致，否则用户看到的形态标签和立绘互相打脸。
 *      这个 bug 是 2026-10-06 补`scripts/sprite/review.mjs` 时肉眼发现的：
 *      审查表按几何分组后，「折叠档里混进直板机」一眼可见。
 *   4. 输出 SVG 字符串（供内联）与 .svg 文件（供列表页），两种都要。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandMeta } from '../brands.mjs';
import { isFoldableOfficial } from '../lib/foldable.mjs';
import { pick } from '../lib/specs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 画布固定 160×320，让所有立绘并排时不会忽大忽小 */
const CANVAS = { w: 160, h: 320 };

/**
 * 「官网未公布尺寸」时的**几何占位** —— ⚠️ 这三个不是估算值。
 *
 * 这里曾经写的是 `?? 6.5` / `?? 8` / `?? 200`：三个像模像样的「典型手机」数值。
 * 后果是一张看起来尺寸精确的立绘，底下是编的数 —— 而它零报错，闸门也拦不住
 * （数值本身完全合法，区间校验一路绿灯）。这直接违反原则一。
 *
 * 现在的做法：
 *   ① 缺值走**固定的未知几何**（画布中位，不随品牌 / 系列变化，不会被读成某台真机）；
 *   ② 尺寸未知时在 caption 上显式标「?」，让用户看得出这张图没依据；
 *   ③ 重量缺值给 null（不画、不写），而不是塞 200；
 *   ④ 缺值机型记进 UNKNOWN.hits，构建结束打印台数 —— 让「没数据」这件事
 *      出现在人眼前，而不是被一个好看的默认值悄悄抹平。
 */
export const UNKNOWN = { sizeIn: 6.9, thicknessMm: 9, hits: [] };

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

  // specs-first 取值（scripts/lib/specs.mjs）：v2 读 specs 容器，v1 嵌套回退。
  // 立绘由数据几何算出，读错字段 = 全站立绘整体画错且零报错，所以取值必须与闸门同源。
  const rawSizeIn = pick(product, 'display.sizeIn');
  const rawThicknessMm = pick(product, 'body.thicknessMm');
  const rawWeightG = pick(product, 'body.weightG');

  // ⚠️ 缺值不估算：不拿典型值 / 同系列值 / 平均值顶上。
  //    尺寸未知 → 固定占位几何 + caption 标「?」；重量未知 → null（不显示）。
  const sizeKnown = Number.isFinite(rawSizeIn);
  const thicknessKnown = Number.isFinite(rawThicknessMm);
  if (!sizeKnown || !thicknessKnown) UNKNOWN.hits.push(product.id);

  const sizeIn = sizeKnown ? rawSizeIn : UNKNOWN.sizeIn;
  const thicknessMm = thicknessKnown ? rawThicknessMm : UNKNOWN.thicknessMm;
  const weightG = Number.isFinite(rawWeightG) ? rawWeightG : null;

  const rear = (pick(product, 'camera.rear') ?? []).length;
  const foldable = isFoldableOfficial(product);

  /* 对角线(英寸) → 像素，画布内留 12px 边距 */
  const pxPerInch = (CANVAS.h - 24) / Math.max(sizeIn, 6.9);
  const diagPx = sizeIn * pxPerInch;

  /* 宽高比：真实手机 ≈ 0.46–0.49。折叠机展开态更宽（≈0.72）。
     厚度/重量不参与宽高比（那是侧视图的事），只参与圆角与描边宽度。 */
  const ratio = foldable ? 0.72 : 0.47;
  const f = Math.sqrt(1 + ratio * ratio);
  let w = (diagPx / f) * ratio;
  let h = diagPx / f;
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

  /* 屏幕刘海/挖孔：Apple 近几代是灵动岛，华为是挖孔。品牌类型由注册表统一维护（scripts/brands.mjs）。 */
  const notch = brandMeta(brand)?.notch ?? 'punch';

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
    // 供 caption 判断要不要标「?」—— 尺寸缺值必须让用户看得见
    sizeKnown,
    thicknessKnown,
  };
}

/** 把一台机器的立绘渲染成内联 SVG 字符串（正面 + 背面并排）。 */
function renderSprite(product, { scale = 1 } = {}) {
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

function drawFace(L, s, side) {
  const { rect, pal, notch, camCount, camUnknown, foldable, strokeW, rear } = L;
  const r = rect;
  const rx = r.x * s,
    ry = r.y * s,
    rw = r.w * s,
    rh = r.h * s,
    rr = r.r * s;
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
    cams = `<circle cx="${r.x + 16 * s}" cy="${r.y + 16 * s}" r="${d}" fill="#000" opacity="0.85"/>
      <text x="${r.x + 16 * s}" y="${r.y + 16 * s + 3 * s}" text-anchor="middle" font-size="${8 * s}" fill="#fff" font-family="ui-monospace,monospace">?</text>`;
  } else {
    /* 单列排布（1–3 颗）或 2×2 田字（4 颗） */
    const big = 11 * s,
      small = 8 * s,
      gap = 6 * s;
    const ox = r.x + 14 * s,
      oy = r.y + 14 * s;
    if (camCount === 1) {
      cams = `<circle cx="${ox + big}" cy="${oy + big}" r="${big}" fill="#000"/>
        <circle cx="${ox + big}" cy="${oy + big}" r="${big * 0.62}" fill="#111" stroke="rgba(255,255,255,0.25)" stroke-width="${1 * s}"/>`;
    } else if (camCount === 2) {
      cams = [0, 1]
        .map((i) => {
          const r2 = i === 0 ? big : small;
          return `<circle cx="${ox + r2}" cy="${oy + r2}" r="${r2}" fill="#000"/>
            <circle cx="${ox + r2}" cy="${oy + r2}" r="${r2 * 0.62}" fill="#111" stroke="rgba(255,255,255,0.25)" stroke-width="${1 * s}"/>`;
        })
        .join('');
      cams += `<circle cx="${ox + small + 4 * s}" cy="${oy + small * 2 + 10 * s}" r="${small * 0.5}" fill="#000"/>`;
    } else if (camCount === 3) {
      cams = [
        [big, 0],
        [big, 1],
        [small, 2],
      ]
        .map(([r2, i]) => {
          const cxp = ox + r2 + (i === 2 ? 4 * s : 0);
          const cyp = oy + r2 + i * (big + gap) * 0.8;
          return `<circle cx="${cxp}" cy="${cyp}" r="${r2}" fill="#000"/>
            <circle cx="${cxp}" cy="${cyp}" r="${r2 * 0.62}" fill="#111" stroke="rgba(255,255,255,0.25)" stroke-width="${1 * s}"/>`;
        })
        .join('');
    } else {
      /* 4 颗：2×2 田字 */
      const d2 = 9 * s;
      [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ].forEach(([i, j]) => {
        const cxp = ox + d2 + i * (d2 * 2 + 4 * s);
        const cyp = oy + d2 + j * (d2 * 2 + 4 * s);
        cams += `<circle cx="${cxp}" cy="${cyp}" r="${d2}" fill="#000"/>
          <circle cx="${cxp}" cy="${cyp}" r="${d2 * 0.6}" fill="#111" stroke="rgba(255,255,255,0.25)" stroke-width="${1 * s}"/>`;
      });
    }
  }

  /* 品牌 logo 占位：一个细圆环，不写品牌字（避免商标），位置居中偏上 */
  const logo = `<circle cx="${cx * s}" cy="${(cy - 30) * s}" r="${10 * s}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="${1.4 * s}"/>`;

  return `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${rr}" fill="${pal.back}" stroke="${pal.backEdge}" stroke-width="${sw}"/>
    <rect x="${rx + 2 * s}" y="${ry + 2 * s}" width="${rw - 4 * s}" height="${rh - 4 * s}" rx="${rr - 2 * s}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="${1 * s}"/>
    ${cams}
    ${logo}`;
}

function caption(text, L, s) {
  // 缺值一律显式标注，不用默认值掩盖 —— 用户看到的「?」比一个假数字诚实。
  const note = L.camUnknown ? '（后摄数未公布）' : '';
  const unk = L.sizeKnown === false || L.thicknessKnown === false ? '（尺寸未公布）' : '';
  const fold = L.foldable ? ' · 折叠' : '';
  return `<text x="${(CANVAS.w * s) / 2}" y="${CANVAS.h * s + 14 * s}" text-anchor="middle"
      font-family="system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif"
      font-size="${11 * s}" fill="#8a8f98">${text}${fold}${unk}${note}</text>`;
}

function escAttr(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 把一台机器的立绘写成独立 .svg 文件（列表页用）。 */
export function writeSpriteFile(product, outPath, { scale = 1 } = {}) {
  const s = scale;
  const totalW = CANVAS.w * s + 10 * s + CANVAS.w * s + 16 * s;
  const totalH = CANVAS.h * s + 28 * s;
  const inner = renderSprite(product, { scale })
    .replace(/^<svg[\s\S]*?data-id="[^"]*">\s*/, '')
    .replace(/\s*<\/svg>$/, '');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">
${inner}
</svg>
`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, svg, 'utf8');
  return outPath;
}

/**
 * 品牌图标（非手机品类的立绘）：品牌色圆角块 + monogram 字母。
 *
 * 画布与手机立绘同构（160×320 + 28 caption 空间），列表页并排时高度一致。
 * 内容只有品牌元数据（brandMeta 的 accentColor / monogram），**没有任何
 * 产品几何** —— 它不是「产品的画」，是「本品类暂无产品立绘」的牌子。
 * 与 UNKNOWN 占位几何同一设计定位：占位必须显性，不能冒充真数据。
 */
export function writeBrandIconFile(product, outPath) {
  const meta = brandMeta(product.brand) ?? { monogram: '?', accentColor: '#8a8f98' };
  const block = 88;
  const x = (CANVAS.w - block) / 2;
  const y = (CANVAS.h - block) / 2;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS.w} ${CANVAS.h + 28}" width="${CANVAS.w}" height="${CANVAS.h + 28}">
  <rect x="${x}" y="${y}" width="${block}" height="${block}" rx="14" fill="${meta.accentColor}"/>
  <text x="${CANVAS.w / 2}" y="${y + block / 2 + 14}" text-anchor="middle"
      font-family="system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif"
      font-size="42" font-weight="700" fill="#ffffff">${escAttr(meta.monogram)}</text>
</svg>
`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, svg, 'utf8');
  return outPath;
}

/** CLI：node scripts/sprite/generate.mjs [--out data/sprites] */
async function main() {
  const data = JSON.parse(
    (await import('node:fs')).readFileSync(join(ROOT, 'data', 'products.json'), 'utf8'),
  );
  const products = data.products ?? data;
  const outIdx = process.argv.indexOf('--out');
  if (outIdx > -1 && !process.argv[outIdx + 1]) {
    console.error('❌ --out 需要一个目录参数，例如 --out data/sprites');
    process.exit(1);
  }
  const outDir = join(ROOT, outIdx > -1 ? process.argv[outIdx + 1] : 'data/sprites');
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  let brandIcons = 0;
  for (const p of products) {
    // 立绘分两路（2026-10-15 用户决策）：phone 画产品外形（几何由参数算出）；
    // 非 phone 品类（平板/笔记本/台式/手表/耳机）**统一画品牌图标**——
    // 给 iPad 画一张手机形 SVG 是「看起来合理但取错形态」的静默错误
    // （本项目最怕的故障类型），而品牌图标是「本品类暂无产品立绘」的
    // 显性表达（与 UNKNOWN 占位几何同一设计定位：不编造，不冒充）。
    // 判据取 v2 契约的 category 字段（真实数据全部带；历史记录缺省按 phone）。
    if ((p.category ?? 'phone') !== 'phone') {
      writeBrandIconFile(p, join(outDir, `${p.id}.svg`));
      brandIcons += 1;
      continue;
    }
    writeSpriteFile(p, join(outDir, `${p.id}.svg`));
    n += 1;
  }
  console.log(
    `已生成 ${n} 张手机立绘 + ${brandIcons} 张品牌图标 → ${outDir}`,
  );
  // 孤儿对账：目录里不属于现役产品的 SVG 一律删除（改 id / 退出官网目录的产品
  // 会留下永不再被引用的陈旧产物——引用体检抓不到它，人眼更看不见）。
  // 逐文件 unlink 不经过批量删除保护；单文件失败只警告（保洁不炸构建）。
  const live = new Set(products.map((p) => `${p.id}.svg`));
  let removed = 0;
  for (const f of (await import('node:fs')).readdirSync(outDir)) {
    if (!f.endsWith('.svg') || live.has(f)) continue;
    try {
      (await import('node:fs')).unlinkSync(join(outDir, f));
      removed += 1;
    } catch (err) {
      console.warn(`  ⚠️ 孤儿 ${f} 删除失败（${err.code ?? err.message}），跳过`);
    }
  }
  if (removed) console.log(`  已清理 ${removed} 张孤儿立绘（产品已不在册）`);
  // 「没数据」必须出现在人眼前：列出按占位几何画出来的机型。
  // 否则一个好看的默认值会把数据缺口悄悄抹平（原则一）。
  if (UNKNOWN.hits.length) {
    console.log(`⚠️  其中 ${UNKNOWN.hits.length} 台缺尺寸或厚度，已按「未知」占位几何绘制：`);
    console.log('   ' + UNKNOWN.hits.join('\n   '));
  }
  /* 抽 3 台自证几何正确 */
  for (const id of ['apple-iphone-18-pro', 'huawei-mate90-pro', 'huawei-mate-x7']) {
    const p = products.find((x) => x.id === id);
    if (!p) continue;
    const L = layout(p);
    console.log(
      `  ${id}: 折叠=${L.foldable} 后摄=${L.rear} 尺寸=${L.sizeIn}″ 厚=${L.thicknessMm}mm → 画布内 ${L.rect.w.toFixed(1)}×${L.rect.h.toFixed(1)}px`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // ⚠️ 必须 catch：main 是 async，未接住的 rejection 在管道外的调用里会丢栈，
  // 表现为「没输出、也没报错」。对照 scripts/sprite/review.mjs 的写法。
  main().catch((err) => {
    console.error('❌ 立绘生成失败：', err?.stack ?? err);
    process.exit(1);
  });
}
