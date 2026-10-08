<script setup lang="ts">
import type { Champion } from '../lib/specs';
import type { Product } from '../types';

// 榜单的一行：某个维度的真实第一名。借鉴参考项目 ChampionRow。
defineProps<{
  champion: Champion;
  accent?: string;
  vendors: Map<string, { nameZh: string; accentColor: string }>;
}>();

function vendorOf(c: Champion, vendors: Map<string, { nameZh: string; accentColor: string }>) {
  return vendors.get(c.product.brand);
}
</script>

<template>
  <RouterLink
    :to="`/product/${champion.product.id}`"
    class="pixel-row group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2"
  >
    <span
      class="pixel-chip px-1.5 py-0.5 text-[12px] leading-[1.5]"
      :style="{ color: accent ?? 'var(--color-gold)' }"
    >
      {{ champion.label }}
    </span>
    <span class="min-w-0">
      <span
        class="block truncate text-[12px] leading-[1.5] text-[var(--color-parchment-lit)] group-hover:text-[var(--color-gold)]"
      >
        {{ champion.product.name }}
      </span>
      <span
        class="text-[12px] leading-[1.5]"
        :style="{ color: vendorOf(champion, vendors)?.accentColor ?? 'var(--color-ink-soft)' }"
      >
        {{ vendorOf(champion, vendors)?.nameZh }}
      </span>
    </span>
    <span class="text-[12px] leading-[1.5] text-[var(--color-parchment)]">{{
      champion.display
    }}</span>
  </RouterLink>
</template>
