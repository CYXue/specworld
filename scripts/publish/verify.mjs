/**
 * 对照参考项目「AI 大模型世界」做发布封装：
 *   1. 把 _work/site 复制成自包含发布目录 dist/
 *   2. 每个页面注入 <base>（相对路径发布时浏览器自动补全）
 *   3. 校验：所有页面自包含（无外链、无行为脚本）、所有 <a> 指向的本地文件都存在
 * 用法：node scripts/publish/verify.mjs
 */
import { readFileSync, writeFileSync, existsSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { BRAND_IDS } from '../brands.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, '_work/site');
const DIST = join(ROOT, 'dist');

if (!existsSync(SRC)) {
  console.error(`❌ 源目录不存在：${SRC}，先跑 node scripts/site/build.mjs`);
  process.exit(1);
}

/* 1) 复制成 dist */
cpSync(SRC, DIST, { recursive: true, force: true });
console.log(`已复制 ${SRC} → ${DIST}`);

/* 收集所有 html */
const htmls = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const full = join(d, f);
    if (statSync(full).isDirectory()) walk(full);
    else if (f.endsWith('.html')) htmls.push(full);
  }
})(DIST);
console.log(`共 ${htmls.length} 个 HTML 页面，开始校验…`);

/* 2) 注入 <base> */
let injected = 0;
for (const f of htmls) {
  const html = readFileSync(f, 'utf8');
  if (html.includes('<base')) continue;
  const fixed = html.replace(/<head([^>]*)>/, `<head$1>\n<base href="./">`);
  if (fixed !== html) {
    writeFileSync(f, fixed, 'utf8');
    injected++;
  }
}
console.log(`已注入 <base> 的页面: ${injected} 个`);

/* 3–5a) 单次遍历：外链 / 内联脚本 / 本地死链 / 「—」冒充数据，三类检查同轮完成。
 * 原实现把 76 个 HTML 读了三遍（外链一遍、死链一遍、内容纪律一遍）；合并后只读一遍，
 * I/O 量直接砍掉 2/3（n 小无所谓，但顺手即省）。
 *
 * 纪律（与旧实现一致，照抄不丢）：
 *   - 允许页面内联 <script>，禁止 <script src="...">——任何指向外部文件的脚本引用
 *     都会让页面在离线/内网环境失效。判定方式：src 属性里出现 http(s):// 或 .js 就算外部依赖。
 *   - 「—」不得冒充数据：空值只能显示「官方未公布」，能力条空位才允许用「—」。
 */

/* 5b. 关键页面必须存在（防止某次重构漏产出），不依赖读页面内容，故放在遍历之外 */
const REQUIRED_PAGES = [
  'index.html', 'categories.html', 'rankings.html', 'brands.html',
  'timeline.html', 'all.html',
  'brand/apple.html', 'brand/huawei.html',
];
const contentIssues = [];
const missingPages = REQUIRED_PAGES.filter((rel) => !existsSync(join(DIST, rel)));
if (missingPages.length) contentIssues.push(`缺少关键页面：${missingPages.join(', ')}`);

let extLinks = 0;
let extScripts = 0;
let inlineScripts = 0;
let brokenLinks = 0;
const missing = [];
for (const f of htmls) {
  const html = readFileSync(f, 'utf8');
  const relDir = dirname(f);
  const rel = f.slice(DIST.length + 1).split('\\').join('/');

  // 3) 外链 + 内联脚本体检
  extLinks += (html.match(/(?:href|src)=["'](https?:\/\/[^"']+)["']/g) ?? []).length;
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1].trim();
    // 带 src 的一律算外部依赖（哪怕是相对路径的本地 .js，页面也就不再自包含了）
    if (/\bsrc\s*=/i.test(attrs)) extScripts++;
    else if (!/type="application\/json"/i.test(attrs)) inlineScripts++;
  }

  // 4) 本地 <a> / <svg> 死链
  const targets = [
    ...[...html.matchAll(/href=["']([^"'#]+\.html)["']/g)].map((m) => m[1]),
    ...[...html.matchAll(/(?:href|src)=["']([^"'#]+\.svg)["']/g)].map((m) => m[1]),
  ];
  for (const t of targets) {
    if (t.startsWith('http')) continue;
    const abs = resolve(relDir, t);
    if (!existsSync(abs)) {
      brokenLinks++;
      missing.push(`${f} → ${t}`);
    }
  }

  // 5a) 「—」冒充数据
  const dashCells = [...html.matchAll(/<td[^>]*>\s*—\s*<\/td>/g)].length;
  if (dashCells) contentIssues.push(`${rel} 有 ${dashCells} 个表格单元格用「—」占位（应写「官方未公布」）`);
}
console.log(
  `外链引用: ${extLinks} 处 / 内联 <script>: ${inlineScripts} 个 / 外部依赖 <script src>: ${extScripts} 个`
);
console.log(`失效本地链接: ${brokenLinks} 处`);
if (missing.length) {
  for (const x of missing.slice(0, 10)) console.log(`  ❌ ${x}`);
}

/* 6) 数据快照 + 指纹（参考项目 toy 的等价物：指纹用于自动发布去重） */
const dataPath = join(ROOT, 'data/products.json');
const p = JSON.parse(readFileSync(dataPath, 'utf8'));
const products = p.products ?? p;
const compareDir = join(DIST, 'compare');
const compareFiles = existsSync(compareDir) ? readdirSync(compareDir).filter((f) => f.endsWith('.html')) : [];

const allText = htmls.map((f) => readFileSync(f, 'utf8')).join('\n');
const fingerprint = createHash('sha256').update(allText).digest('hex').slice(0, 16);

const manifest = {
  publishedAt: new Date().toISOString(),
  fingerprint,
  pageCount: htmls.length,
  products: {
    total: products.length,
    generatedAt: p.generatedAt ?? null,
    ...Object.fromEntries(BRAND_IDS.map((id) => [id, products.filter((x) => x.brand === id).length])),
  },
  comparePairs: compareFiles,
  selfContained: extLinks === 0 && extScripts === 0 && brokenLinks === 0,
  inlineScripts,
  brokenLinks,
  contentIssues,
};
writeFileSync(join(DIST, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`已写发布清单 dist/manifest.json`);
console.log(`  机型 ${manifest.products.total} 台（苹果 ${manifest.products.apple} / 华为 ${manifest.products.huawei}），对比页 ${compareFiles.length} 张，指纹 ${fingerprint}`);
if (contentIssues.length) {
  console.log(`内容纪律问题 ${contentIssues.length} 处：`);
  for (const x of contentIssues.slice(0, 12)) console.log(`  ❌ ${x}`);
}

const allGreen = manifest.selfContained && contentIssues.length === 0;
if (allGreen) {
  console.log(`✅ 发布校验通过：${htmls.length} 页全部自包含、零外链、零外部脚本、零失效链接、内容纪律无问题`);
} else {
  console.log(
    `⚠️ 发布校验未全绿：外链 ${extLinks} / 外部脚本 ${extScripts} / 失效链接 ${brokenLinks} / 内容问题 ${contentIssues.length}`
  );
  process.exitCode = 1;
}
