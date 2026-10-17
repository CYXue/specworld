<script setup lang="ts">
defineProps<{ title: string; hint?: string }>();
</script>

<template>
  <!-- 空状态（纸上数据库）：mono 破折号字形 + 发丝线方框 —— 与缺失值徽章同一视觉语言
       （「这里没有数据」全站都用墨色发丝线表达，不新造一种图形）。 -->
  <div class="card flex flex-col items-center gap-2 px-6 py-12 text-center">
    <div
      class="grid h-12 w-12 place-items-center rounded-[4px] border border-dashed border-border-strong font-mono text-lg text-faint"
      aria-hidden="true"
    >—</div>
    <p class="font-semibold text-fg">{{ title }}</p>
    <p v-if="hint" class="max-w-sm text-sm text-dim">{{ hint }}</p>
    <slot />
  </div>
</template>
