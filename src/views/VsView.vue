<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import { RouterLink } from 'vue-router';
import type { Product } from '../types';
import { useDataset } from '../lib/useDataset';
import { useCompare } from '../lib/useCompare';
import CompareTable from '../components/CompareTable.vue';
import CompareDock from '../components/CompareDock.vue';
import EmptyState from '../components/EmptyState.vue';
import LoadingState from '../components/LoadingState.vue';

const { ds, err } = useDataset();
const { ids } = useCompare();

const products = computed<Product[]>(() => {
  const d = ds.value;
  if (!d) return [];
  const byId = new Map(d.products.map((p) => [p.id, p]));
  return ids.value.map((id) => byId.get(id)).filter((p): p is Product => p != null);
});
</script>

<template>
  <div class="page-shell py-6">
    <div v-if="err" class="card p-6 text-center text-danger">{{ t('home.loadFailed', { err }) }}</div>
    <LoadingState v-else-if="!ds" variant="sheet" />

    <EmptyState
      v-else-if="!products.length"
      :title="t('compare.panelEmpty1')"
      :hint="t('compare.panelEmpty2')"
    >
      <RouterLink to="/compare" class="btn btn-primary mt-3">{{ t('home.browseAll') }}</RouterLink>
    </EmptyState>

    <template v-else>
      <h1 class="mb-1 text-2xl font-bold tracking-tight text-fg">
        {{ t('compare.matrixTitle', { n: products.length }) }}
      </h1>
      <p class="mb-4 text-sm text-dim">{{ t('compare.noteNoVerdict') }}</p>
      <CompareTable :products="products" />
    </template>

    <CompareDock :products="ds?.products ?? []" />
  </div>
</template>
