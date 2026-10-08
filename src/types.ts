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
  name: string;
  nameZh: string | null;
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
