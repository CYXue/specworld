/**
 * 数据源适配器的输出契约。
 *
 * 分工原则（很重要，别越界）：
 *   - **适配器（scripts/sources/*.ts）**：只负责「把官网页面变成结构化的原始键值对」。
 *     不判断单位、不做换算、不做口径裁决、不决定字段该叫什么名字。
 *   - **规范化层（scripts/normalize/*.ts）**：负责把原始键值映射成 `ProductRecord`，
 *     解析单位、判定口径、记录 provenance。这一层是人类常识的落点，是全站最核心的资产。
 *
 * 这样分工的原因：官网改版时只需要改适配器；口径判断出错时只需要改规范化层。
 * 两者混在一起，改一个页面结构就会牵动全站数据语义。
 */

import type { BrandId, SourceId } from '../src/lib/types.ts';

/** 一个机型的原始抓取结果。字段名保持官网原样，不做任何加工 */
export interface RawProduct {
  /** `apple-iphone-17-pro` / `huawei-mate90-pro` */
  id: string;
  brand: BrandId;
  /** 官网上的产品名，原样保留（含 　 等字符） */
  name: string;
  /** 规格页 URL，用于溯源与排错 */
  specsUrl: string;
  /**
   * 扁平原始字段。键的形状由各适配器自定，但必须满足：
   *   - 含章节名，便于规范化层定位（如 `显示屏.尺寸` / `display.size`）
   *   - 值是**页面原文**，未做单位换算（`6.8 英寸` 就存 `6.8 英寸`）
   *   - 拿不到的字段**不要写进来**，也不要用空字符串占位
   */
  raw: Record<string, string>;
  /** 官网页面自带的上市信息（有就带，没有就省略，不要猜） */
  releaseHint?: { text: string; key: string };
  extractedAt: string;
}

export interface SourceResult {
  source: Extract<SourceId, 'apple-official' | 'huawei-official'>;
  fetchedAt: string;
  /** 抓取过程中的异常与跳过记录，会原样进快照的 sources 字段供排查 */
  notes: string[];
  /** 已下线/拿不到的机型也要回传，用于「覆盖范围」透明化 */
  skipped: Array<{ id: string; reason: string }>;
  products: RawProduct[];
}

/** 适配器必须导出的函数签名 */
export type SourceAdapter = () => Promise<SourceResult>;
