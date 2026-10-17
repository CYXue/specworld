<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { Product } from '../types';
import { useDataset, useDerived } from '../lib/useDataset';
import {
  CATEGORY_ORDER,
  PRICE_BUCKETS,
  categoryLabel,
  priceLabel,
} from '../lib/catalog';
import { hexToRgba, screenBox } from '../lib/deviceVisual';
import SearchBox from '../components/SearchBox.vue';
import LoadingState from '../components/LoadingState.vue';
import PriceTag from '../components/PriceTag.vue';

const { t } = useI18n();
const { ds, err } = useDataset();
const derived = useDerived();

// 最近更新：**双 tab**（评审 2026-10-17：3 条里 2 条是「即将发布」，标题「最新发布」
// 与内容矛盾）。刚发布 = releaseDate 降序；刚收录 = firstSeenAt 降序（数据入库时间，
// 老机型补录也在这里现形）。
const RECENT_N = 3;
const recentTab = ref<'released' | 'added'>('released');
const recentReleased = computed<Product[]>(() => (derived.value?.byRelease ?? []).slice(0, RECENT_N));
const recentAdded = computed<Product[]>(() =>
  [...(ds.value?.products ?? [])]
    .sort((a, b) => String(b.firstSeenAt ?? '').localeCompare(String(a.firstSeenAt ?? '')))
    .slice(0, RECENT_N),
);
const recent = computed<Product[]>(() => (recentTab.value === 'released' ? recentReleased.value : recentAdded.value));

// 按品牌浏览：品牌来自数据集 vendors，机型数实时统计。
//
// 快速筛选入口，**全部用 facets 真实支持的离散维度参数构造，零死链**：
// - 品类 `a=<id>` —— 取几个主要品类（CATEGORY_ORDER 的真实 id）
// - 价格档 `g=<id>` —— PRICE_BUCKETS 的合法 id（首/尾档）
// - 形态 `m=foldable`（折叠屏）—— facets 支持的合法值
//
// 品类与「快捷筛选」分成两组：前者是主入口（用户一眼理解），后者属于
// 筛选维度的捷径（形态/价格），混排会让人猜不出点击后是叠加还是跳转。
// ⚠️ 不提供「轻于 200g」「3000 以内」这类**连续范围**入口：facets 只支持离散分桶，
// 硬编 `?wmax=` 会被 readFilter 的 `valid.has()` 静默丢弃，变成「点了没反应」的死链。
const FEATURED_CATEGORIES = ['phone', 'tablet', 'laptop', 'display', 'wearable', 'audio'];
const categories = computed(() =>
  CATEGORY_ORDER.filter((c) => FEATURED_CATEGORIES.includes(c.id)).map((c) => ({
    label: categoryLabel(c.id),
    to: `/compare?a=${c.id}`,
  })),
);
const quickFilters = computed(() => {
  const out: { label: string; to: string }[] = [{ label: t('home.qFoldable'), to: '/compare?m=foldable' }];
  if (PRICE_BUCKETS.length) {
    const first = PRICE_BUCKETS[0];
    const last = PRICE_BUCKETS[PRICE_BUCKETS.length - 1];
    out.push({ label: priceLabel(first.id), to: `/compare?g=${first.id}` });
    if (PRICE_BUCKETS.length > 1) out.push({ label: priceLabel(last.id), to: `/compare?g=${last.id}` });
  }
  return out;
});

function vendorNameOf(p: Product): string {
  return derived.value?.vendors.get(p.brand)?.name ?? p.brand;
}

// 发布日期的短标签：今天 →「今日发布」，否则「M月D日」。列表标题是「最新发布」，
// 每行配日期让「为什么出现在这里」自解释——标题与排序依据（releaseDate 降序）一致。
function releaseDateLabel(p: Product): string {
  const d = new Date(p.releaseDate);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return t('home.today');
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
function vendorColorOf(p: Product): string | undefined {
  return derived.value?.vendors.get(p.brand)?.accentColor;
}

// 最近更新行的小视觉锚点（与产品卡同一套几何，缩小版）
function rowChipBg(p: Product): string {
  return hexToRgba(vendorColorOf(p), 0.13);
}
function rowChipScreen(p: Product) {
  return {
    ...screenBox(p, 18),
    background: hexToRgba(vendorColorOf(p), 0.5),
    borderColor: hexToRgba(vendorColorOf(p), 0.9),
  };
}
</script>

<template>
  <div class="page-shell space-y-8 py-6">
    <!-- 错误态 -->
    <div v-if="err" class="card p-6 text-center text-danger">{{ t('home.loadFailed', { err }) }}</div>

    <!-- 加载态 -->
    <LoadingState v-else-if="!ds" :label="t('common.loading')" />

    <template v-else>
      <!-- 首屏双栏：左「搜索 + 入口」，右「最近更新」。
           进站第一屏同时看到搜索和真实数据，不用先滚过一整屏标题。 -->
      <section class="animate-fade-up grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-start lg:gap-8">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-fg sm:text-4xl">{{ t('home.heroTitle') }}</h1>
          <p class="mt-2 max-w-xl text-sm text-dim sm:text-base">{{ t('home.heroSub') }}</p>

          <div class="mt-5 flex flex-col gap-4">
            <SearchBox size="lg" :placeholder="t('home.searchPlaceholder')" />

            <div class="flex flex-wrap items-center gap-3">
              <RouterLink to="/compare" class="btn btn-primary">{{ t('home.browseAll') }}</RouterLink>
              <RouterLink to="/vs" class="btn btn-ghost">{{ t('home.startCompare') }}</RouterLink>
            </div>

            <!-- 品类入口与快捷筛选：同一组 chips，竖线分组 -->
            <div class="flex flex-wrap items-center gap-2 pt-1">
              <RouterLink
                v-for="c in categories"
                :key="c.to"
                :to="c.to"
                class="chip hover:border-border-strong"
              >{{ c.label }}</RouterLink>
              <span class="h-5 w-px bg-border" aria-hidden="true" />
              <RouterLink
                v-for="q in quickFilters"
                :key="q.to"
                :to="q.to"
                class="chip text-dim hover:border-border-strong hover:text-fg"
              >{{ q.label }}</RouterLink>
            </div>
          </div>
        </div>

        <!-- 最近更新：3 行紧凑列表，双 tab（刚发布 / 刚收录） -->
        <div class="card p-4">
          <div class="mb-2 flex items-baseline justify-between">
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="rounded px-2 py-1 text-sm font-semibold transition-colors"
                :class="recentTab === 'released' ? 'bg-surface-2 text-fg' : 'text-dim hover:text-fg'"
                :aria-pressed="recentTab === 'released'"
                @click="recentTab = 'released'"
              >{{ t('home.recentReleased') }}</button>
              <button
                type="button"
                class="rounded px-2 py-1 text-sm font-semibold transition-colors"
                :class="recentTab === 'added' ? 'bg-surface-2 text-fg' : 'text-dim hover:text-fg'"
                :aria-pressed="recentTab === 'added'"
                @click="recentTab = 'added'"
              >{{ t('home.recentAdded') }}</button>
            </div>
            <RouterLink to="/compare" class="text-sm text-link hover:underline">{{ t('home.viewAll') }}</RouterLink>
          </div>
          <ul class="space-y-0.5">
            <li v-for="p in recent" :key="p.id">
              <RouterLink
                :to="`/product/${p.id}`"
                class="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-2"
              >
                <span
                  class="flex h-8 w-8 flex-none items-center justify-center rounded-md"
                  :style="{ background: rowChipBg(p) }"
                  aria-hidden="true"
                >
                  <span class="rounded-[2px] border" :style="rowChipScreen(p)" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-fg">{{ p.name }}</span>
                  <span class="block truncate text-[13px] text-dim">{{ vendorNameOf(p) }} · {{ p.line }}</span>
                  <span v-if="releaseDateLabel(p)" class="block text-xs text-faint">{{ releaseDateLabel(p) }}</span>
                </span>
                <!-- 缺失价降级走共用 PriceTag：规则只写一处，其他页面不会各自表现 -->
                <PriceTag :product="p" size="sm" class="shrink-0" />
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>

      <!-- 收录构成不占版面（用户 2026-10-17 拍板：品牌/构成区整块去掉） -->
    </template>
  </div>
</template>
