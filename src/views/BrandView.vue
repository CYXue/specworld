<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { t } from '../i18n';
import { useDataset, useDerived } from '../lib/useDataset';
import LoadingState from '../components/LoadingState.vue';
import LibraryInner from '../components/LibraryInner.vue';

// 品牌页 = 该品牌内部的筛选 / 列表 / 加入对比。
// 直接复用 LibraryInner（机型库主体），品牌维度天然只有一个取值，筛选器里它会出现但无害；
// 这样品牌页与机型库永远共用同一套 facets 口径（同一个问题两个答案就是 bug）。
const route = useRoute();
const { ds, err } = useDataset();
const derived = useDerived();

const vendor = computed(() => ds.value?.vendors.find((v) => v.id === String(route.params.brand)));
const products = computed(() => derived.value?.byBrand(String(route.params.brand)) ?? []);
const brandLabels = computed(() => {
  const m = new Map<string, string>();
  if (vendor.value) m.set(vendor.value.id, vendor.value.name);
  return m;
});
</script>

<template>
  <div class="page-shell py-4">
    <div v-if="err" class="card p-6 text-center text-danger">{{ t('home.loadFailed', { err }) }}</div>
    <LoadingState v-else-if="!ds" :label="t('common.loading')" />

    <div v-else-if="!vendor" class="card p-12 text-center">
      <p class="font-semibold text-fg">{{ t('brand.notFound') }}</p>
      <RouterLink to="/compare" class="btn btn-ghost mt-3">{{ t('brand.backToPlaza') }}</RouterLink>
    </div>

    <template v-else>
      <header class="mb-4">
        <p class="kicker">{{ vendor.name }}</p>
        <h1 class="mt-1 text-2xl font-bold tracking-tight text-fg">{{ vendor.nameZh || vendor.name }}</h1>
        <p class="mt-1 text-sm text-dim">
          {{ t('common.models', { n: products.length }) }}
        </p>
        <p class="mt-2 text-sm text-dim">
          {{ t('brand.crossBrandBefore') }}
          <RouterLink to="/compare" class="text-link hover:underline">{{ t('brand.crossBrandLink') }}</RouterLink>
          {{ t('brand.crossBrandAfter', { n: ds.products.length }) }}
        </p>
      </header>

      <LibraryInner :products="products" :brand-labels="brandLabels" />
    </template>
  </div>
</template>
