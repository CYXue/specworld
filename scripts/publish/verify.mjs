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

/* 3) 外链 + 行为脚本检查 */
let extLinks = 0;
let scripts = 0;
for (const f of htmls) {
  const html = readFileSync(f, 'utf8');
  extLinks += (html.match(/(?:href|src)=["'](https?:\/\/[^"']+)["']/g) ?? []).length;
  const exec = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1].trim()).filter((s) => !/type="application\/json"/i.test(s));
  scripts += exec.length;
}
console.log(`外链引用: ${extLinks} 处 / 可执行 <script>: ${scripts} 个`);

/* 4) 本地 <a> / <svg> 检查：指向的相对文件必须存在 */
let brokenLinks = 0;
const missing = [];
for (const f of htmls) {
  const html = readFileSync(f, 'utf8');
  const relDir = dirname(f);
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
}
console.log(`失效本地链接: ${brokenLinks} 处`);
if (missing.length) {
  for (const x of missing.slice(0, 10)) console.log(`  ❌ ${x}`);
}

/* 5) 数据快照 + 指纹（参考项目 toy 的等价物：指纹用于自动发布去重） */
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
    apple: products.filter((x) => x.brand === 'apple').length,
    huawei: products.filter((x) => x.brand === 'huawei').length,
  },
  comparePairs: compareFiles,
  selfContained: extLinks === 0 && scripts === 0 && brokenLinks === 0,
  brokenLinks,
};
writeFileSync(join(DIST, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`已写发布清单 dist/manifest.json`);
console.log(`  机型 ${manifest.products.total} 台（苹果 ${manifest.products.apple} / 华为 ${manifest.products.huawei}），对比页 ${compareFiles.length} 张，指纹 ${fingerprint}`);

if (manifest.selfContained) {
  console.log('✅ 发布校验通过：全自包含、无外链、无行为脚本、无失效链接');
} else {
  console.log(`⚠️ 发布校验未全绿：外链 ${extLinks} / 失效链接 ${brokenLinks}`);
  process.exitCode = 1;
}
