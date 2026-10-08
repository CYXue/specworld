#!/usr/bin/env node
/**
 * 原始响应归档：把「解析前的官网原文键值对」存成**可入库的**快照。
 *
 *   node scripts/archive.mjs              # 从 _work/*.raw.json 归档到 data/raw/
 *   node scripts/archive.mjs --check      # 只比对，不写盘；非零退出表示体积或形状不对
 *
 * 为什么不是「把 HTML 存进仓库」
 * --------------------------
 * 参考项目（ai-model-world）有 `data/raw/`，但它的 `.gitignore` 第 39 行就写着
 * `/data/raw/` —— **它也不入库**，因为全量原始响应会把仓库撑爆
 * （它对精灵图踩过同样的坑：606 张 18.4 MB，几次迭代就撑不住了）。
 *
 * 本项目的数据更极端：苹果一台机型就要抓规格页 + 对比页 + 价格三个通道，
 * 60 台的全量 HTML 是几十 MB 级。所以**照抄「归档 HTML」是错的**。
 *
 * 真正有用的、被参考项目丢掉的那部分是什么
 * ---------------------------------------
 * 解析器吃的是 `RawProduct.raw`（章节名 → **页面原文值**），不是 HTML。
 * 归档这个：
 *
 *   - **体积可控**：每台几十个键值，几 KB；60 台加起来在几百 KB 量级。
 *   - **够回放**：解析器改坏了要复现，喂同一份raw 就能重跑，不需要网络。
 *     HTML 里那些 `<div class=…>` 样式对解析毫无意义，归档它们是浪费。
 *   - **可进版本库**：于是「上周二官网长什么样」有了答案 —— 这正是
 *     「上游改版后回放验证解析逻辑」的真实含义。
 *
 * 有个信息是刻意**不**存的
 * ----------------------
 * 不存时间戳、不存机型 id 与值的对应全集（那是 products.json 的职责）。
 * 归档的定位是「官网给了哪些字段名 + 每台的字段值」，
 * 用途只有一个：解析器改坏了能喂同一份输入复现。
 * 一旦引入运行时刻字段，每轮归档都不同 → 每 12 小时一次空提交
 * （这是本项目已经踩过两次的坑，见 fingerprint.mjs 的注释）。
 *
 * 入库路径必须过 CI 的显式 pathspec（`grep -Ev '^data/'`）——
 * `data/raw/` 在 `data/` 之下，天然满足，不用改 workflow。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, '_work');
const RAW_DIR = join(ROOT, 'data/raw');
const CHECK_ONLY = process.argv.includes('--check');

/**
 * 体积闸门：归档件总字节上限。
 *超了就非零退出 —— 宁可让人来决定要不要入库，也不让版本库悄悄膨胀。
 * 2026-10-06 实测约 300 KB，留 10 倍余量。
 */
const MAX_BYTES = 4 * 1024 * 1024;

/** 四个取数通道 → 归档文件名 */
const CHANNELS = [
  { file: 'huawei.raw.json', out: 'huawei-official.json' },
  { file: 'apple.raw.json', out: 'apple-official.json' },
  { file: 'apple-compare.raw.json', out: 'apple-compare-official.json' },
  { file: 'apple-prices.raw.json', out: 'apple-prices-official.json' },
];

/**
 * 把一个通道的 SourceResult 压成归档形状。
 *
 * 只保留三样东西：**通道名**、**每台机器的 id / name / specsUrl / raw**、
 * 以及 **skipped 的 id + 原因**（跳过的机型也是覆盖范围的一部分，必须可追溯）。
 *
 * 刻意丢掉的：
 *   - `fetchedAt` / `extractedAt`：运行时刻，会造成空提交。
 *   - `notes`：抓取过程的临时告警，进了 products.json 的 sources.note。
 *   - 字段值的来源标记：契约层已有 `provenance`，重复存两份会分叉。
 */
function archiveShape(result) {
  return {
    source: result.source,
    products: (result.products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      specsUrl: p.specsUrl,
      raw: p.raw,
    })),
    skipped: (result.skipped ?? []).map((s) => ({ id: s.id, reason: s.reason })),
  };
}

/** 同形比对：判断归档件与源raw 是否逐字节等价（只比内容不比键序） */
function sameShape(a, b) {
  if (JSON.stringify(a) !== JSON.stringify(b)) return false;
  return true;
}

function main() {
  if (!existsSync(WORK)) {
    console.error('❌ 没有 _work/，先跑一次 node scripts/pipeline.mjs');
    process.exit(1);
  }

  const archived = [];
  const missing = [];

  for (const ch of CHANNELS) {
    const src = join(WORK, ch.file);
    if (!existsSync(src)) {
      missing.push(ch.file);
      continue;
    }
    const result = JSON.parse(readFileSync(src, 'utf8'));
    const shape = archiveShape(result);
    const body = `${JSON.stringify(shape, null, 2)}\n`;
    const dst = join(RAW_DIR, ch.out);
    archived.push({ out: ch.out, body, count: shape.products.length });

    if (CHECK_ONLY) {
      // --check 语义：归档件不存在或与源不一致 → 报出来（CI 可用）
      if (!existsSync(dst)) {
        console.error(`❌ ${ch.out}：尚未归档（先跑 node scripts/archive.mjs）`);
        process.exitCode = 1;
        continue;
      }
      const got = JSON.parse(readFileSync(dst, 'utf8'));
      if (!sameShape(got, shape)) {
        console.error(`❌ ${ch.out}：与 _work/${ch.file} 不一致 —— 官网可能改版了，或归档没更新`);
        process.exitCode = 1;
      }
    }
  }

  if (CHECK_ONLY) {
    if (missing.length) console.error(`⚠️ 缺取数缓存：${missing.join(', ')}（跳过这三个通道）`);
    if (!process.exitCode) console.log('✅ 归档件与 _work 的原始响应一致');
    return;
  }

  if (!archived.length) {
    console.error('❌ _work/ 下没有任何 raw.json —— 先跑一次 node scripts/pipeline.mjs');
    process.exit(1);
  }

  // 清理旧文件：通道改名或下线后不留孤儿文件（孤儿文件永远没人敢删）
  mkdirSync(RAW_DIR, { recursive: true });
  const keep = new Set(archived.map((a) => a.out));
  for (const name of readdirSync(RAW_DIR)) {
    if (name.endsWith('.json') && !keep.has(name)) {
      rmSync(join(RAW_DIR, name));
      console.log(`  已清理孤儿归档 ${name}`);
    }
  }

  for (const a of archived) {
    writeFileSync(join(RAW_DIR, a.out), a.body, 'utf8');
  }

  const totalBytes = archived.reduce((n, a) => n + Buffer.byteLength(a.body), 0);
  const kb = (totalBytes / 1024).toFixed(1);
  const detail = archived
    .map((a) => `${a.out.replace('.json', '')} ${a.count} 台`)
    .join(' · ');

  if (totalBytes > MAX_BYTES) {
    console.error(`\n❌ 归档体积 ${kb} KB 超过闸门 ${(MAX_BYTES / 1024).toFixed(0)} KB，拒绝写入。`);
    console.error('   理由：版本库膨胀是不可逆的。请先确认是否该改为「只归档变化了的字段名清单」。');
    process.exit(1);
  }

  console.log(`已归档 ${archived.length} 个通道 → data/raw/（共 ${kb} KB）`);
  console.log(`  ${detail}`);
  if (missing.length) console.log(`  ⚠️ 跳过（无缓存）：${missing.join(', ')}`);
  console.log('\n用途：解析器改坏后，用 data/raw/ 里的原文离线复现，无需联网。');
  console.log('比对：node scripts/archive.mjs --check');
}

main();