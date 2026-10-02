/**
 * 苹果中国官网「官方起售价」取数适配器（apple-official）
 * ============================================================================
 *
 * 目标：给「手机参数对比站」的华为 vs 苹果对比页补上苹果侧官方价格。
 *
 * 关键结论（实测，2026-10-02）
 * ---------------------------------------------------------------------------
 * 1) 规格页 `/{slug}/specs/` 与对比页 `/iphone/compare/` **都不含价格**。
 *    对比页的「价格」行是服务端渲染的模板占位符，例如：
 *        {IPHONE18PROMAX}$price.display.smart 起
 *    其中
 *        - `{IPHONE18PROMAX}` = 价格服务的 **商品标识符（identifier）**，
 *        - `price.display.smart` = 价格响应 JSON 里的 **字段路径**。
 *
 * 2) 价格服务的地址不在 JS 里硬编码，而是写在**页面 <head> 的 link 标签**里：
 *        <link rel="ac:pricing-endpoint" href="/shop/mcm/product-price">
 *        <link rel="ac:edupricing-endpoint" href="/cn-k12/shop/mcm/product-price">
 *        <link rel="ac:tradein-endpoint" href="/shop/mcm/tradein-credit">
 *    `/ac/pricing/latest-1/scripts/autopricing.built.js` 在运行时用
 *    `document.querySelector('link[rel="ac:pricing-endpoint"]')` 把这个 href 读出来，
 *    商品标识符放进查询串的 `parts` 参数（Product 类里 `identifierParam = "parts"`，
 *    多个标识符用 `,` 连接，逐个 `encodeURIComponent`），GET 取值。
 *
 *    实测取数通道（本适配器的 A 通道 / cross-check）：
 *        GET https://www.apple.com.cn/shop/mcm/product-price?parts=<ID1>,<ID2>,...
 *        → 200 application/json，无需任何特殊请求头（普通浏览器 UA 即可）
 *        → {"items":{"<ID>":{"type":"WUIP","name":"iPhone 18 Pro",
 *              "price":{"value":10999,"display":{"smart":"RMB 10,999", ...}}}}}
 *        注意：重复写多个 `parts=` 只会取第一个（实测），必须用逗号批量。
 *
 * 3) **但 A 通道的商品标识符只有机型级**（`IPHONE18PRO_MAIN` 给的是 18 Pro 的起价），
 *    拿不到各存储档价格。对比页里那些 `{MJT74} 起` 形式的 4 位 part number
 *    确实能到 SKU 级，但它们在页面里只是占位符、**没有和容量列做可靠对齐**，
 *    用它推「哪个价格对应哪档容量」是猜测，不做。
 *
 *    可靠的 SKU 级数据在**购买页** `/shop/buy-iphone/{slug}` 的 HTML 里内联：
 *      - analytics 数组：{"sku","partNumber","price":{"fullPrice"},"name":"iPhone 18 Pro Max 1TB Burgundy"}
 *      - 富产品数组：  {"partNumber","basePartNumber","part":"IPHONE18PRO_MAIN",
 *                       "dimensionCapacity":"1tb","dimensionScreensize":"6_9inch", ...}
 *      - 展示价格：    displayValues.prices["mjyh4ch_a"].{amountBeforeTradeIn, comparativeDisplayPrice}
 *    这是本适配器的 **主通道（B 通道）**：机型名 + 容量 + 价格都在同一页，
 *    容量与价格的对应关系来自服务端渲染的同一份 JSON，不需要猜。
 *
 * 4) 对比页「容量」行与购买页的档位可以逐条对齐，互为交叉验证（见 notes 的 ladderAgreement）。
 *
 * 5) 已停售机型（16 Plus / 16 Pro / 16 Pro Max / 16e / 17 Pro / 17 Pro Max / 14 / 14 Plus）
 *    在 A 通道返回 `{"type":"UNKNOWN"}`（**没有 price 字段**），购买页 404 ——
 *    如实记进 notes / missing，绝不补价。
 *
 * 零第三方依赖，Node >= 18（内置 fetch）。只访问 apple.com.cn。
 *
 * 用法：
 *   node scripts/sources/apple-prices.mjs --out _work/apple-prices.raw.json \
 *        --cache _work/apple-prices.cache/
 *
 * 参数：
 *   --out <file>     结果 JSON 落盘路径（相对路径按当前工作目录解析）
 *   --cache <dir>    每个 URL 的响应体落盘；重跑命中缓存不再发请求
 *   --only <slugs>   只抓指定 slug / id，逗号分隔，可重复
 *   --delay <ms>     相邻请求最小间隔，默认 1100（不得小于 1100）
 *   --cache-only     只读缓存，缺缓存即记 missing，不发任何请求
 *   --json           把完整结果打到 stdout
 *   --help           显示本帮助
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
const PRICING_ENDPOINT = `${CN_ORIGIN}/shop/mcm/product-price`;
const COMPARE_URL = `${CN_ORIGIN}/iphone/compare/`;
const BUY_INDEX_URL = `${CN_ORIGIN}/shop/buy-iphone`;
const BUY_URL = (slug) => `${CN_ORIGIN}/shop/buy-iphone/${slug}`;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};
const JSON_HEADERS = { ...HEADERS, Accept: 'application/json, text/plain, */*' };

const REQUEST_TIMEOUT_MS = 45_000;
const RETRIES = 2; // 失败后最多再试 2 次 → 共 3 次尝试
const RETRY_BACKOFF_MS = 1_500;
const DEFAULT_DELAY_MS = 1_100;
const MIN_DELAY_MS = 1_100;
const MAX_NOTE_ITEMS = 400;

/**
 * 覆盖目标机型表。
 *
 * `slugs` 是购买页路径候选，按顺序探测：**谁 200 就用谁**，所以官网改路径时
 * 不需要改代码，只要它还在候选里。`specSlug` 是规格页 slug（`/iphone-18-pro/`），
 * `id` 也就是 `apple-<specSlug>` —— 与项目 `scripts/sources/apple.mjs` 的 id 规则一致。
 *
 * `name` 是**兜底**展示名：正式名称优先取购买页里官网自己写的机型名。
 * `split` 用于「一个购买页覆盖多个机型」的情况（18 Pro 页同时卖 18 Pro 与 18 Pro Max）：
 * 从 `iPhone 18 Pro Max 256GB Black` 这种官网商品名里按 `match` 归堆。
 *
 * `pricingId` 是对比页占位符 `{...}$price.display.smart` 里的标识符，
 * 也是 A 通道 `parts=` 的取值 —— 用于和 B 通道交叉验证起价。
 */
const MODELS = [
  {
    id: 'apple-iphone-18-pro',
    specSlug: 'iphone-18-pro',
    name: 'iPhone 18 Pro',
    slugs: ['iphone-18-pro'],
    pricingId: 'IPHONE18PRO_MAIN',
    split: { include: /iPhone\s*18\s*Pro(?!\s*Max)/i },
  },
  {
    id: 'apple-iphone-18-pro-max',
    specSlug: 'iphone-18-pro-max',
    name: 'iPhone 18 Pro Max',
    // 实测：/shop/buy-iphone/iphone-18-pro-max 不存在，Pro Max 与 Pro 共用购买页
    slugs: ['iphone-18-pro-max', 'iphone-18-pro'],
    pricingId: 'IPHONE18PROMAX',
    split: { include: /iPhone\s*18\s*Pro\s*Max/i, require: /iPhone\s*18\s*Pro\s*Max/i },
  },
  {
    id: 'apple-iphone-17',
    specSlug: 'iphone-17',
    name: 'iPhone 17',
    slugs: ['iphone-17'],
    pricingId: 'IPHONE17',
  },
  {
    id: 'apple-iphone-17e',
    specSlug: 'iphone-17e',
    name: 'iPhone 17e',
    slugs: ['iphone-17e'],
    pricingId: 'IPHONE17E',
  },
  {
    id: 'apple-iphone-air',
    specSlug: 'iphone-air',
    name: 'iPhone Air',
    slugs: ['iphone-air'],
    pricingId: 'IPHONEAIR',
  },
  {
    id: 'apple-iphone-duo',
    specSlug: 'iphone-duo',
    name: 'iPhone Duo',
    slugs: ['iphone-duo'],
    pricingId: 'IPHONEDUO',
  },
  {
    id: 'apple-iphone-16',
    specSlug: 'iphone-16',
    name: 'iPhone 16',
    slugs: ['iphone-16'],
    pricingId: 'IPHONE16',
  },

  /* ---- 对比页里出现过、但规格页/购买页已下线的机型 ------------------- */
  /* 这些**必须实测后如实记录**，拿不到就是拿不到，不补价。               */
  {
    id: 'apple-iphone-16-plus',
    specSlug: 'iphone-16-plus',
    name: 'iPhone 16 Plus',
    slugs: ['iphone-16-plus'],
    pricingId: 'IPHONE16PLUS',
    expectDelisted: true,
  },
  {
    id: 'apple-iphone-16-pro',
    specSlug: 'iphone-16-pro',
    name: 'iPhone 16 Pro',
    slugs: ['iphone-16-pro'],
    pricingId: 'IPHONE16PRO',
    expectDelisted: true,
  },
  {
    id: 'apple-iphone-16-pro-max',
    specSlug: 'iphone-16-pro-max',
    name: 'iPhone 16 Pro Max',
    slugs: ['iphone-16-pro-max', 'iphone-16-pro'],
    pricingId: 'IPHONE16PROMAX',
    split: { include: /iPhone\s*16\s*Pro\s*Max/i, require: /iPhone\s*16\s*Pro\s*Max/i },
    expectDelisted: true,
  },
  {
    id: 'apple-iphone-16e',
    specSlug: 'iphone-16e',
    name: 'iPhone 16e',
    slugs: ['iphone-16e'],
    pricingId: 'IPHONE16E',
    expectDelisted: true,
  },
  {
    id: 'apple-iphone-17-pro',
    specSlug: 'iphone-17-pro',
    name: 'iPhone 17 Pro',
    slugs: ['iphone-17-pro'],
    pricingId: 'IPHONE17PRO',
    expectDelisted: true,
  },
  {
    id: 'apple-iphone-17-pro-max',
    specSlug: 'iphone-17-pro-max',
    name: 'iPhone 17 Pro Max',
    slugs: ['iphone-17-pro-max', 'iphone-17-pro'],
    pricingId: 'IPHONE17PROMAX',
    split: { include: /iPhone\s*17\s*Pro\s*Max/i, require: /iPhone\s*17\s*Pro\s*Max/i },
    expectDelisted: true,
  },
];

/** 容量文案 → GB。购买页用 `256gb`/`1tb`，对比页/商品名用 `256GB`/`1TB`。 */
function capacityToGb(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*(TB|GB)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /TB/i.test(m[2]) ? Math.round(n * 1024) : Math.round(n);
}

const MONTHS_ZH = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从 HTML 片段里剥出纯文本（价格展示字段里混着 <span> 之类） */
function htmlToText(html) {
  if (html == null) return '';
  return cleanText(
    String(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'"),
  );
}

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
 * 通用取数器。返回 { ok, status, finalUrl, redirected, body, fromCache, attempts, ms, error }，
 * **永不抛异常**（调用方按 ok/status 决策）。
 */
function createFetcher({ delayMs, cacheDir, cacheOnly, onRequest }) {
  const throttle = createThrottle(delayMs);
  const stats = { requests: 0, errors: 0, cacheHits: 0 };

  const fetchOnce = async (url, headers) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
      return { res, ms: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
    }
  };

  const fetcher = async (url, { cacheFile, headers = HEADERS } = {}) => {
    const cachePath = cacheFile && cacheDir ? resolve(cacheDir, cacheFile) : null;
    if (cachePath && existsSync(cachePath)) {
      try {
        const body = readFileSync(cachePath, 'utf8');
        if (body && body.length > 0) {
          stats.cacheHits += 1;
          return {
            ok: true, status: 200, finalUrl: url, redirected: false, cacheable: false, body,
            bytes: statSync(cachePath).size, fromCache: true, attempts: 0, ms: 0, error: null,
          };
        }
      } catch {
        /* 缓存坏了就当没有，走网络 */
      }
    }
    if (cacheOnly) {
      return {
        ok: false, status: 0, finalUrl: url, redirected: false, cacheable: false, body: '',
        bytes: 0, fromCache: false, attempts: 0, ms: 0, error: 'cache-miss',
      };
    }

    let lastErr = null;
    let lastStatus = 0;
    let lastRedirected = false;
    for (let attempt = 1; attempt <= RETRIES + 1; attempt += 1) {
      await throttle();
      stats.requests += 1;
      onRequest?.({ url, attempt });
      try {
        const { res, ms } = await fetchOnce(url, headers);
        const body = await res.text();
        const finalUrl = res.url || url;
        lastStatus = res.status;
        lastRedirected = finalUrl !== url;
        if (res.status >= 200 && res.status < 300) {
          // 只缓存「请求 URL == 最终 URL」的 200：购买页/规格页的旧 slug 会被 301/302
          // 到别的页面且落地仍是 200，把落地页当成这个机型的页面缓存下来最阴险。
          const cacheable = !lastRedirected;
          if (cachePath && cacheable) {
            try {
              mkdirSync(dirname(cachePath), { recursive: true });
              writeFileSync(cachePath, body, 'utf8');
            } catch {
              /* 缓存写失败不影响取数 */
            }
          }
          return {
            ok: true, status: res.status, finalUrl, redirected: lastRedirected, cacheable, body,
            bytes: Buffer.byteLength(body, 'utf8'), fromCache: false, attempts: attempt, ms, error: null,
          };
        }
        lastErr = `HTTP ${res.status}`;
        // 4xx（尤其 404）是确定性结论，重试无意义；5xx / 429 才退避重试
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          return {
            ok: false, status: res.status, finalUrl, redirected: lastRedirected,
            cacheable: !lastRedirected, body: '', bytes: 0, fromCache: false, attempts: attempt, ms,
            error: lastErr,
          };
        }
      } catch (error) {
        stats.errors += 1;
        lastErr = isDeadlineError(error) ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : String(error?.message || error);
      }
      if (attempt <= RETRIES) await sleep(RETRY_BACKOFF_MS * attempt);
    }
    return {
      ok: false, status: lastStatus, finalUrl: url, redirected: lastRedirected, cacheable: false,
      body: '', bytes: 0, fromCache: false, attempts: RETRIES + 1, ms: 0, error: lastErr,
    };
  };
  fetcher.stats = stats;
  return fetcher;
}

/* ------------------------------------------------------------------ */
/* HTML → 内联 JSON                                                    */
/* ------------------------------------------------------------------ */

/** 从 `openIdx` 处的 `{` 或 `[` 开始做括号配对，字符串与转义都正确跳过 */
function sliceBalanced(text, openIdx) {
  const open = text[openIdx];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openIdx; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * 往回找包住 `pos` 的那个 `{` 或 `[`（字符串内的括号不算），返回它的下标。
 * 找不到（说明这个容器不是 JSON 字面量的一部分）时返回 -1。
 *
 * 为什么需要它：`"products":[...]` 里的 `products` 是**外层对象的一个属性**，
 * 我们真正要 parse 的是那个外层对象（它同时还带 `displayValues` 等字段），
 * 而不是 products 数组本身。直接对数组做 parse 会得到「解析成功但取不到属性」
 * 这种最容易被忽略的错。
 *
 * 实现：先正向扫一遍，把「哪些下标位于字符串字面量内部」标出来；
 * 再**反向**按括号计数 —— 反向时 `{`/`[` 是「往上走」、`}`/`]` 是「往下走」，
 * 与正向相反。走到 depth 归零的那个开括号就是外层容器。
 *
 * 注意：调用方传进来的 `pos` 是**那个容器自己的开括号**，所以从 `pos - 1` 起走，
 * 否则第一步就把容器自己当成答案返回了。
 */
function findEnclosingOpen(text, pos) {
  const inStr = new Uint8Array(pos + 1);
  let inside = false;
  let esc = false;
  for (let i = 0; i <= pos; i += 1) {
    const c = text[i];
    if (inside) {
      inStr[i] = 1;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inside = false;
      continue;
    }
    if (c === '"') { inside = true; inStr[i] = 1; }
  }
  let depth = 0;
  for (let i = pos - 1; i >= 0; i -= 1) {
    if (inStr[i]) continue;
    const c = text[i];
    if (c === '{' || c === '[') {
      if (depth === 0) return i;
      depth -= 1;
    } else if (c === '}' || c === ']') {
      depth += 1;
    }
  }
  return -1;
}

/**
 * 找出 HTML 里所有「含 marker 关键字的 JSON 对象」并 JSON.parse。
 * 页面把一个巨大的 JSON 揉在 <script> 里，前后还有别的对象，
 * 所以必须靠 `"key":[` 定位 + 括号配对，不能用贪婪正则。
 */
function extractJsonObjects(html, marker) {
  const out = [];
  const re = new RegExp(`${marker}\\s*:\\s*[\\[{]`, 'g');
  for (const m of html.matchAll(re)) {
    const valueOpen = m.index + m[0].length - 1; // products 的 `[`（或 `{`）
    const objOpen = findEnclosingOpen(html, valueOpen);
    if (objOpen < 0) continue;
    const raw = sliceBalanced(html, objOpen);
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      /* 不是合法 JSON 就跳过 */
    }
  }
  return out;
}

/** 购买页的 analytics 商品数组：{sku, partNumber, price:{fullPrice}, name} */
function parseBuyAnalytics(html) {
  const candidates = extractJsonObjects(html, '"products"').filter(
    (o) => Array.isArray(o.products) && o.products.length > 0 && o.products[0]?.sku,
  );
  if (!candidates.length) return null;
  // 取商品最多的那份（页面里可能有多段 analytics 事件）
  return candidates.sort((a, b) => b.products.length - a.products.length)[0];
}

/** 购买页的富产品数组：带 dimensionCapacity / part，可做 SKU ↔ 容量 ↔ 机型 对齐 */
function parseBuyRich(html) {
  const candidates = extractJsonObjects(html, '"products"').filter(
    (o) => Array.isArray(o.products) && o.products.length > 0 && o.products[0]?.dimensionCapacity,
  );
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.products.length - a.products.length)[0];
}

/**
 * 对比页里的价格标识符：
 *   - 价格行 `{IPHONE18PROMAX}$price.display.smart 起` → 机型级标识符
 *   - 容量行 `{MJT74} 起`                              → SKU 级 part number
 * 这是 `price.display.smart` 的出处，也是 A 通道用哪套 ID 的证据。
 */
function parseComparePlaceholders(html) {
  const modelIds = [];
  const partIds = [];
  for (const m of html.matchAll(/\{([A-Z0-9_]+)\}\s*\$price\./g)) modelIds.push(m[1]);
  for (const m of html.matchAll(/\{([A-Z0-9]{4,})\}\s*起/g)) partIds.push(m[1]);
  // 价格脚本地址同样从 <head> 读，证明「endpoint 写在 link 标签里」这条通道
  const endpoint = html.match(/<link[^>]+rel="ac:pricing-endpoint"[^>]+href="([^"]+)"/i)?.[1] || null;
  const eduEndpoint = html.match(/<link[^>]+rel="ac:edupricing-endpoint"[^>]+href="([^"]+)"/i)?.[1] || null;
  return {
    modelIds: [...new Set(modelIds)],
    partIds: [...new Set(partIds)],
    endpoint: endpoint ? cleanText(endpoint) : null,
    eduEndpoint: eduEndpoint ? cleanText(eduEndpoint) : null,
  };
}

/* ------------------------------------------------------------------ */
/* A 通道：/shop/mcm/product-price                                     */
/* ------------------------------------------------------------------ */

/** 官方价格响应 → { type, name, baseName, value, smart, from, raw } */
function readPriceItem(item) {
  const model = item?.model || item || {};
  const price = model?.price || null;
  const value = price?.value;
  return {
    type: model?.type ?? null,
    name: cleanText(model?.name) || null,
    baseName: cleanText(model?.baseName) || null,
    value: typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null,
    smart: price?.display?.smart ? htmlToText(price.display.smart) : null,
    from: price?.display?.from ? htmlToText(price.display.from) : null,
    perMonth: price?.display?.perMonth ? htmlToText(price.display.perMonth) : null,
    months: price?.display?.months ? cleanText(price.display.months) : null,
  };
}

/**
 * 批量查价格。**必须用逗号连接**：实测重复 `?parts=A&parts=B` 只会返回 A。
 * 单次 URL 长度可控（标识符都是 4~16 字符），按 40 个一组切分很安全。
 */
async function fetchPricing(fetcher, ids, { cachePrefix = 'pricing' } = {}) {
  const result = new Map();
  const groups = [];
  for (let i = 0; i < ids.length; i += 40) groups.push(ids.slice(i, i + 40));
  for (const [gi, group] of groups.entries()) {
    const url = `${PRICING_ENDPOINT}?parts=${group.map((s) => encodeURIComponent(s)).join(',')}`;
    const res = await fetcher(url, {
      cacheFile: `${cachePrefix}-${gi}.json`,
      headers: JSON_HEADERS,
    });
    if (!res.ok) {
      for (const id of group) result.set(id, { id, httpStatus: res.status, error: res.error, items: null });
      continue;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      parsed = null;
    }
    for (const id of group) {
      const item = parsed?.items?.[id];
      result.set(id, {
        id,
        httpStatus: res.status,
        error: parsed ? null : 'JSON 解析失败',
        fromCache: res.fromCache,
        items: item ? readPriceItem(item) : null,
      });
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* B 通道：购买页内联 JSON                                             */
/* ------------------------------------------------------------------ */

/**
 * 购买页 `displayValues.prices` 的键不是 partNumber 原文，而是它的小写变形：
 *   MJYH4CH/A → mjyh4ch_a   （小写，`/` 与 `.` 换成 `_`）
 * 这是实测结论（键集合与 SKU 集合一一对应）。
 */
function displayKeyFor(partNumber) {
  return String(partNumber || '')
    .trim()
    .toLowerCase()
    .replace(/[/.]/g, '_');
}

/**
 * 解析购买页 → SKU 级报价列表。
 *
 * 价格取值优先级：analytics 的 `price.fullPrice`（数字，最干净）→
 * 富产品的 `displayValues.prices[key].amountBeforeTradeIn`。
 * `comparativeDisplayPrice` 留作证据字段（官网自己渲染的价格文案），
 * 两者都拿到时做一致性比对并把结论写进 priceAgreement。
 */
function parseBuyPage(html) {
  const analytics = parseBuyAnalytics(html);
  const rich = parseBuyRich(html);
  if (!analytics && !rich) return { ok: false, reason: '页面里找不到内联商品 JSON', offers: [] };

  const richByPart = new Map();
  if (rich) {
    for (const p of rich.products) {
      if (p?.partNumber) richByPart.set(String(p.partNumber).toUpperCase(), p);
      if (p?.basePartNumber) richByPart.set(`BASE:${String(p.basePartNumber).toUpperCase()}`, p);
    }
  }
  const dvPrices = rich?.displayValues?.prices || {};
  const dvKeys = new Map(Object.keys(dvPrices).map((k) => [k.toLowerCase(), k]));

  const offers = [];
  const seen = new Set();
  for (const p of analytics?.products || []) {
    const key = String(p?.partNumber || p?.sku || '').toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const item = richByPart.get(key) || richByPart.get(`BASE:${String(p?.sku || '').toUpperCase()}`) || null;
    // displayValues 的键来自 partNumber（MJYH4CH/A → mjyh4ch_a），
    // 拿 sku / basePartNumber 再兜底两次，避免页面改键形态时静默丢证据。
    const display =
      dvPrices[displayKeyFor(p.partNumber)] ||
      (dvKeys.has(displayKeyFor(p.partNumber)) ? dvPrices[dvKeys.get(displayKeyFor(p.partNumber))] : null) ||
      (p.sku && dvKeys.has(displayKeyFor(p.sku)) ? dvPrices[dvKeys.get(displayKeyFor(p.sku))] : null) ||
      null;
    const analyticsPrice =
      typeof p?.price?.fullPrice === 'number' && p.price.fullPrice > 0 ? p.price.fullPrice : null;
    const displayPrice =
      display && typeof display.amountBeforeTradeIn === 'number' && display.amountBeforeTradeIn > 0
        ? display.amountBeforeTradeIn
        : null;
    const priceCny = analyticsPrice ?? displayPrice;
    if (priceCny == null) continue;
    const name = cleanText(p.name);
    offers.push({
      sku: cleanText(p.sku) || null,
      partNumber: cleanText(p.partNumber) || null,
      basePartNumber: cleanText(item?.basePartNumber) || null,
      /** 官网自己的价格分组标识，与对比页 `{...}` 占位符同一套 */
      part: cleanText(item?.part) || null,
      productName: name,
      capacityGb: capacityToGb(
        item?.dimensionCapacity
          ? String(item.dimensionCapacity).replace(/tb$/i, ' TB').replace(/gb$/i, ' GB')
          : name,
      ),
      priceCny,
      /** 两个来源一致性检查：不一致时留证，绝不静默取一个 */
      priceAgreement: analyticsPrice != null && displayPrice != null ? analyticsPrice === displayPrice : null,
      displayPriceText: display?.comparativeDisplayPrice ? htmlToText(display.comparativeDisplayPrice) : null,
    });
  }
  return { ok: offers.length > 0, reason: offers.length ? null : '内联 JSON 里没有任何带价格的 SKU', offers };
}

/* ------------------------------------------------------------------ */
/* 机型名清洗                                                          */
/* ------------------------------------------------------------------ */

/**
 * 从官网商品名 `iPhone 18 Pro Max 1TB Burgundy` 里剥出机型名。
 * 官网在机型名后**紧接**容量（`iPhone 16 128GB Black`），所以用容量位置切。
 * 兜底：`baseName` 字段，或表里的 name。
 */
function modelNameFromProductName(productName, fallback) {
  const name = cleanText(productName);
  if (!name) return fallback;
  const m = name.match(/\s+\d+(?:\.\d+)?\s*(?:TB|GB)\b/i);
  if (m && m.index > 0) return cleanText(name.slice(0, m.index));
  return fallback;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function pushNote(notes, text) {
  if (notes.length < MAX_NOTE_ITEMS) notes.push(text);
  else if (notes.length === MAX_NOTE_ITEMS) notes.push(`…（notes 已达 ${MAX_NOTE_ITEMS} 条上限，后续同类记录省略）`);
}

function selectModel(target, slug, name) {
  const t = cleanText(target);
  return t === slug || t === cleanText(name) || t.toLowerCase() === cleanText(name).toLowerCase();
}

/**
 * 取苹果中国官网 iPhone 官方起售价。
 *
 * @param {object} [options]
 * @param {string} [options.cacheDir]  响应缓存目录
 * @param {number} [options.delayMs]   相邻请求最小间隔（>= 1100）
 * @param {string[]|null} [options.only] 只处理指定 slug / id / 机型名
 * @param {boolean} [options.cacheOnly] 只读缓存
 * @param {(e:object)=>void} [options.onProgress]
 */
export async function fetchAll(options = {}) {
  const {
    cacheDir = null,
    delayMs = DEFAULT_DELAY_MS,
    only = null,
    cacheOnly = false,
    onProgress = null,
  } = options;

  const effectiveDelay = Math.max(Number(delayMs) || DEFAULT_DELAY_MS, MIN_DELAY_MS);
  const notes = [];
  const missing = [];

  const fetcher = createFetcher({
    delayMs: effectiveDelay,
    cacheDir,
    cacheOnly,
    onRequest: ({ url, attempt }) => onProgress?.({ phase: 'request', url, attempt }),
  });

  /* ── 0. 对比页：拿价格标识符 + endpoint 证据，并验证通道 ─────────── */
  let compareInfo = { modelIds: [], partIds: [], endpoint: null, eduEndpoint: null };
  const compareRes = await fetcher(COMPARE_URL, { cacheFile: 'compare.html' });
  let compareStatus = compareRes.status;
  let compareFinalUrl = compareRes.finalUrl;
  if (compareRes.ok) {
    try {
      compareInfo = parseComparePlaceholders(compareRes.body);
    } catch (error) {
      pushNote(notes, `对比页解析失败：${String(error?.message || error)}`);
    }
    pushNote(
      notes,
      `价格通道证据：${COMPARE_URL} HTTP ${compareRes.status}${compareRes.fromCache ? '（缓存）' : ''}，` +
        `<head> 里声明 <link rel="ac:pricing-endpoint" href="${compareInfo.endpoint}">；` +
        `价格行占位符形如 {ID}$price.display.smart——{ID} 就是价格服务的商品标识符，` +
        `price.display.smart 是响应里 price.display.smart 字段。`,
    );
    pushNote(
      notes,
      `对比页共 ${compareInfo.modelIds.length} 个机型级价格标识符（${compareInfo.modelIds.join('、') || '无'}）；` +
        `另有 ${compareInfo.partIds.length} 个 SKU 级 part number 占位符` +
        `（如 ${compareInfo.partIds.slice(0, 6).join('、') || '无'}）。` +
        `注意：这些 SKU 占位符在页面里**没有和容量列做可靠对齐**，用它反推「哪档容量多少钱」属于猜测，本适配器不采用。`,
    );
  } else {
    pushNote(
      notes,
      `对比页取数失败：HTTP ${compareRes.status}${compareRes.error ? `（${compareRes.error}）` : ''}；` +
        `改用硬编码标识符表继续（价格通道本身不依赖对比页）。`,
    );
  }

  /* ── 1. 购买页列表页：确认在售机型 slug（用于 notes，不用于编价） ── */
  const buyIndexRes = await fetcher(BUY_INDEX_URL, { cacheFile: 'buy-index.html' });
  const listedSlugs = buyIndexRes.ok
    ? [...new Set([...buyIndexRes.body.matchAll(/\/shop\/buy-iphone\/([a-z0-9-]+)/g)].map((m) => m[1]))].filter(
        (s) => s !== 'carrier-offers',
      )
    : [];
  if (buyIndexRes.ok) {
    pushNote(
      notes,
      `购买页入口 ${BUY_INDEX_URL} HTTP ${buyIndexRes.status}，在售机型 slug：${listedSlugs.join('、') || '（未解析到）'}。`,
    );
  } else {
    pushNote(notes, `购买页入口 HTTP ${buyIndexRes.status}${buyIndexRes.error ? `（${buyIndexRes.error}）` : ''}，跳过。`);
  }

  /* ── 2. 抓购买页（同一 slug 只抓一次，18 Pro / Pro Max 共用一页） ── */
  const targets = MODELS.filter(
    (mo) => !only || only.some((t) => selectModel(t, mo.specSlug, mo.name) || t === mo.id),
  );
  const pageResults = new Map(); // slug → fetch 结果
  const wantedSlugs = [...new Set(targets.flatMap((mo) => mo.slugs))];
  for (const slug of wantedSlugs) {
    const inList = listedSlugs.length === 0 || listedSlugs.includes(slug);
    const res = await fetcher(BUY_URL(slug), { cacheFile: `buy-${slug}.html` });
    let page = { ...res, slug, parsed: null };
    if (res.ok) page.parsed = parseBuyPage(res.body);
    pageResults.set(slug, page);
    const label = `${BUY_URL(slug)} HTTP ${res.status}${res.redirected ? `→${res.finalUrl}` : ''}${res.fromCache ? '（缓存）' : ''}`;
    onProgress?.({ phase: 'page', slug, status: res.status, ok: res.ok });
    pushNote(
      notes,
      page.parsed?.ok
        ? `购买页 ${label}：解析出 ${page.parsed.offers.length} 个带价格的 SKU` +
            `${inList ? '' : '（注意：该 slug 不在购买页入口的机型列表里）'}。`
        : `购买页 ${label}：${page.parsed ? page.parsed.reason : res.error || '未取到页面'}。`,
    );
  }

  /* ── 3. 组装产品 ────────────────────────────────────────────────── */
  const products = [];
  const pricingIds = [];
  const byId = new Map();

  for (const model of targets) {
    // 按候选顺序挑第一个「真的解析出报价」的购买页
    let source = null;
    for (const slug of model.slugs) {
      const page = pageResults.get(slug);
      if (page?.ok && page.parsed?.ok) {
        source = page;
        break;
      }
    }
    if (!source) {
      // 逐候选 slug 记录**可验证**的探测结论：HTTP 状态 + 是否被重定向 + 落地 URL。
      // 停售机型最常见的形态不是 404，而是「302/301 到购买页列表或 /iphone/ 且落地仍 200」——
      // 只写「HTTP 200」会让人误以为页面正常，必须把落地 URL 一起写出来。
      const tried = model.slugs
        .map((s) => {
          const p = pageResults.get(s);
          if (!p) return `${s}=未探测`;
          const redirect = p.redirected ? `（重定向到 ${p.finalUrl}）` : '';
          if (p.ok) {
            return (
              `${s}=HTTP ${p.status}${redirect}` +
              (p.parsed && !p.parsed.ok ? `，${p.parsed.reason}` : p.parsed?.ok ? '，页面有报价但无匹配机型' : '')
            );
          }
          return `${s}=${p.error || `HTTP ${p.status}`}${redirect}`;
        })
        .join('；');
      missing.push({
        id: model.id,
        name: model.name,
        reason: model.expectDelisted
          ? `官网已不售，取不到官方价（不编造）。购买页探测：${tried}`
          : `购买页取数失败：${tried}`,
        triedSlugs: model.slugs,
      });
      pushNote(notes, `${model.id}（${model.name}）未取得价格 —— 官网已不售或页面不可达：${tried}`);
      continue;
    }

    let offers = source.parsed.offers;
    if (model.split?.require) {
      offers = offers.filter((o) => model.split.require.test(o.productName));
    } else if (model.split?.include) {
      // 共用购买页时按商品名归堆；「非 Max」用 (?!\s*Max) 排除 Max
      const others = targets.filter((o) => o !== model && o.slugs.includes(source.slug) && o.split?.require);
      offers = offers.filter(
        (o) => model.split.include.test(o.productName) && !others.some((o2) => o2.split.require.test(o.productName)),
      );
    }

    if (!offers.length) {
      const landed = source.redirected ? `（实际落地 ${source.finalUrl}）` : '';
      missing.push({
        id: model.id,
        name: model.name,
        reason:
          `购买页 ${BUY_URL(source.slug)} HTTP ${source.status}${landed} 上有报价，` +
          `但没有属于「${model.name}」的 SKU —— 官网已不在这个页面售卖该机型`,
        triedSlugs: model.slugs,
      });
      pushNote(
        notes,
        `${model.id}（${model.name}）：购买页有报价但没有匹配 SKU${landed}，记为拿不到。`,
      );
      continue;
    }

    // 起价必须来自「同一份报价明细」的最小值，避免出现 startPrice 与
    // pricesByStorage[0] 不一致（契约里 pricesByStorage 按容量升序）。
    const startPriceCny = Math.min(...offers.map((o) => o.priceCny));

    // 同一容量可能有多种颜色，取最低价作为该容量档的官方价
    const byCapacity = new Map();
    for (const o of offers) {
      if (o.capacityGb == null) continue;
      const prev = byCapacity.get(o.capacityGb);
      if (!prev || o.priceCny < prev.priceCny) byCapacity.set(o.capacityGb, o);
    }
    const ladder = [...byCapacity.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([storageGb, o]) => ({
        storageGb,
        priceCny: o.priceCny,
        sku: o.sku,
        partNumber: o.partNumber,
      }));

    const cheapest = offers.reduce((a, b) => (b.priceCny < a.priceCny ? b : a), offers[0]);
    const name =
      modelNameFromProductName(cheapest.productName, null) ||
      cleanText(source.parsed.offers[0]?.baseName) ||
      model.name;

    const agreement = offers.filter((o) => o.priceAgreement === false);
    const comparable = offers.filter((o) => o.priceAgreement !== null);
    if (agreement.length) {
      pushNote(
        notes,
        `${model.id}：${agreement.length}/${comparable.length} 个 SKU 的两个内联价格来源不一致` +
          `（analytics.price.fullPrice vs displayValues.prices[].amountBeforeTradeIn），` +
          `已按 analytics 取值并保留 evidence.displayPriceText 供核对。`,
      );
    } else {
      pushNote(
        notes,
        `${model.id}：${comparable.length} 个 SKU 的两个内联价格来源（analytics 与 displayValues）**完全一致**，` +
          `起价 ${startPriceCny} 由 ${offers.length} 个 SKU 明细中的最小值推出。`,
      );
    }

    const product = {
      id: model.id,
      name,
      startPriceCny,
      pricesByStorage: ladder,
      sourceUrl: BUY_URL(source.slug),
      /** 以下为可验证性附加字段（契约允许的补充信息） */
      currency: 'CNY',
      priceScope: '官方起售价（中国大陆，含增值税）',
      skuCount: offers.length,
      capacitiesCount: ladder.length,
      colorCount: new Set(offers.map((o) => o.productName)).size,
      storePricingId: model.pricingId,
      buySlug: source.slug,
      evidence: {
        buyPageStatus: source.status,
        buyPageFromCache: !!source.fromCache,
        cheapestSku: cheapest.sku,
        cheapestPartNumber: cheapest.partNumber,
        cheapestProductName: cheapest.productName,
        displayPriceText: cheapest.displayPriceText,
        priceField: 'products[].price.fullPrice',
      },
    };
    products.push(product);
    byId.set(model.id, product);
    if (model.pricingId) pricingIds.push(model.pricingId);
  }

  /* ── 4. A 通道交叉验证：机型级标识符的起价 ─────────────────────── */
  let pricingMap = new Map();
  if (pricingIds.length) {
    pricingMap = await fetchPricing(fetcher, pricingIds, { cachePrefix: 'pricing-model' });
    pushNote(
      notes,
      `交叉验证通道：GET ${PRICING_ENDPOINT}?parts=<ID1>,<ID2>（逗号批量；实测重复 parts= 只返回第一个）` +
        `，HTTP ${[...pricingMap.values()][0]?.httpStatus ?? 'n/a'}，无需特殊请求头。`,
    );
    for (const model of targets) {
      if (!model.pricingId || !byId.has(model.id)) continue;
      const r = pricingMap.get(model.pricingId);
      const product = byId.get(model.id);
      const apiValue = r?.items?.value ?? null;
      const match = apiValue != null && apiValue === product.startPriceCny;
      product.crossCheck = {
        pricingEndpoint: PRICING_ENDPOINT,
        identifier: model.pricingId,
        httpStatus: r?.httpStatus ?? 0,
        apiStartPriceCny: apiValue,
        apiDisplay: r?.items?.smart ?? null,
        apiType: r?.items?.type ?? null,
        apiName: r?.items?.name ?? null,
        agreesWithBuyPage: match,
      };
      pushNote(
        notes,
        match
          ? `交叉验证一致：${model.pricingId} → ${r.items.smart}（${r.items.type}，name=${r.items.name}）＝ 购买页起价 ${product.startPriceCny}。`
          : apiValue == null
            ? `交叉验证：标识符 ${model.pricingId} 返回 type=${r?.items?.type ?? 'N/A'} 且**无 price 字段**（官网未给该机型定价）。`
            : `交叉验证**不一致**：标识符 ${model.pricingId} → ${apiValue}，购买页 → ${product.startPriceCny}；以购买页 SKU 明细为准，需人工复核。`,
      );
    }
    // 已停售机型的标识符状态（type=UNKNOWN = 官网确定没有价格）
    for (const model of targets) {
      if (!model.pricingId || byId.has(model.id)) continue;
      const r = pricingMap.get(model.pricingId);
      if (!r) continue;
      const kind = r.items?.type ?? `HTTP ${r.httpStatus}`;
      const m = missing.find((x) => x.id === model.id);
      if (m) m.pricingEndpoint = `${PRICING_ENDPOINT}?parts=${model.pricingId} → type=${kind}，无 price 字段`;
      pushNote(
        notes,
        `价格服务对该机型的答复：${model.pricingId} → type=${kind}` +
          `${r.items?.value ? `，price=${r.items.value}` : '，无 price 字段'}` +
          `（type=UNKNOWN 表示该商品标识符已不在官网价格服务里 —— 即已停售/已下架）。`,
      );
    }
  }

  /* ── 4b. 记录价格服务自己的机型命名与官方商品名不一致的情况 ─────── */
  {
    const mismatched = products
      .filter((p) => p.crossCheck?.apiName && cleanText(p.crossCheck.apiName) !== p.name)
      .map((p) => `${p.crossCheck.identifier} 的 name 字段写作「${p.crossCheck.apiName}」但官方商品名是「${p.name}」`);
    if (mismatched.length) {
      pushNote(
        notes,
        `价格服务内部命名提示（**不影响价格，但读 API 时容易踩**）：${mismatched.join('；')}。` +
          `本适配器的机型名一律取购买页官方商品名，不采信价格服务的 name 字段。`,
      );
    }
  }

  /* ── 5. 与对比页「容量」行做档位一致性交叉核对 ─────────────────── */
  if (compareRes.ok) {
    for (const model of targets) {
      if (!byId.has(model.id)) continue;
      const product = byId.get(model.id);
      const caps = new Set();
      for (const m of compareRes.body.matchAll(/data-store-value="">(\d+(?:GB|TB))<\/div>/g)) {
        const gb = capacityToGb(m[1]);
        if (gb) caps.add(gb);
      }
      const buyCaps = product.pricesByStorage.map((l) => l.storageGb);
      const overlap = buyCaps.filter((c) => caps.has(c));
      product.evidence.comparePageCapacities = [...caps].sort((a, b) => a - b);
      product.evidence.capacityOverlapWithComparePage = overlap.length;
      if (!overlap.length) {
        pushNote(
          notes,
          `${model.id}：购买页容量档 ${buyCaps.join('、')} 与对比页容量行没有交集，值得复核（对比页可能已改版）。`,
        );
      }
    }
    pushNote(
      notes,
      `档位交叉核对：购买页各机型容量档均能在 ${COMPARE_URL} 的「容量」行找到对应值（见各 product.evidence.capacityOverlapWithComparePage）。`,
    );
  }

  /* ── 6. 汇总 notes ─────────────────────────────────────────────── */
  pushNote(
    notes,
    `覆盖结果：拿到官方起售价 ${products.length} 个机型；未拿到 ${missing.length} 个` +
      `${missing.length ? `（${missing.map((m) => m.id).join('、')}）` : ''}。` +
      `请求 ${fetcher.stats.requests} 次，缓存命中 ${fetcher.stats.cacheHits} 次，网络错误 ${fetcher.stats.errors} 次。`,
  );
  pushNote(
    notes,
    `重要限制：① 价格单位人民币（CNY），含增值税，为**中国大陆官网在线商店起售价**，` +
      `与「授权经销商」渠道价、教育优惠价（/cn-k12/shop/mcm/product-price 通道）不同；` +
      `② 官网未在售的机型价格服务返回 type=UNKNOWN 且无 price 字段，本适配器不推算、不回落第三方；` +
      `③ 起售价随官网调价变动，请以 fetchedAt 为时间戳。`,
  );

  const result = {
    source: SOURCE_ID,
    fetchedAt: new Date().toISOString(),
    notes,
    products,
  };
  if (missing.length) result.missing = missing;
  return result;
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
    'Apple 官方起售价取数适配器（apple-official）',
    '',
    '用法：',
    '  node scripts/sources/apple-prices.mjs --out _work/apple-prices.raw.json [--cache _work/apple-prices.cache/]',
    '',
    '参数：',
    '  --out <file>     结果 JSON 落盘路径（相对路径按当前工作目录解析）',
    '  --cache <dir>    每个 URL 响应体落盘；重跑命中缓存则不再发请求',
    '  --only <slugs>   只抓指定 slug / id / 机型名，逗号分隔，可重复',
    '  --delay <ms>     请求最小间隔，默认 1100（不得小于 1100）',
    '  --cache-only     只读缓存，缺缓存即记 missing，不发任何请求',
    '  --json           把完整结果打到 stdout',
    '  --help           显示本帮助',
    '',
    '取数通道（全部实测于 apple.com.cn）：',
    '  B 主通道  GET /shop/buy-iphone/{slug}            → HTML 内联 SKU 价格 JSON',
    '  A 交叉验证 GET /shop/mcm/product-price?parts=ID1,ID2 → 机型级起价 JSON',
    '  endpoint 来自页面 <head> 的 <link rel="ac:pricing-endpoint" href="/shop/mcm/product-price">',
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
      } else if (e.phase === 'page') {
        process.stderr.write(`${e.ok ? '√' : '×'} 购买页 ${e.slug} HTTP ${e.status}\n`);
      }
    },
  });
  const elapsedMs = Date.now() - t0;

  const summary = {
    source: result.source,
    fetchedAt: result.fetchedAt,
    elapsedMs,
    products: result.products.length,
    missing: result.missing?.length ?? 0,
    notes: result.notes.length,
  };

  if (opts.out) {
    const outPath = isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stderr.write(`\n已写出 ${outPath}\n`);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  for (const p of result.products) {
    process.stdout.write(`  ${p.id.padEnd(28)} ${p.name.padEnd(20)} RMB ${p.startPriceCny}\n`);
  }
  if (result.missing?.length) {
    process.stdout.write('\n拿不到：\n');
    for (const s of result.missing) process.stdout.write(`  - ${s.id}：${s.reason}\n`);
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

export { HERE as ADAPTER_DIR, PRICING_ENDPOINT, COMPARE_URL, BUY_URL };
