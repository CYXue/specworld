/**
 * 品牌注册表（单一真源）。
 *
 * 设计动机（见 docs/ENGINEERING-REVIEW.md 维度二）：品牌相关的字符串 / 元数据
 * 原本散落在约 10 处 —— validate 的品牌白名单、sync 的 VENDORS、站点 ui 的 BRANDS、
 * derive 的「iPhone / 华为」标签、qa 的 BRAND_ZH、精灵图的刘海类型……。
 * 加第三品牌（小米 / 三星，BENCHMARK 已列为未来方向）要改 10 处，极易漏。
 *
 * 这里集中维护一份，其余处改为查表。新增品牌只需改这一个文件。
 *
 * 纪律：
 *   - `BRAND_IDS` 是有序数组，决定「数据快照里的 vendors 顺序」与「遍历所有品牌的循环顺序」，
 *     改顺序会改变 data/products.json 的字节——所以不要随便重排。
 *   - `VENDORS` 是写入 data/products.json 的精简形状（与旧 sync/index.mjs 的 VENDORS 逐字段一致），
 *     保证历史快照字节不变；其余字段（monogram / accentSoft / 中文国家名 / region / 刘海类型）
 *     只用于站点渲染，不进数据契约。
 *   - 本项目无 tsconfig / 无 tsc 步骤，这是纯 .mjs 数据模块，不参与任何类型检查。
 */

/** 全部受支持品牌的 id，有序。新增品牌在此追加一项即可 */
export const BRAND_IDS = Object.freeze(['apple', 'huawei']);

/** 单一真源：每个品牌的完整元数据 */
export const BRANDS = Object.freeze({
  apple: {
    id: 'apple',
    name: 'Apple',
    nameZh: '苹果',
    shortLabel: 'iPhone', // 苹果机型都是 iPhone，列表/定位里用这个短标签比「苹果」更准
    monogram: 'A',
    accentColor: '#0071e3',
    accent: '#0071e3',
    accentSoft: 'rgba(0,113,227,.10)',
    accentLine: 'rgba(0,113,227,.32)',
    motif: 'apple',
    notch: 'island', // 近几代灵动岛
    country: 'US',
    countryLabel: '美国',
    region: 'global',
  },
  huawei: {
    id: 'huawei',
    name: 'HUAWEI',
    nameZh: '华为',
    shortLabel: '华为',
    monogram: 'H',
    accentColor: '#cf0a2c',
    accent: '#cf0a2c',
    accentSoft: 'rgba(207,10,44,.10)',
    accentLine: 'rgba(207,10,44,.32)',
    motif: 'petal',
    notch: 'punch', // 挖孔
    country: 'CN',
    countryLabel: '中国',
    region: 'cn',
  },
});

/**
 * 写入数据快照的精简形状。与旧 sync/index.mjs 的 VENDORS 逐字段一致，
 * 因此 data/products.json 的字节不会因这次重构而变。
 */
export const VENDORS = Object.freeze(
  BRAND_IDS.map((id) => {
    const b = BRANDS[id];
    return {
      id: b.id,
      name: b.name,
      nameZh: b.nameZh,
      accentColor: b.accentColor,
      motif: b.motif,
      country: b.country,
    };
  }),
);

/** 该品牌 id 是否在注册表内 */
export function isValidBrand(id) {
  return BRAND_IDS.includes(id);
}

/** 取品牌元数据；未知 id 返回 undefined（调用方自行兜底） */
export function brandMeta(id) {
  return BRANDS[id];
}

/** 品牌中文名（兜底返回原 id，绝不抛错） */
export function brandZh(id) {
  return BRANDS[id]?.nameZh ?? id;
}

/** 品牌短标签（苹果 → iPhone，华为 → 华为），用于定位句 / 列表 */
export function brandShortLabel(id) {
  return BRANDS[id]?.shortLabel ?? id;
}

/** 品牌英文名 */
export function brandName(id) {
  return BRANDS[id]?.name ?? id;
}
