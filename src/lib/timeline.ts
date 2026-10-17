import type { Product } from '../types';

/**
 * 生命周期时间轴（按产品线）的派生数据 —— 派生事实一律下沉 lib/（项目纪律）。
 *
 * 评审 2026-10-16：iMac、iPad、iPhone、AirPort 这类长产品线，用时间轴看
 * 比表格清楚十倍；同时这张图是**最好的数据校验器** —— 停售早于发布的机型
 * 线会往回走，一眼可见（闸门 15 已在写盘前拦截，这里是展示侧的第二道目击）。
 *
 * 口径纪律：
 * - 发布端严格按 releaseDatePrecision 降级：year 精度只画到年份，不渲染 01-01 假日期。
 * - 停售端 unknown 就画虚线尾巴到当前年份 —— 不估算停售时间，只是「尚无停售记录」的可视化。
 */

export interface LifecycleItem {
  product: Product;
  /** 发布年份（无发布日期 → null，画不出起点就不画） */
  startYear: number;
  /** 停售年份；null = 无停售记录（虚线尾巴画到当前年） */
  endYear: number | null;
  /** 时间倒挂标记（停售早于发布）：正常数据不该出现，出现即数据事故 */
  inverted: boolean;
}

export interface LifecycleLine {
  line: string;
  items: LifecycleItem[];
}

const CURRENT_YEAR = new Date().getFullYear();

function yearOf(iso: string | null | undefined, precision: string): number | null {
  if (!iso) return null;
  // year/month 精度只取年份部分（2026-10-17：假精度已在闸门 16 拦截，这里按声明降级）
  const y = Number.parseInt(iso.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

/** 按产品线归组（只收有发布日期的机型），组内按发布年份升序 */
export function lifecycleLines(products: Product[], minSize = 3): LifecycleLine[] {
  const byLine = new Map<string, Product[]>();
  for (const p of products) {
    if (!p.line || !p.releaseDate) continue;
    const list = byLine.get(p.line) ?? byLine.set(p.line, []).get(p.line)!;
    list.push(p);
  }
  const out: LifecycleLine[] = [];
  for (const [line, list] of byLine) {
    if (list.length < minSize) continue;
    const items: LifecycleItem[] = list
      .map((product) => {
        const startYear = yearOf(product.releaseDate, product.releaseDatePrecision);
        const endYear = yearOf(product.retiredAt, 'day');
        return {
          product,
          startYear,
          endYear,
          inverted: startYear != null && endYear != null && endYear < startYear,
        };
      })
      .filter((x): x is LifecycleItem & { startYear: number } => x.startYear != null)
      .sort((a, b) => a.startYear - b.startYear);
    out.push({ line, items });
  }
  // 长产品线优先（台数多 = 时间轴价值大），再按线名稳定排序
  return out.sort((a, b) => b.items.length - a.items.length || a.line.localeCompare(b.line));
}

/** 一条线的横轴范围：线内最早发布年 → 最晚（停售或当前）年 */
export function lineRange(items: LifecycleItem[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const it of items) {
    min = Math.min(min, it.startYear);
    max = Math.max(max, it.endYear ?? CURRENT_YEAR);
  }
  return { min, max: Math.max(max, min) };
}

/** 条形在横轴上的偏移与宽度（百分比）。inverted 时宽度按 0 处理，靠颜色标记暴露 */
export function barGeometry(it: LifecycleItem, range: { min: number; max: number }): {
  leftPct: number;
  widthPct: number;
  dashedTail: boolean;
} {
  const span = Math.max(range.max - range.min, 1);
  const end = it.inverted ? it.startYear : (it.endYear ?? CURRENT_YEAR);
  const leftPct = ((it.startYear - range.min) / span) * 100;
  const widthPct = Math.max(((end - it.startYear) / span) * 100, 0.8);
  return { leftPct, widthPct, dashedTail: it.endYear == null && !it.inverted };
}
