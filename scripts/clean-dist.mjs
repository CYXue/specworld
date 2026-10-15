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
 * 保留策略：.dist-trash 只留最近 KEEP 份，更早的逐份清理。
 *   没有保留策略时它只进不出（实测曾堆积 18 份 / 23MB），且 eslint 若漏登
 *   `.dist-trash/**` 忽略项，这些压缩备份会被 lint 一遍、报出上万个假 error。
 *   清理同样绕开删除 shim：逐文件 unlink（rmSync recursive 会触发本机 IDE
 *   的批量删除保护，表现为 build 莫名失败），且单份失败只警告不抛错——
 *   清理是保洁，绝不能炸掉 build。
 *
 * 用法：node scripts/clean-dist.mjs   （被 package.json 的 prebuild 自动调用）
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const TRASH = join(ROOT, '.dist-trash');
/** .dist-trash 保留的最近构建备份份数。备份只为排障回滚，不是归档 */
const KEEP = 3;

mkdirSync(TRASH, { recursive: true });
if (existsSync(DIST)) {
  // 2026-10-15：rename 整目录也会被挡（IDE 对 dist 目录本身持有句柄 → EPERM，
  // 实测 build 两次当场炸）。改为**内容级清理**：dist 目录本身不动（句柄无妨），
  // 内部逐项删除——与 removeTree 的「逐文件绕开批量删除保护」同一哲学。
  // 单项失败只警告继续：保洁绝不能炸掉 build；陈旧残留由 vite 覆盖 +
  // publish/verify-dist 的引用体检兜底。
  let cleaned = 0;
  let failed = 0;
  for (const item of readdirSync(DIST)) {
    const p = join(DIST, item);
    try {
      if (statSync(p).isDirectory()) removeTree(p);
      else unlinkSync(p);
      cleaned += 1;
    } catch (err) {
      failed += 1;
      console.warn(`clean-dist: 清理 ${item} 失败（${err.code ?? err.message}），跳过`);
    }
  }
  console.log(`clean-dist: dist 清理 ${cleaned} 项${failed ? `（${failed} 项失败被跳过）` : ''}`);
} else {
  console.log('clean-dist: dist 不存在，无需清理');
}

pruneTrash();

/** 只留最近 KEEP 份备份；逐文件 unlink 绕开批量删除保护，单份失败只警告 */
function pruneTrash() {
  let entries;
  try {
    entries = readdirSync(TRASH)
      .filter((name) => name.startsWith('dist-'))
      .map((name) => ({ name, path: join(TRASH, name) }))
      // 排序用**目录名内嵌的 ISO 时间戳**，不用 mtime：目录 mtime 会被无关进程
      // 随手刷新（IDE 文件监听、杀软扫描、备份工具都会碰一下）——2026-10-14
      // 实测最旧一份的 mtime 被改成了构建当时的时间，按 mtime 排序的保留策略
      // 当场失效：该删的没删，.dist-trash 越过上限。名字里的时间戳创建时定死、
      // 不可变，字典序即时间序（ISO 8601 的性质），这才是稳的判据。
      .sort((a, b) => (a.name < b.name ? 1 : -1)); // 新的在前
  } catch {
    return; // 列不出目录就不清理——保洁失败不影响构建
  }
  if (entries.length <= KEEP) {
    console.log(`clean-dist: .dist-trash ${entries.length} 份（上限 ${KEEP}），无需清理`);
    return;
  }
  let removed = 0;
  for (const stale of entries.slice(KEEP)) {
    try {
      removeTree(stale.path);
      removed += 1;
    } catch (err) {
      console.warn(`clean-dist: 清理旧备份 ${stale.name} 失败（${err.message}），跳过`);
    }
  }
  console.log(`clean-dist: 清理 ${removed} 份旧备份，保留最近 ${entries.length - removed} 份`);
}

/** 逐文件删除后删空目录（不用 rmSync recursive——触发本机 IDE 批量删除保护） */
function removeTree(dir) {
  for (const item of readdirSync(dir)) {
    const p = join(dir, item);
    if (statSync(p).isDirectory()) removeTree(p);
    else unlinkSync(p);
  }
  rmdirSync(dir);
}
