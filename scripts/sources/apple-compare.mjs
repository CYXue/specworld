#!/usr/bin/env node
/**
 * Apple 官网「对比页矩阵」取数适配器 —— apple-official（矩阵源）
 * =====================================================================
 * 产出契约见 `scripts/sources/types.ts`：本文件**只**把官网页面变成
 * 「分组.行标签 → 页面原文」的扁平键值对，不做单位换算、不做语义映射、
 * 不判断口径、不决定这个值属于契约里的哪个字段。
 *
 * 为什么需要这个源
 * ----------------
 * `https://www.apple.com.cn/{slug}/specs/` 只保留了 6 个机型的规格页
 * （iphone-16 / iphone-17 / iphone-17e / iphone-18-pro / iphone-air / iphone-duo）。
 * 2024-09 之后的 16 Plus / 16 Pro / 16 Pro Max / 16e / 17 Pro / 17 Pro Max
 * 的 `/specs/` 已经 301 下线（`scripts/sources/apple.mjs` 会把它们记进 skipped）。
 * 但 `/iphone/compare/` 页面里**内联**了一整张官方对比矩阵，42 款机型一次拿全，
 * 粒度比 specs 页粗，但同属官网、口径一致，可以把那 6 台补回来。
 *
 * 页面结构（实测，2026-10-02，1967 KB SSR HTML，无需 JS）
 * ------------------------------------------------------
 *   <div id="backport-data">                        ← 唯一的矩阵容器（页面里没有 <table>）
 *     <div class="backport-group compare-section css-sticky">   ← 表头组：机型名，42 列
 *       <div class="backport-row">
 *         <div class="holder"></div> <div class="holder"></div>  ← 前两列是空的占位
 *         <div data-type="products" class="cell-item">iPhone Duo</div> × 42
 *     <div class="backport-group compare-section">               ← 25 个规格分组
 *       <div class="backport-row">
 *         <div class="compare-rowheader">速览</div>              ← 子列 0：分组名（整个分组只有第一行有）
 *         <div class="compare-column">显示屏：屏幕尺寸</div>      ← 子列 1：行标签（**经常为空**）
 *         <div class="feature-group compare-column">…</div> × 42 ← 子列 2..43：42 个机型列，顺序与表头严格一致
 *
 * 三条必须遵守的结构事实（踩过的坑）
 * ----------------------------------
 *  a. **每个 `backport-row` 恰好 44 个直接子 div**：2 个前导列（分组名 / 行标签）+ 42 个机型列。
 *     所以「第 i 个数据列 == 表头第 i 个机型」是**位置对齐**，不需要任何名字匹配。
 *     必须按标签配对做深度感知切分后只取**直接子元素**：用 `outer` 全串去 test 类名
 *     （`_research/probe/apple/fetch-specs.mjs` 的 `walk()` 就是这么写的）会把整个分组
 *     当成一行，于是分组标题行被误判成唯一的数据行，第一组直接解出
 *     `{section:"外观", rows:[{label:"外观", cells:["外观","Image Link"]}]}` 这种错位结果。
 *  b. **行标签经常是空串**：`显示屏`(18 行) / `芯片`(5) / `摄像头`(20) / `视频拍摄`(24) /
 *     `前置摄像头`(25) / `容量`(4) 等分组里，SSR 出来的行标签 cell 就是
 *     `<div data-store-value=""></div>`（官网就是靠分组名做左侧粘性列，明细行不重复标签）。
 *     这类行**不能丢**（丢掉的正是屏幕尺寸、分辨率、亮度、像素数这些核心数据），
 *     也不能拿值当键（每列的值都不一样，键必须跨机型一致）。做法见 `assignRowKeys()`：
 *     用「分组名」占位并按出现次序加 `(2) (3) …`，与 `apple.mjs` 的匿名键约定一致。
 *  c. **单元格的值在 `cell-item > div[data-store-value]` 里，且可能一个格子多个值**
 *     （配色那种 `feature-group` 下有 2–6 个 `cell-item`）→ 用 ` | ` 连接；
 *     `data-store-value` 内部还会嵌 `<span class="badge-unit"> 英寸</span>`（要保留）、
 *     `<sup class="footnote">`（脚注角标，要剥掉，否则「容量11」「Siri21」这种会污染分组名）、
 *     `<br>`（换行 → ` | `）和 `<span class="visuallyhidden">`（**只给读屏用的隐藏文本，必须剪掉**：
 *     价格占位格是 `—` + 隐藏的 `不适用`，不剪会得到 `128GB | —不适用`）。
 *     `data-aria` 属性同样是无障碍文案，不进 raw。
 *
 * 用法
 * ----
 *   node scripts/sources/apple-compare.mjs --out _work/apple-compare.raw.json --cache _work/apple-compare.cache/
 *
 * 参数
 * ----
 *   --out <file>      结果 JSON 落盘路径（相对路径按当前工作目录解析）
 *   --cache <dir>     对比页 HTML 落盘；重跑命中缓存则不发请求
 *   --only <names>    只产出指定机型（slug 或官网机型名，逗号分隔，可重复），调试用
 *   --delay <ms>      请求最小间隔，默认 1100（不得小于 1100）
 *   --cache-only      只读缓存，缺缓存即记 skipped，不发任何请求
 *   --json            把完整结果打到 stdout
 *   --help
 *
 * 零第三方依赖，Node >= 18（内置 fetch）。串行请求，间隔 >= 1.1s。
 */

import { mkdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

export const SOURCE_ID = 'apple-official';

/** 唯一入口：官方对比矩阵。只访问 apple.com.cn */
export const COMPARE_URL = 'https://www.apple.com.cn/iphone/compare/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const REQUEST_TIMEOUT_MS = 45_000;
const RETRIES = 2; // 失败后最多再试 2 次 → 共 3 次尝试
const RETRY_BACKOFF_MS = 1_500;
const DEFAULT_DELAY_MS = 1_100;
const MIN_DELAY_MS = 1_100;
const CACHE_FILE = '_compare.html';
const MAX_VALUE_CHARS = 1_200;
const MAX_NOTE_ITEMS = 200;

/** 每个 backport-row 的前导列数：0=分组名(rowheader)，1=行标签，2..=42 个机型列 */
const LEADING_COLUMNS = 2;

/** 对比页里表示「该机型无此项」的字面占位符（原样保留，只是统计一下） */
const PLACEHOLDER_VALUES = new Set(['-', '—', '–', '不适用']);

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&times;': '×', '&ndash;': '–',
  '&mdash;': '—', '&hellip;': '…', '&minus;': '−', '&middot;': '·',
  '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&deg;': '°',
};

/* ------------------------------------------------------------------ */
/* HTML → 文本                                                         */
/* ------------------------------------------------------------------ */

/** 键与值共用的清洗：去零宽字符 / 控制字符，压缩空白，去首尾空格 */
function cleanText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u200b-\u200f\u2028\u2029\u2060\ufeff]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[\s\u00a0\u3000]+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  let out = s;
  for (const [k, v] of Object.entries(ENTITIES)) out = out.split(k).join(v);
  return out
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const cp = parseInt(h, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = Number(d);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
}

/**
 * 剪掉「只给读屏用的隐藏文本」整段。
 *
 * 对比页的价格占位格是这样写的：
 *   `<span aria-hidden="true" class="mdash cap-price">—</span><span class="visuallyhidden">不适用</span>`
 * 肉眼看到的是 `—`，`不适用` 是给屏幕阅读器的。不剪掉就会得到
 * `128GB | —不适用` 这种把无障碍文案混进原文的值（`FINDINGS.md` 里 aria-label 那条坑的同族）。
 * 注意只能按 class 判：那个可见的 `—` 同样带 `aria-hidden="true"`。
 */
function stripHiddenText(html) {
  let s = html;
  for (let guard = 0; guard < 50; guard += 1) {
    const m = s.match(
      /<(span|div|p|a|strong|em|li)\b[^>]*\bclass\s*=\s*"[^"]*\b(?:visuallyhidden|visually-hidden|sr-only)\b[^"]*"[^>]*>/i,
    );
    if (!m) break;
    const tag = m[1].toLowerCase();
    const openEnd = s.indexOf('>', m.index) + 1;
    const pairRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi');
    pairRe.lastIndex = openEnd;
    let depth = 1;
    let cutEnd = s.length;
    let t;
    while ((t = pairRe.exec(s))) {
      if (t[0][1] === '/') {
        depth -= 1;
        if (depth === 0) { cutEnd = t.index + t[0].length; break; }
      } else depth += 1;
    }
    s = `${s.slice(0, m.index)} ${s.slice(cutEnd)}`;
  }
  return s;
}

/** 剥掉脚注角标 / 脚本 / 样式 / 读屏隐藏文本，解码实体；`separator` 决定换行是否变成 ` | ` */
function stripTags(html, separator) {
  if (!html) return '';
  return decodeEntities(
    stripHiddenText(String(html))
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, separator)
      .replace(/<\/(p|li|div|tr|td|th|h[1-6]|figcaption|section)>/gi, separator)
      .replace(/<[^>]+>/g, ''),
  );
}

/**
 * 单元格值用：块级结束标签与 `<br>` 变成 ` | `。
 * 与 `apple.mjs` 的 `htmlToText` 同口径，方便规范化层对齐两个源的字符串形状。
 */
function htmlToText(html) {
  if (!html) return '';
  return cleanText(
    stripTags(html, ' | ')
      .replace(/[ \t\r\n]*\|[ \t\r\n]*/g, ' | ')
      .replace(/(\s*\|\s*)+/g, ' | ')
      .replace(/^[\s|]+|[\s|]+$/g, ''),
  );
}

/** 行标签 / 分组名用：**不插**分隔符（源码里「蜂窝网络和\n无线连接」会折行） */
function plainText(html) {
  if (!html) return '';
  return cleanText(stripTags(html, ' '));
}

/* ------------------------------------------------------------------ */
/* 深度感知的 div 切分                                                  */
/* ------------------------------------------------------------------ */

/** 从 pos（开标签之后）起找到配对的 </div> */
function matchDivEnd(html, pos) {
  let depth = 1;
  const re = /<div\b[^>]*>|<\/div>/gi;
  re.lastIndex = pos;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') {
      if (--depth === 0) return { start: m.index, end: m.index + m[0].length };
    } else depth += 1;
  }
  return null;
}

/** 只取「深度为 1 的直接子 <div>」；每个元素带开标签、outer、inner */
function directDivs(html) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    const rest = html.slice(i);
    const m = rest.match(/^\s*<div\b[^>]*>/i);
    if (!m) {
      const next = rest.search(/<div\b/i);
      if (next < 0) break;
      i += next;
      continue;
    }
    const afterOpen = i + m[0].length;
    const end = matchDivEnd(html, afterOpen);
    if (!end) break;
    out.push({ openTag: m[0], outer: html.slice(i, end.end), inner: html.slice(afterOpen, end.start) });
    i = end.end;
  }
  return out;
}

const classOf = (openTag) => (openTag.match(/\bclass\s*=\s*"([^"]*)"/i) || [, ''])[1];
const attrOf = (openTag, name) =>
  (openTag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')) || [, ''])[1];

/**
 * 取单元格的原文。
 *   1. 有直接子 `cell-item`（配色 / 容量那种一格多值）→ 每个子项取一次，用 ` | ` 连接；
 *   2. 否则取该元素内第一个 `div[data-store-value]` 的正文；
 *   3. 都没有（页面里有几个纯文本占位格）→ 退回元素自身正文。
 * `data-aria`（「不适用」「进一步了解 eSIM」这类无障碍文案）不参与，避免污染原文。
 */
function cellValue(el) {
  const items = directDivs(el.inner).filter((d) => /\bcell-item\b/.test(classOf(d.openTag)));
  if (items.length) {
    const parts = items.map((d) => storeValueOf(d) || htmlToText(d.inner)).filter(Boolean);
    return parts.join(' | ');
  }
  const own = storeValueOf(el);
  if (own) return own;
  return htmlToText(el.inner);
}

/** 元素内第一个 `div[data-store-value]` 的正文（深度感知取到配对 </div>） */
function storeValueOf(el) {
  const m = el.inner.match(/<div\b[^>]*\bdata-store-value\s*=\s*"[^"]*"[^>]*>/i);
  if (!m) return '';
  const after = m.index + m[0].length;
  const end = matchDivEnd(el.inner, after);
  return htmlToText(el.inner.slice(after, end ? end.start : el.inner.length));
}

/** 定位 `#backport-data` 并取出其正文（不依赖属性顺序） */
export function sliceBackportData(html) {
  const attrAt = html.search(/\bid\s*=\s*"backport-data"/i);
  if (attrAt < 0) return null;
  const openAt = html.lastIndexOf('<div', attrAt);
  if (openAt < 0) return null;
  const openEnd = html.indexOf('>', attrAt) + 1;
  const end = matchDivEnd(html, openEnd);
  return { start: openAt, body: end ? html.slice(openEnd, end.start) : html.slice(openEnd) };
}

/* ------------------------------------------------------------------ */
/* 矩阵解析                                                            */
/* ------------------------------------------------------------------ */

/**
 * 解析 `/iphone/compare/` 的 `#backport-data` → 42 列表头 + 25 个规格分组。
 *
 * 返回 `{ found, products, groups, warnings }`，其中 groups[i].rows[j] 形如
 * `{ label, key, cells: string[42] }`（`key` 见 `assignRowKeys`）。
 */
export function parseCompareMatrix(html) {
  const warnings = [];
  const sliced = sliceBackportData(html);
  if (!sliced) {
    return { found: false, products: [], groups: [], warnings: ['页面里没有 #backport-data 容器'] };
  }

  const topGroups = directDivs(sliced.body).filter((g) =>
    /\bbackport-group\b/.test(classOf(g.openTag)),
  );
  let products = [];
  const groups = [];

  for (const g of topGroups) {
    const gClass = classOf(g.openTag);
    const rows = directDivs(g.inner).filter((r) => /\bbackport-row\b/.test(classOf(r.openTag)));
    if (!rows.length) continue;

    // 表头组：带 data-type="products" 的单元格就是 42 个机型名，顺序即列顺序
    const productCells = rows
      .flatMap((r) => directDivs(r.inner))
      .filter((k) => /\bdata-type\s*=\s*"products"/i.test(k.openTag));
    if (productCells.length) {
      const names = productCells.map((c) => cellValue(c)).filter(Boolean);
      if (!products.length) products = names;
      else if (names.length > products.length) products = names;
      continue; // 表头组不是规格分组
    }

    // 规格分组的判定：第一行的第 0 个子列是 compare-rowheader（分组名）
    const firstKids = directDivs(rows[0].inner);
    const section = firstKids[0] && /\bcompare-rowheader\b/.test(classOf(firstKids[0].openTag))
      ? plainText(firstKids[0].inner)
      : '';
    if (!section) {
      warnings.push(`跳过一个没有 compare-rowheader 的 backport-group（class="${gClass}"）`);
      continue;
    }

    const parsedRows = [];
    for (const row of rows) {
      const kids = directDivs(row.inner);
      if (products.length && kids.length !== products.length + LEADING_COLUMNS) {
        warnings.push(
          `分组「${section}」有一行的直接子 div 数为 ${kids.length}，` +
            `期望 ${products.length + LEADING_COLUMNS}（2 前导列 + ${products.length} 机型列），列对齐可能错位`,
        );
      }
      const label = kids[1] ? plainText(kids[1].inner) : '';
      const cells = kids.slice(LEADING_COLUMNS).map((k) => cellValue(k));
      parsedRows.push({ label, cells });
    }
    groups.push({ section, rows: parsedRows });
  }

  if (products.length && groups.length) {
    for (const g of groups) {
      for (const r of g.rows) {
        if (r.cells.length !== products.length) {
          warnings.push(
            `分组「${g.section}」行「${r.label || '(无标签)'}」解出 ${r.cells.length} 列，期望 ${products.length}`,
          );
        }
      }
    }
  } else if (!products.length) {
    warnings.push('没有解析出任何机型列（data-type="products" 单元格为 0）');
  }

  assignRowKeys(groups);
  return { found: true, products, groups, warnings: warnings.slice(0, 20) };
}

/**
 * 给每一行分配**跨机型一致**的键：`<分组名>.<行标签>`。
 *
 * 两种退化情况的约定（都是页面结构事实，不是猜测）：
 *   1. 行标签为空 → 用分组名占位：`显示屏.显示屏`，同分组内后续匿名行依次 `显示屏.显示屏(2)`…
 *      （与 `apple.mjs` 的匿名键约定一致；官网这些明细行确实没有行标签，
 *      丢掉它们等于丢掉屏幕尺寸 / 分辨率 / 亮度 / 像素数这些核心数据）
 *   2. 同一分组里出现重名标签 → 追加 `(2) (3) …` 保证键唯一
 *
 * 键必须先在整张矩阵上算好再按列取值，否则「某机型这一格为空」会让后续行的序号漂移。
 */
export function assignRowKeys(groups) {
  const stats = { anonymous: 0, deduped: 0 };
  for (const g of groups) {
    const used = new Set();
    let anon = 0;
    for (const row of g.rows) {
      let path;
      if (row.label) {
        path = `${g.section}.${row.label}`;
      } else {
        anon += 1;
        stats.anonymous += 1;
        path = anon === 1 ? `${g.section}.${g.section}` : `${g.section}.${g.section}(${anon})`;
      }
      let key = path;
      let n = 2;
      while (used.has(key)) {
        stats.deduped += 1;
        key = `${path}(${n})`;
        n += 1;
      }
      used.add(key);
      row.key = key;
    }
  }
  return stats;
}

/* ------------------------------------------------------------------ */
/* 机型名 → slug                                                       */
/* ------------------------------------------------------------------ */

const CN_NUM = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };

/**
 * 官网机型名 → slug（`apple-` 前缀由调用方加）。实测规则：
 *   `iPhone 17 Pro Max` → `iphone-17-pro-max`（空格转 `-`，`mini`/`Plus`/`Max` 同理）
 *   `iPhone SE (第三代)` → `iphone-se-3`（代际数字化成阿拉伯数字）
 *   `iPhone Air` → `iphone-air`；`iPhone Duo` → `iphone-duo`
 */
export function slugForProductName(name) {
  const clean = cleanText(name);
  const se = clean.match(/^iPhone\s+SE\s*[（(]?\s*第\s*([一二三四五六七八九十\d]+)\s*代\s*[)）]?\s*$/i);
  if (se) {
    const num = CN_NUM[se[1]] || se[1];
    return `iphone-se-${num}`;
  }
  const gen = clean.match(/^iPhone\s+SE\s*[（(]?\s*(\d+)(?:st|nd|rd|th)\s*[)）]?\s*$/i);
  if (gen) return `iphone-se-${gen[1]}`;
  const rest = clean.replace(/^iPhone\s+/i, '');
  const slug = rest
    .toLowerCase()
    .replace(/[（(]/g, ' ')
    .replace(/[）)]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `iphone-${slug}`;
}

/* ------------------------------------------------------------------ */
/* HTTP 层：单页 + 限速 + 重试 + 缓存                                    */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isDeadlineError(error) {
  return (
    !!error &&
    (error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      /aborted|timeout/i.test(String(error.message || '')))
  );
}

function createThrottle(delayMs) {
  let nextAt = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(nextAt - now, 0);
    if (wait > 0) await sleep(wait);
    nextAt = Date.now() + delayMs;
  };
}

/**
 * 取对比页 HTML。返回统一形状，**永不抛异常**：
 * `{ ok, status, finalUrl, html, bytes, fromCache, attempts, error }`
 */
function createFetcher({ delayMs, cacheDir, cacheOnly, onProgress }) {
  const throttle = createThrottle(delayMs);
  return async function fetchPage(url, { cacheFile }) {
    const cachePath = cacheDir && cacheFile ? resolve(cacheDir, cacheFile) : null;
    if (cachePath && existsSync(cachePath)) {
      try {
        const html = readFileSync(cachePath, 'utf8');
        if (html.length > 0) {
          return {
            ok: true, status: 200, finalUrl: url, html, bytes: statSync(cachePath).size,
            fromCache: true, attempts: 0, error: null,
          };
        }
      } catch {
        /* 缓存坏了就当没有 */
      }
    }
    if (cacheOnly) {
      return { ok: false, status: 0, finalUrl: url, html: '', bytes: 0, fromCache: false, attempts: 0, error: 'cache-miss' };
    }

    let lastErr = null;
    let lastStatus = 0;
    for (let attempt = 1; attempt <= RETRIES + 1; attempt += 1) {
      await throttle();
      onProgress?.({ phase: 'request', url, attempt });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
        const html = await res.text();
        const finalUrl = res.url || url;
        lastStatus = res.status;
        if (res.status >= 200 && res.status < 300) {
          // 只缓存「请求 URL == 最终 URL」的 200：老机型会被 301 到栏目页，
          // 把落地页当成对比页缓存下来是最阴险的一类脏数据。
          if (cachePath && finalUrl === url) {
            try {
              mkdirSync(dirname(cachePath), { recursive: true });
              writeFileSync(cachePath, html, 'utf8');
            } catch {
              /* 缓存写失败不影响取数 */
            }
          }
          return {
            ok: true, status: res.status, finalUrl, html, bytes: Buffer.byteLength(html, 'utf8'),
            fromCache: false, attempts: attempt, error: null,
          };
        }
        lastErr = `HTTP ${res.status}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
      } catch (error) {
        lastErr = isDeadlineError(error) ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : String(error?.message || error);
      } finally {
        clearTimeout(timer);
      }
      if (attempt <= RETRIES) await sleep(RETRY_BACKOFF_MS * attempt);
    }
    return { ok: false, status: lastStatus, finalUrl: url, html: '', bytes: 0, fromCache: false, attempts: RETRIES + 1, error: lastErr };
  };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function pushNote(notes, text) {
  if (notes.length < MAX_NOTE_ITEMS) notes.push(text);
  else if (notes.length === MAX_NOTE_ITEMS) notes.push(`…（notes 已达 ${MAX_NOTE_ITEMS} 条上限，后续同类记录省略）`);
}

/**
 * 抓取对比页矩阵并展开成「一条 RawProduct = 一个机型列」。
 *
 * @param {object} [options]
 * @param {string} [options.cacheDir]   缓存目录（命中即不发请求）
 * @param {number} [options.delayMs]    请求最小间隔，默认 1100
 * @param {string[]} [options.only]     只产出这些机型（slug 或机型名，调试用）
 * @param {boolean} [options.cacheOnly] 只用缓存，不联网
 * @param {(e: object) => void} [options.onProgress]
 * @returns {Promise<import('./types.ts').SourceResult & { matrix: object }>}
 */
export async function fetchAll(options = {}) {
  const {
    cacheDir = null,
    delayMs = DEFAULT_DELAY_MS,
    only = null,
    cacheOnly = false,
    onProgress = null,
  } = options;

  const notes = [];
  const skipped = [];
  const products = [];
  const fetchedAt = new Date().toISOString();
  const rate = Math.max(MIN_DELAY_MS, Number(delayMs) || DEFAULT_DELAY_MS);
  if (Number(delayMs) && Number(delayMs) < MIN_DELAY_MS) {
    pushNote(notes, `--delay ${delayMs}ms 低于礼貌下限，已提升为 ${MIN_DELAY_MS}ms`);
  }

  const emptyMatrix = {
    url: COMPARE_URL, products: [], columnCount: 0, groupCount: 0, rowCount: 0,
    labelledRowCount: 0, anonymousRowCount: 0, rowsPerGroup: {}, emptyCells: 0, note: '',
  };

  const fetchPage = createFetcher({ delayMs: rate, cacheDir, cacheOnly, onProgress });
  onProgress?.({ phase: 'compare', url: COMPARE_URL });
  const page = await fetchPage(COMPARE_URL, { cacheFile: CACHE_FILE });
  if (!page.ok) {
    const why = page.error === 'cache-miss' ? `无缓存且 --cache-only：${COMPARE_URL}` : page.error;
    pushNote(notes, `对比页抓取失败（${why}），矩阵为空`);
    if (page.error === 'cache-miss') skipped.push({ id: 'apple-compare-page', reason: `缺少缓存 ${CACHE_FILE}` });
    return { source: SOURCE_ID, fetchedAt, notes, skipped, products, matrix: emptyMatrix };
  }
  pushNote(
    notes,
    `矩阵来源 ${COMPARE_URL}（${page.fromCache ? '缓存命中，未发请求' : `HTTP ${page.status}`}，${page.bytes} 字节）`,
  );
  if (page.finalUrl !== COMPARE_URL) {
    pushNote(notes, `对比页发生了跳转：${COMPARE_URL} → ${page.finalUrl}，请确认取到的是对比页而不是落地页`);
  }

  const { found, products: columns, groups, warnings } = parseCompareMatrix(page.html);
  for (const w of warnings) pushNote(notes, w);
  if (!found || !columns.length) {
    pushNote(notes, `矩阵解析失败：found=${found}，机型列=${columns.length}`);
    return { source: SOURCE_ID, fetchedAt, notes, skipped, products, matrix: emptyMatrix };
  }

  /* ---- 逐行 × 逐列展开 -------------------------------------------------- */
  const columnCount = columns.length;
  const labelPlans = columns.map((name) => ({
    name,
    slug: slugForProductName(name),
    id: `apple-${slugForProductName(name)}`,
    columnIndex: columns.indexOf(name),
    raw: {},
    emptyCells: 0,
    placeholders: 0,
    seenKeys: new Set(),
  }));

  let rowCount = 0;
  let emptyCells = 0;
  let placeholderCells = 0;
  const rowsPerGroup = {};
  for (const g of groups) {
    rowsPerGroup[g.section] = g.rows.length;
    for (const row of g.rows) {
      rowCount += 1;
      for (let ci = 0; ci < columnCount; ci += 1) {
        const plan = labelPlans[ci];
        const value = (row.cells[ci] || '').trim();
        // 空单元格 / 拿不到 → 不写进 raw，也不用空串占位
        if (!value) {
          plan.emptyCells += 1;
          emptyCells += 1;
          continue;
        }
        if (PLACEHOLDER_VALUES.has(value)) {
          plan.placeholders += 1;
          placeholderCells += 1;
        } else {
          // 一格多值时按项统计（`128GB | —` 里的 `—` 也是占位）
          const ph = value.split(' | ').filter((x) => PLACEHOLDER_VALUES.has(x.trim())).length;
          if (ph) {
            plan.placeholders += ph;
            placeholderCells += ph;
          }
        }
        let key = row.key;
        let n = 2;
        while (plan.seenKeys.has(key)) {
          key = `${row.key}(${n})`;
          n += 1;
        }
        plan.seenKeys.add(key);
        plan.raw[key] = value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}…` : value;
      }
    }
  }

  /* ---- 输出 RawProduct（42 列全出，不只补那 6 台） ---------------------- */
  const wanted = only && only.length
    ? new Set(only.map((s) => cleanText(s).toLowerCase()))
    : null;
  const distinctSlugs = new Set();
  for (const plan of labelPlans) {
    if (distinctSlugs.has(plan.slug)) {
      pushNote(notes, `slug 冲突：${plan.name} 与前一列归一到同一个 slug「${plan.id}」，后者已跳过`);
    }
    distinctSlugs.add(plan.slug);

    const fieldCount = Object.keys(plan.raw).length;
    if (wanted && !wanted.has(plan.slug) && !wanted.has(cleanText(plan.name).toLowerCase()) && !wanted.has(plan.id)) {
      continue;
    }
    if (!fieldCount) {
      skipped.push({
        id: plan.id,
        reason: `对比页第 ${plan.columnIndex} 列（${plan.name}）42 行全为空，未取到任何值`,
      });
      continue;
    }
    onProgress?.({ phase: 'ok', name: plan.name, id: plan.id, fields: fieldCount, columnIndex: plan.columnIndex });
    products.push({
      id: plan.id,
      brand: 'apple',
      name: cleanText(plan.name),
      // 这一列的值来自对比页矩阵，不是该机型自己的规格页（多数机型已无规格页）
      specsUrl: COMPARE_URL,
      raw: plan.raw,
      extractedAt: fetchedAt,
      _source: {
        matrix: 'compare-page',
        url: COMPARE_URL,
        columnIndex: plan.columnIndex,
      },
    });
  }

  /* ---- 自检：位置对齐是这张矩阵的命门，值得每次跑都验证 ------------------ */
  const emptyRows = [];
  for (const g of groups) {
    for (const row of g.rows) {
      const filled = row.cells.filter((c) => (c || '').trim()).length;
      if (!filled) emptyRows.push(`${g.section} / ${row.key}`);
    }
  }
  if (emptyRows.length) {
    pushNote(
      notes,
      `有 ${emptyRows.length} 行的 42 列全为空（图标行、下拉/占位行），这些行不产出任何字段，` +
        `但仍计入 rowCount：${emptyRows.slice(0, 5).join('、')}${emptyRows.length > 5 ? ` 等 ${emptyRows.length} 行` : ''}`,
    );
  }
  if (rowCount !== groups.reduce((n, g) => n + g.rows.length, 0)) {
    pushNote(notes, `行数统计不一致：${rowCount} ≠ ${groups.reduce((n, g) => n + g.rows.length, 0)}`);
  }

  const fieldTotal = products.reduce((n, p) => n + Object.keys(p.raw).length, 0);
  pushNote(
    notes,
    `矩阵规模：机型列 ${columnCount} 列 × 规格分组 ${groups.length} 组 / ${rowCount} 行` +
      `（出现值的格子 ${rowCount * columnCount - emptyCells} 个，空格子 ${emptyCells} 个，空串不写进 raw）`,
  );
  pushNote(
    notes,
    `分组-行数：${Object.entries(rowsPerGroup).map(([s, n]) => `${s} ${n}`).join('；')}`,
  );
  pushNote(
    notes,
    `行标签：${groups.reduce((n, g) => n + g.rows.filter((r) => r.label).length, 0)} 行有页面原文标签，` +
      `${groups.reduce((n, g) => n + g.rows.filter((r) => !r.label).length, 0)} 行的标签在 SSR HTML 里就是空的` +
      `（官网对这些明细行只给分组名，键按「分组名 / 分组名(2)…」的位置约定生成）`,
  );
  pushNote(
    notes,
    '规模对账：调研阶段 FINDINGS.md 记的是「42 款 × 22 组 / 103 行」，那是探针 fetch-specs.mjs ' +
      '`extractCompare()` 的欠计，不是页面的真实规模。两个原因：(1) 它把 `backport-row` 的类名 test ' +
      '打在**整段 outer HTML** 上（`if (!/\\bbackport-row\\b/.test(c.outer))`），分组本身也被当成一行，' +
      '只有最外层那两行进了结果；(2) 它按「分组 + 行标签」去重，而行标签在 SSR 里大量是空的，' +
      '于是同分组内空标签的明细行只留下第一行。两者叠加的结果是「显示屏 2 行（实为 18）、芯片 2 行（实为 5）、' +
      '摄像头 2 行（实为 20）、视频拍摄 2 行（实为 24）、前置摄像头 2 行（实为 25）」，并整组漏掉 ' +
      '「下拉菜单 / AR 快速查看 / Apple 智能」3 组。本适配器只取每个容器的**直接子 div** 逐行下钻，' +
      '并断言每行都是「2 前导列 + 42 机型列」，量出 ' +
      `${groups.length} 组 / ${rowCount} 行 —— 差的正是上面那些被丢掉的明细行（少算 105 行、3 组）。`,
  );
  pushNote(
    notes,
    `占位值：${placeholderCells} 个值项是页面原文的「-」「—」「不适用」这类「该机型无此项」占位，` +
      `按契约「值是页面原文」**原样保留**，由规范化层裁决是否丢弃；` +
      `另有价格行是 ${'{IPHONExxx}'} / ${'{MJT74}'} 模板占位符（真实价格由 JS 注入），同样原样保留`,
  );
  pushNote(notes, `汇总：机型 ${products.length} 款（列 ${columnCount}，跳过 ${skipped.length}），raw 字段合计 ${fieldTotal} 条`);
  pushNote(
    notes,
    `覆盖范围：本矩阵一次给出全部 ${columnCount} 款机型；官方 /specs/ 规格页只剩 6 款在售` +
      `（iphone-16 / iphone-17 / iphone-17e / iphone-18-pro / iphone-air / iphone-duo），` +
      `16 Plus、16 Pro、16 Pro Max、16e、17 Pro、17 Pro Max 等只能由本矩阵补全（粒度更粗，同属官网口径）`,
  );
  pushNote(
    notes,
    '口径提醒：本适配器只交付「分组.行标签 → 原文」，不做单位换算、不判断该值属于契约的哪个字段；' +
      '电池容量(mAh)、RAM、传感器型号、跑分对比页同样没有，需另换源',
  );

  return {
    source: SOURCE_ID,
    fetchedAt,
    notes,
    skipped,
    products,
    matrix: {
      url: COMPARE_URL,
      products: columns.slice(),
      columnCount,
      groupCount: groups.length,
      rowCount,
      labelledRowCount: groups.reduce((n, g) => n + g.rows.filter((r) => r.label).length, 0),
      anonymousRowCount: groups.reduce((n, g) => n + g.rows.filter((r) => !r.label).length, 0),
      filledCellCount: rowCount * columnCount - emptyCells,
      emptyCellCount: emptyCells,
      placeholderCellCount: placeholderCells,
      rowsPerGroup,
      fromCache: page.fromCache,
      htmlBytes: page.bytes,
    },
  };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgv(argv) {
  const opts = { out: null, cacheDir: null, only: [], delayMs: DEFAULT_DELAY_MS, cacheOnly: false, json: false, help: false };
  const take = (i) => argv[i + 1];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out' || a === '-o') { opts.out = take(i); i += 1; } else if (a.startsWith('--out=')) opts.out = a.slice(6);
    else if (a === '--cache') { opts.cacheDir = take(i); i += 1; } else if (a.startsWith('--cache=')) opts.cacheDir = a.slice(8);
    else if (a === '--only') { opts.only.push(...String(take(i) || '').split(',')); i += 1; } else if (a.startsWith('--only=')) opts.only.push(...a.slice(7).split(','));
    else if (a === '--delay') { opts.delayMs = Number(take(i)); i += 1; } else if (a.startsWith('--delay=')) opts.delayMs = Number(a.slice(8));
    else if (a === '--cache-only') opts.cacheOnly = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  opts.only = opts.only.map((s) => cleanText(s)).filter(Boolean);
  return opts;
}

function usage() {
  return [
    'Apple 官网对比页矩阵取数适配器（apple-official · compare-page）',
    '',
    '用法：',
    '  node scripts/sources/apple-compare.mjs --out _work/apple-compare.raw.json --cache _work/apple-compare.cache/',
    '',
    '参数：',
    '  --out <file>     结果 JSON 落盘路径（相对路径按当前工作目录解析）',
    '  --cache <dir>    对比页 HTML 落盘；重跑命中缓存则不再发请求',
    '  --only <names>   只产出指定机型（slug 或官网机型名），逗号分隔，可重复',
    '  --delay <ms>     请求最小间隔，默认 1100（不得小于 1100）',
    '  --cache-only     只读缓存，缺缓存即记 skipped，不发任何请求',
    '  --json           把完整结果打到 stdout',
    '  --help           显示本帮助',
    '',
    '只访问 apple.com.cn；全流程串行，请求间隔 >= 1.1s。',
  ].join('\n');
}

async function main() {
  const opts = parseArgv(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const t0 = Date.now();
  const result = await fetchAll({
    cacheDir: opts.cacheDir,
    delayMs: opts.delayMs,
    only: opts.only.length ? opts.only : null,
    cacheOnly: opts.cacheOnly,
    onProgress: (e) => {
      if (e.phase === 'request') {
        process.stderr.write(`  · 请求 ${e.url}${e.attempt > 1 ? `（第 ${e.attempt} 次）` : ''}\n`);
      } else if (e.phase === 'ok') {
        process.stderr.write(`√ 第 ${e.columnIndex} 列 ${e.name} → ${e.id}  raw=${e.fields} 条\n`);
      }
    },
  });
  const elapsedMs = Date.now() - t0;

  const fieldTotal = result.products.reduce((n, p) => n + Object.keys(p.raw).length, 0);
  const summary = {
    source: result.source,
    fetchedAt: result.fetchedAt,
    elapsedMs,
    matrix: result.matrix,
    products: result.products.length,
    skipped: result.skipped.length,
    rawFields: fieldTotal,
  };

  if (opts.out) {
    const outPath = isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stderr.write(`\n已写出 ${outPath}\n`);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (result.skipped.length) {
    process.stdout.write('\n跳过：\n');
    for (const s of result.skipped) process.stdout.write(`  - ${s.id}：${s.reason}\n`);
  }
  if (opts.json) process.stdout.write(`\n${JSON.stringify(result, null, 2)}\n`);
  return result.products.length ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      process.stderr.write(`适配器异常退出：${error?.stack || error}\n`);
      process.exitCode = 2;
    });
}

export const ADAPTER_DIR = dirname(fileURLToPath(import.meta.url));
