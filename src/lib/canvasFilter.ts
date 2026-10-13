/**
 * 无限画布的筛选与分面 —— 归一化/匹配逻辑来自 `./query`，本地代码零外部依赖。
 * 理由同 board.ts / globe.ts：能被 scripts/selftest.mjs 直接 import，护栏才罩得住。
 *
 * 口径六条（都写在代码里，不是文档里，免得以后被人「优化」掉）
 * ------------------------------------------------------------
 * 1. **与全站搜索共用 `./query` 的分词与容错**。这一条是**修 bug 写下来的**：
 *    画布原本自带一份 `tokenize`（空白切分 + 字面量 includes），与搜索页的
 *    归一化通道口径不一致 —— 同一台机，用户在搜索页搜 `mate80` 有结果，
 *    在画布里搜同一个词得到 0 台。**同一个功能两个答案，比少一个功能更糟**，
 *    所以口径必须只有一份。（画布不搜芯片，故本地只拼 name/nameZh/line/brand。）
 * 2. **分词后 AND**。搜「华为 mate」用 OR 等于没筛。多个词可命中不同字段。
 *    精确优先、无果才放宽到整串归一化 —— 与全站搜索同一条，见 qHits 注释。
 * 3. **缺失字段不参与匹配**。官网没公布的字段若当成空串去 `includes`，
 *    空串会被任何查询命中 —— 搜索里最典型的「越搜越多」故障。
 *    所以拼 haystack 时把空值直接剔掉，而不是留空串。
 * 4. **筛选态可序列化进 URL**（?brand=&line=&year=&q=&sort=），刷新、分享、
 *    浏览器前进后退都能还原同一份画面。hash 路由下这是唯一可靠做法。
 * 5. **分面在自身维度上不收窄，在其它维度上照常收窄**。选了华为之后，
 *    品牌分面里苹果仍显示它的真实台数（否则用户再也没法改主意，界面把自己锁死）；
 *    但产品线分面里不该出现 iPhone —— 苹果那两台确实已被筛掉，列出来只会让用户
 *    点进一个空画面。「全部」项显示的是**点它之后会看到的台数**，
 *    也就是「只清掉该维度、其它条件仍生效」的结果数。
 * 6. **画布的结果顺序由 sort 决定，不做相关度打分**。搜索页按相关度排
 *    （第一屏第一位最关键）；画布是空间布局，顺序由用户选的分面决定，
 *    强塞相关度反而会让「按名称排序」这种确定性行为变得不可预期。
 */

import { compact, loose, matchCompact, matchExact, queryTokens } from './query';

/** 筛选/画布只用到这几个字段，刻意收窄 —— 画布不该关心电池容量 */
export interface CanvasDoc {
  id: string;
  name: string;
  nameZh: string | null;
  line: string;
  brand: string;
  /** 厂商中文名，画格子上要显示 */
  brandZh: string;
  releaseDate: string;
  releaseDatePrecision: string;
  status: string;
}

export type SortKey = 'newest' | 'oldest' | 'name' | 'ppi';

export const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'newest', label: '新→旧' },
  { key: 'oldest', label: '旧→新' },
  { key: 'name', label: '名称' },
  { key: 'ppi', label: '像素密度' },
];

export interface CanvasFilter {
  brand: string;
  line: string;
  year: string;
  q: string;
  sort: SortKey;
}

export const EMPTY_FILTER: CanvasFilter = { brand: '', line: '', year: '', q: '', sort: 'newest' };

/** 与全站搜索同口径的分词、归一化与匹配（唯一一份实现，见文件头口径 1） */
export { tokenize } from './query';

interface FilterableDoc {
  doc: CanvasDoc;
  /** NFKC + 小写、保留分隔符的检索串 */
  haystack: string;
  /** 抹平分隔符后的检索串 */
  compact: string;
  /** 发布年份，从 releaseDate 前四位切；日期缺失时为空串（不参与年份筛选） */
  year: string;
}

export function buildCanvasDocs(docs: CanvasDoc[]): FilterableDoc[] {
  return docs.map((doc) => {
    // 缺失字段直接不拼 —— 见口径 3（留空串会被任何查询命中）
    const joined = [doc.name, doc.nameZh ?? '', doc.line, doc.brand, doc.brandZh]
      .filter(Boolean)
      .join(' ');
    return {
      doc,
      haystack: loose(joined),
      compact: compact(joined),
      year: (doc.releaseDate || '').slice(0, 4),
    };
  });
}

/**
 * 关键词分级匹配：**先精确，一台都没有才放宽到整串归一化**。
 *
 * 分级（而非并集）的原因同全站搜索：并集会让 `iphone 1` 命中 `iPhone 16e`
 * （归一化后 `iphone1` 是 `iphone16e` 的子串）。
 *
 * ⚠️ 分级必须在**这一批候选集内**做，不能全库做。
 *   分面是「跳过自己那一维」后统计的，候选集与筛选不同；
 *   若在全库层面分级，分面会数出精确通道根本不会给的台数，
 *   「全部 = 各分面项之和」这条等式就断了（那正是自测钉着的不变量）。
 *
 * @returns 长度与 `items` 相同，布尔数组
 */
function qHits(items: FilterableDoc[], q: string): boolean[] {
  const tokens = queryTokens(q);
  const exact = items.map((it) => matchExact(it, tokens));
  if (exact.some(Boolean)) return exact;
  return items.map((it) => matchCompact(it, q));
}

/** 把 qHits 与其余维度条件合成一个判定，避免两处重复写 */
function passes(item: FilterableDoc, f: CanvasFilter, skip: string[], qOk: boolean): boolean {
  if (f.brand && !skip.includes('brand') && item.doc.brand !== f.brand) return false;
  if (f.line && !skip.includes('line') && item.doc.line !== f.line) return false;
  if (f.year && !skip.includes('year') && item.year !== f.year) return false;
  return qOk;
}

/** 排序。缺失值一律排到末尾 —— 官网没公布的项不该混在有值的中段冒充数据 */
function sortCanvas(
  docs: CanvasDoc[],
  sort: SortKey,
  ppiOf?: (id: string) => number | null,
): CanvasDoc[] {
  const out = [...docs];
  const byName = (a: CanvasDoc, b: CanvasDoc) => a.name.localeCompare(b.name, 'en');
  if (sort === 'name') return out.sort(byName);
  if (sort === 'oldest') {
    return out.sort((a, b) => (a.releaseDate || '￿').localeCompare(b.releaseDate || '￿'));
  }
  if (sort === 'ppi') {
    return out.sort((a, b) => {
      const av = ppiOf?.(a.id) ?? null;
      const bv = ppiOf?.(b.id) ?? null;
      if (av == null && bv == null) return byName(a, b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
  }
  return out.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
}

export function applyFilter(
  docs: FilterableDoc[],
  f: CanvasFilter,
  ppiOf?: (id: string) => number | null,
): CanvasDoc[] {
  const ok = qHits(docs, f.q);
  const hit = docs.filter((it, i) => passes(it, f, [], ok[i]));
  return sortCanvas(
    hit.map((h) => h.doc),
    f.sort,
    ppiOf,
  );
}

interface Facet {
  value: string;
  label: string;
  count: number;
}

/**
 * 按 `key` 分面。`skip` 列出**本维度自己**（不拿它收窄），
 * 其它维度照常收窄。见文件头口径 4。
 *
 * 「全部」项的 count 就是「点它之后会看到的台数」= 只清掉本维度后的结果数。
 * 它同时等于各分面项之和（同维度内互斥且完备）—— 这条等式由自测钉着。
 */
function facet(
  docs: FilterableDoc[],
  f: CanvasFilter,
  skip: Array<'brand' | 'line' | 'year'>,
  labelOf: (d: FilterableDoc) => string,
): Facet[] {
  const ok = qHits(docs, f.q);
  const bucket = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < docs.length; i += 1) {
    const item = docs[i];
    if (!passes(item, f, skip, ok[i])) continue;
    total += 1;
    const v = labelOf(item);
    if (!v) continue;
    bucket.set(v, (bucket.get(v) ?? 0) + 1);
  }
  const out: Facet[] = [...bucket.entries()].map(([value, count]) => ({
    value,
    label: value,
    count,
  }));
  // 「全部」始终排第一
  out.unshift({ value: '', label: '全部', count: total });
  return out;
}

export function brandFacets(docs: FilterableDoc[], f: CanvasFilter): Facet[] {
  return facet(docs, f, ['brand'], (i) => i.doc.brand);
}

export function lineFacets(docs: FilterableDoc[], f: CanvasFilter): Facet[] {
  return facet(docs, f, ['line'], (i) => i.doc.line);
}

export function yearFacets(docs: FilterableDoc[], f: CanvasFilter): Facet[] {
  return facet(docs, f, ['year'], (i) => i.year);
}

/* ── URL 序列化 ──
 * 只往 query 写非默认值，空字段不写 —— 分享出去的链接才短，
 * 且「#canvas」与「#canvas?sort=newest」指的是同一份画面（sort 是默认值）。
 * 未知取值（手改的链接、旧版本遗留）一律回落默认值，不抛错。 */

const FILTER_KEYS = ['brand', 'line', 'year', 'q', 'sort'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const SORT_KEYS: SortKey[] = ['newest', 'oldest', 'name', 'ppi'];

export function parseFilter(query: Record<string, unknown>): CanvasFilter {
  const get = (k: FilterKey) => {
    const v = query[k];
    if (Array.isArray(v)) return String(v[0] ?? '');
    return v == null ? '' : String(v);
  };
  const sort = get('sort');
  return {
    brand: get('brand'),
    line: get('line'),
    year: get('year'),
    q: get('q'),
    sort: (SORT_KEYS as string[]).includes(sort) ? (sort as SortKey) : 'newest',
  };
}

export function filterToQuery(f: CanvasFilter): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.brand) q.brand = f.brand;
  if (f.line) q.line = f.line;
  if (f.year) q.year = f.year;
  if (f.q.trim()) q.q = f.q.trim();
  if (f.sort !== 'newest') q.sort = f.sort;
  return q;
}

export function isFiltered(f: CanvasFilter): boolean {
  return Boolean(f.brand || f.line || f.year || f.q.trim());
}
