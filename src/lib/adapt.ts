import { expandSpecs } from '../../scripts/lib/specs.mjs';
import type { Product } from '../types';
// v2 specs 容器 → 手机嵌套视图。展开逻辑与管线拍平（flattenSpecs）同一份真身
// （scripts/lib/specs.mjs），避免「管线拍平一套、前端展开一套」对不上——
// 那种分叉的症状是页面某个参数恒为「未公布」，而数据里明明有值。

/**
 * 把 v2 产品记录展开成手机嵌套视图。
 *
 * 为什么需要它：data/products.json 落盘的是全品类通用形状
 * （身份字段在顶层、品类参数在扁平 specs 容器里，`specs['display.sizeIn']`）。
 * 现有 33 个组件读的是 `product.display.sizeIn` 这种嵌套形状。
 * 在数据加载口做一次纯函数展开，组件零改动；新品类页面则直接消费 specs + schema。
 *
 * 非手机品类不过本函数（没有 specs 的 v1 记录原样返回，兼容旧快照）。
 */
function toPhoneView(p: Product): Product {
  if (!p.specs) return p;
  return { ...p, ...expandSpecs(p.specs) } as Product;
}

/** 批量展开。数据加载入口（src/lib/data.ts）调用一次 */
export function toPhoneViews(products: Product[]): Product[] {
  return products.map(toPhoneView);
}

/**
 * 取值状态四态（借鉴准绳/Baseline 的 value_status）。
 *   available        specs 有值            → 正常显示
 *   unknown          specs 缺该键          → 显示"—"（官方未公布）
 *   none             status[path]='none'   → 显示"无"
 *   not_applicable   status[path]=该值      → 显示"不适用"，跨品类时整行隐藏
 *
 * 前端参数表渲染时按此函数决定每个字段的呈现，而不是只判断「有值/无值」——
 * 否则跨品类会出现「该品类根本没有这个参数，却显示空白」或「本就没有却假装无」。
 */
type ValueStatus = 'available' | 'unknown' | 'none' | 'not_applicable';

/** 四态对应的展示文案（对齐准绳：未知="—"，无="无"，不适用="不适用"） */
export function statusLabel(s: ValueStatus): string {
  return s === 'unknown' ? '—' : s === 'none' ? '无' : s === 'not_applicable' ? '不适用' : '';
}
