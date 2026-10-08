<script setup lang="ts">
import { computed } from 'vue';
import type { Product } from '../types';
import { specGroups } from '../lib/fields';
import PxIcon from './PxIcon.vue';

// 详情页的完整参数表。缺失显示「—」（页面顶部已声明对应项官方未公布）。
const props = defineProps<{ product: Product }>();
const groups = computed(() => specGroups(props.product));
</script>

<template>
  <div class="space-y-5">
    <div v-for="g in groups" :key="g.title">
      <h3 class="pixel-heading mb-2 flex items-center gap-1 text-[12px] leading-[1.5]">
        <PxIcon name="dot" :size="8" />
        {{ g.title }}
      </h3>
      <!--
        参数表：像素风的表头用「深色标题条 + 硬投影」，行间用 2px 硬线分隔。
        原版行间是 1px 半透明白 —— 1px 在高密度像素界面里既不硬也不显。
      -->
      <div class="pixel-row-flat">
        <div
          v-for="(r, i) in g.rows"
          :key="r.label"
          class="grid grid-cols-[7rem_1fr] items-baseline gap-2 px-3 py-1 text-[12px] leading-[1.5]"
          :style="{
            background: i % 2 === 1 ? 'rgb(0 0 0 / 0.18)' : 'transparent',
            borderTop: i === 0 ? 'none' : '2px solid var(--color-ink)',
          }"
        >
          <span style="color: var(--color-parchment-dim)">{{ r.label }}</span>
          <span
            :style="{
              color: r.value === '—' ? 'var(--color-ink-soft)' : 'var(--color-parchment-lit)',
            }"
            >{{ r.value }}</span
          >
        </div>
      </div>
    </div>
  </div>
</template>
