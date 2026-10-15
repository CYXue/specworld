import { brandShortLabel } from '../brands.mjs';
import { isFoldableOfficial } from './foldable.mjs';
import { pick } from './specs.mjs';

/**
 * 派生层：分位标尺、首页头衔、一句话定位。
 *
 * 三条规矩（都来自数据现实，不是审美偏好）：
 *
 * 1. **档位一律用「当前池内的分位」**，不用绝对阈值。三年后手机普遍更重更贵，
 *    写死阈值不会报错，只会悄悄失效。
 *
 * 2. **头衔必须过覆盖率门槛**。电池容量只有华为公布、充电功率只有华为公布——
 *    如果不管覆盖率就发「续航最长」的奖杯，等于把「唯一公布数据的品牌」说成「最强的品牌」。
 *    覆盖率不到门槛时，头衔显示「官方数据不足，本站不排名」，这比一个假冠军有价值。
 *
 * 3. **跨口径的数字不排名**。厂商标称续航（苹果「视频播放 34 小时」vs 华为「视频播放 X 小时」）
 *    测试条件不同，只并列展示，不参与任何排序。
 */

/** 每个指标的方向：'high' 表示越大越好，'low' 表示越小越好 */
export const METRICS = {
  weightG: { label: '重量', unit: 'g', dir: 'low', path: 'body.weightG' },
  thicknessMm: { label: '厚度', unit: 'mm', dir: 'low', path: 'body.thicknessMm' },
  screenIn: { label: '屏幕尺寸', unit: '英寸', dir: 'high', path: 'display.sizeIn' },
  ppi: { label: '像素密度', unit: 'ppi', dir: 'high', path: 'display.ppi' },
  brightnessPeakNits: {
    label: '峰值亮度',
    unit: 'nits',
    dir: 'high',
    path: 'display.brightnessPeakNits',
  },
  batteryMah: { label: '电池容量', unit: 'mAh', dir: 'high', path: 'battery.capacityMah' },
  wiredChargeW: { label: '有线充电', unit: 'W', dir: 'high', path: 'battery.wiredChargeW' },
  storageMaxGb: { label: '最大存储', unit: 'GB', dir: 'high', path: 'memory.storageGb' },
  priceCny: { label: '起售价', unit: '元', dir: 'low', path: 'skus' },
  releaseDate: { label: '发布时间', unit: '', dir: 'high', path: 'releaseDate' },
};

/** 头衔的覆盖率门槛：低于它就不发奖杯 */
export const TITLE_COVERAGE = 0.5;
/** 头衔的最少参赛数 */
export const TITLE_MIN_POOL = 6;

const get = pick; // specs-first：v2 读 specs 容器，v1 回退嵌套（迁移期双兼容）

/** 从机型上取指标原始值。返回 null 表示这台机器没有这个数据（不是 0） */
export function metricValue(product, key) {
  switch (key) {
    case 'storageMaxGb': {
      const arr = get(product, 'memory.storageGb') ?? [];
      return arr.length ? Math.max(...arr) : null;
    }
    case 'priceCny': {
      const prices = (product.skus ?? [])
        .map((s) => s.priceCny)
        .filter((v) => typeof v === 'number' && v > 0);
      return prices.length ? Math.min(...prices) : null;
    }
    case 'releaseDate': {
      if (!product.releaseDate) return null;
      const t = Date.parse(product.releaseDate);
      return Number.isNaN(t) ? null : t;
    }
    default: {
      const v = get(product, METRICS[key].path);
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
  }
}

/** 构建标尺：每个指标的分布 + 覆盖率。必须喂全体（当前池） */
export function buildScales(products) {
  const scales = {};
  for (const key of Object.keys(METRICS)) {
    scales[key] = buildOneScale(products, key);
  }
  return scales;
}

/** 单个指标的标尺（分品类构建的公共件） */
function buildOneScale(products, key) {
  const pairs = products.map((p) => ({ id: p.id, v: metricValue(p, key) })).filter((x) => x.v !== null);
  const values = pairs.map((x) => x.v).sort((a, b) => a - b);
  return {
    ...METRICS[key],
    values,
    byId: new Map(pairs.map((x) => [x.id, x.v])),
    coverage: products.length ? pairs.length / products.length : 0,
    enough:
      pairs.length >= TITLE_MIN_POOL &&
      pairs.length / Math.max(products.length, 1) >= TITLE_COVERAGE,
  };
}

/**
 * 分品类标尺（2026-10-15 六品类扩充）。
 *
 * 为什么必须分品类：METRICS 的手机口径指标（body.weightG=克 / display.sizeIn=英寸）
 * 在平板品类同名同单位（body.weightG / display.sizeIn）——**跨品类混算会让
 * "最轻手机"的池子里混进 293g 的 iPad mini**，而它零报错、静默地拿走头衔。
 * 笔记本的重量是 body.weightKg（千克）、台式无电池——单位/键名不同天然隔离，
 * 但 phone 与 tablet 共用键名的那几个维度必须显式分池。
 */
export function buildScalesByCategory(products) {
  const byCat = new Map();
  for (const p of products) {
    const cat = p.category ?? 'phone';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(p);
  }
  const out = {};
  for (const [cat, list] of byCat) {
    out[cat] = {};
    for (const key of Object.keys(METRICS)) out[cat][key] = buildOneScale(list, key);
  }
  return out;
}

/** 取「同品类」的标尺组（未知品类回退 phone，保证调用方不炸） */
function scalesOf(scalesByCategory, category) {
  return scalesByCategory?.[category ?? 'phone'] ?? scalesByCategory?.phone ?? {};
}

/** 某台机器在某个指标上的分位（0–1，已按方向校正：1 = 最好） */
export function percentileOf(scales, key, product) {
  const scale = scales[key];
  const v = metricValue(product, key);
  if (v === null || !scale || scale.values.length < 2) return null;
  const below = scale.values.filter((x) => x < v).length;
  const equal = scale.values.filter((x) => x === v).length;
  const pct = (below + equal / 2) / scale.values.length;
  return scale.dir === 'low' ? 1 - pct : pct;
}

/** 头衔定义。每个头衔都要能说出「凭什么」 */
const TITLES = [
  { id: 'lightest', metric: 'weightG', title: '最轻', why: (v, u) => `整机 ${v} ${u}` },
  { id: 'thinnest', metric: 'thicknessMm', title: '最薄', why: (v, u) => `机身 ${v} ${u}` },
  { id: 'biggest-screen', metric: 'screenIn', title: '屏幕最大', why: (v, u) => `${v} ${u} 屏幕` },
  { id: 'sharpest', metric: 'ppi', title: '最细腻', why: (v, u) => `${v} ${u}` },
  {
    id: 'brightest',
    metric: 'brightnessPeakNits',
    title: '屏幕最亮',
    why: (v, u) => `峰值 ${v} ${u}`,
  },
  { id: 'longest-battery', metric: 'batteryMah', title: '电池最大', why: (v, u) => `${v} ${u}` },
  {
    id: 'fastest-charge',
    metric: 'wiredChargeW',
    title: '充电最快',
    why: (v, u) => `${v} ${u} 有线`,
  },
  {
    id: 'most-storage',
    metric: 'storageMaxGb',
    title: '存储最大',
    why: (v) => `最高 ${v / 1024 >= 1 ? `${v / 1024} TB` : `${v} GB`}`,
  },
  {
    id: 'newest',
    metric: 'releaseDate',
    title: '最新发布',
    why: (v) => new Date(v).toISOString().slice(0, 10),
  },
];

/**
 * 首页头衔。数据不足时**不发奖杯**，返回 insufficient 让界面如实说明。
 *
 * 2026-10-15：分品类产出（`{ [category]: [title...] }`）——跨品类排名会把
 * "屏幕最大"颁给 iPad Pro 而首页语境是手机站；按品类分组后每个品类各自发奖杯，
 * 覆盖率门槛也在各品类池内独立判定（平板自有其密度）。
 *
 * @param products 全池产品
 * @param scalesByCategory buildScalesByCategory 的产物（nested）
 * @returns {Object<string, Array<{id,title,productId,value,why,insufficient,coverage,pool}>>}
 */
export function buildChampions(products, scalesByCategory) {
  const out = {};
  for (const cat of new Set(products.map((p) => p.category ?? 'phone'))) {
    const pool = products.filter((p) => (p.category ?? 'phone') === cat);
    const scales = scalesOf(scalesByCategory, cat);
    out[cat] = TITLES.map((t) => {
      const scale = scales[t.metric];
      const base = {
        id: t.id,
        title: t.title,
        metric: t.metric,
        coverage: scale?.coverage ?? 0,
        pool: scale?.values.length ?? 0,
      };
      if (!scale?.enough) {
        return {
          ...base,
          productId: null,
          value: null,
          why: null,
          insufficient: `官方公布该参数的机型只有 ${base.pool}/${pool.length} 台（需 ≥${Math.ceil(
            TITLE_COVERAGE * pool.length,
          )} 台），本站不排名`,
        };
      }
      const best = pool.reduce((acc, p) => {
        const v = metricValue(p, t.metric);
        if (v === null) return acc;
        if (!acc) return { p, v };
        const better = scale.dir === 'low' ? v < acc.v : v > acc.v;
        return better ? { p, v } : acc;
      }, null);
      return {
        ...base,
        productId: best.p.id,
        value: best.v,
        why: t.why(best.v, scale.unit),
        insufficient: null,
      };
    });
  }
  return out;
}

/**
 * 一句话定位：枚举「维度 × 限定域」，取这台机器排第一的最宽说法。
 * 纯查表 + 排序 + 字符串拼接，离线确定性可复现，不调用任何 LLM。
 *
 * 价格档（旗舰/中低价位）按本文件第 1 条规矩取**当前池内的分位**，
 * 不写死金额阈值 —— 写死 5000 元不会报错，只会随通胀悄悄失效。
 */
const PRICE_PCT_FLAGSHIP = 0.5; // 起售价高于池内一半机型 = 旗舰档

/**
 * 限定域表。导出是为了让自测直接钉判据（与 sync/queue.mjs 同一模式：
 * 纯数据 + 纯函数，测试 import 本体而不是复刻一份）—— 尤其 foldable 域的
 * filter 曾与 foldable.mjs 分叉过（按机型名反推 vs 官网原文），
 * 分叉是静默的：persona 照样产出合法字符串，没有任何测试会红。
 */
export const DOMAINS = [
  { id: 'all', label: '', filter: () => true, min: 8 },
  { id: 'brand', label: '{brand}', filter: (p, self) => p.brand === self.brand, min: 5 },
  {
    id: 'flagship',
    label: '旗舰里',
    filter: (p, _self, ctx) => {
      const pct = ctx.pricePct.get(p.id);
      return pct !== null && pct !== undefined && pct < PRICE_PCT_FLAGSHIP;
    },
    min: 5,
  },
  {
    id: 'budget',
    label: '中低价位里',
    filter: (p, _self, ctx) => {
      const pct = ctx.pricePct.get(p.id);
      return pct !== null && pct !== undefined && pct >= PRICE_PCT_FLAGSHIP;
    },
    min: 5,
  },
  {
    id: 'foldable',
    label: '折叠机型里',
    // 判据同源：isFoldableOfficial（foldable.mjs，官网原文「折叠/展开」）。
    // 曾经的 `/折叠|Mate X|Pocket|Flip/i.test(line + name)` 是**按机型名反推形态**，
    // 正是 foldable.mjs 头注明文否定的做法（「不猜、不按机型名反推」）——
    // 名字里带 Flip 的未发布机型、或名字不含这些词的折叠机都会判错，
    // 且错得静默。这里与 sprite/generate.mjs、src/lib/catalog.ts 用同一函数。
    filter: (p) => isFoldableOfficial(p),
    min: 3,
  },
];

const DIMENSIONS = [
  { metric: 'weightG', text: (v, s) => `最轻（${v} ${s.unit}）` },
  { metric: 'thicknessMm', text: (v, s) => `最薄（${v} ${s.unit}）` },
  { metric: 'screenIn', text: (v, s) => `屏幕最大（${v} ${s.unit}）` },
  { metric: 'ppi', text: (v, s) => `屏幕最细腻（${v} ${s.unit}）` },
  { metric: 'brightnessPeakNits', text: (v, s) => `屏幕最亮（峰值 ${v} ${s.unit}）` },
  { metric: 'batteryMah', text: (v, s) => `电池最大（${v} ${s.unit}）` },
];

export function buildPersona(product, products, scalesByCategory) {
  const brandLabel = brandShortLabel(product.brand);
  // 2026-10-15：限定域一律先收窄到**同品类**池。phone 与 tablet 共用
  // body.weightG（克）口径，跨品类混池会让 iPad mini 静默拿走「Apple 里最轻」。
  const sameCat = products.filter((p) => (p.category ?? 'phone') === (product.category ?? 'phone'));
  // 价格分位只算一次（dir=low：分位越低越贵），供 flagship/budget 两个限定域共用
  const scales = scalesOf(scalesByCategory, product.category);
  const ctx = {
    pricePct: new Map(sameCat.map((p) => [p.id, percentileOf(scales, 'priceCny', p)])),
  };
  for (const domain of DOMAINS) {
    const pool = sameCat.filter((p) => domain.filter(p, product, ctx));
    if (pool.length < domain.min || !pool.some((p) => p.id === product.id)) continue;
    for (const dim of DIMENSIONS) {
      const scale = scales[dim.metric];
      if (!scale?.enough) continue;
      const ranked = pool
        .map((p) => ({ p, v: metricValue(p, dim.metric) }))
        .filter((x) => x.v !== null)
        .sort((a, b) => (scale.dir === 'low' ? a.v - b.v : b.v - a.v));
      if (!ranked.length || ranked[0].p.id !== product.id) continue;
      const label = domain.label.replace('{brand}', brandLabel);
      return `${label}${dim.text(ranked[0].v, scale)}`;
    }
  }
  // 一个第一都没拿到：如实描述，不硬凑
  const bits = [];
  const sizeIn = get(product, 'display.sizeIn');
  const weightG = get(product, 'body.weightG');
  if (sizeIn) bits.push(`${sizeIn} 英寸屏幕`);
  if (weightG) bits.push(`${weightG} 克`);
  if (metricValue(product, 'storageMaxGb'))
    bits.push(`最高 ${metricValue(product, 'storageMaxGb')} GB 存储`);
  return bits.length ? bits.join('，') : '暂无足够参数生成定位';
}
