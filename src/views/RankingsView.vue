<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ABILITIES, abilityRaw, fmtAbility } from '../lib/specs';
import type { AbilityKey } from '../lib/specs';
import { useDataset } from '../lib/useDataset';
import {
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
  chipNameLabel,
  fmtPriceCny,
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

const SORT_LABEL = new Map(SORTS.map((s) => [s.id, s.label]));

const ABILITY_OF_DIM: Record<string, AbilityKey> = {
  ppi: 'display',
  weight: 'light',
  battery: 'battery',
  camera: 'camera',
};

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
  { dim: 'price', label: '价格' },
  { dim: 'ppi', label: '屏幕像素密度' },
  { dim: 'weight', label: '机身重量' },
  { dim: 'battery', label: '电池容量' },
  { dim: 'camera', label: '主摄像素' },
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
    label: SORT_LABEL.get(sort) ?? sort,
    dim: sort.split('-')[0],
    dir: sort.endsWith('-asc') ? '升' : '降',
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
    return v == null ? { text: '未公布', missing: true } : { text: fmtPriceCny(v), missing: false };
  }
  const ak = ABILITY_OF_DIM[dim];
  const raw = ak ? abilityRaw(p, ak) : null;
  return raw == null
    ? { text: '未公布', missing: true }
    : { text: fmtAbility(ak, raw), missing: false };
}

function subline(p: (typeof all.value)[number]): string {
  const chip = chipNameLabel(p.chipset?.name ?? '');
  return [seriesOf(p), chip === '未公布' ? null : chip].filter(Boolean).join(' · ');
}
</script>

<template>
  <div class="page-shell space-y-6 py-6">
    <SectionFrame title="榜单 · 多级排序" hud="var(--color-crown)" icon="trophy">
      <p
        class="pixel-note mb-4 px-3 py-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)"
      >
        榜单是<b style="color: var(--color-parchment-lit)">排序</b>，不是筛选：它永远列出
        <b style="color: var(--color-parchment-lit)">全部 {{ all.length }} 台</b>，按你排好的优先级链排序。
        先加「一级排序」（如大电池），再加「二级排序」（如相机）—— 一级相同的机型才用二级区分。
      </p>

      <!-- 四个能力维度快捷入口 -->
      <div class="mb-3 flex flex-wrap items-center gap-1.5">
        <span class="pixel-heading flex items-center gap-1 text-[12px] leading-[1.5]">
          <PxIcon name="dot" :size="8" />
          快捷加
        </span>
        <button
          v-for="def in ABILITIES"
          :key="def.key"
          class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
          :aria-pressed="sorts.includes(ABILITY_SORT[def.key])"
          @click="toggleAbility(def.key)"
        >
          {{ def.label }}
        </button>
      </div>

      <!-- 排序优先级链 -->
      <div class="pixel-panel mb-3 p-3">
        <div class="mb-2 flex items-center gap-2">
          <span class="pixel-heading flex items-center gap-1 text-[12px] leading-[1.5]">
            <PxIcon name="sort" :size="12" />
            排序优先级（从上到下，一级 → 末级）
          </span>
          <button
            v-if="sorts.length"
            class="pixel-button ml-auto px-2 py-1 text-[12px] leading-[1.5]"
            @click="pushSorts([])"
          >
            清空排序
          </button>
        </div>

        <p
          v-if="!sorts.length"
          class="pixel-note px-2 py-3 text-[12px] leading-[1.5]"
          style="color: var(--color-parchment-dim)"
        >
          未选择排序，默认按「最新发布」陈列。点上方能力标签或下方「添加排序」开始。
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
              一级
            </span>
            <span class="flex-none text-[12px] leading-[1.5]" style="color: var(--color-parchment-dim)">
              {{ r.dir }}
            </span>
            <div class="ml-auto flex flex-none items-center gap-1">
              <button
                class="pixel-button px-1.5 py-0.5 text-[12px] leading-[1.5]"
                title="切换升/降序"
                @click="toggleDir(r.idx)"
              >
                {{ r.dir === '升' ? '↑' : '↓' }}
              </button>
              <button
                class="pixel-button px-1.5 py-0.5 text-[12px] leading-[1.5]"
                :disabled="r.idx === 0"
                title="提升优先级"
                @click="move(r.idx, -1)"
              >
                <PxIcon name="arrow" :size="10" class="rotate-[-90deg]" />
              </button>
              <button
                class="pixel-button px-1.5 py-0.5 text-[12px] leading-[1.5]"
                :disabled="r.idx === rows.length - 1"
                title="降低优先级"
                @click="move(r.idx, 1)"
              >
                <PxIcon name="arrow" :size="10" class="rotate-90" />
              </button>
              <button
                class="pixel-button px-1.5 py-0.5 text-[12px] leading-[1.5]"
                title="移除该排序"
                @click="removeAt(r.idx)"
              >
                移除
              </button>
            </div>
          </li>
        </ul>

        <!-- 添加排序：只列未选维度 -->
        <div v-if="addable.length" class="mt-2 flex flex-wrap items-center gap-1.5 border-t-2 border-[var(--color-ink)] pt-2">
          <span class="pixel-heading flex items-center gap-1 text-[12px] leading-[1.5]">
            <PxIcon name="dot" :size="8" />
            添加排序
          </span>
          <button
            v-for="d in addable"
            :key="d.dim"
            class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
            @click="addDim(d.dim)"
          >
            + {{ d.label }}
          </button>
        </div>
      </div>
    </SectionFrame>

    <!-- 排序结果：全部机型，不减员 -->
    <SectionFrame :title="`排序结果 · ${ranked.length} 台`" hud="var(--color-crown)" icon="list">
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
                机型
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
                      {{ categoryLabel(categoryOf(p)) }} · {{ subline(p) }}
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
        「未公布」= 官网未公布该参数，按纪律排在所有有值机型之后；不等于 0 或最小。
        榜单不减员，永远展示全部 {{ all.length }} 台。
      </p>
    </SectionFrame>
  </div>
</template>
