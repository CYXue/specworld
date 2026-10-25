/**
 * generation-delta.mjs 的类型声明（TS 侧跨界 import 的垫片，同 missing-state.d.mts 纪律）。
 * 真源是同目录 .mjs（Node/selftest 直接跑，必须保持纯 JS）；签名改动两边同步。
 */
export interface GenerationDelta {
  battery?: number;
  weight?: number;
  size?: number;
  chip?: string;
}

export declare function buildGenerationChains(
  products: Array<{ id: string; brand: string; line: string; releaseDate: string | null }>,
): Map<string, { id: string }>;

export declare function generationDelta(
  p: { specs?: Record<string, unknown> },
  prevProduct: { specs?: Record<string, unknown> } | null,
): GenerationDelta | null;

export declare function deltaBadgeText(delta: GenerationDelta | null): string | null;
