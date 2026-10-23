/**
 * 华为监管编号折叠：取证 JSON → data/overrides.json（进网许可编号 / CMIIT ID）。
 *
 * 证据链纪律（与 apple-sar 同源，外加人工取证特有的一条）：
 *   - 输入 data/curated/evidence-huawei-reg.json，每条值必须带 sourceUrl——
 *     没有 URL 的值视为没有证据，直接拒绝写盘（宁可空着，绝不无源入库）；
 *   - 只填**空缺**字段（幂等，可反复跑）；默认预演，--apply 才写盘；
 *   - source 统一标 'manual-evidence'，reason 携带来源 URL 可回溯。
 *
 * 用法：
 *   node scripts/ingest/huawei-cta-fill.mjs           # 预演
 *   node scripts/ingest/huawei-cta-fill.mjs --apply   # 写盘（备份到 _work/）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const EVIDENCE = join(ROOT, 'data/curated/evidence-huawei-reg.json');

const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8'));
const products = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
const byId = new Map(products.products.map((p) => [p.id, p]));
const overrides = JSON.parse(readFileSync(join(ROOT, 'data/overrides.json'), 'utf8'));
const existingKeys = new Set(overrides.entries.map((e) => `${e.op}:${e.productId}:${e.field}`));

const added = [];
const rejected = [];
for (const ev of evidence.results ?? []) {
  if (!byId.has(ev.productId)) {
    rejected.push(`${ev.productId}: 机型不存在`);
    continue;
  }
  const pairs = [
    ['device.ctaNo', ev.ctaNo, ev.ctaSource],
    ['device.srrcId', ev.srrcId, ev.srrcSource],
  ];
  for (const [field, value, source] of pairs) {
    if (value == null || value === '') continue;
    if (typeof value !== 'string' || !value.trim()) continue;
    if (typeof source !== 'string' || !/^https?:\/\//.test(source)) {
      rejected.push(`${ev.productId} ${field}: 有值但缺合法 sourceUrl（${source ?? '无'}）——拒绝入库`);
      continue;
    }
    const key = `set-field:${ev.productId}:${field}`;
    if (existingKeys.has(key)) continue;
    added.push({
      id: `ovr-manual-${String(overrides.entries.length + added.length + 1).padStart(4, '0')}`,
      op: 'set-field',
      productId: ev.productId,
      field,
      value: value.trim(),
      reason: `人工取证监管编号（${ev.note ?? ''}）——来源：${source}`,
      createdAt: new Date().toISOString().slice(0, 10),
      active: true,
      source: 'manual-evidence',
    });
  }
}

console.log(`证据 ${evidence.results?.length ?? 0} 条 → 可入库 ${added.length} 条，拒收 ${rejected.length} 条`);
for (const r of rejected) console.log(`  ✗ ${r}`);
for (const a of added.slice(0, 8)) console.log(`  ✓ ${a.productId} ${a.field} = ${a.value}`);
if (added.length > 8) console.log(`  … 其余 ${added.length - 8} 条见预演明细`);

if (!APPLY) {
  console.log('（预演模式，未写盘。--apply 生效）');
  process.exit(0);
}
if (!added.length) {
  console.log('没有可入库条目，未写盘。');
  process.exit(0);
}
writeFileSync(join(ROOT, '_work/overrides.pre-manual-reg.json'), readFileSync(join(ROOT, 'data/overrides.json')));
overrides.entries.push(...added);
writeFileSync(join(ROOT, 'data/overrides.json'), JSON.stringify(overrides, null, 2) + '\n');
console.log(`已写盘：新增 ${added.length} 条（备份：_work/overrides.pre-manual-reg.json）`);
console.log('请跑：npm run selftest && node scripts/pipeline.mjs --data-only');
