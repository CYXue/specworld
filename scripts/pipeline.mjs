#!/usr/bin/env node
/**
 * 全链路编排：取数 → 规范化 → 整合 → 派生 → 分析 → 建站 → 发布校验。
 *
 * 这是 GitHub Actions 与本地共用的唯一入口。
 * 纪律：**任何一步失败立即非零退出**，不允许「带着旧数据继续往下走」——
 * 上游官网改版时，继续跑只会产出一份看着正常、实际残缺的快照。
 *
 * 用法：
 *   node scripts/pipeline.mjs              # 完整跑（联网取数）
 *   node scripts/pipeline.mjs --offline    # 只用缓存，CI 失败时的重跑方式
 *   node scripts/pipeline.mjs --skip-sources  # 跳过取数，用已有 raw 缓存
 *   node scripts/pipeline.mjs --dry        # 只跑校验，不写盘
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
const DRY = argv.includes('--dry');
const SKIP_SOURCES = argv.includes('--skip-sources') || OFFLINE;

const t0 = Date.now();
const steps = [];

/** 跑一步。失败即抛，整条链停在这里 */
function run(label, script, args = []) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${label}\n`);
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, TZ: 'UTC' },
  });
  if (r.status !== 0) {
    console.error(`\n❌ 步骤失败：${label}（退出码 ${r.status}）`);
    console.error('   管线已停止，不会写盘。上一次的快照保持不变。');
    if (OFFLINE) {
      console.error('   当前是 --offline 模式：可能是网络抓取失败。联网重跑：node scripts/pipeline.mjs');
    } else {
      console.error('   上游官网结构可能变了。排查顺序：');
      console.error('     1. node scripts/sources/<brand>.mjs --limit 1   看单台能否解析');
      console.error('     2. 检查 docs/PROBE-FINDINGS.md 里的页面结构假设是否仍成立');
      console.error('     3. node scripts/sync/validate.mjs 看是哪个闸门拦住的');
    }
    process.exit(r.status ?? 1);
  }
  steps.push({ label, ms: Date.now() - started });
}

/* ---- 1. 取数 ---- */
if (SKIP_SOURCES) {
  console.log(`\n▶ 取数：跳过（${OFFLINE ? 'offline 模式' : '--skip-sources'}），使用已有缓存`);
  const need = ['_work/huawei.raw.json', '_work/apple.raw.json'];
  const missing = need.filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`❌ 缺少取数缓存：${missing.join(', ')}`);
    console.error('   首次运行或缓存已清理时必须联网跑一次：node scripts/pipeline.mjs');
    process.exit(1);
  }
} else {
  run('华为官网取数', 'scripts/sources/huawei.mjs', ['--out', '_work/huawei.raw.json', '--cache', '_work/huawei.cache']);
  run('苹果官网取数', 'scripts/sources/apple.mjs', ['--out', '_work/apple.raw.json', '--cache', '_work/apple.cache']);
  run('苹果对比页取数', 'scripts/sources/apple-compare.mjs', ['--out', '_work/apple-compare.raw.json', '--cache', '_work/apple-compare.cache']);
  run('苹果价格取数', 'scripts/sources/apple-prices.mjs', ['--out', '_work/apple-prices.raw.json', '--cache', '_work/apple-prices.cache']);
}

/* ---- 2. 规范化 ---- */
run('规范化（官网字段 → 契约字段）', 'scripts/normalize/index.mjs');

/* ---- 3. 整合（窗口过滤 + 校验闸门 + 原子写） ---- */
run('整合与校验闸门', 'scripts/sync/index.mjs', DRY ? ['--dry'] : []);

/* ---- 4. 派生（分位、头衔、一句话定位） ---- */
// derive 由 sync 内部调用（见 scripts/sync/index.mjs 的 buildChampions/buildScales），
// 这里不再单独跑，避免两次计算产生口径不一致。

/* ---- 5. 分析层（能力条 / 分类聚合 / 类比换算） ---- */
run('分析层', 'scripts/lib/analyze.mjs');

/* ---- 6. 建站 ---- */
run('站点构建', 'scripts/site/build.mjs');

/* ---- 7. 发布校验 ---- */
run('发布校验', 'scripts/publish/verify.mjs');

/* ---- 汇总 ---- */
const total = Date.now() - t0;
console.log(`\n${'─'.repeat(60)}`);
console.log(`✅ 全链路完成，用时 ${(total / 1000).toFixed(1)}s`);
for (const s of steps) console.log(`   ${s.label.padEnd(34)} ${(s.ms / 1000).toFixed(1)}s`);

const mf = join(ROOT, 'dist/manifest.json');
if (existsSync(mf)) {
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  console.log(`\n站点产物：${m.pageCount} 页 · 机型 ${m.products.total} 台 · 指纹 ${m.fingerprint}`);
  console.log(`自包含：${m.selfContained ? '是' : '否'} · 失效链接 ${m.brokenLinks} · 内容问题 ${(m.contentIssues ?? []).length}`);
}

/* ---- 供 CI 判断「数据有没有变」 ---- */
// 把关键产物的哈希写出来，workflow 用它决定要不要 commit。
if (!DRY) {
  const crypto = await import('node:crypto');
  const h = crypto.createHash('sha256');
  for (const f of ['data/products.json']) {
    const p = join(ROOT, f);
    if (existsSync(p)) h.update(readFileSync(p));
  }
  const digest = h.digest('hex').slice(0, 16);
  writeFileSync(join(ROOT, '_work/pipeline-digest.txt'), `${digest}\n`, 'utf8');
  console.log(`\n数据指纹（data/products.json）：${digest}`);
  console.log('CI 用它判断是否需要提交：git diff --quiet _work/pipeline-digest.txt || commit');
}
