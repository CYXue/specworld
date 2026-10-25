/**
 * 品牌注册表（单一真源）。
 *
 * 设计动机（见 docs/ENGINEERING-REVIEW.md 维度二）：品牌相关的字符串 / 元数据
 * 原本散落在约 10 处 —— validate 的品牌白名单、sync 的 VENDORS、站点 ui 的 BRANDS、
 * derive 的「iPhone / 华为」标签、qa 的 BRAND_ZH……。
 * 加第三品牌（小米 / 三星，BENCHMARK 已列为未来方向）要改 10 处，极易漏。
 *
 * 这里集中维护一份，其余处改为查表。新增品牌只需改这一个文件。
 *
 * 纪律：
 *   - `BRAND_IDS` 是有序数组，决定「数据快照里的 vendors 顺序」与「遍历所有品牌的循环顺序」，
 *     改顺序会改变 data/products.json 的字节——所以不要随便重排。
 *   - `VENDORS` 是写入 data/products.json 的精简形状（与旧 sync/index.mjs 的 VENDORS 逐字段一致），
 *     保证历史快照字节不变。
 *   - 本项目无 tsconfig / 无 tsc 步骤，这是纯 .mjs 数据模块，不参与任何类型检查。
 *   - 2026-10-16：原 monogram / accentSoft / accentLine / notch / countryLabel / region
 *     六个字段与 `brandMeta()` 随像素立绘退役一并删除——唯一消费者是
 *     `scripts/sprite/generate.mjs`（已删），全仓对账零其他调用方。
 */

/** 全部受支持品牌的 id，有序。新增品牌在此追加一项即可 */
const BRAND_IDS = Object.freeze(['apple', 'huawei', 'xiaomi', 'honor']);

/** 单一真源：每个品牌的完整元数据 */
const BRANDS = Object.freeze({
  apple: {
    id: 'apple',
    name: 'Apple',
    nameZh: '苹果',
    shortLabel: 'Apple', // 2026-10-15 六品类扩充前是 'iPhone'（当时苹果只有手机）；现在苹果有手机/平板/电脑/手表/耳机，定位句必须用品牌级短标签
    accentColor: '#0071e3',
    motif: 'apple',
    country: 'US',
  },
  huawei: {
    id: 'huawei',
    name: 'HUAWEI',
    nameZh: '华为',
    shortLabel: '华为',
    accentColor: '#cf0a2c',
    motif: 'petal',
    country: 'CN',
  },
  xiaomi: {
    id: 'xiaomi',
    name: 'Xiaomi',
    nameZh: '小米',
    shortLabel: '小米',
    accentColor: '#ff6900',
    motif: 'mi',
    country: 'CN',
  },
  // 2026-10-25 新增第四品牌：荣耀（2013-2020 为华为子品牌，2020-11 独立）。
  // 本站收录口径：荣耀品牌下 2013 年起的机型（独立后产品为主，子品牌时期主力机一并收录，
  // 取证口径与其他品牌一致——检索式逐台 sourceUrl）。
  honor: {
    id: 'honor',
    name: 'HONOR',
    nameZh: '荣耀',
    shortLabel: '荣耀',
    accentColor: '#00a0e9',
    motif: 'honor',
    country: 'CN',
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

/** 品牌中文名（兜底返回原 id，绝不抛错） */
export function brandZh(id) {
  return BRANDS[id]?.nameZh ?? id;
}

/** 品牌短标签（苹果 → iPhone，华为 → 华为），用于定位句 / 列表 */
export function brandShortLabel(id) {
  return BRANDS[id]?.shortLabel ?? id;
}
