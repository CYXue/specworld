#!/usr/bin/env node
/**
 * 打包：把 dist/ 装进 .toy-pkg/，并把这一版的指纹写进包根。
 *
 * 为什么要往包里写指纹
 * --------------------
 * Toy 平台上的那一版就是「上次发布」的记录。把指纹放进包根，将来无论从平台下载
 * 还是从仓库里翻，都能读出线上那一版是什么内容 —— 这是 should-publish 判断
 * 「有没有变」的基准。仓库里同时存一份 data/.toy-release.json，两边语义一致。
 *
 * 用法
 * ----
 *   node scripts/publish/pack.mjs
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, rmSync, statSync,
} from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compute } from './fingerprint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const DIST = join(ROOT, 'dist');
const PKG = join(ROOT, '.toy-pkg');
const RELEASE_FILE = join(ROOT, 'data/.toy-release.json');

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('❌ dist/index.html 不存在，先跑 node scripts/pipeline.mjs');
  process.exit(1);
}

/* ---------------- 1. 重建包目录 ---------------- */
rmSync(PKG, { recursive: true, force: true });
mkdirSync(PKG, { recursive: true });
cpSync(DIST, PKG, { recursive: true });

/* ---------------- 2. 写发布记录到包根 ---------------- */
const fp = compute();
const record = {
  siteFingerprint: fp.siteFingerprint,
  dataFingerprint: fp.dataFingerprint,
  products: fp.stats.products,
  byBrand: fp.stats.byBrand,
  packedAt: new Date().toISOString(),
};
writeFileSync(join(PKG, 'toy-release.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');

/* ---------------- 3. 统计与自检 ---------------- */
/** 递归列出所有文件（相对包根），用于统计与校验 */
function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

const files = walk(PKG);
const bytes = files.reduce((a, f) => a + statSync(join(PKG, f)).size, 0);

console.log(`包已就绪：${PKG}`);
console.log(`  ${files.length} 个文件 · ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`  站点指纹 ${record.siteFingerprint} · 机型 ${record.products} 台`);
console.log(`  发布记录已写入包根 toy-release.json`);

/* 发版前的最后一道自检：这些条件坏了，送上去也是被驳回 */
const problems = [];
if (!files.includes('index.html')) problems.push('缺少入口 index.html');

// Toy 平台要求包内不得指向站外资源；站点本来就是零外链，这里复验一次
const external = [];
for (const f of files.filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(PKG, f), 'utf8');
  const m = html.match(/(?:href|src)=["'](https?:\/\/[^"']+)["']/g) ?? [];
  if (m.length) external.push(`${f}: ${m.length} 处`);
}
if (external.length) {
  problems.push(`包内存在外链引用（Toy 整改口径要求零外链）：\n    ${external.slice(0, 5).join('\n    ')}`);
}

if (problems.length) {
  console.error('\n❌ 打包自检未通过：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✅ 打包自检通过：入口存在、零外链');

/* ---------------- 4. 仓库内同步一份记录 ---------------- */
// 只在 --mark-released 时写，而且**只写文件不提交**，提交是 workflow 的事。
//
// 为什么不能打包时就顺手写：一旦送审失败或被驳回，这份记录却已经推进了，
// 后面真正该送的版本会被 should-publish 判成「无变化」而永远送不出去。
// 所以推进记录的时机必须晚于「平台确认收下这一版」。
if (argv.includes('--mark-released')) {
  writeFileSync(RELEASE_FILE, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`\n已推进 data/.toy-release.json → ${record.siteFingerprint}（送审成功后由 workflow 提交入库）`);
} else {
  console.log('\n（未推进仓库记录：加 --mark-released 才会写 data/.toy-release.json）');
}
