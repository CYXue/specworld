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
  brightnessPeakNits: { label: '峰值亮度', unit: 'nits', dir: 'high', path: 'display.brightnessPeakNits' },
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

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** 从机型上取指标原始值。返回 null 表示这台机器没有这个数据（不是 0） */
export function metricValue(product, key) {
  switch (key) {
    case 'storageMaxGb': {
      const arr = product.memory?.storageGb ?? [];
      return arr.length ? Math.max(...arr) : null;
    }
    case 'priceCny': {
      const prices = (product.skus ?? []).map((s) => s.priceCny).filter((v) => typeof v === 'number' && v > 0);
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
    const pairs = products
      .map((p) => ({ id: p.id, v: metricValue(p, key) }))
      .filter((x) => x.v !== null);
    const values = pairs.map((x) => x.v).sort((a, b) => a - b);
    scales[key] = {
      ...METRICS[key],
      values,
      byId: new Map(pairs.map((x) => [x.id, x.v])),
      coverage: products.length ? pairs.length / products.length : 0,
      enough: pairs.length >= TITLE_MIN_POOL && pairs.length / Math.max(products.length, 1) >= TITLE_COVERAGE,
    };
  }
  return scales;
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
  { id: 'brightest', metric: 'brightnessPeakNits', title: '屏幕最亮', why: (v, u) => `峰值 ${v} ${u}` },
  { id: 'longest-battery', metric: 'batteryMah', title: '电池最大', why: (v, u) => `${v} ${u}` },
  { id: 'fastest-charge', metric: 'wiredChargeW', title: '充电最快', why: (v, u) => `${v} ${u} 有线` },
  { id: 'most-storage', metric: 'storageMaxGb', title: '存储最大', why: (v) => `最高 ${v / 1024 >= 1 ? `${v / 1024} TB` : `${v} GB`}` },
  { id: 'newest', metric: 'releaseDate', title: '最新发布', why: (v) => new Date(v).toISOString().slice(0, 10) },
];

/**
 * 首页头衔。数据不足时**不发奖杯**，返回 insufficient 让界面如实说明。
 * @returns {Array<{id,title,productId,value,why,insufficient,coverage,pool}>}
 */
export function buildChampions(products, scales) {
  return TITLES.map((t) => {
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
        insufficient: `官方公布该参数的机型只有 ${base.pool}/${products.length} 台（需 ≥${Math.ceil(
          TITLE_COVERAGE * products.length,
        )} 台），本站不排名`,
      };
    }
    const best = products.reduce((acc, p) => {
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

/**
 * 一句话定位：枚举「维度 × 限定域」，取这台机器排第一的最宽说法。
 * 纯查表 + 排序 + 字符串拼接，离线确定性可复现，不调用任何 LLM。
 */
const DOMAINS = [
  { id: 'all', label: '', filter: () => true, min: 8 },
  { id: 'brand', label: '{brand}', filter: (p, self) => p.brand === self.brand, min: 5 },
  { id: 'flagship', label: '旗舰里', filter: (p) => (metricValue(p, 'priceCny') ?? 0) >= 5000, min: 5 },
  { id: 'budget', label: '五千元以内', filter: (p) => { const v = metricValue(p, 'priceCny'); return v !== null && v <= 5000; }, min: 5 },
  { id: 'foldable', label: '折叠机型里', filter: (p) => /折叠|Mate X|Pocket|Flip/i.test(`${p.line} ${p.name}`), min: 3 },
];

const DIMENSIONS = [
  { metric: 'weightG', text: (v, s) => `最轻（${v} ${s.unit}）` },
  { metric: 'thicknessMm', text: (v, s) => `最薄（${v} ${s.unit}）` },
  { metric: 'screenIn', text: (v, s) => `屏幕最大（${v} ${s.unit}）` },
  { metric: 'ppi', text: (v, s) => `屏幕最细腻（${v} ${s.unit}）` },
  { metric: 'brightnessPeakNits', text: (v, s) => `屏幕最亮（峰值 ${v} ${s.unit}）` },
  { metric: 'batteryMah', text: (v, s) => `电池最大（${v} ${s.unit}）` },
];

export function buildPersona(product, products, scales) {
  const brandLabel = product.brand === 'apple' ? 'iPhone' : '华为';
  for (const domain of DOMAINS) {
    const pool = products.filter((p) => domain.filter(p, product));
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
  if (product.display?.sizeIn) bits.push(`${product.display.sizeIn} 英寸屏幕`);
  if (product.body?.weightG) bits.push(`${product.body.weightG} 克`);
  if (metricValue(product, 'storageMaxGb')) bits.push(`最高 ${metricValue(product, 'storageMaxGb')} GB 存储`);
  return bits.length ? bits.join('，') : '暂无足够参数生成定位';
}
