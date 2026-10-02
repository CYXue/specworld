/**
 * 同步管线入口：把规范化后的机型数据 + 发布日期，合成快照、过闸门、原子写盘。
 *
 * 用法：
 *   node scripts/sync/index.mjs            # 正常跑
 *   node scripts/sync/index.mjs --dry      # 只校验不写盘
 *
 * 输入：
 *   _work/normalized.json     规范化层产出（ProductRecord[]，见 docs/DATA-CONTRACT.md）
 *   _work/release-dates.json  发布日期取证结果
 * 输出：
 *   data/products.json        唯一数据契约（提交入库）
 *   _work/derived.json        标尺/头衔/定位（构建期产物，不入库，供检查）
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChampions, buildPersona, buildScales, percentileOf } from '../lib/derive.mjs';
import { coverageReport, validate } from './validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = join(ROOT, '_work');
const DATA = join(ROOT, 'data');

/** 窗口：产品侧决定「2024-09 之后、两家完全对齐」 */
const WINDOW_START = process.env.WINDOW_START ?? '2024-09-01';
/** 精度不足的日期落在这个缓冲区内时，标记为「窗口边界不确定」而不是悄悄收录 */
const WINDOW_FUZZ_DAYS = 45;

const VENDORS = [
  {
    id: 'apple',
    name: 'Apple',
    nameZh: '苹果',
    accentColor: '#0071e3',
    motif: 'apple',
    country: 'US',
  },
  {
    id: 'huawei',
    name: 'HUAWEI',
    nameZh: '华为',
    accentColor: '#cf0a2c',
    motif: 'petal',
    country: 'CN',
  },
];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/**
 * 发布日期取证表：61 条人工核对的上市日期，带来源 URL 与取证说明。
 *
 * 它**不是运行产物，是 curated 数据**，因此放在 data/ 里跟快照一起入库。
 * 曾经放在 _work/ 下，而 _work/ 在 .gitignore 里 —— 后果是 CI 全新 checkout
 * 后拿不到这张表，60 台全部因「无发布日期」被窗口过滤丢掉，闸门拒绝写盘，
 * 自动同步每一次都以失败告终。迁到 data/ 根治。
 *
 * 读取顺序：data/（入库版，权威）→ _work/（本地旧路径，兼容）。
 */
function readReleaseDates() {
  const candidates = [join(DATA, 'release-dates.json'), join(WORK, 'release-dates.json')];
  for (const p of candidates) {
    if (existsSync(p)) return readJson(p);
  }
  return null;
}

function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path); // 同目录 rename：要么是旧的完整文件，要么是新的完整文件
}

function main() {
  const dry = process.argv.includes('--dry');
  const normalizedPath = join(WORK, 'normalized.json');
  if (!existsSync(normalizedPath)) {
    console.error(`缺少 ${normalizedPath}：请先跑 node scripts/normalize/index.mjs`);
    process.exit(1);
  }

  const products = readJson(normalizedPath);
  const releaseDates = readReleaseDates();
  const previous = existsSync(join(DATA, 'products.json')) ? readJson(join(DATA, 'products.json')) : null;

  const notes = [];

  // ---- 1. 发布日期回填 -------------------------------------------------
  if (releaseDates?.entries) {
    const byId = new Map(releaseDates.entries.map((e) => [e.id, e]));
    for (const p of products) {
      const e = byId.get(p.id);
      if (!e?.date) continue;
      if (!p.releaseDate) {
        p.releaseDate = e.date;
        p.releaseDatePrecision = e.precision ?? 'day';
        p.provenance = { ...(p.provenance ?? {}), releaseDate: e.source === 'apple-official' ? 'apple-official' : 'manual' };
        p.releaseDateSourceUrl = e.sourceUrl ?? null;
      } else if (p.releaseDate !== e.date) {
        notes.push(`${p.id} 发布日期冲突：规格页/其它来源 ${p.releaseDate}，取证结果 ${e.date}（采用取证结果）`);
        p.releaseDate = e.date;
        p.releaseDatePrecision = e.precision ?? 'day';
        p.releaseDateSourceUrl = e.sourceUrl ?? null;
      }
    }
  } else {
    notes.push('未找到 _work/release-dates.json，发布日期字段将保持缺失');
  }

  // ---- 2. 窗口过滤 -----------------------------------------------------
  const windowStart = Date.parse(WINDOW_START);
  const kept = [];
  const dropped = [];
  for (const p of products) {
    const t = p.releaseDate ? Date.parse(p.releaseDate) : Number.NaN;
    if (Number.isNaN(t)) {
      dropped.push({ id: p.id, reason: '无发布日期，无法判定是否在窗口内' });
      continue;
    }
    if (t < windowStart) {
      const fuzz = p.releaseDatePrecision !== 'day' && windowStart - t <= WINDOW_FUZZ_DAYS * 86400000;
      if (fuzz) {
        p.windowNote = `发布日期精度为 ${p.releaseDatePrecision}，恰好压在 ${WINDOW_START} 边界上`;
        kept.push(p);
      } else {
        dropped.push({ id: p.id, reason: `发布于 ${p.releaseDate}，早于窗口起点 ${WINDOW_START}` });
      }
      continue;
    }
    kept.push(p);
  }

  // ---- 3. 首末次出现时间 -----------------------------------------------
  const prevById = new Map((previous?.products ?? []).map((p) => [p.id, p]));
  const now = new Date().toISOString();
  for (const p of kept) {
    const prev = prevById.get(p.id);
    p.firstSeenAt = prev?.firstSeenAt ?? now;
    p.lastSeenAt = now;
  }

  // ---- 4. 快照 ---------------------------------------------------------
  const brands = [...new Set(kept.map((p) => p.brand))];
  const snapshot = {
    generatedAt: now,
    windowStart: WINDOW_START,
    sources: {
      'apple-official': { fetchedAt: now, note: `苹果官网规格页`, ok: kept.some((p) => p.brand === 'apple') },
      'huawei-official': { fetchedAt: now, note: `华为官网规格页`, ok: kept.some((p) => p.brand === 'huawei') },
      'release-dates': {
        fetchedAt: releaseDates?.generatedAt ?? null,
        note: releaseDates ? `${releaseDates.entries?.length ?? 0} 条取证，${releaseDates.unresolved?.length ?? 0} 条未解决` : '缺失',
        ok: Boolean(releaseDates),
      },
    },
    vendors: VENDORS.filter((v) => brands.includes(v.id)),
    products: kept.sort((a, b) => a.id.localeCompare(b.id)),
  };

  // ---- 5. 闸门 ---------------------------------------------------------
  const failures = validate(snapshot, previous);
  const report = {
    generatedAt: now,
    windowStart: WINDOW_START,
    kept: kept.length,
    dropped,
    notes,
    coverage: coverageReport(snapshot),
    failures,
  };
  atomicWrite(join(WORK, 'sync-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`窗口 ${WINDOW_START} 起：收录 ${kept.length} 台，丢弃 ${dropped.length} 台`);
  console.log(`覆盖：${report.coverage.join(' | ')}`);
  if (notes.length) console.log(`注意：\n  - ${notes.join('\n  - ')}`);

  if (failures.length) {
    console.error(`\n❌ 闸门未通过（${failures.length} 项），拒绝写盘，保留上一版快照：`);
    for (const f of failures.slice(0, 20)) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✅ 闸门全部通过');

  // ---- 6. 派生层（构建期产物，不入库） ---------------------------------
  const scales = buildScales(snapshot.products);
  const derived = {
    generatedAt: now,
    scales: Object.fromEntries(
      Object.entries(scales).map(([k, s]) => [
        k,
        { label: s.label, unit: s.unit, dir: s.dir, coverage: Number(s.coverage.toFixed(3)), pool: s.values.length, enough: s.enough },
      ]),
    ),
    champions: buildChampions(snapshot.products, scales),
    products: snapshot.products.map((p) => ({
      id: p.id,
      persona: buildPersona(p, snapshot.products, scales),
      percentiles: Object.fromEntries(Object.keys(scales).map((k) => [k, percentileOf(scales, k, p)])),
    })),
  };

  if (dry) {
    console.log('（--dry：不写盘）');
  } else {
    atomicWrite(join(DATA, 'products.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    atomicWrite(join(WORK, 'derived.json'), `${JSON.stringify(derived, null, 2)}\n`);
    console.log(`已写入 data/products.json（${snapshot.products.length} 台）与 _work/derived.json`);
  }

  console.log('\n首页头衔：');
  for (const c of derived.champions) {
    console.log(c.insufficient ? `  ${c.title}：数据不足 —— ${c.insufficient}` : `  ${c.title}：${c.productId}（${c.why}）`);
  }
}

main();
