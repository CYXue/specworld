<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { Product } from '../types';
import { seriesOf, seriesLabel } from '../lib/catalog';
import { useCompare } from '../lib/useCompare';
import { hexToRgba, screenBox } from '../lib/deviceVisual';
import StatusBadge from './StatusBadge.vue';
import PriceTag from './PriceTag.vue';

const props = defineProps<{ product: Product; vendorName?: string; vendorColor?: string }>();
const { t } = useI18n();
const { has, toggle } = useCompare();

const subline = computed(() =>
  [props.vendorName ?? props.product.brand, props.product.line, seriesLabel(seriesOf(props.product))]
    .filter(Boolean)
    .join(' · '),
);

const checked = computed(() => has(props.product.id));

// 左侧小视觉区：与卡片同一套几何（品牌色 + 屏幕比例），列表行也有识别锚点
const chipBg = computed(() => hexToRgba(props.vendorColor, 0.13));
const screen = computed(() => ({
  ...screenBox(props.product, 20),
  background: hexToRgba(props.vendorColor, 0.5),
  borderColor: hexToRgba(props.vendorColor, 0.9),
}));
</script>

<template>
  <article class="card card-hover flex flex-wrap items-center gap-3 p-3" :class="checked ? 'border-accent/60' : ''">
    <div class="flex h-9 w-9 flex-none items-center justify-center rounded-md" :style="{ background: chipBg }">
      <div class="rounded-[3px] border" :style="screen" aria-hidden="true" />
    </div>
    <RouterLink :to="`/product/${product.id}`" class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="truncate text-[15px] font-semibold text-fg hover:text-link">{{ product.name }}</span>
        <StatusBadge :status="product.status" />
      </div>
      <p class="truncate text-[13px] text-dim">{{ subline }}</p>
    </RouterLink>
    <PriceTag :product="product" size="md" class="shrink-0" />
    <RouterLink :to="`/product/${product.id}`" class="btn btn-subtle shrink-0 px-3 text-sm">{{ t('common.detail') }}</RouterLink>
    <!-- 与卡片视图同一套加入交互（按钮即选中态）—— 原来这里是复选框，
         两个视图两种机制，切换视图后用户要找的入口不见了 -->
    <button
      type="button"
      class="btn shrink-0 px-3 text-sm"
      :class="checked ? 'btn-subtle' : 'btn-ghost'"
      :aria-pressed="checked"
      @click="toggle(product.id)"
    >
      {{ checked ? '✓ ' + t('compare.added') : t('compare.add') }}
    </button>
  </article>
</template>
