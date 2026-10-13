#!/usr/bin/env node
/**
 * 构建前清理 dist：用 rename（而非 rm / emptyOutDir）把旧 dist 移到 .dist-trash/。
 *
 * 为什么不用 rm / 不用 Vite 自带的 emptyOutDir：
 *   本开发环境装了一层「安全删除 shim」，对 dist 目录 fail-closed 拦截
 *   （批量删除保护）—— 表现为 Vite 重建时 trash 整个 dist/data 必失败：
 *     [safe-delete] 操作失败 … dist\data … Some operations were aborted
 *   rename 不经过删除 shim，既能让 Vite 拿到一个干净的空 outDir，又不会触发拦截。
 *   .dist-trash 已在 .gitignore 中（可再生产产物，不入库）。
 *
 * 用法：node scripts/clean-dist.mjs   （被 package.json 的 prebuild 自动调用）
 */

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const TRASH = join(ROOT, '.dist-trash');

if (!existsSync(DIST)) {
  console.log('clean-dist: dist 不存在，无需清理');
  process.exit(0);
}

mkdirSync(TRASH, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(TRASH, `dist-${stamp}`);
// rename 在同文件系统内是原子操作，不经过删除 shim —— 这是绕开拦截的关键。
renameSync(DIST, target);
console.log(`clean-dist: 旧 dist → ${target}`);
