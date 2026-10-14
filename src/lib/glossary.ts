/**
 * 参数值「官网原文」的官方英文对照。
 *
 * 背景：本站的 specs 值是**中文官网原文**（数据诚信：不改写、不换算）。
 * 于是英文界面下参数表会中英混排 —— 而数值（`6.1 英寸`、`120 Hz`）本来就是
 * 语言中立的，混排的只有**术语**（`超视网膜 XDR 显示屏`、`昆仑玻璃`、`A18 芯片`）。
 *
 * 为什么是「术语对照表」而不是「抓一份英文官网」：
 *   1. 华为国际站根本没有国内站这些机型（Mate 90 系列在
 *      `consumer.huawei.com/en/phones/mate90-pro-max/specs/` 实测 404）——数据不存在；
 *   2. 真要抓就得把 1111 行规范化逻辑再做一份英文版（它深度依赖 `/芯片$/`、
 *      `/超瓷晶|昆仑/`、`/英寸/` 这类中文正则），等于造出**两份规范性真源**，
 *      两边的「6.1 英寸」出自两套正则却谁也不校对 —— 比中英混排危险得多。
 *   3. 同一份规格的中英两版是**逐条对应**的（已核对：中文「超瓷晶面板 (正面)」
 *      对应英文 `Ceramic Shield front`），所以术语级对照就能拿到官方用词。
 *
 * 纪律（与 `chipPrefixEn` 一致）：**只登记能在厂商官方英文页面找到出处的词**，
 * 每条都带 `ev`（官方页面 URL）。查不到官方英文的一律不登记，英文页保留官网原文。
 * 本站卖点是「可核验」，编造译名比中英混排严重得多。
 *
 * 匹配顺序：整值 exact → 逐片段 exact → 逐片段 pattern → 保留原文。
 * 「逐片段」是因为官网原文本身就是用 `|` / `,` / `、` 分隔的并列短语，
 * 整句替换会因一两个词没登记而整句失效，片段级替换能部分翻译且语法仍然成立。
 */

import glossaryJson from '../../data/curated/glossary.json' with { type: 'json' };
import { currentLocale } from '../i18n';

interface ExactEntry {
  en: string;
  ev: string;
}

interface PatternEntry {
  re: string;
  en: string;
  ev: string;
}

interface PrefixEntry {
  zh: string;
  en: string;
  ev: string;
}

interface GlossaryJson {
  _doc: string;
  _sources: Record<string, string>;
  exact: Record<string, ExactEntry>;
  patterns: PatternEntry[];
  prefixes?: PrefixEntry[];
  screenLabels?: Record<string, string>;
}

const G = glossaryJson as unknown as GlossaryJson;

// 区间一律用 \u 转义而非字面量字形：正则边界不渲染，
// 字面量会要求字体子集带上永不显示的字形（font:check 会拦）。
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 片段分隔符（`|` 是本站 array 分隔符，`,` `，` `、` 是官网原文的并列分隔符）。
 * 用捕获组分隔，才能把分隔符原样拼回去、不破坏原文结构。
 */
const SPLIT = /(\s*\|\s*|\s*,\s*|\s*，\s*|\s*、\s*)/;

/** 编译期展开正则。写错的 pattern 会在模块加载时就炸，不会静默失效。
 * 注意：用非 global 标志——global 正则配 `test()` 会残留 lastIndex，在多次
 * translateSegment 调用间串味导致漏匹配。需整段替换多处的（如全角冒号）走 split/join。 */
const PATTERNS = G.patterns.map((p) => ({ re: new RegExp(p.re), en: p.en }));

export const GLOSSARY_EXACT = G.exact;
export const GLOSSARY_PATTERNS = G.patterns;
export const GLOSSARY_SOURCES = G._sources;

/** 单个片段：exact → 逐 pattern（全部应用）→ 品牌前缀兜底 */
function translateSegment(s: string): string {
  const e = G.exact[s];
  if (e) return e.en;
  let out = s;
  // 内屏/外屏 是结构性标签，可能出现在片段**任意位置**：官网原文常把
  // 「内屏：…」和「外屏：…」用空格拼在同一段（如 Mate X7 的 display.type），
  // 锚定整片段的 pattern 抓不到。所以始终做全局子串替换，不依赖片段首尾。
  // 必须在全角冒号归一化之前跑：否则「：」先被换成半角「: 」，这里的「内屏：」
  // 就匹配不到了（实测把 内屏/外屏 漏成中文）。
  for (const [zh, en] of Object.entries(G.screenLabels ?? {})) {
    if (out.includes(zh)) out = out.split(zh).join(en);
  }
  // 全角冒号「：」在英文里应写成半角「: 」；它可能在一段里出现多次，且不属于术语，
  // 故用 split/join 全局替换（不走会被 lastIndex 串味的 global 正则）。内屏/外屏标签里的
  // 冒号已被上面的 screenLabels 一并换掉，这里只兜底其余的「：」。
  if (out.includes('：')) out = out.split('：').join(': ');
  // 必须**依次应用每一条匹配的 pattern**，不能命中第一条就 break：
  // 官网原文常把多个术语叠在一个片段里（「外屏：第二代昆仑玻璃」= 外屏前缀 + 玻璃型号；
  // 「内屏：可折叠柔性 OLED, …, 最高 240 Hz 触控采样率, 外屏：D 曲面 OLED」），
  // 只换第一个就会把后面的术语漏掉——这正是上一轮深扫漏掉的「英文页残留中文」真因。
  // 安全前提：每条 pattern 的 en 都是英文，替换后不会再被任何（匹配中文的）pattern 二次命中。
  for (const p of PATTERNS) {
    if (p.re.test(out)) out = out.replace(p.re, p.en);
  }
  // 品牌/系列名可以在一行里出现多次（`麒麟 9020A 麒麟 9020B`），而 pattern 是
  // 锚定整片段的、`replace` 只换第一个。所以还剩中文时再做一次全局兜底。
  if (CJK.test(out)) {
    for (const p of G.prefixes ?? []) {
      if (out.includes(p.zh)) out = out.split(p.zh).join(p.en);
    }
  }
  return out; // 查不到官方英文 → 保留官网原文（诚实降级，不编造）
}

/**
 * 英文界面下把 specs 展示值里的术语换成官方英文；中文界面原样返回。
 *
 * 只处理**字符串**，且不含 CJK 时直接返回（数值/英文原文零开销）。
 */
export function localizeSpecValue(value: string | null | undefined): string {
  if (value == null) return '';
  const v = String(value);
  if (currentLocale() !== 'en') return v;
  if (!CJK.test(v)) return v;

  const whole = G.exact[v.trim()];
  if (whole) return whole.en;

  let out = '';
  for (const seg of v.split(SPLIT)) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(seg);
    if (!m || !m[2]) {
      out += seg; // 纯分隔符原样保留
      continue;
    }
    out += m[1] + translateSegment(m[2]) + m[3];
  }
  return out;
}
