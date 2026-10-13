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

export interface Body {
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

export interface Chipset {
  name: string | null;
  processNm: number | null;
  cpuCores: number | null;
  gpu: string | null;
  npu: string | null;
}

export interface Memory {
  ramGb: number[];
  storageGb: number[];
}

export interface Battery {
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
   * v2 全品类目录：品类参数容器，键 = 字段路径（如 'display.sizeIn'），
   * 值 = 官网值或用户修正值（provenance 标 'user-manual'）。
   * 数据加载时 adapt.ts 会把它展开回 body/display 等嵌套形状，
   * 所以现有组件读 product.display.sizeIn 不受影响；新品类页面直接消费它。
   */
  specs?: Record<string, unknown>;
  releaseDate: string; // ISO date
  releaseDatePrecision: 'day' | 'month' | 'year' | string;
  status: 'on-sale' | 'upcoming' | 'retired' | string;
  retiredAt: string | null;
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
  sources: Record<string, { fetchedAt: string; note: string; ok: boolean }>;
  vendors: Vendor[];
  products: Product[];
}

export type Continent = 'west' | 'east';

export function continentOf(vendor: Vendor | undefined): Continent {
  // 参考项目：west=国外(US)，east=国内(CN)
  return vendor?.country === 'CN' ? 'east' : 'west';
}
