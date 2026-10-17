<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Product } from '../types';
import {
  DIMENSION_KEYS,
  dimLabel,
  SORTS,
  sortLabel,
  type FacetItem,
  type FilterState,
  type SortKey,
} from '../lib/facets';
import { useLibraryFilters } from '../lib/useLibraryFilters';
import { useDerived } from '../lib/useDataset';
import ProductCard from './ProductCard.vue';
import ProductListItem from './ProductListItem.vue';
import FilterBar from './FilterBar.vue';
import FilterDrawer from './FilterDrawer.vue';
import CompareDock from './CompareDock.vue';
import EmptyState from './EmptyState.vue';

const props = defineProps<{ products: Product[]; brandLabels?: Map<string, string> }>();
const { t, locale } = useI18n();
const derived = useDerived();

const f = useLibraryFilters(props.products, props.brandLabels);

/** 主维度放顶栏下拉，其余（系列/变体/芯片/内存/参数维度）收进「更多筛选」。
 * 在售状态必须上到第一层：913 款里大多数是历史机型，用户第一件事就是「只看能买的」。 */
const PRIMARY_KEYS = ['category', 'status', 'brand', 'price', 'year'];

interface Group {
  key: string;
  label: string;
  items: FacetItem[];
}

const groups = computed<{ primary: Group[]; more: Group[] }>(() => {
  const primary: Group[] = [];
  const more: Group[] = [];
  for (const key of DIMENSION_KEYS) {
    const items = f.facetsFor(key);
    if (!items.length) continue; // 当前数据无取值的维度不展示
    const g = { key, label: dimLabel(key), items };
    (PRIMARY_KEYS.includes(key) ? primary : more).push(g);
  }
  return { primary, more };
});

/** 已启用筛选 → chips（标签用分面显示名，避免裸 id） */
const chips = computed(() =>
  DIMENSION_KEYS.flatMap((key) =>
    (f.state.filter[key] ?? []).map((id) => {
      const it = f.facetsFor(key).find((x) => x.id === id);
      return { dim: key, id, label: it?.label ?? id };
    }),
  ),
);

const sortKey = computed<SortKey>(() => f.state.sorts[0] ?? 'release');
const view = ref<'card' | 'list'>('card');
const drawerOpen = ref(false);
const activeCount = computed(() => DIMENSION_KEYS.reduce((a, k) => a + (f.state.filter[k]?.length ?? 0), 0));

function onSort(k: SortKey) {
  f.setSorts([k]);
}
function setView(v: 'card' | 'list') {
  view.value = v;
}
function vendorNameOf(p: Product): string {
  return derived.value?.vendors.get(p.brand)?.name ?? p.brand;
}
function vendorColorOf(p: Product): string | undefined {
  return derived.value?.vendors.get(p.brand)?.accentColor;
}
</script>

<template>
  <div class="space-y-4">
    <!-- 桌面：筛选栏（主维度下拉 + 更多 + 排序 + 视图 + 已选 chips） -->
    <div class="hidden md:block">
      <FilterBar
        :primary="groups.primary"
        :more="groups.more"
        :active="f.state.filter"
        :sort-key="sortKey"
        :view="view"
        @toggle="f.toggle"
        @clear-all="f.clearAll"
        @set-sort="onSort"
        @set-view="setView"
      />
    </div>

    <!-- 移动端：精简工具条 + 抽屉 -->
    <div class="flex items-center gap-2 md:hidden">
      <button type="button" class="btn btn-ghost" @click="drawerOpen = true">
        {{ t('home.filterTitle') }}
        <span v-if="activeCount" class="text-accent"> ({{ activeCount }})</span>
      </button>
      <label class="ml-auto flex items-center gap-1.5 text-sm text-dim">
        <select
          :value="sortKey"
          class="input !w-auto !min-h-9 !py-1 text-sm"
          @change="onSort(($event.target as HTMLSelectElement).value as SortKey)"
        >
          <option v-for="s in SORTS" :key="s.id" :value="s.id">{{ sortLabel(s.id) }}</option>
        </select>
      </label>
      <div class="flex overflow-hidden rounded-[4px] border border-border-strong">
        <button
          type="button"
          class="px-2.5 py-1.5"
          :class="view === 'card' ? 'bg-surface-2 text-fg' : 'text-dim'"
          :aria-label="t('view.card')"
          @click="setView('card')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <rect x="1.5" y="1.5" width="5.5" height="5.5" />
            <rect x="9" y="1.5" width="5.5" height="5.5" />
            <rect x="1.5" y="9" width="5.5" height="5.5" />
            <rect x="9" y="9" width="5.5" height="5.5" />
          </svg>
        </button>
        <button
          type="button"
          class="px-2.5 py-1.5"
          :class="view === 'list' ? 'bg-surface-2 text-fg' : 'text-dim'"
          :aria-label="t('view.list')"
          @click="setView('list')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M1.5 3.5h13M1.5 8h13M1.5 12.5h13" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 结果摘要条（评审：913/913 是废话，筛选后没有任何地方说「已选条件」）：
         未筛选 = 共 N 款；筛选后 = 找到 X 款 · 已排除 Y 款 + 可清除的条件 chips -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <p class="text-sm text-dim">
        <template v-if="activeCount">
          {{ t('library.foundExcluded', { found: f.filtered.length, excluded: f.total - f.filtered.length }) }}
        </template>
        <template v-else>{{ t('common.models', { n: f.total }) }}</template>
      </p>
      <div v-if="chips.length" class="flex flex-wrap items-center gap-1.5">
        <span
          v-for="c in chips"
          :key="c.dim + c.id"
          class="badge cursor-pointer border-border bg-surface-2 text-dim hover:border-border-strong"
          role="button"
          tabindex="0"
          :title="t('filter.clear')"
          @click="f.toggle(c.dim, c.id)"
          @keydown.enter="f.toggle(c.dim, c.id)"
        >{{ c.label }} ×</span>
      </div>
    </div>

    <!-- 卡片视图：auto-fill + minmax(300px,1fr)，宽屏自然 4 列（旧 3 列每卡 ~490px 过宽） -->
    <div
      v-if="view === 'card'"
      class="grid gap-4"
      style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr))"
    >
      <ProductCard
        v-for="p in f.filtered"
        :key="p.id"
        :product="p"
        :vendor-name="vendorNameOf(p)"
        :vendor-color="vendorColorOf(p)"
      />
    </div>

    <!-- 列表视图 -->
    <div v-else class="space-y-2">
      <ProductListItem
        v-for="p in f.filtered"
        :key="p.id"
        :product="p"
        :vendor-name="vendorNameOf(p)"
        :vendor-color="vendorColorOf(p)"
      />
    </div>

    <EmptyState
      v-if="!f.filtered.length"
      :title="t('compare.empty')"
      :hint="t('brand.empty')"
    />

    <CompareDock :products="props.products" />

    <FilterDrawer
      :open="drawerOpen"
      :groups="[...groups.primary, ...groups.more]"
      :active="f.state.filter"
      :chips="chips"
      :sort-key="sortKey"
      :view="view"
      @toggle="f.toggle"
      @clear-all="f.clearAll"
      @set-sort="onSort"
      @set-view="setView"
      @close="drawerOpen = false"
    />
  </div>
</template>
