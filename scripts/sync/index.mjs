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
 *   data/discovery-pending.json  待收录队列（提交入库，见下方说明）
 *   _work/derived.json        标尺/头衔/定位（构建期产物，不入库，供检查）
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDORS } from '../brands.mjs';
import {
  buildChampions,
  buildPersona,
  buildScalesByCategory,
  deriveCpuCores,
  percentileOf,
} from '../lib/derive.mjs';
import { applyOverrides, loadOverrides, validateOverrides } from '../lib/overrides.mjs';
import { flattenSpecs, SPEC_GROUPS } from '../lib/specs.mjs';
import { WINDOW_FUZZ_DAYS, windowStartEffective } from '../lib/window.mjs';
import { buildQueueFile, classifyByWindow } from './queue.mjs';
import { coverageReport, validate } from './validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = join(ROOT, '_work');
const DATA = join(ROOT, 'data');

/** 窗口：产品侧决定「2024-09 之后、两家完全对齐」。真源在 lib/window.mjs，env 可覆盖 */
const WINDOW_START = windowStartEffective();

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
  const previous = existsSync(join(DATA, 'products.json'))
    ? readJson(join(DATA, 'products.json'))
    : null;

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
        p.provenance = {
          ...(p.provenance ?? {}),
          releaseDate: e.source === 'apple-official' ? 'apple-official' : 'manual',
        };
        p.releaseDateSourceUrl = e.sourceUrl ?? null;
      } else if (p.releaseDate !== e.date) {
        notes.push(
          `${p.id} 发布日期冲突：规格页/其它来源 ${p.releaseDate}，取证结果 ${e.date}（采用取证结果）`,
        );
        p.releaseDate = e.date;
        p.releaseDatePrecision = e.precision ?? 'day';
        // 值被人工取证覆盖了，来源标注必须跟着改，否则 provenance 继续谎称官网来源
        p.provenance = {
          ...(p.provenance ?? {}),
          releaseDate: e.source === 'apple-official' ? 'apple-official' : 'manual',
        };
        p.releaseDateSourceUrl = e.sourceUrl ?? null;
      }
    }
  } else {
    notes.push('未找到 _work/release-dates.json，发布日期字段将保持缺失');
  }

  // ---- 2. 窗口过滤 -----------------------------------------------------
  // 判据在 scripts/sync/queue.mjs（纯函数，自测直接 import 它）。
  const { kept, dropped, pending: rawPending } = classifyByWindow(products, {
    windowStart: WINDOW_START,
    windowFuzzDays: WINDOW_FUZZ_DAYS,
  });

  // ---- 3. v2 拍平 + 用户数据层合并 --------------------------------------
  //
  // 拍平：normalize 层仍按手机结构产出（body/display/…），这里统一搬进 specs 容器
  // （scripts/lib/specs.mjs 的 flattenSpecs），品类无关的身份字段留顶层。
  // 这样 normalize 一千七百行不用动，而 products.json 落盘即为 v2 全品类形状。
  //
  // category：由数据源层声明（normalize/index.mjs 出口，手机通道即 'phone'），
  // 本层不再兜底。曾经的 `if (!p.category) p.category = 'phone'` 写在闸门之前，
  // 让 validate.mjs 的「品类缺失或未注册」永远看不到缺失值 —— 闸门注释声称
  // 「缺失也拒绝」，实现却静默放行，违约机型会按错误的字段表渲染且零报错。
  // 现在：normalize 漏声明 ⇒ 闸门拦 ⇒ 拒绝写盘，错误当场可见。
  for (const p of kept) {
    p.specs = flattenSpecs(p);
    // 拍平后**删掉旧的嵌套组**。双真源比没有 specs 更危险：
    // 用户改了 specs['display.sizeIn']，而顶层 display.sizeIn 还是官网旧值——
    // pick 是 specs-first 所以闸门/派生/前端读不到旧值，但归档、指纹、
    // 任何直接读嵌套的下游都会拿到旧值，且没有任何报错。
    for (const g of SPEC_GROUPS) delete p[g];
  }

  // 用户数据层：每次同步重新应用。官网刷新不会冲掉用户数据——
  // overrides.json 与 products.json 相互独立，管线只读不写前者。
  // 先 validateOverrides 再过 applyOverrides：引用悬空/字段未注册/类型区间错误
  // 一律拒绝写盘，不静默跳过。
  const overrides = loadOverrides();
  const overrideErrors = validateOverrides(overrides, kept);
  if (overrideErrors.length) {
    console.error(`\n❌ 用户数据层校验未通过（${overrideErrors.length} 项），拒绝写盘：`);
    for (const e of overrideErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const { products: merged, report: overrideReport } = applyOverrides(kept, overrides);

  // ---- 3b. 派生事实：CPU 核心数 ------------------------------------------
  // 官网/macDB 的「芯片配置」原文（如「Performance Core × 2+Efficiency Core × 4+GPU × 4」）
  // 已写明核心数，加法导出即可；缺失时补挂，provenance 标 'derived'（类型契约见 src/lib/types.ts）。
  // 只算术、不外推：config 解析不出就保持缺失（'—'）。
  let derivedCores = 0;
  for (const p of merged) {
    if (p.specs?.['chipset.cpuCores'] != null) continue;
    const cores = deriveCpuCores(p.specs?.['chipset.config']);
    if (cores == null) continue;
    p.specs['chipset.cpuCores'] = cores;
    p.provenance = { ...(p.provenance ?? {}), 'chipset.cpuCores': 'derived' };
    derivedCores++;
  }

  // 待收录队列只列「还没上站」的：用户层 add-product 显式收录的机型（即使缺发布日期）
  // 已经在册。不过滤的话队列会诱导人工去补 release-dates 取证，而那会让管线也产出
  // 同 id 机型，与 add-product 撞 id —— 双真源比没有数据更危险。
  // （2026-10-15 iPhone 全代 add-product 后实测：29 台老机型被重复列入队列。）
  const inCatalog = new Set(merged.map((p) => p.id));
  const pending = rawPending.filter((q) => !inCatalog.has(q.id));

  // ---- 4. 首末次出现时间 -----------------------------------------------
  const prevById = new Map((previous?.products ?? []).map((p) => [p.id, p]));
  const now = new Date().toISOString();
  for (const p of merged) {
    const prev = prevById.get(p.id);
    p.firstSeenAt = prev?.firstSeenAt ?? now;
    p.lastSeenAt = now;
  }

  // ---- 5. 快照 ---------------------------------------------------------
  // merged = 官网窗口内机型 + 用户数据层新增机型。用户显式 add-product 的机器
  // 不过窗口过滤（显式收录），但「发布日期在未来」等闸门仍然拦它。
  const brands = [...new Set(merged.map((p) => p.brand))];
  const snapshot = {
    generatedAt: now,
    windowStart: WINDOW_START,
    sources: {
      'apple-official': {
        fetchedAt: now,
        note: `苹果官网规格页`,
        // 展示走语言包（2026-10-14 i18n 深扫）：note 是管线拼的中文串，
        // 英文页会原样吐中文。noteKey + noteParams 让前端按语言渲染，
        // 数字作为插值参数而不是写死在句子里（否则「64 条取证」没法双语）。
        noteKey: 'about.sourceAppleOfficial',
        ok: merged.some((p) => p.brand === 'apple'),
      },
      'huawei-official': {
        fetchedAt: now,
        note: `华为官网规格页`,
        noteKey: 'about.sourceHuaweiOfficial',
        ok: merged.some((p) => p.brand === 'huawei'),
      },
      'release-dates': {
        fetchedAt: releaseDates?.generatedAt ?? null,
        note: releaseDates
          ? `${releaseDates.entries?.length ?? 0} 条取证，${releaseDates.unresolved?.length ?? 0} 条未解决`
          : '缺失',
        noteKey: releaseDates ? 'about.sourceReleaseDates' : 'about.sourceMissing',
        noteParams: releaseDates
          ? {
              total: releaseDates.entries?.length ?? 0,
              unresolved: releaseDates.unresolved?.length ?? 0,
            }
          : undefined,
        ok: Boolean(releaseDates),
      },
      'user-manual': {
        fetchedAt: null,
        note: overrides.entries?.length
          ? `${overrides.entries.length} 条用户数据，本轮生效 ${overrideReport.applied.length} 条`
          : '无用户数据',
        noteKey: overrides.entries?.length ? 'about.sourceUserManual' : 'about.sourceUserEmpty',
        noteParams: overrides.entries?.length
          ? { total: overrides.entries.length, applied: overrideReport.applied.length }
          : undefined,
        ok: true,
      },
    },
    vendors: VENDORS.filter((v) => brands.includes(v.id)),
    products: merged.sort((a, b) => a.id.localeCompare(b.id)),
  };

  // ---- 6. 闸门 ---------------------------------------------------------
  // appliedIds：本层 add-product 已并入 snapshot 的 id。不传的话 validate 里的
  // 用户数据层校验会拿 snapshot.products（已含新增机型）对比 add-product 的 id，
  // 「自己冲突自己」永远误报（2026-10-13 实测踩过，修复见 overrides.mjs 的 excludeIds）。
  const failures = validate(snapshot, previous, {
    overrides,
    appliedIds: overrideReport.added.map((a) => a.productId),
  });
  const report = {
    generatedAt: now,
    windowStart: WINDOW_START,
    kept: merged.length,
    dropped,
    pending,
    notes,
    coverage: coverageReport(snapshot),
    failures,
    overrides: overrideReport,
  };
  atomicWrite(join(WORK, 'sync-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`窗口 ${WINDOW_START} 起：官网收录 ${kept.length} 台，丢弃 ${dropped.length} 台`);
  if (overrideReport.added.length) {
    console.log(`用户数据层新增 ${overrideReport.added.length} 台，最终在册 ${merged.length} 台`);
  }
  console.log(`覆盖：${report.coverage.join(' | ')}`);
  if (notes.length) console.log(`注意：\n  - ${notes.join('\n  - ')}`);
  if (pending.length) {
    console.log(
      `\n⚠️ 待收录 ${pending.length} 台（缺发布日期，需人工补 data/release-dates.json）：`,
    );
    for (const q of pending) console.log(`  - ${q.brand} ${q.id} ${q.nameZh ?? q.name ?? ''}`);
    console.log('   已记入 data/discovery-pending.json');
  }

  if (failures.length) {
    console.error(`\n❌ 闸门未通过（${failures.length} 项），拒绝写盘，保留上一版快照：`);
    for (const f of failures.slice(0, 20)) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✅ 闸门全部通过');

  // 用户数据层生效明细：改了什么、盖掉了哪个官网值，全部可见（回查走 _work/sync-report.json）
  if (overrideReport.applied.length) {
    console.log(`用户数据层：生效 ${overrideReport.applied.length} 条`);
    for (const r of overrideReport.replaced) {
      console.log(
        `  - ${r.productId} ${r.field}：${JSON.stringify(r.from)} → ${JSON.stringify(r.to)}（${r.id}）`,
      );
    }
    for (const r of overrideReport.erased) {
      console.log(`  - ${r.productId} ${r.field}：抹除官网值 ${JSON.stringify(r.from)}（${r.id}）`);
    }
    for (const c of overrideReport.conflicts) {
      console.log(`  - 冲突：${c.productId} ${c.field} 多条覆盖，生效 ${c.winner}`);
    }
  }

  // ---- 6. 派生层（构建期产物，不入库） ---------------------------------
  // 2026-10-15 六品类扩充：标尺/头衔/分位全部按品类分池（derive.mjs 的
  // buildScalesByCategory 说明：phone 与 tablet 共用克/英寸口径，混池会让
  // iPad mini 静默拿走手机头衔）。
  const scalesByCategory = buildScalesByCategory(snapshot.products);
  const catOf = (p) => p.category ?? 'phone';
  const derived = {
    generatedAt: now,
    scales: Object.fromEntries(
      Object.entries(scalesByCategory).map(([cat, scales]) => [
        cat,
        Object.fromEntries(
          Object.entries(scales).map(([k, s]) => [
            k,
            {
              label: s.label,
              unit: s.unit,
              dir: s.dir,
              coverage: Number(s.coverage.toFixed(3)),
              pool: s.values.length,
              enough: s.enough,
            },
          ]),
        ),
      ]),
    ),
    champions: buildChampions(snapshot.products, scalesByCategory),
    products: snapshot.products.map((p) => {
      const catScales = scalesByCategory[catOf(p)] ?? {};
      return {
        id: p.id,
        persona: buildPersona(p, snapshot.products, scalesByCategory),
        percentiles: Object.fromEntries(
          Object.keys(catScales).map((k) => [k, percentileOf(catScales, k, p)]),
        ),
      };
    }),
  };

  if (dry) {
    console.log('（--dry：不写盘）');
  } else {
    atomicWrite(join(DATA, 'products.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    atomicWrite(join(WORK, 'derived.json'), `${JSON.stringify(derived, null, 2)}\n`);
    /**
     * 队列文件：**入库**（data/ 顶层 JSON），与 release-dates.json 同理 ——
     * 它是「等人工补一句话」的可行动清单，躺在 _work/ 里就等于没有。
     *
     * 内容里**不能有任何时间戳**（见 queue.mjs 的 buildQueueFile 说明），
     * 否则每轮都变，CI 每 12 小时一次空提交。
     * 只有队列非空时才写：空队列不必在版本库里留一个空文件当噪音，
     * 但真的从有到无时必须删掉旧文件，否则会留一条已经解决掉的待办。
     */
    const queuePath = join(DATA, 'discovery-pending.json');
    if (pending.length) {
      const queue = buildQueueFile(pending, { windowStart: WINDOW_START });
      atomicWrite(queuePath, `${JSON.stringify(queue, null, 2)}\n`);
    } else if (existsSync(queuePath)) {
      rmSync(queuePath);
      console.log(
        '队列已清空（补齐发布日期或机型离开官网目录），已删除 data/discovery-pending.json',
      );
    }
    console.log(
      `已写入 data/products.json（${snapshot.products.length} 台）与 _work/derived.json` +
        (pending.length ? `，待收录 ${pending.length} 台入 data/discovery-pending.json` : ''),
    );
  }

  console.log('\n首页头衔（分品类）：');
  for (const [cat, list] of Object.entries(derived.champions)) {
    console.log(`  [${cat}]`);
    for (const c of list) {
      console.log(
        c.insufficient
          ? `    ${c.title}：数据不足 —— ${c.insufficient}`
          : `    ${c.title}：${c.productId}（${c.why}）`,
      );
    }
  }
}

main();
