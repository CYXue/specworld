<script setup lang="ts">
import { computed } from 'vue';
import type { Continent, Product, Vendor } from '../types';
import type { AbilityKey, Bounds } from '../lib/specs';
import { abilityRows } from '../lib/specs';
import AbilityBars from './AbilityBars.vue';
import SpriteImg from './SpriteImg.vue';
import VendorRoof from './VendorRoof.vue';

// 一间「屋子」= 一台手机。画归画（屋顶+精灵图+呼吸），数归数（四条横条）。
const props = defineProps<{
  product: Product;
  vendor: Vendor | undefined;
  continent: Continent;
  bounds: Record<AbilityKey, Bounds | null>;
  highlight?: AbilityKey | null;
}>();

const rows = computed(() => abilityRows(props.product, props.bounds));
const accent = computed(() => props.vendor?.accentColor ?? 'var(--color-gold)');
const year = computed(() => (props.product.releaseDate || '').slice(0, 4));

// 稳定哈希错开呼吸相位
function phase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 2600) / 1000;
}
</script>

<template>
  <!--
    hover 走 .pixel-row 的「硬位移一格」，不用 translateY(-2px)：
    悬浮是连续动效的语言，像素世界的交互应该是「按下去一格」。
  -->
  <RouterLink :to="`/product/${product.id}`" class="pixel-row group block">
    <VendorRoof :color="accent" :continent="continent" />
    <div class="flex flex-col items-center gap-1.5 p-2.5">
      <SpriteImg :id="product.id" :delay="phase(product.id)" class="h-20 w-auto" />
      <div class="w-full text-center">
        <p class="truncate text-[12px] leading-[1.5] text-[var(--color-parchment-lit)]">
          {{ product.name }}
        </p>
        <p class="mt-0.5 text-[12px] leading-[1.5]" :style="{ color: accent }">
          {{ vendor?.nameZh }} · {{ year }}
        </p>
      </div>
      <AbilityBars :rows="rows" :hud="accent" />
    </div>
  </RouterLink>
</template>
