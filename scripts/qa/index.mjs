#!/usr/bin/env node
/**
 * QA 总览：一次跑完三个体检，末尾给一份「今天该看什么」的清单。
 *
 *   node scripts/qa/index.mjs            # 全跑
 *   node scripts/qa/index.mjs --quiet    # 只打结论，跳过明细
 *
 * 存在的理由：三个脚本各答一个问题，单独跑没问题，但「刚同步完数据，
 * 现在该看什么」这个问题需要有人回答——就是这里。
 *
 * 设计上只做**编排与摘要**，具体逻辑都在各自的脚本里，
 * 保证 `node scripts/qa/why-champion.mjs` 单独可用（QA 的第一条纪律）。
 */

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const QUIET = process.argv.includes('--quiet');

/** @type {{file:string, name:string, asks:string}[]} */
const SCRIPTS = [
  {
    file: 'why-champion.mjs',
    name: '冠军体检',
    asks: '为什么这台是榜首',
  },
  {
    file: 'stale-lineup.mjs',
    name: '阵容体检',
    asks: '池子里有没有过时机型',
  },
  {
    file: 'coverage.mjs',
    name: '覆盖率体检',
    asks: '哪些字段大面积缺数据',
  },
];

const results = [];

for (const s of SCRIPTS) {
  if (QUIET) process.stdout.write(`▶ ${s.name}…\n`);
  else {
    console.log('');
    console.log('═'.repeat(72));
    console.log(`▶ ${s.name} —— ${s.asks}`);
    console.log('═'.repeat(72));
  }
  const r = spawnSync(process.execPath, [join(HERE, s.file)], {
    stdio: 'inherit',
    encoding: 'utf8',
  });
  results.push({ ...s, code: r.status ?? 1 });
}

/* ---------------- 摘要 ---------------- */
console.log('');
console.log('═'.repeat(72));
console.log('体检摘要');
console.log('═'.repeat(72));
console.log('');

for (const r of results) {
  const mark = r.code === 0 ? '✅' : r.code === 1 ? '⚠️ ' : '❌';
  console.log(`${mark} ${r.name}（${r.asks}）`);
}

const nonzero = results.filter((r) => r.code !== 0);
console.log('');
if (nonzero.length === 0) {
  console.log('三个体检都没发现问题。接下来可以直接跑管线：node scripts/pipeline.mjs --offline');
} else {
  console.log(`${nonzero.length} 个体检有待确认项：${nonzero.map((r) => r.name).join('、')}。`);
  console.log('注意 ⚠️ 不一定是 bug——「官方不公布」和「解析器失手」都需要人看一眼再下结论。');
}
console.log('');
console.log('下一步：node scripts/pipeline.mjs --offline   （重建站点，约 4 秒）');
console.log('');
