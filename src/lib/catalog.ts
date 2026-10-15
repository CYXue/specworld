import curatedFacets from '../../data/curated/facets.json' with { type: 'json' };
import { isFoldableOfficial } from '../../scripts/lib/foldable.mjs';
import { i18n, currentLocale, pickLocale } from '../i18n';
import type { Product } from '../types';
import { localizeSpecValue } from './glossary';
import { basePriceCny } from './price';

/**
 * 策展字典（data/curated/facets.json，2026-10-13 硬编码审计 P2 治理）。
 * 变体表/品牌系列策略/多芯判据/价格档全部是**数据**——加变体、调价格档、接新品牌
 * 只改 JSON，不改本文件；selftest「策展表外置对账」双向看守（结构合法性+哨兵语义）。
 */
/** 策展条目统一带 `labelEn`（2026-10-13 i18n 治理：数据侧双语，selftest 对账） */
interface CuratedVariant {
  id: string;
  label: string;
  labelEn: string;
  match: string;
  flags?: string;
}
interface CuratedSeriesRule {
  label: string;
  labelEn: string;
  match?: string;
  flags?: string;
  fallback?: boolean;
}
interface CuratedBrandSeries {
  from: 'name';
  series: CuratedSeriesRule[];
  foldVariant?: { match: string; flags?: string; label: string; labelEn: string };
}
interface CuratedDict {
  variants: CuratedVariant[];
  series: {
    default: 'line';
    brands?: Record<string, CuratedBrandSeries>;
    /** 兜底系列 id（标准/其它）的英文名 */
    fallbackLabelEn?: Record<string, string>;
    /** 厂商产品线字段（`p.line`）里中文名的英译（如 畅享 → Enjoy） */
    lineEn?: Record<string, string>;
  };
  chipMultiPrefixes: string[];
  // 芯片名的官方英文名（麒麟 → Kirin、A18 芯片 → A18 chip）不在本字典里，
  // 统一由 data/curated/glossary.json 管 —— 芯片名在参数表/分面/榜单/搜索建议/
  // 画布短规格里都要显示，两处各写一份迟早分叉（2026-10-14 已合并）。
  priceBuckets: Array<{
    id: string;
    label: string;
    labelEn: string;
    min: number;
    max: number | null;
  }>;
}
const CURATED = curatedFacets as unknown as CuratedDict;

/** JSON 正则串 → 判定函数（fallback 规则无 match，恒真） */
function makeNameTest(rule: {
  match?: string;
  flags?: string;
  fallback?: boolean;
}): (n: string) => boolean {
  if (rule.fallback || !rule.match) return () => true;
  const re = new RegExp(rule.match, rule.flags ?? '');
  return (n: string) => re.test(n);
}
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
type CategoryId = 'phone' | 'tablet' | 'laptop' | 'audio';

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /** 英文名。与 data/categories.json 的 label/labelEn 双字段同源（selftest 对账） */
  labelEn: string;
}

export const CATEGORY_ORDER: CategoryDef[] = [
  { id: 'phone', label: '手机', labelEn: 'Phone' },
  { id: 'tablet', label: '平板', labelEn: 'Tablet' },
  { id: 'laptop', label: '笔记本', labelEn: 'Laptop' },
  { id: 'audio', label: '音频', labelEn: 'Audio' },
];

/**
 * 品类展示名（语言感知）。
 *
 * ⚠️ **语言只从 `currentLocale()` 来，不由调用方传**（2026-10-13 统一口径，
 * 理由见 `src/i18n/index.ts` 的 `currentLocale` 注释）：`locale` 参数会变成
 * 第二真源，与 lib 内部 `t()` 读到的全局语言打架时产出中英混排，且无闸门可报。
 */
export function categoryLabel(id: CategoryId): string {
  const c = CATEGORY_ORDER.find((x) => x.id === id);
  if (!c) return id;
  return pickLocale(c.label, c.labelEn);
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


// ── 生命周期状态（权威枚举见 src/types.ts Product.status；标签单一映射）──

/**
 * 状态 → **locale 键**（不是中文）。新状态值只改这一处；
 * 文案进语言包，否则英文页会出现「在售 / On sale」混排（DevEco 式半吊子）。
 */
const STATUS_LABEL_KEY: Record<string, string> = {
  'on-sale': 'status.onSale',
  upcoming: 'status.upcoming',
  retired: 'status.retired',
};

export function statusLabelOf(s: string | null | undefined): string {
  if (!s) return '—';
  const k = STATUS_LABEL_KEY[s];
  return k ? i18n.global.t(k) : s;
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
type FormId = 'foldable' | 'bar';

/**
 * 形态 id → 文案键。**文案不放这里**（放了就没法双语）——键指向 locale 包的
 * `facet.formValue.*`，lib 只做 id→键映射，与「派生事实下沉 lib、文案进语言包」同纪律。
 */
export const FORM_LABEL_KEY: Record<FormId, string> = {
  foldable: 'facet.formValue.foldable',
  bar: 'facet.formValue.bar',
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
interface VariantDef {
  id: string;
  label: string;
  labelEn: string;
  test: (n: string) => boolean;
}

/** 变体表：**数据来自策展字典**（data/curated/facets.json），顺序即匹配顺序（长后缀在前）。 */
const VARIANTS: VariantDef[] = CURATED.variants.map((v) => ({
  id: v.id,
  label: v.label,
  labelEn: v.labelEn,
  test: makeNameTest(v),
}));

/**
 * 系列/变体解析：**按品牌查策展字典**（2026-10-13 P2 治理）。
 * 苹果配置了 `from:'name'`（line 全是 iPhone，只能从机型名判）；
 * 未配置的品牌走默认策略 `line`（官网自己的产品线字段）；
 * 新品牌接进来 = 在字典 `series.brands` 加一段配置，不改本文件。
 */
/**
 * 系列 id。**不翻译**（id 进 URL、进分面状态，翻译了就是「同一条链接两种语义」）。
 * 展示走 `seriesLabel(id)`。
 */
export function seriesOf(p: Product): string {
  const name = p.name || '';
  const cfg = CURATED.series.brands?.[p.brand];
  if (cfg?.from === 'name') {
    for (const s of cfg.series) if (makeNameTest(s)(name)) return s.label;
    return SERIES_FALLBACK;
  }
  return p.line || SERIES_OTHER;
}

/** 系列 id → 展示名（语言感知）。查不到就原样返回（新品线不必先登记才能显示） */
export function seriesLabel(id: string): string {
  if (currentLocale() !== 'en') return id;
  const cfg = CURATED.series;
  if (cfg.fallbackLabelEn?.[id]) return cfg.fallbackLabelEn[id];
  if (cfg.lineEn?.[id]) return cfg.lineEn[id];
  for (const b of Object.values(cfg.brands ?? {})) {
    const hit =
      b.series?.find((x) => x.label === id)?.labelEn ??
      (b.foldVariant?.label === id ? b.foldVariant.labelEn : undefined);
    if (hit) return hit;
  }
  return id;
}

/** 变体 id。**同样不翻译**，展示走 `variantLabel(id)` */
export function variantOf(p: Product): string {
  const name = p.name || '';
  const cfg = CURATED.series.brands?.[p.brand];
  // 「形态即变体」的特殊机型（如 iPhone Duo 双屏）先于通用变体表判定
  if (cfg?.foldVariant && makeNameTest(cfg.foldVariant)(name)) return cfg.foldVariant.label;
  for (const v of VARIANTS) if (v.test(name)) return v.label;
  return SERIES_FALLBACK;
}

/**
 * 变体 id → 展示名（语言感知）。
 *
 * ⚠️ 查表键是 **label 不是 id**：`variantOf` 与 `seriesOf` 返回的都是 label
 * （变体表/系列表用 label 作为分面值，见 `seriesLabel` 里同样的写法）。
 * 这里曾经写成 `v.id === id`，于是中文变体（优享版 / 风驰版）永远查不到
 * labelEn、英文页直接吐中文 —— 而拉丁变体（Pro / Ultra）因为 label 与 labelEn
 * 恰好相同而「看起来是对的」，故障藏了整整一轮。
 */
export function variantLabel(id: string): string {
  if (currentLocale() !== 'en') return id;
  return VARIANTS.find((v) => v.label === id)?.labelEn ?? seriesLabel(id);
}

/** 系列/变体的兜底 id（两处共用一个常量，防止「标准」在两处写成不同字） */
export const SERIES_FALLBACK = '标准';
/** 同上，但只在**本文件内**使用（seriesOf 的返回值），故不 export */
const SERIES_OTHER = '其它';

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
  if (name === UNKNOWN) return i18n.global.t('common.unpublished');
  const s = name.replace(/(\d)(Pro)(?=$|[^A-Za-z0-9])/g, '$1 $2').trim();
  // 芯片型号是**标识**，不是描述 —— 厂商有官方英文名就必须用官方的
  // （麒麟 → Kirin、A18 芯片 → A18 chip）。以前这一层根本没有，英文页的
  // 参数表/分面/榜单里直接吐「麒麟9020」「A18 芯片」——SSR 冒烟也没报，因为
  // 「麒麟」「芯片」在 products.json 的官网原文里出现过，被数据白名单放过了。
  //
  // 术语翻译统一走 glossary（`data/curated/glossary.json`），这里不另写一份替换表：
  // 芯片名在参数表、分面、榜单、搜索建议、画布短规格里都要显示，两处各写一份
  // 迟早分叉（这正是上一轮刚踩过的「两份真源」）。
  return localizeSpecValue(s);
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
export function isMultiChip(name: string): boolean {
  if (name === UNKNOWN) return false;
  // 判据 = 归一后串里**同一芯片品牌前缀出现两次**。前缀清单来自策展字典
  //（麒麟/A/天玑/骁龙/玄戒/Exynos/Tensor）——新芯片体系改 JSON 即可（P2 治理）。
  for (const prefix of CURATED.chipMultiPrefixes) {
    const first = name.indexOf(prefix);
    if (first < 0) continue;
    if (name.indexOf(prefix, first + prefix.length) > 0) return true;
  }
  return false;
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

// ── 价格 ──

/**
 * 官方起售价（元）：判据在 price.ts 里，**全站只有那一份**
 * （曾经 facets / exportSummary 各抄一份且口径不一致，见 price.ts 文件头）。
 * 这里转出是为了不让调用方改 import，别再往这里加第二份实现。
 */
export { basePriceCny };

/**
 * 价格筛选档位（京东式固定档，URL 稳定）。
 *
 * 用**固定档**而非动态分桶：URL 里的档 id 不随数据变化而错位，分享链接才可靠；
 * 且符合用户对「手机价格段」的直觉认知。某档 0 台时页面灰显不可点（见 FilterBar）。
 * 缺官方起售价的机型落入 `未公布` 项（不编造假价格，与 `basePriceCny` 同口径）。
 */
/** 价格档：**数据来自策展字典**（调档位改 data/curated/facets.json，不改代码）；max null = 无穷。 */
export const PRICE_BUCKETS: Array<{
  id: string;
  label: string;
  labelEn: string;
  min: number;
  max: number;
}> = CURATED.priceBuckets.map((b) => ({
  id: b.id,
  label: b.label,
  labelEn: b.labelEn,
  min: b.min,
  max: b.max ?? Infinity,
}));

/** 机型 → 价格档 id。缺价返回 UNKNOWN（不编造假价格）。 */
export function priceBucket(p: Product): string {
  const v = basePriceCny(p);
  if (v == null) return UNKNOWN;
  for (const b of PRICE_BUCKETS) if (v >= b.min && v <= b.max) return b.id;
  // 兜底到最高档。⚠️ 必须先判空：PRICE_BUCKETS 来自 curated 数据
  // （data/curated/facets.json），字典被清空/读失败时 `[len-1]` 是 undefined，
  // `.id` 当场抛错 —— 而价格档参与分面与首页，一抛全页白屏。
  // 空字典返回 UNKNOWN：没有档位定义就不该硬编一个（2026-10-14 审计 B1）。
  const last = PRICE_BUCKETS[PRICE_BUCKETS.length - 1];
  return last ? last.id : UNKNOWN;
}

/** 价格档 id → 显示名（分面用，语言感知：档位名在 data/curated/facets.json 双语） */
export function priceLabel(id: string): string {
  if (id === UNKNOWN) return i18n.global.t('common.priceUnpublished');
  const b = PRICE_BUCKETS.find((x) => x.id === id);
  return pickLocale(b?.label ?? id, b?.labelEn);
}

/**
 * 金额本地化。**千分位随语言**：中文按 zh-CN、英文按 en-US（`1,299` 两侧同形，
 * 但 `¥` 与数字的相对位置、未来更大数量级的分组都要跟着语言走，不能写死 zh-CN）。
 */
export function fmtPriceCny(v: number | null): string {
  if (v == null) return i18n.global.t('common.priceUnpublished');
  return `${i18n.global.t('common.currencySymbol')}${v.toLocaleString(currentLocale() === 'en' ? 'en-US' : 'zh-CN')}`;
}

// ── 榜单取样 ──

interface Spotlight {
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

/**
 * 机型副标题：系列 · 变体 · 形态 · 芯片，一行说清「是谁」。
 *
 * 下沉理由（2026-10-14 审计 P2-4）：CompareView 与 RankingsView 曾各写一份，
 * 且**答案不同**——对比页含变体与形态，榜单页只有系列+芯片。同一台机在两个
 * 页面身份说明不一致，而两边产出的都是合法字符串，没有任何测试会红。
 *
 * 文案纪律与全文件一致：lib 只做 id→键映射（FORM_LABEL_KEY），
 * 具体文字经 i18n.global.t 取（chipNameLabel 同样如此），不硬编码中文。
 *
 * @param opts.variant 含变体档（Pro / Ultra / 优享版…），默认 true
 * @param opts.form    含形态（折叠屏），默认 true
 */
export function productSubline(
  p: Product,
  opts: { variant?: boolean; form?: boolean } = {},
): string {
  const withVariant = opts.variant !== false;
  const withForm = opts.form !== false;
  const chip = chipNameLabel(p.chipset?.name ?? '');
  const v = variantOf(p);
  return [
    seriesLabel(seriesOf(p)),
    withVariant && v !== SERIES_FALLBACK ? variantLabel(v) : null,
    withForm && isFoldable(p) ? i18n.global.t(FORM_LABEL_KEY.foldable) : null,
    chip === UNKNOWN ? null : chip,
  ]
    .filter(Boolean)
    .join(' · ');
}
