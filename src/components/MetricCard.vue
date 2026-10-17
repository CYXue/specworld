<script setup lang="ts">
defineProps<{ value?: string; label: string; sub?: string }>();
</script>

<template>
  <div class="card flex flex-col gap-1 p-4">
    <!-- value 插槽：价格等「有值/缺失」双态字段走 PriceTag（共用展示规则），其余用纯文本。
         数据值一律 mono（纸上数据库：数字是主角）。 -->
    <div class="num text-[20px] font-bold leading-tight text-fg">
      <slot name="value">{{ value }}</slot>
    </div>
    <div class="text-xs font-medium text-dim">{{ label }}</div>
    <div v-if="sub" class="text-[11px] text-faint">{{ sub }}</div>
  </div>
</template>
