<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { continentOf } from '../types';
import { useDataset, useDerived } from '../lib/useDataset';
import { statusLabelOf } from '../lib/catalog';
import { abilityRows } from '../lib/specs';
import AbilityBars from '../components/AbilityBars.vue';
import DataFeedback from '../components/DataFeedback.vue';
import PxIcon from '../components/PxIcon.vue';
import SectionFrame from '../components/SectionFrame.vue';
import SpecTable from '../components/SpecTable.vue';
import SpriteImg from '../components/SpriteImg.vue';
import VendorRoof from '../components/VendorRoof.vue';
import Sky from '../components/Sky.vue';

const route = useRoute();
const { err } = useDataset();
const derived = useDerived();

const product = computed(() => derived.value?.byId(String(route.params.id)));
const vendor = computed(() =>
  product.value ? derived.value?.vendors.get(product.value.brand) : undefined,
);
const rows = computed(() =>
  product.value && derived.value ? abilityRows(product.value, derived.value.bounds) : [],
);
const accent = computed(() => vendor.value?.accentColor ?? 'var(--color-gold)');
// 状态标签走 catalog.ts 的单一映射（硬编码审计 A5 治理：不再各写三元链）
const statusLabel = computed(() => statusLabelOf(product.value?.status));
</script>

<template>
  <div>
    <div
      v-if="err"
      class="page-shell py-10 text-center text-[24px]"
      style="color: var(--color-east)"
    >
      加载失败：{{ err }}
    </div>

    <div
      v-else-if="!product"
      class="page-shell py-16 text-center text-[24px] leading-[1.5]"
      style="color: var(--color-parchment-dim)"
    >
      未找到该机型。
      <RouterLink to="/" class="pixel-button ml-2 px-3 py-1 text-[12px] text-[var(--color-gold)]"
        >返回广场</RouterLink
      >
    </div>

    <template v-else>
      <!-- 详情头：窄天空带 + 精灵图 + 名牌 -->
      <section class="relative">
        <Sky height="clamp(120px, 20vh, 200px)" />
        <div class="page-shell relative">
          <VendorRoof :color="accent" :continent="continentOf(vendor)" />
          <div class="flex flex-col items-center gap-4 py-6 sm:flex-row sm:items-end sm:gap-6">
            <SpriteImg :id="product.id" class="h-32 w-auto shrink-0 sm:h-40" />
            <div class="min-w-0 flex-1 text-center sm:text-left">
              <h1 class="pixel-outline font-pixel text-[36px] leading-[1.4]">{{ product.name }}</h1>
              <p
                class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-[1.5] sm:justify-start"
              >
                <RouterLink
                  :to="`/brand/${product.brand}`"
                  class="pixel-chip px-2 py-0.5"
                  :style="{ color: accent }"
                >
                  {{ vendor?.nameZh }}
                </RouterLink>
                <span class="pixel-chip px-2 py-0.5" style="color: var(--color-parchment-dim)">
                  {{ product.line }}
                </span>
                <span class="pixel-chip px-2 py-0.5" style="color: var(--color-parchment-dim)">
                  {{ product.releaseDate }}
                </span>
                <span class="pixel-chip px-2 py-0.5" :style="{ color: accent }">
                  {{ statusLabel }}
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <div class="page-shell grid gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionFrame title="完整参数" :hud="accent">
          <SpecTable :product="product" />
        </SectionFrame>

        <div class="space-y-4">
          <SectionFrame title="能力横条" :hud="accent">
            <p
              class="pixel-note mb-3 px-2.5 py-2 text-[12px] leading-[1.5] text-[var(--color-ink-soft)]"
            >
              条长为该字段在本站数据集内的相对位置，非绝对评分；缺失项显示「未公布」。
            </p>
            <AbilityBars :rows="rows" :hud="accent" />
          </SectionFrame>
          <RouterLink
            :to="{ path: '/compare', query: { p: product.id } }"
            class="pixel-button flex items-center justify-center gap-2 px-3 py-2 text-[12px] leading-[1.5]"
          >
            <PxIcon name="compare" :size="12" />
            在对比页查看这台
          </RouterLink>
          <DataFeedback :product="product" />
        </div>
      </div>
    </template>
  </div>
</template>
