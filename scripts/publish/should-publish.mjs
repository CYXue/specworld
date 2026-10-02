#!/usr/bin/env node
/**
 * 发布决策：这一版该不该送审。
 *
 * 每天最多送一次，而且只在「用户看得见的东西真变了」时才送 ——
 * 每次送审都要平台人工过一遍，无脑送是在浪费审核资源，也会把版本记录冲淡。
 *
 * 判据只有一条硬规则：站点指纹。它由 scripts/publish/fingerprint.mjs 算出，
 * 是「数据 × 模板」的产物，已经剥掉了刷新时间戳那类每次同步都会变的字段。
 *
 * 用法
 * ----
 *   node scripts/publish/should-publish.mjs --github   # 写 GITHUB_OUTPUT，供 workflow 的 if 判断
 *   FORCE=1 node scripts/publish/should-publish.mjs     # 内容没变也要送
 *
 * 退出码
 * ------
 *   0 正常结束（要不要送由输出的 publish 标志决定，不是用退出码表达）
 *   1 环境不对（找不到站点产物等）
 *
 * 关于「上一版审核中 / 被驳回」这一层
 * ------------------------------------
 * 参考项目会查平台状态：上一版还在审核就跳过，被驳回就失败开 issue 等人处理。
 * 这里**没有实现**，因为那需要解析 `toy` CLI 的输出，而它是 cobra 自描述 CLI，
 * 官方 skill 明确写了「不写命令矩阵，写死字段名只会与代码漂移」。
 * 在没有真实输出样本的情况下硬写解析，只会产出一个看起来聪明、实际对不上的脚本。
 * 需要这一层时，拿一次真实的 `toy history` / `toy mylist` 输出，再补进来。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compute } from './fingerprint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const FOR_GITHUB = argv.includes('--github');
const FORCE = process.env.FORCE === '1' || process.env.FORCE === 'true';

/** 上次送审的版本记录。入库，随发布一起提交回去。 */
const RELEASE_FILE = join(ROOT, 'data/.toy-release.json');

const fp = compute();
const previous = existsSync(RELEASE_FILE)
  ? JSON.parse(readFileSync(RELEASE_FILE, 'utf8'))
  : null;

let publish;
let reason;

if (!previous) {
  publish = true;
  reason = '首次送审：还没有发布记录';
} else if (previous.siteFingerprint === fp.siteFingerprint && !FORCE) {
  publish = false;
  reason = `内容与上次送审的 ${previous.siteFingerprint} 完全一致，跳过`;
} else if (previous.siteFingerprint === fp.siteFingerprint && FORCE) {
  publish = true;
  reason = `内容未变，但指定了 FORCE，强制送审`;
} else {
  publish = true;
  reason = `内容有变化：${previous.siteFingerprint} → ${fp.siteFingerprint}`;
}

const lines = [
  `publish=${publish}`,
  `site_fingerprint=${fp.siteFingerprint}`,
  `products=${fp.stats.products}`,
  `reason=${reason}`,
];

if (FOR_GITHUB) {
  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) {
    console.error('❌ --github 需要 GITHUB_OUTPUT 环境变量（只在 GitHub Actions 里有）');
    process.exit(1);
  }
  writeFileSync(outPath, `${lines.join('\n')}\n`, { flag: 'a' }, 'utf8');
}

console.log(`站点指纹 ${fp.siteFingerprint} · 机型 ${fp.stats.products} 台`);
console.log(`上次送审 ${previous?.siteFingerprint ?? '（无）'}`);
console.log(`${publish ? '✅ 需要送审' : '⏭  跳过送审'}：${reason}`);
if (!FOR_GITHUB) console.log(`\n${lines.join('\n')}`);
