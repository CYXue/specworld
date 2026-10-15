/**
 * 原始响应归档的形状契约（纯函数，零依赖）—— **生成器与判据的唯一真源**。
 *
 * `scripts/archive.mjs`（生成归档件）与 `scripts/selftest.mjs`（形状判据）
 * 都从这里引。判据与生成器曾经各写一份，结果是「判据从没在真归档上跑过」：
 * 2026-10-12 第一次提交 data/raw/，价格通道 7/7 台因为 archiveShape 只懂
 * 规格通道（id/name/specsUrl/raw）而被剥成只剩 id/name 的空壳 ——
 * 价格原文（startPriceCny / pricesByStorage / evidence …）全部静默丢失，
 * 而归档目录看着一切正常。这正是「闸门没被测 = 不知道自己能不能拦」的又一形态：
 * 判据写对了渠道，却从没喂过真实数据。
 *
 * 为什么价格通道是另一套形状
 * --------------------------
 * 四个取数通道产出两种结构：
 *
 *   - 规格通道（huawei / apple / apple-compare）：`RawProduct`，specsUrl + raw
 *     （raw 是「章节名 → 页面原文」的扁平键值对，规范化层吃这个）。
 *   - 价格通道（apple-prices）：不产规格，产价格 —— startPriceCny、
 *     pricesByStorage、sourceUrl、evidence、crossCheck 等 14 个字段，
 *     **没有 specsUrl 也没有 raw**（7/7 台皆然，这不是缺数据，是通道性质）。
 *
 * 拿规格通道的模子去切价格通道，JSON.stringify 会把 undefined 的 specsUrl/raw
 * 整个键丢掉，剩下 id/name 两个键 —— 归档件「存在且合法」，但回放时
 * 价格解析器喂不到任何输入。**能回放是归档件存在的唯一理由**，
 * 所以形状必须分渠道定义，而不是挑一个渠道的模子套所有。
 *
 * 两条不变量（判据与生成器都必须守住）
 * ------------------------------------
 * 1. **不含运行时刻字段**（fetchedAt / extractedAt / generatedAt / firstSeenAt /
 *    lastSeenAt / publishedAt / builtAt）：一进归档，每轮抓取归档件都不同 →
 *    每 12 小时一次空提交（本项目已因此踩过两次，见 fingerprint.mjs 注释）。
 *    规格通道的 raw.json 里本来就有 extractedAt / brand / _source，
 *    白名单制天然把它们挡在外面。
 * 2. **白名单制，不黑名单制**：上游加字段是常态（官网改版、适配器升级），
 *    黑名单要等新字段造成一次事故才补；白名单默认拒绝，新字段进不了归档，
 *    体积与形状永远可预期。
 */

/** 四个取数通道 → 归档文件名与形状 */
export const CHANNELS = [
  { file: 'huawei.raw.json', out: 'huawei-official.json', shape: 'spec' },
  { file: 'apple.raw.json', out: 'apple-official.json', shape: 'spec' },
  { file: 'apple-compare.raw.json', out: 'apple-compare-official.json', shape: 'spec' },
  { file: 'apple-prices.raw.json', out: 'apple-prices-official.json', shape: 'price' },
];

/** 规格通道：RawProduct 的回放必需字段 */
const SPEC_PRODUCT_FIELDS = ['id', 'name', 'specsUrl', 'raw'];

/**
 * 价格通道：价格抓取的回放必需字段（2026-10-12 按适配器实际产出核定）。
 * evidence / crossCheck 是抓取凭据（HTTP 状态、SKU、交叉验证端点），
 * 静态内容、无时间戳 —— 解析器改坏后复现价格逻辑就靠它们，必须留。
 */
const PRICE_PRODUCT_FIELDS = [
  'id',
  'name',
  'startPriceCny',
  'pricesByStorage',
  'sourceUrl',
  'currency',
  'priceScope',
  'skuCount',
  'capacitiesCount',
  'colorCount',
  'storePricingId',
  'buySlug',
  'evidence',
  'crossCheck',
];

/** 归档件顶层只允许这三个键（skipped 是覆盖范围的一部分，必须可追溯） */
export const ARCHIVE_TOP_FIELDS = ['products', 'skipped', 'source'];

/** 运行时刻字段黑名单 —— 与白名单制互补，专门服务「归档件级」的判据 */
export const ARCHIVE_VOLATILE_FIELDS = [
  'fetchedAt',
  'extractedAt',
  'generatedAt',
  'firstSeenAt',
  'lastSeenAt',
  'publishedAt',
  'builtAt',
];

/** 某形状下，单个 product 允许的键（排序后，供 deepEqual 断言） */
export function productFields(shape) {
  return (shape === 'price' ? PRICE_PRODUCT_FIELDS : SPEC_PRODUCT_FIELDS).slice().sort();
}

/** 归档文件名 → 形状（判据侧用；archive.mjs 侧直接拿 CHANNELS 的 shape） */
export function shapeOfArchive(file) {
  const ch = CHANNELS.find((c) => c.out === file);
  return ch ? ch.shape : 'spec';
}

/**
 * 把一个通道的 SourceResult 压成归档形状（白名单制）。
 *
 * 只取该形状允许的键：规格通道取 id/name/specsUrl/raw，
 * 价格通道取 14 个价格字段。其余（brand / extractedAt / _source / notes…）
 * 一律丢弃。
 *
 * ⚠️ **规格通道的 specsUrl / raw 不许补默认值**（2026-10-14 审计 B14）：
 * 曾经的 `specsUrl ?? ''` / `raw ?? {}` 把「缺失」抹成「空值」，而形状判据
 * （selftest 的键集合断言）只看键在不在 —— `specsUrl: ''` 照样通过。
 * 于是一台**抓取失败、没有 URL 无法回放**的规格件会静默地成为合法归档件，
 * 回放验证对它自欺欺人。归档的存在意义就是回放：缺原文 = 直接抛错，
 * 让生成阶段就炸，而不是留一个长得像回放素材的空壳。
 * 价格通道没有这两个键（它的原文是价格字段），不适用本条。
 */
export function archiveShape(result, shape = 'spec') {
  const fields = shape === 'price' ? PRICE_PRODUCT_FIELDS : SPEC_PRODUCT_FIELDS;
  return {
    source: result.source,
    products: (result.products ?? []).map((p) => {
      const out = {};
      for (const f of fields) {
        if (shape === 'spec' && f === 'specsUrl') {
          if (typeof p[f] !== 'string' || !p[f]) {
            throw new Error(
              `归档拒绝：规格通道 ${p.id ?? '?'} 缺 specsUrl —— 没有 URL 的归档件无法回放，` +
                `不许用空串冒充（见 archive-shape.mjs 头注，2026-10-14 审计 B14）`,
            );
          }
          out[f] = p[f];
        } else if (shape === 'spec' && f === 'raw') {
          if (!p[f] || typeof p[f] !== 'object' || !Object.keys(p[f]).length) {
            throw new Error(
              `归档拒绝：规格通道 ${p.id ?? '?'} 缺 raw 原文 —— 没有页面原文的归档件` +
                `无法回放，不许用空对象冒充（2026-10-14 审计 B14）`,
            );
          }
          out[f] = p[f];
        } else {
          out[f] = p[f] ?? null;
        }
      }
      return out;
    }),
    skipped: (result.skipped ?? []).map((s) => ({ id: s.id, reason: s.reason })),
  };
}
