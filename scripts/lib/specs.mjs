/**
 * specs 容器操作：拍平（v1 嵌套 → v2 specs 扁平）、取值（specs-first）、展开（specs → 嵌套视图）。
 *
 * 为什么要有 specs 容器（2026-10-13，全品类改造）
 * --------------------------------------------
 * 旧格式把手机专属结构（body/display/chipset/…）写死在 ProductRecord 上，
 * 加一个品类（笔记本有 CPU/GPU/屏幕/电池，耳机有驱动单元/续航/编码）就要改一遍
 * 契约类型、闸门、派生、前端——改到最后每个品类一套分支，「全品类」永远停在上。
 *
 * v2 把「品类无关的身份字段」留在顶层，「品类相关的参数」全部进一个扁平 specs 容器：
 *   specs = { 'body.weightG': 199, 'display.sizeIn': 6.3, 'camera.rear': [...] }
 * 每个品类用 data/schemas/<category>.json 声明自己有哪些字段（类型/区间/排序方向），
 * 管线、闸门、派生、前端渲染全部 schema 驱动，新增品类零代码。
 *
 * 三个纯函数都是同源真身，前后端共用（前端 src/lib/adapt.ts import 本文件的 expandSpecs）：
 *   - flattenSpecs：管线迁移用（v1 → v2）
 *   - pick：取值一律 specs-first，嵌套回退——迁移期新旧快照双兼容
 *   - expandSpecs：前端视图层用（specs → 手机嵌套对象，现有组件零改动）
 */

/** 手机品类的参数组。拍平/展开都按这个清单走；其他品类用自己的 schema 字段前缀 */
export const SPEC_GROUPS = Object.freeze([
  'body',
  'display',
  'chipset',
  'memory',
  'battery',
  'camera',
  'connectivity',
  'os',
]);

/**
 * 取值：只读 specs 容器。
 *
 * 2026-10-21 迁移完成（盘上快照 v2-only、测试夹具已同形状），v1 嵌套回退分支拆除——
 * specs 是唯一真源。保留回退会让「用户改了 specs、嵌套里还是官网旧值」的
 * 双真源 bug 有一条永远活着的通路（见 selftest 08 的回归闸门）。
 */
export function pick(product, path) {
  const specs = product?.specs;
  if (specs && Object.prototype.hasOwnProperty.call(specs, path)) return specs[path];
  return undefined;
}

/** 写 specs 值。product 上没有 specs 容器时现场建（用户数据层新增的机型走这条） */
export function setSpec(product, path, value) {
  if (!product.specs) product.specs = {};
  product.specs[path] = value;
}

/**
 * 拍平：把 product[group] 的每个键搬进 specs['group.key']。
 *
 * 只拍一层——`display.resolutionPx` 是 {w,h} 对象，整体作为一个值存
 * （schema 里它的 type 就是 object），不拆成 resolutionPx.w / resolutionPx.h：
 * 拆了之后 schema 要管两个叶子，而 provenance 本来就登记在 `display.resolutionPx.w` 上
 * （见 validate.mjs 的 10b 闸门注释），两边一对就多出一堆特例。
 *
 * 已存在于 specs 的值以拍平结果为准（v2 数据再次调用时幂等）。
 */
export function flattenSpecs(product, groups = SPEC_GROUPS) {
  const specs = { ...(product.specs ?? {}) };
  for (const g of groups) {
    const obj = product?.[g];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    for (const [k, v] of Object.entries(obj)) {
      specs[`${g}.${k}`] = v;
    }
  }
  return specs;
}

/**
 * 展开：specs → 嵌套视图对象。前端 adapt 层用，现有组件读 product.display.sizeIn 零改动。
 *
 * 'display.resolutionPx' → { display: { resolutionPx: {w,h} } }
 * 'body.colors'          → { body: { colors: [...] } }
 * 没有组前缀的键（未来若有顶层标量参数）原样放进顶层。
 */
export function expandSpecs(specs) {
  const out = {};
  for (const [path, v] of Object.entries(specs ?? {})) {
    const dot = path.indexOf('.');
    if (dot < 0) {
      out[path] = v;
      continue;
    }
    const group = path.slice(0, dot);
    const key = path.slice(dot + 1);
    if (!out[group] || typeof out[group] !== 'object') out[group] = {};
    out[group][key] = v;
  }
  return out;
}
