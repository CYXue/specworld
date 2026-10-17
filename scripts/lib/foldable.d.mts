/**
 * scripts/lib/foldable.mjs 的类型声明（同 specs.d.mts：跨层复用的真身在 scripts/ 下，
 * TS 认不出 .mjs 导出，需要一个镜像声明，改实现要同步改这里）。
 *
 * 折叠屏判据的**运行时前端唯一真源**：历史上构建期像素立绘
 * （scripts/sprite/generate.mjs，2026-10-16 已随去像素化删除）与前端曾各写一份正则，
 * 出现「立绘画成折叠屏、参数页写直板」的静默分叉 —— 该消费者退役后判据收敛为这一份，
 * 由 src/lib/catalog.ts 转出消费。
 *
 * 参数写成「带索引签名的对象」而不是 `{ rawOfficial?: … }`：后者在 TS 眼里是 weak type
 * （属性全可选），传 Product 会被 weak type 检测以「没有任何同名属性」为由拒掉，
 * 尽管 Product 有 `[key: string]: unknown`。加索引签名既守住「至少是个对象」，又不误伤。
 */
export function isFoldableOfficial(
  p: { rawOfficial?: unknown; [key: string]: unknown } | null | undefined,
): boolean;
