#!/usr/bin/env node
/**
 * Vite 产物的发布闸门：dist/ 能不能真的挂上去。
 *
 * 为什么单独写一个，而不用旧的 scripts/publish/verify.mjs
 * --------------------------------------------------
 * 旧闸门（脚本已于 2026-10-04 随 Vite 迁移一并清理移除）是给「mjs 手写模板生成的多页
 * HTML」设计的，它校验三样东西：
 * 关键页面清单（brand/apple.html 等 8 个固定路径）、跨页 <a href="*.html"> 死链、
 * 表格里的「—」占位。前两样在 SPA 里不存在了 —— Vite 只产出一个 index.html，
 * 路由交给 vue-router 的 hash 模式，页面由 JS 在运行时生成，磁盘上没有 brand/apple.html。
 * 硬套旧清单会天天报「缺少关键页面」，等于把闸门养成摆设 —— 那比没有闸门更糟。
 *
 * 真正的风险换了一批，换成四条
 * ----------------------------
 * 1. **入口存在**：dist/index.html 必须有。这是唯一的入口，缺了就是白屏。
 * 2. **零绝对路径**：Toy 挂在 /toy/<slug>/ 下，GitHub Pages 挂在 /<repo>/ 下，
 *    任何 /assets/xxx.js 都会 404。base:'./' 是 vite.config.ts 里的硬约束，
 *    但产物才是判据 —— 这里逐个引用核对，而不是相信配置。
 * 3. **零外部资源引用**：平台整改口径要求包内自包含。外链字体/脚本/图片一律不允许。
 *    注意 @font-face 里的 url() 也要查 —— 它藏在 CSS 里，扫 HTML 抓不到。
 * 4. **体积在平台上限内**：50 MB。超了上传直接被拒。
 *
 * 除此之外还顺手核对数据与精灵是否真被打进去了：prebuild 若忘了跑，
 * 站点能打开但一屏空白，这是最容易被误判成「渲染坏了」的一类失败，
 * 让闸门直接把它喊出来。
 *
 * 失败即非零退出 —— 和管线同一条纪律：宁可停在构建阶段，不要把坏产物发出去。
 *
 * 用法：node scripts/publish/verify-dist.mjs   （npm run build 的 postbuild 自动跑）
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(ROOT, 'dist');
/** 平台包体积上限：50 MB */
const MAX_BYTES = 50 * 1024 * 1024;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('❌ 找不到 dist/index.html —— 先跑 npm run build');
  process.exit(1);
}

/* ---------- 收集 dist 全部文件与总体积 ---------- */
const files = [];
let bytes = 0;
(function walk(d) {
  for (const name of readdirSync(d).sort()) {
    const p = join(d, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else {
      files.push(p);
      bytes += st.size;
    }
  }
})(DIST);

const relOf = (p) => relative(ROOT, p).split('\\').join('/');
const issues = [];
const note = (m) => issues.push(m);

/* ---------- 1. 入口脚本真的被打进来了 ---------- */
// Vite 产物里入口是 index.html 引用的那个 .js。抓出来是为了确认
// 「index.html 存在」不等于「应用存在」—— 手工拼的壳也能通过前者。
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const entryMatch = html.match(/<script[^>]*\ssrc=["']([^"']+)["']/i);
if (!entryMatch) {
  note('index.html 里没有 <script src> —— 入口应用没被打进去，打开会是空白页');
}

/* ---------- 2. 引用全部相对、且文件真实存在 ---------- */
const cssFiles = files.filter((f) => f.endsWith('.css'));
const scanTargets = [...files.filter((f) => f.endsWith('.html')), ...cssFiles];

const isExternal = (u) => /^(https?:)?\/\//i.test(u) || /^data:/i.test(u);
/** 站内允许的绝对写法只有一种：协议相对的资源地址在 Toy 上也不允许，这里一律排除 */
const isAbsolute = (u) => u.startsWith('/') && !u.startsWith('//');

let extRefs = 0;
let absRefs = 0;
let missingRefs = 0;
const refSamples = [];

for (const f of scanTargets) {
  const text = readFileSync(f, 'utf8');
  const dir = dirname(f);
  // href/src 拿全部，CSS 里的 url() 单独拿（@font-face 的字体地址就藏在这里）
  const refs = [
    ...[...text.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
    ...[...text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((m) => m[1]),
  ];
  for (const raw of refs) {
    const u = raw.trim();
    if (!u || u.startsWith('#') || u.startsWith('data:')) continue;

    if (isExternal(u)) {
      extRefs++;
      if (refSamples.length < 8) refSamples.push(`外部引用 ${relOf(f)} → ${u}`);
      continue;
    }
    if (isAbsolute(u)) {
      absRefs++;
      if (refSamples.length < 8) refSamples.push(`绝对路径 ${relOf(f)} → ${u}`);
      continue;
    }
    // 相对引用必须能在产物里找到对应文件
    const abs = resolve(dir, u);
    if (!existsSync(abs)) {
      missingRefs++;
      if (refSamples.length < 8) refSamples.push(`失效引用 ${relOf(f)} → ${u}`);
    }
  }
}

if (extRefs) note(`产物里有 ${extRefs} 处外部资源引用（平台要求包内自包含）`);
if (absRefs) note(`产物里有 ${absRefs} 处绝对路径引用（挂在 /toy/<slug>/ 或 /<repo>/ 下会 404）`);
if (missingRefs) note(`产物里有 ${missingRefs} 处指向不存在文件的引用`);

/* ---------- 3. 数据与精灵确实在产物里 ---------- */
// prebuild（scripts/sync-public.mjs）没跑时的典型症状：站点能开、一屏空白。
// 在这里喊出来，比上线后被人问「为什么是空的」划算得多。
const hasData = files.some((f) => relOf(f) === 'dist/data/products.json');
const spriteCount = files.filter((f) => relOf(f).startsWith('dist/sprites/')).length;
if (!hasData) {
  note(
    'dist/data/products.json 不存在 —— prebuild 没跑或 public/ 是空的，跑一次 node scripts/sync-public.mjs',
  );
}
if (spriteCount === 0) {
  note('dist/sprites/ 为空 —— 跑一次 node scripts/sprite/generate.mjs 生成立绘');
}

/* ---------- 4. 体积 ---------- */
const mb = bytes / 1024 / 1024;
if (bytes > MAX_BYTES) note(`产物 ${mb.toFixed(1)} MB，超过平台 50 MB 上限`);

/* ---------- 汇总 ---------- */
const htmlCount = files.filter((f) => f.endsWith('.html')).length;
const ok = issues.length === 0;

const manifest = {
  publishedAt: new Date().toISOString(),
  // 与旧闸门的 manifest 字段名保持一致，CI 里读它的地方不用改
  pageCount: htmlCount,
  bytes,
  entry: entryMatch ? entryMatch[1] : null,
  externalRefs: extRefs,
  absoluteRefs: absRefs,
  missingRefs,
  sprites: spriteCount,
  selfContained: extRefs === 0 && absRefs === 0 && missingRefs === 0,
  issues,
};
writeFileSync(join(DIST, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(
  `产物 ${files.length} 个文件 / ${mb.toFixed(2)} MB · 精灵 ${spriteCount} 张 · HTML ${htmlCount} 个`,
);
console.log(`引用体检：外部 ${extRefs} · 绝对路径 ${absRefs} · 失效 ${missingRefs}`);
if (refSamples.length) for (const s of refSamples) console.log(`  ${s}`);

if (ok) {
  console.log('✅ 发布校验通过：入口存在、引用全相对、零外链、包体在限内、数据与精灵齐备');
} else {
  console.error(`❌ 发布校验未通过，共 ${issues.length} 处：`);
  for (const x of issues) console.error(`  ❌ ${x}`);
  process.exit(1);
}
