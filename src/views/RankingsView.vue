<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '../i18n';
import { useChunkedList } from '../lib/useChunkedList';
import { ABILITIES, abilityLabel, abilityRaw, fmtAbility } from '../lib/specs';
import { useDataset } from '../lib/useDataset';
import LoadingState from '../components/LoadingState.vue';
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
import type { Product } from '../types';
import {
  CATEGORY_ORDER,
  basePriceCny,
  categoryLabel,
  categoryOf,
  fmtPriceCny,
  productSubline,
} from '../lib/catalog';
import PriceTag from '../components/PriceTag.vue';

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
 *
 * 2026-10-16 二轮优化（评审反馈「榜单最不像榜单」）：从「大说明面板 + 宽表格」
 * 改为「紧凑控制条 + 高密度列表（默认）/ 宽表格（切换）」——排序优先级链收成 chips，
 * 多级编辑与快捷入口进可展开面板，结果第一屏就可见。
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

// 品类范围（URL `a`，与设备库同一参数语义）+ 在售范围（URL `scope=onsale`）。
// **先定比较范围，再选指标**：不同品类的可用参数完全不同（电池容量只有手机有数据、
// 主摄像素几乎全缺），把全部品类混在一起排「主摄像素」会得到一堆「未公布」。
// 维度名是 `category`（`a` 只是它的 URL 参数字母，见 facets.ts 的 PARAM 映射）——
// 传错会导致 readFilter 的合法值集为空、品类被静默丢弃。
const catalog = computed(() => buildCatalog(all.value, ['category'], brandLabels.value));
const rf = computed(() => readFilter(toParams(route.query), catalog.value));
/** 排序优先级链（来自 URL `o`，逗号分隔；缺失/非法值已被 readFilter 丢弃）。 */
const sorts = computed<SortKey[]>(() => rf.value.sorts);
/** 比较范围：品类（空串 = 全部收录）。 */
const cat = computed(() => rf.value.filter.category[0] ?? '');
/** 在售范围：`onsale` = 仅在售；其余 = 全部收录。 */
const onsaleOnly = computed(() => route.query.scope === 'onsale');

const scopeCatOptions = computed(() =>
  CATEGORY_ORDER.filter((c) => all.value.some((p) => categoryOf(p) === c.id)),
);

/** 按品类 + 在售范围过滤后的比较池。 */
const scoped = computed(() =>
  all.value.filter(
    (p) =>
      (!cat.value || categoryOf(p) === cat.value) &&
      (!onsaleOnly.value || p.status === 'on-sale'),
  ),
);

/**
 * 各排序维度在**当前比较池**里的真实覆盖率（从数据现算，不硬编品类→指标表）：
 * 覆盖 ≥ max(3 台, 20%) 才算适用，否则按钮不出现——点了只会得到一列「未公布」。
 */
const dimAvailable = computed(() => {
  const pool = scoped.value;
  const min = Math.max(3, Math.ceil(pool.length * 0.2));
  const count = (fn: (p: (typeof pool)[number]) => boolean) => pool.filter(fn).length;
  return {
    price: count(hasValueForDim.bind(null, 'price')) >= min,
    ppi: count(hasValueForDim.bind(null, 'ppi')) >= min,
    weight: count(hasValueForDim.bind(null, 'weight')) >= min,
    battery: count(hasValueForDim.bind(null, 'battery')) >= min,
    camera: count(hasValueForDim.bind(null, 'camera')) >= min,
  } as Record<string, boolean>;
});

/** 排序维度 → 扁平 specs 键（price 走 skus，见 hasValueForDim）。 */
const DIM_SPEC_KEY: Record<string, string> = {
  ppi: 'display.ppi',
  weight: 'body.weightG',
  battery: 'battery.capacityMah',
  camera: 'camera.mp',
};

/** 某台设备在某个维度上是否有值（price 看 skus，其余看扁平 specs）。 */
function hasValueForDim(dim: string, p: Product): boolean {
  if (dim === 'price') return Array.isArray(p.skus) && p.skus.some((s) => s.priceCny != null);
  const key = DIM_SPEC_KEY[dim];
  return key ? typeof (p.specs ?? {})[key] === 'number' : true;
}

/** 链首（主）排序维度；空链 = release（发布日期人人有值）。 */
const primaryDim = computed(() => sorts.value[0]?.split('-')[0] ?? 'release');

/** 主排序维度上有值的台数——解释「为什么榜单末尾一段没有数值」。 */
const valuedCount = computed(() =>
  primaryDim.value === 'release'
    ? scoped.value.length
    : scoped.value.filter((p) => hasValueForDim(primaryDim.value, p)).length,
);

/**
 * 链里在当前范围**不再适用**的排序（如分享链接带着 `camera-desc` 打开了显示器品类）：
 * 从链里剔除并给提示，不静默——用户该知道「刚才的排序去哪了」。
 */
const droppedSorts = computed(() =>
  sorts.value.filter((s) => {
    const d = s.split('-')[0];
    return d !== 'release' && !dimAvailable.value[d];
  }),
);
const effectiveSorts = computed(() => sorts.value.filter((s) => !droppedSorts.value.includes(s)));

/** 按优先级链排序后的比较池（范围内不减员）。空链/链全部失效 = 回退发布日期。 */
const ranked = computed(() => applyMultiSort(scoped.value, effectiveSorts.value));

/** 裸访问（无 a 无 o）：默认「手机品类 + 电池容量 大→小」——打开就是一份有效排序结果。 */
onMounted(() => {
  if (!route.query.a && !route.query.o) {
    router.replace({ path: '/rankings', query: { a: 'phone', o: 'battery-desc' } }).catch(() => {});
  }
});

/** 分批渲染（同机型库）：913 行全直出会压垮低端机。切渲染不动排序语义。 */
const { shownList: rankedShown, total: rankedTotal, hasMore, showMore } = useChunkedList(ranked, 60);

// 视图：默认高密度列表（桌面数据分析才切宽表格）。与机型库一致用本地状态，不进 URL。
const view = ref<'list' | 'table'>('list');
// 排序面板展开态（无排序时模板层强制展开，见 v-if）
const panelOpen = ref(false);

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

/** 已选优先级的展示行（用 effectiveSorts：失效排序已剔除并提示，不再进链）。 */
const rows = computed(() =>
  effectiveSorts.value.map((sort, idx) => ({
    idx,
    sort,
    labelKey: SORT_LABEL.get(sort) ?? null,
    label: SORT_LABEL.get(sort) ? t(SORT_LABEL.get(sort)!) : sort,
    dim: sort.split('-')[0],
    asc: sort.endsWith('-asc'),
    isPrimary: idx === 0,
  })),
);

/**
 * 列表视图的值列：有排序链时按链展示；**没有排序时回退发布日期**——
 * 否则行尾只剩一个价格，「按什么排的」看不出来。chips 即列头。
 */
const valueCols = computed(() =>
  rows.value.length
    ? rows.value
    : [{ idx: -1, sort: 'release' as SortKey, label: '', asc: false, isPrimary: true, dim: 'release', labelKey: null }],
);

const presentDims = computed(() => new Set(sorts.value.map((s) => s.split('-')[0])));
// 可添加 = 未在链上 **且** 当前比较池里真实覆盖（覆盖率不足的指标不出现，点了只会一列「未公布」）
const addable = computed(() =>
  DIM_OPTIONS.filter((d) => !presentDims.value.has(d.dim) && dimAvailable.value[d.dim]),
);
/** 快捷能力按钮同样按可用性过滤（如「影像」在比较池里几乎无数据就不出现）。 */
const quickAbilities = computed(() =>
  ABILITIES.filter((def) => {
    const dim = ABILITY_SORT[def.key]?.split('-')[0];
    return dim ? dimAvailable.value[dim] : false;
  }),
);

// ── 标题行：主排序、有值数量（控件自己解释操作，不靠长说明） ──

/** 第二行：「按电池容量从大到小」（主排序方向）；空链 = 按最新发布。 */
const headlineSort = computed(() => {
  const r = rows.value[0];
  if (!r) return t('rank.sortRelease');
  return t(r.asc ? 'rank.sortAsc' : 'rank.sortDesc', { metric: r.label });
});

// ── 动作 ──

/** 写 URL：保留当前比较范围（品类 + 在售范围），只替换排序链。 */
function pushSorts(next: SortKey[]) {
  const q = writeFilter(emptyFilter(), next);
  if (cat.value) q.a = cat.value;
  if (onsaleOnly.value) q.scope = 'onsale';
  router.replace({ path: '/rankings', query: q });
}

/** 切换比较范围：清空排序链（旧链在新范围里未必适用），保留新范围。 */
function pushScope(nextCat: string, nextOnsale: boolean) {
  const q = writeFilter(emptyFilter(), []);
  if (nextCat) q.a = nextCat;
  if (nextOnsale) q.scope = 'onsale';
  router.replace({ path: '/rankings', query: q });
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

/** 主排序维度的原始数值（rank 与数值条共用；release 无数值 → null） */
function primaryValue(p: Product): number | null {
  if (primaryDim.value === 'release') return null;
  if (primaryDim.value === 'price') return basePriceCny(p);
  const ak = ABILITY_OF_DIM[primaryDim.value];
  const raw = ak ? abilityRaw(p, ak) : null;
  return raw == null ? null : Number(raw);
}

/**
 * 并列名次（competition ranking，评审 2026-10-17：8500 出现两次却编 1/2/3，
 * 用户会怀疑排错了）。sorted 已按主排序排好，相同值并列同号、下一名跳号
 * （1 · 1 · 3）；无值段记 0（模板层渲染「—」，不占名次）。
 */
const primaryRanks = computed<Map<string, number>>(() => {
  const map = new Map<string, number>();
  if (primaryDim.value === 'release') {
    ranked.value.forEach((p, i) => map.set(p.id, i + 1));
    return map;
  }
  let last: number | null = null;
  let rank = 0;
  ranked.value.forEach((p, i) => {
    const v = primaryValue(p);
    if (v == null) {
      map.set(p.id, 0);
      return;
    }
    if (last == null || v !== last) rank = i + 1;
    last = v;
    map.set(p.id, rank);
  });
  return map;
});

/** 数值条比例尺：主排序维度有值段的最大值（0 防御） */
const primaryMax = computed<number | null>(() => {
  let max: number | null = null;
  for (const p of scoped.value) {
    const v = primaryValue(p);
    if (v != null && (max == null || v > max)) max = v;
  }
  return max && max > 0 ? max : null;
});

/** 主排序数值条的宽度百分比（升序维度（weight-asc）越小越好，条长仍按绝对值画——条是量级，不是优劣） */
function barPct(p: Product): number | null {
  const v = primaryValue(p);
  if (v == null || primaryMax.value == null) return null;
  return Math.max(2, Math.round((v / primaryMax.value) * 100));
}
</script>

<template>
  <div class="page-shell space-y-5 py-6">
    <!-- 标题行：控件自己解释操作。长说明收成一句，多级细节进「排序规则」帮助 -->
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-fg">{{ t('rank.title') }}</h1>
        <p class="mt-1 text-[13px] text-dim">{{ t('rank.introShort') }}</p>
      </div>
      <details class="text-sm text-dim">
        <summary class="cursor-pointer hover:text-fg">{{ t('rank.helpTitle') }}</summary>
        <p class="mt-1 max-w-sm text-[13px]">{{ t('rank.helpBody') }}</p>
      </details>
    </div>

    <!-- 结果标题：范围选择（控件）→ 主排序 → 有值数量（结论），一行说完不再重复 -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <select
            class="input h-8 w-auto py-0 text-sm font-semibold text-fg"
            :value="cat"
            :aria-label="t('rank.category')"
            @change="pushScope(($event.target as HTMLSelectElement).value, onsaleOnly)"
          >
            <option value="">{{ t('rank.scopeAll') }}</option>
            <option v-for="c in scopeCatOptions" :key="c.id" :value="c.id">{{ categoryLabel(c.id) }}</option>
          </select>
          <span
            class="num text-lg font-bold text-fg"
            :title="onsaleOnly ? t('rank.scopeOnSale') : t('rank.scopeAll')"
            role="button"
            tabindex="0"
            @click="pushScope(cat, !onsaleOnly)"
            @keydown.enter="pushScope(cat, !onsaleOnly)"
          >{{ headlineSort }}</span>
          <span class="text-[13px] text-dim">{{ onsaleOnly ? t('rank.scopeOnSale') : t('rank.scopeAll') }}</span>
        </div>
        <p class="text-[13px] text-dim">
          {{ t('rank.valueSummary', { total: scoped.length, n: valuedCount }) }}
        </p>
      </div>
      <div class="flex overflow-hidden rounded border border-border-strong">
        <button
          type="button"
          class="px-2.5 py-1.5 text-sm"
          :class="view === 'list' ? 'bg-surface-2 text-fg' : 'text-dim'"
          :aria-label="t('rank.viewList')"
          :aria-pressed="view === 'list'"
          @click="view = 'list'"
        >
          ☰
        </button>
        <button
          type="button"
          class="px-2.5 py-1.5 text-sm"
          :class="view === 'table' ? 'bg-surface-2 text-fg' : 'text-dim'"
          :aria-label="t('rank.viewTable')"
          :aria-pressed="view === 'table'"
          @click="view = 'table'"
        >
          ▦
        </button>
      </div>
    </div>

    <!-- 失效排序提示：分享链接带着当前范围不适用的指标打开时，明确告知而不是静默消失 -->
    <div
      v-if="droppedSorts.length"
      class="rounded-md border border-accent/40 bg-surface-2 px-3 py-2 text-[13px] text-dim"
      role="status"
    >
      {{ t('rank.droppedNotice', { n: droppedSorts.length }) }}
    </div>

    <!-- 数据未就绪：加载态（否则空链 + 「0 台」会被误读成「没有数据」） -->
    <LoadingState v-if="!ds" :label="t('common.loading')" />
    <template v-else>
    <!-- 排序控制条：范围选择已并入上方标题行（重复入口曾让人犹豫「改哪个才对」）；
         这里只管排序链本身 -->
    <section class="card p-3 sm:p-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="kicker">{{ t('rank.priority') }}</span>
        <template v-if="sorts.length">
          <!-- 中性描边 chips：序号用小方块，金色不再用于「已选条件」 -->
          <span v-for="r in rows" :key="r.idx" class="chip">
            <span
              class="grid h-4 w-4 flex-none place-items-center rounded-sm bg-surface-2 text-[10px] font-bold text-dim"
              :class="r.isPrimary ? 'text-fg' : ''"
            >{{ r.idx + 1 }}</span>
            {{ r.label }}
            <button
              type="button"
              class="px-0.5 font-bold text-dim hover:text-fg"
              :title="t('rank.toggleDir')"
              :aria-label="t('rank.toggleDir')"
              @click="toggleDir(r.idx)"
            >{{ r.asc ? '↑' : '↓' }}</button>
            <button
              type="button"
              class="tag-remove"
              :aria-label="t('rank.removeSort')"
              :title="t('rank.removeSort')"
              @click="removeAt(r.idx)"
            >
              ×
            </button>
          </span>
          <button type="button" class="btn btn-ghost px-2 py-1 text-sm" @click="pushSorts([])">
            {{ t('rank.clearSorts') }}
          </button>
        </template>
        <span
          v-else
          class="chip"
          :class="'border-accent text-accent'"
          :title="t('rank.noSorts')"
        >
          <span class="grid h-4 w-4 flex-none place-items-center rounded-sm bg-accent-soft text-[10px] font-bold">1</span>
          {{ t('sort.release') }} ↓
        </span>
        <button
          type="button"
          class="btn btn-subtle ml-auto px-3 py-1.5 text-sm"
          :aria-expanded="panelOpen"
          @click="panelOpen = !panelOpen"
        >
          + {{ t('rank.addSort') }}
        </button>
      </div>

      <!-- 展开面板：四个能力维度快捷 + 可选维度添加 + 优先级微调（升降级）。
           无排序时自动展开——第一屏就要能看出「怎么开始排」。 -->
      <div v-if="panelOpen || !sorts.length" class="mt-3 border-t border-border pt-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[13px] text-dim">{{ t('rank.quickAdd') }}</span>
          <button
            v-for="def in quickAbilities"
            :key="def.key"
            type="button"
            class="btn px-3 py-1.5 text-sm"
            :class="sorts.includes(ABILITY_SORT[def.key]) ? 'btn-primary' : 'btn-subtle'"
            :aria-pressed="sorts.includes(ABILITY_SORT[def.key])"
            @click="toggleAbility(def.key)"
          >
            {{ abilityLabel(def.key) }}
          </button>
        </div>

        <div v-if="addable.length" class="mt-2 flex flex-wrap items-center gap-2">
          <span class="text-[13px] text-dim">{{ t('rank.addSort') }}</span>
          <button
            v-for="d in addable"
            :key="d.dim"
            type="button"
            class="btn btn-subtle px-3 py-1.5 text-sm"
            @click="addDim(d.dim)"
          >
            + {{ t(d.labelKey) }}
          </button>
        </div>

        <!-- 动态隐藏指标的解释：用户切了品类后找不到刚才的按钮，得有个找得到的答案 -->
        <p class="mt-2 text-xs text-faint">{{ t('rank.hiddenHint') }}</p>

        <!-- 多级优先级微调：chips 只做总览，方向与顺序的精细操作在这里 -->
        <ul v-if="rows.length" class="mt-3 space-y-1.5 border-t border-border pt-3">
          <li v-for="r in rows" :key="r.idx" class="flex flex-wrap items-center gap-2 text-sm">
            <span
              class="grid h-6 w-6 flex-none place-items-center rounded text-sm font-semibold"
              :class="r.isPrimary ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-dim'"
            >
              {{ r.idx + 1 }}
            </span>
            <span class="font-medium text-fg">{{ r.label }}</span>
            <span class="text-dim">{{ r.asc ? t('rank.asc') : t('rank.desc') }}</span>
            <span v-if="r.isPrimary" class="badge border border-accent/40 text-accent">{{ t('rank.primary') }}</span>
            <div class="ml-auto flex flex-none items-center gap-1">
              <button
                type="button"
                class="btn btn-ghost px-2 py-1 text-sm"
                :title="t('rank.toggleDir')"
                @click="toggleDir(r.idx)"
              >
                ↕
              </button>
              <button
                type="button"
                class="btn btn-ghost px-2 py-1 text-sm"
                :disabled="r.idx === 0"
                :title="t('rank.promote')"
                @click="move(r.idx, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="btn btn-ghost px-2 py-1 text-sm"
                :disabled="r.idx === rows.length - 1"
                :title="t('rank.demote')"
                @click="move(r.idx, 1)"
              >
                ↓
              </button>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- 排序结果：全部机型，不减员。默认高密度列表；列名直接标在表头，不必回控制栏确认 -->
    <section v-if="view === 'list'" class="card divide-y divide-border">
      <!-- 列头：与数据行同一套栅格（序号 / 设备 / 排序值列 / 官方起售价） -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px] text-faint">
        <span class="w-10 flex-none text-right">#</span>
        <span class="min-w-0 flex-1">{{ t('rank.colDevice') }}</span>
        <span v-for="r in valueCols" :key="r.sort" class="shrink-0" :class="r.isPrimary ? 'text-accent' : ''">
          {{ r.label || t('sort.release') }} {{ r.asc ? '↑' : '↓' }}
        </span>
        <span class="w-20 shrink-0 text-right">{{ t('facet.price') }}</span>
      </div>
      <template v-for="(p, i) in rankedShown" :key="p.id">
        <!-- 缺值分隔线：解释「从这里开始没有数值」，序号不构成完整名次 -->
        <div
          v-if="i === valuedCount && valuedCount < ranked.length"
          class="bg-surface-2 px-4 py-1.5 text-[13px] text-faint"
        >
          {{ t('rank.missingDivider') }}
        </div>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-surface-2">
          <span class="w-10 flex-none text-right">
            <span
              class="num inline-block rounded-[3px] px-1.5 py-0.5 text-sm font-semibold"
              :class="[
                (primaryRanks.get(p.id) ?? 0) > 0 && (primaryRanks.get(p.id) ?? 0) <= 3 && primaryDim !== 'release'
                  ? 'bg-accent-soft text-accent'
                  : 'text-faint',
              ]"
            >{{ (primaryRanks.get(p.id) ?? 0) > 0 ? primaryRanks.get(p.id) : '—' }}</span>
          </span>
          <span class="min-w-0 flex-1">
            <RouterLink
              :to="`/product/${p.id}`"
              class="block truncate text-[15px] font-semibold text-fg hover:text-link"
            >
              {{ p.name }}
            </RouterLink>
            <span class="block truncate text-[13px] text-dim">
              {{ categoryLabel(categoryOf(p)) }} · {{ productSubline(p) }}
            </span>
          </span>
          <span
            v-for="r in valueCols"
            :key="r.sort"
            class="shrink-0"
            :class="cell(p, r.sort).missing ? 'text-faint' : 'text-fg'"
          >
            <!-- 主排序列：值 + 行内微型数值条（量级一眼可比；中性色，金色不给数值） -->
            <span v-if="r.isPrimary && barPct(p) != null" class="flex items-center gap-2">
              <span class="num text-sm" :class="cell(p, r.sort).missing ? 'text-faint' : 'text-fg'">{{ cell(p, r.sort).text }}</span>
              <span class="hidden h-1.5 w-16 overflow-hidden rounded bg-surface-2 sm:inline-block" aria-hidden="true">
                <span class="block h-full rounded bg-border-strong" :style="{ width: barPct(p) + '%' }" />
              </span>
            </span>
            <span v-else class="num text-sm">{{ cell(p, r.sort).text }}</span>
          </span>
          <PriceTag :product="p" size="md" class="w-20 shrink-0 text-right" />
        </div>
      </template>
      <div v-if="hasMore" class="flex flex-col items-center gap-1.5 px-4 py-4">
        <button type="button" class="btn btn-ghost px-4 py-1.5 text-sm" @click="showMore">
          {{ t('common.showMore') }}
        </button>
        <span class="text-sm text-dim">
          {{ t('common.shownOf', { shown: rankedShown.length, total: rankedTotal }) }}
        </span>
      </div>
    </section>

    <!-- 宽表格：桌面端数据分析用，用户主动切换 -->
    <section v-else class="card p-4">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-sm" style="min-width: 640px">
          <thead>
            <tr>
              <th class="border-b border-border-strong p-2 text-left text-dim">#</th>
              <th class="border-b border-border-strong p-2 text-left text-dim">
                {{ t('compare.modelHeader') }}
              </th>
              <th
                v-for="r in rows"
                :key="r.sort"
                class="border-b border-border-strong p-2 text-left"
                :class="r.isPrimary ? 'text-accent' : 'text-dim'"
              >
                {{ r.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(p, i) in rankedShown"
              :key="p.id"
              class="border-b border-border hover:bg-surface-2"
            >
              <td class="p-2 text-dim">{{ i + 1 }}</td>
              <td class="p-2">
                <div class="flex items-center gap-3">
                  <div class="min-w-0">
                    <RouterLink
                      :to="`/product/${p.id}`"
                      class="block truncate text-sm font-medium text-fg hover:text-link"
                    >
                      {{ p.name }}
                    </RouterLink>
                    <span class="block truncate text-xs text-dim">
                      {{ categoryLabel(categoryOf(p)) }} · {{ productSubline(p) }}
                    </span>
                  </div>
                </div>
              </td>
              <td
                v-for="r in rows"
                :key="r.sort"
                class="p-2"
                :class="cell(p, r.sort).missing ? 'text-faint' : 'text-fg'"
              >
                {{ cell(p, r.sort).text }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="hasMore" class="mt-4 flex flex-col items-center gap-1.5">
        <button type="button" class="btn btn-ghost px-4 py-1.5 text-sm" @click="showMore">
          {{ t('common.showMore') }}
        </button>
        <span class="text-sm text-dim">
          {{ t('common.shownOf', { shown: rankedShown.length, total: rankedTotal }) }}
        </span>
      </div>
    </section>

    <p class="text-[13px] text-dim">
      {{ t('rank.noteA') }}
      {{ t('rank.noteB', { n: scoped.length }) }}
    </p>
    </template>
  </div>
</template>
