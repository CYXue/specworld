<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { FacetItem, FilterState, SortKey } from '../lib/facets';
import { SORTS, sortLabel } from '../lib/facets';

interface Group {
  key: string;
  label: string;
  items: FacetItem[];
}

defineProps<{
  open: boolean;
  groups: Group[];
  active: FilterState;
  chips: Array<{ dim: string; id: string; label: string }>;
  sortKey: SortKey;
  view: 'card' | 'list';
}>();
const emit = defineEmits<{
  toggle: [dim: string, id: string];
  clearAll: [];
  setSort: [k: SortKey];
  setView: [v: 'card' | 'list'];
  close: [];
}>();

const { t } = useI18n();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black/60" @click="emit('close')" />
      <div
        class="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-auto rounded-t-lg border-t border-border-strong bg-surface p-4 animate-fade-up"
      >
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-base font-semibold text-fg">{{ t('home.filterTitle') }}</h2>
          <button type="button" class="btn btn-ghost px-3 text-sm" @click="emit('close')">完成</button>
        </div>

        <div v-for="g in groups" :key="g.key" class="mb-4">
          <p class="mb-2 text-sm font-semibold text-dim">{{ g.label }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="it in g.items"
              :key="it.id"
              type="button"
              class="chip !text-sm"
              :class="{ 'is-active': active[g.key]?.includes(it.id) }"
              :disabled="it.count === 0 && !active[g.key]?.includes(it.id)"
              @click="emit('toggle', g.key, it.id)"
            >
              {{ it.label }}
              <span class="text-faint">{{ it.count }}</span>
            </button>
          </div>
        </div>

        <div v-if="chips.length" class="mb-4 flex flex-wrap items-center gap-2">
          <span class="text-xs text-dim">{{ t('filter.selected') }}：</span>
          <span v-for="c in chips" :key="c.dim + c.id" class="chip is-active !py-1 !text-xs">
            {{ c.label }}
            <button type="button" class="tag-remove" @click="emit('toggle', c.dim, c.id)">×</button>
          </span>
          <button type="button" class="btn-link !text-xs" @click="emit('clearAll')">
            {{ t('filter.clear') }}
          </button>
        </div>

        <div class="flex items-center gap-3 border-t border-border pt-3">
          <label class="flex items-center gap-1.5 text-sm text-dim">
            {{ t('sort.label') }}
            <select
              :value="sortKey"
              class="input !w-auto !min-h-9 !py-1 text-sm"
              @change="emit('setSort', ($event.target as HTMLSelectElement).value as SortKey)"
            >
              <option v-for="s in SORTS" :key="s.id" :value="s.id">{{ sortLabel(s.id) }}</option>
            </select>
          </label>
          <div class="flex overflow-hidden rounded border border-border-strong">
            <button
              type="button"
              class="px-3 py-1.5 text-sm"
              :class="view === 'card' ? 'bg-surface-2 text-fg' : 'text-dim'"
              @click="emit('setView', 'card')"
            >
              ▦
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm"
              :class="view === 'list' ? 'bg-surface-2 text-fg' : 'text-dim'"
              @click="emit('setView', 'list')"
            >
              ☰
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
