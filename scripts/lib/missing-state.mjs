/**
 * 缺失值三态判定（唯一真源）。
 *
 * 三种「没有值」语义完全不同，界面必须区分呈现（评审 2026-10-17）：
 *   - not_published  官网真没有 —— 该产品走 specs-page 深采集，官网原文里就没有此字段
 *   - not_collected  本站没采到 —— 该产品走 compare-matrix 等粗通道，官网可能有但本站没抓
 *   - not_applicable 品类无此项 —— 数据侧以 '/' / '—' 占位表达（如音频品类无屏幕行）
 *
 * 为什么判定规则放 scripts/lib（而不是只在 src/lib/fields.ts 内联）：
 *   这层判定是「界面把缺失说成什么」的唯一依据，说错就是数据诚信问题——
 *   把「本站没采到」说成「官网未公布」等于替官网撒谎。按本项目纪律，
 *   判据必须可被 selftest 覆盖，而 selftest 是 Node 脚本不能 import TS。
 *   （同款先例：foldable.mjs 被 catalog.ts 跨界 import。）
 *
 * ⚠️ 本文件必须保持纯 JS（Node 直接 import），不许写 TS 注解——
 *   `function f(x: number)` 在 .mjs 里是语法错误，且只在 selftest 跑到时才炸。
 */

/**
 * 行级缺失态判定，返回以下之一：
 *   'value' | 'not_applicable' | 'not_published' | 'not_collected'
 * （fields.ts 的展示层命名 value/none/unpublished/uncollected 由 toSpecRowState 映射）
 *
 * 判定顺序：
 *   任一 path 有非空真值 → value（0 是真值——数据诚信：null 才是没公布）；
 *   值为 '/' / '—' → not_applicable（品类无此项）；
 *   全空 → 按产品 granularity 区分「官网未公布」与「本站未采集」；
 *   granularity 未知时保守按 not_collected 处理（宁可少说，不替官网下结论）。
 */
export function classifyMissing(values, granularity) {
  // 真值 = 非空且非占位符（'/' '—' 是品类无此项的占位，不是值；
  // 且占位也是非空串，必须先排除，否则被当真值吃掉——本次 selftest 反向测抓到的）
  const isRealValue = (v) =>
    v !== null && v !== undefined && v !== '' && !isNonePlaceholder(v);
  if (values.some(isRealValue)) return 'value';
  if (values.some(isNonePlaceholder)) return 'not_applicable';
  return granularity === 'specs-page' ? 'not_published' : 'not_collected';
}

/** 数据侧「无」的两种写法：占位 '—' 与原文 '/' */
export function isNonePlaceholder(v) {
  return v === '/' || v === '—';
}

/** SpecRowState（fields.ts 的展示层命名）← classifyMissing 的返回值 */
export function toSpecRowState(s) {
  switch (s) {
    case 'value':
      return 'value';
    case 'not_applicable':
      return 'none';
    case 'not_published':
      return 'unpublished';
    default:
      return 'uncollected';
  }
}
