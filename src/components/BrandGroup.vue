<script setup lang="ts">
import type { BoundsByCategory } from '../lib/specs';
import type { Continent, Product, Vendor } from '../types';
import PxIcon from './PxIcon.vue';
import ProductRoom from './ProductRoom.vue';

/**
 * 一个品牌 = 一片村落：厂商色屋顶下的机型。
 *
 * `limit` 用于首页「每品牌只列最新几台」——首页是门面，不该把华为 47 台
 * 全铺开把「最新/最贵/最便宜」压在下面；品牌页传 0 表示全列。
 */
const props = defineProps<{
  vendor: Vendor;
  continent: Continent;
  products: Product[];
  bounds: BoundsByCategory;
  /** 0 = 全列；>0 = 只列前 N 台（调用方应已按发布日期降序排好） */
  limit?: number;
}>();
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h2
        class="pixel-outline font-pixel text-[24px] leading-[1.5] text-[var(--color-parchment-lit)]"
      >
        {{ vendor.nameZh }}
      </h2>
      <span class="text-[12px] leading-[1.5]" :style="{ color: vendor.accentColor }">
        {{ $t('brandGroup.count', { name: vendor.name, n: products.length }) }}
      </span>
      <RouterLink
        :to="`/brand/${vendor.id}`"
        class="pixel-button ml-auto flex items-center gap-1 px-2 py-1 text-[12px] leading-[1.5]"
        :style="{ color: vendor.accentColor }"
      >
        {{ $t('brandGroup.enter', { name: vendor.nameZh }) }}
        <PxIcon name="arrow" :size="10" />
      </RouterLink>
    </div>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(var(--room-w),1fr))] gap-3">
      <ProductRoom
        v-for="p in props.limit && props.limit > 0 ? products.slice(0, props.limit) : products"
        :key="p.id"
        :product="p"
        :vendor="vendor"
        :continent="continent"
        :bounds="bounds"
      />
    </div>
    <p
      v-if="props.limit && props.limit > 0 && products.length > props.limit"
      class="pixel-note mt-3 px-3 py-1.5 text-[12px] leading-[1.5]"
      style="color: var(--color-parchment-dim)"
    >
      {{ $t('brandGroup.moreBefore', { n: props.limit, m: products.length - props.limit }) }}
      <RouterLink :to="`/brand/${vendor.id}`" :style="{ color: vendor.accentColor }">
        {{ $t('brandGroup.morePageLink', { name: vendor.nameZh }) }}
      </RouterLink>
      {{ $t('brandGroup.moreAfter') }}
    </p>
  </div>
</template>
