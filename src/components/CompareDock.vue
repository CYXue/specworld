<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import type { Product } from '../types';
import { useCompare } from '../lib/useCompare';

const props = defineProps<{ products: Product[] }>();
const { ids, remove, clear, max } = useCompare();
const { t } = useI18n();
const route = useRoute();

/** 在 /vs（对比结果页）隐藏托盘——托盘的终点就是当前页，「查看对比」在此处毫无意义 */
const onVsPage = computed(() => route.path === '/vs');

const selected = computed(() => props.products.filter((p) => ids.value.includes(p.id)));
</script>

<template>
  <div
    v-if="selected.length && !onVsPage"
    class="fixed inset-x-0 bottom-0 z-40 border-t border-border-strong bg-surface/95 backdrop-blur"
  >
    <div class="page-shell flex items-center gap-3 py-3">
      <div class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        <span class="shrink-0 text-sm font-semibold text-dim">{{ t('filter.picked', { n: selected.length }) }}</span>
        <RouterLink
          v-for="p in selected"
          :key="p.id"
          :to="`/product/${p.id}`"
          class="badge shrink-0 border border-border bg-surface-2 text-fg hover:border-accent"
        >
          {{ p.name }}
          <button
            type="button"
            class="tag-remove"
            :aria-label="t('compare.removeAria', { name: p.name })"
            @click.prevent="remove(p.id)"
          >
            ×
          </button>
        </RouterLink>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button type="button" class="btn btn-ghost px-3 text-sm" @click="clear">
          {{ t('filter.clear') }}
        </button>
        <RouterLink to="/vs" class="btn btn-primary px-4 text-sm">
          {{ t('compare.goCompare', { n: selected.length }) }}
        </RouterLink>
      </div>
    </div>
    <p v-if="selected.length === 1" class="page-shell pb-2 text-xs text-dim">
      {{ t('compare.hintOne') }}
    </p>
    <p v-if="selected.length >= max" class="page-shell pb-2 text-xs text-faint">
      已达对比上限（{{ max }} 台）。
    </p>
  </div>
</template>
