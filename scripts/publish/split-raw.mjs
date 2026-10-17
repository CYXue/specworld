#!/usr/bin/env node
/**
 * 拆包：把 rawOfficial 从主数据里剥出来，切成按需加载的小文件（评审 2026-10-16）。
 *
 * 为什么：products.json 全量 2.1 MB，其中 rawOfficial（官网原文）只有 62 台带、
 * 只在详情页「查看官网原文」时才需要 —— 却让每台机器的首屏都付这个代价。
 *
 * 拆法（构建期，幂等）：
 *   public/data/products.json    主包：剥掉所有 rawOfficial（列表/详情/对比都用它）
 *   public/data/raw/{id}.json    原文：一台一个文件，详情页点开抽屉才 fetch
 *
 * 顺序：必须在 sync-public.mjs 之后跑（它拷贝的是带 rawOfficial 的原件，
 * 本脚本在副本上拆），且只动 public/data/ —— data/ 唯一数据源保持原样。
 *
 * 用法：node scripts/publish/split-raw.mjs（package.json 的 prebuild 自动调用）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = join(ROOT, 'public/data/products.json');
const RAW_DIR = join(ROOT, 'public/data/raw');

if (!existsSync(MAIN)) {
  console.error('❌ 找不到 public/data/products.json —— prebuild 顺序错误，先跑 sync-public.mjs');
  process.exit(1);
}

const ds = JSON.parse(readFileSync(MAIN, 'utf8'));
const products = ds.products ?? [];
const rawDirWanted = new Set();
let split = 0;
let beforeBytes = 0;
let provBytes = 0;

for (const p of products) {
  const raw = p.rawOfficial;
  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    delete p.rawOfficial; // 无原文的机器：主包里也不留空键
  } else {
    const text = JSON.stringify(raw);
    beforeBytes += text.length;
    rawDirWanted.add(`${p.id}.json`);
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(join(RAW_DIR, `${p.id}.json`), JSON.stringify(raw) + '\n');
    split++;
  }
  delete p.rawOfficial;

  // provenance（键=字段路径，值=来源 id）：**前端零消费**（2026-10-17 全源码核查，
  // 只有管线/审计层读它），却占主包 ~953KB——审计走 data/ 原件，主包直接剥离。
  // 这是数据诚信的文件层体现：溯源在源头数据里永远可查，只是不让访客的首屏付这个代价。
  if (p.provenance) {
    provBytes += JSON.stringify(p.provenance).length;
    delete p.provenance;
  }
}

// 逐文件对账清孤儿（不 rmSync 整目录：IDE 批量删除保护的坑见 sync-public.mjs 头注）
if (existsSync(RAW_DIR)) {
  for (const name of [...readdirSync(RAW_DIR)]) {
    if (!name.endsWith('.json') || !rawDirWanted.has(name)) {
      rmSync(join(RAW_DIR, name), { force: true });
    }
  }
}

writeFileSync(MAIN, JSON.stringify(ds) + '\n');
const afterBytes = readFileSync(MAIN).length;
console.log(
  `拆包完成：${split} 台的 rawOfficial → public/data/raw/（原文共 ${(beforeBytes / 1024).toFixed(0)} KB），` +
    `provenance 剥离 ${(provBytes / 1024).toFixed(0)} KB（前端零消费，源头 data/ 保留），` +
    `主包 ${(afterBytes / 1024 / 1024).toFixed(2)} MB`,
);
