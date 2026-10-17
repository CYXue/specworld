import type { Product } from '../types';
import { categoryOf, isFoldable } from './catalog';

/**
 * 设备视觉区的纯函数几何与取色（2026-10-16 二轮优化）。
 *
 * 背景：产品卡片从纯文字卡改为「品牌色块 + 屏幕比例矩形」的视觉锚点
 * （用户拍板：纯 CSS 几何，不要图片、不复活已退役的立绘管线）。
 * 这里只放**派生事实**（品类→比例、hex→rgba），组件不各自算——
 * 和折叠判据同一条纪律：一处算错，全站卡片一起错。
 */

/** hex → rgba()。品牌色数据契约里是 #rrggbb 形态；解析失败回退 --color-faint 中性灰，不抛。 */
export function hexToRgba(hex: string | undefined | null, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return `rgba(100, 112, 138, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * 视觉区里屏幕矩形的宽高比（宽/高）——由品类（+形态）推导的**展示几何**，
 * 不是产品实测尺寸，只为让同类设备看起来像一类。
 *
 * 缺失/未知品类 → 1.0（方形），不猜比例；
 * 折叠手机展开态接近方形，比直板明显宽（单独一档，不是插值）。
 */
const RATIO: Record<string, number> = {
  phone: 0.46,
  tablet: 0.72,
  laptop: 1.6,
  desktop: 1.78,
  display: 1.78,
  pda: 0.6,
  wearable: 0.85,
  headset: 1,
  audio: 1,
  media: 0.62,
  tracker: 1,
  network: 1.3,
  input: 1.2,
  printer: 1.2,
  home: 1,
  accessory: 1,
  storage: 1.3,
};

export function deviceScreenRatio(p: Product): number {
  const cat = categoryOf(p);
  let r = RATIO[cat] ?? 1;
  if (cat === 'phone' && isFoldable(p)) r = 0.66;
  return r;
}

/** 视觉区尺寸：给定区域高度，按比例算出不越界的矩形（宽不超过区域高度本身）。 */
export function screenBox(p: Product, zoneH: number): { width: string; height: string } {
  const r = deviceScreenRatio(p);
  const w = r <= 1 ? Math.round(zoneH * r) : zoneH;
  const h = r <= 1 ? zoneH : Math.round(zoneH / r);
  return { width: `${w}px`, height: `${h}px` };
}
