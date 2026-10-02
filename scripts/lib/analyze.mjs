/**
 * 站点分析层：把 data/products.json 变成页面直接可用的结构。
 *
 * 产出 _work/analytics.json，供 scripts/site/ 下所有页面消费。
 *
 * 四条纪律（全部来自数据现实，不是审美偏好）：
 *
 * 1. **能力条只画客观已公布参数，不做综合评分。**
 *    参考站有「综合智力指数」，因为 Epoch AI / LiveBench 提供第三方评测。
 *    手机圈没有对等物：安兔兔要登录、Geekbench 无公开 API、3DMark 收费。
 *    所以本站不给「性能分」，只把「重量/屏幕/像素/电池/充电/存储/价格」
 *    各自的分位独立展示。**跑分缺席就是缺席，界面明写「本站不做跑分」。**
 *
 * 2. **缺数据一律 null，绝不补 0、绝不补均值、绝不补同品牌均值。**
 *    苹果不公布电池 mAh —— 它的续航条就是空的。空条比假条有价值。
 *
 * 3. **能力条的分位只在「同一分类的池子」内计算。**
 *    拿 Mate X8 的重量和 iPhone SE 比没有意义：折叠屏和直板机不是同一个池子。
 *    全局池只用于「规格榜」（明确标注「当前 60 台在售池」）。
 *
 * 4. **类比换算必须可复算。**
 *    「512 GB ≈ 约 12.8 万张照片」里的 4 MB/张、写死并写进 note，
 *    换算是给人一个体感锚点，不是测量结论。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { metricValue, METRICS } from './derive.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, '_work/analytics.json');

/* ------------------------------------------------------------------ *
 * 一、六维能力条
 * ------------------------------------------------------------------ *
 * 每维由若干「已公布参数」组成，权重写在 DIMENSIONS 里，页面上要展示这张权重表。
 * 一台机器某一维算不出分（一个必需参数都没有）→ 该维为 null，不是 0 分。
 */

export const DIMENSIONS = [
  {
    key: 'screen',
    label: '屏幕',
    /** 每项：指标 key（对应 derive.mjs 的 METRICS）+ 权重 */
    parts: [
      { metric: 'screenIn', weight: 0.3, note: '屏幕尺寸' },
      { metric: 'ppi', weight: 0.4, note: '像素密度' },
      { metric: 'refreshHzMax', weight: 0.3, note: '刷新率上限' },
    ],
    /** 这个词条只在「两个及以上参数都有值」时才有意义 */
    minParts: 2,
    desc: '尺寸、像素密度、刷新率上限的池内分位加权',
  },
  {
    key: 'camera',
    label: '影像',
    parts: [
      { metric: 'rearCount', weight: 0.25, note: '后摄颗数' },
      { metric: 'mainMp', weight: 0.4, note: '主摄像素' },
      { metric: 'teleMp', weight: 0.2, note: '长焦像素' },
      { metric: 'periscope', weight: 0.15, note: '潜望长焦' },
    ],
    minParts: 1,
    desc: '后摄颗数、主摄/长焦像素、是否有潜望镜的池内分位加权',
  },
  {
    key: 'battery',
    label: '续航',
    parts: [
      { metric: 'batteryMah', weight: 0.55, note: '电池容量' },
      { metric: 'wiredChargeW', weight: 0.3, note: '有线充电功率' },
      { metric: 'wirelessChargeW', weight: 0.15, note: '无线充电功率' },
    ],
    minParts: 1,
    desc: '电池容量与充电功率的池内分位加权',
  },
  {
    key: 'light',
    label: '轻薄',
    parts: [
      { metric: 'weightG', weight: 0.6, note: '整机重量' },
      { metric: 'thicknessMm', weight: 0.4, note: '机身厚度' },
    ],
    minParts: 1,
    desc: '重量与厚度的池内分位加权（越小越好）',
  },
  {
    key: 'storage',
    label: '存储',
    parts: [{ metric: 'storageMaxGb', weight: 1, note: '最大存储容量' }],
    minParts: 1,
    desc: '最大存储容量的池内分位',
  },
  {
    key: 'value',
    label: '性价比',
    /**
     * 只用 specPerYuan 一个指标。
     * 曾经是 `priceCny 0.7 + specPerYuan 0.3` 的加权，但 specPerYuan 本身已经除过价格，
     * 再叠一次价格分位等于把同一个因素算两遍 —— 两者方向相反互相抵消，
     * 实测 46 台有价机型极差只剩 2.1 分（¥1,299 的畅享 90 和 ¥15,999 的 iPhone Duo 同为满分）。
     * 单指标版本极差 100，「每千元买到多少官方规格」本身就是性价比的完整定义。
     */
    parts: [{ metric: 'specPerYuan', weight: 1, note: '每千元买到的规格量' }],
    minParts: 1,
    desc: '把存储/屏幕/像素/电池/刷新率标准化后求和，再除以起售价（千元）——即「每千元买到多少官方公布的规格」',
  },
];

/** 供页面直接消费的中文标签（刷新率上限没有中文 label，单独给） */
const EXTRA_LABELS = {
  refreshHzMax: '刷新率上限',
  rearCount: '后摄颗数',
  mainMp: '主摄像素',
  teleMp: '长焦像素',
  periscope: '潜望长焦',
  specPerYuan: '每千元规格量',
};

/* ------------------------------------------------------------------ *
 * 二、扩展指标取值
 * ------------------------------------------------------------------ *
 * derive.mjs 的 METRICS 覆盖不到本站要用的几个（相机、刷新率上界），
 * 在这里补齐，返回口径与 metricValue 完全一致：有值给数，没值给 null。
 */

/** 刷新率字符串 → 上界数字。`1-120` → 120，`60/90` → 90，`120` → 120 */
export function refreshMaxHz(product) {
  const raw = product.display?.refreshHz;
  if (raw === null || raw === undefined) return null;
  const parts = String(raw)
    .split(/[-–~/]/)
    .map(Number)
    .filter(Number.isFinite);
  return parts.length ? Math.max(...parts) : null;
}

/** 主摄像素（MP）。取 role=main 的那颗；官网只给一颗后摄时它就是主摄 */
function mainMp(product) {
  const rear = product.camera?.rear ?? [];
  const main = rear.find((c) => c.role === 'main') ?? (rear.length === 1 ? rear[0] : null);
  return typeof main?.mp === 'number' ? main.mp : null;
}

/** 长焦像素（MP）。tele 与 periscope 都算长焦，取大的那个 */
function teleMp(product) {
  const rear = product.camera?.rear ?? [];
  const tele = rear.filter((c) => c.role === 'tele' || c.role === 'periscope');
  const mps = tele.map((c) => c.mp).filter((v) => typeof v === 'number');
  return mps.length ? Math.max(...mps) : null;
}

/** 起售价：SKU 里的最低官方价 */
function priceCny(product) {
  const prices = (product.skus ?? []).map((s) => s.priceCny).filter((v) => typeof v === 'number' && v > 0);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * 每千元硬件规格量：一个纯客观、可复算的粗粒度比值，不是评分。
 * 算的是「把几个关键规格标准化后求和，再除以起售价（千元）」。
 * 参与项全部是官网公布的原始参数，缺失项直接不参与（并记进 usedCount）。
 */
function specPerYuan(product) {
  const price = priceCny(product);
  if (price === null || price <= 0) return null;
  const used = [];
  // 存储（GB）
  const stor = product.memory?.storageGb ?? [];
  if (stor.length) used.push({ v: Math.max(...stor), norm: 2048 });
  // 屏幕尺寸（英寸）
  if (typeof product.display?.sizeIn === 'number') used.push({ v: product.display.sizeIn, norm: 8 });
  // 像素密度（ppi）
  if (typeof product.display?.ppi === 'number') used.push({ v: product.display.ppi, norm: 500 });
  // 电池（mAh）
  if (typeof product.battery?.capacityMah === 'number') used.push({ v: product.battery.capacityMah, norm: 8500 });
  // 刷新率上界
  const hz = refreshMaxHz(product);
  if (hz !== null) used.push({ v: hz, norm: 120 });
  if (used.length < 3) return null; // 少于三项，这个比值没有意义
  const sum = used.reduce((a, u) => a + Math.min(1, u.v / u.norm), 0);
  return { value: sum / (price / 1000), usedCount: used.length };
}

/**
 * 取一个扩展指标的值。
 * 返回 { value:number|null, note?:string }，note 用来在页面上解释口径。
 */
export function extraMetricValue(product, key) {
  switch (key) {
    case 'refreshHzMax':
      return { value: refreshMaxHz(product), note: '自适应刷新取上界' };
    case 'rearCount': {
      const n = (product.camera?.rear ?? []).length;
      return { value: n || null, note: '官网列出的后摄颗数' };
    }
    case 'mainMp':
      return { value: mainMp(product), note: '主摄传感器像素' };
    case 'teleMp':
      return { value: teleMp(product), note: '长焦/潜望像��中较大的一颗' };
    case 'periscope': {
      const has = (product.camera?.rear ?? []).some((c) => c.role === 'periscope');
      return { value: has ? 1 : 0, note: '官网是否列出潜望长焦', /** 有=1 无=0 是真实的二值事实，不是缺数据 */ };
    }
    case 'priceCny':
      return { value: priceCny(product), note: '官方起售价（各 SKU 最低价）' };
    case 'wirelessChargeW': {
      const v = product.battery?.wirelessChargeW;
      return { value: typeof v === 'number' && v > 0 ? v : null, note: '官网公布的无线充电功率' };
    }
    case 'specPerYuan': {
      const r = specPerYuan(product);
      return { value: r ? r.value : null, note: r ? `${r.usedCount} 项规格标准化后除以起售价（千元）` : null };
    }
    default: {
      // 只有登记在 derive.mjs METRICS 里的指标才能走这条路。
      // 站点自带的扩展指标（refreshHzMax / mainMp / …）如果漏了 case，
      // 应该在这里显式失败，而不是让 metricValue 抛 TypeError 掩盖掉。
      if (!METRICS[key]) throw new Error(`未实现的指标：${key}（extraMetricValue 缺少对应 case）`);
      const raw = metricValue(product, key);
      return { value: raw === null ? null : raw, note: null };
    }
  }
}

/* ------------------------------------------------------------------ *
 * 三、分类体系
 * ------------------------------------------------------------------ *
 * 三个维度，全部由数据推导，不靠人工维护名单。
 * 判不出来的进「其他」，绝不猜。
 */

/**
 * 形态：折叠 / 直板 / 平板。
 * 判据只用 body.folded（数据里的折叠标记）与机身厚度。
 * 官网没标折叠标记的，即使长得像折叠也不猜 → 进「直板」。
 */
export function formFactorOf(product) {
  if (product.body?.folded === true) return 'foldable';
  // 折叠屏的典型特征：官网会同时列出内外两块屏
  const type = product.display?.type ?? '';
  if (/内屏|外屏|折叠/.test(type)) return 'foldable';
  return 'bar';
}

export const FORM_FACTORS = [
  { key: 'foldable', label: '折叠屏', desc: '官网规格页明确列出内屏/外屏或标注可折叠' },
  { key: 'bar', label: '直板机', desc: '单屏直板形态' },
];

/** 价格档：按起售价分档。分档线写死并公开，改动会在页面上留痕。 */
export const PRICE_TIERS = [
  { key: 'flagship', label: '旗舰', min: 8000, desc: '起售价 ≥ ¥8,000' },
  { key: 'premium', label: '高端', min: 5000, max: 8000, desc: '¥5,000 – ¥8,000' },
  { key: 'mid', label: '中端', min: 3000, max: 5000, desc: '¥3,000 – ¥5,000' },
  { key: 'entry', label: '入门', max: 3000, desc: '起售价 < ¥3,000' },
  { key: 'unknown', label: '价格未公布', desc: '官网未公开起售价，不参与价格相关排行' },
];

export function priceTierOf(product) {
  const p = priceCny(product);
  if (p === null) return 'unknown';
  for (const t of PRICE_TIERS) {
    if (t.key === 'unknown') continue;
    if (t.min !== undefined && p >= t.min) {
      if (t.max === undefined || p < t.max) return t.key;
    } else if (t.min === undefined && t.max !== undefined && p < t.max) {
      return t.key;
    }
  }
  return 'unknown';
}

/** 产品线：直接用数据里的 line 字段（Mate / Pura / nova / 畅享 / iPhone） */
export function lineKeyOf(product) {
  return product.line ?? '未归线';
}

/* ------------------------------------------------------------------ *
 * 四、分位计算
 * ------------------------------------------------------------------ */

/**
 * 在给定池子里算某指标的池内分位。
 * **返回值语义：1 = 池内最好，0 = 池内最差。**（已按指标方向校正）
 * 池子必须只含有值的产品 —— 缺数据的不进池，否则分位会被拉偏。
 *
 * 方向处理（2026-10-02 修复）：先把最好的排在前面，再取名次归一化。
 * 名次越小越好，所以要取补数 `1 - rank/(n-1)`。
 * 修复前直接返回 `rank/(n-1)`，导致「越轻越好」的重量指标里最轻的那台拿到 0 分，
 * iPhone Air（165 g，全池最轻）屏幕外的每一根条都是 0 分 —— 方向完全反了。
 */
function percentileIn(pool, key) {
  const pairs = pool
    .map((p) => ({ id: p.id, v: extraMetricValue(p, key).value }))
    .filter((x) => x.v !== null);
  if (pairs.length < 2) return new Map();
  const dir = METRICS[key]?.dir ?? 'high';
  // 降序排：无论 dir 是 high 还是 low，最好的都落在数组前面
  const sorted = pairs.slice().sort((a, b) => (dir === 'low' ? a.v - b.v : b.v - a.v));
  const n = sorted.length;
  /**
   * 只有**二值指标**（有=1 无=0）才需要压回中位。
   * 判据：整个池子里只出现过两个不同的值，且其中一个是 0。
   * 连续量（哪怕并列很多，如起售价大量撞在 1299/1499）必须照常给名次差，
   * 否则「性价比」维度会因为价格档位天然重复而全部塌成 0.5（2026-10-02 实测踩过）。
   */
  const distinct = new Set(pairs.map((x) => x.v));
  const isBinary = distinct.size === 2 && distinct.has(0);
  const out = new Map();
  sorted.forEach((x) => {
    // 同值给同一分位：取「所有同值机型在全体 sorted 中的名次均值」。
    //
    // 修复记录（2026-10-02）：这里原来写的是
    //   same.reduce((a, _, k) => a + k, 0)
    // `k` 是同值数组 `same` 的**局部索引**，不是全局名次。
    // `same` 绝大多数情况只有 1 个元素，k 恒为 0 → avgRank 恒为 0 → 所有机型都是满分。
    // 表现为「性价比」维度 46 台全部 100.0 分，完全丧失区分度。
    // 现在显式收集全局下标。
    const ranks = [];
    for (let k = 0; k < n; k++) if (sorted[k].v === x.v) ranks.push(k);
    const avgRank = ranks.reduce((a, r) => a + r, 0) / ranks.length;
    if (n === 1) { out.set(x.id, 0.5); return; }
    // 名次 0 = 最好 → 分位 1
    const pct = 1 - avgRank / (n - 1);
    // 二值指标大面积并列时（多数机型都没有潜望镜），压回中位：
    // 排成 0/1 两端会让「并排第一」看起来像「碾压第一」
    out.set(x.id, isBinary && ranks.length > n / 2 ? 0.5 : pct);
  });
  return out;
}

/** 一组指标 → 每个产品在每个指标上的分位表 */
function percentileTables(pool, keys) {
  const t = {};
  for (const k of keys) t[k] = percentileIn(pool, k);
  return t;
}

/* ------------------------------------------------------------------ *
 * 五、类比换算（写死假设，页面上必须连带显示假设）
 * ------------------------------------------------------------------ */

/** 换算假设表：页面上原样展示，用户可以自己判断这个体感锚点靠不靠谱 */
export const ANALOGY_ASSUMPTIONS = {
  photo: { label: '张照片', sizeMb: 5, note: '按每张 5 MB（4000 万像素 JPEG）估算' },
  song: { label: '首无损音乐', sizeMb: 40, note: '按每首 40 MB（FLAC）估算' },
  movie: { label: '部高清电影', sizeGb: 4, note: '按每部 4 GB（1080p 压制）估算' },
  can: { label: '罐可乐', grams: 355, note: '按一罐 330ml 可乐连罐 355 g 估算' },
  coin: { label: '1 元硬币', mm: 1.85, note: '按 1 元硬币厚 1.85 mm 估算' },
  creditCard: { label: '张银行卡', mm: 85.6, note: '按标准银行卡长 85.6 mm 估算' },
  eyeLimitPpi: 87, note: '30 cm 观看距离下人眼 1 弧分极限约 87 ppi',
};

/**
 * 大数字口语化：102400 → 「10.2 万」，2097152 → 「209.7 万」。
 * 保留一位小数的前提是去掉小数后至少有 3 位有效数字，否则「205.0」不如「205」好看。
 */
function fmtCount(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e8) {
    const v = n / 1e8;
    return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} 亿`;
  }
  if (n >= 1e4) {
    const v = n / 1e4;
    return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} 万`;
  }
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return String(Math.round(n * 10) / 10);
  return String(Math.round(n * 100) / 100);
}

/**
 * 为一台机器生成类比换算文案。
 * 每条都带 from（原始值）、to（换算结果）、assume（用了哪条假设），三者齐全才输出。
 */
export function analogiesOf(product) {
  const out = [];

  // 存储 → 能存多少。
  // 注意单位：内部一律用 GB 算，TB 机型要先换算成 GB —— 否则 1 TB 会被算成 1 张照片。
  const stor = product.memory?.storageGb ?? [];
  if (stor.length) {
    const maxGb = Math.max(...stor);
    const shown = maxGb >= 1024 ? `${Math.round(maxGb / 1024)} TB` : `${maxGb} GB`;
    out.push({
      key: 'storage-photo',
      label: `${shown} 能装下`,
      value: fmtCount(maxGb * 1024 / ANALOGY_ASSUMPTIONS.photo.sizeMb),
      unit: '张照片',
      from: `${maxGb} GB 存储`,
      assume: ANALOGY_ASSUMPTIONS.photo.note,
    });
    out.push({
      key: 'storage-movie',
      label: `${shown} 能装下`,
      value: fmtCount(maxGb / ANALOGY_ASSUMPTIONS.movie.sizeGb),
      unit: '部高清电影',
      from: `${maxGb} GB 存储`,
      assume: ANALOGY_ASSUMPTIONS.movie.note,
    });
  }

  // 重量 → 相当于几罐可乐
  if (typeof product.body?.weightG === 'number') {
    const cans = product.body.weightG / ANALOGY_ASSUMPTIONS.can.grams;
    out.push({
      key: 'weight-can',
      label: '整机重量相当于',
      value: cans >= 1 ? cans.toFixed(1) : '不到 1',
      unit: '罐可乐',
      from: `${product.body.weightG} g`,
      assume: ANALOGY_ASSUMPTIONS.can.note,
    });
  }

  // 厚度 → 相当于几枚 1 元硬币叠起来（1 元硬币厚 1.85 mm，最接近手机的量级）
  if (typeof product.body?.thicknessMm === 'number') {
    const coins = product.body.thicknessMm / ANALOGY_ASSUMPTIONS.coin.mm;
    out.push({
      key: 'thickness-coin',
      label: '机身厚度相当于',
      value: coins.toFixed(1),
      unit: '枚 1 元硬币叠起来',
      from: `${product.body.thicknessMm} mm`,
      assume: ANALOGY_ASSUMPTIONS.coin.note,
    });
  }

  // 屏幕 → 纵向能排下多少行人眼可辨的极限
  if (typeof product.display?.sizeIn === 'number' && typeof product.display?.ppi === 'number') {
    // 纵向像素数 = 对角线像素 × (纵向物理长度 / 对角线长度)
    // 对角线像素 ≈ ppi × 对角线英寸数
    const diagPx = product.display.ppi * product.display.sizeIn;
    // 纵向占比：按 20:9 比例算（当代手机主流长宽比，官网未公布时用它并标注）
    const ratio = 20 / 9;
    const half = Math.sqrt(1 + ratio * ratio);
    const hPx = diagPx / half;
    // 人眼分辨极限约 1 弧分 = 1/60 度；在 30 cm 观看距离上约合 87 ppi
    const rows = Math.floor(hPx / ANALOGY_ASSUMPTIONS.eyeLimitPpi);
    out.push({
      key: 'ppi-rows',
      label: `${product.display.ppi} ppi 竖屏能排下`,
      value: fmtCount(rows),
      unit: '行人眼可辨的极限',
      from: `${product.display.ppi} ppi · ${product.display.sizeIn} 英寸`,
      assume: `按 30 cm 观看距离、人眼 1 弧分极限约 ${ANALOGY_ASSUMPTIONS.eyeLimitPpi} ppi、屏幕比例 20:9 估算`,
    });
  }

  // 屏幕尺寸 → 几张银行卡长
  if (typeof product.display?.sizeIn === 'number') {
    const diagMm = product.display.sizeIn * 25.4;
    out.push({
      key: 'screen-card',
      label: `${product.display.sizeIn} 英寸对角线相当于`,
      value: (diagMm / ANALOGY_ASSUMPTIONS.creditCard.mm).toFixed(1),
      unit: '张银行卡排成一列',
      from: `${product.display.sizeIn} 英寸`,
      assume: ANALOGY_ASSUMPTIONS.creditCard.note,
    });
  }

  // 电池 → 标称视频播放时长（跨厂商口径不同，只展示不参与排名）
  const vh = product.battery?.vendorClaimedVideoHours;
  if (typeof vh === 'number') {
    out.push({
      key: 'battery-video',
      label: '厂商标称视频播放',
      value: String(vh),
      unit: '小时',
      from: '厂商标称值',
      assume: `${product.battery.capacityCaliber ?? '口径未注明'}；各家测试条件不同，只并列展示不参与排名`,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * 六、用户评价（预留位）
 * ------------------------------------------------------------------ *
 * 产品侧决定：暂不做性能评分，也不做访客评分。
 * 这里是**完整预留**：数据契约有字段、页面有位置、当前显式为空。
 * 未来接入方式（择一，都不需要改动页面代码）：
 *   A. 离线快照：把聚合后的评分写成 data/visitor-ratings.json，站点读取即可；
 *   B. 表单提交：接一个 Serverless 函数，评分 POST 进数据库，
 *      GitHub Actions 定时导出成同样的 JSON 快照（保持纯静态站形态）。
 * 无论哪种，页面上这个位置和「暂无访客评价」的文案都不用改。
 */
export const VISITOR_RATINGS = {
  enabled: false,
  reason: '暂未接入访客评分数据源',
  file: 'data/visitor-ratings.json',
  schema: {
    productId: 'string，机型 id',
    score: 'number，1–5',
    count: 'number，评价人数',
    updatedAt: 'ISO 日期字符串',
  },
};

function readVisitorRatings() {
  if (!VISITOR_RATINGS.enabled) return new Map();
  const p = join(ROOT, VISITOR_RATINGS.file);
  if (!existsSync(p)) return new Map();
  try {
    const arr = JSON.parse(readFileSync(p, 'utf8'));
    return new Map((arr ?? []).map((r) => [r.productId, r]));
  } catch {
    return new Map();
  }
}

/* ------------------------------------------------------------------ *
 * 七、主流程
 * ------------------------------------------------------------------ */

const ALL_METRIC_KEYS = [
  ...new Set(DIMENSIONS.flatMap((d) => d.parts.map((p) => p.metric))),
];

export function analyze() {
  const P = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
  const products = P.products ?? P;
  const pool = products;

  const tables = percentileTables(pool, ALL_METRIC_KEYS);
  const ratings = readVisitorRatings();

  /* --- 每台机器的六维分 + 类比 + 分类 --- */
  const detail = {};
  for (const p of products) {
    const axes = {};
    for (const dim of DIMENSIONS) {
      let sum = 0;
      let wsum = 0;
      const usedParts = [];
      for (const part of dim.parts) {
        const pct = tables[part.metric]?.get(p.id);
        const raw = extraMetricValue(p, part.metric).value;
        if (pct === undefined || pct === null || raw === null) continue;
        sum += pct * part.weight;
        wsum += part.weight;
        usedParts.push({ metric: part.metric, weight: part.weight, raw });
      }
      axes[dim.key] =
        usedParts.length >= dim.minParts
          ? {
              score: wsum ? sum / wsum : null,
              covered: usedParts.length,
              total: dim.parts.length,
              parts: usedParts,
            }
          : { score: null, covered: usedParts.length, total: dim.parts.length, parts: usedParts };
    }
    detail[p.id] = {
      axes,
      analogies: analogiesOf(p),
      formFactor: formFactorOf(p),
      priceTier: priceTierOf(p),
      line: p.line ?? '未归线',
      price: priceCny(p),
      visitorRating: ratings.get(p.id) ?? null,
    };
  }

  /* --- 规格榜：只在「有值且过覆盖率门槛」的池子里排名 --- */
  const leagues = [];
  for (const [key, meta] of Object.entries(METRICS)) {
    const withVal = pool.filter((p) => extraMetricValue(p, key).value !== null);
    const coverage = withVal.length / pool.length;
    if (withVal.length < 6) continue;
    const ranked = withVal
      .slice()
      .sort((a, b) => {
        const av = extraMetricValue(a, key).value;
        const bv = extraMetricValue(b, key).value;
        return meta.dir === 'low' ? av - bv : bv - av;
      });
    leagues.push({
      key,
      label: EXTRA_LABELS[key] ?? meta.label,
      unit: meta.unit,
      dir: meta.dir,
      pool: withVal.length,
      coverage,
      /** 覆盖率低于 0.5 时页面要显示「样本有限」而不是「全网第一」 */
      partial: coverage < 0.5,
      top: ranked.slice(0, 10).map((p, i) => ({
        rank: i + 1,
        id: p.id,
        value: extraMetricValue(p, key).value,
      })),
    });
  }

  /* --- 分类聚合 --- */
  const byForm = {};
  for (const f of FORM_FACTORS) byForm[f.key] = [];
  for (const p of pool) byForm[formFactorOf(p)]?.push(p.id);

  const byTier = {};
  for (const t of PRICE_TIERS) byTier[t.key] = [];
  for (const p of pool) byTier[priceTierOf(p)]?.push(p.id);

  const lines = {};
  for (const p of pool) {
    const k = lineKeyOf(p);
    (lines[k] = lines[k] ?? []).push(p.id);
  }

  /* --- 品牌聚合 --- */
  const brands = {};
  for (const v of P.vendors ?? []) {
    const ids = pool.filter((p) => p.brand === v.id).map((p) => p.id);
    const subLines = {};
    for (const id of ids) {
      const l = detail[id].line;
      (subLines[l] = subLines[l] ?? []).push(id);
    }
    brands[v.id] = {
      ...v,
      count: ids.length,
      ids: ids.slice().sort((a, b) => {
        const pa = pool.find((p) => p.id === a);
        const pb = pool.find((p) => p.id === b);
        return (pb?.releaseDate ?? '').localeCompare(pa?.releaseDate ?? '');
      }),
      lines: Object.entries(subLines)
        .map(([key, list]) => ({
          key,
          count: list.length,
          ids: list,
          /** 每一代的代表机：按发布时间最新 */
          latestId: list
            .slice()
            .sort((a, b) => {
              const pa = pool.find((p) => p.id === a);
              const pb = pool.find((p) => p.id === b);
              return (pb?.releaseDate ?? '').localeCompare(pa?.releaseDate ?? '');
            })[0],
          firstId: list
            .slice()
            .sort((a, b) => {
              const pa = pool.find((p) => p.id === a);
              const pb = pool.find((p) => p.id === b);
              return (pa?.releaseDate ?? '').localeCompare(pb?.releaseDate ?? '');
            })[0],
        }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /* --- 时间线：按发布月份聚合 --- */
  const timeline = [];
  const byMonth = new Map();
  for (const p of pool) {
    if (!p.releaseDate) continue;
    const mk = p.releaseDate.slice(0, 7);
    (byMonth.get(mk) ?? byMonth.set(mk, []).get(mk)).push(p.id);
  }
  for (const [month, ids] of [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    timeline.push({
      month,
      count: ids.length,
      ids: ids.sort((a, b) => {
        const pa = pool.find((p) => p.id === a);
        const pb = pool.find((p) => p.id === b);
        return (pb?.releaseDate ?? '').localeCompare(pa?.releaseDate ?? '');
      }),
    });
  }

  /* --- 代际链：同产品线内按发布时间的相邻关系 --- */
  const lineage = {};
  for (const [line, ids] of Object.entries(lines)) {
    const ordered = ids
      .slice()
      .sort((a, b) => {
        const pa = pool.find((p) => p.id === a);
        const pb = pool.find((p) => p.id === b);
        return (pa?.releaseDate ?? '').localeCompare(pb?.releaseDate ?? '');
      });
    /**
     * 用普通对象而不是 Map：这份结果要 JSON.stringify 进 analytics.json，
     * Map 序列化后会变成 {}，页面侧 .get() 直接崩（2026-10-02 踩过）。
     */
    const gen = {};
    ordered.forEach((id, i) => {
      gen[id] = { index: i, prev: ordered[i - 1] ?? null, next: ordered[i + 1] ?? null };
    });
    lineage[line] = { ordered, gen };
  }

  return {
    generatedAt: new Date().toISOString(),
    dataGeneratedAt: P.generatedAt ?? null,
    windowStart: P.windowStart ?? null,
    sources: P.sources ?? {},
    total: pool.length,
    dimensions: DIMENSIONS.map((d) => ({
      ...d,
      parts: d.parts.map((pt) => ({ ...pt, label: EXTRA_LABELS[pt.metric] ?? METRICS[pt.metric]?.label ?? pt.metric })),
    })),
    metricLabels: { ...Object.fromEntries(Object.entries(METRICS).map(([k, v]) => [k, v.label])), ...EXTRA_LABELS },
    leagues,
    detail,
    byForm,
    byTier,
    priceTiers: PRICE_TIERS,
    formFactors: FORM_FACTORS,
    lines,
    brands,
    timeline,
    lineage,
    analogyAssumptions: ANALOGY_ASSUMPTIONS,
    visitorRatings: { ...VISITOR_RATINGS, hasData: ratings.size > 0 },
  };
}

/* 允许单独运行：node scripts/lib/analyze.mjs */
if (process.argv[1] && process.argv[1].endsWith('analyze.mjs')) {
  const a = analyze();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(a, null, 2)}\n`, 'utf8');

  const withScore = Object.values(a.detail).filter((d) => Object.values(d.axes).some((x) => x.score !== null));
  console.log(`分析层已生成 → ${OUT}`);
  console.log(`  机型 ${a.total} 台 · 规格榜 ${a.leagues.length} 个 · 时间线 ${a.timeline.length} 个月`);
  console.log(`  形态：${Object.entries(a.byForm).map(([k, v]) => `${k} ${v.length}`).join(' / ')}`);
  console.log(`  价格档：${Object.entries(a.byTier).map(([k, v]) => `${k} ${v.length}`).join(' / ')}`);
  console.log(`  产品线：${Object.keys(a.lines).join(' / ')}`);
  console.log(`  六维分至少有一维可算的机型：${withScore.length}/${a.total}`);
  console.log(`  访客评价：${a.visitorRatings.enabled ? '已启用' : '预留未启用'}`);
}
