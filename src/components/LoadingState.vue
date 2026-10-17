<script setup lang="ts">
defineProps<{ label?: string }>();
</script>

<template>
  <div class="flex items-center justify-center gap-3 py-16 text-dim">
    <span
      class="h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-accent"
      aria-hidden="true"
    />
    <span class="text-sm">{{ label ?? '加载中…' }}</span>
  </div>
</template>
