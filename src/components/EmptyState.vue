<script setup lang="ts">
defineProps<{ title: string; hint?: string }>();
</script>

<template>
  <div class="card flex flex-col items-center gap-2 px-6 py-12 text-center">
    <div class="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-faint">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" stroke-linecap="round" />
      </svg>
    </div>
    <p class="font-semibold text-fg">{{ title }}</p>
    <p v-if="hint" class="max-w-sm text-sm text-dim">{{ hint }}</p>
    <slot />
  </div>
</template>
