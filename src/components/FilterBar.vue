<script setup lang="ts">
import { ref } from 'vue';
import { t } from '../i18n';
import type { FacetItem, FilterState, SortKey } from '../lib/facets';
import { SORTS, sortLabel } from '../lib/facets';

interface Group {
  key: string;
  label: string;
  items: FacetItem[];
}

const props = defineProps<{
  primary: Group[];
  more: Group[];
  active: FilterState;
  sortKey: SortKey;
  view: 'card' | 'list';
}>();
const emit = defineEmits<{
  toggle: [dim: string, id: string];
  clearAll: [];
  setSort: [k: SortKey];
  setView: [v: 'card' | 'list'];
}>();

const openSet = ref<Set<string>>(new Set());
const moreOpen = ref(false);

function toggleOpen(key: string) {
  const s = new Set(openSet.value);
  s.has(key) ? s.delete(key) : s.add(key);
  openSet.value = s;
}
function closeAll() {
  openSet.value = new Set();
  moreOpen.value = false;
}
function onItem(group: Group, item: FacetItem) {
  if (item.count === 0 && !props.active[group.key]?.includes(item.id)) return; // 0 台档不可选
  emit('toggle', group.key, item.id);
}
</script>

<template>
  <div class="border-b border-border bg-surface">
    <div class="page-shell flex flex-wrap items-center gap-2 py-3">
      <!-- 主筛选维度 -->
      <div v-for="g in primary" :key="g.key" class="relative">
        <button
          type="button"
          class="chip"
          :aria-pressed="(active[g.key]?.length ?? 0) > 0"
          @click="toggleOpen(g.key)"
        >
          {{ g.label }}
          <span v-if="active[g.key]?.length" class="text-accent">{{ active[g.key].length }}</span>
          <span class="text-faint">▾</span>
        </button>
        <div
          v-if="openSet.has(g.key)"
          class="absolute left-0 z-40 mt-1 max-h-72 w-60 overflow-auto rounded-md border border-border-strong bg-surface p-1 shadow-md"
        >
          <button
            v-for="it in g.items"
            :key="it.id"
            type="button"
            class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2"
            :class="[
              active[g.key]?.includes(it.id) ? 'text-accent' : 'text-fg',
              it.count === 0 && !active[g.key]?.includes(it.id) ? 'opacity-40' : '',
            ]"
            @click="onItem(g, it)"
          >
            <span class="flex items-center gap-2">
              <span
                class="grid h-4 w-4 place-items-center rounded-sm border"
                :class="
                  active[g.key]?.includes(it.id)
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border-strong'
                "
                >{{ active[g.key]?.includes(it.id) ? '✓' : '' }}</span
              >
              {{ it.label }}
              <span v-if="it.isUnknown" class="text-[10px] text-faint">·未公布</span>
            </span>
            <span class="text-xs text-faint">{{ it.count }}</span>
          </button>
        </div>
      </div>

      <!-- 更多筛选 -->
      <div class="relative">
        <button type="button" class="chip" :aria-pressed="moreOpen" @click="moreOpen = !moreOpen">
          {{ t('home.moreFilters') }}
          <span class="text-faint">▾</span>
        </button>
        <div
          v-if="moreOpen"
          class="absolute left-0 z-40 mt-1 w-72 rounded-md border border-border-strong bg-surface p-2 shadow-md"
        >
          <div v-for="g in more" :key="g.key" class="mb-2 last:mb-0">
            <p class="px-1 pb-1 text-xs font-semibold text-dim">{{ g.label }}</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="it in g.items"
                :key="it.id"
                type="button"
                class="chip !px-2.5 !py-1 !text-xs"
                :class="{ 'is-active': active[g.key]?.includes(it.id) }"
                :disabled="it.count === 0 && !active[g.key]?.includes(it.id)"
                @click="onItem(g, it)"
              >
                {{ it.label }}
                <span class="text-faint">{{ it.count }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 排序 + 视图切换 -->
      <div class="ml-auto flex items-center gap-2">
        <label class="flex items-center gap-1.5 text-sm text-dim">
          <span class="hidden sm:inline">{{ t('sort.label') }}</span>
          <select
            :value="sortKey"
            class="input !w-auto !min-h-9 !py-1 text-sm"
            @change="emit('setSort', ($event.target as HTMLSelectElement).value as SortKey)"
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
            @click="emit('setView', 'card')"
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
            @click="emit('setView', 'list')"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M1.5 3.5h13M1.5 8h13M1.5 12.5h13" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 已选条件只在结果摘要行渲染（LibraryInner），面板内不再重复一块 -->
    <!-- 点击空白处关闭下拉 -->
    <div v-if="openSet.size || moreOpen" class="fixed inset-0 z-30" @click="closeAll" />
  </div>
</template>
