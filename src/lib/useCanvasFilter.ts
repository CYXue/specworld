/**
 * 画布页（/canvas）与地球页（/globe）共用的「筛选 → 瓦片数据」管线。
 *
 * 为什么抽这一层（2026-10-14 审计 P2-4）：两页曾各写一份约 90 行的同构代码
 * （route→filter 的 watch、CanvasDoc 映射、ppiOf、applyFilter、三个分面、
 * setFilter 的联动清空、setSort/clearAll/total/shown/dirty），逐字相同，
 * 只差 router.replace 里的 path。两份的维护后果不是「难看」而是**会分叉**：
 * 任何一边改了筛选联动规则（比如年份失效时要不要清 line），另一边静默地
 * 停在旧行为上，而两页看起来都正常。
 *
 * 分界线（别把页面特有的东西塞进来）：
 *   · 这里：与「选哪些机器」有关的全部派生 + URL 读写；
 *   · 页面自己：瓦片怎么摆（tiles/groups）、动画（自转）、高度（vh）。
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  EMPTY_FILTER,
  applyFilter,
  brandFacets,
  buildCanvasDocs,
  filterToQuery,
  isFiltered,
  lineFacets,
  parseFilter,
  yearFacets,
  type CanvasDoc,
  type CanvasFilter,
  type SortKey,
} from './canvasFilter';
import { useDataset, useDerived } from './useDataset';

/**
 * @param path 本页路由路径（'/canvas' 或 '/globe'）—— setFilter/clearAll
 *   replace URL 时用。两页唯一的不同点，故做成参数而不是复制整份代码。
 */
export function useCanvasFilter(path: string) {
  const { t } = useI18n();
  const route = useRoute();
  const router = useRouter();
  const { ds, err } = useDataset();
  const derived = useDerived();

  const filter = ref<CanvasFilter>(parseFilter(route.query as Record<string, unknown>));

  // 路由 → 筛选：用户点浏览器后退时，画布与筛选条都要跟着退回去
  watch(
    () => route.query,
    (q) => {
      filter.value = parseFilter(q as Record<string, unknown>);
    },
  );

  /** 画布只喂它关心的字段，不把整个 Product（含原始响应 provenance）传下去 */
  const docs = computed<CanvasDoc[]>(() =>
    (ds.value?.products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      nameZh: p.nameZh ?? null,
      line: p.line ?? '',
      brand: p.brand,
      brandZh: derived.value?.vendors.get(p.brand)?.nameZh ?? p.brand,
      releaseDate: p.releaseDate ?? '',
      releaseDatePrecision: p.releaseDatePrecision ?? '',
      status: p.status ?? '',
    })),
  );

  const filterable = computed(() => buildCanvasDocs(docs.value));

  const ppiOf = computed(() => {
    const by = new Map<string, number | null>();
    for (const p of ds.value?.products ?? []) by.set(p.id, p.display?.ppi ?? null);
    return (id: string) => by.get(id) ?? null;
  });

  const items = computed(() => applyFilter(filterable.value, filter.value, ppiOf.value));

  const brands = computed(() => brandFacets(filterable.value, filter.value));
  const lines = computed(() => lineFacets(filterable.value, filter.value));
  const years = computed(() => yearFacets(filterable.value, filter.value));

  const accentOf = (brand: string) =>
    derived.value?.vendors.get(brand)?.accentColor ?? 'var(--color-gold)';

  const setFilter = (patch: Partial<CanvasFilter>) => {
    const next = { ...filter.value, ...patch };
    if (patch.brand !== undefined && next.brand !== filter.value.brand) {
      const stillValid = lines.value.some((l) => l.value === next.line);
      if (!stillValid) next.line = '';
    }
    if (patch.year !== undefined || patch.q !== undefined || patch.brand !== undefined) {
      if (next.year && !years.value.some((y) => y.value === next.year)) next.year = '';
    }
    filter.value = next;
    router.replace({ path, query: filterToQuery(next) });
  };

  const setSort = (sort: SortKey) => setFilter({ sort });

  const clearAll = () => {
    filter.value = { ...EMPTY_FILTER };
    router.replace({ path, query: {} });
  };

  const total = computed(() => docs.value.length);
  const shown = computed(() => items.value.length);
  const dirty = computed(() => isFiltered(filter.value));

  return {
    filter,
    docs,
    filterable,
    items,
    brands,
    lines,
    years,
    accentOf,
    setFilter,
    setSort,
    clearAll,
    total,
    shown,
    dirty,
    /** 数据集加载错误（模板里 v-if="err" 显示加载失败；删了它错误提示会静默消失） */
    err,
    /** 供视图里拼短规格文案用（t('canvas.noSpecs') 等页面文案仍在视图层） */
    t,
  };
}
