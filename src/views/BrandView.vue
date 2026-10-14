<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { continentOf } from '../types';
import { useDataset, useDerived } from '../lib/useDataset';
import {
  DIMENSION_KEYS,
  applyExcept,
  applyFilter,
  applySort,
  buildCatalog,
  emptyFilter,
  facetOf,
  readFilter,
  toggleValue,
  writeFilter,
} from '../lib/facets';
import type { DimKey, FacetItem, FilterState, SortKey } from '../lib/facets';
import BrandGroup from '../components/BrandGroup.vue';
import FilterBar from '../components/FilterBar.vue';
import PxIcon from '../components/PxIcon.vue';
import Sky from '../components/Sky.vue';
import Ground from '../components/Ground.vue';

/**
 * 品牌页：某品牌内部的品类/系列/变体/芯片/内存/年份筛选。
 *
 * 与「机型库对比页」共用 `FilterBar` 与 `facets.ts` 口径 —— 两处筛选必须是同一套逻辑，
 * 否则「苹果折叠屏」在品牌页和在机型库页会给出不同答案（同一个问题两个答案就是 bug）。
 *
 * 品牌维度在这页**恒定**（只有一个品牌），故不下发给 FilterBar。
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { ds } = useDataset();
const derived = useDerived();

const vendor = computed(() => ds.value?.vendors.find((v) => v.id === String(route.params.brand)));
const products = computed(() => derived.value?.byBrand(String(route.params.brand)) ?? []);
const bounds = computed(() => derived.value?.bounds);

/** 品牌页上的维度（去掉 brand —— 它已由路由确定）。 */
const DIM_KEYS = DIMENSION_KEYS.filter((d) => d !== 'brand');

function toParams(q: Record<string, unknown>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s !== '') p.set(k, s);
  }
  return p;
}

const catalog = computed(() => buildCatalog(products.value, DIM_KEYS));
const read = computed(() => readFilter(toParams(route.query), catalog.value));
const filter = computed(() => read.value.filter);
/** 轻量排序条取单级（多级排序是榜单页的事）。默认最新发布。 */
const sort = computed<SortKey>(() => read.value.sorts[0] ?? 'release');

function push(next: FilterState, nextSorts: SortKey[] = []) {
  router.replace({
    path: `/brand/${route.params.brand}`,
    query: writeFilter(next, nextSorts),
  });
}

/** 纯筛选结果，默认按发布日期倒序陈列；可经结果区顶部轻量排序条单级调整。 */
const shown = computed(() => applySort(applyFilter(products.value, filter.value), sort.value));

/** 结果区顶部轻量排序条（辅助，非主打）。 */
const SORTS_LITE: Array<{ id: SortKey; labelKey: string }> = [
  { id: 'release', labelKey: 'sort.release' },
  { id: 'price-asc', labelKey: 'sort.priceAsc' },
  { id: 'price-desc', labelKey: 'sort.priceDesc' },
  { id: 'battery-desc', labelKey: 'ability.battery' },
  { id: 'ppi-desc', labelKey: 'ability.display' },
  { id: 'weight-asc', labelKey: 'ability.light' },
  { id: 'camera-desc', labelKey: 'ability.camera' },
];

function onSort(s: SortKey) {
  push(filter.value, [s]);
}

const facets = computed<Record<string, FacetItem[]>>(() => {
  const out: Record<string, FacetItem[]> = {};
  for (const d of DIM_KEYS) {
    out[d] = facetOf(products.value, d, applyExcept(products.value, filter.value, d));
  }
  return out;
});
</script>

<template>
  <div>
    <div
      v-if="!vendor"
      class="page-shell py-16 text-center text-[24px] leading-[1.5]"
      style="color: var(--color-parchment-dim)"
    >
      {{ t('brand.notFound') }}
      <RouterLink to="/" class="pixel-button ml-2 px-3 py-1 text-[12px] text-[var(--color-gold)]"
        >{{ t('brand.backToPlaza') }}</RouterLink
      >
    </div>

    <template v-else>
      <section class="relative">
        <Sky height="clamp(120px, 20vh, 200px)" />
        <div class="page-shell relative py-6">
          <h1
            class="pixel-outline font-pixel text-[36px] leading-[1.4] text-[var(--color-parchment-lit)]"
          >
            {{ vendor.nameZh }}
          </h1>
          <p
            class="mt-1 flex items-center gap-2 text-[12px] leading-[1.5]"
            :style="{ color: vendor.accentColor }"
          >
            {{ vendor.name }} · {{ t('common.models', { n: products.length }) }}
          </p>
        </div>
        <Ground />
      </section>

      <div class="page-shell py-6">
        <!-- 品类排第一位（顺序由 facets.ts 的 DIMENSION_KEYS 决定） -->
        <FilterBar
          class="mb-5"
          :filter="filter"
          :facets="facets"
          :total-count="products.length"
          :shown-count="shown.length"
          @toggle="(dim: DimKey, id: string) => push(toggleValue(filter, dim, id), [sort])"
          @clear-dim="(dim: DimKey) => push({ ...filter, [dim]: [] }, [sort])"
          @reset="() => push(emptyFilter(), [sort])"
        />

        <!-- 结果区顶部轻量排序条（京东式，辅助非主打） -->
        <div v-if="shown.length" class="mb-4 flex flex-wrap items-center gap-1.5">
          <span class="pixel-heading flex items-center gap-1 text-[12px] leading-[1.5]">
            <PxIcon name="sort" :size="12" />
            {{ t('sort.label') }}
          </span>
          <button
            v-for="s in SORTS_LITE"
            :key="s.id"
            class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
            :aria-pressed="sort === s.id"
            @click="onSort(s.id)"
          >
            {{ t(s.labelKey) }}
          </button>
        </div>

        <BrandGroup
          v-if="bounds && shown.length"
          :vendor="vendor"
          :continent="continentOf(vendor)"
          :products="shown"
          :bounds="bounds"
        />
        <p
          v-else
          class="pixel-note px-4 py-8 text-center text-[12px] leading-[1.5]"
          style="color: var(--color-parchment-dim)"
        >
          {{ t('brand.empty') }}
        </p>

        <p
          v-if="shown.length"
          class="mt-4 text-[12px] leading-[1.5]"
          style="color: var(--color-ink-soft)"
        >
          {{ t('brand.crossBrandBefore') }}
          <RouterLink to="/compare" style="color: var(--color-gold)">{{
            t('brand.crossBrandLink')
          }}</RouterLink>
          {{ t('brand.crossBrandAfter', { n: ds?.products.length ?? 0 }) }}
        </p>
      </div>
    </template>
  </div>
</template>
