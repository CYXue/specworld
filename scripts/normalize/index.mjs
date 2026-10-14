/**
 * 规范化层：把华为/苹果官网的原始键值对，映射成 `ProductRecord`（见 docs/DATA-CONTRACT.md）。
 *
 * 用法：
 *   node scripts/normalize/index.mjs --out _work/normalized.json
 *   node scripts/normalize/index.mjs --out _work/normalized.json --probe   # 附：未映射的原始键
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 这一层是全站最核心的资产，也是唯一一处「机器读不出来的判断」的落点。
 * 纪律（与 parse.mjs 一致，绝不违反）：
 *   1. 解析不出来就是 null。不写 0、不写 '-'、不写空串、不写平均值、不写估算值。
 *   2. 数值必须带口径。电池容量有值 → capacityCaliber 必有值；亮度峰值/典型分列。
 *   3. 每个核心字段都留 provenance，让「这个数从哪来」可回答。
 *   4. 跨口径永不混算：亮度峰值 < 典型时两个都判为不可信（置 null 并记 note）。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 三条通道与优先级：
 *   A. 华为规格页   _work/huawei.raw.json        每台一个 slug，直接映射
 *   B. 苹果规格页   _work/apple.raw.json         页面按机型名分段（18 Pro 页含 18 Pro Max）
 *   C. 苹果对比页   _work/apple-compare.raw.json 粒度更粗，**只补规格页拿不到的机型**
 *   优先级：规格页 > 对比页矩阵。同一字段两处都有 → 用规格页，矩阵只填空缺；
 *   走通道 C 的机型 granularity 记 `compare-matrix`，相应字段 provenance 记 `apple-compare`。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 已知的「官网真没有」（不是没解析到，见文末 REPORT_NOTES）：
 *   · 苹果从不公布电池容量(mAh)、RAM、充电器额定功率 → 一律 null
 *   · 华为 50 台里 20 台官网没有「处理器」章节 → chipset.name = null，绝不从型号名猜
 *   · 华为规格页不公布屏幕亮度(nits)；苹果对比页不公布电池容量
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowStartEffective } from '../lib/window.mjs';
import { mapAppleSpecs, mapAppleCompare, APPLE_SHARED_MARK } from './brands/apple.mjs';
import { mapHuawei } from './brands/huawei.mjs';
import { sliceByVariants, stripInvisible } from './parse.mjs';
import { put, putObject, addNote, tidy, AP, AC } from './shared.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = join(ROOT, '_work');
const SRC_HUAWEI = join(WORK, 'huawei.raw.json');
const SRC_APPLE = join(WORK, 'apple.raw.json');
const SRC_APPLE_COMPARE = join(WORK, 'apple-compare.raw.json');
const SRC_APPLE_PRICES = join(WORK, 'apple-prices.raw.json');

const CONTRACT_PATHS = [
  'body.heightMm',
  'body.widthMm',
  'body.thicknessMm',
  'body.weightG',
  'body.ipRating',
  'body.material',
  'body.colors',
  'display.sizeIn',
  'display.type',
  'display.resolutionPx',
  'display.ppi',
  'display.refreshHz',
  'display.brightnessTypicalNits',
  'display.brightnessPeakNits',
  'display.protection',
  'chipset.name',
  'chipset.processNm',
  'chipset.cpuCores',
  'chipset.gpu',
  'chipset.npu',
  'memory.ramGb',
  'memory.storageGb',
  'battery.capacityMah',
  'battery.capacityCaliber',
  'battery.wiredChargeW',
  'battery.wirelessChargeW',
  'battery.vendorClaimedVideoHours',
  'battery.measuredHours',
  'camera.rear',
  'camera.front',
  'camera.videoMax',
  'connectivity.fiveG',
  'connectivity.wifi',
  'connectivity.bluetooth',
  'connectivity.nfc',
  'connectivity.satellite',
  'connectivity.usb',
  'connectivity.sim',
  'connectivity.esim',
  'os.launch',
  'os.upgradableTo',
  'skus',
];

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, p, v) => {
  const ks = p.split('.');
  const last = ks.pop();
  let cur = o;
  for (const k of ks) cur = cur[k];
  cur[last] = v;
};

const isEmpty = (v) =>
  v === null ||
  v === undefined ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && v !== null && Object.keys(v).length === 0);

/**
 * 把矩阵记录合并进规格页记录：**只填空缺，绝不覆盖**。
 * 被矩阵补上的字段 provenance 改成 apple-compare，让「这个数粒度更粗」在数据里可见；
 * 整机 granularity 保持 specs-page（因为主体来自规格页）。
 */
function mergeMissing(primary, filler) {
  const filled = [];
  for (const path of CONTRACT_PATHS) {
    if (path === 'display.resolutionPx') {
      const a = getPath(primary, path);
      const b = getPath(filler, path);
      if (isEmpty(a) && !isEmpty(b)) {
        setPath(primary, path, b);
        // 父路径与子路径一并登记，与 putObject 的口径一致
        putObject(primary, path, b, AC, ['w', 'h']);
        filled.push(path);
      }
      continue;
    }
    const a = getPath(primary, path);
    if (!isEmpty(a)) continue;
    const b = getPath(filler, path);
    if (isEmpty(b)) continue;
    setPath(primary, path, b);
    primary.provenance[path] = AC;
    filled.push(path);
  }
  for (const [k, v] of Object.entries(filler.rawOfficial)) {
    if (!primary.rawOfficial[k]) primary.rawOfficial[k] = v;
  }
  for (const n of filler.notes) addNote(primary, n);
  if (filled.length) {
    addNote(
      primary,
      `以下字段规格页没有、由对比页矩阵补位（provenance=apple-compare）：${filled.join('、')}`,
    );
  }
  return primary;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. 覆盖率表
 * ══════════════════════════════════════════════════════════════════════════ */

/** 契约里所有「应该有值」的叶子字段 */
const COVERAGE_FIELDS = [
  'body.heightMm',
  'body.widthMm',
  'body.thicknessMm',
  'body.weightG',
  'body.ipRating',
  'body.material',
  'body.colors',
  'display.sizeIn',
  'display.type',
  'display.resolutionPx',
  'display.ppi',
  'display.refreshHz',
  'display.brightnessTypicalNits',
  'display.brightnessPeakNits',
  'display.protection',
  'chipset.name',
  'chipset.cpuCores',
  'chipset.gpu',
  'chipset.npu',
  'memory.ramGb',
  'memory.storageGb',
  'battery.capacityMah',
  'battery.capacityCaliber',
  'battery.wiredChargeW',
  'battery.wirelessChargeW',
  'battery.vendorClaimedVideoHours',
  'camera.rear',
  'camera.front',
  'camera.videoMax',
  'connectivity.fiveG',
  'connectivity.wifi',
  'connectivity.bluetooth',
  'connectivity.nfc',
  'connectivity.satellite',
  'connectivity.usb',
  'connectivity.sim',
  'connectivity.esim',
  'os.launch',
  'skus',
  'provenance',
];

const hasValue = (p, path) => {
  const v = path === 'provenance' ? Object.keys(p.provenance ?? {}).length : getPath(p, path);
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
};

function printCoverage(products) {
  const total = products.length;
  const printGroup = (label, list) => {
    console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}`);
    const rows = list.map((path) => [path, products.filter((p) => hasValue(p, path)).length]);
    const w = Math.max(...rows.map(([p]) => p.length));
    for (const [path, n] of rows) {
      const pct = ((n / total) * 100).toFixed(1).padStart(5);
      const bar = '█'.repeat(Math.round((n / total) * 24)).padEnd(24, '·');
      console.log(`  ${path.padEnd(w)}  ${String(n).padStart(3)}/${total}  ${pct}%  ${bar}`);
    }
  };

  printGroup('总体（三通道合计）', COVERAGE_FIELDS);

  for (const [key, label] of [
    ['huawei', '华为规格页（通道 A）'],
    ['apple-specs', '苹果规格页（通道 B）'],
    ['apple-compare', '苹果对比页矩阵（通道 C）'],
  ]) {
    const sub = products.filter((p) =>
      key === 'huawei'
        ? p.brand === 'huawei'
        : key === 'apple-specs'
          ? p.brand === 'apple' && p.granularity === 'specs-page'
          : p.brand === 'apple' && p.granularity === 'compare-matrix',
    );
    if (!sub.length) {
      console.log(`\n── ${label} ──\n  （无机型）`);
      continue;
    }
    console.log(`\n${'═'.repeat(72)}\n${label}：${sub.length} 台`);
    const rows = COVERAGE_FIELDS.map((path) => [path, sub.filter((p) => hasValue(p, path)).length]);
    const w = Math.max(...rows.map(([p]) => p.length));
    for (const [path, n] of rows) {
      const pct = ((n / sub.length) * 100).toFixed(1).padStart(5);
      const bar = '█'.repeat(Math.round((n / sub.length) * 24)).padEnd(24, '·');
      console.log(`  ${path.padEnd(w)}  ${String(n).padStart(3)}/${sub.length}  ${pct}%  ${bar}`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8. 入口
 * ══════════════════════════════════════════════════════════════════════════ */

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  const outPath = argValue('--out', join(WORK, 'normalized.json'));
  const probe = process.argv.includes('--probe');

  const huawei = JSON.parse(readFileSync(SRC_HUAWEI, 'utf8'));
  const apple = JSON.parse(readFileSync(SRC_APPLE, 'utf8'));

  /* --- 通道 A：华为规格页 --- */
  const huaweiRecords = huawei.products.map(mapHuawei);

  /* --- 通道 B：苹果规格页（按机型拆分）---
   * 一个规格页可能含多个机型：适配器已按机型拆成独立 product（apple-iphone-18-pro /
   * apple-iphone-18-pro-max，specsUrl 相同），并写出「两种机型均具备」公共段。
   * 这里再跑一遍 sliceByVariants 做「切得开」的自证：切不开时按公共段共享处理，不瞎切。
   */
  const pageIndex = new Map();
  for (const p of apple.products) {
    const list = pageIndex.get(p.specsUrl) ?? [];
    list.push(p);
    pageIndex.set(p.specsUrl, list);
  }
  const specsRecords = [];
  for (const p of apple.products) {
    const rec = mapAppleSpecs(p);
    const siblings = (pageIndex.get(p.specsUrl) ?? []).map((x) => stripInvisible(x.name));
    if (siblings.length > 1) {
      const sharedText = Object.entries(p.raw)
        .filter(([k]) => APPLE_SHARED_MARK.test(k))
        .map(([, v]) => tidy(v))
        .join(' | ');
      const sliced = sliceByVariants(sharedText, siblings);
      addNote(
        rec,
        `规格页 ${p.specsUrl} 同时包含 ${siblings.length} 个机型（${siblings.join(' / ')}）；` +
          `本机数据由「按机型名分段」拆出，公共段（两种机型均具备）由全部变体共享。` +
          `sliceByVariants 结果：${sliced ? `切出 ${Object.keys(sliced).join('、')}` : '未命中机型名，公共段整体共享'}`,
      );
      rec.rawOfficial['同页拆分'] = `页面机型：${siblings.join(' / ')}；本机取「${rec.name}」段`;
    }
    specsRecords.push(rec);
  }

  /* --- 通道 C：苹果对比页矩阵（只补规格页拿不到的机型）---
   * 矩阵一次给出全部 42 款（含 iPhone 7/8/X 这些早于窗口的老机型）。
   * 这里按「首版范围」剪裁：只收 (a) 已有的发布日期取证落 2024-09 之后的，
   * 或 (b) 取证表里没有但名字能看出是 16 代及以后的。其余不进产出 ——
   * 它们注定会被 sync 的窗口过滤丢掉，留在中间文件里只会污染覆盖率表。
   */
  // 真源在 lib/window.mjs —— 与 sync 闸门同一处定义，且同用 windowStartEffective()
  // 吃 env 覆盖；只引默认值字面量的话，设了 WINDOW_START 会出现
  // 「normalize 按默认窗口丢机型、sync 按 env 窗口放行」的静默分叉。
  const WINDOW_START = windowStartEffective();
  // 取证表是 curated 数据，权威副本在 data/（入库）；_work/ 只是本地兼容路径
  const rdPath = [join(ROOT, 'data', 'release-dates.json'), join(WORK, 'release-dates.json')].find(
    (p) => existsSync(p),
  );
  const releaseDates = rdPath ? JSON.parse(readFileSync(rdPath, 'utf8')) : null;
  const dateById = new Map((releaseDates?.entries ?? []).map((e) => [e.id, e]));
  /** 名字里能直接读出「16 代及以后」的写法 —— 已废弃：用名字反推收录资格属于估算。
   *  缺日期的机型不再在这里猜，直接放行交给 sync：sync 的窗口过滤会把它们
   *  分类成 pending 并写入待收录队列（唯一正确的去向），而不是静默消失。 */

  let compare = null;
  let compareRecords = [];
  let compareDropped = [];
  let compareStatus = 'not-found';
  if (existsSync(SRC_APPLE_COMPARE)) {
    compare = JSON.parse(readFileSync(SRC_APPLE_COMPARE, 'utf8'));
    const specIds = new Set(apple.products.map((p) => p.id));
    const gapOnly = compare.products.filter((p) => !specIds.has(p.id));
    for (const p of gapOnly) {
      const dated = dateById.get(p.id);
      // 只有「有取证日期且明确落在窗口外」的才在这里剪掉；
      // 缺日期的交给 sync 分类（missing-date → 待收录队列），不做名字估算。
      const outOfWindow = dated?.date
        ? Date.parse(dated.date) < Date.parse(WINDOW_START)
        : false;
      if (!outOfWindow) compareRecords.push(mapAppleCompare(p));
      else compareDropped.push({ id: p.id, name: p.name, date: dated.date });
    }
    compareStatus =
      `就绪（矩阵 ${compare.products.length} 台；其中规格页没有的 ${gapOnly.length} 台，` +
      `落在首发窗口内 ${compareRecords.length} 台 → 作为独立机型收录，窗口外 ${compareDropped.length} 台不收）`;
  } else {
    compareStatus =
      '未就绪：_work/apple-compare.raw.json 不存在 → 本次跳过通道 C，不产出矩阵补位机型';
  }

  /* --- 合并：规格页 > 对比页矩阵，矩阵只补空缺 --- */
  if (compare) {
    const specIds = new Set(specsRecords.map((r) => r.id));
    const fillers = new Map();
    for (const p of compare.products) {
      if (!specIds.has(p.id)) continue;
      fillers.set(p.id, mapAppleCompare(p));
    }
    for (const rec of specsRecords) {
      const filler = fillers.get(rec.id);
      if (filler) mergeMissing(rec, filler);
    }
  }

  const byId = new Map();
  for (const r of [...huaweiRecords, ...specsRecords, ...compareRecords]) byId.set(r.id, r);

  /* --- 通道 D：苹果官方价格（购买页内联 JSON，逐 SKU 三重重验证）---
   * apple-prices.raw.json 的 products[] 每台带 startPriceCny + pricesByStorage。
   * 价格来源与规格页是两个页面、两套口径，所以 provenance 记的是 apple-official（价格通道），
   * 价格缺失的机型（官网已停售）保持 skus = []，对比页「起售价」行会如实显示「官网已下架」。
   */
  let pricesStatus = '未就绪';
  if (existsSync(SRC_APPLE_PRICES)) {
    const prices = JSON.parse(readFileSync(SRC_APPLE_PRICES, 'utf8'));
    const priceById = new Map((prices.products ?? []).map((p) => [p.id, p]));
    let attached = 0;
    for (const rec of byId.values()) {
      if (rec.brand !== 'apple') continue;
      const src = priceById.get(rec.id);
      if (!src || !src.pricesByStorage?.length) continue;
      rec.skus = src.pricesByStorage.map((s) => ({
        storageGb: s.storageGb,
        ramGb: null, // 苹果按存储档定价，但 RAM 不随存储变化且官方不公布，不在此处猜测
        priceCny: s.priceCny,
        priceNote: src.priceScope ?? '官方指导价（中国大陆）',
        listedAt: (src.fetchedAt ?? '').slice(0, 10),
      }));
      put(rec, 'skus', rec.skus, AP);
      attached += 1;
    }
    pricesStatus = `就绪（${(prices.products ?? []).length} 台有价；本次接入 ${attached} 台；已停售无价 ${prices.missing?.length ?? 0} 台 → skus 留空，不编造）`;
  }

  const products = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  /* --- 一致性自检：不能静默出错的地方，直接在这里喊 --- */
  const problems = [];
  const ids = new Set();
  for (const p of products) {
    if (ids.has(p.id)) problems.push(`id 重复：${p.id}`);
    ids.add(p.id);
    if (p.releaseDate !== null)
      problems.push(`${p.id} releaseDate 应由 sync 回填，规范化层不应写入`);
    if (p.battery.capacityMah !== null && !p.battery.capacityCaliber) {
      problems.push(`${p.id} 有电池容量但缺口径（capacityCaliber）`);
    }
    for (const path of [
      'body.weightG',
      'display.sizeIn',
      'battery.capacityMah',
      'memory.storageGb',
      'body.thicknessMm',
      'display.ppi',
      'display.resolutionPx',
      'battery.wiredChargeW',
      'chipset.name',
      'camera.rear',
      'connectivity.sim',
    ]) {
      const v = getPath(p, path);
      if (isEmpty(v)) continue;
      // putObject 会同时登记父路径与子路径，所以这里查父路径就够。
      // （修复前这里硬编码查 `.w`，而登记侧写的是 `.w`、父路径反而空着，
      //   两边口径不一致才让 sync/validate.mjs 对每台机器都报假警。）
      if (!p.provenance[path]) {
        problems.push(`${p.id} 的 ${path} 有值但缺 provenance`);
      }
    }
    if (p.skus?.length && !p.provenance.skus) {
      problems.push(`${p.id} 有 skus 但缺 provenance`);
    }
  }

  /* --- 写盘 --- */
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(products, null, 2)}\n`, 'utf8');

  /* --- 报告 --- */
  console.log('手机参数对比站 · 规范化层');
  console.log(`输入：${SRC_HUAWEI.replace(ROOT, '.')}（${huawei.products.length} 台）`);
  console.log(
    `      ${SRC_APPLE.replace(ROOT, '.')}（${apple.products.length} 台 / ${pageIndex.size} 个规格页）`,
  );
  console.log(`      ${SRC_APPLE_COMPARE.replace(ROOT, '.')} → ${compareStatus}`);
  console.log(`      ${SRC_APPLE_PRICES.replace(ROOT, '.')} → ${pricesStatus}`);
  console.log(`输出：${outPath.replace(ROOT, '.')}  共 ${products.length} 台\n`);

  const hw = products.filter((p) => p.brand === 'huawei').length;
  const aps = products.filter((p) => p.brand === 'apple' && p.granularity === 'specs-page').length;
  const apc = products.filter(
    (p) => p.brand === 'apple' && p.granularity === 'compare-matrix',
  ).length;
  console.log(
    `机型数：华为规格页 ${hw} + 苹果规格页 ${aps} + 苹果矩阵 ${apc} = ${products.length}`,
  );
  if (compareDropped.length) {
    console.log(
      `矩阵通道另有 ${compareDropped.length} 台落在首发窗口（${WINDOW_START}）之前，未收录：`,
    );
    console.log(
      `  ${compareDropped.map((x) => `${x.name}${x.date ? `(${x.date})` : ''}`).join('、')}`,
    );
  }

  // 苹果规格页拆分自证
  console.log('\n── 苹果规格页「同页多机型」拆分自证 ─────────────────────────────');
  for (const [url, list] of pageIndex) {
    if (list.length < 2) continue;
    const names = list.map((x) => x.name);
    console.log(`  ${url}`);
    console.log(`    页面机型 ${list.length} 台：${names.join(' / ')}`);
    for (const p of products.filter((x) => names.some((n) => stripInvisible(n) === x.name))) {
      console.log(
        `      · ${p.id.padEnd(26)} 重量 ${String(p.body.weightG ?? 'null').padStart(4)} g   屏幕 ${String(p.display.sizeIn ?? 'null').padStart(5)} 英寸   granularity=${p.granularity}`,
      );
    }
  }

  // 华为无处理器章节机型的 null 计数
  const hwNoChip = products.filter((p) => p.brand === 'huawei' && p.chipset.name === null);
  console.log('\n── null 计数（「官网真没有」的证据）────────────────────────────');
  console.log(`  华为 chipset.name = null：${hwNoChip.length} / ${hw} 台`);
  console.log(`    ${hwNoChip.map((p) => p.id).join(', ')}`);
  console.log(
    `  苹果 battery.capacityMah = null：${products.filter((p) => p.brand === 'apple' && p.battery.capacityMah === null).length} / ${aps + apc} 台（苹果从不公布 mAh）`,
  );
  console.log(
    `  苹果 chipset.processNm = null：${products.filter((p) => p.brand === 'apple' && p.chipset.processNm === null).length} / ${aps + apc} 台`,
  );
  console.log(
    `  全体 body.weightG = null：${products.filter((p) => p.body.weightG === null).length} 台`,
  );
  console.log(
    `  全体 display.brightnessPeakNits = null：${products.filter((p) => p.display.brightnessPeakNits === null).length} 台`,
  );
  console.log(
    `  全体 battery.wiredChargeW = null：${products.filter((p) => p.battery.wiredChargeW === null).length} 台`,
  );
  console.log(
    `  有 skus（价格）的机型：${products.filter((p) => p.skus?.length).length} 台（华为 ${products.filter((p) => p.brand === 'huawei' && p.skus?.length).length} + 苹果 ${products.filter((p) => p.brand === 'apple' && p.skus?.length).length}）`,
  );

  printCoverage(products);

  console.log(`\n${'═'.repeat(72)}`);
  if (problems.length) {
    console.log(`❌ 自检发现 ${problems.length} 个问题：`);
    for (const x of problems.slice(0, 30)) console.log(`  - ${x}`);
    process.exitCode = 1;
  } else {
    console.log('✅ 自检通过：id 唯一、releaseDate 留空待 sync 回填、口径与 provenance 齐全');
  }

  if (probe) {
    const unmapped = new Map();
    for (const p of huawei.products) {
      for (const k of Object.keys(p.raw)) {
        if (k.startsWith('_')) continue;
        const sec = k.split('@')[0].split('.')[0];
        unmapped.set(sec, (unmapped.get(sec) ?? 0) + 1);
      }
    }
    console.log('\n── 华为原始章节覆盖（--probe）────────────────────────────────');
    for (const [sec, n] of [...unmapped].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${sec.padEnd(16)} ${n} 次出现在原始数据里`);
    }
  }
}

main();

