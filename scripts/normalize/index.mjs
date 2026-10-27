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
import {
  mapHuawei,
  mapHuaweiTablet,
  mapHuaweiWearable,
  mapHuaweiMonitor,
  mapHuaweiLaptop,
  mapHuaweiAudio,
  mapHuaweiVision,
  mapHuaweiRouter,
} from './brands/huawei.mjs';
import {
  mapXiaomi,
  mapXiaomiTablet,
  mapXiaomiLaptop,
  mapXiaomiVision,
  mapXiaomiWearable,
  mapXiaomiAudio,
  mapXiaomiMonitor,
  mapXiaomiRouter,
  mapXiaomiAppliance,
  mapXiaomiHistory,
} from './brands/xiaomi.mjs';
import { sliceByVariants, stripInvisible } from './parse.mjs';
import { put, putObject, addNote, tidy, AP, AC } from './shared.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = join(ROOT, '_work');
const SRC_HUAWEI = join(WORK, 'huawei.raw.json');
const SRC_HUAWEI_TABLETS = join(WORK, 'huawei-tablets.raw.json');
const SRC_HUAWEI_WEARABLES = join(WORK, 'huawei-wearables.raw.json');
const SRC_HUAWEI_MONITORS = join(WORK, 'huawei-monitors.raw.json');
const SRC_HUAWEI_LAPTOPS = join(WORK, 'huawei-laptops.raw.json');
const SRC_HUAWEI_AUDIO = join(WORK, 'huawei-audio.raw.json');
const SRC_HUAWEI_VISIONS = join(WORK, 'huawei-visions.raw.json');
const SRC_HUAWEI_ROUTERS = join(WORK, 'huawei-routers.raw.json');
const SRC_XIAOMI = join(WORK, 'xiaomi.raw.json');
const XIAOMI_CHANNELS = [
  ['tablet', 'xiaomi-tablet.raw.json', mapXiaomiTablet],
  ['laptop', 'xiaomi-laptop.raw.json', mapXiaomiLaptop],
  ['tv', 'xiaomi-tv.raw.json', mapXiaomiVision],
  ['wearable', 'xiaomi-wearable.raw.json', mapXiaomiWearable],
  ['headset', 'xiaomi-headset.raw.json', mapXiaomiAudio],
  ['speaker', 'xiaomi-speaker.raw.json', mapXiaomiAudio],
  ['display', 'xiaomi-display.raw.json', mapXiaomiMonitor],
  ['network', 'xiaomi-network.raw.json', mapXiaomiRouter],
  ['appliance', 'xiaomi-appliance.raw.json', mapXiaomiAppliance],
];
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
  'connectivity.nfcDetail',
  'connectivity.irBlaster',
  'connectivity.cellularBands',
  'connectivity.wlanBands',
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
  'connectivity.nfcDetail',
  'connectivity.irBlaster',
  'connectivity.cellularBands',
  'connectivity.wlanBands',
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
  for (const r of huaweiRecords) r.category = 'phone'; // 数据源层显式声明品类

  /* --- 通道 A2：华为平板规格页（可选：_work/huawei-tablets.raw.json 存在才跑）---
   * 与通道 A 同一套采集器（--category tablets），映射器显式声明 category='tablet'。
   * 品类声明纪律：各通道**显式**声明，缺失由 sync 闸门拦截（见下方一致性自检）。
   */
  let huaweiTabletStatus = '未就绪';
  let huaweiTabletRecords = [];
  if (existsSync(SRC_HUAWEI_TABLETS)) {
    const tablets = JSON.parse(readFileSync(SRC_HUAWEI_TABLETS, 'utf8'));
    huaweiTabletRecords = tablets.products.map(mapHuaweiTablet);
    huaweiTabletStatus = `就绪（${huaweiTabletRecords.length} 台）`;
  }

  /* --- 通道 A3：华为穿戴规格页（可选：_work/huawei-wearables.raw.json 存在才跑）--- */
  let huaweiWearableStatus = '未就绪';
  let huaweiWearableRecords = [];
  if (existsSync(SRC_HUAWEI_WEARABLES)) {
    const wearables = JSON.parse(readFileSync(SRC_HUAWEI_WEARABLES, 'utf8'));
    huaweiWearableRecords = wearables.products.map(mapHuaweiWearable);
    huaweiWearableStatus = `就绪（${huaweiWearableRecords.length} 台）`;
  }

  /* --- 通道 A4：华为显示器规格页（可选：_work/huawei-monitors.raw.json 存在才跑）--- */
  let huaweiMonitorStatus = '未就绪';
  let huaweiMonitorRecords = [];
  if (existsSync(SRC_HUAWEI_MONITORS)) {
    const monitors = JSON.parse(readFileSync(SRC_HUAWEI_MONITORS, 'utf8'));
    huaweiMonitorRecords = monitors.products.map(mapHuaweiMonitor);
    huaweiMonitorStatus = `就绪（${huaweiMonitorRecords.length} 台）`;
  }

  /* --- 通道 A5：华为笔记本规格页（可选：_work/huawei-laptops.raw.json 存在才跑）--- */
  let huaweiLaptopStatus = '未就绪';
  let huaweiLaptopRecords = [];
  if (existsSync(SRC_HUAWEI_LAPTOPS)) {
    const laptops = JSON.parse(readFileSync(SRC_HUAWEI_LAPTOPS, 'utf8'));
    huaweiLaptopRecords = laptops.products.map(mapHuaweiLaptop);
    huaweiLaptopStatus = `就绪（${huaweiLaptopRecords.length} 台）`;
  }

  /* --- 通道 A6：华为音频规格页（可选：_work/huawei-audio.raw.json 存在才跑）---
   * 音频品类跨三个官网目录段（audio/headphones/speakers），采集器按条目实际段抓取。 */
  let huaweiAudioStatus = '未就绪';
  let huaweiAudioRecords = [];
  if (existsSync(SRC_HUAWEI_AUDIO)) {
    const audio = JSON.parse(readFileSync(SRC_HUAWEI_AUDIO, 'utf8'));
    huaweiAudioRecords = audio.products.map(mapHuaweiAudio);
    huaweiAudioStatus = `就绪（${huaweiAudioRecords.length} 台）`;
  }

  /* --- 通道 A7：华为智慧屏规格页（可选：_work/huawei-visions.raw.json 存在才跑）---
   * 智慧屏落 media 品类（与 Apple TV 同品类），跨主段与嵌套段 visions/huawei-vision。 */
  let huaweiVisionStatus = '未就绪';
  let huaweiVisionRecords = [];
  if (existsSync(SRC_HUAWEI_VISIONS)) {
    const visions = JSON.parse(readFileSync(SRC_HUAWEI_VISIONS, 'utf8'));
    huaweiVisionRecords = visions.products.map(mapHuaweiVision);
    huaweiVisionStatus = `就绪（${huaweiVisionRecords.length} 台）`;
  }

  /* --- 通道 A8：华为路由器规格页（可选：_work/huawei-routers.raw.json 存在才跑）--- */
  let huaweiRouterStatus = '未就绪';
  let huaweiRouterRecords = [];
  if (existsSync(SRC_HUAWEI_ROUTERS)) {
    const routers = JSON.parse(readFileSync(SRC_HUAWEI_ROUTERS, 'utf8'));
    huaweiRouterRecords = routers.products.map(mapHuaweiRouter);
    huaweiRouterStatus = `就绪（${huaweiRouterRecords.length} 台）`;
  }

  /* --- 通道 X1：小米商城规格页（可选：_work/xiaomi.raw.json 存在才跑）---
   * 小米官方结构化数据只有「关键参数」（完整规格是图片），映射器显式声明
   * category='phone'，覆盖率偏浅是官网结构性事实，缺的字段一律 null。 */
  let xiaomiStatus = '未就绪';
  let xiaomiRecords = [];
  if (existsSync(SRC_XIAOMI)) {
    const xiaomi = JSON.parse(readFileSync(SRC_XIAOMI, 'utf8'));
    xiaomiRecords = xiaomi.products.map(mapXiaomi);
    xiaomiStatus = `就绪（${xiaomiRecords.length} 台）`;
  }

  /* --- 通道 X2–X8：小米多品类（各品类 raw 文件存在才跑，采集器 --category 产出）--- */
  const xiaomiExtraRecords = [];
  const xiaomiExtraStatus = [];
  for (const [cat, file, mapper] of XIAOMI_CHANNELS) {
    const fp = join(WORK, file);
    if (!existsSync(fp)) continue;
    const rawCat = JSON.parse(readFileSync(fp, 'utf8'));
    xiaomiExtraRecords.push(...rawCat.products.map(mapper));
    xiaomiExtraStatus.push(`${cat} ${rawCat.products.length}`);
  }
  if (xiaomiExtraStatus.length) {
    xiaomiStatus += `；多品类通道 ${xiaomiExtraStatus.join(' / ')}`;
  }

  /* --- 通道 X10：小米历史机型（检索取证式，data/curated/xiaomi-history*.json）---
   * 直抓源全被墙后的路线（见 docs/HISTORICAL-CATALOG-PLAN.md §二·二）：
   * 逐台检索取证，provenance='retrieval'，发布日期走 release-dates.json。
   * 多批次文件按文件名拼接（batch1 数字/K 系、batch2 MIX/Civi/Note/Turbo）。 */
  const historyFiles = [
    join(ROOT, 'data', 'curated', 'xiaomi-history.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-history-batch2.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-history-m3.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-history-m2fix.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-history-m3b.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-history-network-home.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-history-audio-misc.json'),
    join(ROOT, 'data', 'curated', 'huawei-history.json'),
    join(ROOT, 'data', 'curated', 'huawei-history-batch2.json'),
    join(ROOT, 'data', 'curated', 'huawei-history-m4b.json'),
    join(ROOT, 'data', 'curated', 'honor-history.json'),
    join(ROOT, 'data', 'curated', 'huawei-history-early.json'),
    join(ROOT, 'data', 'curated', 'huawei-history-early-wearable-tablet.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-history-firstgen.json'),
    join(ROOT, 'data', 'curated', 'honor-history-continue.json'),
    join(ROOT, 'data', 'curated', 'huawei-history-ascend.json'),
    join(ROOT, 'data', 'curated', 'honor-history-2013.json'),
    join(ROOT, 'data', 'curated', 'huawei-phone-1a1.json'),
    join(ROOT, 'data', 'curated', 'huawei-phone-1a2.json'),
    join(ROOT, 'data', 'curated', 'huawei-phone-1a3.json'),
    join(ROOT, 'data', 'curated', 'honor-phone-1b1.json'),
    join(ROOT, 'data', 'curated', 'honor-phone-1b2.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-phone-1c1.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-phone-1c2.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-phone-1c3.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-media-2a1.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-network-2a2.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-laptop-2a3.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-tablet-2a4.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-wearable-2a5.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-audio-2a6.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-home-2a7.json'),
    join(ROOT, 'data', 'curated', 'huawei-tablet-2b1.json'),
    join(ROOT, 'data', 'curated', 'huawei-wearable-2b2.json'),
    join(ROOT, 'data', 'curated', 'huawei-laptop-2b3.json'),
    join(ROOT, 'data', 'curated', 'huawei-media-2b4.json'),
    join(ROOT, 'data', 'curated', 'huawei-network-2b5.json'),
    join(ROOT, 'data', 'curated', 'honor-tablet-2c1.json'),
    join(ROOT, 'data', 'curated', 'honor-laptop-2c2.json'),
    join(ROOT, 'data', 'curated', 'honor-wearable-2c3.json'),
    join(ROOT, 'data', 'curated', 'honor-media-2c4.json'),
    join(ROOT, 'data', 'curated', 'huawei-phone-3a.json'),
    join(ROOT, 'data', 'curated', 'huawei-misc-3b.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-phone-3c.json'),
    join(ROOT, 'data', 'curated', 'honor-misc-3d.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-media-3e.json'),
    join(ROOT, 'data', 'curated', 'huawei-phone-4a.json'),
    join(ROOT, 'data', 'curated', 'honor-phone-4b.json'),
    join(ROOT, 'data', 'curated', 'huawei-phone-4c.json'),
    join(ROOT, 'data', 'curated', 'misc-4d.json'),
    join(ROOT, 'data', 'curated', 'xiaomi-home-4e.json'),
    join(ROOT, 'data', 'curated', 'huawei-phone-5a.json'),
    join(ROOT, 'data', 'curated', 'huawei-phone-5b.json'),
    join(ROOT, 'data', 'curated', 'huawei-phone-5d.json'),
    join(ROOT, 'data', 'curated', 'honor-xiaomi-phone-5e.json'),
    join(ROOT, 'data', 'curated', 'honor-phone-6a.json'),
    join(ROOT, 'data', 'curated', 'honor-phone-6b.json'),
    join(ROOT, 'data', 'curated', 'huawei-wearable-6c.json'),
    join(ROOT, 'data', 'curated', 'huawei-misc-6d.json'),
  ];
  let historyRecords = [];
  const historyParts = [];
  for (const fp of historyFiles) {
    if (!existsSync(fp)) continue;
    const hist = JSON.parse(readFileSync(fp, 'utf8'));
    historyRecords.push(...hist.entries.map(mapXiaomiHistory));
    historyParts.push(hist.entries.length);
  }
  if (historyParts.length) {
    xiaomiStatus += `；历史机型 ${historyRecords.length} 台（检索取证）`;
  }

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
  for (const r of specsRecords) r.category = 'phone'; // 数据源层显式声明品类

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
    // 缺口判定必须比对规格页「最终产出」的 id，不是原始产品 id：
    // 同页拆分（一页多机型）会让 SE 2/3 这类记录 id 不出现在 apple.products 里，
    // 只比原始 id 时矩阵通道会把它们再产一遍 → 下游 id 重复（2026-10-25 全量窗口后暴露）
    const generatedSpecIds = new Set(specsRecords.map((r) => r.id));
    // 用户数据层 add-product 显式收录的机型同样不得重复产出（双真源红线，
    // 见 sync/index.mjs 队列过滤注释）：全量窗口后矩阵会把老 iPhone 全代都当「缺口」，
    // 其中 SE 2/3 等已由用户层收录 → 排除
    const userLayerIds = new Set();
    const overridesPath = join(ROOT, 'data/overrides.json');
    if (existsSync(overridesPath)) {
      const ovr = JSON.parse(readFileSync(overridesPath, 'utf8'));
      for (const e of ovr.entries ?? []) {
        if (e.op === 'add-product' && e.product?.id) userLayerIds.add(e.product.id);
      }
    }
    const gapOnly = compare.products.filter(
      (p) => !generatedSpecIds.has(p.id) && !userLayerIds.has(p.id),
    );
    for (const p of gapOnly) {
      const dated = dateById.get(p.id);
      // 只有「有取证日期且明确落在窗口外」的才在这里剪掉；
      // 缺日期的交给 sync 分类（missing-date → 待收录队列），不做名字估算。
      const outOfWindow = dated?.date
        ? Date.parse(dated.date) < Date.parse(WINDOW_START)
        : false;
      if (!outOfWindow) {
        const rec = mapAppleCompare(p);
        rec.category = 'phone'; // 数据源层显式声明品类
        compareRecords.push(rec);
      } else compareDropped.push({ id: p.id, name: p.name, date: dated.date });
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
  for (const r of [
    ...huaweiRecords,
    ...huaweiTabletRecords,
    ...huaweiWearableRecords,
    ...huaweiMonitorRecords,
    ...huaweiLaptopRecords,
    ...huaweiAudioRecords,
    ...huaweiVisionRecords,
    ...huaweiRouterRecords,
    ...xiaomiRecords,
    ...xiaomiExtraRecords,
    ...historyRecords,
    ...specsRecords,
    ...compareRecords,
  ])
    byId.set(r.id, r);

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

  /* --- 品类声明 ---
   * 数据源层显式声明品类：手机通道（华为/苹果官网）产出即 phone；
   * 平板通道（mapHuaweiTablet）在映射器里声明 category='tablet'。
   *
   * 曾经这行兜底写在 sync/index.mjs 的拍平循环里，而 validate() 的
   * 「品类缺失或未注册」闸门在那之后才跑 —— 兜底先于闸门 ⇒ 闸门永远看不到
   * 缺失值，validate.mjs 注释白纸黑字「缺失也拒绝」而实现静默放行：
   * 一个忘了声明品类的机型会被按 phone 的字段表渲染，参数表直接崩，零报错。
   *
   * 现在各司其职：品类由数据源声明（各映射器/各通道），缺失与否由闸门校验
   * （validate.mjs 的 isRegisteredCategory），同步层不再和稀泥。
   * 本行只做「声明齐全」的显性断言：有遗漏在这里当场炸，不留给闸门猜。 */
  for (const p of products) {
    if (!p.category) {
      throw new Error(`${p.id} 未声明品类（category）——映射器必须显式声明，禁止兜底`);
    }
  }

  /* --- 自检不过不写盘 ---
   * 曾经的顺序是「先 writeFileSync，最后才打印 problems 并置 exitCode=1」——
   * 坏产出已经落盘，_work/normalized.json 是脏的；exitCode 而不是 exit()，
   * 调用方一旦不检查退出码，脏文件就静默留在那里被下一轮用
   * （2026-10-14 审计 B13）。纪律：**没过的检查不许有产物**。 */
  if (problems.length) {
    console.error(`\n❌ 规范化层自检发现 ${problems.length} 个问题，拒绝写盘：`);
    for (const x of problems.slice(0, 30)) console.error(`  - ${x}`);
    console.error(`\n（未写出 ${outPath.replace(ROOT, '.')}，旧文件原样保留）`);
    process.exit(1);
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
  // problems 已在写盘前拦掉（不过不写盘），到这里必然是 0 —— 保留分支只是
  // 防将来有人把检查挪回后面，它一绿就说明顺序又坏了。
  if (problems.length) {
    console.log(`❌ 自检发现 ${problems.length} 个问题（不应到达这里：写盘前已拦截）`);
    process.exit(1);
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

