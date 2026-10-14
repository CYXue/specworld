<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { Product } from '../types';
import type { CategoryDef } from '../lib/catalog';
import { basePriceCny, categoryLabel, fmtPriceCny } from '../lib/catalog';
import PxIcon from './PxIcon.vue';
import SpriteImg from './SpriteImg.vue';
import type { IconName } from './PxIcon.vue';

/**
 * 「最新 / 最贵 / 最便宜」三榜，按子品类各取一台。
 *
 * 数据诚信：某品类在本数据集里一台都没有时，**如实显示「暂无数据」**，
 * 不隐藏该品类、也不拿别的品类的机器凑数。品类位先留着，
 * 将来接了平板/笔记本数据源这里自动填上，页面不用改。
 */
defineProps<{
  spots: Array<{
    category: CategoryDef;
    latest: Product | null;
    priciest: Product | null;
    cheapest: Product | null;
  }>;
  vendors: Map<string, { id: string; nameZh: string; accentColor: string }>;
}>();

const { t } = useI18n();
// 语言只从全局来（i18n/index.ts 纪律）：categoryLabel 内部走 currentLocale()，
// 传 locale.value 是第二语言真源且签名不符（多传参静默被忽略）。
const catLabel = (c: CategoryDef) => categoryLabel(c.id);

const COLS: Array<{ key: 'latest' | 'priciest' | 'cheapest'; labelKey: string; icon: IconName }> = [
  { key: 'latest', labelKey: 'spotlight.latest', icon: 'clock' },
  { key: 'priciest', labelKey: 'spotlight.priciest', icon: 'trophy' },
  { key: 'cheapest', labelKey: 'spotlight.cheapest', icon: 'dot' },
];
</script>

<template>
  <div class="space-y-4">
    <div v-for="s in spots" :key="s.category.id">
      <h3 class="pixel-heading mb-2 flex items-center gap-2 text-[12px] leading-[1.5]">
        <PxIcon name="dot" :size="8" />
        {{ catLabel(s.category) }}
        <span class="pixel-rule flex-1" />
      </h3>

      <!-- 该品类在册为 0：如实说没有，不用别的品类顶替 -->
      <p
        v-if="!s.latest"
        class="pixel-note px-3 py-2 text-[12px] leading-[1.5]"
        style="color: var(--color-ink-soft)"
      >
        {{ $t('spotlight.empty', { category: catLabel(s.category) }) }}
      </p>

      <div v-else class="grid gap-2 sm:grid-cols-3">
        <div
          v-for="c in COLS"
          :key="c.key"
          class="pixel-row flex min-w-0 items-center gap-2 px-2 py-1.5"
        >
          <span
            class="pixel-chip flex flex-none items-center gap-1 px-1.5 py-0.5 text-[12px] leading-[1.5]"
            style="color: var(--color-gold)"
          >
        <PxIcon :name="c.icon" :size="10" />
        {{ $t(c.labelKey) }}
      </span>

          <template v-if="s[c.key]">
            <SpriteImg :id="s[c.key]!.id" class="h-9 w-auto flex-none" />
            <RouterLink :to="`/product/${s[c.key]!.id}`" class="min-w-0 flex-1">
              <p
                class="truncate text-[12px] leading-[1.5]"
                :style="{
                  color: vendors.get(s[c.key]!.brand)?.accentColor ?? 'var(--color-parchment-lit)',
                }"
              >
                {{ s[c.key]!.name }}
              </p>
              <p
                class="truncate text-[12px] leading-[1.5]"
                style="color: var(--color-parchment-dim)"
              >
                <!-- 「最新」看发布日；「最贵/最便宜」看官方起售价（多容量档取最低档） -->
                <template v-if="c.key === 'latest'">
                  {{ $t('spotlight.released', { date: s[c.key]!.releaseDate }) }}
                </template>
                <template v-else>
                  {{ $t('spotlight.fromPrice', { price: fmtPriceCny(basePriceCny(s[c.key]!)) }) }}
                </template>
              </p>
            </RouterLink>
          </template>

          <!-- 有机器但官方未公布中国区售价：不能当 0 元处理 -->
          <p v-else class="text-[12px] leading-[1.5]" style="color: var(--color-ink-soft)">
            {{ $t('spotlight.priceUnpublished') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
