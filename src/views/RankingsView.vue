<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ABILITIES, abilityLabel, abilityRaw, fmtAbility } from '../lib/specs';
import { useDataset } from '../lib/useDataset';
import {
  ABILITY_OF_DIM,
  ABILITY_SORT,
  SORTS,
  applyMultiSort,
  buildCatalog,
  emptyFilter,
  readFilter,
  writeFilter,
} from '../lib/facets';
import type { SortKey } from '../lib/facets';
import {
  basePriceCny,
  categoryLabel,
  categoryOf,
  fmtPriceCny,
  productSubline,
  seriesLabel,
  seriesOf,
} from '../lib/catalog';
import PxIcon from '../components/PxIcon.vue';
import SectionFrame from '../components/SectionFrame.vue';
import SpriteImg from '../components/SpriteImg.vue';

/**
 * 榜单页 = **多级排序器**（与机型库的「筛选」是完全两件事）。
 *
 * 用户 2026-10-06 明确区分：
 * - **榜单是排序**：按某个值对**所有**产品排序，或按几个值排序；且是「优先级叠加」的 ——
 *   「优先大电池」是一级排序，「再加相机」是在电池相同基础上的二级排序。
 * - **榜单不减员**：永远展示全部机型（按排序后的顺序），不像筛选会越筛越少。
 * - **筛选（机型库）没有排序**：那是 AND 组合的条件，靠要求组合而非顺序。
 *
 * 因此本页**不跳转到机型库**、不接筛选；它只做一件事：拿全部机型，按用户排好的优先级链排序。
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { ds } = useDataset();

const all = computed(() => ds.value?.products ?? []);
const brandLabels = computed(() => new Map((ds.value?.vendors ?? []).map((v) => [v.id, v.nameZh])));

function toParams(q: Record<string, unknown>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s !== '') p.set(k, s);
  }
  return p;
}

const catalog = computed(() => buildCatalog(all.value, [], brandLabels.value));
/** 排序优先级链（来自 URL `o`，逗号分隔；缺失/非法值已被 readFilter 丢弃）。 */
const sorts = computed<SortKey[]>(() => readFilter(toParams(route.query), catalog.value).sorts);

/** 按优先级链排序后的**全部**机型（不减员）。空链 = 默认按发布日期倒序。 */
const ranked = computed(() => applyMultiSort(all.value, sorts.value));

// ── 排序键解析 ──

const SORT_LABEL = new Map(SORTS.map((s) => [s.id, s.labelKey]));

/** 维度 → 默认排序键（添加时用的方向）。 */
const DEFAULT_SORT: Record<string, SortKey> = {
  price: 'price-desc',
  ppi: 'ppi-desc',
  weight: 'weight-asc',
  battery: 'battery-desc',
  camera: 'camera-desc',
};

/** 可添加的维度（已选维度不再出现）。 */
const DIM_OPTIONS = [
  { dim: 'price', labelKey: 'rank.dimPrice' },
  { dim: 'ppi', labelKey: 'rank.dimPpi' },
  { dim: 'weight', labelKey: 'rank.dimWeight' },
  { dim: 'battery', labelKey: 'rank.dimBattery' },
  { dim: 'camera', labelKey: 'rank.dimCamera' },
];

const REVERSE: Record<string, SortKey> = {
  'price-asc': 'price-desc',
  'price-desc': 'price-asc',
  'ppi-asc': 'ppi-desc',
  'ppi-desc': 'ppi-asc',
  'weight-asc': 'weight-desc',
  'weight-desc': 'weight-asc',
  'battery-asc': 'battery-desc',
  'battery-desc': 'battery-asc',
  'camera-asc': 'camera-desc',
  'camera-desc': 'camera-asc',
};

/** 已选优先级的展示行。 */
const rows = computed(() =>
  sorts.value.map((sort, idx) => ({
    idx,
    sort,
    labelKey: SORT_LABEL.get(sort) ?? null,
    label: SORT_LABEL.get(sort) ? t(SORT_LABEL.get(sort)!) : sort,
    dim: sort.split('-')[0],
    asc: sort.endsWith('-asc'),
    isPrimary: idx === 0,
  })),
);

const presentDims = computed(() => new Set(sorts.value.map((s) => s.split('-')[0])));
const addable = computed(() => DIM_OPTIONS.filter((d) => !presentDims.value.has(d.dim)));

// ── 动作 ──

function pushSorts(next: SortKey[]) {
  router.replace({ path: '/rankings', query: writeFilter(emptyFilter(), next) });
}

/** 四个能力维度一键 toggle：未选则加为一级，已选则移除（快捷入口，语义与手动添加一致）。 */
function toggleAbility(defKey: string) {
  const sk = ABILITY_SORT[defKey];
  const cur = sorts.value;
  pushSorts(cur.includes(sk) ? cur.filter((s) => s !== sk) : [sk, ...cur]);
}

function addDim(dim: string) {
  const sk = DEFAULT_SORT[dim];
  if (sk) pushSorts([...sorts.value, sk]);
}

function removeAt(i: number) {
  pushSorts(sorts.value.filter((_, idx) => idx !== i));
}

function move(i: number, step: number) {
  const next = [...sorts.value];
  const j = i + step;
  if (j < 0 || j >= next.length) return;
  [next[i], next[j]] = [next[j], next[i]];
  pushSorts(next);
}

function toggleDir(i: number) {
  const cur = sorts.value[i];
  const rev = REVERSE[cur];
  if (!rev) return;
  const next = [...sorts.value];
  next[i] = rev;
  pushSorts(next);
}

/** 单元格展示：某机型在某排序维度上的值；缺值标「未公布」。 */
function cell(p: (typeof all.value)[number], sort: SortKey): { text: string; missing: boolean } {
  if (sort === 'release') return { text: p.releaseDate, missing: false };
  const dim = sort.split('-')[0];
  if (dim === 'price') {
    const v = basePriceCny(p);
    return v == null
      ? { text: t('common.unpublished'), missing: true }
      : { text: fmtPriceCny(v), missing: false };
  }
  const ak = ABILITY_OF_DIM[dim];
  const raw = ak ? abilityRaw(p, ak) : null;
  return raw == null
    ? { text: t('common.unpublished'), missing: true }
    : { text: fmtAbility(ak, raw), missing: false };
}

// 副标题已下沉 catalog.ts 的 productSubline（曾与 CompareView 各写一份且答案不同）
</script>

<template>
  <div class="page-shell space-y-6 py-6">
    <SectionFrame :title="t('rank.title')" hud="var(--color-crown)" icon="trophy">
      <p
        class="pixel-note mb-4 px-3 py-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)]"
      >
        {{ t('rank.introA') }}<b style="color: var(--color-parchment-lit)">{{
          t('rank.introSort')
        }}</b
        >{{ t('rank.introB', { n: all.length }) }}
        {{ t('rank.introC') }}
      </p>

      <!-- 四个能力维度快捷入口 -->
      <div class="mb-3 flex flex-wrap items-center gap-1.5">
        <span class="pixel-heading flex items-center gap-1 text-[12px] leading-[1.5]">
          <PxIcon name="dot" :size="8" />
          {{ t('rank.quickAdd') }}
        </span>
        <button
          v-for="def in ABILITIES"
          :key="def.key"
          class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
          :aria-pressed="sorts.includes(ABILITY_SORT[def.key])"
          @click="toggleAbility(def.key)"
        >
          {{ abilityLabel(def.key) }}
        </button>
      </div>

      <!-- 排序优先级链 -->
      <div class="pixel-panel mb-3 p-3">
        <div class="mb-2 flex items-center gap-2">
          <span class="pixel-heading flex items-center gap-1 text-[12px] leading-[1.5]">
            <PxIcon name="sort" :size="12" />
            {{ t('rank.priority') }}
          </span>
          <button
            v-if="sorts.length"
            class="pixel-button ml-auto px-2 py-1 text-[12px] leading-[1.5]"
            @click="pushSorts([])"
          >
            {{ t('rank.clearSorts') }}
          </button>
        </div>

        <p
          v-if="!sorts.length"
          class="pixel-note px-2 py-3 text-[12px] leading-[1.5]"
          style="color: var(--color-parchment-dim)"
        >
          {{ t('rank.noSorts') }}
        </p>

        <ul v-else class="space-y-1.5">
          <li
            v-for="r in rows"
            :key="r.idx"
            class="pixel-row flex flex-wrap items-center gap-2 px-2 py-1.5"
            :style="r.isPrimary ? { borderColor: 'var(--color-gold)' } : undefined"
          >
            <span
              class="pixel-chip flex h-6 w-6 flex-none items-center justify-center text-[12px] leading-none"
              :style="{ color: r.isPrimary ? 'var(--color-gold)' : 'var(--color-parchment-dim)' }"
            >
              {{ r.idx + 1 }}
            </span>
            <span class="text-[12px] leading-[1.5] text-[var(--color-parchment-lit)]">
              {{ r.label }}
            </span>
            <span
              v-if="r.isPrimary"
              class="pixel-chip px-1.5 py-0.5 text-[12px]"
              style="color: var(--color-gold)"
            >
              {{ t('rank.primary') }}
            </span>
            <span class="flex-none text-[12px] leading-[1.5]" style="color: var(--color-parchment-dim)">
              {{ r.asc ? t('rank.asc') : t('rank.desc') }}
            </span>
            <div class="ml-auto flex flex-none items-center gap-1">
              <button
                class="pixel-button px-1.5 py-0.5 text-[12px] leading-[1.5]"
                :title="t('rank.toggleDir')"
                @click="toggleDir(r.idx)"
              >
                <PxIcon
                  name="arrowDown"
                  :size="10"
                  class="rotate-180"
                  v-if="!r.asc"
                />
                <PxIcon name="arrowDown" :size="10" v-else />
              </button>
              <button
                class="pixel-button px-1.5 py-0.5 text-[12px] leading-[1.5]"
                :disabled="r.idx === 0"
                :title="t('rank.promote')"
                @click="move(r.idx, -1)"
              >
                <PxIcon name="arrow" :size="10" class="rotate-[-90deg]" />
              </button>
              <button
                class="pixel-button px-1.5 py-0.5 text-[12px] leading-[1.5]"
                :disabled="r.idx === rows.length - 1"
                :title="t('rank.demote')"
                @click="move(r.idx, 1)"
              >
                <PxIcon name="arrow" :size="10" class="rotate-90" />
              </button>
              <button
                class="pixel-button px-1.5 py-0.5 text-[12px] leading-[1.5]"
                :title="t('rank.removeSort')"
                @click="removeAt(r.idx)"
              >
                {{ t('common.remove') }}
              </button>
            </div>
          </li>
        </ul>

        <!-- 添加排序：只列未选维度 -->
        <div v-if="addable.length" class="mt-2 flex flex-wrap items-center gap-1.5 border-t-2 border-[var(--color-ink)] pt-2">
          <span class="pixel-heading flex items-center gap-1 text-[12px] leading-[1.5]">
            <PxIcon name="dot" :size="8" />
            {{ t('rank.addSort') }}
          </span>
          <button
            v-for="d in addable"
            :key="d.dim"
            class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
            @click="addDim(d.dim)"
          >
            + {{ t(d.labelKey) }}
          </button>
        </div>
      </div>
    </SectionFrame>

    <!-- 排序结果：全部机型，不减员 -->
    <SectionFrame
      :title="t('rank.resultTitle', { n: ranked.length })"
      hud="var(--color-crown)"
      icon="list"
    >
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-[12px]" :style="{ minWidth: '640px' }">
          <thead>
            <tr>
              <th
                class="border-2 border-[var(--color-ink)] bg-[var(--color-panel-lit)] p-2 text-left"
                style="color: var(--color-parchment-dim)"
              >
                #
              </th>
              <th
                class="border-2 border-[var(--color-ink)] bg-[var(--color-panel-lit)] p-2 text-left"
                style="color: var(--color-parchment-dim)"
              >
                  {{ t('compare.modelHeader') }}
              </th>
              <th
                v-for="r in rows"
                :key="r.sort"
                class="border-2 border-[var(--color-ink)] bg-[var(--color-panel-lit)] p-2 text-left"
                :style="r.isPrimary ? { color: 'var(--color-gold)' } : { color: 'var(--color-parchment-dim)' }"
              >
                {{ r.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in ranked" :key="p.id">
              <td
                class="border-2 border-[var(--color-ink)] bg-[var(--color-panel)] p-2"
                style="color: var(--color-parchment-dim)"
              >
                {{ i + 1 }}
              </td>
              <td class="border-2 border-[var(--color-ink)] bg-[var(--color-panel)] p-2">
                <div class="flex items-center gap-2">
                  <SpriteImg :id="p.id" class="h-8 w-auto flex-none" />
                  <div class="min-w-0">
                    <RouterLink
                      :to="`/product/${p.id}`"
                      class="block truncate text-[12px] leading-[1.5]"
                      :style="{ color: 'var(--color-parchment-lit)' }"
                    >
                      {{ p.name }}
                    </RouterLink>
                    <span class="block truncate text-[12px] leading-[1.5]" style="color: var(--color-parchment-dim)">
                      {{ categoryLabel(categoryOf(p)) }} · {{ productSubline(p) }}
                    </span>
                  </div>
                </div>
              </td>
              <td
                v-for="r in rows"
                :key="r.sort"
                class="border-2 border-[var(--color-ink)] bg-[var(--color-panel)] p-2"
                :style="cell(p, r.sort).missing ? { color: 'var(--color-ink-soft)' } : { color: 'var(--color-parchment)' }"
              >
                {{ cell(p, r.sort).text }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="pixel-note px-3 py-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)">
        {{ t('rank.noteA') }}
        {{ t('rank.noteB', { n: all.length }) }}
      </p>
    </SectionFrame>
  </div>
</template>
