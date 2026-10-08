#!/usr/bin/env node
/**
 * 依赖源规范化：把 package-lock.json 里的 resolved 主机名统一回官方源。
 *
 *   node scripts/publish/normalize-lock.mjs           # 检查（只读，有镜像条目就非零退出）
 *   node scripts/publish/normalize-lock.mjs --write   # 改写（原地替换主机名）
 *
 * 为什么需要这个脚本
 * ------------------
 * 本机 npm 的 registry 指向国内镜像（registry.npmmirror.com），装包快。
 * 但 package-lock.json 是要提交进仓库、并在 GitHub Actions 上 `npm ci` 的产物：
 * 里面混进镜像地址，会让「连不上该镜像的环境」直接装包失败，也偏离开源仓库惯例。
 *
 * 所以定一条制度：**本地装包走镜像（快），提交的 lock 必须干净（可移植）。**
 * 代价是本地每次装新依赖都会重新写回镜像地址，因此需要一个推送前的规范化步骤——
 * 这就是本脚本。它同时被 CI 调用（见 .github/workflows/sync.yml），
 * 于是「lock 里混了镜像」会在 push 时当场暴露，而不是等到某台机器 `npm ci` 失败。
 *
 * 为什么用脚本而不是一行 sed
 * -------------------------
 * 1. 跨平台：Windows 的 PowerShell / BSD sed 与 GNU sed 的参数语义不同，
 *    `-i` 还要区分 `sed -i''` 与 `sed -i ''`，一条命令在三个 shell 下三种行为。
 * 2. 只换主机名、保留其余字节：改完重新 JSON.parse 校验，坏文件当场拒绝写盘，
 *    不会像 `npm install --package-lock-only --registry=...` 那样重生成一份结构可能残缺的 lock。
 * 3. 顺手能报出「哪几个包来自非官方源」，这是排查时真正需要的信息。
 *
 * 纪律：只替换 URL 的主机名部分。integrity 哈希、版本号、依赖结构一律不碰。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = resolve(ROOT, 'package-lock.json');

/** 唯一认可的包源主机名。 */
const CANONICAL_HOST = 'registry.npmjs.org';

/**
 * 只把「包源主机名」这一段换掉，其余部分（路径、哈希、协议）原样保留。
 * 用 URL 解析而不是字符串 replace，避免误伤 integrity 字段里的同名字符串。
 */
function canonicalizeResolved(resolvedUrl) {
  let u;
  try {
    u = new URL(resolvedUrl);
  } catch {
    return { changed: false, reason: '无法解析为 URL（非 http(s) 或格式异常）' };
  }
  if (u.hostname === CANONICAL_HOST) return { changed: false, reason: '已是官方源' };
  if (u.hostname !== 'registry.npmmirror.com') {
    // 别的镜像（例如未来换源、或私有源）也要报出来，但不能擅自决定替成什么。
    return {
      changed: false,
      reason: `非官方源且非已知镜像「${u.hostname}」——需人工确认后再处理`,
    };
  }
  const from = u.hostname;
  u.hostname = CANONICAL_HOST;
  return { changed: true, url: u.toString(), from: from };
}

const WRITE = process.argv.includes('--write');

let raw;
try {
  raw = readFileSync(LOCK, 'utf8');
} catch {
  console.error(`✗ 读不到 ${LOCK}`);
  process.exit(1);
}

// 先确认是合法 JSON，再动手：宁可什么都不做，也不要写坏 lock。
let lock;
try {
  lock = JSON.parse(raw);
} catch (err) {
  console.error(`✗ package-lock.json 本身不是合法 JSON，拒绝处理：${err.message}`);
  process.exit(1);
}

const offenders = [];
const packages = lock.packages ?? {};
for (const [pkgPath, meta] of Object.entries(packages)) {
  if (typeof meta?.resolved !== 'string') continue;
  const r = canonicalizeResolved(meta.resolved);
  if (r.changed) offenders.push({ pkgPath, from: r.from, to: r.url });
  else if (r.reason && !r.reason.includes('已是官方源')) {
    offenders.push({ pkgPath, unresolved: true, reason: r.reason });
  }
}

const unresolved = offenders.filter((o) => o.unresolved);

if (offenders.length === 0) {
  console.log(
    `✅ package-lock.json 干净：${Object.keys(packages).length} 个包全部指向 ${CANONICAL_HOST}`,
  );
  process.exit(0);
}

if (unresolved.length > 0) {
  console.error('✗ 存在需要人工确认的非官方包源，已拒绝自动改写：');
  for (const o of unresolved) console.error(`    ${o.pkgPath}: ${o.reason}`);
  process.exit(1);
}

console.log(`发现 ${offenders.length} 条指向 registry.npmmirror.com 的 resolved：`);
for (const o of offenders) console.log(`    ${o.pkgPath}`);

if (!WRITE) {
  console.error('\n✗ package-lock.json 不是纯官方源。');
  console.error('  修法：node scripts/publish/normalize-lock.mjs --write');
  console.error('  为什么要修：lock 会随仓库提交并在 GitHub Actions 上 npm ci，');
  console.error('  连不上该镜像的环境会直接装包失败（integrity 保证包内容一致，');
  console.error('  但下载走的是那台服务器）。');
  process.exit(1);
}

for (const o of offenders) packages[o.pkgPath].resolved = o.to;

// 保持缩进与结尾换行，避免整个文件被重排成一大坨难看的 diff。
writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n', 'utf8');

// 改完必须重新 parse 一遍：写出去的东西自己要先能读。
JSON.parse(readFileSync(LOCK, 'utf8'));

console.log(`\n✅ 已规范化 ${offenders.length} 条 resolved → ${CANONICAL_HOST}，JSON 校验通过。`);
console.log('   （本地 registry 未改动：装包仍走镜像，只是提交的 lock 变干净了）');
