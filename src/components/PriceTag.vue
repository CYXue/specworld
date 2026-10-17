<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Product } from '../types';
import { basePriceCny, fmtPriceCny } from '../lib/catalog';
import MissingBadge from './MissingBadge.vue';

/**
 * 价格展示的**唯一**共用组件（2026-10-16 三轮收敛）：
 *
 * - 有值：价格数字的字号 + 粗体 + 主文字色（不同尺寸档随场景）；
 * - 缺失（官方未公布中国区售价）：**13px 常规字重次色小字**，不继承价格数字的
 *   字号和粗细——缺失状态是辅助信息，不该和真实价格抢视觉权重。
 *   完整说明放 title 提示，不用长句挤压操作区域。
 *
 * 规则只写在这一处：设备卡、列表行、排行、详情摘要、首页全部经它渲染，
 * 避免首页改好了、其他页面各自表现。
 */
const props = defineProps<{ product: Product; size?: 'xl' | 'lg' | 'md' | 'sm' }>();
const { t } = useI18n();

const v = computed(() => basePriceCny(props.product));
const sizeClass = computed(
  () => ({ xl: 'text-2xl', lg: 'text-lg', md: 'text-[15px]', sm: 'text-sm' })[props.size ?? 'md'],
);
/** 缺失态按采集粒度分语义：specs-page = 官网真没有；粗通道 = 本站未采集（粒度未知保守取后者） */
const missingState = computed(() =>
  props.product.granularity === 'specs-page' ? 'unpublished' : 'uncollected',
);
</script>

<template>
  <span
    v-if="v != null"
    class="num font-bold text-fg"
    :class="sizeClass"
  >{{ fmtPriceCny(v) }}</span>
  <MissingBadge v-else :state="missingState" />
</template>
