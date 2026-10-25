<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import { RouterLink } from 'vue-router';
import type { Product } from '../types';
import { seriesOf, seriesLabel } from '../lib/catalog';
import { useCompare } from '../lib/useCompare';
import { hexToRgba, screenBox } from '../lib/deviceVisual';
import StatusBadge from './StatusBadge.vue';
import PriceTag from './PriceTag.vue';

const props = defineProps<{ product: Product; vendorName?: string; vendorColor?: string }>();
const { has, toggle } = useCompare();

const subline = computed(() =>
  [props.vendorName ?? props.product.brand, props.product.line, seriesLabel(seriesOf(props.product))]
    .filter(Boolean)
    .join(' · '),
);

const checked = computed(() => has(props.product.id));

// 左侧小视觉区：与卡片同一套几何（品牌色 + 屏幕比例），列表行也有识别锚点
const chipBg = computed(() => hexToRgba(props.vendorColor, 0.14));
const screen = computed(() => ({
  ...screenBox(props.product, 20),
  background: hexToRgba(props.vendorColor, 0.55),
  borderColor: hexToRgba(props.vendorColor, 0.95),
}));
</script>

<template>
  <article class="card card-hover flex flex-wrap items-center gap-3 px-3.5 py-2.5" :class="checked ? 'border-ink' : ''">
    <div class="flex h-9 w-9 flex-none items-center justify-center rounded-[4px]" :style="{ background: chipBg }">
      <div class="rounded-[2px] border" :style="screen" aria-hidden="true" />
    </div>
    <RouterLink :to="`/product/${product.id}`" class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="truncate text-[15px] font-semibold text-fg hover:text-link">{{ product.name }}</span>
        <StatusBadge :status="product.status" />
      </div>
      <p class="truncate text-[13px] text-dim">{{ subline }}</p>
    </RouterLink>
    <PriceTag :product="product" size="md" class="shrink-0" />
    <!-- 加入对比：墨块反白即选中态，与卡片视图同一套机制 -->
    <button
      type="button"
      class="btn shrink-0 px-3 text-sm"
      :class="checked ? 'btn-primary' : 'btn-ghost'"
      :aria-pressed="checked"
      @click="toggle(product.id)"
    >
      {{ checked ? '✓ ' + t('compare.added') : t('compare.add') }}
    </button>
  </article>
</template>
