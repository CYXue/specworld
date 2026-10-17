import { computed, type Ref } from 'vue';
import type { Product } from '../types';
import type { DimKey, FacetItem, FilterState } from './facets';
import { applyExcept, DIMENSION_KEYS, emptyFilter, facetOf, toggleValue } from './facets';

/**
 * 筛选浏览器逻辑（rfindex device-filters 模式的下沉版，2026-10-16）：
 * 「分面联动口径 + toggle/clear/reset 三个操作」原本在机型库与品牌页各写一份
 * —— BrandView 注释自己写着「两处筛选必须是同一套逻辑」，靠自觉不靠机制，
 * 正是「同一语义两个答案」这类分叉的温床（同 audit P2-4 派生下沉）。
 *
 * 边界刻意保持与 rfindex 不同的一点：**URL 同步不进这里**。
 * 两页的 URL 形状不同（机型库带 picked/d/h，品牌页是 /brand/:brand 路径），
 * 把 URL 塞进公共层会逼它知道每个页面的私有语义 —— 各页只提供一个
 * `commit(nextFilter)` 回调，怎么写 URL 是页面自己的事。
 *
 * 「列表只消费筛选结果」这条 rfindex 的核心解耦本项目本就具备
 * （列表 = applyFilter(all, filter) 纯函数），本 composable 补的是另一半。
 */
export function useFilterBrowser(opts: {
  /** 全量机型（分面枚举看全集） */
  all: Ref<Product[]>;
  /** 当前筛选状态（URL 已同步好的那份） */
  filter: Ref<FilterState>;
  /** 品牌显示名映射（机型库传，品牌页不传） */
  brandLabels?: Ref<Map<string, string>>;
  /** 筛选变化如何提交（各页自己写 URL） */
  commit: (next: FilterState) => void;
}) {
  const facets = computed<Record<string, FacetItem[]>>(() => {
    const out: Record<string, FacetItem[]> = {};
    for (const d of DIMENSION_KEYS) {
      // 联动口径：计数按「其它维度已生效」算，本维度自身不受限（一点不锁死）
      out[d] = facetOf(
        opts.all.value,
        d,
        applyExcept(opts.all.value, opts.filter.value, d),
        opts.brandLabels?.value,
      );
    }
    return out;
  });

  const onToggle = (dim: DimKey, id: string) => opts.commit(toggleValue(opts.filter.value, dim, id));
  const onClearDim = (dim: DimKey) => opts.commit({ ...opts.filter.value, [dim]: [] });
  const onReset = () => opts.commit(emptyFilter());

  return { facets, onToggle, onClearDim, onReset };
}
