import type { Product, Vendor } from '../types';
import {
  compact,
  loose,
  matchCompact,
  matchExact,
  queryTokens,
  splitRuns,
  tokenize,
} from './query';

/**
 * 全站搜索：纯前端、无索引服务、60 条数据量下线性扫描足够。
 *
 * 归一化与匹配的口径全在 `./query.ts`（与无限画布的筛选共用），
 * 这里只管「哪些字段进检索串」与「结果怎么排序」。
 *
 * 口径四条，都写在代码里而不是文档里（免得以后有人「优化」掉）：
 *
 * 1. **分词后 AND，容错细则见 query.ts 文件头**（分隔符 / 汉字边界 / 数字边界 /
 *    精确优先）。这里不重复，只强调一条纪律：**口径只能有一份**，
 *    搜索页与画布曾各有一份 tokenize，结果用户在画布里搜 `mate80` 得到 0 台。
 *
 * 2. **只搜「用户会打出来的字」**，即机型名、中文名、产品线、芯片名、厂商名。
 *    刻意不搜颜色/材质/规格数值：搜「钛金属」出来一堆 8g 重的机不符合预期，
 *    而颜色是用户看到图之后才会去比的东西，不该是找机器的入口。
 *
 * 3. **缺失字段不参与匹配**。见 query.ts 口径 6。
 *
 * 4. **结果按相关度排序，不按数据集顺序**。原先直接返回 `docs.filter(...)`，
 *    顺序就是 products.json 的录入顺序 —— 搜「mate80」时 Mate 80 Pro Max
 *    可能排在 Mate 80 前面。这是**故障被习惯掩盖**：看久了就不觉得是 bug。
 */

export interface SearchableDoc {
  product: Product;
  vendor: Vendor | undefined;
  /** NFKC + 小写、保留分隔符的检索串（含空格），避免每次按键都重建 */
  haystack: string;
  /** 抹平分隔符后的检索串；只在精确通道一无所获时启用 */
  compact: string;
  /** 品牌维度单独存一份，用于「只看某个品牌」的快捷过滤 */
  brand: string;
}

/**
 * 进检索串的字段，顺序即**权重**（见 score）。
 * 机型名 → 中文名 → 产品线 → 芯片 → 厂商：厂商名放最后，
 * 因为没人会拿「华为」当区分条件，那是产品线与代号的活。
 */
const fields = (p: Product, v: Vendor | undefined): string[] =>
  [
    p.name,
    p.nameZh ?? '',
    p.line ?? '',
    p.chipset?.name ?? '',
    p.brand ?? '',
    v?.name ?? '',
    v?.nameZh ?? '',
  ].filter(Boolean);

export { compact, tokenize, splitRuns, queryTokens };

export function buildDocs(products: Product[], vendors: Map<string, Vendor>): SearchableDoc[] {
  return products.map((product) => {
    const v = vendors.get(product.brand);
    const fs = fields(product, v);
    const joined = fs.join(' ');
    return {
      product,
      vendor: v,
      brand: product.brand,
      haystack: loose(joined),
      compact: compact(joined),
    };
  });
}

export interface SearchOpts {
  /** 品牌过滤；空串表示不限 */
  brand?: string;
}

/**
 * 相关度打分：分高排前。
 *
 * 为什么需要打分：搜索结果的第一位是用户唯一一定会看的那一条。
 * 让它由 JSON 里的行号决定，等于把「最相关的」交给一个跟相关性无关的变量。
 *
 * 规则按优先级（先满足先返回）：
 *   1. 归一化整串**完全等于**机型名 → 最高。搜「mate70pro」就该是它排第一，
 *      不是 Pro+、不是 Pro 优享版。
 *   2. 机型名**以**查询整串开头 → 次高（`mate80` 让 Mate 80 压过 Mate 80 Pro Max）。
 *   3. 查询里有多少词命中**机型名**（多命中 > 少命中），机型名短者略占优
 *      （`nova 14` 应在 `nova 14 Pro` 之前，除非用户打的正是 Pro ——
 *      那已被规则 1/2 提前截住）。
 *
 * ⚠️ 机型名缺失时（契约允许）一律 0 分，不靠别的字段命中混进中段。
 */
function score(d: SearchableDoc, q: string): number {
  const cname = compact(d.product.name);
  if (!cname) return 0;
  const cq = compact(q);
  if (!cq) return 0;
  if (cname === cq) return 1000;
  if (cname.startsWith(cq)) return 700 - Math.min(cname.length, 99);

  let inName = 0;
  for (const t of tokenize(q)) if (cname.includes(compact(t))) inName += 1;
  // 同分时短名优先：`- length/100` 落在 0.01~0.99，不足以掀翻前两条规则
  return inName * 10 - Math.min(cname.length, 99) / 100;
}

/** 稳定排序：同分保持数据集原顺序（V8 的 sort 是稳定的） */
function byScore(docs: SearchableDoc[], q: string): SearchableDoc[] {
  return [...docs].sort((a, b) => score(b, q) - score(a, q));
}

/**
 * 分级搜索：先精确，无结果再归一化。
 * 返回**并集**（精确结果在前），这样「`nova 14` 命中 3 台、其中 1 台靠归一化」
 * 这类混合情形不会漏掉靠后通道找到的那台。
 */
export function search(docs: SearchableDoc[], q: string, opts: SearchOpts = {}): SearchableDoc[] {
  const tokens = queryTokens(q);
  const brand = opts.brand ?? '';
  const qTrim = q.trim();
  if (!tokens.length && !brand) return [];

  const brandOk = (d: SearchableDoc) => !brand || d.brand === brand;

  const exact = docs.filter((d) => brandOk(d) && matchExact(d, tokens));
  if (exact.length || !tokens.length) return byScore(exact, qTrim);

  return byScore(
    docs.filter((d) => brandOk(d) && matchCompact(d, qTrim)),
    qTrim,
  );
}

/** 搜索框下方的建议词：取数据里真实存在的值，不编造 */
export function suggestions(docs: SearchableDoc[], limit = 8): string[] {
  const seen = new Set<string>();
  for (const d of docs) {
    // 只收产品线与芯片名这类「短而准」的词，机型名太长不适合当建议
    for (const raw of [d.product.line, d.product.chipset?.name, d.vendor?.nameZh]) {
      const v = (raw ?? '').trim();
      if (v && v.length <= 14) seen.add(v);
    }
    if (seen.size >= limit * 3) break;
  }
  return [...seen].slice(0, limit);
}
