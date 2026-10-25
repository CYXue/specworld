/**
 * scripts/lib/specs.mjs 的类型声明。
 *
 * 为什么要有这个文件：specs 的拍平 / 取值 / 展开三个纯函数是**管线与前端共用的一份真身**
 * （前端 src/lib/adapt.ts import expandSpecs），但 tsconfig 开了 `allowJs: false` 且只收录
 * `src/**`，TS 认不出 .mjs 的导出形状，报 TS7016「隐式 any」。
 * 之前靠 `as` 强转蒙过去，等于把边界契约又丢回给运行时 —— 现在在这里写死，
 * 改签名时 tsc 会直接报出来。
 *
 * ⚠️ 本文件是**镜像**，不是真身：改了 .mjs 的实现必须同步改这里，
 * 否则类型会撒谎（比没有类型更危险）。selftest 里那几条 specs 用例是运行时兜底。
 */

/** 手机品类的参数组。拍平/展开都按这个清单走；其他品类用自己的 schema 字段前缀 */
export const SPEC_GROUPS: readonly string[];

/** 取值：只读 specs 容器（2026-10-21 起 specs 是唯一真源，v1 回退已拆除） */
export function pick(product: unknown, path: string): unknown;

/** 写 specs 值。product 上没有 specs 容器时现场建 */
export function setSpec(
  product: { specs?: Record<string, unknown> },
  path: string,
  value: unknown,
): void;

/** 拍平：product[group] 的每个键搬进 specs['group.key']，已存在的值以拍平结果为准（幂等） */
export function flattenSpecs(product: unknown, groups?: readonly string[]): Record<string, unknown>;

/** 展开：specs → 嵌套视图对象（'display.sizeIn' → { display: { sizeIn } }） */
export function expandSpecs(
  specs: Record<string, unknown> | null | undefined,
): Record<string, unknown>;
