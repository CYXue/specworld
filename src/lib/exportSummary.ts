/**
 * 画布导出 PNG 的「汇总」纯函数层 —— 与 board.ts / globe.ts / canvasFilter.ts 同纪律：
 * **零运行时依赖**，能被 scripts/selftest.mjs 用 node 22 的 type-stripping 直接
 * `await import()`。只算数，不碰 DOM/canvas（渲染在 renderExportImage.ts）。
 *
 * 这样「起售价合计对不对、各品牌小计对不对、状态分布对不对」
 * 能被自测钉死，不至于静默算错——这正是本项目要防的「合理区间内但错了」类故障。
 *
 * 数据诚信口径（与全站一致）
 * --------------------------------
 * - 价格只取官网起售价（skus[].priceCny，含增值税）；多 SKU 取**最小值**当起售价，
 *   否则会把 128/256/512GB 各算一遍导致总额翻几倍。
 * - 某台无 skus 或 skus 均无 priceCny → 计为「未公布」，不计入合计、单独计数。
 * - 起售价按**品牌**细分小计，再加总成累计总计；未公布的只计数、不补 0。
 */
import type { Product, Vendor } from '../types';
import type { CanvasDoc } from './canvasFilter';

export interface ExportSummary {
  total: number;
  /** 状态分布：在售 / 即将发布 / 停产 / 其它（未列明的 status 字符串） */
  status: { onSale: number; upcoming: number; retired: number; other: number };
  /** 品牌分布，按台数降序 */
  brands: Array<{ id: string; nameZh: string; count: number }>;
  /** 各品牌起售价小计（人民币，含增值税）：每台取其 SKU 最小价累加。按台数降序 */
  priceByBrand: Array<{ id: string; nameZh: string; count: number; totalCny: number }>;
  /** 起售价累计总计（所有品牌小计之和） */
  priceTotalCny: number;
  /** 未公布售价的设备数（无 skus 或 skus 均无 priceCny） */
  priceMissing: number;
}

const STATUS_KEY: Record<string, keyof ExportSummary['status']> = {
  'on-sale': 'onSale',
  upcoming: 'upcoming',
  retired: 'retired',
};

/** 单台起售价 = 其所有 SKU 中最小的 priceCny；无则 null（官方未公布） */
export function deviceStartPriceCny(p: Product): number | null {
  const skus = (p as unknown as { skus?: Array<{ priceCny?: unknown }> }).skus;
  if (!Array.isArray(skus) || skus.length === 0) return null;
  const nums: number[] = [];
  for (const s of skus) {
    const v = s?.priceCny;
    if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
  }
  if (nums.length === 0) return null;
  return Math.min(...nums);
}

export function buildExportSummary(
  items: CanvasDoc[],
  productsById: Map<string, Product>,
  vendorsById: Map<string, Vendor>,
): ExportSummary {
  const status: ExportSummary['status'] = { onSale: 0, upcoming: 0, retired: 0, other: 0 };
  const brandCount = new Map<string, number>();
  const brandPriceSum = new Map<string, number>();
  let priceTotalCny = 0;
  let priceMissing = 0;

  for (const d of items) {
    const p = productsById.get(d.id);
    if (!p) continue;
    status[STATUS_KEY[p.status] ?? 'other']++;
    brandCount.set(d.brand, (brandCount.get(d.brand) ?? 0) + 1);
    const price = deviceStartPriceCny(p);
    if (price == null) {
      priceMissing++;
    } else {
      priceTotalCny += price;
      brandPriceSum.set(d.brand, (brandPriceSum.get(d.brand) ?? 0) + price);
    }
  }

  const brands = [...brandCount.entries()]
    .map(([id, count]) => ({ id, nameZh: vendorsById.get(id)?.nameZh ?? id, count }))
    .sort((a, b) => b.count - a.count);

  const priceByBrand = brands.map((b) => ({
    id: b.id,
    nameZh: b.nameZh,
    count: b.count,
    totalCny: brandPriceSum.get(b.id) ?? 0,
  }));

  return {
    total: items.length,
    status,
    brands,
    priceByBrand,
    priceTotalCny,
    priceMissing,
  };
}
