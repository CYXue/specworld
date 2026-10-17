import { computed, ref, watch, type Ref } from 'vue';

/**
 * 列表分批渲染（2026-10-16）：机型库/品牌页/榜单/搜索/时间轴都是
 * 「筛选或排序后的全量列表」直出，913 台一次性全量渲染会把低端手机
 * （Toy 平台主力）的 DOM 压垮。
 *
 * 只切「渲染多少行」，不动上层语义 —— URL 仍然只描述筛选/排序/勾选，
 * 分页不是可分享状态，不进 URL。列表引用变化（筛选/排序/数据刷新）时回到首批。
 *
 * 注意 computed 的缓存语义：依赖不变时返回同一引用，所以 watch(source)
 * 只在列表真的重算时触发，不会空转重置。
 */
export function useChunkedList<T>(source: Ref<T[]>, pageSize = 80) {
  const shown = ref(pageSize);
  const shownList = computed(() => source.value.slice(0, shown.value));
  const total = computed(() => source.value.length);
  const hasMore = computed(() => source.value.length > shown.value);
  watch(source, () => {
    shown.value = pageSize;
  });
  function showMore() {
    shown.value = Math.min(shown.value + pageSize, source.value.length);
  }
  return { shownList, total, hasMore, showMore };
}
