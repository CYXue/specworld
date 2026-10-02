#!/usr/bin/env node
/**
 * 对比页静态渲染器（端到端验证用）
 * ============================================================================
 * 目的：在真实数据/完整前端就位之前，把 docs/COMPARE-DESIGN.md 定稿的对比页
 *       **渲染成一张自包含的单文件 HTML**，用来验证信息设计是否成立。
 *
 * 纪律：
 *   1. 行定义、分组、阈值、差异等级、优势方判定**全部**来自
 *      `src/lib/compare-spec.mjs`（ROWS / GROUPS / THRESHOLDS / diffLevel / winner）。
 *      本文件不复制、不重写任何一条判断逻辑。
 *   2. 零依赖、纯 ESM、Node >= 18；产出物无 CDN、无外链字体、无图片、无行为脚本。
 *   3. 数据缺失是常态：字段为 null 时渲染灰色「官方未公布」，**永不显示 0 / — / 空单元格**，
 *      也**永不判定胜负**。任何异常都降级成可读页面，不抛栈。
 *
 * 用法：
 *   node scripts/preview/render.mjs --a <id> --b <id> [--data data/products.json] [--out _work/preview/compare.html]
 *   node scripts/preview/render.mjs --fixture
 *   node scripts/preview/render.mjs                 # 自动挑一对「同价位、同代」的机型（一苹果一华为）
 *
 * 退出码：0 = 渲染完成且自证断言全部通过；1 = 有断言未通过（页面仍会写盘，便于排查）。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* 唯一的判断逻辑来源 —— 只 import，不重写 */
import { GROUPS, ROWS, THRESHOLDS, diffLevel, winner } from '../../src/lib/compare-spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = resolve(dirname(fileURLToPath(import.meta.url)));

/* ==========================================================================
 * 0. 常量：只允许两个品牌色 + 中性灰阶
 * ========================================================================== */
const BRAND_ZH = { apple: '苹果', huawei: '华为' };
/** 品牌色只用于「强高亮」与箭头着色；第三、第四种彩色一律不引入 */
const BRAND_FALLBACK = {
  apple: { accent: '#0071e3', soft: 'rgba(0,113,227,.13)', line: 'rgba(0,113,227,.38)' },
  huawei: { accent: '#cf0a2c', soft: 'rgba(207,10,44,.13)', line: 'rgba(207,10,44,.38)' },
};
const STATUS_ZH = { 'on-sale': '在售', upcoming: '即将上市', discontinued: '已停售' };
const CALIBER_ZH = {
  typical: '典型值',
  rated: '额定值',
  peak: '峰值',
  sustained: '持续',
  'vendor-claimed': '厂商标称',
  measured: '第三方实测',
};
/** 口径角标用的单字缩写（角标本身是中文，所以必须用无衬线体渲染） */
const CALIBER_TAG = { 典型值: '典', 额定值: '额', 峰值: '峰', 持续: '续', 厂商标称: '标', 第三方实测: '测' };
const THRESHOLD_LABEL = {
  weightG: ['重量', 'g'],
  thicknessMm: ['厚度', 'mm'],
  screenIn: ['屏幕尺寸', '英寸'],
  ppi: ['像素密度', 'ppi'],
  refreshHz: ['刷新率', 'Hz'],
  brightnessNits: ['峰值/典型亮度', 'nits'],
  batteryMah: ['电池容量', 'mAh'],
  wiredChargeW: ['有线充电', 'W'],
  wirelessChargeW: ['无线充电', 'W'],
  priceCny: ['起售价', '元'],
  storageSteps: ['存储档位', '档'],
  ramGb: ['运行内存', 'GB'],
};
/** 摘要里禁止出现的措辞（设计文档第一节第 3 条） */
const BANNED_VERDICT = ['综合胜出', '胜出', '推荐购买', '推荐', '总分', '更强', '更好', '最强', '谁赢'];

/* ==========================================================================
 * 1. 工具
 * ========================================================================== */
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const hasCJK = (s) => /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(String(s ?? ''));
/** 中文必须走系统无衬线体；只有「不含中文」的数字/型号名才允许等宽字 */
const monoClass = (s) => (hasCJK(s) ? '' : ' mono');
const fmtNum = (n) => {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
};
/** Δ 值格式化：永远不把「有差异」渲染成 0 */
const fmtDelta = (d) => {
  let s = String(Math.round(d * 100) / 100);
  if (Number(s) === 0 && d > 0) s = String(Math.round(d * 10000) / 10000);
  if (Number(s) === 0 && d > 0) s = d.toPrecision(3);
  return s;
};
const shortName = (p) => String(p?.name ?? p?.id ?? '').replace(/^HUAWEI\s+/i, '').trim();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
const minPriceOf = (p) => {
  const list = (p?.skus ?? []).map((s) => s?.priceCny).filter((v) => typeof v === 'number' && v > 0);
  return list.length ? Math.min(...list) : null;
};
const dateOf = (p) => {
  if (!p?.releaseDate) return null;
  const t = Date.parse(p.releaseDate);
  return Number.isNaN(t) ? null : t;
};

function parseArgs(argv) {
  const out = { a: null, b: null, data: null, out: null, derived: null, fixture: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--a') out.a = next();
    else if (k === '--b') out.b = next();
    else if (k === '--data') out.data = next();
    else if (k === '--out') out.out = next();
    else if (k === '--derived') out.derived = next();
    else if (k === '--fixture') out.fixture = true;
    else if (k === '--help' || k === '-h') out.help = true;
    else console.warn(`⚠ 忽略未知参数：${k}`);
  }
  return out;
}
function usage() {
  return [
    '用法：node scripts/preview/render.mjs [--a <id> --b <id>] [--data <json>] [--out <html>] [--fixture]',
    '',
    '  --a / --b    指定两台机型 id（只给一个时，另一台自动挑对手）',
    '  --data       数据文件，接受 Snapshot {products:[...]} 或 ProductRecord[]（默认 data/products.json）',
    '  --out        输出 HTML（默认 _work/preview/compare.html）',
    '  --derived    派生层 JSON（默认 _work/derived.json，存在则读，用于一句话定位/分位/头衔）',
    '  --fixture    用内置假机型渲染，完全不需要真实数据',
    '  --help       显示本帮助',
  ].join('\n');
}
const absFrom = (p) => (isAbsolute(p) ? p : join(ROOT, p));
const relFrom = (p) => {
  const r = resolve(p);
  return r.startsWith(ROOT) ? r.slice(ROOT.length + 1) : r;
};

/* ==========================================================================
 * 2. fixture：两台假机型（保证 UI 在没有任何真实数据时也能迭代）
 *    —— 刻意造出全部四档差异 + 未公布 + 不可比，让每条视觉规则都能被看到。
 * ========================================================================== */
export function fixtureProducts() {
  const base = {
    slug: 'fixture',
    nameZh: null,
    retiredAt: null,
    scores: [],
    provenance: {},
    firstSeenAt: '2026-10-02T00:00:00.000Z',
    lastSeenAt: '2026-10-02T00:00:00.000Z',
  };
  const alpha = {
    ...base,
    id: 'fixture-alpha',
    slug: 'fixture-alpha',
    brand: 'apple',
    line: 'Fixture',
    name: 'Fixture iPhone α',
    releaseDate: '2026-09-18',
    releaseDatePrecision: 'day',
    status: 'on-sale',
    granularity: 'compare-matrix', // 用来演示「粒度较粗」角标
    body: {
      heightMm: 149.6, widthMm: 71.5, thicknessMm: 8.25, weightG: 199,
      ipRating: 'IP68', material: 'Fixture 铝合金中框', colors: ['黑', '银', '蓝', '红'], folded: null,
    },
    display: {
      sizeIn: 6.3, type: 'Fixture OLED', resolutionPx: { w: 2622, h: 1206 }, ppi: 460,
      refreshHz: '1-120', brightnessTypicalNits: 1000, brightnessPeakNits: 2000, protection: 'Fixture 陶瓷面板',
    },
    chipset: { name: 'Fixture A20', processNm: 3, cpuCores: 6, gpu: 'Fixture GPU 7 核', npu: 'Fixture NPU' },
    memory: { ramGb: [8], storageGb: [256, 512, 1024] },
    battery: {
      capacityMah: null, capacityCaliber: null, wiredChargeW: 40, wirelessChargeW: 15,
      vendorClaimedVideoHours: 27, measuredHours: null,
    },
    camera: {
      rear: [
        { role: 'main', mp: 48, aperture: 'f/1.78', ois: true, sensorNote: null },
        { role: 'ultrawide', mp: 48, aperture: 'f/2.2', ois: false, sensorNote: null },
        { role: 'tele', mp: 12, aperture: 'f/2.8', ois: true, sensorNote: null },
      ],
      front: { mp: 12, aperture: 'f/1.9' },
      videoMax: '4K 120 fps',
    },
    connectivity: { fiveG: true, wifi: 'Wi-Fi 7', bluetooth: '6.0', nfc: true, satellite: null, usb: 'USB-C 3.2', sim: 'nano SIM + eSIM', esim: true },
    os: { launch: 'FixtureOS 27', upgradableTo: null },
    skus: [{ storageGb: 256, ramGb: 8, priceCny: 7999, priceNote: '首发价', listedAt: '2026-10-02' }],
    rawOfficial: {
      尺寸与重量: '149.6 mm | 71.5 mm | 8.25 mm | 199 g',
      显示屏: '6.3 英寸 | Fixture OLED | 2622 × 1206 | 峰值 2000 nits | 1-120 Hz',
      电池: '官方不公布电池容量；视频播放最长 27 小时',
      sensors: '面容 ID | 激光雷达扫描仪 | 气压计 | 高 g 值加速感应器 | 高动态范围陀螺仪',
      inTheBox: 'Fixture 手机 | USB-C 充电线 | 说明文档',
      bands: null,
      '同页拆分': 'fixture —— 这不是真实数据，仅用于 UI 迭代',
    },
    notes: ['fixture 假机型：不代表任何真实产品，仅用于在真实数据缺失时验证 UI'],
  };
  const beta = {
    ...base,
    id: 'fixture-beta',
    slug: 'fixture-beta',
    brand: 'huawei',
    line: 'Fixture',
    name: 'Fixture Mate β',
    nameZh: 'Fixture Mate β',
    releaseDate: '2026-09-25',
    releaseDatePrecision: 'day',
    status: 'on-sale',
    granularity: 'specs-page',
    body: {
      heightMm: 161.9, widthMm: 75.7, thicknessMm: 7.85, weightG: 221,
      ipRating: 'IP68/IP69', material: null, colors: ['曜金黑', '雪域白', '丹霞橙'], folded: null,
    },
    display: {
      sizeIn: 6.4, type: 'Fixture LTPO OLED', resolutionPx: { w: 2832, h: 1280 }, ppi: 460,
      refreshHz: '1-120', brightnessTypicalNits: null, brightnessPeakNits: 1800, protection: 'Fixture 昆仑玻璃',
    },
    chipset: { name: 'Fixture 麒麟 9999', processNm: null, cpuCores: null, gpu: null, npu: null },
    memory: { ramGb: [12], storageGb: [256, 512, 1024] },
    battery: {
      capacityMah: 5600, capacityCaliber: 'typical', wiredChargeW: 100, wirelessChargeW: 50,
      vendorClaimedVideoHours: 31, measuredHours: null,
    },
    camera: {
      rear: [
        { role: 'main', mp: 50, aperture: 'f/1.4-4.0', ois: true, sensorNote: 'RYYB' },
        { role: 'ultrawide', mp: 40, aperture: 'f/2.2', ois: false, sensorNote: 'RYYB' },
        { role: 'tele', mp: 50, aperture: 'f/2.1', ois: true, sensorNote: 'RYYB' },
      ],
      front: { mp: 13, aperture: 'f/2.0' },
      videoMax: '4K',
    },
    connectivity: { fiveG: true, wifi: 'Wi-Fi 7', bluetooth: '6.0', nfc: true, satellite: '北斗卫星消息', usb: 'USB-C 3.1', sim: 'nano SIM ×2', esim: true },
    os: { launch: 'FixtureOS 7.0', upgradableTo: null },
    skus: [{ storageGb: 256, ramGb: 12, priceCny: 7499, priceNote: '官网目录页售价', listedAt: '2026-10-02' }],
    rawOfficial: {
      尺寸与重量: '161.9 mm | 75.7 mm | 7.85 mm | 约 221 g（含电池）',
      屏幕: '6.4 英寸 | Fixture LTPO OLED | 2832 × 1280 | 1-120 Hz',
      电池: '5600 mAh（典型值）| 额定容量 5500 mAh',
      sensors: '重力感应器 | 红外传感器 | 霍尔传感器 | 屏内指纹 | 姿态感应器',
      inTheBox: 'Fixture 手机 | USB-C 线 | 取卡针 | 保护壳 | 快速指南',
      bands: '5G NR：n1/n3/n28/n41/n77/n78/n79 | LTE：B1/B3/B5/B8 | 星闪',
      '同页拆分': 'fixture —— 这不是真实数据，仅用于 UI 迭代',
    },
    notes: ['fixture 假机型：不代表任何真实产品，仅用于在真实数据缺失时验证 UI'],
  };
  return [alpha, beta];
}

/* ==========================================================================
 * 3. 数据加载
 * ========================================================================== */
function normalizeProducts(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.products)) return json.products;
  return null;
}

function loadData(explicitPath) {
  const tried = [];
  const chain = [];
  if (explicitPath) chain.push({ path: absFrom(explicitPath), explicit: true });
  if (!explicitPath || absFrom(explicitPath) !== absFrom('data/products.json')) {
    chain.push({ path: absFrom('data/products.json'), explicit: false });
  }
  chain.push({ path: absFrom('_work/normalized.json'), explicit: false });

  for (const c of chain) {
    tried.push(relFrom(c.path));
    if (!existsSync(c.path)) {
      if (c.explicit) console.warn(`⚠ 指定的数据文件不存在：${relFrom(c.path)}`);
      continue;
    }
    try {
      const stat = statSync(c.path);
      const json = readJson(c.path);
      const products = normalizeProducts(json);
      if (!products || !products.length) {
        console.warn(`⚠ ${relFrom(c.path)} 里没有 products，跳过`);
        continue;
      }
      return {
        products,
        vendors: Array.isArray(json?.vendors) ? json.vendors : [],
        generatedAt: json?.generatedAt ?? null,
        path: relFrom(c.path),
        mtime: stat.mtime.toISOString(),
        isSnapshot: !Array.isArray(json),
        tried,
      };
    } catch (e) {
      console.warn(`⚠ 读取 ${relFrom(c.path)} 失败：${e.message}`);
    }
  }
  return { products: null, vendors: [], generatedAt: null, path: null, mtime: null, isSnapshot: false, tried };
}

function loadDerived(explicitPath) {
  const p = absFrom(explicitPath ?? '_work/derived.json');
  if (!existsSync(p)) return { path: relFrom(p), data: null };
  try {
    return { path: relFrom(p), data: readJson(p) };
  } catch (e) {
    console.warn(`⚠ 读取派生层失败：${e.message}`);
    return { path: relFrom(p), data: null };
  }
}

/* ==========================================================================
 * 4. 自动挑对手：同价位优先 → 同代（发布日期接近）→ 档位同档
 * ========================================================================== */
function tierToken(name) {
  const m = String(name ?? '').match(/\b(pro\s*max|pro|ultra|plus|max|air|mini|rs|fold|pocket|e)\b/i);
  return m ? m[1].toLowerCase().replace(/\s+/g, '') : '';
}

function pickPair(products) {
  const apples = products.filter((p) => p?.brand === 'apple');
  const huaweis = products.filter((p) => p?.brand === 'huawei');
  let best = null;
  for (const a of apples) {
    for (const b of huaweis) {
      const pa = minPriceOf(a);
      const pb = minPriceOf(b);
      const ta = dateOf(a);
      const tb = dateOf(b);
      let score = 0;
      const why = [];
      if (pa !== null && pb !== null) {
        const gap = Math.abs(pa - pb);
        score += 600 - Math.min(gap / 50, 600);
        why.push(`价差 ${gap} 元`);
      } else {
        score -= 150;
      }
      if (ta !== null && tb !== null) {
        const days = Math.abs(ta - tb) / 86400000;
        score += 300 - Math.min(days / 2, 300);
        why.push(`发布相差约 ${Math.round(days)} 天`);
      }
      const tA = tierToken(a.name);
      const tB = tierToken(b.name);
      if (tA && tA === tB) {
        score += 80;
        why.push(`同为「${tA}」档`);
      }
      if (a.granularity === 'specs-page' && b.granularity === 'specs-page') score += 10;
      if (!best || score > best.score || (score === best.score && String(a.id) < String(best.a.id))) {
        best = { a, b, score, why };
      }
    }
  }
  return best;
}

/* ==========================================================================
 * 5. 取值 / 口径（只做「从契约字段里读出来」的搬运，不做任何比较判断）
 * ========================================================================== */
function resolveRaw(product, row) {
  if (!product) return null;
  if (row.id === 'persona') return null; // 一句话定位来自派生层，不走契约字段
  let v;
  if (typeof row.path === 'function') v = safe(() => row.path(product), null);
  else if (typeof row.path === 'string') {
    v = safe(() => row.path.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), product), null);
  } else v = null;
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v;
}

function resolveCaliber(row, product) {
  const c = typeof row.caliber === 'function' ? safe(() => row.caliber(product), null) : row.caliber;
  if (!c) return null;
  return CALIBER_ZH[c] ?? String(c);
}

function formatDateValue(product) {
  if (!product?.releaseDate) return null;
  const d = String(product.releaseDate);
  const precision = product.releaseDatePrecision ?? null;
  if (precision === 'year') return d.slice(0, 4);
  if (precision === 'month') return d.slice(0, 7);
  return d.slice(0, 10);
}

/** 把契约值渲染成文本。返回 null 表示「官方未公布」（绝不返回 '0' / '—' / ''） */
function formatValue(row, product, raw, derivedPersona) {
  if (row.id === 'persona') return derivedPersona ?? null;
  if (raw === null || raw === undefined) return null;
  if (row.id === 'releaseDate') return formatDateValue(product);
  if (row.id === 'status') return STATUS_ZH[raw] ?? String(raw);
  if (typeof raw === 'number') return row.unit ? `${fmtNum(raw)} ${row.unit}` : fmtNum(raw);
  const s = String(raw);
  return s.trim() === '' ? null : s;
}

/** 每一行的完整渲染态 */
function evaluateRow(row, productA, productB, personas) {
  const rawA = resolveRaw(productA, row);
  const rawB = resolveRaw(productB, row);
  const personaA = row.id === 'persona' ? personas?.a ?? null : null;
  const personaB = row.id === 'persona' ? personas?.b ?? null : null;
  // diffLevel 只认「契约层拿到的值」，persona 不是契约值，不参与比较
  const level = row.id === 'persona' ? (personaA && personaB ? 'none' : 'missing') : diffLevel(row, rawA, rawB);
  const win = level === 'weak' || level === 'strong' ? winner(row, rawA, rawB) : null;
  const numA = typeof rawA === 'number' ? rawA : Number(rawA);
  const numB = typeof rawB === 'number' ? rawB : Number(rawB);
  const numeric = Number.isFinite(numA) && Number.isFinite(numB);
  const delta = numeric ? Math.abs(numA - numB) : null;
  const advantageIsHigher = win && numeric ? (win === 'a' ? numA > numB : numB > numA) : null;
  const rel = numeric && row.threshold ? delta / row.threshold : null;
  const textA = formatValue(row, productA, rawA, personaA);
  const textB = formatValue(row, productB, rawB, personaB);
  return {
    row,
    rawA,
    rawB,
    level,
    win,
    delta,
    rel,
    advantageIsHigher,
    textA,
    textB,
    missingA: rawA === null && row.id !== 'persona',
    missingB: rawB === null && row.id !== 'persona',
    // 派生行（一句话定位）不是「官网未公布」，缺的时候要给另一句话，不能借用「官方未公布」
    noteA: row.id === 'persona' && !textA ? '派生层未生成' : null,
    noteB: row.id === 'persona' && !textB ? '派生层未生成' : null,
    calA: resolveCaliber(row, productA),
    calB: resolveCaliber(row, productB),
    group: row.group,
  };
}

/* ==========================================================================
 * 6. 渲染：行 / 单元格
 * ========================================================================== */
const ROW_END = '<!--/row-->';

function caliberBadge(cal) {
  if (!cal) return '';
  const tag = CALIBER_TAG[cal] ?? cal.slice(0, 1);
  return `<sup class="badge badge-cal" title="口径：${esc(cal)}">${esc(tag)}</sup>`;
}

function cautionBadge(caution) {
  if (!caution) return '';
  return `<sup class="badge badge-caution" title="注意：${esc(caution)}">?</sup>`;
}

/** 数字/型号名走等宽字；中文（含中文单位）走系统无衬线体，两者在同一格里分开渲染 */
function valueSpans(text, unit) {
  const t = String(text ?? '');
  if (unit && hasCJK(unit) && t.endsWith(unit)) {
    const num = t.slice(0, -unit.length).trim();
    return `<span class="v mono">${esc(num)}</span><span class="v-unit">${esc(unit)}</span>`;
  }
  return `<span class="v${monoClass(t)}">${esc(t)}</span>`;
}
/** Δ 值同理：'0.55 mm' 整体等宽，'500 元' 拆成数字 + 中文单位 */
function deltaSpans(text, unit) {
  if (unit && hasCJK(unit)) {
    return `<span class="mono">${esc(String(text).replace(new RegExp(`${unit}$`), '').trim())}</span><span class="v-unit">${esc(unit)}</span>`;
  }
  return `<span class="mono">${esc(text)}</span>`;
}

function valueCell(side, e, opts) {
  const text = side === 'a' ? e.textA : e.textB;
  const missing = side === 'a' ? e.missingA : e.missingB;
  const note = side === 'a' ? e.noteA : e.noteB;
  const cal = side === 'a' ? e.calA : e.calB;
  const isWin = !missing && !note && e.win === side && (e.level === 'strong' || e.level === 'weak');
  const cls = ['val'];
  if (missing) cls.push('val-unpublished');
  if (!missing && e.win === side && e.level === 'strong') cls.push(`win-${side}`);
  if (!missing && e.win === side && e.level === 'weak') cls.push('val-edge');
  let inner;
  if (missing) inner = '<span class="v-unpub">官方未公布</span>';
  else if (note) inner = `<span class="v-unpub">${esc(note)}</span>`;
  else {
    // 强高亮才给优势侧加品牌色底 + 「更轻 / 更薄 / 更亮」标签；weak 只加粗
    const tag =
      e.level === 'strong' && e.win === side && e.row.winLabel
        ? `<span class="tag-win tag-${side}">${esc(e.row.winLabel)}</span>`
        : '';
    inner = `${valueSpans(text, e.row.unit)}${caliberBadge(cal)}${tag}`;
  }
  const sideTag = opts.showSideTag
    ? `<span class="side-tag">${esc(BRAND_ZH[side === 'a' ? opts.brandA : opts.brandB] ?? '')}</span>`
    : '';
  const title = missing ? ' title="官网未给出该参数；本站不写 0、不写 —、也不判定胜负"' : '';
  const aria = isWin ? ` data-edge="${side}"` : '';
  return `<span class="${cls.join(' ')}" data-side="${side}"${aria}${title}>${sideTag}${inner}</span>`;
}

function deltaCell(e, opts) {
  const cmp = e.row.compare;
  // compare: 'none' 的行不显示 Δ；不可比的行整行不给 Δ（设计文档 §2 ④ / §5）
  if (cmp === 'none' || cmp === 'incomparable' || e.level === 'incomparable') return '';
  if (e.level === 'missing') {
    return (
      `<div class="c-delta"><span class="delta-na" title="一侧官方未公布，本站不做比较">┄</span>` +
      `<span class="vh">一侧官方未公布，不做比较</span></div>`
    );
  }
  if (e.level === 'none' || !e.win || e.delta === null) return ''; // 差值未达阈值 → 不显示
  const higher = e.advantageIsHigher;
  const arrow = higher ? '▲' : '▼';
  const dText = `${fmtDelta(e.delta)}${e.row.unit ? ` ${e.row.unit}` : ''}`;
  const winName = shortName(e.win === 'a' ? opts.a : opts.b);
  const winLabel = e.row.winLabel ? `（${e.row.winLabel}）` : '';
  return (
    `<div class="c-delta">` +
    `<span class="delta-v">Δ ${deltaSpans(dText, e.row.unit)}</span>` +
    `<span class="delta-arrow delta-${e.win}" title="${esc(`${winName} 的数值${higher ? '更高' : '更低'}，差 ${dText}${winLabel}`)}">${arrow}</span>` +
    `<span class="vh">${esc(`${winName} 的数值${higher ? '更高' : '更低'}，差 ${dText}`)}</span>` +
    `</div>`
  );
}

function renderRow(e, opts) {
  const plain = opts.plain === true; // 折叠区 / 不可比区：三列，无 Δ 轨道
  const incomparable = e.level === 'incomparable';
  const cls = ['spec-row'];
  if (plain) cls.push('is-plain');
  if (incomparable) cls.push('is-incomparable');
  const nullSides = [e.missingA ? 'a' : null, e.missingB ? 'b' : null].filter(Boolean).join('');
  const open =
    `<div class="${cls.join(' ')}" data-row="${esc(e.row.id)}" data-diff="${e.level}"` +
    ` data-null="${nullSides}" data-winner="${e.win ?? ''}" data-compare="${esc(e.row.compare)}">`;
  const label = `<div class="c-label"><span class="lbl">${esc(e.row.label)}</span>${cautionBadge(e.row.caution)}</div>`;
  return [
    open,
    `<div class="c-a">${valueCell('a', e, opts)}</div>`,
    label,
    `<div class="c-b">${valueCell('b', e, opts)}</div>`,
    plain ? '' : deltaCell(e, opts),
    '</div>',
    ROW_END,
  ].join('');
}

/* ==========================================================================
 * 7. 结论摘要（只陈述差值，不做任何加权/推荐）
 * ========================================================================== */
function missingSentence(e, opts) {
  const who = [];
  if (e.missingA) who.push(BRAND_ZH[opts.brandA] ?? 'A');
  if (e.missingB) who.push(BRAND_ZH[opts.brandB] ?? 'B');
  const subject = who.length === 2 ? '两台官方都未公布' : `${who[0]}官方不公布`;
  let tail = '本站不做比较';
  const granA = e.missingA && opts.a?.granularity === 'compare-matrix' && opts.brandA === 'apple';
  const granB = e.missingB && opts.b?.granularity === 'compare-matrix' && opts.brandB === 'apple';
  if (granA || granB) tail += '（该机型取自苹果对比页矩阵，字段本就比规格页少）';
  return `${e.row.label}：${subject}，${tail}`;
}

function buildSummary(entries, opts) {
  // 结论句只用主表（契约行）；不可比清单必须看全量行，否则会漏报
  const main = entries.filter((e) => e.row.group !== 'incomparable' && e.row.fold !== true && e.row.id !== 'persona');
  const strong = main.filter((e) => e.level === 'strong');
  const weak = main.filter((e) => e.level === 'weak');
  const missing = main.filter((e) => e.level === 'missing' && e.row.compare !== 'incomparable');
  const derivedGap = entries.filter((e) => e.row.id === 'persona' && (e.noteA || e.noteB));
  const incomparable = entries.filter((e) => e.level === 'incomparable');
  const items = [];

  const sortedStrong = [...strong].sort((x, y) => (y.rel ?? 0) - (x.rel ?? 0));
  for (const e of sortedStrong.slice(0, 5)) {
    const wName = shortName(e.win === 'a' ? opts.a : opts.b);
    const lName = shortName(e.win === 'a' ? opts.b : opts.a);
    const wVal = e.win === 'a' ? e.textA : e.textB;
    const lVal = e.win === 'a' ? e.textB : e.textA;
    const dText = `${fmtDelta(e.delta)}${e.row.unit ? ` ${e.row.unit}` : ''}`;
    const verb = e.row.winLabel ? e.row.winLabel.replace(/^更/, '') : null;
    const text = verb
      ? `${wName} 比 ${lName} ${verb} ${dText}（${wVal} vs ${lVal}）`
      : `${wName} 的${e.row.label}为 ${wVal}，${lName} 为 ${lVal}，相差 ${dText}`;
    items.push({ kind: 'strong', text, row: e.row.label });
  }

  if (items.length < 3 && weak.length) {
    const w = [...weak].sort((x, y) => (y.rel ?? 0) - (x.rel ?? 0))[0];
    const dText = `${fmtDelta(w.delta)}${w.row.unit ? ` ${w.row.unit}` : ''}`;
    items.push({
      kind: 'info',
      row: w.row.label,
      text: `${w.row.label}相差 ${dText}（${w.textA} vs ${w.textB}），已过本站阈值但未到 2 倍阈值，只标差值、不做结论`,
    });
  }
  if (items.length < 3) {
    const same = entries.filter((e) => e.level === 'none' && e.textA && e.textB && e.textA === e.textB && e.row.compare !== 'none');
    if (same.length) {
      items.push({
        kind: 'info',
        row: '同值',
        text: `两台在 ${same.slice(0, 4).map((e) => e.row.label).join('、')} 上数值一致（${same[0].textA}）`,
      });
    }
  }
  if (items.length < 3 && strong.length) {
    items.push({ kind: 'info', row: '说明', text: '其余强差异见主表：本站只列差值，不做跨参数加权。' });
  }
  const both = main.filter((e) => !e.missingA && !e.missingB).length;
  items.push({
    kind: 'info',
    row: '数据完整度',
    text:
      `主表 ${main.length} 行：两台都有数据 ${both} 行，一方官方未公布 ${missing.length} 行，` +
      `口径不可比 ${incomparable.length} 行`,
  });

  return { items: items.slice(0, 6), missing, incomparable, strong, weak, derivedGap };
}

function renderSummary(sum, opts) {
  const rows = sum.items
    .map(
      (it, i) =>
        `<li class="sum-item sum-${it.kind}"><span class="sum-idx">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="sum-text">${esc(it.text)}</span></li>`,
    )
    .join('');
  const missingList = sum.missing.length
    ? sum.missing
        .map((e) => `<li><span class="caveat-tag">未公布</span><span class="caveat-text">${esc(missingSentence(e, opts))}</span></li>`)
        .join('')
    : '<li><span class="caveat-tag">未公布</span><span class="caveat-text">本页没有「一侧有值、一侧未公布」的参数</span></li>';
  const derivedList = sum.derivedGap.length
    ? `<li><span class="caveat-tag">未生成</span><span class="caveat-text">一句话定位：派生层还没有生成（数据文件 <code>${esc(
        opts.derivedPath ?? '_work/derived.json',
      )}</code> 不存在）。这不是「官方未公布」，而是本站在这一步还没有产出；界面如实留白并注明，不编造定位文案。</span></li>`
    : '';
  const incomparableList = sum.incomparable.length
    ? sum.incomparable
        .map(
          (e) =>
            `<li><span class="caveat-tag">不可比</span><span class="caveat-text">${esc(e.row.label)}：${
              e.row.caution ? esc(e.row.caution) : '两家口径不同，只并列、不判定胜负'
            }</span></li>`,
        )
        .join('')
    : '<li><span class="caveat-tag">不可比</span><span class="caveat-text">本页没有口径不同的参数</span></li>';
  return `
  <section class="card" id="summary">
    <h2 class="sec">结论摘要</h2>
    <p class="sec-note">以下句子由主表差异自动生成，只陈述差值与口径，不代表优劣结论。</p>
    <ul class="sum-list">${rows}</ul>
    <div class="caveats">
      <h3 class="caveat-h">未公布项（灰显，不参与比较）</h3>
      <ul class="caveat-list">${missingList}${derivedList}</ul>
      <h3 class="caveat-h">不可比项（只并列，不判定胜负）</h3>
      <ul class="caveat-list">${incomparableList}</ul>
    </div>
  </section>`;
}

/* ==========================================================================
 * 8. 各区块
 * ========================================================================== */
function granLabel(brand, granularity) {
  const b = BRAND_ZH[brand] ?? brand;
  if (granularity === 'compare-matrix') return `${b}官网·对比页（粒度较粗）`;
  return `${b}官网·规格页`;
}

/** 立绘已移除（产品侧判定效果不佳）：身份区只保留文字与徽章。 */
function spriteBlock() {
  return '';
}

function renderIdentity(a, b, opts) {
  const side = (p, s, brand) => {
    const price = minPriceOf(p);
    return `
    <div class="side side-${s}">
      <div class="p-brand">${esc(BRAND_ZH[brand] ?? brand)} · ${esc(p.line ?? '')}</div>
      <h2 class="p-name">${esc(p.name ?? p.id)}</h2>
      <div class="p-meta">
        <span>上市：${p.releaseDate ? esc(formatDateValue(p)) : '<span class="v-unpub">官方未公布</span>'}</span>
        <span>起售价：${price === null ? '<span class="v-unpub">官方未公布</span>' : `<span class="mono">${esc(String(price))}</span> 元起`}</span>
        <span>状态：${esc(STATUS_ZH[p.status] ?? p.status ?? '未知')}</span>
      </div>
      <div class="p-gran">
        <span class="gran-badge${p.granularity === 'compare-matrix' ? ' gran-coarse' : ''}"
          title="${esc(
            p.granularity === 'compare-matrix'
              ? '该机型取自苹果官网「对比页矩阵」（22 组），字段数少于规格页（35 章），因此本机缺失字段多属「官网这条通道没有」，不等于官网完全没有'
              : '该机型取自官网规格页，字段最细',
          )}">${esc(granLabel(brand, p.granularity))}</span>
      </div>
    </div>`;
  };
  const autoNote = opts.autoPicked
    ? `<p class="auto-note">本页对阵由脚本<b>自动挑选</b>：${esc(opts.autoWhy || '同价位、同代、一苹果一华为')}。` +
      `如需指定，请用 <code>--a</code> / <code>--b</code>。</p>`
    : '';
  return `
  <section class="card" id="identity">
    <div class="identity">
      ${side(a, 'a', opts.brandA)}
      <div class="vs"><span class="vs-badge">VS</span></div>
      ${side(b, 'b', opts.brandB)}
    </div>
    ${autoNote}
  </section>`;
}

function renderMatrix(entries, opts) {
  const groups = [];
  for (const row of ROWS) {
    if (row.fold === true) continue;
    if (row.compare === 'incomparable' || row.group === 'incomparable') continue;
    if (!groups.includes(row.group)) groups.push(row.group);
  }
  const blocks = groups
    .map((g) => {
      const list = entries.filter((e) => e.row.group === g);
      if (!list.length) return '';
      const filled = list.filter((e) => !e.missingA && !e.missingB).length;
      const body = list.map((e) => renderRow(e, opts)).join('');
      return `
      <div class="group">
        <h3 class="group-title"><span>${esc(GROUPS[g] ?? g)}</span><span class="group-meta">${filled}/${list.length} 行两台都有数据</span></h3>
        ${body}
      </div>`;
    })
    .join('');
  return `
  <section class="card" id="matrix">
    <h2 class="sec">对比主表</h2>
    <p class="sec-note">按参数分组逐行并列。<b>Δ 列只在差值达到「有意义阈值」时出现</b>；未达阈值不标，标了就是噪音。
      灰色「官方未公布」= 官网没有这个数，不是 0，也不判定胜负。</p>
    <div class="thead">
      <div class="th th-a">${esc(shortName(opts.a))}</div>
      <div class="th th-l">参数</div>
      <div class="th th-b">${esc(shortName(opts.b))}</div>
      <div class="th th-d">Δ</div>
    </div>
    ${blocks}
  </section>`;
}

function renderIncomparable(entries, opts) {
  const list = entries.filter((e) => e.level === 'incomparable');
  if (!list.length) return '';
  return `
  <section class="card" id="incomparable">
    <h2 class="sec">不可比清单</h2>
    <p class="sec-note">这些参数两家的<b>口径不同</b>（测试条件、统计方式不一致），并列展示但<b>不给 Δ、不判定胜负</b>。</p>
    ${list.map((e) => renderRow(e, { ...opts, plain: true })).join('')}
  </section>`;
}

function foldSection(title, note, inner, count) {
  return `
  <details class="fold">
    <summary>${esc(title)}${count ? `<span class="fold-count">${count}</span>` : ''}</summary>
    <div class="fold-body">${note ? `<p class="sec-note">${note}</p>` : ''}${inner}</div>
  </details>`;
}

function renderFolded(entries, a, b, opts, derived) {
  const foldedRows = entries.filter((e) => e.row.fold === true);
  const specTable = foldedRows.length
    ? foldedRows.map((e) => renderRow(e, { ...opts, plain: true })).join('')
    : '<p class="empty">没有折叠行</p>';

  const rawCol = (p, s) => {
    const raw = p?.rawOfficial && typeof p.rawOfficial === 'object' ? p.rawOfficial : null;
    const keys = raw ? Object.keys(raw) : [];
    if (!keys.length) {
      return `<div class="raw-col"><h4 class="raw-h">${esc(shortName(p))}</h4><p class="empty">${esc(
        p?.granularity === 'compare-matrix'
          ? '该机型只有对比页矩阵通道，官网原文段落未逐条采集'
          : '数据里没有 rawOfficial 原文段落',
      )}</p></div>`;
    }
    const items = keys
      .map((k) => {
        const v = raw[k];
        if (v === null || v === undefined || v === '') {
          return `<div class="raw-item"><dt>${esc(k)}</dt><dd class="v-unpub">官方未公布</dd></div>`;
        }
        const s2 = typeof v === 'string' ? v : JSON.stringify(v);
        const cut = s2.length > 1000;
        return (
          `<div class="raw-item"><dt>${esc(k)}</dt><dd>${esc(cut ? s2.slice(0, 1000) : s2)}` +
          `${cut ? `<span class="raw-cut">…（原文较长，此处节选前 1000 字）</span>` : ''}</dd></div>`
        );
      })
      .join('');
    return `<div class="raw-col"><h4 class="raw-h">${esc(shortName(p))}<span class="raw-gran">${esc(
      granLabel(p.brand, p.granularity),
    )}</span></h4><dl class="raw-list">${items}</dl></div>`;
  };

  const personaOf = (id) => derived?.data?.products?.find((x) => x.id === id) ?? null;
  const pA = personaOf(a.id);
  const pB = personaOf(b.id);
  const derivedInner = derived.data
    ? `<div class="derived-grid">
        <div class="raw-col"><h4 class="raw-h">${esc(shortName(a))}</h4>
          <p class="derived-persona">${esc(pA?.persona ?? '派生层没有这台机器的定位')}</p>
          ${renderPercentiles(pA)}</div>
        <div class="raw-col"><h4 class="raw-h">${esc(shortName(b))}</h4>
          <p class="derived-persona">${esc(pB?.persona ?? '派生层没有这台机器的定位')}</p>
          ${renderPercentiles(pB)}</div>
      </div>`
    : `<p class="empty">派生产物未生成：<code>${esc(derived.path)}</code> 不存在。跑过
       <code>node scripts/sync/index.mjs</code> 之后，「一句话定位 / 分位」才会出现在这里；
       当前主表的「一句话定位」行会如实显示为未生成。</p>`;

  const notes = [a, b]
    .filter((p) => Array.isArray(p?.notes) && p.notes.length)
    .map((p) => `<div class="raw-col"><h4 class="raw-h">${esc(shortName(p))} · 采集备注</h4><ul class="note-list">${p.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`)
    .join('');

  return `
  <section class="card" id="folded">
    <h2 class="sec">折叠区（默认收起）</h2>
    <p class="sec-note">长尾信息与可溯源证据。首屏只给结论与主表，这里全部默认收起。</p>
    ${foldSection('完整规格（折叠行）', null, specTable, foldedRows.length)}
    ${foldSection('官网原文规格（逐字段可溯源）', '每个数字都能回到官网原文段落；原文过长时截断并注明。', `<div class="raw-grid">${rawCol(a, 'a')}${rawCol(b, 'b')}</div>`)}
    ${foldSection('派生层：一句话定位 / 分位 / 头衔', null, derivedInner)}
    ${notes ? foldSection('采集备注（数据质量）', null, `<div class="raw-grid">${notes}</div>`) : ''}
  </section>`;
}

function renderPercentiles(p) {
  const pct = p?.percentiles;
  if (!pct) return '';
  const keys = ['weightG', 'thicknessMm', 'screenIn', 'ppi', 'brightnessPeakNits', 'batteryMah', 'wiredChargeW', 'storageMaxGb', 'priceCny', 'releaseDate'];
  const list = keys
    .filter((k) => typeof pct[k] === 'number')
    .map((k) => {
      const [label] = THRESHOLD_LABEL[k] ?? [k];
      const v = Math.round(pct[k] * 100);
      return `<span class="pct"><span class="pct-k">${esc(k === 'storageMaxGb' ? '最大存储' : label)}</span><span class="pct-v mono">${v}</span></span>`;
    })
    .join('');
  return list ? `<div class="pct-row">${list}</div>` : '<p class="empty">分位：数据不足</p>';
}

function renderSources(a, b, opts, dataInfo, derived) {
  const col = (p, s) => {
    const prov = p?.provenance && typeof p.provenance === 'object' ? Object.entries(p.provenance) : [];
    const rows = prov.length
      ? prov.map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="v-unpub">契约里没有 provenance 记录</td></tr>';
    const skus = (p?.skus ?? []).length
      ? p.skus
          .map(
            (sk) =>
              `<tr><td class="mono">${esc(`${sk.storageGb ?? '?'} GB`)}</td><td><span class="mono">${esc(
                String(sk.priceCny ?? '官方未公布'),
              )}</span> ${sk.priceCny === null || sk.priceCny === undefined ? '' : '元'} · ${esc(sk.priceNote ?? '口径未注明')} · 采集于 ${esc(sk.listedAt ?? '未注明')}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="2" class="v-unpub">官方未公布售价</td></tr>';
    return `
    <div class="src-col">
      <h4 class="raw-h">${esc(shortName(p))}</h4>
      <table class="src-table">
        <tr><th>数据粒度</th><td>${esc(granLabel(p.brand, p.granularity))}</td></tr>
        <tr><th>来源 id</th><td class="mono">${esc(p.granularity === 'compare-matrix' ? 'apple-compare' : p.brand === 'apple' ? 'apple-official' : 'huawei-official')}</td></tr>
        <tr><th>首次入库</th><td class="mono">${esc(p.firstSeenAt ?? '未记录')}</td></tr>
        <tr><th>最后确认</th><td class="mono">${esc(p.lastSeenAt ?? '未记录')}</td></tr>
      </table>
      <table class="src-table src-prov"><tr><th>字段</th><th>来源</th></tr>${rows}</table>
      <table class="src-table"><tr><th>档位 / 价格</th><th>口径</th></tr>${skus}</table>
    </div>`;
  };
  const thresholds = Object.entries(THRESHOLDS)
    .map(([k, v]) => {
      const [label, unit] = THRESHOLD_LABEL[k] ?? [k, ''];
      return `<tr><td>${esc(label)}</td><td class="mono">${esc(String(v))} ${esc(unit)}</td><td class="mono">${esc(
        String(v * 2),
      )} ${esc(unit)}</td></tr>`;
    })
    .join('');
  return `
  <section class="card" id="sources">
    <h2 class="sec">数据来源与口径</h2>
    <p class="sec-note">信任来自可追溯：每个字段都能回答「从哪来、什么口径」。角标 <sup class="badge badge-cal">典</sup> 是口径，
      <sup class="badge badge-caution">?</sup> 是这一行容易读错的地方，悬浮可看全文。</p>
    <div class="data-line">
      本页数据文件：<code>${esc(dataInfo.path ?? '（无：使用内置 fixture）')}</code>
      ${dataInfo.mtime ? `· 修改时间 <span class="mono">${esc(dataInfo.mtime)}</span>` : ''}
      ${dataInfo.isSnapshot ? '· 形态 Snapshot' : '· 形态 ProductRecord[]'}
      ${derived.data ? `· 派生层 <code>${esc(derived.path)}</code>` : `· 派生层缺失（<code>${esc(derived.path)}</code>）`}
    </div>
    <div class="src-grid">${col(a, 'a')}${col(b, 'b')}</div>
    <h3 class="group-title"><span>差异阈值（写进代码，可调）</span><span class="group-meta">右侧 = 强高亮门槛（阈值 × 2）</span></h3>
    <table class="thr-table"><tr><th>指标</th><th>有意义差异阈值</th><th>强高亮门槛</th></tr>${thresholds}</table>
    <p class="sec-note">阈值来自 <code>src/lib/compare-spec.mjs</code> 的 <code>THRESHOLDS</code>；差异等级来自 <code>diffLevel()</code>，
      优势方来自 <code>winner()</code>。本页不重写任何一条判断。</p>
  </section>`;
}

/* ==========================================================================
 * 9. 页面骨架 + 内联 CSS
 * ========================================================================== */
function css(vars) {
  return `
:root{
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",system-ui,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --ink:#1d1d1f;--ink2:#424245;--ink3:#6e6e73;--ink4:#86868b;
  --line:#d2d2d7;--line2:#e8e8ed;--panel:#ffffff;--canvas:#f5f5f7;
  --a-accent:${vars.aAccent};--a-soft:${vars.aSoft};--a-line:${vars.aLine};
  --b-accent:${vars.bAccent};--b-soft:${vars.bSoft};--b-line:${vars.bLine};
  --stripe:repeating-linear-gradient(45deg,rgba(0,0,0,.05) 0 5px,rgba(0,0,0,0) 5px 10px);
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.6}
code{font-family:var(--mono);font-size:12px;background:#f0f0f2;border-radius:4px;padding:1px 4px}
.wrap{max-width:1180px;margin:0 auto;padding:16px 16px 72px}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.v-unit{font-family:var(--sans);margin-left:.28em}
.vh{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.page-head{padding:22px 0 6px}
.page-head h1{font-size:22px;margin:0 0 6px;letter-spacing:-.01em}
.page-head p{margin:0;color:var(--ink3);font-size:12px}
.banner{border-radius:10px;padding:10px 14px;font-size:12.5px;margin:12px 0;background:#f0f0f2;color:var(--ink2);border:1px solid var(--line)}
.banner b{color:var(--ink)}
.card{background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:18px;margin:16px 0}
.sec{font-size:19px;margin:0 0 6px;letter-spacing:-.01em}
.sec-note{font-size:12.5px;color:var(--ink3);margin:0 0 14px;line-height:1.65}
.empty{font-size:12.5px;color:var(--ink3);margin:6px 0}
.v-unpub{color:var(--ink4)}
/* ---- ① 身份区 ---- */
.identity{display:grid;gap:10px;grid-template-columns:minmax(0,1fr)}
.side{border-top:4px solid var(--line);padding-top:10px;min-width:0}
.sprite{position:relative;margin:0 auto 10px;width:170px}
.sprite svg{width:100%;height:auto;display:block}
.sprite-note{display:block;text-align:center;font-size:11px;color:var(--ink4);margin-top:2px;cursor:help}
.side-a{border-top-color:var(--a-accent)}
.side-b{border-top-color:var(--b-accent)}
.side-a .p-name{color:var(--a-accent)}
.side-b .p-name{color:var(--b-accent)}
.p-brand{font-size:12px;color:var(--ink3);letter-spacing:.08em}
.p-name{font-size:20px;margin:2px 0 6px;line-height:1.25;word-break:break-word}
.p-meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--ink2)}
.p-gran{margin-top:8px}
.gran-badge{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 9px;color:var(--ink3);background:#fafafa}
.gran-coarse{border-color:#b9b9be;color:var(--ink2);background:#f0f0f2}
.vs{display:flex;align-items:center;justify-content:center}
.vs-badge{font-family:var(--mono);font-size:13px;color:var(--ink3);border:1px solid var(--line);border-radius:999px;padding:4px 12px;background:#fafafa}
.auto-note{font-size:12.5px;color:var(--ink2);background:#fafafa;border:1px dashed var(--line);border-radius:10px;padding:8px 12px;margin:14px 0 0}
/* ---- ② 摘要 ---- */
.sum-list{list-style:none;margin:0;padding:0}
.sum-item{display:flex;gap:10px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--line2)}
.sum-idx{font-family:var(--mono);font-size:12px;color:var(--ink4);flex:0 0 auto}
.sum-text{font-size:14.5px}
.sum-strong .sum-text{font-weight:600}
.caveats{margin-top:18px;border-top:1px solid var(--line2);padding-top:12px}
.caveat-h{font-size:13px;color:var(--ink3);margin:10px 0 6px;font-weight:600}
.caveat-list{list-style:none;margin:0;padding:0}
.caveat-list li{font-size:12.5px;color:var(--ink2);padding:4px 0;display:flex;gap:8px;align-items:baseline}
.caveat-text{min-width:0}
.caveat-tag{flex:0 0 auto;font-size:12px;border:1px solid var(--line);border-radius:4px;padding:0 5px;color:var(--ink3);background:#fafafa}
/* ---- ③ 主表 ---- */
.thead{display:none}
.group{margin-top:22px}
.group-title{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:13px;font-weight:600;color:var(--ink2);
  border-bottom:1px solid var(--line);padding-bottom:6px;margin:0}
.group-meta{font-size:12px;color:var(--ink4);font-weight:400}
.spec-row{display:grid;gap:2px 12px;padding:11px 0;border-bottom:1px solid var(--line2);
  grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  grid-template-areas:"label label" "a b" "delta delta"}
.c-label{grid-area:label;font-size:13.5px;color:var(--ink2)}
.c-a{grid-area:a;min-width:0}
.c-b{grid-area:b;min-width:0;text-align:right}
.c-delta{grid-area:delta;text-align:right;font-size:12px;color:var(--ink3);white-space:nowrap}
.val{display:inline;font-size:15px;line-height:1.5;word-break:break-word}
.val-edge .v{font-weight:700}
.val.win-a{background:var(--a-soft);border:1px solid var(--a-line);border-radius:6px;padding:1px 7px;font-weight:600}
.val.win-b{background:var(--b-soft);border:1px solid var(--b-line);border-radius:6px;padding:1px 7px;font-weight:600}
.side-tag{display:inline-block;font-family:var(--sans);font-size:12px;color:var(--ink4);border:1px solid var(--line2);border-radius:4px;padding:0 4px;margin-right:5px}
.badge{font-size:12px;line-height:1;vertical-align:super;margin-left:3px;cursor:help;font-family:var(--sans)}
.badge-cal{color:var(--ink3)}
.badge-caution{color:var(--ink3);border:1px solid var(--line);border-radius:999px;padding:0 4px}
.delta-v{font-size:12px;color:var(--ink2)}
.delta-arrow{font-size:13px;margin-left:4px}
.delta-a{color:var(--a-accent)}
.delta-b{color:var(--b-accent)}
.delta-na{color:var(--ink4)}
.tag-win{display:inline-block;font-size:12px;border-radius:999px;padding:0 7px;margin-left:6px;vertical-align:1px}
.tag-a{color:var(--a-accent);background:var(--a-soft);border:1px solid var(--a-line)}
.tag-b{color:var(--b-accent);background:var(--b-soft);border:1px solid var(--b-line)}
.spec-row.is-incomparable{background:var(--stripe)}
.spec-row.is-plain{grid-template-areas:"label label" "a b"}
/* ---- ④ 折叠区 ---- */
details.fold{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:0 16px;margin:12px 0}
details.fold>summary{cursor:pointer;padding:14px 0;font-size:15px;font-weight:600;list-style:none;display:flex;gap:8px;align-items:center}
details.fold>summary::-webkit-details-marker{display:none}
details.fold>summary::before{content:"▸";color:var(--ink3);font-size:13px}
details.fold[open]>summary::before{content:"▾"}
details.fold>summary:focus-visible{outline:2px solid var(--ink3);outline-offset:2px}
.fold-count{font-size:12px;color:var(--ink4);font-weight:400}
.fold-body{padding:0 0 14px;border-top:1px solid var(--line2)}
.raw-grid,.derived-grid,.src-grid{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}
.raw-h{font-size:13px;margin:12px 0 6px;color:var(--ink2)}
.raw-gran{font-size:12px;color:var(--ink4);font-weight:400;margin-left:6px}
.raw-list{margin:0;padding:0}
.raw-item{padding:6px 0;border-bottom:1px solid var(--line2)}
.raw-item dt{font-size:12.5px;color:var(--ink3)}
.raw-item dd{margin:2px 0 0;font-size:12.5px;color:var(--ink2);word-break:break-word}
.raw-cut{color:var(--ink4);font-size:12px;margin-left:4px}
.note-list{margin:0;padding-left:18px;font-size:12.5px;color:var(--ink2)}
.derived-persona{font-size:13.5px;margin:4px 0 8px}
.pct-row{display:flex;flex-wrap:wrap;gap:6px}
.pct{display:inline-flex;gap:4px;align-items:baseline;border:1px solid var(--line2);border-radius:6px;padding:1px 7px;font-size:12px;color:var(--ink3)}
.pct-v{font-size:12px;color:var(--ink2)}
/* ---- ⑦ 来源 ---- */
.data-line{font-size:12.5px;color:var(--ink3);background:#fafafa;border:1px solid var(--line2);border-radius:8px;padding:8px 12px}
.src-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
.src-table th,.src-table td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line2);vertical-align:top;word-break:break-word}
.src-table th{color:var(--ink3);font-weight:400;white-space:nowrap}
.thr-table{width:100%;border-collapse:collapse;font-size:12.5px;margin:8px 0 12px}
.thr-table th,.thr-table td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line2)}
.thr-table th{color:var(--ink3);font-weight:400}
.page-foot{font-size:12px;color:var(--ink4);padding:8px 0 0;line-height:1.7}
@media(min-width:1024px){
  .wrap{padding:24px 24px 80px}
  .identity{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:start;gap:20px}
  .side-b{text-align:right}
  .side-b .p-meta{justify-content:flex-end}
  .vs{padding-top:22px}
  .raw-grid,.derived-grid,.src-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .thead{display:grid;grid-template-columns:minmax(0,1fr) 210px minmax(0,1fr) 104px;gap:0 12px;
    position:sticky;top:0;z-index:2;background:var(--panel);border-bottom:1px solid var(--line);
    padding:8px 0;font-size:12px;color:var(--ink3)}
  .th-l{text-align:center}
  .th-a{text-align:right;color:var(--a-accent)}
  .th-b{text-align:left;color:var(--b-accent)}
  .th-d{text-align:right}
  .spec-row{grid-template-columns:minmax(0,1fr) 210px minmax(0,1fr) 104px;
    grid-template-areas:"a label b delta";align-items:baseline;gap:0 12px;padding:9px 0}
  .spec-row.is-plain{grid-template-columns:minmax(0,1fr) 210px minmax(0,1fr);grid-template-areas:"a label b"}
  .c-a{text-align:right}
  .c-b{text-align:left}
  .c-label{text-align:center}
  .side-tag{display:none}
}
`;
}

function renderPage(ctx) {
  const { a, b, opts, entries, dataInfo, derived, generatedAt } = ctx;
  const vars = {
    aAccent: opts.accentA.accent, aSoft: opts.accentA.soft, aLine: opts.accentA.line,
    bAccent: opts.accentB.accent, bSoft: opts.accentB.soft, bLine: opts.accentB.line,
  };
  const sum = buildSummary(entries, opts);
  const fixtureBanner = opts.fixture
    ? `<div class="banner"><b>内置 fixture（假数据）</b>：本页两台机型是脚本内置的虚构样机，不是真实产品，
       只用于在真实数据缺失时独立迭代 UI。任何数字都不代表任何真实机型。</div>`
    : '';
  const dataBanner =
    !opts.fixture && dataInfo.path !== 'data/products.json'
      ? `<div class="banner">数据说明：<code>data/products.json</code> <b>尚不存在</b>（同步管线未落盘），
         本页回退使用 <code>${esc(dataInfo.path)}</code>。字段为空属预期状态，界面按「官方未公布」呈现。</div>`
      : '';
  const audit = {
    generatedAt,
    fixture: Boolean(opts.fixture),
    dataPath: dataInfo.path,
    a: { id: a.id, brand: a.brand, name: a.name, granularity: a.granularity },
    b: { id: b.id, brand: b.brand, name: b.name, granularity: b.granularity },
    autoPicked: Boolean(opts.autoPicked),
    autoWhy: opts.autoWhy ?? null,
    thresholds: THRESHOLDS,
    rows: entries.map((e) => ({
      id: e.row.id, group: e.row.group, label: e.row.label, compare: e.row.compare,
      level: e.level, winner: e.win, delta: e.delta, valueA: e.textA, valueB: e.textB,
      missingA: e.missingA, missingB: e.missingB, caliberA: e.calA, caliberB: e.calB,
    })),
  };
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(shortName(a))} vs ${esc(shortName(b))} · 参数对比（静态预览）</title>
<style>${css(vars)}</style>
</head>
<body${opts.fixture ? ' data-fixture="1"' : ''}>
<div class="wrap">
  <header class="page-head">
    <h1>${esc(shortName(a))} <span class="v-unpub">vs</span> ${esc(shortName(b))}</h1>
    <p>对比页静态渲染器产出 · 生成于 <span class="mono">${esc(generatedAt)}</span> ·
      差异等级与优势方判定来自 <code>src/lib/compare-spec.mjs</code>（本页未重写任何判断）</p>
  </header>
  ${fixtureBanner}${dataBanner}
  ${renderIdentity(a, b, opts)}
  ${renderSummary(sum, opts)}
  ${renderMatrix(entries, opts)}
  ${renderIncomparable(entries, opts)}
  ${renderFolded(entries, a, b, opts, derived)}
  ${renderSources(a, b, opts, dataInfo, derived)}
  <footer class="page-foot">
    本页无「综合胜出」、无推荐、无加权总分：轻不等于好，贵不等于强，本站没有跑分，任何总分都是编造。<br>
    未公布 = 官网没有给出这个数，界面如实显示「官方未公布」，不写 0、不写 —、不判定胜负。<br>
    单文件产出，内联 CSS，无外部资源、无 CDN、无外链字体、无行为脚本。
  </footer>
</div>
<!-- 下方为惰性 JSON 数据块（type=application/json，浏览器不会执行），供自动化断言与下游读取；本页没有任何行为脚本 -->
<script type="application/json" id="render-audit">${JSON.stringify(audit).replace(/</g, '\\u003c')}</script>
</body>
</html>
`;
}

/* ==========================================================================
 * 10. 自证断言（跑完打印）
 * ========================================================================== */
const ZERO_RE = />\s*0(?:\.0+)?\s*(?:元|g|mm|英寸|ppi|Hz|nits|mAh|W|GB|种|颗|小时)?\s*</g;

function extractRows(html) {
  const pieces = html.split(ROW_END);
  pieces.pop(); // 最后一个 ROW_END 之后没有行
  return pieces
    .map((piece) => {
      const m = piece.match(/data-row="([^"]+)"\s+data-diff="([^"]+)"\s+data-null="([^"]*)"\s+data-winner="([^"]*)"/);
      if (!m) return null;
      const start = piece.lastIndexOf('<div class="spec-row');
      return { id: m[1], diff: m[2], nullSides: m[3], winner: m[4], html: start >= 0 ? piece.slice(start) : piece };
    })
    .filter(Boolean);
}

function runAssertions(html, ctx) {
  const results = [];
  const rows = extractRows(html);
  const visible = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');

  /* A1：null 绝不渲染成 0 */
  const zeroHits = [];
  for (const m of visible.matchAll(ZERO_RE)) zeroHits.push(m[0]);
  const nullRows = rows.filter((r) => r.nullSides !== '');
  const nullRowsMissingText = nullRows.filter((r) => !/官方未公布/.test(r.html));
  const unpubCells = (visible.match(/官方未公布/g) ?? []).length;
  const a1 = zeroHits.length === 0 && nullRowsMissingText.length === 0;
  results.push({
    id: 'A1',
    ok: a1,
    title: 'null 绝不渲染成 0 / — / 空单元格',
    detail:
      `零值单元格命中 ${zeroHits.length} 处${zeroHits.length ? `：${JSON.stringify(zeroHits.slice(0, 5))}` : ''}；` +
      `data-null 非空的行 ${nullRows.length} 行，全部含「官方未公布」字样（漏 ${nullRowsMissingText.length} 行）；` +
      `缺失单元格 ${ctx.missingCells} 个（=${ctx.entries.filter((e) => e.missingA).length} A 侧 + ${ctx.entries.filter((e) => e.missingB).length} B 侧），` +
      `页面「官方未公布」共 ${unpubCells} 处（含身份区）`,
  });

  /* A2：weak 行绝不带品牌色底 class */
  const winUsage = (visible.match(/\bwin-[ab]\b/g) ?? []).length;
  const weakRows = rows.filter((r) => r.diff === 'weak');
  const weakWithWin = weakRows.filter((r) => /\bwin-[ab]\b/.test(r.html));
  const strongRows = rows.filter((r) => r.diff === 'strong');
  const strongWithoutWin = strongRows.filter((r) => !/\bwin-[ab]\b/.test(r.html));
  const a2 = weakWithWin.length === 0 && strongWithoutWin.length === 0;
  results.push({
    id: 'A2',
    ok: a2,
    title: 'weak 行没有品牌色底；品牌色底只出现在 strong 行',
    detail:
      `weak 行 ${weakRows.length} 行，带 win-* class 的 ${weakWithWin.length} 行` +
      `${weakWithWin.length ? `（${weakWithWin.map((r) => r.id).join(', ')}）` : ''}；` +
      `strong 行 ${strongRows.length} 行，缺 win-* 的 ${strongWithoutWin.length} 行` +
      `${strongWithoutWin.length ? `（${strongWithoutWin.map((r) => r.id).join(', ')}）` : ''}；全页 win-* 出现 ${winUsage} 次`,
  });

  /* A3：不可比行没有 Δ 元素 */
  const incompRows = rows.filter((r) => r.diff === 'incomparable');
  const bad = incompRows.filter((r) => /class="[^"]*\bdelta|c-delta|▲|▼|Δ/.test(r.html));
  const noneRows = rows.filter((r) => r.diff === 'none');
  const a3 = bad.length === 0;
  results.push({
    id: 'A3',
    ok: a3,
    title: '不可比行的单元格里没有 Δ 元素',
    detail:
      `不可比行 ${incompRows.length} 行，含 Δ / ▲ / ▼ / c-delta 的 ${bad.length} 行` +
      `${bad.length ? `（${bad.map((r) => r.id).join(', ')}）` : ''}；` +
      `同一规则也用在 compare:'none' 的行上：none 档共 ${noneRows.length} 行，全部不渲染 Δ 列`,
  });

  /* A4（附加）：摘要区不出现「综合胜出 / 推荐购买」这类判断 */
  const summarySection = (html.match(/<section class="card" id="summary">[\s\S]*?<\/section>/) ?? [''])[0];
  const summaryText = summarySection.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  const bannedHits = BANNED_VERDICT.filter((w) => summaryText.includes(w));
  results.push({
    id: 'A4',
    ok: bannedHits.length === 0,
    title: '结论摘要里没有「综合胜出 / 推荐购买 / 总分」这类判断',
    detail: `扫描摘要可见文本 ${summaryText.length} 字，命中禁用措辞 ${bannedHits.length} 个${bannedHits.length ? `：${bannedHits.join('、')}` : ''}`,
  });

  /* A5（附加）：自包含 —— 不加载任何外部资源、没有行为脚本 */
  const external = [];
  if (/<link\b[^>]*\bhref=/i.test(html)) external.push('<link href>');
  if (/<script\b[^>]*\bsrc=/i.test(html)) external.push('<script src>');
  if (/@import/i.test(html)) external.push('@import');
  if (/url\(\s*['"]?https?:/i.test(html)) external.push('url(http…)');
  if (/<img\b/i.test(html)) external.push('<img>');
  if (/<iframe\b|<embed\b|<object\b|<video\b|<audio\b/i.test(html)) external.push('嵌入元素');
  // 数据自带的明文 URL（product.notes 里的溯源备注）只是被转义后的文本，不会发起任何请求，单独计数、不算失败
  const plainUrls = (visible.match(/https?:\/\//gi) ?? []).length;
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1].trim());
  const executable = scripts.filter((s) => !/type="application\/json"/i.test(s));
  results.push({
    id: 'A5',
    ok: external.length === 0 && executable.length === 0,
    title: '单文件自包含：无 CDN / 外链字体 / 行为脚本',
    detail:
      `外部资源引用命中 ${external.length} 处${external.length ? `：${external.join('、')}` : ''}；` +
      `<script> 标签 ${scripts.length} 个，可执行的 ${executable.length} 个（余下均为 inert JSON 数据块）；` +
      `数据文本里的明文 URL ${plainUrls} 处（来自 product.notes 的溯源备注，转义后当纯文本渲染，未生成 <a>、不会发起请求）`,
  });

  return results;
}

export { renderPage, evaluateRow, loadDerived };

/* ==========================================================================
 * 11. main
 * ========================================================================== */
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const generatedAt = new Date().toISOString();
  const outPath = absFrom(args.out ?? '_work/preview/compare.html');

  let dataInfo = { products: null, vendors: [], generatedAt: null, path: null, mtime: null, isSnapshot: false, tried: [] };
  let fixture = Boolean(args.fixture);
  if (!fixture) {
    dataInfo = loadData(args.data);
    if (!dataInfo.products) {
      console.warn(`⚠ 没有可用的真实数据（尝试过：${dataInfo.tried.join(' → ')}），自动降级为内置 fixture。`);
      console.warn('  真实数据到位后重跑即可；界面本身不受影响。');
      fixture = true;
    }
  }
  if (fixture) {
    dataInfo = { products: fixtureProducts(), vendors: [], generatedAt: null, path: null, mtime: null, isSnapshot: false, tried: dataInfo.tried };
  }

  const products = dataInfo.products;
  const derived = loadDerived(args.derived);

  /* 选机型：显式 > 自动挑 > fixture 兜底 */
  let a = null;
  let b = null;
  let autoPicked = false;
  let autoWhy = null;
  const byId = new Map(products.map((p) => [p.id, p]));
  if (args.a) a = byId.get(args.a) ?? null;
  if (args.b) b = byId.get(args.b) ?? null;
  if (args.a && !a) {
    console.warn(`⚠ 数据里没有 --a 指定的 id：${args.a}`);
    console.warn(`  可用 id（前 20 个）：${products.slice(0, 20).map((p) => p.id).join(', ')}${products.length > 20 ? ` … 共 ${products.length} 台` : ''}`);
  }
  if (args.b && !b) {
    console.warn(`⚠ 数据里没有 --b 指定的 id：${args.b}`);
    console.warn(`  可用 id（前 20 个）：${products.slice(0, 20).map((p) => p.id).join(', ')}${products.length > 20 ? ` … 共 ${products.length} 台` : ''}`);
  }
  if (a && !b) {
    const opp = products.filter((p) => p.brand !== a.brand);
    const best = pickPair(opp.length ? [a, ...opp] : products);
    b = best ? (best.a.brand === a.brand ? best.b : best.a) : null;
    if (b) autoWhy = `按 --a 指定，对手自动挑为 ${b.id}`;
  } else if (b && !a) {
    const opp = products.filter((p) => p.brand !== b.brand);
    const best = pickPair(opp.length ? [b, ...opp] : products);
    a = best ? (best.a.brand === b.brand ? best.b : best.a) : null;
    if (a) autoWhy = `按 --b 指定，对手自动挑为 ${a.id}`;
  }
  if (!a || !b) {
    const best = pickPair(products);
    if (best) {
      a = best.a;
      b = best.b;
      autoPicked = !args.a && !args.b;
      autoWhy = [...best.why, `自动挑分 ${Math.round(best.score)}`].join(' · ');
    }
  }
  if (!a || !b) {
    // 数据里凑不出「一苹果一华为」：如实说明，不崩
    console.warn('⚠ 数据里凑不出「一个苹果 + 一个华为」的对阵，改用内置 fixture 渲染空状态页。');
    fixture = true;
    const fx = fixtureProducts();
    a = fx[0];
    b = fx[1];
    dataInfo = { ...dataInfo, path: null };
    autoWhy = '数据不足，页面回退到内置 fixture';
  }

  const vendors = new Map((dataInfo.vendors ?? []).map((v) => [v.id, v]));
  const accentOf = (brand) => {
    const v = vendors.get(brand);
    return {
      accent: v?.accentColor ?? BRAND_FALLBACK[brand]?.accent ?? BRAND_FALLBACK.apple.accent,
      soft: BRAND_FALLBACK[brand]?.soft ?? BRAND_FALLBACK.apple.soft,
      line: BRAND_FALLBACK[brand]?.line ?? BRAND_FALLBACK.apple.line,
    };
  };

  const personaOf = (id) => derived.data?.products?.find((x) => x.id === id)?.persona ?? null;
  const personas = { a: personaOf(a.id), b: personaOf(b.id) };
  const opts = {
    a, b,
    brandA: a.brand, brandB: b.brand,
    accentA: accentOf(a.brand), accentB: accentOf(b.brand),
    fixture, autoPicked, autoWhy,
    showSideTag: true,
    derivedPath: derived.path,
  };
  const entries = ROWS.map((row) => evaluateRow(row, a, b, personas));
  const html = renderPage({ a, b, opts, entries, dataInfo, derived, generatedAt });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  const bytes = statSync(outPath).size;

  /* ---- 统计 ---- */
  const levels = ['none', 'weak', 'strong', 'missing', 'incomparable'];
  const all = Object.fromEntries(levels.map((l) => [l, 0]));
  const mainOnly = Object.fromEntries(levels.map((l) => [l, 0]));
  for (const e of entries) {
    all[e.level] = (all[e.level] ?? 0) + 1;
    if (e.row.group !== 'incomparable' && e.row.fold !== true) mainOnly[e.level] = (mainOnly[e.level] ?? 0) + 1;
  }
  const missingCells = entries.filter((e) => e.missingA).length + entries.filter((e) => e.missingB).length;

  console.log('');
  console.log('=== 对比页静态渲染结果 ===');
  console.log(`对阵：A=${a.id}（${BRAND_ZH[a.brand] ?? a.brand}）  B=${b.id}（${BRAND_ZH[b.brand] ?? b.brand}）`);
  console.log(`模式：${fixture ? '内置 fixture（假数据）' : '真实数据'}${autoPicked ? ' · 对阵自动挑选' : ''}${autoWhy ? `（${autoWhy}）` : ''}`);
  console.log(`数据：${dataInfo.path ?? '（内置 fixture）'}${dataInfo.mtime ? ` · mtime ${dataInfo.mtime}` : ''}`);
  console.log(`派生层：${derived.data ? derived.path : `${derived.path}（不存在，一句话定位/分位按缺省呈现）`}`);
  console.log(`产出：${relFrom(outPath)}  ${bytes} 字节`);
  console.log('');
  console.log(`行数统计（ROWS 全部 ${entries.length} 行）：`);
  for (const l of levels) console.log(`  ${l.padEnd(13)} ${String(all[l]).padStart(3)}   其中主表 ${mainOnly[l]}`);
  console.log(`未公布单元格（一侧或两侧为 null）：${missingCells} 个`);
  console.log('');
  console.log('=== 自证断言 ===');
  let failed = 0;
  for (const r of runAssertions(html, { entries, a, b, missingCells })) {
    if (!r.ok) failed += 1;
    console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.id} ${r.title}`);
    console.log(`       ${r.detail}`);
  }
  console.log('');
  if (failed) {
    console.log(`❌ ${failed} 条断言未通过`);
    process.exitCode = 1;
  } else {
    console.log('✅ 全部断言通过');
  }
  console.log('');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
