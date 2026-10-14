<script setup lang="ts">
/**
 * 设备球页：筛选条 + 球面画布。
 *
 * 与 /canvas（环面回绕）复用同一套筛选层（canvasFilter），只换渲染：
 * 筛选/排序/分面/URL 状态这些逻辑一行都不用重写，改的只有「怎么摆」。
 *
 * URL 即状态（#/globe?brand=huawei&line=Mate&year=2025&sort=ppi），同 /canvas。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useDataset, useDerived } from '../lib/useDataset';
import {
  EMPTY_FILTER,
  SORTS,
  applyFilter,
  sortLabel,
  brandFacets,
  buildCanvasDocs,
  filterToQuery,
  isFiltered,
  lineFacets,
  parseFilter,
  yearFacets,
  type CanvasDoc,
  type CanvasFilter,
  type SortKey,
} from '../lib/canvasFilter';
import GlobeCanvas from '../components/GlobeCanvas.vue';
import PxIcon from '../components/PxIcon.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { ds, err } = useDataset();
const derived = useDerived();

const filter = ref<CanvasFilter>(parseFilter(route.query as Record<string, unknown>));

watch(
  () => route.query,
  (q) => {
    filter.value = parseFilter(q as Record<string, unknown>);
  },
);

const docs = computed<CanvasDoc[]>(() =>
  (ds.value?.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    nameZh: p.nameZh ?? null,
    line: p.line ?? '',
    brand: p.brand,
    brandZh: derived.value?.vendors.get(p.brand)?.nameZh ?? p.brand,
    releaseDate: p.releaseDate ?? '',
    releaseDatePrecision: p.releaseDatePrecision ?? '',
    status: p.status ?? '',
  })),
);

const filterable = computed(() => buildCanvasDocs(docs.value));

const ppiOf = computed(() => {
  const by = new Map<string, number | null>();
  for (const p of ds.value?.products ?? []) by.set(p.id, p.display?.ppi ?? null);
  return (id: string) => by.get(id) ?? null;
});

const items = computed(() => applyFilter(filterable.value, filter.value, ppiOf.value));

const brands = computed(() => brandFacets(filterable.value, filter.value));
const lines = computed(() => lineFacets(filterable.value, filter.value));
const years = computed(() => yearFacets(filterable.value, filter.value));

const accentOf = (brand: string) =>
  derived.value?.vendors.get(brand)?.accentColor ?? 'var(--color-gold)';

/**
 * 品牌分组台数 → 球面纬度带。
 * 排序必须与 items 的实际顺序一致，否则「华为那批」会被排到南半球去。
 * 用 items 里品牌的**出现顺序**分组，而不是用 facets 的顺序 ——
 * facets 按计数排序，计数变了分组就跟着变，设备会在球上跳来跳去。
 */
const groups = computed<number[]>(() => {
  const out: { brand: string; n: number }[] = [];
  for (const d of items.value) {
    const last = out[out.length - 1];
    if (last && last.brand === d.brand) last.n++;
    else out.push({ brand: d.brand, n: 1 });
  }
  return out.map((g) => g.n);
});

function setFilter(patch: Partial<CanvasFilter>) {
  const next = { ...filter.value, ...patch };
  if (patch.brand !== undefined && next.brand !== filter.value.brand) {
    const stillValid = lines.value.some((l) => l.value === next.line);
    if (!stillValid) next.line = '';
  }
  if (patch.year !== undefined || patch.q !== undefined || patch.brand !== undefined) {
    if (next.year && !years.value.some((y) => y.value === next.year)) next.year = '';
  }
  filter.value = next;
  router.replace({ path: '/globe', query: filterToQuery(next) });
}

function setSort(sort: SortKey) {
  setFilter({ sort });
}

function clearAll() {
  filter.value = { ...EMPTY_FILTER };
  router.replace({ path: '/globe', query: {} });
}

const total = computed(() => docs.value.length);
const shown = computed(() => items.value.length);
const dirty = computed(() => isFiltered(filter.value));
const globe = ref<InstanceType<typeof GlobeCanvas> | null>(null);
const spinning = ref(true);

function toggleSpin() {
  spinning.value = !spinning.value;
  if (spinning.value) globe.value?.startSpin();
  else globe.value?.stopSpin();
}

/**
 * 画布高度必须是**确定值**，不能靠 flex-1 撑。
 * 这个坑在 /canvas 上踩过：flex 子项的 min-height 不参与 flex 分配，
 * 内层 h-full 参照塌陷父级，实际高度是 0 —— 画面照样渲染，但指针事件全落空。
 */
const vh = ref(typeof window !== 'undefined' ? window.innerHeight : 800);
let onResize: (() => void) | null = null;
onMounted(() => {
  onResize = () => (vh.value = window.innerHeight);
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  if (onResize) window.removeEventListener('resize', onResize);
});

const canvasH = computed(
  () => `${Math.max(320, Math.round(vh.value * (vh.value < 620 ? 0.56 : 0.68)))}px`,
);
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-if="err" class="page-shell py-10 text-center" style="color: var(--color-east)">
      {{ t('common.loadFailed', { err }) }}
    </div>

    <template v-else>
      <div class="page-shell pt-5 pb-3">
        <div class="pixel-panel mb-4 p-3">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 class="pixel-outline font-pixel text-[24px] leading-[1.5]">{{ t('globe.title') }}</h1>
              <p
                class="mt-1 flex flex-wrap items-center gap-2 text-[12px] leading-[1.5]"
                style="color: var(--color-ink-soft)"
              >
                <span>{{ t('globe.howto') }}</span>
                <span class="pixel-chip px-1.5 py-0.5 text-[var(--color-gold)]">{{ shown }}</span>
                <span>{{ t('filter.matchedTotal', { shown, total }) }}</span>
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                class="pixel-button px-2.5 py-1.5 text-[12px] leading-[1.5]"
                @click="toggleSpin()"
              >
                {{ spinning ? t('globe.spinPause') : t('globe.spinStart') }}
              </button>
              <button
                class="pixel-button flex items-center gap-1 px-2.5 py-1.5 text-[12px] leading-[1.5]"
                :disabled="!dirty"
                @click="clearAll"
              >
                <PxIcon name="close" :size="12" />
                {{ t('filter.reset') }}
              </button>
              <button
                class="pixel-button flex items-center gap-1 px-2.5 py-1.5 text-[12px] leading-[1.5]"
                @click="globe?.reset()"
              >
                <PxIcon name="gear" :size="12" />
                {{ t('globe.resetView') }}
              </button>
            </div>
          </div>

          <div class="mt-3 space-y-2 border-t-2 border-[var(--color-ink)] pt-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="w-10 shrink-0 text-[12px] leading-[1.5]" style="color: var(--color-gold)"
                >{{ t('facet.brand') }}</span
              >
              <button
                v-for="f in brands"
                :key="f.value || 'all'"
                class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
                :aria-pressed="filter.brand === f.value"
                @click="setFilter({ brand: f.value })"
              >
                {{ f.value ? (docs.find((d) => d.brand === f.value)?.brandZh ?? f.value) : t('common.all') }}
                {{ f.count }}
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <span class="w-10 shrink-0 text-[12px] leading-[1.5]" style="color: var(--color-gold)"
                >{{ t('common.line') }}</span
              >
              <button
                v-for="f in lines"
                :key="f.value || 'all'"
                class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
                :aria-pressed="filter.line === f.value"
                @click="setFilter({ line: f.value })"
              >
                {{ f.value || t('common.all') }} {{ f.count }}
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <span class="w-10 shrink-0 text-[12px] leading-[1.5]" style="color: var(--color-gold)"
                >{{ t('facet.year') }}</span
              >
              <button
                v-for="f in years.filter((y) => y.value)"
                :key="f.value"
                class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
                :aria-pressed="filter.year === f.value"
                @click="setFilter({ year: filter.year === f.value ? '' : f.value })"
              >
                {{ f.value }} {{ f.count }}
              </button>
              <span class="ml-1 flex items-center gap-1">
                <label class="sr-only" for="globe-q">{{ t('globe.searchLabel') }}</label>
                <input
                  id="globe-q"
                  :value="filter.q"
                  type="search"
                  :placeholder="t('globe.searchPlaceholder')"
                  class="pixel-input w-44 px-2 py-1 text-[12px] leading-[1.5]"
                  autocomplete="off"
                  @input="setFilter({ q: ($event.target as HTMLInputElement).value })"
                />
              </span>
              <span class="ml-auto flex flex-wrap items-center gap-2">
                <span
                  class="flex items-center gap-1 text-[12px] leading-[1.5]"
                  style="color: var(--color-gold)"
                >
                  <PxIcon name="sort" :size="12" />
                  {{ t('sort.label') }}
                </span>
                <button
                  v-for="s in SORTS"
                  :key="s.key"
                  class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
                  :aria-pressed="filter.sort === s.key"
                  @click="setSort(s.key)"
                >
                  {{ sortLabel(s.key) }}
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="page-shell pb-5">
        <div class="pixel-panel" :style="{ height: canvasH }">
          <GlobeCanvas
            ref="globe"
            :documents="items"
            :groups="groups"
            :accent-of="accentOf"
            :spin="spinning"
          />
        </div>
      </div>

      <nav class="sr-only" :aria-label="t('globe.a11yNavLabel')">
        <h2>{{ t('canvas.a11yListTitle') }}</h2>
        <ol>
          <li v-for="p in items" :key="p.id">
            <RouterLink :to="`/product/${p.id}`">
              {{ p.brandZh }} {{ p.name }}（{{ p.line }}，{{
                p.releaseDate.slice(0, 4) || t('common.yearUnknown')
              }}）
            </RouterLink>
          </li>
        </ol>
      </nav>
    </template>
  </div>
</template>
