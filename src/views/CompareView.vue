<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDataset } from '../lib/useDataset';
import LoadingState from '../components/LoadingState.vue';
import LibraryInner from '../components/LibraryInner.vue';

const { t } = useI18n();
const { ds, err } = useDataset();

// 品牌分面/机型副标题用的展示名映射（Vendor.name 即官方名）。
const brandLabels = computed(() => {
  const m = new Map<string, string>();
  for (const v of ds.value?.vendors ?? []) m.set(v.id, v.name);
  return m;
});
</script>

<template>
  <div class="page-shell py-4">
    <div v-if="err" class="card p-6 text-center text-danger">{{ t('home.loadFailed', { err }) }}</div>
    <LoadingState v-else-if="!ds" variant="cards" />
    <!-- 数据就绪后才挂载 LibraryInner：useLibraryFilters 在挂载时一次性构建分面目录，
         若在 products 为空时初始化，分面会是空的且不会随加载更新。 -->
    <LibraryInner v-else :products="ds.products" :brand-labels="brandLabels" />
  </div>
</template>
