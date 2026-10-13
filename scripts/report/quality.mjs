#!/usr/bin/env node
/**
 * 数据质量报告生成器。
 *
 * 对齐准绳/Baseline 的「数据质量报告」格式（品类计数 / 品牌分布 / 字段填充率 /
 * value_status 分布 / 分组分布 / 完整性校验 / 低填充预警 / 品类就绪状态），
 * 并结合本项目四态 value_status 模型（available / unknown / none / not_applicable）。
 *
 * 纪律（照抄参考项目 scripts/qa/ 的只读 + 确定性原则）：
 *   - 只读 data/products.json 与 data/schemas/*.json，绝不写盘（除本报告自身）、绝不联网；
 *   - 不含 now() 时间戳，输出完全由数据决定，便于 diff「这次改动引入了什么」；
 *   - 报告日期取数据快照自带的 generatedAt，而非运行时刻。
 *
 * 用法：
 *   node scripts/report/quality.mjs                 # 写 _work/quality-report.md + 打印摘要
 *   node scripts/report/quality.mjs --out <path>    # 指定输出路径
 *   node scripts/report/quality.mjs --stdout-only   # 只打印 markdown，不写文件
 *
 * 退出码：发现「会污染参数表」的完整性错误（孤儿 specs 键 / 孤儿四态键 / 非法四态值）
 * 时退出 1，否则 0。低填充只是事实预警，不算错误。
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProducts, brandZh } from '../qa/lib.mjs';
import {
  loadCategories,
  loadSchema,
  groupsOf,
  fieldsByGroup,
  valueStatus,
  validateStatusMap,
  validateSpecs,
} from '../lib/schema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const outArg = outIdx >= 0 ? argv[outIdx + 1] : null;
const stdoutOnly = argv.includes('--stdout-only');
const OUT = outArg ?? join(ROOT, '_work', 'quality-report.md');

const FILL_WARN = 0.6; // 低于此填充率 → 低填充预警
const READY = 0.9; // 字段填充率 ≥ 此值 → 视为「就绪」

const STATES = ['available', 'unknown', 'none', 'not_applicable'];
const stateZh = { available: '有值', unknown: '未公布', none: '无', not_applicable: '不适用' };
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const hasVal = (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);

/* ---------------- 加载数据 ---------------- */

// 原始快照拿 generatedAt（loadProducts 只返回 products 数组）
const rawPath = join(ROOT, 'data/products.json');
const raw = existsSync(rawPath) ? JSON.parse(readFileSync(rawPath, 'utf8')) : null;
const products = loadProducts();
const reg = loadCategories();
const registryCats = reg?.categories ?? [];

const md = [];
const push = (s = '') => md.push(s);

/* ---------------- 1. 概览 ---------------- */

const presentCats = [...new Set(products.map((p) => p.category))];
const presentBrands = [...new Set(products.map((p) => p.brand))];
const schemaBuilt = registryCats.filter((c) => loadSchema(c.id));
const totalFields = schemaBuilt.reduce(
  (n, c) => n + (loadSchema(c.id)?.fields?.length ?? 0),
  0,
);

push('# 数据质量报告');
push('');
push(`- 数据源：\`data/products.json\``);
push(`- 生成命令：\`node scripts/report/quality.mjs\`（只读 + 确定性输出）`);
push(`- 数据快照时间：${raw?.generatedAt ?? '（快照未标注）'}`);
push('- 对齐：准绳/Baseline 数据质量报告格式 + 本项目四态 value_status 模型');
push('');
push('## 1. 概览');
push('');
push('| 指标 | 值 |');
push('| --- | --- |');
push(`| 产品总数 | ${products.length} |`);
push(`| 品类数（注册表） | ${registryCats.length} |`);
push(`| 已出现产品的品类 | ${presentCats.length} |`);
push(`| 品牌数 | ${presentBrands.length}（${presentBrands.map(brandZh).join(' / ')}） |`);
push(`| 已建设 schema 的品类 | ${schemaBuilt.length}（${schemaBuilt.map((c) => c.label).join(' / ')}） |`);
push(`| 字段总数（全部 schema 之和） | ${totalFields} |`);
push('');

/* ---------------- 2. 品类计数 ---------------- */

push('## 2. 品类计数');
push('');
push('| 品类 | 中文 | 产品数 | schema | 字段数 |');
push('| --- | --- | --- | --- | --- |');
for (const c of registryCats) {
  const n = products.filter((p) => p.category === c.id).length;
  const schema = loadSchema(c.id);
  const schemaMark = schema ? '✅' : '⏳ 待建设';
  push(`| ${c.id} | ${c.label ?? ''} | ${n} | ${schemaMark} | ${schema?.fields?.length ?? '—'} |`);
}
push('');

/* ---------------- 3. 品牌分布 ---------------- */

push('## 3. 品牌分布');
push('');
push('| 品类 | 品牌 | 数量 | 占比 |');
push('| --- | --- | --- | --- |');
for (const c of registryCats) {
  const list = products.filter((p) => p.category === c.id);
  if (!list.length) continue;
  const brands = [...new Set(list.map((p) => p.brand))];
  for (const b of brands) {
    const n = list.filter((p) => p.brand === b).length;
    push(`| ${c.label ?? c.id} | ${brandZh(b)} | ${n} | ${pct(n / list.length, 0)} |`);
  }
}
push('');

/* ---------------- 4–6. 逐品类字段 / 四态 / 分组 ---------------- */

// 累积四态总量（用于第 5 节总览）与低填充清单
const fourStateTotals = { available: 0, unknown: 0, none: 0, not_applicable: 0 };
const lowFill = []; // {cat, path, fill, missing}
const catReadiness = []; // {cat, total, ready, readiness, status}

for (const c of registryCats) {
  const schema = loadSchema(c.id);
  if (!schema) continue;
  const list = products.filter((p) => p.category === c.id);
  if (!list.length) continue;
  const fields = schema.fields ?? [];
  const groups = groupsOf(schema);
  const byGroup = fieldsByGroup(schema);

  // 逐字段四态统计
  const tally = {};
  for (const f of fields) {
    tally[f.path] = { available: 0, unknown: 0, none: 0, not_applicable: 0 };
  }
  for (const p of list) {
    for (const f of fields) {
      const s = valueStatus(p, f.path);
      tally[f.path][s]++;
      fourStateTotals[s]++;
    }
  }

  push(`## 4. 字段填充率（按四态）— ${c.label ?? c.id}`);
  push('');
  push(`> ${list.length} 台 ${c.label ?? c.id}。填充率 = 有值台数 / 该品类总台数。未公布≠缺失，是官网事实。`);
  push('');
  push('| 字段 | 组 | 有值 | 未公布 | 无 | 不适用 | 填充率 |');
  push('| --- | --- | --- | --- | --- | --- | --- |');
  const fieldRows = fields
    .map((f) => {
      const t = tally[f.path];
      const fill = list.length ? t.available / list.length : 0;
      return { f, t, fill };
    })
    .sort((a, b) => a.fill - b.fill || a.f.path.localeCompare(b.f.path));
  for (const { f, t, fill } of fieldRows) {
    push(
      `| \`${f.path}\` | ${f.group ?? ''} | ${t.available} | ${t.unknown} | ${t.none} | ${t.not_applicable} | ${pct(fill)} |`,
    );
    if (fill < FILL_WARN) lowFill.push({ cat: c.label ?? c.id, path: f.path, fill, missing: list.length - t.available });
  }
  push('');

  // 第 5 节：逐品类四态分布（聚合）
  push(`## 5. 四态分布 — ${c.label ?? c.id}`);
  push('');
  const sum = { available: 0, unknown: 0, none: 0, not_applicable: 0 };
  for (const f of fields) for (const s of STATES) sum[s] += tally[f.path][s];
  const cells = sum.available + sum.unknown + sum.none + sum.not_applicable;
  push('| 有值 | 未公布 | 无 | 不适用 | 字段×产品 |');
  push('| --- | --- | --- | --- | --- |');
  push(`| ${sum.available} | ${sum.unknown} | ${sum.none} | ${sum.not_applicable} | ${cells} |`);
  push('');

  // 第 6 节：分组覆盖率
  push(`## 6. 分组覆盖率 — ${c.label ?? c.id}`);
  push('');
  push('| 组 | 类型 | 字段数 | 平均填充率 |');
  push('| --- | --- | --- | --- |');
  for (const g of groups) {
    const gf = byGroup.get(g.id) ?? [];
    const fills = gf.map((f) => (list.length ? tally[f.path].available / list.length : 0));
    const avg = fills.length ? fills.reduce((a, b) => a + b, 0) / fills.length : 0;
    push(`| ${g.name ?? g.id} | ${g.type === 'multi' ? '多实例' : '单值'} | ${gf.length} | ${pct(avg)} |`);
  }
  push('');

  // 第 9 节：品类就绪度（累积）
  const ready = fieldRows.filter((r) => r.fill >= READY).length;
  const readiness = fields.length ? ready / fields.length : 0;
  const status = readiness >= READY ? '✅ 就绪' : readiness >= FILL_WARN ? '⚠️ 部分就绪' : '❌ 待补充';
  catReadiness.push({ cat: c.label ?? c.id, total: fields.length, ready, readiness, status });
}

/* ---------------- 7. 完整性校验 ---------------- */

push('## 7. 完整性校验');
push('');
const orphanSpecs = new Set(); // specs 存了 schema 没注册的字段（污染参数表）
const orphanStatus = new Set(); // 四态例外指向未注册字段
const illegalStatus = new Set(); // 四态值非法
const unregisteredCat = new Set(); // 产品 category 不在注册表
const noSchemaCat = new Set(); // 产品指向的品类已注册但无 schema 文件

for (const p of products) {
  const schema = loadSchema(p.category);
  if (!schema) {
    if (!registryCats.some((c) => c.id === p.category)) unregisteredCat.add(p.category);
    else noSchemaCat.add(p.category);
  }
  for (const e of validateSpecs(p, schema)) {
    const m = e.match(/specs 键 "([^"]+)" 未/);
    if (m) orphanSpecs.add(`${p.category}::${m[1]}`);
  }
  for (const e of validateStatusMap(p, schema)) {
    const mg = e.match(/valueStatus 键 "([^"]+)"/);
    const mv = e.match(/valueStatus\["([^"]+)"\]=(\S+)/);
    if (mg) orphanStatus.add(`${p.category}::${mg[1]}`);
    if (mv) illegalStatus.add(`${p.category}::${mv[1]}=${mv[2]}`);
  }
}

const critical = orphanSpecs.size + orphanStatus.size + illegalStatus.size;

push(`- 孤儿 specs 键（specs 存了 schema 没注册的字段）：**${orphanSpecs.size}**`);
for (const k of [...orphanSpecs].slice(0, 10)) push(`  - \`${k}\``);
push(`- 孤儿 valueStatus 键（四态例外指向未注册字段）：**${orphanStatus.size}**`);
for (const k of [...orphanStatus].slice(0, 10)) push(`  - \`${k}\``);
push(`- 非法四态值（valueStatus 值不是 none / not_applicable）：**${illegalStatus.size}**`);
for (const k of [...illegalStatus].slice(0, 10)) push(`  - \`${k}\``);
push(`- 无 schema 的品类（产品指向但无字段表，属待建设，非错误）：**${noSchemaCat.size}**`);
for (const k of [...noSchemaCat]) push(`  - \`${k}\``);
push(`- 品类未注册（产品 category 不在注册表）：**${unregisteredCat.size}**`);
for (const k of [...unregisteredCat]) push(`  - \`${k}\``);
push('');

/* ---------------- 8. 低填充预警 ---------------- */

push('## 8. 低填充预警（填充率 < 60%）');
push('');
if (!lowFill.length) {
  push('✅ 无字段低于预警线。');
} else {
  lowFill.sort((a, b) => a.fill - b.fill);
  push('| 品类 | 字段 | 填充率 | 缺 |');
  push('| --- | --- | --- | --- |');
  for (const r of lowFill) push(`| ${r.cat} | \`${r.path}\` | ${pct(r.fill)} | ${r.missing} |`);
}
push('');

/* ---------------- 9. 品类就绪状态（总览） ---------------- */

push('## 9. 品类就绪状态');
push('');
push(`> 就绪字段 = 填充率 ≥ 90% 的字段。就绪度 = 就绪字段数 / 字段总数。`);
push('');
push('| 品类 | 字段数 | 就绪字段(≥90%) | 就绪度 | 状态 |');
push('| --- | --- | --- | --- | --- |');
for (const c of registryCats) {
  const schema = loadSchema(c.id);
  const list = products.filter((p) => p.category === c.id);
  if (!schema) {
    push(`| ${c.label ?? c.id} | — | — | — | ⏳ 待建设 schema |`);
    continue;
  }
  if (!list.length) {
    push(`| ${c.label ?? c.id} | ${schema.fields?.length ?? 0} | — | — | ⏳ 无产品数据 |`);
    continue;
  }
  const r = catReadiness.find((x) => x.cat === (c.label ?? c.id));
  push(`| ${c.label ?? c.id} | ${r.total} | ${r.ready} | ${pct(r.readiness)} | ${r.status} |`);
}
push('');

/* ---------------- 写盘 / 摘要 ---------------- */

const body = md.join('\n');
if (!stdoutOnly) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, body, 'utf8');
}

// 控制台摘要（简短，便于一眼判断）
const total4 = STATES.reduce((a, s) => a + fourStateTotals[s], 0);
const digest = [
  '',
  `数据质量报告：${stdoutOnly ? '(仅打印)' : OUT}`,
  `产品 ${products.length} 台 · 品类 ${registryCats.length} · 品牌 ${presentBrands.length}`,
  `四态分布：有值 ${fourStateTotals.available} / 未公布 ${fourStateTotals.unknown} / 无 ${fourStateTotals.none} / 不适用 ${fourStateTotals.not_applicable}（共 ${total4}）`,
  `完整性：孤儿 specs 键 ${orphanSpecs.size} · 孤儿四态键 ${orphanStatus.size} · 非法四态值 ${illegalStatus.size}` +
    (critical === 0 ? '  ✅' : '  ❌'),
  `低填充字段：<60% 共 ${lowFill.length} 个`,
  '',
];

if (stdoutOnly) {
  console.log(body);
} else {
  console.log(digest.join('\n'));
}

process.exit(critical === 0 ? 0 : 1);
