// 参数世界 —— 数据模型（与 data/products.json 对齐）。
// 字段级「官方未公布」以 null / [] 表达，绝不估算填充。

export interface Vendor {
  id: string;
  name: string;
  nameZh: string;
  accentColor: string;
  motif: string;
  country: string;
}

interface Body {
  heightMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  weightG: number | null;
  ipRating: string | null;
  material: string | null;
  colors: string[];
  folded: unknown | null;
}

export interface Display {
  sizeIn: number | null;
  type: string | null;
  resolutionPx: { w: number; h: number } | null;
  ppi: number | null;
  /**
   * 刷新率。**故意是 string | number，不是 number**。
   * 自适应刷新率无法用单值表达：`1-120`（可变量程）、`60/90`（多档）都是官网原文形态，
   * 强行转 number 会丢掉「自适应 / 多档」语义，等于做估算，违反本项目「不做估算」铁律。
   * 实测分布（2026-10-04，60 台）：`1-120`×33 / `120`×20 / `60/90`×1 / null×6。
   *
   * 消费规则：只用模板插值（`${hz} Hz`），number 与 string 都安全；
   * **要做算术或排序，先用 `refreshHzNumber()` 取单值代表值，别直接当 number 用**
   * （直接 `hz + 1` 会字符串拼接成 "1201"，求平均会得 NaN）。
   */
  refreshHz: string | number | null;
  brightnessTypicalNits: number | null;
  brightnessPeakNits: number | null;
  protection: string | null;
}

interface Chipset {
  name: string | null;
  processNm: number | null;
  cpuCores: number | null;
  gpu: string | null;
  npu: string | null;
}

interface Memory {
  ramGb: number[];
  storageGb: number[];
}

interface Battery {
  capacityMah: number | null;
  capacityCaliber: string | null;
  wiredChargeW: number | null;
  wirelessChargeW: number | null;
  vendorClaimedVideoHours: number | null;
  measuredHours: number | null;
}

export interface Camera {
  rear: Array<{
    role: string;
    mp: number | null;
    aperture: string | null;
    ois: boolean | null;
    sensorNote: string | null;
  }>;
  front?: Array<{ role: string; mp: number | null; aperture: string | null }>;
}

/**
 * 一个在售档位（容量/内存组合）。
 *
 * `priceCny` 是**官方起售价（中国大陆，含增值税）**，官方没公布中国区售价就是 `null`
 * —— 不是 0、也不是估算值：0 会被「最便宜」榜当成真价格排到榜首。
 * 以前 Product 只靠索引签名 `[key: string]: unknown` 兜住 skus，于是 `p.skus ?? []`
 * 被推断成 `{}`，取价的三处代码只能各自 `as` 强转（TS 报 'map' does not exist）。
 * 现在补上真类型，强转全撤。
 */
export interface Sku {
  storageGb: number | null;
  ramGb: number | null;
  priceCny: number | null;
  priceNote?: string;
  listedAt?: string;
}

export interface Product {
  id: string;
  slug: string;
  brand: string;
  line: string;
  /**
   * 型号代码（model code）：监管 / 硬件型号代码，**区别于 `name`（型号名称）与 `line`（产品线）**。
   * 例：HUAWEI nova 14 Ultra 的型号名称 = 'nova 14 Ultra'（`name`），型号代码 = 'MRT-AL10'；
   * iPhone 16 Pro 的型号代码 = 'A3292'（国行 / 美版不同，按数据来源标注）。
   * 在 设置→关于手机→型号 或 工信部进网许可 查得。顶层身份字段，不进 specs。
   * 可选以兼容历史记录；**只能由官方来源（官网 / 进网许可）填充，禁止编造**（无数据则留空，不写占位）。
   */
  modelCode?: string;
  /** 型号名称（如 'nova 14 Ultra' / 'iPhone 16 Pro'），区别于 modelCode(型号代码) 与 line(产品线)。顶层身份字段 */
  name: string;
  nameZh: string | null;
  /** v2 全品类目录：品类 id（phone / tablet / laptop / audio，见 data/categories.json）。旧快照没有此字段 */
  category?: string;
  /**
   * 采集粒度（评审 2026-10-16 缺失值三态的判定依据）：
   *   specs-page      官网完整规格页 —— null = 官网真没有（unpublished）
   *   compare-matrix  官网对比页，字段较粗 —— null = 本站未收录（uncollected）
   *   manual          手册/人工整理 —— null 同样按未收录处理
   * 旧快照可能缺失，缺失时按 uncollected 保守处理。
   */
  granularity?: 'specs-page' | 'compare-matrix' | 'manual' | string;
  /**
   * 采集说明（中文串数组，解析层写下的「为什么这个字段是 null」的取证）。
   * 参数表按字段路径/标签匹配后展示在缺值单元格旁（SpecSection）。
   */
  notes?: string[];
  /**
   * 官网原文（仅 specs-page / compare-matrix 采集的产品带）：键 = 官网页面的分段标题，
   * 值 = 该段原文。「可核查」的落点 —— 详情页「官网原文」抽屉直接分段渲染它，
   * 用户拿任何解析值都能对回官网原话。
   */
  rawOfficial?: Record<string, string>;
  /**
   * v2 全品类目录：品类参数容器，键 = 字段路径（如 'display.sizeIn'），
   * 值 = 官网值或用户修正值（provenance 标 'user-manual'）。
   * 数据加载时 adapt.ts 会把它展开回 body/display 等嵌套形状，
   * 所以现有组件读 product.display.sizeIn 不受影响；新品类页面直接消费它。
   */
  specs?: Record<string, unknown>;
  /** 在售档位表（容量/内存/价格）。v1 老快照可能整段缺失 */
  skus?: Sku[];
  releaseDate: string; // ISO date
  releaseDatePrecision: 'day' | 'month' | 'year' | string;
  /**
   * 生命周期状态。⚠️ 权威枚举 = 'on-sale' | 'upcoming' | 'retired'（与 src/lib/types.ts
   * ProductRecord.status 一致——本文件是前端侧镜像、那份是管线侧镜像，两份必须同改；
   * 运行时闸门 = scripts/sync/validate.mjs 的 11a，真源 = scripts/lib/schema.mjs 的
   * LIFECYCLE_STATUS_VALUES）。
   * 历史漂移记录：此处曾带 `| string` 兜底，把 812 台 'discontinued'（v1 残留）吞进类型
   * 系统、页面回落显示原始键——2026-10-17 审计 A1 移除兜底并补闸门。
   */
  status: 'on-sale' | 'upcoming' | 'retired';
  retiredAt: string | null;
  /**
   * 数据来源链接（官网新闻稿 / 发布会页等，可被 `source` 直接验证）。
   * 数据层从 release-dates / overrides 合并进产品；未公布写 null，不是空串。
   * 详情页 SourceBadge 据此渲染「来源」或「官方未公布」。
   */
  sourceUrl?: string | null;
  body: Body;
  display: Display;
  chipset: Chipset;
  memory: Memory;
  battery: Battery;
  camera: Camera;
  // 其余字段（connectivity 等）按需以索引访问
  [key: string]: unknown;
}

export interface Dataset {
  generatedAt: string;
  windowStart: string;
  /**
   * 数据来源行。noteKey/noteParams 是管线写下的**键化文案**
   * （2026-10-14 i18n 深扫：note 是中文串不能直接展示，英文页会吐中文）；
   * 老快照没有这两个字段，展示回落到 note —— 故都是可选。
   */
  sources: Record<
    string,
    { fetchedAt: string; note: string; ok: boolean; noteKey?: string; noteParams?: Record<string, string | number> }
  >;
  vendors: Vendor[];
  products: Product[];
}

export type Continent = 'west' | 'east';

export function continentOf(vendor: Vendor | undefined): Continent {
  // 参考项目：west=国外(US)，east=国内(CN)
  return vendor?.country === 'CN' ? 'east' : 'west';
}
