import { computed, reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Product } from '../types';
import {
  DIMENSION_KEYS,
  type FilterState,
  type SortKey,
  type FacetItem,
  emptyFilter,
  buildCatalog,
  readFilter,
  writeFilter,
  applyFilter,
  applyExcept,
  applyMultiSort,
  facetOf,
  toggleValue,
  isFiltered,
} from './facets';

/**
 * 机型库筛选状态（URL 即状态）。
 *
 * 复用 facets.ts 的纯函数：applyFilter / facetOf / writeFilter / readFilter /
 * applyMultiSort。筛选维度与数据管线同源（DIMENSION_KEYS 含身份维度 + schema facet 维度），
 * 新增品类/参数维度无需改这里。
 *
 * 已选对比设备走 useCompare（独立 `sel` 参数），不与筛选参数冲突。
 */
export function useLibraryFilters(
  products: Product[],
  brandLabels?: Map<string, string>,
) {
  const route = useRoute();
  const router = useRouter();
  const catalog = buildCatalog(products, DIMENSION_KEYS, brandLabels);
  // reactive 包裹：模板里 f.state.filter / f.filtered 直接是解包后的值
  // （普通对象包 ref/computed 时，模板不会对嵌套 ref 自动解包，会静默拿到 Ref 而非值）。
  const state = reactive(
    readFilter(new URLSearchParams(route.query as Record<string, string>), catalog),
  );

  // 同步自 URL（前进/后退、分享链接）
  watch(
    () => route.query,
    (q) => {
      Object.assign(state, readFilter(new URLSearchParams(q as Record<string, string>), catalog));
    },
    { deep: true },
  );

  function persist() {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(route.query)) if (typeof v === 'string') q[k] = v;
    Object.assign(q, writeFilter(state.filter, state.sorts));
    router.replace({ path: route.path, query: q }).catch(() => {});
  }

  const filtered = computed(() => applyMultiSort(applyFilter(products, state.filter), state.sorts));
  const total = computed(() => products.length);
  const active = computed(() => isFiltered(state.filter));

  function toggle(dim: string, id: string) {
    state.filter = toggleValue(state.filter, dim, id);
    persist();
  }
  function clearDim(dim: string) {
    state.filter = { ...state.filter, [dim]: [] };
    persist();
  }
  function clearAll() {
    Object.assign(state, { filter: emptyFilter(), sorts: [] });
    persist();
  }
  function setSorts(s: SortKey[]) {
    state.sorts = s;
    persist();
  }

  /** 某维度的分面：计数按「其它维度已生效」算，自身维度不影响（经典分面）。 */
  function facetsFor(dim: string): FacetItem[] {
    return facetOf(products, dim, applyExcept(products, state.filter, dim), brandLabels);
  }

  return reactive({ state, filtered, total, active, toggle, clearDim, clearAll, setSorts, facetsFor });
}
