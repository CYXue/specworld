#!/usr/bin/env node
/**
 * huawei.mjs — 华为官网（consumer.huawei.com/cn）手机规格「取数适配器」
 *
 * 职责边界（严格遵守 scripts/sources/types.ts 的分工）：
 *   本文件只把官网页面变成 **原始键值对**。不判断单位、不做换算、不做口径裁决、
 *   不决定字段该映射到契约里的哪个字段。所有值都是**页面原文**（`6600 mAh（典型值）`
 *   就存 `6600 mAh（典型值）`）。
 *
 * 数据源结论（来自 _research/probe/huawei/FINDINGS.md，均为实测）：
 *   - 规格数据**没有公开 JSON API**，是 AEM 服务端渲染进 /specs/ 页面的
 *     <li class="large-accordion__item"> 手风琴结构；纯 HTTP GET + DOM 解析即可。
 *   - 机型目录（在售全量 + 官方价）藏在 /cn/phones/ 页面的隐藏 input
 *     `data-config` 属性里（内层引号被转义成 &#34;，属性值在第一个**裸** " 处结束）。
 *   - **最大坑**：已停售机型 301 跳回 /cn/phones/，跟随重定向后**仍是 HTTP 200**。
 *     不校验 finalUrl 就会把「手机列表页」当规格页解析，静默产出空记录。
 *     本文件的护栏：① 便宜预检 `{slug}/specs.model.json`（约 460 B，title 以 "301"
 *     开头即已下线）② finalUrl 必须仍是目标 specs 页 ③ 解析出的章节数 > 0。
 *     三条任一不过 → 进 `skipped`，绝不产出空记录。
 *   - 另一处坑：脚注有两种 class，`.large-accordion-subtext`（挂在紧邻的字段值上）
 *     与 `.large-accordion-text`（章节级备注，**不是字段值**）。正则备选分支顺序
 *     写反会把脚注吞进字段值（`机身内存（ROM）` 会变成长串）。
 *
 * 用法：
 *   node scripts/sources/huawei.mjs --out _work/huawei.raw.json
 *   node scripts/sources/huawei.mjs --out _work/huawei.raw.json --cache _work/huawei.cache/
 *   node scripts/sources/huawei.mjs --offline          # 只用缓存，不联网
 *   node scripts/sources/huawei.mjs --only mate90-pro  # 只跑指定 slug（可重复/逗号分隔）
 *   node scripts/sources/huawei.mjs --limit 3
 *
 * 无第三方依赖（Node ≥18 内置 fetch）。只访问 consumer.huawei.com。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- constants

const BASE = 'https://consumer.huawei.com';
const CATALOG_URL = `${BASE}/cn/phones/`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 串行请求间隔（要求 ≥1.1s），避免给官网压力 */
const DELAY_MS = 1100;
/** 单次请求超时 */
const TIMEOUT_MS = 45_000;
/** 失败重试次数（不含首次） */
const RETRIES = 2;

/**
 * 覆盖度下限：低于此值视为「解析结果不可信」而非「机型规格少」。
 * 实测在售机型为 15–20 章节 / 约 44 扁平字段，留足余量。
 */
const MIN_SECTIONS = 6;
const MIN_FLAT_FIELDS = 15;

/** 零宽字符 / 软连字符：官网在商品名里插 &#8288;(WORD JOINER)、&NoBreak; 等，必须剥掉 */
const ZERO_WIDTH_RE = /[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD]/g;
/** 目录页里混进商品名的行内标签（如 `Mate XTs <div style="white-space: nowrap;">非凡大师</div>`） */
const INLINE_TAG_RE = /<[^>]*>/g;

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** phone-spec-world 仓库根（scripts/sources/ -> ../..） */
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const WORK_DIR = path.join(PROJECT_ROOT, '_work');
const DEFAULT_CACHE_DIR = path.join(WORK_DIR, 'huawei.cache');
const DEFAULT_OUT = path.join(WORK_DIR, 'huawei.raw.json');

// ---------------------------------------------------------------- small utils

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HTML 实体解码（覆盖官网实际出现的写法，&amp; 必须最后处理） */
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(Number(d));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return '';
      }
    })
    .replace(/&nbsp;|&NoBreak;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 去标签 + 实体解码 + 折叠空白 + 去零宽字符 */
function text(html) {
  return decodeEntities(String(html).replace(INLINE_TAG_RE, ' '))
    .replace(ZERO_WIDTH_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从原始标签串里取属性值 */
function attr(tag, name) {
  const m = String(tag).match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** 只保留 http(s) 的 origin+pathname（查询参数/片段不进缓存身份） */
function normalizeUrl(u) {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return String(u);
  }
}

const stripSlash = (u) => String(u).replace(/\/+$/, '');

function specsUrlFor(slug) {
  // 末尾斜杠必需：不带会多一次 301
  return `${BASE}/cn/phones/${slug}/specs/`;
}
function precheckUrlFor(slug) {
  return `${BASE}/cn/phones/${slug}/specs.model.json`;
}

// ---------------------------------------------------------------- fetch (串行 + 超时 + 重试)

let lastRequestAt = 0;
let netRequests = 0;

/** 全局串行节流：任何两次真实网络请求之间至少 DELAY_MS */
async function throttle() {
  const wait = lastRequestAt + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * GET 一个 URL，返回 { status, finalUrl, body, contentType, bytes }。
 * 网络错误 / 超时 / 5xx 重试 RETRIES 次（指数退避），4xx 直接返回不重试。
 */
async function httpGet(url, { accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(DELAY_MS * attempt * 2);
    await throttle();
    netRequests++;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: accept,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.text();
      if (res.status >= 500 && attempt < RETRIES) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return {
        status: res.status,
        finalUrl: normalizeUrl(res.url || url),
        contentType: res.headers.get('content-type') || '',
        body,
        bytes: Buffer.byteLength(body, 'utf8'),
      };
    } catch (e) {
      lastErr = e; // 网络层错误 / AbortError(timeout)
    }
  }
  throw new Error(`GET ${url} failed after ${RETRIES + 1} attempts: ${lastErr?.message || lastErr}`);
}

// ---------------------------------------------------------------- 磁盘缓存（断点续跑）

/**
 * 极简 HTML 落盘缓存：`_work/huawei.cache/<sha1(url)>.html` + `index.json`。
 * 命中缓存则完全不发请求（不 revalidate），满足「重跑命中缓存不再请求」。
 */
class HttpCache {
  constructor(dir, { offline = false } = {}) {
    this.dir = dir;
    this.offline = offline;
    this.map = new Map(); // url -> { file, status, finalUrl, contentType, bytes, fetchedAt }
    this.hits = 0;
    this.misses = 0;
    this.indexPath = path.join(dir, 'index.json');
    if (fs.existsSync(this.indexPath)) {
      try {
        const idx = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
        for (const e of idx.entries || []) this.map.set(e.url, e);
      } catch {
        /* 索引损坏则视为空缓存 */
      }
    }
  }

  _flush() {
    const entries = [...this.map.entries()].map(([url, e]) => ({ url, ...e }));
    fs.writeFileSync(this.indexPath, JSON.stringify({ version: 1, entries }, null, 2), 'utf8');
  }

  read(url) {
    const e = this.map.get(url);
    if (!e) return null;
    const f = path.join(this.dir, e.file);
    if (!fs.existsSync(f)) return null;
    return { ...e, body: fs.readFileSync(f, 'utf8'), fromCache: true };
  }

  write(url, r) {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = `${sha256(url).slice(0, 20)}.html`;
    fs.writeFileSync(path.join(this.dir, file), r.body, 'utf8');
    const e = {
      file,
      status: r.status,
      finalUrl: r.finalUrl,
      contentType: r.contentType,
      bytes: r.bytes,
      fetchedAt: new Date().toISOString(),
    };
    this.map.set(url, e);
    this._flush();
    return { ...e, body: r.body, fromCache: false };
  }

  /** 缓存优先；offline 模式未命中直接抛错（不允许联网） */
  async fetch(url, opts) {
    const hit = this.read(url);
    if (hit) {
      this.hits++;
      return hit;
    }
    this.misses++;
    if (this.offline) throw new Error(`OFFLINE cache miss: ${url}`);
    const r = await httpGet(url, opts);
    return this.write(url, r);
  }
}

// ---------------------------------------------------------------- 目录页解析

/**
 * /cn/phones/ 页面的隐藏 input：
 *   <input type="hidden" class="plp-shelf-and-pop-up-v5-config"
 *          data-site-code="cn" data-config="{&#34;seriesGroups&#34;:[...]}">
 * 坑：内层引号被转义成 &#34;，所以属性值在第一个**裸** " 处结束；
 * 页面上还有别的 `data-config`（导航组件），必须挑含 allProducts+productLink 的那个。
 */
function extractCatalogConfig(html) {
  let payload = null;
  for (const m of html.matchAll(/([a-zA-Z0-9_:-]+)\s*=\s*"([^"]*)"/g)) {
    if (m[2].includes('allProducts') && m[2].includes('productLink')) {
      payload = m[2];
      break;
    }
  }
  if (!payload) throw new Error('catalog payload (data-config with allProducts/productLink) not found in /cn/phones/');
  return JSON.parse(decodeEntities(payload));
}

/**
 * 把目录 JSON 摊平成 catalog 条目。
 * 只列**在售**机型；已下线但页面还活着的机型不会出现（两者要分开看）。
 */
function parseCatalog(config, sourceUrl = CATALOG_URL) {
  const entries = [];
  const seriesSummaries = [];
  const skipped = [];

  for (const g of config.seriesGroups || []) {
    const series = text(g.seriesTitle || g.seriesName || '') || '';
    const subtitle = text(g.seriesSubtitle || '') || '';
    const products = Array.isArray(g.allProducts) ? g.allProducts : [];
    seriesSummaries.push({ series, subtitle, count: products.length });

    for (const p of products) {
      const rawLink = p.productLink || p.data?.detailLink || '';
      const m = String(rawLink).match(/^\/cn\/phones\/([a-z0-9][a-z0-9-]*)\/?$/i);
      const slug = m ? m[1].toLowerCase() : null;
      const title = text(p.productTitleText || p.productTitle || p.data?.marketingName || '');
      const priceRaw = p.data?.price;
      const price = priceRaw === undefined || priceRaw === null || String(priceRaw).trim() === ''
        ? null
        : String(priceRaw).trim();

      if (!slug) {
        // 目录里混进来的非手机类目（或链接形状变了）——透明记录，不猜
        skipped.push({
          id: `huawei-${rawLink || title || '(unknown)'}`,
          reason: `catalog-entry-not-a-phone-page (productLink=${rawLink || '(empty)'}, title=${title || '(empty)'})`,
        });
        continue;
      }

      entries.push({
        slug,
        id: `huawei-${slug}`,
        title,
        series,
        seriesSubtitle: subtitle,
        price,
        priceCny: price ? Number(price) : null,
        productId: p.data?.productId ? String(p.data.productId) : null,
        ecProductId: p.data?.ecProductId ? String(p.data.ecProductId) : null,
        buyLink: p.data?.buyButtonMode?.thirdPartySiteLink || null,
        label: p.productLabel ? text(p.productLabel) : null,
        specsUrl: specsUrlFor(slug),
        catalogUrl: sourceUrl,
      });
    }
  }
  return { entries, seriesSummaries, skipped };
}

// ---------------------------------------------------------------- 规格页解析

/**
 * 解析手风琴规格块。**一个页面里存在两种 DOM 布局**，都要吃下：
 *
 * 布局 A（大多数机型）—— AEM t05-large-accordion：
 *   <li class="large-accordion__item">
 *     <span class="large-accordion__title large-accordion-title">章节名</span>
 *     <div class="large-accordion__content">
 *       <div class="large-accordion__wrap">
 *         <div class="large-accordion-subtitle ...">字段名</div>
 *         <p>字段值</p>
 *         <p class="large-accordion-subtext">值级脚注</p>
 *       </div>
 *       <div class="large-accordion__inner"><p class="large-accordion-text">章节级备注</p></div>
 *     </div>
 *   </li>
 *
 * 布局 B（mate90-pro-max / mate-xt-2-ultimate-design / mate-x7 三个页面）—— multi-watchGt：
 *   <div class="large-accordion-columns multi-watchGt">
 *     <div class="multi-watchGt-item">
 *       <div class="multi-watchGt-title">HUAWEI Mate 90 Pro Max</div>   <!-- 变体名 -->
 *       <div class="multi-watchGt-cnt">
 *         <div class="multi-watchGt-list part0">
 *           <div class="multi-watchGt-subtitle">运行内存（RAM）</div>
 *           <div class="multi-watchGt-text"><p>12 GB / 16 GB RAM</p></div>
 *           <p class="multi-watchGt-subtext">脚注</p>
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 *   注意：布局 B 的脚注用的是 `multi-watchGt-subtext`（不是 `large-accordion-subtext`）。
 *   只认 large-accordion-* 的话，布局 B 的脚注会作为普通 <p> 被并进字段值，且字段名/值会整体丢失。
 *   布局 B 里同一个字段名会在多个变体块中重复出现（如「尺寸」），键里必须带变体名，否则互相覆盖。
 *
 * 用「有序 token 游走」而不是嵌套正则，保证「字段名 → 紧随其后的值」的邻接关系。
 * 备选分支顺序很重要：脚注类必须排在通用 <p> **之前**。
 */
function parseSpecSections(html) {
  // 只扫规格组件本身：最后一个 <li class="large-accordion__item"> 之后如果没有终点，
  // 收尾章节（包装清单）会把整页 footer（面包屑、页脚导航、免责声明）当成字段值读进来。
  // 终点取组件内第一个 </ul>（手风琴容器结束处）；万一页面结构变了就退回最后一个 </li>。
  let scope = html;
  const start = html.indexOf('product-specification-component');
  if (start >= 0) {
    const lastItemPos = html.lastIndexOf('<li class="large-accordion__item">');
    const ul = lastItemPos >= 0 ? html.indexOf('</ul>', lastItemPos) : -1;
    const li = html.lastIndexOf('</li>');
    const end = ul >= 0 ? ul : li;
    scope = end > start ? html.slice(start, end + 5) : html.slice(start);
  }

  const chunks = scope.split('<li class="large-accordion__item">').slice(1);
  const sections = [];

  const tokenRe = new RegExp(
    [
      // 字段名（两种布局）
      '<div class="(?:large-accordion-subtitle|multi-watchGt-subtitle)[^"]*"[^>]*>([\\s\\S]*?)</div>',
      // 变体名（布局 B 的 multi-watchGt-item 标题）
      '<div class="multi-watchGt-title[^"]*"[^>]*>([\\s\\S]*?)</div>',
      // 脚注（两种布局，必须排在通用 <p> 之前）
      '<(?:p|div) class="(?:large-accordion-subtext|multi-watchGt-subtext)[^"]*"[^>]*>([\\s\\S]*?)</(?:p|div)>',
      // 章节级备注（绝不是字段值）
      '<(?:p|div) class="large-accordion-text[^"]*"[^>]*>([\\s\\S]*?)</(?:p|div)>',
      // 值容器（布局 B：<div class="multi-watchGt-text"><p>…</p></div>）
      '<div class="multi-watchGt-text[^"]*"[^>]*>([\\s\\S]*?)</div>',
      // 普通值
      '<p[^>]*>([\\s\\S]*?)</p>',
      '<img\\b[^>]*>',
    ].join('|'),
    'g'
  );

  for (const chunk of chunks) {
    // 章节名
    const titleM = chunk.match(
      /class="large-accordion__title large-accordion-title"[^>]*>([\s\S]*?)<\/span>/
    );
    if (!titleM) continue;
    const sectionName = text(titleM[1]);
    if (!sectionName) continue;

    const fields = []; // { name, heading, values: string[] }
    const sectionNotes = [];
    let cur = null;
    let heading = null;
    let layouts = { accordion: false, multi: false };

    for (const m of chunk.matchAll(tokenRe)) {
      const [full, subtitle, h, subtext, remark, multiText, p] = m;
      if (subtitle !== undefined) {
        const name = text(subtitle);
        if (!name) continue; // 布局 B 里空 subtitle 表示「字段名就是章节名」
        cur = { name, heading, values: [] };
        fields.push(cur);
        layouts.accordion = true;
      } else if (h !== undefined) {
        const t = text(h);
        heading = t || null;
        cur = null; // 新变体块开始
        layouts.multi = true;
      } else if (subtext !== undefined) {
        const t = text(subtext);
        if (t) sectionNotes.push(t); // 脚注（两种 class）：原文保留，绝不并入字段值
      } else if (remark !== undefined) {
        const t = text(remark);
        if (t) sectionNotes.push(t); // 章节级备注：绝不是字段值
      } else if (multiText !== undefined || p !== undefined) {
        const t = text(multiText !== undefined ? multiText : p);
        if (!t) continue;
        if (!cur) {
          // 没有 subtitle 的字段：字段名退化为章节名（布局 A）或变体名（布局 B）
          cur = { name: sectionName, heading, values: [] };
          fields.push(cur);
          layouts.multi = multiText !== undefined ? true : layouts.multi;
          layouts.accordion = multiText === undefined ? true : layouts.accordion;
        }
        cur.values.push(t);
      } else if (full.startsWith('<img')) {
        /* 图片不是数据 */
      }
    }

    sections.push({
      section: sectionName,
      fields: fields.filter((f) => f.values.length > 0),
      notes: [...new Set(sectionNotes)],
      layout: layouts.multi && layouts.accordion ? 'mixed' : layouts.multi ? 'multi-watchGt' : 'accordion',
    });
  }
  return sections;
}

/**
 * 扁平化成 `章节.字段` → 原文（章节名 == 字段名时只用章节名）；多个值用 ` | ` 连接。
 * 带变体名（布局 B 的 multi-watchGt-item）时键为 `章节@变体` / `章节.字段@变体` ——
 * 同一字段在不同变体下值不同（如典藏版 RAM），只有带上变体名才不会互相覆盖。
 * 同一键在本章节内重复出现（无变体可区分）时追加 `#2`、`#3`，绝不静默丢值。
 */
function flattenSections(sections) {
  const raw = {};
  for (const s of sections) {
    const seen = new Map();
    for (const f of s.fields) {
      const base = f.name === s.section ? s.section : `${s.section}.${f.name}`;
      const key0 = f.heading ? `${base}@${f.heading}` : base;
      const n = (seen.get(key0) || 0) + 1;
      seen.set(key0, n);
      const key = n === 1 ? key0 : `${key0}#${n}`;
      const val = f.values.join(' | ');
      if (!val) continue;
      raw[key] = raw[key] ? `${raw[key]} | ${val}` : val;
    }
    // 章节级脚注进保留命名空间（`_` 前缀 = 非规格页字段），不干扰规范化层
    if (s.notes.length) raw[`_notes.${s.section}`] = s.notes.join(' | ');
  }
  return raw;
}

/** 页面级隐藏 input productJson（含 marketingName / price / productId / relatedProducts） */
function parseProductJson(html) {
  const m = html.match(/name="productJson"\s+value="([\s\S]*?)"\s*\/?>/);
  if (!m) return null;
  try {
    return JSON.parse(decodeEntities(m[1]));
  } catch {
    return null;
  }
}

function pageTitle(html) {
  const m = html.match(/<meta name="title" content="([^"]*)"/);
  return m ? decodeEntities(m[1]).replace(ZERO_WIDTH_RE, '').replace(/\s*规格参数\s*$/, '').trim() : null;
}

/** 是否「已下线」预检响应：title 形如 `301 - HUAWEI nova 13 规格参数` */
function precheckSaysRetired(body) {
  try {
    const j = JSON.parse(body);
    return typeof j.title === 'string' && /^\s*301/.test(j.title.replace(ZERO_WIDTH_RE, ''));
  } catch {
    return false; // 解析不了就不下结论，交给 finalUrl / 章节数护栏
  }
}

function precheckTitle(body) {
  try {
    return JSON.parse(body).title || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 单机型抓取

/** 判断 finalUrl 是否**仍是**目标机型的 specs 页（下线机型会被 301 到 /cn/phones/） */
function finalUrlIsTargetSpecs(finalUrl, slug) {
  const p = normalizeUrl(finalUrl);
  return new RegExp(`^/cn/phones/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/specs/?$`, 'i').test(
    p.replace(BASE, '')
  );
}

/**
 * 抓一个机型。
 * @returns {{product: object|null, skipped: object|null, info: object}}
 */
async function fetchOneModel(entry, cache, notes) {
  const id = entry.id;
  const preUrl = precheckUrlFor(entry.slug);
  const url = entry.specsUrl;
  const info = { slug: entry.slug, precheckTitle: null, httpStatus: null, finalUrl: null, bytes: 0, sections: 0, flatFields: 0, layout: null, fromCache: null };

  // ---- ① 便宜预检（~460 B，不跟随重定向即可判定下线）
  try {
    const pre = await cache.fetch(preUrl, { accept: 'application/json,*/*;q=0.8' });
    info.precheckTitle = precheckTitle(pre.body);
    if (precheckSaysRetired(pre.body)) {
      return {
        product: null,
        skipped: { id, reason: `retired: precheck ${preUrl} title="${info.precheckTitle}" (301 marker, specs withdrawn)` },
        info,
      };
    }
  } catch (e) {
    notes.push(`${id}: precheck failed (${e.message}) — 继续按完整流程校验`);
  }

  // ---- ② 拉 specs 页
  let page;
  try {
    page = await cache.fetch(url);
  } catch (e) {
    return { product: null, skipped: { id, reason: `fetch-failed: ${e.message}` }, info };
  }
  info.httpStatus = page.status;
  info.finalUrl = page.finalUrl;
  info.bytes = page.bytes;
  info.fromCache = page.fromCache;

  if (page.status !== 200) {
    return { product: null, skipped: { id, reason: `http-${page.status}: ${url}` }, info };
  }

  // ---- ③ 护栏一：finalUrl 必须仍是目标 specs 页（301 → /cn/phones/ 时这里会挂）
  if (!finalUrlIsTargetSpecs(page.finalUrl, entry.slug)) {
    return {
      product: null,
      skipped: { id, reason: `retired: finalUrl redirected to ${page.finalUrl} (expected ${stripSlash(url)})` },
      info,
    };
  }

  const sections = parseSpecSections(page.body);
  const raw = flattenSections(sections);
  info.sections = sections.length;
  info.flatFields = Object.keys(raw).length;
  info.layout = sections.some((s) => s.layout !== 'accordion') ? 'accordion+multi-watchGt' : 'accordion';

  // ---- ④ 护栏二：章节数 / 字段数必须像一份真规格页
  if (sections.length === 0) {
    return {
      product: null,
      skipped: { id, reason: `retired-or-markup-changed: HTTP 200 at ${page.finalUrl} but 0 spec sections parsed` },
      info,
    };
  }
  if (sections.length < MIN_SECTIONS || info.flatFields < MIN_FLAT_FIELDS) {
    return {
      product: null,
      skipped: {
        id,
        reason: `implausible-specs: only ${sections.length} sections / ${info.flatFields} fields (min ${MIN_SECTIONS}/${MIN_FLAT_FIELDS}) — markup changed?`,
      },
      info,
    };
  }

  // ---- ⑤ 页面级元数据 + 目录页价格/productId
  const pj = parseProductJson(page.body);
  const nameCandidates = [
    entry.title,
    pj?.marketingName,
    pj?.productName,
    pageTitle(page.body),
  ];
  const name = nameCandidates.map((s) => (s ? text(s) : '')).find((s) => s) || entry.slug;

  const catalogPrice = entry.price;
  const priceFromPage = pj?.price !== undefined && pj?.price !== null && String(pj.price).trim() !== ''
    ? String(pj.price).trim()
    : null;

  raw['_catalog.price'] = catalogPrice ?? (priceFromPage ? `${priceFromPage} (规格页 productJson)` : '');
  raw['_catalog.productId'] = entry.productId || (pj?.productId ? String(pj.productId) : '');
  raw['_catalog.series'] = entry.series || '';
  raw['_catalog.ecProductId'] = entry.ecProductId || (pj?.ecProductId ? String(pj.ecProductId) : '');
  raw['_catalog.buyLink'] = entry.buyLink || pj?.buyButtonMode?.thirdPartySiteLink || '';
  raw['_catalog.catalogUrl'] = entry.catalogUrl;
  raw['_catalog.label'] = entry.label || '';
  raw['_catalog.seriesSubtitle'] = entry.seriesSubtitle || '';
  raw['_source.finalUrl'] = page.finalUrl;
  raw['_source.fromCache'] = page.fromCache ? 'true' : 'false';
  raw['_source.httpStatus'] = String(page.status);
  // 去掉值的空串占位（契约：拿不到就不要写进来）
  for (const k of Object.keys(raw)) if (!raw[k]) delete raw[k];

  const product = {
    id,
    brand: 'huawei',
    name,
    specsUrl: url,
    raw,
    extractedAt: new Date().toISOString(),
  };
  return { product, skipped: null, info };
}

// ---------------------------------------------------------------- 主流程

/**
 * 抓取全部在售华为手机规格。
 * @param {object} [options]
 * @param {string} [options.cacheDir] 缓存目录（默认 _work/huawei.cache）
 * @param {boolean} [options.offline] 只用缓存
 * @param {string[]} [options.only] 只跑这些 slug
 * @param {number} [options.limit] 最多跑几个机型
 * @param {(msg:string)=>void} [options.log]
 * @returns {Promise<import('./types.ts').SourceResult & { catalog?: object }>}
 */
export async function fetchAll(options = {}) {
  const {
    cacheDir = DEFAULT_CACHE_DIR,
    offline = false,
    only = null,
    limit = null,
    log = () => {},
  } = options;

  const started = Date.now();
  const notes = [];
  const skipped = [];
  const products = [];
  const diagnostics = [];

  const cache = new HttpCache(cacheDir, { offline });

  // ---- 目录
  log(`[catalog] ${CATALOG_URL}`);
  const catPage = await cache.fetch(CATALOG_URL);
  if (catPage.status !== 200) throw new Error(`catalog HTTP ${catPage.status}`);
  const { entries: allEntries, seriesSummaries, skipped: catalogSkipped } = parseCatalog(
    extractCatalogConfig(catPage.body),
    CATALOG_URL
  );
  skipped.push(...catalogSkipped);

  notes.push(
    `catalog: ${allEntries.length} 手机机型 / ${seriesSummaries.length} 系列 ` +
      `(${seriesSummaries.map((s) => `${s.series}=${s.count}`).join(', ')})` +
      `；非手机目录条目 ${catalogSkipped.length} 个` +
      `；目录页含价格 ${allEntries.filter((e) => e.price).length} 个`
  );

  let queue = allEntries;
  if (only && only.length) {
    const want = new Set(only);
    queue = queue.filter((e) => want.has(e.slug));
    notes.push(`--only 过滤：${queue.length}/${allEntries.length} 个机型`);
  }
  if (limit) queue = queue.slice(0, limit);

  // ---- 逐机型（串行）
  for (const entry of queue) {
    process.stdout.write?.(`  → ${entry.slug} ... `);
    let r;
    try {
      r = await fetchOneModel(entry, cache, notes);
    } catch (e) {
      r = { product: null, skipped: { id: entry.id, reason: `unexpected: ${e.message}` }, info: { slug: entry.slug } };
    }
    if (r.product) {
      products.push(r.product);
      log(`ok  sections=${r.info.sections} fields=${r.info.flatFields} name="${r.product.name}"`);
    } else {
      skipped.push(r.skipped);
      log(`SKIP  ${r.skipped.reason}`);
      notes.push(`${entry.id} skipped: ${r.skipped.reason}`);
    }
    diagnostics.push({
      slug: entry.slug,
      series: entry.series,
      price: entry.price,
      productId: entry.productId,
      ok: !!r.product,
      sections: r.info.sections ?? 0,
      flatFields: r.info.flatFields ?? 0,
      layout: r.info.layout ?? null,
      httpStatus: r.info.httpStatus ?? null,
      precheckTitle: r.info.precheckTitle ?? null,
      fromCache: r.info.fromCache ?? null,
      reason: r.skipped?.reason || null,
    });
  }

  // ---- 覆盖度校验：总数守恒，绝不静默丢机型（--only/--limit 属于人为取子集，不算不守恒）
  const subset = queue.length !== allEntries.length;
  const accounted = products.length + skipped.length;
  if (accounted !== queue.length) {
    notes.push(
      `⚠ 覆盖度不守恒：products(${products.length}) + skipped(${skipped.length}) = ${accounted} ≠ 本次应抓机型数 ${queue.length}`
    );
  } else if (subset) {
    notes.push(`本次为子集运行（${queue.length}/${allEntries.length}），未跑到的机型不在 products/skipped 中`);
  }

  const durations = diagnostics.filter((d) => d.ok);
  const fieldCounts = durations.map((d) => d.flatFields);
  const multiLayout = durations.filter((d) => d.layout && d.layout !== 'accordion');
  notes.push(
    `抓取完成：${products.length} 款成功 / ${skipped.length} 条跳过记录；` +
      `扁平字段（含 _catalog./_notes./_source.）区间 ${Math.min(...fieldCounts)}–${Math.max(...fieldCounts)}；` +
      `布局 B（multi-watchGt 变体块）机型 ${multiLayout.length} 款：${multiLayout.map((d) => d.slug).join(', ') || '无'}；` +
      `网络请求 ${netRequests} 次，缓存命中 ${cache.hits} / 未命中 ${cache.misses}；` +
      `耗时 ${((Date.now() - started) / 1000).toFixed(1)}s；请求间隔 ${DELAY_MS}ms 串行，超时 ${TIMEOUT_MS / 1000}s，重试 ${RETRIES} 次`
  );

  return {
    source: 'huawei-official',
    fetchedAt: new Date().toISOString(),
    notes,
    skipped,
    products,
    // 便于 --out 落盘后自查（不属于 SourceResult 契约，规范化层可忽略）
    catalog: {
      catalogUrl: CATALOG_URL,
      series: seriesSummaries,
      productCount: allEntries.length,
      skippedCount: skipped.length,
      fetchedCount: products.length,
      diagnostics,
    },
  };
}

// ---------------------------------------------------------------- CLI

function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') out.offline = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--json') out.json = true;
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--cache') out.cache = argv[++i];
    else if (a === '--only') out.only = (out.only || []).concat(argv[++i].split(','));
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a.startsWith('--out=')) out.out = a.slice(6);
    else if (a.startsWith('--cache=')) out.cache = a.slice(8);
    else if (a.startsWith('--only=')) out.only = (out.only || []).concat(a.slice(7).split(','));
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
    else out._.push(a);
  }
  return out;
}

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

async function main() {
  const args = parseArgv(process.argv.slice(2));
  const cacheDir = resolvePath(args.cache || DEFAULT_CACHE_DIR);
  const outPath = resolvePath(args.out || DEFAULT_OUT);
  const t0 = Date.now();

  const log = args.quiet ? () => {} : (m) => process.stdout.write(`  ${m}\n`);

  console.log(`华为官方规格适配器 · 目录 ${CATALOG_URL}`);
  console.log(`  缓存: ${cacheDir}${args.offline ? '  [offline]' : ''}`);

  const result = await fetchAll({
    cacheDir,
    offline: !!args.offline,
    only: args.only || null,
    limit: Number.isFinite(args.limit) ? args.limit : null,
    log,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  const json = JSON.stringify(result);
  console.log(`\n写入 ${outPath}  (${(Buffer.byteLength(json, 'utf8') / 1024).toFixed(1)} KB, ${result.products.length} 机型)`);

  if (args.json) console.log(JSON.stringify(result, null, 2));

  // ---------------- 自检报告
  const cat = result.catalog;
  console.log('\n' + '='.repeat(86));
  console.log(
    `目录机型 ${cat.productCount} = 抓到 ${cat.fetchedCount} + 跳过 ${cat.skippedCount}` +
      (cat.fetchedCount + cat.skippedCount === cat.productCount ? '  ✅守恒' : '  ❌不守恒')
  );
  for (const s of cat.series) console.log(`  ${s.series.padEnd(10)} ${s.subtitle.padEnd(8)} ${s.count} 条`);
  console.log(
    `价格覆盖: ${cat.diagnostics.filter((d) => d.ok && d.price).length}/${cat.fetchedCount} 款有目录价` +
      `（目录中无价的机型: ${cat.diagnostics.filter((d) => !d.price).map((d) => d.slug).join(', ') || '无'}）`
  );

  console.log('\n-- 抓到的机型（章节/扁平字段） ' + '-'.repeat(48));
  for (const d of cat.diagnostics) {
    if (!d.ok) continue;
    console.log(
      `  ${d.slug.padEnd(28)} ${String(d.sections).padStart(2)} 章节  ${String(d.flatFields).padStart(3)} 字段  ` +
        `¥${(d.price || '—').padEnd(6)} ${d.layout === 'accordion' ? '' : '[布局B] '}${d.fromCache ? '(cache)' : ''}`
    );
  }

  if (result.skipped.length) {
    console.log('\n-- 跳过 ' + '-'.repeat(74));
    for (const s of result.skipped) console.log(`  ${s.id.padEnd(42)} ${s.reason}`);
  }

  const fields = new Set();
  for (const p of result.products) for (const k of Object.keys(p.raw)) fields.add(k);
  console.log(`\n字段并集: ${fields.size} 种键；样例(mate90-pro) 3 条:`);
  const bm = result.products.find((p) => p.id === 'huawei-mate90-pro') || result.products[0];
  if (bm) {
    for (const k of ['尺寸与重量.厚度', '处理器', '电池']) {
      if (bm.raw[k]) console.log(`  "${k}" = ${JSON.stringify(bm.raw[k])}`);
    }
    console.log(`  章节数 keys with '.' prefix 分布: ${Object.keys(bm.raw).length} 个键`);
  }
  console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('='.repeat(86));

  for (const n of result.notes) console.log(`note: ${n}`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
  });
}
