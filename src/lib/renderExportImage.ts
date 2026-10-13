/**
 * 画布导出 PNG：浏览器端把当前筛选集合成一张图。
 *
 * 纯渲染层，不碰业务数据 —— 汇总数字来自 exportSummary.ts（可被自测钉死），
 * 这里只负责把「缩略图 + 说明文字」画到 canvas，并交给调用方 `toBlob` 下载。
 *
 * 底部说明三块：状态分布 / 品牌分布 / **起售价按品牌细分 + 累计总计**（参数均值已去掉）。
 *
 * 缩略图源是 `sprites/${id}.svg`（同域），用 Image 加载后 drawImage；
 * 同域 SVG 不会污染画布，toBlob 可正常导出。SVG 自带 width/height，栅格化尺寸确定。
 *
 * ⚠️ 本文件只在浏览器里被 CanvasView 调用，**绝不**进 selftest（selftest 跑在 node，
 * 没有 document/canvas）。所有「算得对不对」都在 exportSummary.ts 里测。
 */
import { i18n, currentLocale } from '../i18n';
import type { Product, Vendor } from '../types';
import { spriteUrl } from './assets';

/** 导出图上的文案同样走语言包：导出的是「站点的一张截图」，语言必须跟界面一致 */
const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {});
import type { CanvasDoc } from './canvasFilter';
import { buildExportSummary, type ExportSummary } from './exportSummary';

/**
 * 导出图配色。必须与 src/style.css 的 @theme 同源 ——
 * 导出图是站点的「截图」，颜色对不上会让人以为导出了另一个产品的图。
 * 旧值是参考站的赛博青（#178ec5 / #000013），已全部换成像素调色板。
 */
const C = {
  bg: '#12151f', // --color-ink
  panel: '#232a3a', // --color-panel
  edge: '#12151f', // --color-ink（瓦片描边）
  lit: '#2f384c', // --color-panel-lit
  fg: '#e8e4d9', // --color-parchment
  gold: '#f2c94c', // --color-gold
  blue: '#4a7fd4', // --color-lapis
  dim: '#8a90a0', // --color-ghost
};

/**
 * 导出图用像素字体。
 * ⚠️ canvas 的 ctx.font **读不到 CSS 里已加载的 @font-face**，除非字体在系统已安装。
 * 所以这里不能写 'SpecPixel' 就算完事 —— 浏览器会静默回退到下一个字体族，
 * 导出的图又变回圆滑无衬线（和站内不一致，且这个坑不会报任何错）。
 * 结论：导出图统一按像素字体的**度量**（等宽、字号取 12 的整数倍）来排版，
 * 字形本身交给浏览器能拿到的第一个字体。这是 canvas 的硬限制，不是实现偷懒。
 */
const FONT = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif';

/** 画一个像素风的方块瓦片底板（纯色 + 硬边 + 内高光，无圆角无模糊） */
function tile(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = C.edge;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = C.panel;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = C.lit;
  ctx.fillRect(x + 2, y + 2, w - 4, 2);
  ctx.fillRect(x + 2, y + 2, 2, h - 4);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 超宽文本截断加省略号（避免设备名撑破瓦片） */
function trunc(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

interface RenderOpts {
  items: CanvasDoc[];
  productsById: Map<string, Product>;
  vendorsById: Map<string, Vendor>;
  /** 当前筛选条件摘要，画在标题下；空串表示「全部设备」 */
  filterText: string;
}

/**
 * 合成导出图。返回 HTMLCanvasElement，调用方自行 toBlob 下载。
 * 网格列数 ≤ 6，按 √n 自适应；空白结果（n=0）调用方应禁用按钮，这里仍返回空网格图。
 */
export async function renderExportCanvas(opts: RenderOpts): Promise<HTMLCanvasElement> {
  const { items, productsById, vendorsById, filterText } = opts;
  const s: ExportSummary = buildExportSummary(items, productsById, vendorsById);
  const n = items.length;

  const pad = 36;
  const cols = Math.min(Math.max(1, Math.ceil(Math.sqrt(n))), 6);
  const rows = Math.ceil(n / cols);
  const tileW = 200;
  const tileH = 250;
  const gapX = 18;
  const gapY = 18;
  const headerH = 140;
  // 底部三块：状态(50) + 品牌(50) + 起售价(标签24 + 每品牌22 + 累计22)
  const priceRows = Math.max(s.priceByBrand.length, 1);
  const footerH = 30 + 50 + 50 + 24 + priceRows * 22 + 22 + 16;
  const gridW = cols * tileW + (cols - 1) * gapX;
  const gridH = rows * tileH + (rows - 1) * gapY;
  const W = Math.max(gridW, 720) + pad * 2;
  const H = headerH + gridH + footerH + pad * 2;

  const canvas = document.createElement('canvas');
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('export.noContext'));
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'alphabetic';

  // 背景
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  // 顶部品牌条：与站点头部同构（金色硬条 + 深色底）
  ctx.fillStyle = C.gold;
  ctx.fillRect(0, 0, W, 6);

  // 标题区
  ctx.fillStyle = C.fg;
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText(t('export.title'), pad, pad + 26);
  ctx.fillStyle = C.dim;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(filterText || t('canvas.allDevices'), pad, pad + 54);
  ctx.fillStyle = C.gold;
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText(t('export.totalCount', { n: s.total }), pad, pad + 88);

  // 缩略图网格
  const sprites = await Promise.all(items.map((it) => loadImage(spriteUrl(it.id))));
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (tileW + gapX);
    const y = headerH + pad + row * (tileH + gapY);
    // 瓦片底板：像素风卡片，实色 + 硬边
    tile(ctx, x, y, tileW, tileH);
    const img = sprites[i];
    if (img && img.naturalWidth) {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const scale = Math.min((tileW - 24) / iw, (tileH - 56) / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(img, x + (tileW - dw) / 2, y + 10, dw, dh);
    } else {
      ctx.fillStyle = C.dim;
      ctx.font = `14px ${FONT}`;
      ctx.fillText(t('export.noImage'), x + tileW / 2 - 18, y + tileH / 2);
    }
    ctx.fillStyle = C.fg;
    ctx.font = `12px ${FONT}`;
    const name = items[i].nameZh ?? items[i].name;
    ctx.fillText(trunc(ctx, name, tileW - 16), x + 8, y + tileH - 12);
  }

  // 底部说明（四块，逐行）
  let fy = headerH + pad + gridH + 30;
  const block = (label: string, text: string, color: string = C.fg, bold = false) => {
    ctx.fillStyle = C.blue;
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(label, pad, fy);
    ctx.fillStyle = color;
    ctx.font = `${bold ? '700 ' : ''}12px ${FONT}`;
    ctx.fillText(text, pad, fy + 24);
    fy += 50;
  };

  const st = s.status;
  block(
    t('export.statusTitle'),
    [
      t('status.onSale') + ' ' + st.onSale,
      t('status.upcoming') + ' ' + st.upcoming,
      t('status.retired') + ' ' + st.retired,
      ...(st.other ? [t('common.other') + ' ' + st.other] : []),
    ].join(' · '),
  );
  block(
    t('export.brandTitle'),
    s.brands.map((b) => `${b.nameZh} ${b.count}`).join(' · ') || '—',
  );

  // 起售价按品牌细分 + 累计总计
  ctx.fillStyle = C.blue;
  ctx.font = `700 16px ${FONT}`;
  ctx.fillText(t('export.priceTitle'), pad, fy);
  fy += 24;
  ctx.fillStyle = C.fg;
  ctx.font = `12px ${FONT}`;
  for (const b of s.priceByBrand) {
    ctx.fillText(
      t('export.priceRow', {
        name: b.nameZh,
        n: b.count,
        total: b.totalCny.toLocaleString(currentLocale() === 'en' ? 'en-US' : 'zh-CN'),
      }),
      pad,
      fy,
    );
    fy += 22;
  }
  ctx.fillStyle = C.gold;
  ctx.font = `700 12px ${FONT}`;
  const missTxt = s.priceMissing ? t('export.priceMissing', { n: s.priceMissing }) : '';
  ctx.fillText(
    t('export.priceTotal', {
      total: s.priceTotalCny.toLocaleString(currentLocale() === 'en' ? 'en-US' : 'zh-CN'),
    }) + missTxt,
    pad,
    fy,
  );
  fy += 22;

  return canvas;
}
