<script setup lang="ts">
import type { AbilityRow } from '../lib/specs';

// 四条能力横条。条长 = 该字段在本数据集内的相对位置（0..1），不是虚构绝对分。
// 无数据显示空轨 + 「未公布」。
defineProps<{ rows: AbilityRow[]; hud?: string }>();
</script>

<template>
  <div class="space-y-1">
    <div
      v-for="row in rows"
      :key="row.key"
      class="grid grid-cols-[3.5rem_1fr_auto] items-center gap-1.5"
    >
      <span class="text-[12px] leading-none" style="color: var(--color-parchment-dim)">{{
        row.label
      }}</span>
      <span class="pixel-track block h-3 w-full">
        <!--
          条高 10px，填充用「方块堆叠」而不是连续色块：
          Minecraft 的物品槽是 9×9 网格，进度条同理用格子更贴。
          repeating-linear-gradient 打 4px 一格的硬边棋盘（亮/暗两档），
          不用 opacity 渐变 —— 半透明格在暗轨上会糊成灰。
        -->
        <span
          v-if="row.ratio != null"
          class="block h-full"
          :style="{
            width: `calc(${Math.max(8, row.ratio * 100)}% - 4px)`,
            marginLeft: '2px',
            backgroundImage: `repeating-linear-gradient(90deg, ${hud ?? 'var(--color-gold)'} 0 4px, color-mix(in srgb, ${hud ?? 'var(--color-gold)'} 55%, #000) 4px 8px)`,
          }"
        />
      </span>
      <span
        class="min-w-[3.5rem] text-right text-[12px] leading-none"
        :style="{
          color: row.ratio != null ? 'var(--color-parchment-lit)' : 'var(--color-ink-soft)',
        }"
        >{{ row.ratio != null ? row.display : '未公布' }}</span
      >
    </div>
  </div>
</template>
