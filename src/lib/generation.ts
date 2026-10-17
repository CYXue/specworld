/**
 * 较上代派生的前端封装（评审 2026-10-17 §十一-1）。
 * 判据真源在 scripts/lib/generation-delta.mjs（Node 可测，selftest 覆盖）——
 * 这里只做 TS 视图转换与全库链缓存，不写第二份逻辑（两份真源迟早分叉）。
 */
import { buildGenerationChains, deltaBadgeText, generationDelta } from '../../scripts/lib/generation-delta.mjs';
import type { Product } from '../types';

export type { GenerationDelta } from '../../scripts/lib/generation-delta.mjs';

/** 全库代际链：同 (brand,line) 内 id → 上一代。数据集不变则结果不变，调用方缓存。 */
export function generationChainsOf(products: Product[]): Map<string, Product> {
  return buildGenerationChains(products) as Map<string, Product>;
}

/** 本机 vs 上一代的差异摘要（无上一代 → null；无可比字段 → 空对象，调用方同样不渲染） */
export function deltaOf(
  p: Product,
  prev: Product | undefined,
): ReturnType<typeof generationDelta> {
  return generationDelta(p, prev ?? null);
}

/** 卡片徽章文本（挑第一个可算差异；无 → null 不渲染） */
export function deltaBadgeOf(p: Product, prev: Product | undefined, locale: string): string | null {
  return deltaBadgeText(deltaOf(p, prev), locale);
}
