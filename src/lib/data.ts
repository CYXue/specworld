import { i18n } from '../i18n';
import type { Dataset, Product, Vendor } from '../types';
import { toPhoneViews } from './adapt';
import { asset } from './assets';

const t = (key: string) => i18n.global.t(key);

let cache: Promise<Dataset> | null = null;

export function loadDataset(): Promise<Dataset> {
  if (cache) return cache;
  cache = fetch(asset('data/products.json'))
    .then((r) => {
      if (!r.ok) throw new Error(`${t('common.loadFailedRaw')} HTTP ${r.status}`);
      return r.json() as Promise<Dataset>;
    })
    .then((d) => ({
      ...d,
      // v2 specs 容器 → 手机嵌套视图（见 adapt.ts）。展开只在这里做一次，
      // 下游组件/facets 拿到的仍是有 display/body 的对象。
      products: toPhoneViews(d.products ?? []),
    }))
    .catch((e) => {
      cache = null; // 允许重试
      throw e;
    });
  return cache;
}

// ── 同步派生（数据加载后调用） ──

export function vendorMap(ds: Dataset): Map<string, Vendor> {
  return new Map(ds.vendors.map((v) => [v.id, v]));
}

export function productById(ds: Dataset, id: string): Product | undefined {
  return ds.products.find((p) => p.id === id || p.slug === id);
}

export function productsByBrand(ds: Dataset, brand: string): Product[] {
  return ds.products.filter((p) => p.brand === brand);
}

export function sortedByRelease(ds: Dataset): Product[] {
  return [...ds.products].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
}
