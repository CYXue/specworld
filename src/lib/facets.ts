import type { Product } from '../types';
import { CATEGORY_ORDER } from './catalog';
import { PHONE_SCHEMA, facetFields } from './fields';
import {
  FORM_LABEL,
  PRICE_BUCKETS,
  UNKNOWN,
  categoryOf,
  chipName,
  chipNameLabel,
  formOf,
  maxRamGb,
  priceBucket,
  priceLabel,
  seriesOf,
  variantOf,
  yearOf,
} from './catalog';
import type { AbilityKey } from './specs';
import { abilityRaw } from './specs';

/**
 * 全量筛选层：品类 / 品牌 / 系列 / 变体 / 芯片 / 内存 / 年份 × 排序（纯函数）。
 *
 * 三个设计决定，每个都对应一个具体故障：
 *
 * 1. **多选，维度间取交集**。同一维度内多选是「或」（选 Pro 和 Pro Max 就是两个都要），
 *    不同维度间是「与」。这是筛选器唯一合理的语义。
 * 2. **缺字段是可见可点的一项**，不是隐形消失。实测 19/60 台官网没公布芯片名、
 *    30/60 台没公布内存 —— 若不给它们「未公布」选项，用户筛「芯片=A19」后
 *    有 19 台**人间蒸发且无处可寻**，看起来像数据丢了。
 * 3. **分面计数按「其它维度已生效」算，不受自身维度影响**（经典分面设计）：
 *    选了 Pro 之后系列分面里仍显示各系列台数 —— 否则一点就没法改主意。
 *
 * URL 即状态：条件全编码进 query，刷新与分享都保得住；
 * 手改 query 的非法值**丢弃并回落**（不产生永远 0 台的死条件）。
 */

/**
 * 筛选维度键。**两类来源**（2026-10-13 参数级筛选泛化）：
 * - 身份/派生维度：category/form/brand/series/variant/chip/ram/year/price（下方常量，策展）；
 * - **参数维度**：schema 里 `facet:true` 的字段（键 = 字段路径，如 'connectivity.nfc'）——
 *   相等类引擎，boolean→'true'/'false'、string→原文，新字段声明即自动成为筛选维度。
 */
export type DimKey = string;

/** 身份/派生维度（策展：顺序即页面展示顺序）。参数维度由 schema facet 声明动态追加。 */
const IDENTITY_DIMENSIONS: Array<{ key: DimKey; label: string; allLabel: string }> = [
  { key: 'category', label: '品类', allLabel: '全部品类' },
  { key: 'form', label: '形态', allLabel: '全部形态' },
  { key: 'brand', label: '品牌', allLabel: '全部品牌' },
  { key: 'series', label: '系列', allLabel: '全部系列' },
  { key: 'variant', label: '变体', allLabel: '全部变体' },
  { key: 'chip', label: '芯片', allLabel: '全部芯片' },
  { key: 'ram', label: '内存', allLabel: '全部内存' },
  { key: 'year', label: '年份', allLabel: '全部年份' },
  { key: 'price', label: '价格', allLabel: '全部价格' },
];

/** 全量维度 = 身份维度 + schema 声明的参数维度（facet:true）。消费方（FilterBar/页面）零改动。 */
export const DIMENSIONS: Array<{ key: DimKey; label: string; allLabel: string }> = [
  ...IDENTITY_DIMENSIONS,
  ...facetFields(PHONE_SCHEMA).map((f) => ({
    key: f.path as DimKey,
    label: f.label,
    allLabel: `全部${f.label}`,
  })),
];

export const DIM_LABEL: Record<DimKey, string> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.key, d.label]),
) as Record<DimKey, string>;

/** 筛选状态：每个维度存「已选 id 数组」，空数组 = 该维度不限。 */
export type FilterState = Record<DimKey, string[]>;

export function emptyFilter(): FilterState {
  // 动态构建：身份维度 + schema facet 参数维度全部初始化为空（固定四键会静默丢新维度）
  const f = {} as FilterState;
  for (const { key } of DIMENSIONS) f[key] = [];
  return f;
}

// ── 取值 ──

/** schema facet:true 的字段路径集合（参数级筛选维度的判定） */
const SPEC_FACET_SET = new Set(facetFields(PHONE_SCHEMA).map((f) => f.path));

/** 参数维度取值：相等类语义——boolean→'true'/'false'，string→原文，缺失→「未公布」 */
function specFacetValue(p: Product, path: string): string {
  const v = p.specs?.[path];
  if (v == null || v === '') return UNKNOWN;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

export function valueOf(p: Product, dim: DimKey): string {
  switch (dim) {
    case 'brand':
      return p.brand;
    case 'category':
      return categoryOf(p);
    case 'form':
      return formOf(p);
    case 'series':
      return seriesOf(p);
    case 'variant':
      return variantOf(p);
    case 'chip':
      return chipName(p);
    case 'ram': {
      const v = maxRamGb(p);
      return v == null ? UNKNOWN : String(v);
    }
    case 'year':
      return yearOf(p);
    case 'price':
      return priceBucket(p);
    default:
      // 参数维度（schema facet:true）：相等类取值，与对比引擎同一纪律（只判相等，不判序）
      if (SPEC_FACET_SET.has(dim)) return specFacetValue(p, dim);
      return UNKNOWN;
  }
}

export interface FacetItem {
  id: string;
  label: string;
  count: number;
  /** 缺数据的分面项：页面要标注，让用户知道这是「官方未公布」不是漏数据 */
  isUnknown?: boolean;
}

/** 各维度的稳定排序（数组越大越靠前；数字档与年份另有规则）。 */
const order = {
  // 品类按注册表展示顺序（catalog.ts CATEGORY_ORDER，与 data/categories.json 对账）；
  // 不再写死 'phone' 字面量（2026-10-13 硬编码审计 A4 治理）——新品类自动排在已注册序列里。
  category: (a: string, b: string) => {
    const ia = CATEGORY_ORDER.findIndex((c) => c.id === a);
    const ib = CATEGORY_ORDER.findIndex((c) => c.id === b);
    return (ia < 0 ? CATEGORY_ORDER.length : ia) - (ib < 0 ? CATEGORY_ORDER.length : ib);
  },
  series: (a: string, b: string) => 0,
  variant: (a: string, b: string) => 0,
  chip: (a: string, b: string) => 0,
  brand: (a: string, b: string) => 0,
  ram: (a: string, b: string) => 0,
  year: (a: string, b: string) => 0,
} as const;

/**
 * 某维度的分面列表。
 *
 * `pool` 应传入「**其它维度已过滤**」的集合（用 `applyExcept`），
 * 本维度自己不算进去 —— 这样选中某项后，同维度其它项的计数仍正确（可改主意）。
 */
export function facetOf(
  products: Product[],
  dim: DimKey,
  pool: Product[],
  brandLabels?: Map<string, string>,
): FacetItem[] {
  // ⚠️ 枚举与计数必须分开：**选项枚举看全集 `products`，计数看子集 `pool`**。
  // 若枚举也走 pool，选了华为芯片后「苹果」会从品牌分面里整个消失（0 计数项被丢），
  // 用户没法反悔，dims 的「有选项才显示」还会把整个维度藏掉 —— 这是真踩过的坑。
  const ids = new Set<string>();
  for (const p of products) ids.add(valueOf(p, dim));
  const counts = new Map<string, number>();
  for (const p of pool) {
    const v = valueOf(p, dim);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  // 参数维度（schema facet 字段）的显示标签：boolean → 是/否，其余用原文
  const specField = (PHONE_SCHEMA.fields ?? []).find((x) => x.path === dim);
  const isBoolFacet = specField?.type === 'boolean';

  let items = [...ids].map((id) => ({
    id,
    label:
      dim === 'chip'
        ? chipNameLabel(id)
        : dim === 'price'
          ? priceLabel(id)
          : dim === 'form'
            ? FORM_LABEL[id as keyof typeof FORM_LABEL] ?? id
            : isBoolFacet
              ? id === 'true'
                ? '是'
                : id === 'false'
                  ? '否'
                  : id
              : id,
    count: counts.get(id) ?? 0,
    isUnknown: id === UNKNOWN,
  }));

  items = items.sort((a, b) => {
    // 「未公布」永远排最后：它不是一个小数值，混在数字档里会被误读成「最小/最大」
    const ua = a.id === UNKNOWN ? 1 : 0;
    const ub = b.id === UNKNOWN ? 1 : 0;
    if (ua !== ub) return ua - ub;
    if (dim === 'ram') return Number(b.id) - Number(a.id); // 大内存在前
    if (dim === 'year') return b.id.localeCompare(a.id); // 新年份在前
    if (dim === 'brand') return (a.label || '').localeCompare(b.label || '', 'zh-Hans-CN');
    if (dim === 'price') {
      const rank = (id: string) =>
        id === UNKNOWN ? Infinity : PRICE_BUCKETS.find((b) => b.id === id)?.min ?? Infinity;
      return rank(a.id) - rank(b.id); // 按金额升序，未公布永远最后
    }
    if (dim === 'category') {
      // 手机在前，与 catalog 的 CATEGORY_ORDER 一致
      const rank: Record<string, number> = {
        phone: 0,
        tablet: 1,
        laptop: 2,
        audio: 3,
      };
      return (rank[a.id] ?? 9) - (rank[b.id] ?? 9);
    }
    if (dim === 'form') {
      // 折叠屏在前（少数派先曝光），直板在后
      const rank: Record<string, number> = { foldable: 0, bar: 1 };
      return (rank[a.id] ?? 9) - (rank[b.id] ?? 9);
    }
    // 其余（系列/变体/芯片/参数维度）：台数多的在前，同台数按名称，保证顺序稳定可复现。
    // 参数维度没有专属排序规则（order 表只覆盖身份维度）——安全兜底为 0，防新维度 TypeError。
    const cmp = (order as Record<string, (a: string, b: string) => number>)[dim];
    return (cmp ? cmp(a.id, b.id) : 0) || b.count - a.count || a.id.localeCompare(b.id);
  });

  if (dim === 'brand' && brandLabels) {
    items = items.map((it) => ({ ...it, label: brandLabels.get(it.id) ?? it.label }));
  }
  return items;
}

// ── 应用筛选 ──

/** 同维度内「或」，维度间「与」。 */
export function applyFilter(products: Product[], filter: FilterState): Product[] {
  return products.filter((p) =>
    DIMENSIONS.every(({ key }) => {
      const sel = filter[key];
      return sel.length === 0 || sel.includes(valueOf(p, key));
    }),
  );
}

/** 只应用除 `except` 之外的所有维度 —— 用于算该维度自身的分面计数。 */
export function applyExcept(products: Product[], filter: FilterState, except: DimKey): Product[] {
  return applyFilter(products, { ...filter, [except]: [] });
}

export function toggleValue(filter: FilterState, dim: DimKey, id: string): FilterState {
  const cur = filter[dim];
  return { ...filter, [dim]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
}

export function isFiltered(filter: FilterState): boolean {
  return DIMENSIONS.some(({ key }) => filter[key].length > 0);
}

export function activeCount(filter: FilterState): number {
  return DIMENSIONS.reduce((a, { key }) => a + filter[key].length, 0);
}

// ── 排序 ──

export type SortKey =
  | 'release'
  | 'price-asc'
  | 'price-desc'
  | 'ppi-asc'
  | 'ppi-desc'
  | 'weight-asc'
  | 'weight-desc'
  | 'battery-asc'
  | 'battery-desc'
  | 'camera-asc'
  | 'camera-desc';

export const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'release', label: '最新发布' },
  { id: 'price-asc', label: '价格 低→高' },
  { id: 'price-desc', label: '价格 高→低' },
  { id: 'ppi-asc', label: '屏幕像素密度 低→高' },
  { id: 'ppi-desc', label: '屏幕像素密度 高→低' },
  { id: 'weight-asc', label: '机身重量 小→大' },
  { id: 'weight-desc', label: '机身重量 大→小' },
  { id: 'battery-asc', label: '电池容量 小→大' },
  { id: 'battery-desc', label: '电池容量 大→小' },
  { id: 'camera-asc', label: '主摄像素 低→高' },
  { id: 'camera-desc', label: '主摄像素 高→低' },
];

/** 榜单页四条能力 → 排序键，供「点榜单进去看全部」下钻。 */
export const ABILITY_SORT: Record<string, SortKey> = {
  display: 'ppi-desc',
  light: 'weight-asc',
  battery: 'battery-desc',
  camera: 'camera-desc',
};

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === 'string' && SORTS.some((s) => s.id === v);
}

/**
 * 排序键格式 `维度-方向`（`price-asc`、`ppi-desc`…），这里按维度取原始值，方向由调用方解析。
 * `release` 不含维度，走发布日期兜底。
 */
function priceMin(p: Product): number | null {
  const vals = (p.skus ?? [])
    .map((s) => (s as { priceCny?: number | null }).priceCny)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return vals.length ? Math.min(...vals) : null;
}

const ABILITY_OF_DIM: Record<string, AbilityKey> = {
  ppi: 'display',
  weight: 'light',
  battery: 'battery',
  camera: 'camera',
};

function rawOf(p: Product, dim: string): number | null {
  if (dim === 'price') return priceMin(p);
  const ability = ABILITY_OF_DIM[dim];
  return ability ? abilityRaw(p, ability) : null;
}

function sortValue(p: Product, sort: SortKey): number | null {
  if (sort === 'release') return null;
  const dim = sort.split('-')[0];
  return rawOf(p, dim);
}

/** 发布日期倒序：所有排序的兜底，保证顺序稳定可复现（否则同值机型随数组序漂移）。 */
function byDate(a: Product, b: Product): number {
  return b.releaseDate.localeCompare(a.releaseDate);
}

/**
 * **多级（复合）排序**：按优先级数组依次比较，前一级相等才看下一级。
 *
 * 例：`['battery-desc', 'camera-desc']` = 先按电池容量大→小，电池相同的再按主摄像素高→低。
 * 这正是榜单要的语义 —— 「优先大电池」是一级，「再加其他排序」是在一级相同基础上的二级排序。
 *
 * 纪律不变：**缺值（官方未公布）一律排末尾**，无论升降序。把 `null` 当 0 会让「未公布」变成
 * 「最便宜 / 最轻薄 / 最大电池」，那是编造数据。两个排序键都缺值时交给下一级或兜底。
 */
export function applyMultiSort(products: Product[], sorts: SortKey[]): Product[] {
  const active = sorts.filter((s) => s !== 'release'); // release 仅作兜底，不主动比较
  if (!active.length) return [...products].sort(byDate);
  return [...products].sort((a, b) => {
    for (const sort of active) {
      const dir = sort.endsWith('-asc') ? 1 : -1;
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      if (va == null && vb == null) continue; // 两级都缺，交给下一级或兜底
      if (va == null) return 1; // 缺值永远排末尾
      if (vb == null) return -1;
      const d = dir * (va - vb);
      if (d !== 0) return d;
    }
    return byDate(a, b);
  });
}

/** 单级排序 = 多级排序的退化形态（保持旧调用方兼容）。 */
export function applySort(products: Product[], sort: SortKey): Product[] {
  return applyMultiSort(products, [sort]);
}

// ── URL 序列化 ──

/**
 * 参数名用单字母（a=品类 m=形态 b=品牌 s=系列 v=变体 c=芯片 r=内存 y=年份 g=价格 o=排序），
 * 因为「全维度筛选」的分享链接会很长。
 */
const PARAM: Record<DimKey, string> = {
  category: 'a',
  form: 'm',
  brand: 'b',
  series: 's',
  variant: 'v',
  chip: 'c',
  ram: 'r',
  year: 'y',
  price: 'g',
};

/** 维度 → URL 参数键：身份维度用单字母（链接短），参数维度直接用字段路径（不冲突、可读）。 */
function paramKey(dim: DimKey): string {
  return (PARAM as Record<string, string>)[dim] ?? dim;
}

export function writeFilter(
  filter: FilterState,
  sorts: SortKey[] = [],
): Record<string, string> {
  const q: Record<string, string> = {};
  for (const { key } of DIMENSIONS) if (filter[key].length) q[paramKey(key)] = filter[key].join(',');
  // 多级排序：逗号分隔按优先级排列。`release` 只是兜底，不写进 URL
  const norm = sorts.filter((s) => s && s !== 'release');
  if (norm.length) q.o = norm.join(',');
  return q;
}

/** `readFilter` 需要的「当前可选值全集」由调用方提供（见 `buildCatalog`）。 */
export function readFilter(
  params: URLSearchParams,
  catalog: { filter: FilterState; sorts: SortKey[] },
): { filter: FilterState; sorts: SortKey[] } {
  const valid = new Set(DIMENSIONS.flatMap(({ key }) => catalog.filter[key]));
  const filter = emptyFilter();
  for (const { key } of DIMENSIONS) {
    const seen = new Set<string>();
    for (const v of (params.get(paramKey(key)) ?? '').split(',')) {
      const t = v.trim();
      // 非法值直接丢弃：产生一个永远 0 台的死条件，用户会以为数据没了
      if (!t || seen.has(t) || !valid.has(t)) continue;
      seen.add(t);
      filter[key].push(t);
    }
  }
  const sorts: SortKey[] = [];
  for (const v of (params.get('o') ?? '').split(',')) {
    const t = v.trim();
    // 非法排序键静默丢弃：手改 URL 不该抛错，也不该生成永远排第一的死排序
    if (!t || sorts.includes(t as SortKey) || !catalog.sorts.includes(t as SortKey)) continue;
    sorts.push(t as SortKey);
  }
  return { filter, sorts };
}

/** 组装 `readFilter` 用的全集：当前数据集里各维度实际存在的取值。 */
export function buildCatalog(
  products: Product[],
  dims: DimKey[],
  brandLabels?: Map<string, string>,
): { filter: FilterState; sorts: SortKey[] } {
  const filter = emptyFilter();
  for (const key of dims)
    filter[key] = facetOf(products, key, products, brandLabels).map((f) => f.id);
  return { filter, sorts: SORTS.map((s) => s.id) };
}
