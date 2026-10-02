#!/usr/bin/env node
/**
 * Apple 官方规格取数适配器 —— apple-official
 * =====================================================================
 * 产出契约见 `scripts/sources/types.ts`：本文件**只**把官网页面变成
 * 「章节.字段 → 页面原文」的扁平键值对，不做单位换算、不做语义映射、
 * 不判断口径。字段该叫什么名字是规范化层的事。
 *
 * 取数路线（与 `_research/probe/apple/fetch-specs.mjs` 的实测结论一致）：
 *   1. `https://www.apple.com.cn/iphone/compare/` 的 `#backport-data`
 *      给出全量机型清单与官方给出的 42 个机型名；
 *   2. 由机型名推导 slug（如 `iPhone 18 Pro` → `iphone-18-pro`），
 *      拼成 `https://www.apple.com.cn/{slug}/specs/` 逐机型抓取；
 *   3. 规格区是 `role="table"` 的 div 网格（**不是** `<table>`），
 *      35 个 `techspecs-section section-{key}` 段落，纯 SSR，无需 JS。
 *
 * ⚠️ 覆盖范围的实测真相（2026-10-02 复核，别被「42 款」误导）：
 *   对比页列 42 款，但官网只保留了 **6 个** `/specs/` 页
 *   —— `iphone-duo` / `iphone-18-pro` / `iphone-air` / `iphone-17` / `iphone-17e` /
 *   `iphone-16`（只有 `iphone-16` 是「正文里挂了 specs 链接」的那一个）。
 *   其余 36 款：`/{slug}/specs/` 要么 301 跳回 `/iphone/`（跳转后仍是 200，
 *   不校验落点就会静默产出空记录），要么直接 404。这不是解析问题，
 *   是官网真的不提供 —— `sitemap.xml` 里 `/iphone-XXX/specs/` 一共就这 6 条。
 *   其中 `iPhone 18 Pro Max` 没有自己的 URL，规格是 `/iphone-18-pro/specs/`
 *   里的**第二列**，本适配器会在全部页面抓完后按列补取（所以最终拿得到 7 款）。
 *
 * 复用的三个解析结论（踩过的坑，别再踩）：
 *   a. `techspecs-section` 的**属性顺序在机型之间会变**
 *      （`class="..." role="rowgroup"` vs `role="rowgroup" class="..."`），
 *      正则绝不能依赖属性顺序；
 *   b. section / row / cell 内部有大量嵌套 div，必须按标签配对**深度感知**切分，
 *      非贪婪 `([\s\S]*?)</div>` 会切错边界；
 *   c. 单元格的 `aria-label` 多为「脚注 N」这类无障碍文案，无脑并入会污染字段，
 *      只有确实含数值 + 单位时才合并。
 *
 * 页面形态一共三种（都已覆盖，见 `parseSpecsHtml`）：
 *   · 多列页（18 Pro + 18 Pro Max）：`techspecs-small-heading` 声明列归属，
 *     且只在每个 section 的首行出现，必须按列序号跨行记忆；
 *   · 单列页（17 / 16 / Air / 17e）：表头那行是 `visuallyhidden` 的
 *     `<div role="columnheader">iPhone 17</div>`，row 里没有任何小标题；
 *   · 单列页兜底：section 标题行的单元格正文直接写着机型名。
 * 章节名（`容量` / `显示屏`…）取自页面 rowheader 原文，不硬编码映射表。
 *
 * 用法：
 *   node scripts/sources/apple.mjs --out _work/apple.raw.json
 *   node scripts/sources/apple.mjs --out _work/apple.raw.json --cache _work/apple.cache/
 *
 * 参数：
 *   --out <file>     结果 JSON 落盘路径（不给则只打印摘要）
 *   --cache <dir>    把 compare 页与每个机型 HTML 落盘；命中缓存则不再发请求
 *   --only <slug>    只抓指定机型（可重复 / 可逗号分隔），便于调试
 *   --delay <ms>     请求最小间隔，默认 1100（不得小于 1100）
 *   --cache-only     只读缓存，缺缓存即记 skipped，不发任何请求
 *   --json           把完整结果打到 stdout
 *   --help
 *
 * 零第三方依赖，Node >= 18（内置 fetch）。
 */

import { mkdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

export const SOURCE_ID = 'apple-official';

const CN_ORIGIN = 'https://www.apple.com.cn';
/** 唯一入口：机型清单来自对比页 */
const COMPARE_URL = `${CN_ORIGIN}/iphone/compare/`;

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
const RETRY_BACKOFF_MS = 1_500; // 退避基数：1.5s、3.0s
const DEFAULT_DELAY_MS = 1_100; // 请求之间的最小间隔
const MIN_DELAY_MS = 1_100;
/** 实测正常机型 35 段；低于此值说明模板改了，值得记一笔 */
const EXPECTED_SECTIONS = 35;
/** 单个字段值超过这个长度就截断，避免 JSON 被整段营销文案撑爆 */
const MAX_VALUE_CHARS = 1_200;
const MAX_NOTE_ITEMS = 200;

const PRODUCT_NAME_RE = /iPhone\s+(?:\d+[A-Za-z]?|X[RS]?|SE|Air|Duo)(?:\s+(?:Pro|Plus|Max|mini))?/;

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&times;': '×', '&ndash;': '–',
  '&mdash;': '—', '&hellip;': '…', '&minus;': '−', '&middot;': '·',
  '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&deg;': '°',
};

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 键与值共用的清洗：去零宽字符 / 控制字符，压缩空白，去首尾空格 */
function cleanText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u200b-\u200f\u2028\u2029\u2060\ufeff]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[\s\u00a0\u3000]+/g, ' ')
    .trim();
}

/**
 * HTML → 纯文本。保留「字段名 → 值」的语义边界：
 * 块级结束标签转成 ` | `，行内标签只是被剥掉。
 */
function htmlToText(html) {
  if (!html) return '';
  let s = html
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '') // 脚注角标（含「脚注 N」文案）
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, ' | ')
    .replace(/<\/(p|li|div|tr|td|th|h[1-6]|figcaption|section|span|strong|em)>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
  s = s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const cp = parseInt(h, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = Number(d);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
  return cleanText(
    s
      .replace(/[ \t\r\n]*\|[ \t\r\n]*/g, ' | ')
      .replace(/(\s*\|\s*)+/g, ' | ')
      .replace(/^[\s|]+|[\s|]+$/g, ''),
  );
}

/**
 * 短标签专用：和 `htmlToText` 不同，**不插入** ` | ` 分隔符。
 * rowheader / 小标题这类文本在源码里是折行的（`蜂窝网络和\n无线连接`），
 * 用 `htmlToText` 会得到「蜂窝网络和 | 无线连接」这种带分隔符的章节名。
 */
function plainText(html) {
  if (!html) return '';
  let s = html
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '');
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
  s = s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const cp = parseInt(h, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = Number(d);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
  return cleanText(s);
}

/** 比较两个文本是否同一个（只忽略空白与零宽字符的差异） */
function sameText(a, b) {
  return cleanText(a) === cleanText(b);
}

/** 取 class 属性里 `section-{key}` 的 key（属性顺序不可依赖，所以先单独取 class） */function sectionKeyOf(attrs) {
  const cm = attrs.match(/\bclass\s*=\s*"([^"]*)"/i) || attrs.match(/\bclass\s*=\s*'([^']*)'/i);
  if (!cm) return '';
  if (!/\btechspecs-section\b/.test(cm[1])) return '';
  const km = cm[1].match(/\bsection-([a-z0-9][a-z0-9-]*)\b/i);
  return km ? km[1].toLowerCase() : '';
}

/** 从 pos（开标签之后）起找到配对的 </div> */
function matchDivEnd(html, pos) {
  let depth = 1;
  const re = /<div\b[^>]*>|<\/div>/gi;
  re.lastIndex = pos;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') {
      if (--depth === 0) return { start: m.index, end: m.index + m[0].length };
    } else depth++;
  }
  return null;
}

/** 深度感知地切出所有 `techspecs-section` 段落（跳过整段，避免嵌套重复） */
function sliceSections(html) {
  const out = [];
  const openRe = /<div\b([^>]*)>/gi;
  let m;
  while ((m = openRe.exec(html))) {
    const key = sectionKeyOf(m[1]);
    if (!key) continue;
    const end = matchDivEnd(html, openRe.lastIndex);
    if (!end) continue;
    out.push({ key, body: html.slice(openRe.lastIndex, end.start) });
    openRe.lastIndex = end.end;
  }
  return out;
}

/** 深度感知地切出容器内带某个 class 的直接子 div（inner = 开标签之后到配对 </div> 之前） */
function sliceChildrenByClass(html, classRe) {
  const out = [];
  const openRe = /<div\b([^>]*)>/gi;
  let m;
  while ((m = openRe.exec(html))) {
    const cm = m[1].match(/\bclass\s*=\s*"([^"]*)"/i);
    if (!cm || !classRe.test(cm[1])) continue;
    const end = matchDivEnd(html, openRe.lastIndex);
    if (!end) continue;
    out.push({ attrs: m[1], outer: html.slice(m.index, end.end), inner: html.slice(openRe.lastIndex, end.start) });
    openRe.lastIndex = end.end;
  }
  return out;
}

/**
 * aria-label 大多是「脚注 12」这类无障碍文案，只有确实含数值 + 单位
 * （尺寸图那种 `高度 150.0 毫米 (5.91 英寸)`）才并入，否则会污染字段。
 */
const ARIA_USEFUL_RE = /毫米|英寸|克|盎司|像素|ppi|Hz/i;
function usefulAria(cellHtml) {
  const raw = cellHtml.match(/\baria-label\s*=\s*"([^"]*)"/i);
  if (!raw) return '';
  const aria = htmlToText(raw[1]);
  if (!aria || /^脚注/.test(aria)) return '';
  if (!/\d/.test(aria)) return '';
  if (!ARIA_USEFUL_RE.test(aria)) return '';
  return aria;
}

/**
 * 解析一个机型的 specs HTML → 段落数组。
 *
 * 关键：单元格的**型号归属是顺序性的** —— 多机型页面（18 Pro + 18 Pro Max）里
 * 带 `techspecs-small-heading` 的单元格只出现在每个 section 的**第一个** row，
 * 它声明的是「这个型号从这一列开始」，后续 row 的同序号单元格仍属于它。
 * 所以必须按列序号跟踪，不能只看当前单元格有没有小标题。
 */
export function parseSpecsHtml(html) {
  const rawSections = sliceSections(html).map(({ key, body }) => {
    const rows = sliceChildrenByClass(body, /\btechspecs-row\b/).map((row) => {
      const headM = row.inner.match(/<div\b[^>]*class="[^"]*\btechspecs-rowheader\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const label = headM ? plainText(headM[1]) : '';
      const cells = sliceChildrenByClass(row.inner, /\btechspecs-column\b/).map((cell) => {
        const mh = cell.inner.match(/<strong\b[^>]*class="[^"]*\btechspecs-small-heading\b[^"]*"[^>]*>([\s\S]*?)<\/strong>/i);
        const heading = mh ? plainText(mh[1]) : '';
        // 小标题只在确实长得像机型名时才算「型号声明」；
        // 否则它只是单元格内的小标题（如「相机控制」「两种机型均具备」），要留在值里
        const declaresModel = !!heading && PRODUCT_NAME_RE.test(heading);
        const valueHtml = declaresModel
          ? cell.inner.slice(cell.inner.indexOf('</strong>') + '</strong>'.length)
          : cell.inner;
        const value = [htmlToText(valueHtml), usefulAria(cell.inner)].filter(Boolean).join(' ');
        return {
          declaredModel: declaresModel ? heading : '',
          heading,
          value,
          /** 型号归属行：单元格里只有机型名，没有别的值可提取 */
          isAttributionRow: declaresModel && sameText(value, heading),
        };
      });
      return { label, cells };
    });
    return { key, rows };
  });

  // ── 型号 → 列 的归属表 ──────────────────────────────────────────────
  // 三种页面形态都要覆盖（实测三种都真实存在）：
  //   1. 多机型页（18 Pro + 18 Pro Max）：`<span class="header-iphone-*">` 钉死列名，
  //      而 section 内带 `techspecs-small-heading` 的单元格只出现在每个 section 的
  //      **第一个 row**，声明的是「这个型号从这一列开始」，后续 row 的同序号单元格
  //      仍属于它 —— 归属必须按列序号跟踪，不能只看当前单元格有没有小标题；
  //   2. 单机型页（17 / 16）：没有 header-row，只有一个 `<div role="columnheader">`
  //      裸写机型名，row 里也没有小标题；
  //   3. 单机型页的兜底：section 标题行（无 rowheader）的单元格里直接写着机型名。
  const modelOrder = [];
  const maxCols = rawSections.reduce(
    (n, s) => Math.max(n, ...s.rows.map((r) => r.cells.length), 0),
    0,
  );
  const columnModel = new Array(maxCols).fill('');
  const registerModel = (name, ci = null) => {
    if (!name || !modelOrder.includes(name)) modelOrder.push(name);
    if (ci != null && ci < maxCols && !columnModel[ci]) columnModel[ci] = name;
  };

  // 形态 1：header-row 里的 `<span class="header-iphone-*">`
  const headerM = html.match(/<div\b[^>]*class="[^"]*\btechspecs-header-row\b[^"]*"[^>]*>/i);
  let headerModels = [];
  if (headerM) {
    const bodyStart = headerM.index + headerM[0].length;
    const end = matchDivEnd(html, bodyStart);
    const headerBody = end ? html.slice(bodyStart, end.start) : '';
    headerModels = [...headerBody.matchAll(/<span\b[^>]*\bclass="[^"]*\bheader-iphone[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
      .map((m) => cleanText(htmlToText(m[1])))
      .filter((s) => PRODUCT_NAME_RE.test(s));
    headerModels.forEach((name) => registerModel(name, headerModels.indexOf(name)));
  }

  // 形态 2：表格顶部那行（可能是 visuallyhidden）的裸 `<div role="columnheader">`
  if (!headerModels.length) {
    const nm = html.match(/<h1\b[^>]*\bid="page-headline"[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    const pageModel = nm ? cleanText(htmlToText(nm[1]).replace(/\s*技术规格\s*$/, '')) : '';
    if (pageModel && PRODUCT_NAME_RE.test(pageModel)) {
      registerModel(pageModel, 0);
    } else {
      const ch = [...html.matchAll(/<div\b[^>]*\brole="columnheader"[^>]*>([\s\S]*?)<\/div>/gi)]
        .map((m) => cleanText(htmlToText(m[1])))
        .filter((s) => PRODUCT_NAME_RE.test(s));
      ch.forEach((name, ci) => registerModel(name, ci));
    }
  }

  // 形态 1 的列声明 & 形态 3 的 section 标题单元格
  for (const sec of rawSections) {
    for (const row of sec.rows) {
      row.cells.forEach((cell, ci) => {
        if (cell.declaredModel && !columnModel[ci]) columnModel[ci] = cell.declaredModel;
        if (cell.declaredModel) registerModel(cell.declaredModel);
      });
    }
  }

  const sections = rawSections.map((sec) => {
    // section 级归属表：默认继承全局，但本 section 内出现的型号声明优先
    const sectionColumn = columnModel.slice();
    const declaredRowModels = sec.rows.map(
      (row) => row.cells.map((c) => c.declaredModel).filter(Boolean),
    );
    /** section 标题：无 rowheader 且只声明了一个型号的那一行 */
    let caption = '';
    const captionRowIndex = declaredRowModels.findIndex(
      (d, i) => !sec.rows[i].label && d.length === 1,
    );
    const multiColumn = sectionColumn.filter(Boolean).length > 1;
    if (captionRowIndex >= 0) {
      caption = declaredRowModels[captionRowIndex][0];
      sec.rows[captionRowIndex].cells.forEach((c, ci) => {
        if (c.declaredModel) sectionColumn[ci] = c.declaredModel;
      });
      // 单列页里这个标题行就是唯一的型号来源（形态 3）
      if (!multiColumn && !sectionColumn[0]) sectionColumn[0] = caption;
    }
    if (!multiColumn && !sectionColumn[0] && modelOrder.length === 1) {
      sectionColumn[0] = modelOrder[0];
    }
    const rows = [];
    const sectionTitle =
      cleanText(sec.rows.find((r) => r.label)?.label || '') || sec.key;
    /**
     * 无 rowheader 行的字段名：单元格自己的小标题优先（如 display 的
     * 「两种机型均具备」、external 的「操作按钮功能」），连小标题都没有时
     * 才退到章节名，再重复则用 `章节.(2)`、`章节.(3)` 连续编号。
     * 这样每个键都严格是「章节.字段」（恰好一个点），规范化层不需要特判。
     */
    let anonCount = 0;
    const nextAnonKey = () => {
      anonCount += 1;
      return anonCount === 1 ? sectionTitle : `${sectionTitle}.(${anonCount})`;
    };
    for (const row of sec.rows) {
      for (let ci = 0; ci < sectionColumn.length; ci += 1) {
        const model = sectionColumn[ci];
        if (!model) continue;
        const cell = row.cells[ci];
        const value = cell && cell.value ? cell.value : '';
        if (!value) continue;
        // 型号归属行：单元格内容就是机型名本身，没有别的值可提取
        if (cell.isAttributionRow) continue;
        let bucket = rows.find((r) => r.model === model);
        if (!bucket) {
          bucket = { model, fields: [], seenKeys: new Set() };
          rows.push(bucket);
        }
        const heading = cell?.heading || '';
        const path = row.label || heading || nextAnonKey(model);
        let key = path;
        let n = 2;
        while (bucket.seenKeys.has(key)) key = `${path}(${n++})`;
        bucket.seenKeys.add(key);
        bucket.fields.push({
          key,
          value: value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}…` : value,
        });
      }
    }
    return {
      key: sec.key,
      /** 章节名取自页面 rowheader 原文；没有就回落到 section key */
      label: sectionTitle,
      caption,
      rows: rows.filter((b) => b.fields.length),
    };
  });

  return { sections, modelOrder, headerModels };
}

/**
 * 把 35 个段落拍平成 `Record<'章节.字段', 值原文>`。
 * 键形状：`容量.容量` / `显示屏.尺寸与重量` / `电源和电池.电源和电池`。
 */
export function flattenSections(sections, modelName = '') {
  const raw = {};
  const sectionFieldCounts = {};
  for (const sec of sections) {
    const sectionTitle = sec.label || sec.key;
    const buckets = sec.rows;
    const matched = buckets.length > 1 && modelName ? buckets.filter((b) => b.model === modelName) : [];
    const use = matched.length ? matched : buckets;
    let count = 0;
    for (const bucket of use) {
      for (const field of bucket.fields) {
        const leaf = cleanText(field.key) || sectionTitle;
        // 同一机型内键不可互相覆盖：Apple 的 section 标题行常与 section 同名
        // （`容量` / `显示屏` / `电源和电池`）。键必须严格是「章节.字段」，
        // 所以重复时给叶子加编号，而不是把章节名再嵌一层。
        let path = `${sectionTitle}.${leaf}`;
        if (Object.prototype.hasOwnProperty.call(raw, path)) {
          let n = 2;
          while (Object.prototype.hasOwnProperty.call(raw, `${sectionTitle}.${leaf}(${n})`)) n += 1;
          path = `${sectionTitle}.${leaf}(${n})`;
        }
        raw[path] = field.value;
        count += 1;
      }
    }
    sectionFieldCounts[sectionTitle] = (sectionFieldCounts[sectionTitle] || 0) + count;
  }
  return { raw, sectionFieldCounts };
}

/** `/iphone/compare/` 的 `#backport-data`：按文档顺序取机型名 */
export function parseCompareProducts(html) {
  const start = html.search(/<div\b[^>]*id="backport-data"/i);
  if (start < 0) return [];
  const openEnd = html.indexOf('>', start) + 1;
  const end = matchDivEnd(html, openEnd);
  const body = end ? html.slice(openEnd, end.start) : html.slice(openEnd);
  const names = [
    ...body.matchAll(/data-type="products"[^>]*>\s*<div\b[^>]*data-store-value=""[^>]*>([\s\S]*?)<\/div>/g),
  ]
    .map((m) => cleanText(htmlToText(m[1])))
    .filter(Boolean);
  return [...new Set(names)];
}

/**
 * 对比页正文链接里出现过哪些机型 slug。
 *
 * 注意：老机型的链接直接指向规格页（`/iphone-16/specs/`），在售机型指向产品页
 * （`/iphone-17/`），两种都要认；`/iphone/`、`/iphone/compare/` 这类栏目页
 * 不是机型，必须排除 —— `iphone/` 后面跟的是 `specs` 等字母，靠结尾斜杠区分。
 */
export function parseCompareSlugLinks(html) {
  const out = new Set();
  for (const m of html.matchAll(/href="\/(iphone-[a-z0-9-]+)\//gi)) out.add(m[1].toLowerCase());
  return out;
}

/**
 * 自检：每个 raw 值片段是否都能在源 HTML 里逐字找到。
 *
 * 目的是挡住「解析器悄悄拼出页面上根本没有的值」这类事故。
 * 做法：把 HTML 按两种视图归一化后取并集 ——
 *   a. 去掉标签的可见文本（覆盖正常的正文值）；
 *   b. 解码后的 `aria-label` 等属性文本（尺寸图那种值只在属性里）。
 * 归一化时统一去掉空白与 ` | ` 分隔符，所以跨标签拼接的值也能命中。
 *
 * 注意：这是**保真度**检查，不是来源检查。跨机型的值只可能来自这一份 HTML，
 * 所以命中率就是「值确实出自这一页」的证据。
 */
export function verifyRawAgainstHtml(html, raw) {
  const decodeEnt = (s) =>
    String(s)
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
  const squash = (s) => decodeEnt(s).replace(/[\s\u00a0\u3000|·*]+/g, '');

  const visible = squash(html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '').replace(/<[^>]+>/g, ''));
  const attrs = squash(
    [...html.matchAll(/\b(?:aria-label|content|alt)="([^"]*)"/gi)].map((m) => m[1]).join(' \u0001 '),
  );
  const hay = `${visible}\u0001${attrs}`;

  let fragments = 0;
  let unverified = 0;
  const samples = [];
  for (const [key, value] of Object.entries(raw)) {
    for (const frag of String(value).split(' | ')) {
      const n = squash(frag);
      if (n.length < 6) continue; // 太短的片段（如 `1TB`）本来就容易误命中，不计入
      fragments += 1;
      if (!hay.includes(n)) {
        unverified += 1;
        if (samples.length < 3) samples.push(`${key} → ${frag.slice(0, 60)}`);
      }
    }
  }
  return {
    fragments,
    verified: fragments - unverified,
    unverified,
    hitRate: fragments ? (fragments - unverified) / fragments : 1,
    samples,
  };
}

/* ------------------------------------------------------------------ */
/* 机型名 → slug 候选                                                   */
/* ------------------------------------------------------------------ */

const SLUG_OVERRIDES = new Map([['iphone duo', ['iphone-duo']]]);

/** 由官网机型名推导候选 slug（首选在最前，其余为兜底探测） */
export function slugCandidatesFor(name) {
  const clean = cleanText(name);
  const k = clean.toLowerCase();
  if (SLUG_OVERRIDES.has(k)) return SLUG_OVERRIDES.get(k).slice();

  const out = [];
  const push = (s) => {
    if (s && !out.includes(s)) out.push(s);
  };

  const m = clean.match(/^iPhone\s+(\d+[A-Za-z]?)\s*(.*)$/i);
  if (m) {
    // 实测 `iphone-18-pro` / `iphone-16-plus` / `iphone-13-mini` 就是这个形状，
    // `iphone-18-promax` 这类连写变体一律 404，不再浪费请求去试。
    const num = m[1].toLowerCase();
    const rest = m[2].trim().toLowerCase();
    push(rest ? `iphone-${num}-${rest.replace(/\s+/g, '-')}` : `iphone-${num}`);
    return out;
  }
  if (/\bSE\b/i.test(clean)) {
    const gen = /第三代|3rd/i.test(clean) ? '3' : /第二代|2nd/i.test(clean) ? '2' : '';
    if (gen) push(`iphone-se-${gen}`);
    push('iphone-se');
    return out;
  }
  const word = clean.replace(/^iPhone\s+/i, '').trim().toLowerCase();
  if (word) push(`iphone-${word.replace(/\s+/g, '-')}`);
  return out;
}

/** 候选 slug 与官网机型名的贴合度，用于在多候选中挑「非跳转」的那个时打破平局 */
function slugNameScore(slug, name) {
  const s = slug.replace(/^iphone-/, '');
  const n = cleanText(name).replace(/^iPhone\s+/i, '').toLowerCase();
  if (s === n.replace(/\s+/g, '-')) return 100;
  const sTight = s.replace(/-/g, '');
  const nTight = n.replace(/[\s-]+/g, '');
  if (sTight === nTight) return 80;
  if (nTight.startsWith(sTight)) return 60;
  return 20;
}

/* ------------------------------------------------------------------ */
/* HTTP 层：串行 + 限速 + 重试 + 缓存                                    */
/* ------------------------------------------------------------------ */

function isDeadlineError(error) {
  return (
    !!error &&
    (error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      /aborted|timeout/i.test(String(error.message || '')))
  );
}

/** 等待下一次请求的节流器：让「相邻两次请求的最小间隔」>= delayMs */
function createThrottle(delayMs) {
  let nextAt = 0;
  let lastReqAt = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(nextAt - now, 0);
    if (wait > 0) await sleep(wait);
    lastReqAt = Date.now();
    nextAt = lastReqAt + delayMs;
  };
}

function createFetcher({ delayMs, cacheDir, cacheOnly, onRequest }) {
  const throttle = createThrottle(delayMs);
  const requests = { compare: 0, specs: 0, errors: 0 };
  let lastReqAt = 0;

  const fetchOnce = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
      return { res, ms: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * 取一个页面。返回统一形状，**永不抛异常**：
   *   { ok, status, finalUrl, redirected, html, bytes, fromCache, attempts, ms, error }
   */
  return async function fetchPage(url, { cacheFile, kind = 'specs' } = {}) {
    const cachePath = cacheFile && cacheDir ? resolve(cacheDir, cacheFile) : null;
    if (cachePath && existsSync(cachePath)) {
      try {
        const html = readFileSync(cachePath, 'utf8');
        if (html && html.length > 0) {
          return {
            ok: true, status: 200, finalUrl: url, redirected: false, cacheable: false, html,
            bytes: statSync(cachePath).size, fromCache: true, attempts: 0, ms: 0, error: null,
          };
        }
      } catch {
        /* 缓存坏了就当没有，走网络 */
      }
    }
    if (cacheOnly) {
      return {
        ok: false, status: 0, finalUrl: url, redirected: false, cacheable: false, html: '',
        bytes: 0, fromCache: false, attempts: 0, ms: 0, error: 'cache-miss',
      };
    }

    let lastErr = null;
    let lastStatus = 0;
    let lastRedirected = false;
    for (let attempt = 1; attempt <= RETRIES + 1; attempt += 1) {
      await throttle();
      requests[kind] += 1;
      onRequest?.({ url, kind, attempt });
      lastReqAt = Date.now();
      try {
        const { res, ms } = await fetchOnce(url);
        const html = await res.text();
        const finalUrl = res.url || url;
        lastStatus = res.status;
        lastRedirected = finalUrl !== url;
        if (res.status >= 200 && res.status < 300) {
          // 只缓存「请求的 URL == 最终 URL」的 200 响应。
          // 老机型会被 301 到 /iphone/，跳转后同样是 200 —— 把落地页当成
          // 该机型的规格页缓存下来，是最阴险的一类脏数据。
          const cacheable = !lastRedirected;
          if (cachePath && cacheable) {
            try {
              mkdirSync(dirname(cachePath), { recursive: true });
              writeFileSync(cachePath, html, 'utf8');
            } catch {
              /* 缓存写失败不影响取数 */
            }
          }
          return {
            ok: true, status: res.status, finalUrl, redirected: lastRedirected, cacheable,
            html, bytes: Buffer.byteLength(html, 'utf8'), fromCache: false, attempts: attempt, ms, error: null,
          };
        }
        lastErr = `HTTP ${res.status}`;
        // 4xx（尤其 404）是确定性结论，重试无意义；5xx / 429 才退避重试
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          return {
            ok: false, status: res.status, finalUrl, redirected: lastRedirected,
            cacheable: !lastRedirected, html: '', bytes: 0, fromCache: false, attempts: attempt, ms,
            error: lastErr,
          };
        }
      } catch (error) {
        requests.errors += 1;
        lastErr = isDeadlineError(error) ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : String(error?.message || error);
      }
      if (attempt <= RETRIES) await sleep(RETRY_BACKOFF_MS * attempt);
    }

    return {
      ok: false, status: lastStatus, finalUrl: url, redirected: lastRedirected, html: '',
      bytes: 0, fromCache: false, attempts: RETRIES + 1, ms: Date.now() - lastReqAt, error: lastErr,
    };
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
 * 抓取全部 Apple 机型。
 * @param {object} [options]
 * @param {string} [options.cacheDir]  缓存目录（命中即不发请求）
 * @param {number} [options.delayMs]   请求最小间隔，默认 1100
 * @param {string[]} [options.only]    只抓这些 slug（调试用）
 * @param {boolean} [options.cacheOnly] 只用缓存，不联网
 * @param {(e: object) => void} [options.onProgress]
 * @param {(url: string, cacheFile: string) => boolean} [options.cacheHas]
 * @returns {Promise<import('./types.ts').SourceResult>}
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
  const rate = Math.max(MIN_DELAY_MS, Number(delayMs) || DEFAULT_DELAY_MS);
  if (Number(delayMs) && Number(delayMs) < MIN_DELAY_MS) {
    pushNote(notes, `--delay ${delayMs}ms 低于礼貌下限，已提升为 ${MIN_DELAY_MS}ms`);
  }

  const fetchPage = createFetcher({
    delayMs: rate,
    cacheDir,
    cacheOnly,
    onRequest: ({ url, kind, attempt }) => onProgress?.({ phase: 'request', url, kind, attempt }),
  });

  /* 1) 机型清单：对比页矩阵（对比页粒度粗，只用来枚举） */
  onProgress?.({ phase: 'compare', url: COMPARE_URL });
  const comparePage = await fetchPage(COMPARE_URL, { cacheFile: '_compare.html', kind: 'compare' });
  if (!comparePage.ok) {
    pushNote(notes, `对比页抓取失败（${comparePage.error || `HTTP ${comparePage.status}`}），无法枚举机型清单`);
    return {
      source: SOURCE_ID,
      fetchedAt: new Date().toISOString(),
      notes,
      skipped,
      products,
    };
  }
  pushNote(
    notes,
    `机型清单来自 ${COMPARE_URL}（${comparePage.fromCache ? '缓存' : `HTTP ${comparePage.status}`}，${comparePage.bytes} 字节）`,
  );

  let roster = parseCompareProducts(comparePage.html);
  if (!roster.length) {
    pushNote(notes, '对比页 #backport-data 未解析出任何机型，机型清单为空');
    return { source: SOURCE_ID, fetchedAt: new Date().toISOString(), notes, skipped, products };
  }
  const rosterRaw = roster.length;
  if (only && only.length) {
    const wanted = new Set(only.map((s) => cleanText(s).toLowerCase()));
    roster = roster.filter((name) => {
      const cands = slugCandidatesFor(name);
      return cands.some((c) => wanted.has(c)) || wanted.has(cleanText(name).toLowerCase());
    });
    pushNote(notes, `--only 过滤：${rosterRaw} 款机型中选中 ${roster.length} 款`);
  }
  pushNote(notes, `对比页枚举到 ${roster.length} 款机型：${roster.join('、')}`);

  /**
   * 对比页正文里挂着链接的机型 slug = 官网当前确实单独建了产品页的机型。
   * 不在这张表里的机型，`/{slug}/specs/` 必然是 301 或 404（实测），
   * 直接判死可以省掉 30 多次注定失败的请求 —— 对官网更礼貌，也更快。
   */
  const liveSlugs = parseCompareSlugLinks(comparePage.html);
  pushNote(
    notes,
    `对比页正文挂链接的机型页 ${liveSlugs.size} 个（${[...liveSlugs].join('、')}）；未挂链接的机型不再探测，直接记为官网无规格页`,
  );

  /* 2) 逐机型抓 specs 页 */
  // 说明：specs 页面**不带**上市日期（实测只有营销脚注里出现「推出/发布」字样），
  // 所以不产出 releaseHint —— 契约要求「有就带，没有就省略，不要猜」。

  /** 已经成功解析过的 specs 页：`型号名 → { slug, url, parsed, html }` */
  const pageIndex = new Map();
  const record = (id, name, specsUrl, raw) => {
    products.push({ id, brand: 'apple', name, specsUrl, raw, extractedAt: new Date().toISOString() });
  };
  const rememberPage = (slug, url, parsed, html) => {
    for (const model of parsed.modelOrder) {
      if (!pageIndex.has(model)) pageIndex.set(model, { slug, url, parsed, html });
    }
  };

  /** 抓一个候选 slug 并解析；返回 { ok } / { skip, reason, fatal? } */
  const probeSlug = async (slug) => {
    const url = `${CN_ORIGIN}/${slug}/specs/`;
    // 候选 slug 的结论单独落盘：重跑时已经确认「这个 slug 没有规格页」的候选
    // 不再发请求（老机型会被 301 到 /iphone/，另一些 slug 直接 404，
    // 每次重跑都去撞一遍纯属浪费，也打扰官网）。
    const probePath = cacheDir ? resolve(cacheDir, `${slug}.probe.json`) : null;
    const memoize = (payload) => {
      if (!probePath) return;
      try {
        writeFileSync(probePath, `${JSON.stringify({ slug, checkedAt: new Date().toISOString(), ...payload }, null, 2)}\n`, 'utf8');
      } catch { /* 缓存写失败不影响取数 */ }
    };
    if (probePath && existsSync(probePath)) {
      let memo = null;
      try {
        memo = JSON.parse(readFileSync(probePath, 'utf8'));
      } catch {
        memo = null;
      }
      if (memo && memo.reason) return { skip: true, reason: memo.reason };
    }

    const page = await fetchPage(url, { cacheFile: `${slug}.html`, kind: 'specs' });
    if (!page.ok) {
      if (page.error === 'cache-miss') return { skip: true, reason: `无缓存且 --cache-only：${url}`, fatal: true };
      // 404 = 这个 slug 根本不存在；301 到别处 = 机型已下线。
      // 两者都是确定性的，值得落盘；超时/5xx 是暂时性的，不落盘，下次重试。
      if (page.error === 'HTTP 404') {
        const reason = `该 slug 不存在：${url}（HTTP 404）`;
        memoize({ status: 'not-found', httpStatus: 404, reason });
        return { skip: true, reason };
      }
      return { skip: true, reason: `请求失败（${page.error || `HTTP ${page.status}`}）：${url}` };
    }
    // 已下线机型会被 301 到 /iphone/，且跳转后仍是 HTTP 200 —— 必须校验落点
    if (page.redirected && !new RegExp(`/${slug}/specs/?$`).test(new URL(page.finalUrl).pathname)) {
      const landing = new URL(page.finalUrl).pathname;
      const reason = `机型页已下线：${url} → 301 ${landing}（官网不再提供该机型规格页）`;
      memoize({ status: 'gone', httpStatus: page.status, landing, reason });
      return { skip: true, reason };
    }

    const parsed = parseSpecsHtml(page.html);
    if (!parsed.sections.length) {
      const reason = `页面结构不含 techspecs 段落（0 段）：${url}`;
      if (!page.fromCache) memoize({ status: 'no-sections', httpStatus: page.status, reason });
      return { skip: true, reason };
    }
    if (parsed.sections.length !== EXPECTED_SECTIONS) {
      pushNote(notes, `${slug}: 段落数 ${parsed.sections.length} ≠ 预期的 ${EXPECTED_SECTIONS}，模板可能已改版`);
    }
    if (parsed.modelOrder.length > 1) {
      pushNote(notes, `${slug}: 该页同时包含 ${parsed.modelOrder.join(' / ')}，按列分别取值`);
    }
    rememberPage(slug, url, parsed, page.html);
    return { ok: true, slug, url, parsed, html: page.html, fromCache: page.fromCache };
  };

  /** 从一份已解析的页面里取指名型号的 raw */
  const extractModel = (name, entry) => {
    const modelName =
      entry.parsed.modelOrder.find((x) => sameText(x, name)) || entry.parsed.modelOrder[0] || cleanText(name);
    const { raw, sectionFieldCounts } = flattenSections(entry.parsed.sections, modelName);
    return {
      raw,
      fieldCount: Object.keys(raw).length,
      sectionCount: entry.parsed.sections.length,
      sectionFieldCounts,
      modelName,
      matched: sameText(modelName, name),
    };
  };

  for (const name of roster) {
    const candidates = slugCandidatesFor(name);
    const primary = candidates[0];
    let got = null;
    let skipReason = '';
    const attempts = [];

    for (const slug of candidates) {
      attempts.push(slug);
      // 对比页没挂链接、缓存里也没有页面 → 官网确定没有这个机型的规格页
      const cachedHtml = cacheDir ? resolve(cacheDir, `${slug}.html`) : null;
      if (!liveSlugs.has(slug) && !(cachedHtml && existsSync(cachedHtml))) {
        skipReason = `官网无独立规格页：${CN_ORIGIN}/${slug}/specs/（该机型未出现在对比页的在售机型链接中，实测为 301 跳转或 404）`;
        continue;
      }
      const r = await probeSlug(slug);
      if (r.ok) {
        const ex = extractModel(name, r);
        if (!ex.fieldCount) {
          skipReason = `解析出 ${ex.sectionCount} 段但字段数为 0：${r.url}`;
          break;
        }
        got = { ...ex, slug, url: r.url, fromCache: r.fromCache, via: 'direct' };
        break;
      }
      skipReason = r.reason;
      if (r.fatal) break;
    }

    if (got) {
      const finalId = `apple-${got.slug}`;
      record(finalId, cleanText(name), got.url, got.raw);
      onProgress?.({
        phase: 'ok', name, id: finalId, sections: got.sectionCount, fields: got.fieldCount,
        fromCache: got.fromCache, via: got.via,
      });
    } else {
      const reason = skipReason || `未取到规格页：${CN_ORIGIN}/${primary}/specs/`;
      skipped.push({ id: `apple-${primary}`, reason });
    }
  }

  /* 2b) 补齐「多机型共用一页」的机型 ────────────────────────────────────
   * Apple 只给部分机型单独做 specs 页，另一些机型的信息作为**额外一列**
   * 塞在同系列页面上（实测 `/iphone-18-pro/specs/` 同时给出 18 Pro 与
   * 18 Pro Max 两列）。因为对比页把 18 Pro Max 列在 18 Pro 前面，这类机型
   * 在第一轮里会先失败，所以等所有页面都抓完再做一轮「同页列」兜底。
   */
  const crossNotes = [];
  for (const name of roster) {
    const primary = slugCandidatesFor(name)[0];
    const id = `apple-${primary}`;
    const idx = skipped.findIndex((s) => s.id === id);
    if (idx < 0) continue; // 第一轮已成功
    const hit = pageIndex.get(cleanText(name));
    if (!hit) continue;
    const ex = extractModel(name, hit);
    if (!ex.matched || !ex.fieldCount) continue;
    crossNotes.push(
      `${name} 官网没有独立规格页，已从同页机型 ${hit.url} 的「${ex.modelName}」列取值`,
    );
    skipped.splice(idx, 1);
    record(id, cleanText(name), hit.url, ex.raw);
    onProgress?.({
      phase: 'ok', name, id, sections: ex.sectionCount, fields: ex.fieldCount,
      fromCache: true, via: 'crosstab',
    });
  }
  for (const n of crossNotes) pushNote(notes, n);

  /* 3) 汇总 */
  if (roster.length && products.length + skipped.length !== roster.length) {
    pushNote(notes, `覆盖范围对不上：机型 ${roster.length}，成功 ${products.length}，跳过 ${skipped.length}`);
  }

  /* 3a) 保真度自检：每个 raw 值都必须在源 HTML 里逐字找得到 */
  let fragTotal = 0;
  let fragUnverified = 0;
  const badSamples = [];
  for (const p of products) {
    const hit = [...pageIndex.values()].find((e) => e.url === p.specsUrl);
    if (!hit) continue;
    const v = verifyRawAgainstHtml(hit.html, p.raw);
    fragTotal += v.fragments;
    fragUnverified += v.unverified;
    if (v.hitRate < 0.98) {
      badSamples.push(`${p.id} 命中率 ${(v.hitRate * 100).toFixed(1)}%（${v.samples.join('；')}）`);
    }
  }
  for (const s of badSamples) pushNote(notes, `保真度自检告警：${s}`);
  if (fragTotal) {
    pushNote(
      notes,
      `保真度自检：${fragTotal} 个值片段中 ${fragTotal - fragUnverified} 个可在源 HTML 逐字命中（${(((fragTotal - fragUnverified) / fragTotal) * 100).toFixed(2)}%）`,
    );
  }

  pushNote(
    notes,
    `汇总：机型 ${roster.length}，成功 ${products.length}，跳过 ${skipped.length}（跳过原因见 skipped 字段）`,
  );
  const fieldTotal = products.reduce((n, p) => n + Object.keys(p.raw).length, 0);
  pushNote(notes, `raw 字段合计 ${fieldTotal} 条（成功机型均值 ${products.length ? Math.round(fieldTotal / products.length) : 0} 条/款）`);

  return {
    source: SOURCE_ID,
    fetchedAt: new Date().toISOString(),
    notes,
    skipped,
    products,
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
    'Apple 官方规格取数适配器（apple-official）',
    '',
    '用法：',
    '  node scripts/sources/apple.mjs --out _work/apple.raw.json [--cache _work/apple.cache/]',
    '',
    '参数：',
    '  --out <file>     结果 JSON 落盘路径（相对路径按当前工作目录解析）',
    '  --cache <dir>    每个机型 HTML 落盘；重跑命中缓存则不再发请求',
    '  --only <slugs>   只抓指定机型 slug，逗号分隔，可重复',
    '  --delay <ms>     请求最小间隔，默认 1100（不得小于 1100）',
    '  --cache-only     只读缓存，缺缓存即记 skipped，不发任何请求',
    '  --json           把完整结果打到 stdout',
    '  --help           显示本帮助',
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
        const via = e.via === 'crosstab' ? ' [同页机型列]' : '';
        process.stderr.write(
          `√ ${e.name} → ${e.id}  sections=${e.sections} fields=${e.fields}${e.fromCache ? ' [cache]' : ''}${via}\n`,
        );
      } else if (e.phase === 'skipped') {
        process.stderr.write(`- 跳过 ${e.name || e.id}\n`);
      }
    },
  });
  const elapsedMs = Date.now() - t0;

  const fieldTotal = result.products.reduce((n, p) => n + Object.keys(p.raw).length, 0);
  const summary = {
    source: result.source,
    fetchedAt: result.fetchedAt,
    elapsedMs,
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

export { HERE as ADAPTER_DIR };
