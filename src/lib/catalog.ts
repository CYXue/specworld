import { isFoldableOfficial } from '../../scripts/lib/foldable.mjs';
import type { Product } from '../types';
// 折叠屏判据的下游真源：构建期的像素立绘（scripts/sprite/generate.mjs）也必须用同一份。
// 判据注释与三个实测坑全在那个文件里，这里只做转出，避免两份正则各写各的。

/**
 * 品类 / 系列 / 价格 派生层（纯函数，无 DOM，可被 selftest 直接 import）。
 *
 * 为什么要这一层
 * --------------
 * 「最新 / 最贵 / 最便宜」「苹果折叠屏系列 / 标准系列 / Air 系列」这些口径
 * 全部是**派生事实**，不是 `data/products.json` 里的字段。放进组件里写就会散成
 * N 份各写各的判定，改一次要改多处，且没人能测。集中在这里后：
 *   - 页面只负责画；
 *   - selftest 能直接断言「60 台全部有品类」「缺价的不进最贵榜」这类契约。
 *
 * 数据诚信（本项目铁律，违反即全站口径错）
 * ----------------------------------------
 * 1. **不做估算**：没有数据就是没有。平板 / 笔记本 / 音频在当前数据集里一台都没有，
 *    `CATEGORY_ORDER` 里照样留着位置，`categoryCounts()` 返回 0，页面显示「暂无数据」。
 *    **绝不**因为「苹果肯定有 iPad」就凭空造一台。
 * 2. **折叠屏只认官网原文**：`rawOfficial` 的尺寸段出现「折叠态 / 展开态 / 三屏态」
 *    才算折叠屏。`body.folded` 字段实测 60 台全是 `null`，不能拿它当判据。
 * 3. **价格只认官方起售价**：一台机器有多个容量档时，取**最低** `priceCny` 当代表价
 *    —— 「最贵的机器」问的是这台机器多少钱起步，不是顶配多少钱。缺价的不进价格榜，
 *    也不显示 0（0 与「官方未公布」在语义上完全不同）。
 */

/**
 * 产品大类（品类）。顺序即页面展示顺序（手机 → 平板 → 笔记本 → 音频）。
 *
 * ⚠️ **折叠屏不是品类，是形态**（用户 2026-10-06 纠正）：折叠屏也是手机，
 * 把它和「手机」平级放在品类里，等于拿形态维度冒充品类维度 ——
 * 未来接入平板后「折叠平板」会更没处放。形态另见 `formOf`（折叠屏/直板）。
 */
export type CategoryId = 'phone' | 'tablet' | 'laptop' | 'audio';

export interface CategoryDef {
  id: CategoryId;
  label: string;
}

export const CATEGORY_ORDER: CategoryDef[] = [
  { id: 'phone', label: '手机' },
  { id: 'tablet', label: '平板' },
  { id: 'laptop', label: '笔记本' },
  { id: 'audio', label: '音频' },
];

const CATEGORY_LABEL = new Map(CATEGORY_ORDER.map((c) => [c.id, c.label]));

export function categoryLabel(id: CategoryId): string {
  return CATEGORY_LABEL.get(id) ?? id;
}

/**
 * 折叠屏判据：官网规格页「尺寸与重量」段出现 `折叠` 或 `展开` 两个字。
 *
 * 实现下沉到 `scripts/lib/foldable.mjs`（三个实测坑的完整说明在那里），
 * 因为构建期的像素立绘要吃同一份判据——两处各写一份正则，必然分叉，
 * 而分叉的后果是**机型库标着「折叠屏」、立绘却画成直板**，用户看得见却不报错。
 * 那个分歧是 2026-10-06 补 `scripts/sprite/review.mjs` 时肉眼发现的。
 */
export function isFoldable(p: Product): boolean {
  return isFoldableOfficial(p);
}

/**
 * 品类判定。
 *
 * 口径：折叠屏**也是手机**（形态归形态维度）。
 * v2 起产品记录自带 `category` 字段（管线按数据源写入，见 data/categories.json），
 * 这里读它；旧快照没有该字段时回落 'phone'（本数据集历史全是手机的事实陈述）。
 * 未来接入 iPad 数据源时，对应 normalize 通道直接写 category='tablet'，
 * 品类榜与筛选分面会**自动**把新数据分对，不需要改页面。
 */
export function categoryOf(p: Product): CategoryId {
  return (p.category as CategoryId | undefined) ?? 'phone';
}

/** 各品类的在册台数。用于分面计数与「暂无数据」提示。 */
export function categoryCounts(products: Product[]): Record<CategoryId, number> {
  const out = { phone: 0, tablet: 0, laptop: 0, audio: 0 } as Record<CategoryId, number>;
  for (const p of products) out[categoryOf(p)] += 1;
  return out;
}

// ── 形态（屏幕形态）──

/**
 * 形态判定：**折叠屏 vs 直板**。
 *
 * 与品类的关系（用户 2026-10-06 纠正的概念）：「折叠屏」描述的是**物理形态**，
 * 不是产品大类 —— 所以它从品类里挪出来，独立成筛选维度。
 *
 * 判据复用 `isFoldable`（官网尺寸段原文出现「折叠/展开」二字），
 * 没有原文依据的一律归「直板」—— 数据诚信原则：不猜、不按机型名反推。
 *
 * ⚠️ **直屏/曲屏做不了**：官网规格页原文没有任何「曲面/直屏」字样（实测 60 台），
 * 按诚信原则不编造。等数据源补充屏幕形态描述后，这里加判据即可自动进分面。
 */
export type FormId = 'foldable' | 'bar';

export const FORM_LABEL: Record<FormId, string> = {
  foldable: '折叠屏',
  bar: '直板',
};

export function formOf(p: Product): FormId {
  return isFoldable(p) ? 'foldable' : 'bar';
}

// ── 系列（产品线）──

/**
 * 系列与变体：**两层**，不是一层。
 *
 * 用户口径（2026-10-05）：`Pro` / `Pro Max` / `Plus` 都是**标准系列的后缀**，
 * 不是独立系列。所以第一版把它们和「标准」平级是错的 ——
 * 平级会让人以为「Pro 系列」和「标准系列」是两条并行的产品线，
 * 而实际关系是「标准系列下的不同配置档」。
 *
 * | 层 | 苹果 | 华为 |
 * |---|---|---|
 * | **系列**（一行） | 标准 / Air / SE / 折叠屏 | Mate / Pura / nova / 畅享 / Pocket |
 * | **变体**（次级） | Pro / Pro Max / Plus / 标准 / 折叠双屏 | Pro / Pro+ / Pro Max / Ultra / RS / 优享版 / 风驰版 |
 *
 * 华为的系列直接用 `line` 字段（官网自己的划分）；苹果的 `line` 全是 `"iPhone"`，
 * 只能自己判。变体两边都要从机型名里抽。
 *
 * **判定顺序：长后缀优先。** `iPhone 18 Pro Max` 同时含 `Pro` 与 `Max`，
 * 先判 `Pro Max` 才不会落进 `Pro` 档（少一档、且分面计数会莫名少一台）。
 */
export interface VariantDef {
  id: string;
  label: string;
  test: (n: string) => boolean;
}

/** 变体表。两家通用，按顺序匹配（**长后缀必须在短后缀之前**）。 */
const VARIANTS: VariantDef[] = [
  { id: 'pro-max', label: 'Pro Max', test: (n) => /Pro\s*Max/i.test(n) },
  { id: 'pro-plus', label: 'Pro+', test: (n) => /Pro\s*\+/i.test(n) },
  { id: 'pro', label: 'Pro', test: (n) => /\bPro\b/i.test(n) },
  { id: 'rs', label: 'RS', test: (n) => /\bRS\b/i.test(n) },
  { id: 'ultra', label: 'Ultra', test: (n) => /\bUltra\b/i.test(n) },
  { id: 'plus', label: 'Plus', test: (n) => /\bPlus\b/i.test(n) },
  { id: 'max', label: 'Max', test: (n) => /\bMax\b/i.test(n) },
  { id: 'air', label: 'Air', test: (n) => /\bAir\b/i.test(n) },
  { id: 'se', label: 'SE', test: (n) => /\bSE\b/i.test(n) },
  { id: 'yxb', label: '优享版', test: (n) => /优享版/.test(n) },
  { id: 'fcb', label: '风驰版', test: (n) => /风驰版/.test(n) },
];

/** 苹果：机型名 → 系列。四条系列线，判据用官网命名本身。 */
const APPLE_SERIES: Array<{ label: string; test: (n: string) => boolean }> = [
  // 折叠屏优先判：iPhone Duo 是唯一一台，不能被后面的规则吃掉
  { label: '折叠屏', test: (n) => /\bDuo\b/i.test(n) },
  { label: 'Air', test: (n) => /\bAir\b/i.test(n) },
  // 「e 款」在官网口径里是 SE 线的延续（无刘海/小屏低价位），归 SE 系列
  { label: 'SE', test: (n) => /\d+e\b/i.test(n) },
  // 其余（含 Pro / Pro Max / Plus）都是标准系列的不同档
  { label: '标准', test: () => true },
];

/** 苹果折叠屏的变体名（它不是「Pro」也不是「Max」，是双屏形态） */
const APPLE_FOLD_VARIANT = '折叠双屏';

export function seriesOf(p: Product): string {
  if (p.brand !== 'apple') return p.line || '其它';
  const name = p.name || '';
  for (const s of APPLE_SERIES) if (s.test(name)) return s.label;
  return '标准';
}

export function variantOf(p: Product): string {
  const name = p.name || '';
  // iPhone Duo 的形态是双屏本身，先于通用变体表判定
  if (/\bDuo\b/i.test(name)) return APPLE_FOLD_VARIANT;
  for (const v of VARIANTS) if (v.test(name)) return v.label;
  return '标准';
}

/**
 * 某品牌下的系列分面（含计数），按「台数降序 → 名称」排。
 * 台数相同时按名称排序，保证每次渲染顺序稳定（否则同数量系列会随机换位）。
 *
 * 计数用**过滤后**的集合传入（由 `facets.ts` 负责联动），
 * 这里只负责「给定集合 → 分面」，不关心当前选了哪个条件。
 */
export function seriesFacets(products: Product[]): Array<{ id: string; count: number }> {
  const m = new Map<string, number>();
  for (const p of products) {
    const s = seriesOf(p);
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/** 变体分面。与系列同一套排序规则。 */
export function variantFacets(products: Product[]): Array<{ id: string; count: number }> {
  const m = new Map<string, number>();
  for (const p of products) {
    const v = variantOf(p);
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

// ── 芯片（筛选用，需归一）──

/** 官网没公布芯片名时，筛选器里显示的占位项**（**可见可点**，不是隐形消失）。 */
export const UNKNOWN = '未公布';

/**
 * 芯片名归一。**筛选前必须过这一层**，否则同一个芯片会散成多个分面项。
 *
 * 实测分裂成四种，逐条处理：
 * 1. 空格：`麒麟 8000`（1 台）与 `麒麟8000`（1 台）—— **同款不同写法** → 去空格合并。
 * 2. 规格后缀：`麒麟9030 Pro（16 GB RAM 版本）`（1 台）是 `麒麟9030 Pro` 的一个内存版本，
 *    不是另一颗芯片 → 去括号内容后并入 `麒麟9030Pro`。
 * 3. **一颗条目里写了两颗芯片**：`麒麟9020A 麒麟9020B`、`麒麟9050 Pro 麒麟9050`。
 *    官网把同系列不同批次并列写在「处理器」格里。**不能**当一颗芯片（那样筛选芯片
 *    会把两种批次混在一起），也不能直接按空格拆（那样拆出来的碎片没人认识）。
 *    口径：**保留原文并整体作为一个条目**，并在页面上标注这是「官网并列写法」——
 *    诚实呈现 > 假装归一成功。
 * 4. `A18 芯片` 末尾的「芯片」二字是描述词不是型号 → 去掉；但**内部的 `Pro` 不动**
 *    （`麒麟9030Pro` ≠ `麒麟9030`，`A19Pro` ≠ `A19`）。
 *
 * `未公布` 是**可见可点**的筛选项，不是隐形消失（见 `UNKNOWN`）。
 */
export function chipName(p: Product): string {
  const raw = p.chipset?.name;
  if (raw == null) return UNKNOWN;
  let s = String(raw);
  s = s.replace(/[（(][^）)]*[）)]/g, ''); // 去掉「（16 GB RAM 版本）」
  s = s.replace(/芯片/g, ''); // 「A18 芯片」→「A18」
  s = s.replace(/\s+/g, ''); // 去空格（分面用，页面显示走 chipNameLabel）
  s = s.trim();
  return s === '' ? UNKNOWN : s;
}

/**
 * 页面显示用的芯片名（把可读性补回来：`麒麟9030Pro` → `麒麟9030 Pro`）。
 *
 * 分面 key 用 `chipName`（紧凑、可比较），显示用本函数。**两者必须来自同一次归一**，
 * 否则筛选点下去会「点得到但列表里找不到对应名字」。
 *
 * 只补 **Pro** 这一个接缝 —— 它是唯一「型号 + 空格 + Pro」在官网里真实存在的写法。
 * 前两版都栽在试图多补几个字母上：
 * - 补 `S/A/B` → `麒麟9020A` 被拆成「麒麟9020 A」（型号尾字母被误当后缀）；
 * - 全局正则 → `麒麟9020A麒麟9020B` 变成「麒麟9020 A麒麟9020 B」，两段都读不通。
 *
 * `9010S` / `8000A` 这类尾字母**保持原样**：`麒麟9010S` 用户看得懂，
 * 为了「对齐」而插入空格反而更难认。
 */
export function chipNameLabel(name: string): string {
  if (name === UNKNOWN) return UNKNOWN;
  return name.replace(/(\d)(Pro)(?=$|[^A-Za-z0-9])/g, '$1 $2').trim();
}

/**
 * 官网把多颗芯片并列写在一个格子里（口径 3）。
 *
 * 可靠判据 = **归一后串里出现了两次品牌前缀**。实测三种并列写法：
 * - `麒麟 9020A 麒麟 9020B`（两型号并列）
 * - `麒麟9050 Pro 麒麟9050`（两批并列）
 * - 而单颗的 `麒麟9030Pro` / `A19Pro` 里品牌前缀只出现一次。
 *
 * 前两版都栽在这里：
 * - 用「长度 > 8」判 → ×5 的单颗 `麒麟9030Pro` 被误标；
 * - 用「去掉 Pro/S/A/B 后还剩两个数字」判 → `A18` 去掉后剩 `18` 就被误标，几乎全中。
 *
 * **所以判据必须是「第二个芯片型号的开头」，不是字符数、也不是数字个数。**
 */
const CHIP_BRAND = '麒麟';

export function isMultiChip(name: string): boolean {
  if (name === UNKNOWN) return false;
  const first = name.indexOf(CHIP_BRAND);
  if (first < 0) return false; // 苹果芯片（无「麒麟」前缀）不在此判据覆盖内
  return name.indexOf(CHIP_BRAND, first + CHIP_BRAND.length) > 0;
}

export function chipFacets(products: Product[]): Array<{ id: string; count: number }> {
  const m = new Map<string, number>();
  for (const p of products) {
    const c = chipName(p);
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

// ── 年份 ──

export function yearOf(p: Product): string {
  return (p.releaseDate || '').slice(0, 4) || UNKNOWN;
}

export function yearFacets(products: Product[]): Array<{ id: string; count: number }> {
  const m = new Map<string, number>();
  for (const p of products) {
    const y = yearOf(p);
    m.set(y, (m.get(y) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.id.localeCompare(a.id)); // 新年份在前
}

/** 内存最大档（GB）。官网未公布内存时返回 `null` —— 不用 0 冒充。 */
export function maxRamGb(p: Product): number | null {
  const list = p.memory?.ramGb ?? [];
  const nums = list.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? Math.max(...nums) : null;
}

export function ramFacets(products: Product[]): Array<{ id: string; count: number }> {
  const m = new Map<string, number>();
  for (const p of products) {
    const v = maxRamGb(p);
    const key = v == null ? UNKNOWN : String(v);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => {
      // 数字档按大小降序，「未公布」永远排最后（它不是一个小数值）
      const na = Number(a.id);
      const nb = Number(b.id);
      const aBad = Number.isNaN(na) ? 1 : 0;
      const bBad = Number.isNaN(nb) ? 1 : 0;
      if (aBad !== bBad) return aBad - bBad;
      if (aBad) return a.id.localeCompare(b.id);
      return nb - na;
    });
}

// ── 价格 ──

/**
 * 官方起售价（元）：多容量档取**最低**档。
 *
 * 判据是 `priceCny` 存在且为正数 —— `null`（官方未公布中国区售价）返回 `null`。
 * **不返回 0**：0 会被「最便宜」榜当成真价格，把没公布的机器排到榜首。
 */
export function basePriceCny(p: Product): number | null {
  const vals = (p.skus ?? [])
    .map((s) => (s as { priceCny?: number | null }).priceCny)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return vals.length ? Math.min(...vals) : null;
}

/**
 * 价格筛选档位（京东式固定档，URL 稳定）。
 *
 * 用**固定档**而非动态分桶：URL 里的档 id 不随数据变化而错位，分享链接才可靠；
 * 且符合用户对「手机价格段」的直觉认知。某档 0 台时页面灰显不可点（见 FilterBar）。
 * 缺官方起售价的机型落入 `未公布` 项（不编造假价格，与 `basePriceCny` 同口径）。
 */
export const PRICE_BUCKETS: Array<{ id: string; label: string; min: number; max: number }> = [
  { id: '0-1999', label: '¥0-1999', min: 0, max: 1999 },
  { id: '2000-2999', label: '¥2000-2999', min: 2000, max: 2999 },
  { id: '3000-3999', label: '¥3000-3999', min: 3000, max: 3999 },
  { id: '4000-4999', label: '¥4000-4999', min: 4000, max: 4999 },
  { id: '5000-5999', label: '¥5000-5999', min: 5000, max: 5999 },
  { id: '6000-7999', label: '¥6000-7999', min: 6000, max: 7999 },
  { id: '8000+', label: '¥8000 以上', min: 8000, max: Infinity },
];

/** 机型 → 价格档 id。缺价返回 UNKNOWN（不编造假价格）。 */
export function priceBucket(p: Product): string {
  const v = basePriceCny(p);
  if (v == null) return UNKNOWN;
  for (const b of PRICE_BUCKETS) if (v >= b.min && v <= b.max) return b.id;
  return PRICE_BUCKETS[PRICE_BUCKETS.length - 1].id; // 兜底到最高档（如数据出现超高价）
}

/** 价格档 id → 中文显示名（分面用）。 */
export function priceLabel(id: string): string {
  if (id === UNKNOWN) return '官方未公布';
  return PRICE_BUCKETS.find((b) => b.id === id)?.label ?? id;
}

export function fmtPriceCny(v: number | null): string {
  return v == null ? '官方未公布' : `¥${v.toLocaleString('zh-CN')}`;
}

// ── 榜单取样 ──

export interface Spotlight {
  category: CategoryDef;
  /** 该品类最新的一台（无则 null） */
  latest: Product | null;
  /** 该品类最贵的一台（无价则 null） */
  priciest: Product | null;
  /** 该品类最便宜的一台（无价则 null） */
  cheapest: Product | null;
}

/**
 * 「最新 / 最贵 / 最便宜」三榜，**按品类各取一台**。
 *
 * 口径三条，每条都对应一个真实故障：
 * 1. 「最新」按 `releaseDate` 字符串降序。`releaseDate` 有 `day/month/year`
 *    三种精度，ISO 定长格式下字符串序 == 时间序，**不做 Date 解析**
 *    （`new Date('2026-03')` 在部分引擎解析成月初而非月末，比较会偏）。
 * 2. 「最贵/最便宜」只在**有官方起售价**的机器里排；缺价的不进榜，也不当 0。
 * 3. 同价时用 `releaseDate` 再排，让结果稳定可复现（否则同价机型顺序随数组序漂移）。
 */
export function spotlights(products: Product[]): Spotlight[] {
  return CATEGORY_ORDER.map((cat) => {
    const pool = products.filter((p) => categoryOf(p) === cat.id);
    const priced = pool.filter((p) => basePriceCny(p) != null);

    const byDate = (a: Product, b: Product) => b.releaseDate.localeCompare(a.releaseDate);
    const byPrice = (dir: 1 | -1) => (a: Product, b: Product) => {
      const d = dir * ((basePriceCny(a) ?? 0) - (basePriceCny(b) ?? 0));
      return d !== 0 ? d : byDate(a, b);
    };

    return {
      category: cat,
      latest: [...pool].sort(byDate)[0] ?? null,
      priciest: [...priced].sort(byPrice(-1))[0] ?? null,
      cheapest: [...priced].sort(byPrice(1))[0] ?? null,
    };
  });
}

/** 指定品类内「最新 N 台」，用于首页每个品牌只列最新几台。 */
export function latestN(products: Product[], n: number): Product[] {
  return [...products].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)).slice(0, n);
}
