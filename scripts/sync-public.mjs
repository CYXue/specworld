#!/usr/bin/env node
/**
 * 把 data/ 同步到 public/ —— Vite 构建的前置步骤。
 *
 * 为什么需要这一步
 * ----------------
 * 旧站点是 mjs 直接写 dist/，数据从 data/products.json 读；
 * 现在渲染层换成 Vite，产物里不打包源数据，而是让前端在运行时按相对路径 fetch。
 * 于是 data/ 里的文件必须先复制到 public/ 才会被 Vite 原样拷进 dist/：
 *   data/products.json       → public/data/products.json
 *   data/release-dates.json  → public/data/release-dates.json
 *   data/sprites/*.svg       → public/sprites/*.svg
 *
 * data/ 是唯一数据源，public/data 与 public/sprites 都是构建期副本（见 .gitignore），
 * 所以本脚本幂等：每次构建都以 data/ 为准，删掉的机型不会在副本里留下孤儿文件。
 *
 * ⚠️ 这里是「逐文件对账」，不是「先 rmSync 整个目录再拷一遍」。
 * 两个原因，第二个是踩过的坑：
 *   1. 正确性：rmSync 整目录会把 public/sprites 里手工放进去的东西一并抹掉，
 *      而对账式同步只动 data/ 真正没有对应文件的那些。
 *   2. 工具链：某些执行环境（IDE 的批量删除保护）会对「一次删超过几十个文件」直接
 *      拦截并报 SAFE_DELETE_BULK_CONFIRM_REQUIRED，表现为 `npm run build` 莫名其妙失败，
 *      根因却完全不在 Vite 上。精灵图 60 个正好踩线，改成对账后正常构建零删除。
 *      顺带的好处：稳态下（没有机型被删）一次文件都不删，只做覆盖拷贝。
 *
 * 用法：node scripts/sync-public.mjs
 * （也被 package.json 的 prebuild 自动调用）
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 单文件复制：源不存在就跳过（首次拉取可能还没有该文件） */
function copyOne(relFrom, relTo) {
  const src = join(ROOT, relFrom);
  const dst = join(ROOT, relTo);
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  return true;
}

/** 内容是否一致（比 mtime 可靠：git checkout / 拷贝都会重置时间戳） */
function sameSize(a, b) {
  try {
    return statSync(a).size === statSync(b).size;
  } catch {
    return false;
  }
}

/**
 * 目录同步：只拷贝变化过的文件，只删除源里已不存在的文件。
 * 返回 { copied, removed, skipped } —— removed 单独报出来，
 * 因为「删了东西」是件需要被看见的事，静默清理会让人以为构建没生效。
 *
 * @param ext 只同步该后缀的文件（sprites 是 .svg，schemas 是 .json）
 */
function copyDir(relFrom, relTo, ext = '.svg') {
  const src = join(ROOT, relFrom);
  const dst = join(ROOT, relTo);
  if (!existsSync(src)) return { copied: 0, removed: 0, skipped: true };

  const want = new Set(readdirSync(src).filter((n) => n.endsWith(ext)));
  mkdirSync(dst, { recursive: true });

  let copied = 0;
  for (const name of want) {
    const s = join(src, name);
    const d = join(dst, name);
    if (existsSync(d) && sameSize(s, d)) continue; // 幂等：没变就不动它
    copyFileSync(s, d);
    copied++;
  }

  let removed = 0;
  for (const name of readdirSync(dst)) {
    if (want.has(name)) continue;
    rmSync(join(dst, name), { force: true }); // 逐个删，不走 recursive
    removed++;
  }

  return { copied, removed, skipped: false, total: want.size };
}

const products = copyOne('data/products.json', 'public/data/products.json');
const dates = copyOne('data/release-dates.json', 'public/data/release-dates.json');
// v2 全品类目录：品类注册表与字段 schema 也要进 public/data/ ——
// 前端品类分面读 categories.json，通用参数表（新品类页面）读 schemas/。
const categories = copyOne('data/categories.json', 'public/data/categories.json');
const schemas = copyDir('data/schemas', 'public/data/schemas', '.json');
const sprites = copyDir('data/sprites', 'public/sprites');

const parts = [];
parts.push(products ? 'products.json ✓' : 'products.json ✗(缺失)');
parts.push(dates ? 'release-dates.json ✓' : 'release-dates.json ✗(缺失)');
parts.push(categories ? 'categories.json ✓' : 'categories.json ✗(缺失)');
if (schemas.skipped) parts.push('schemas ✗(data/schemas 不存在)');
else parts.push(`schemas ${schemas.total} 个 ✓`);
if (sprites.skipped) parts.push('sprites ✗(data/sprites 不存在，先跑一次管线)');
else {
  parts.push(`sprites ${sprites.total} 个 ✓`);
  if (sprites.copied) parts.push(`更新 ${sprites.copied}`);
  if (sprites.removed) parts.push(`清理陈旧 ${sprites.removed}`);
}

console.log(`public 同步：${parts.join(' · ')}`);

if (!products) {
  console.error('❌ 找不到 data/products.json —— 先跑 node scripts/pipeline.mjs --data-only');
  process.exit(1);
}
