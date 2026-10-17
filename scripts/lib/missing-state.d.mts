/**
 * missing-state.mjs 的类型声明（TS 侧跨界 import 的垫片）。
 * 真源是同目录 .mjs（Node/selftest 直接跑，必须保持纯 JS）；
 * 这里只补类型视图，签名改动必须两边同步。
 */
export declare function classifyMissing(
  values: unknown[],
  granularity: string | undefined,
): 'value' | 'not_applicable' | 'not_published' | 'not_collected';

export declare function isNonePlaceholder(v: unknown): boolean;

export declare function toSpecRowState(
  s: 'value' | 'not_applicable' | 'not_published' | 'not_collected',
): 'value' | 'none' | 'unpublished' | 'uncollected';
