<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';

/**
 * 缺失值徽章（全站唯一实现，评审 2026-10-17 共性问题 2）：
 * 三种「没有值」语义三种呈现，不许再各页面手写「—」「⚠」或整句灰字。
 *
 * - unpublished（官网未公布）：灰色**虚线**胶囊 —— 官网真没有，诚实降级；
 *   title/hover 展示说明（详情页的官网原文抽屉承载「看原文」）。
 * - uncollected（本站未采集）：实底灰胶囊 —— 本站没抓到，可以改进。
 * - not_applicable（品类无此项）：**不渲染该行**（由 fields.ts 的 state='none'
 *   在调用方过滤），本组件不接受该值——徽章只表达「说了但没值」的两种。
 *
 * 视觉纪律：虚线边框是缺失徽章的专属视觉，其他组件不得使用虚线。
 */
const props = defineProps<{
  state: 'unpublished' | 'uncollected';
  /** 补充说明（如来源粒度、采集说明 note），进 title 提示 */
  note?: string;
}>();

const label = computed(() =>
  props.state === 'unpublished' ? t('common.unpublished') : t('common.uncollected'),
);
const tip = computed(() => {
  const base =
    props.state === 'unpublished' ? t('common.unpublishedTip') : t('common.uncollectedTip');
  return props.note ? `${base}\n${props.note}` : base;
});
</script>

<template>
  <span
    class="badge-missing"
    :class="{ 'is-uncollected': state === 'uncollected' }"
    :title="tip"
  >{{ label }}</span>
</template>
