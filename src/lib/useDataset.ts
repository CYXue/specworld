import { computed, ref } from 'vue';
import type { Dataset } from '../types';
import { loadDataset, productById, productsByBrand, sortedByRelease, vendorMap } from './data';
import { computeBounds } from './specs';

// 全站共享的单例数据源：products.json 只 fetch 一次。
const ds = ref<Dataset | null>(null);
const err = ref<string | null>(null);
let started = false;

export function useDataset() {
  if (!started) {
    started = true;
    loadDataset()
      .then((d) => (ds.value = d))
      .catch((e) => (err.value = e?.message ?? String(e)));
  }
  return { ds, err, ready: computed(() => ds.value != null) };
}

export function useDerived() {
  return computed(() => {
    const d = ds.value;
    if (!d) return null;
    return {
      vendors: vendorMap(d),
      bounds: computeBounds(d.products),
      byBrand: (b: string) => productsByBrand(d, b),
      byId: (id: string) => productById(d, id),
      byRelease: sortedByRelease(d),
    };
  });
}
