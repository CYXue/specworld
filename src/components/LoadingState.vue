<script setup lang="ts">
/**
 * 加载态（纸上数据库 v4）：三种变体对应三种等待场景——
 * - spinner（默认）：通用等待，行内小加载指示；
 * - cards：列表/机型库 —— 规格卡轮廓骨架（卡片墙出现前的形状预告）；
 * - sheet：详情页 —— 规格表骨架（发丝线行 + mono 数值条占位）。
 * 骨架只做形状预告，不转圈占整屏；所有动效仅 fade，无循环装饰之外的动画。
 */
withDefaults(defineProps<{ label?: string; variant?: 'spinner' | 'cards' | 'sheet' }>(), {
  variant: 'spinner',
});

const CARD_COUNT = 8;
</script>

<template>
  <!-- 通用行内等待 -->
  <div v-if="variant === 'spinner'" class="flex items-center justify-center gap-3 py-16 text-dim">
    <span
      class="h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-accent"
      aria-hidden="true"
    />
    <span class="text-sm">{{ label ?? '加载中…' }}</span>
  </div>

  <!-- 列表骨架：规格卡轮廓（标题行 + 3 槽数据 + 底线） -->
  <div
    v-else-if="variant === 'cards'"
    class="grid gap-4"
    style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr))"
    aria-hidden="true"
  >
    <div v-for="i in CARD_COUNT" :key="i" class="card animate-fade-up flex flex-col gap-2.5 p-4" :style="{ animationDelay: `${i * 20}ms` }">
      <div class="flex items-center gap-2.5">
        <span class="h-9 w-9 flex-none rounded-[4px] bg-surface-2" />
        <span class="h-3.5 w-3/5 rounded-[3px] bg-surface-2" />
      </div>
      <span class="h-2.5 w-2/5 rounded-[3px] bg-surface-2" />
      <div class="grid grid-cols-[1fr_1fr_0.8fr] gap-1.5 border-t border-border pt-2.5">
        <span class="h-5 w-4/5 rounded-[3px] bg-surface-2" />
        <span class="h-5 w-3/5 rounded-[3px] bg-surface-2" />
        <span class="h-5 w-1/2 rounded-[3px] bg-surface-2" />
      </div>
    </div>
  </div>

  <!-- 详情骨架：指标行 + 规格表（组头 + 发丝线行） -->
  <div v-else class="space-y-6" aria-hidden="true">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div v-for="i in 6" :key="i" class="card flex flex-col gap-2 p-4">
        <span class="h-5 w-3/4 rounded-[3px] bg-surface-2" />
        <span class="h-2.5 w-1/2 rounded-[3px] bg-surface-2" />
      </div>
    </div>
    <div class="card overflow-hidden">
      <div class="border-b border-border bg-surface-2 px-4 py-2">
        <span class="block h-2.5 w-24 rounded-[3px] bg-border-strong/60" />
      </div>
      <div v-for="i in 6" :key="i" class="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
        <span class="h-2.5 rounded-[3px] bg-surface-2" :style="{ width: `${28 + ((i * 13) % 20)}%` }" />
        <span class="h-2.5 rounded-[3px] bg-surface-2" :style="{ width: `${20 + ((i * 7) % 18)}%` }" />
      </div>
    </div>
  </div>
</template>
