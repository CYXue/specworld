<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useDataset, useDerived } from '../lib/useDataset';
import { specGroups } from '../lib/fields';
import { abilityRows } from '../lib/specs';
import {
  SERIES_FALLBACK,
  UNKNOWN,
  basePriceCny,
  categoryOf,
  categoryLabel,
  chipNameLabel,
  fmtPriceCny,
  isFoldable,
  seriesLabel,
  seriesOf,
  variantLabel,
  variantOf,
} from '../lib/catalog';
import {
  DIMENSION_KEYS,
  applyExcept,
  applyFilter,
  applySort,
  buildCatalog,
  emptyFilter,
  facetOf,
  isFiltered,
  readFilter,
  toggleValue,
  writeFilter,
  SORTS_LITE,
} from '../lib/facets';
import type { DimKey, FacetItem, FilterState, SortKey } from '../lib/facets';
import { compareRowState } from '../lib/compare';
import { continentOf } from '../types';
import AbilityBars from '../components/AbilityBars.vue';
import FilterBar from '../components/FilterBar.vue';
import PxIcon from '../components/PxIcon.vue';
import SectionFrame from '../components/SectionFrame.vue';
import SpriteImg from '../components/SpriteImg.vue';
import VendorRoof from '../components/VendorRoof.vue';

/**
 * 机型库 + 对比台（**筛选与对比合并在一页**）。
 *
 * 为什么合并（用户 2026-10-05 要求）：分开时对比页只能看到一个「已选 N 台」的窄列表，
 * 机型一多根本没法挑；而筛选页挑完还得跳去别处才能看对比。合并后是
 * **左边筛、右边比**：筛选条件管列表，勾选管对比台，两者共用同一批机型。
 *
 * 状态全在 URL 里：`?a=品类&b=品牌&s=系列&v=变体&c=芯片&r=内存&y=年份&o=排序&p=已选`
 * —— 刷新不丢，也能分享「苹果折叠屏里挑三台来比」这种链接。
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { ds } = useDataset();
const derived = useDerived();

const DIM_KEYS = [...DIMENSION_KEYS];
const brandLabels = computed(() => new Map((ds.value?.vendors ?? []).map((v) => [v.id, v.nameZh])));
const all = computed(() => ds.value?.products ?? []);

/** ⚠️ 必须从 `route.query` 取，不能读 `location.search`（hash 路由下恒为空串，见 PITFALLS P12）。 */
function toParams(q: Record<string, unknown>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s !== '') p.set(k, s);
  }
  return p;
}

const catalog = computed(() => buildCatalog(all.value, DIM_KEYS, brandLabels.value));
const read = computed(() => readFilter(toParams(route.query), catalog.value));
const filter = computed(() => read.value.filter);
/** 轻量排序条取单级（多级排序是榜单页的事）。默认最新发布。 */
const sort = computed<SortKey>(() => read.value.sorts[0] ?? 'release');

/** 已选进对比台的机型 id（也在 URL 里，便于分享对比链接）。 */
const picked = computed<string[]>(() => {
  const raw = route.query.p;
  const s = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of s.split(',')) {
    const t = id.trim();
    // 非法 id 静默丢弃：手改 URL 不该抛错（与 data 层的 slug 容错一致）
    if (!t || seen.has(t) || !derived.value?.byId(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
});

/**
 * 「只看差异」开关：状态进 URL（?d=1），与本页其他状态同原则——刷新不丢、可分享。
 * 只标差异、**不判好坏**：参数没有客观优劣（轻/重、大/小各有偏好）。
 */
const diffOnly = computed(() => route.query.d === '1');

/**
 * 差异高亮总开关（完整采用准绳 diffHighlightOn）：默认开，?h=0 关——
 * 关掉后是纯中性表格（无底色/竖线/加粗）。与「只看差异」正交：
 * 「只看差异 + 高亮关」= 不带标记的差异行清单。
 */
const highlight = computed(() => route.query.h !== '0');

function setDiffOnly(v: boolean) {
  const q: Record<string, unknown> = { ...route.query };
  if (v) q.d = '1';
  else delete q.d;
  router.replace({ path: '/compare', query: q });
}

function setHighlight(v: boolean) {
  const q: Record<string, unknown> = { ...route.query };
  if (v) delete q.h;
  else q.h = '0';
  router.replace({ path: '/compare', query: q });
}

function push(nextFilter: FilterState, nextPicked: string[], nextSorts: SortKey[] = []) {
  router.replace({
    path: '/compare',
    query: {
      ...writeFilter(nextFilter, nextSorts),
      ...(nextPicked.length ? { p: nextPicked.join(',') } : {}),
      // 保留对比视图设置：切筛选/排序不应冲掉「只看差异」与「高亮」状态
      ...(diffOnly.value ? { d: '1' } : {}),
      ...(highlight.value ? {} : { h: '0' }),
    },
  });
}

function onToggle(dim: DimKey, id: string) {
  push(toggleValue(filter.value, dim, id), picked.value, [sort.value]);
}
function onClearDim(dim: DimKey) {
  push({ ...filter.value, [dim]: [] }, picked.value, [sort.value]);
}
function onReset() {
  push(emptyFilter(), picked.value, [sort.value]);
}
function onSort(s: SortKey) {
  push(filter.value, picked.value, [s]);
}
function togglePick(id: string) {
  const cur = picked.value;
  push(
    filter.value,
    cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    [sort.value],
  );
}
function clearPicked() {
  push(filter.value, [], [sort.value]);
}

/**
 * 筛选结果 = 「机型库」列表。**纯筛选（AND 组合），没有排序功能**（排序是榜单的事）。
 * 仅按发布日期倒序陈列，保证顺序稳定；这不是用户主动的排序，只是默认陈列顺序。
 */
const listed = computed(() => applySort(applyFilter(all.value, filter.value), sort.value));

/** 结果区顶部轻量排序条（辅助，非主打）：单级即可，多级排序交给榜单页。
 *  label 只存 locale 键——存中文就是闸门看不见的硬编码（同 `facets.SORTS` 纪律）。 */
/**
 * 各维度分面。计数按「**其它维度已生效**」算，本维度自身不受限 ——
 * 否则选中「苹果」后芯片分面只剩苹果芯片，就没法改成华为了（一点就锁死）。
 */
const facets = computed<Record<string, FacetItem[]>>(() => {
  const out: Record<string, FacetItem[]> = {};
  for (const d of DIM_KEYS) {
    out[d] = facetOf(all.value, d, applyExcept(all.value, filter.value, d), brandLabels.value);
  }
  return out;
});

const bounds = computed(() => derived.value?.bounds);

// ── 对比台 ──

const pickedProds = computed(() =>
  picked.value.map((id) => derived.value?.byId(id)).filter(Boolean),
) as NonNullable<ReturnType<NonNullable<typeof derived.value>['byId']>>[];

const single = computed(() => (pickedProds.value.length === 1 ? pickedProds.value[0] : null));
const singleRows = computed(() =>
  single.value && bounds.value ? abilityRows(single.value, bounds.value) : [],
);
const singleVendor = computed(() =>
  single.value ? derived.value?.vendors.get(single.value.brand) : undefined,
);

const matrix = computed(() => {
  const list = pickedProds.value;
  if (list.length < 2) return null;
  const seen = new Set<string>();
  const order: Array<{ group: string; label: string }> = [];
  const per = list.map((p) => {
    const m = new Map<string, string>();
    for (const grp of specGroups(p))
      for (const r of grp.rows) {
        const k = `${grp.title}|${r.label}`;
        if (!seen.has(k)) {
          seen.add(k);
          order.push({ group: grp.title, label: r.label });
        }
        m.set(k, r.value);
      }
    return m;
  });
  // 差异判定：完整采用准绳口径（src/lib/compare.ts 纯函数，缺失不参与值比较）——
  // **两种标记**：值不等（different）与 缺失差异（missing：有值 vs 未公布并存）是不同信息，
  // 混成一种会让「官方未公布」被误读成「配置不同」（本数据集 40% 格子未公布）。
  const rows = order.map((o) => {
    const k = `${o.group}|${o.label}`;
    const values = per.map((m) => m.get(k) ?? '—');
    return { ...o, ...compareRowState(values) };
  });
  // 差异行上浮（准绳 sortDiffUp）：组内 isDifferent/isMissing 的行排前面，其余保持原序。
  const floated = [...rows].sort(
    (a, b) => Number(b.different || b.missing) - Number(a.different || a.missing),
  );
  const groups: string[] = [];
  for (const o of floated) if (!groups.includes(o.group)) groups.push(o.group);
  return {
    list,
    per,
    groups,
    order: floated,
    diffCount: rows.filter((r) => r.different || r.missing).length,
  };
});

/** 「只看差异」模式下实际渲染的行（准绳 sortDiffUp 入选条件：值不等或缺失差异）；
 * 组内无差异行时整组隐藏。 */
const visibleOrder = computed(() =>
  !matrix.value
    ? []
    : diffOnly.value
      ? matrix.value.order.filter((r) => r.different || r.missing)
      : matrix.value.order,
);
const visibleGroups = computed(() =>
  matrix.value
    ? matrix.value.groups.filter((g) => visibleOrder.value.some((r) => r.group === g))
    : [],
);

/**
 * 行标记样式（2026-10-13 完整采用准绳三重标识：底色 + 左竖线 + 差异行加粗，不依赖颜色——
 * 用户明确裁决「准绳做得更好，采用准绳建议」；此前单底色是协作铁律失守案例，已纠正）。
 * 两种底色区分两种信息：金 = 配置不同；蓝(lapis) = 公布情况不同（有值 vs 未公布并存）。
 * both 时随准绳取缺失色（missing 优先）。highlight 关 → 纯中性表格。
 */
function rowStyle(o: { different: boolean; missing: boolean }): Record<string, string> {
  if (!highlight.value) return {};
  if (o.missing) {
    return {
      background: 'rgba(74, 127, 212, 0.14)',
      borderLeft: '3px solid var(--color-lapis)',
    };
  }
  if (o.different) {
    return {
      background: 'rgba(242, 201, 76, 0.13)',
      borderLeft: '3px solid var(--color-gold)',
    };
  }
  return {};
}

/** 列表项副标题：系列 · 变体 · 形态 · 芯片，一行说清是谁。 */
function subline(p: (typeof all.value)[number]): string {
  const chip = chipNameLabel(p.chipset?.name ?? '');
  const v = variantOf(p);
  return [
    seriesLabel(seriesOf(p)),
    v === SERIES_FALLBACK ? null : variantLabel(v),
    isFoldable(p) ? t('facet.formValue.foldable') : null,
    chip === UNKNOWN ? null : chip,
  ]
    .filter(Boolean)
    .join(' · ');
}
</script>

<template>
  <div class="page-shell py-6">
    <SectionFrame :title="t('compare.title')" hud="var(--color-west)" icon="compare">
      <p
        class="pixel-note mb-3 px-3 py-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)]"
      >
        {{ t('compare.introBefore') }}
        <span style="color: var(--color-gold)">{{ t('compare.introNoLimit') }}</span
        >{{ t('compare.introAfter') }}
      </p>

      <FilterBar
        :filter="filter"
        :facets="facets"
        :total-count="all.length"
        :shown-count="listed.length"
        :picked-count="pickedProds.length"
        @toggle="onToggle"
        @clear-dim="onClearDim"
        @reset="onReset"
      />
    </SectionFrame>

    <!--
      两栏布局：宽屏「列表 + 对比台」并排，窄屏自动上下堆叠。
      ⚠️ `minmax(0,1fr)` 不能省：grid 子项默认 `min-width:auto`，
      窄屏下会被「精灵图 + 机型名 + 价格 + 详情按钮」的内容宽度顶到 496px，
      整页横向溢出 122px（实测 390px 视口）。与 CANNOT 的固定 padding 是同类坑：
      都是「容器没给出可收缩的宽度下限」。
    -->
    <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <!-- 左：筛选结果（默认列出全部机型） -->
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2
            class="pixel-outline font-pixel text-[24px] leading-[1.5] text-[var(--color-parchment-lit)]"
          >
            {{ isFiltered(filter) ? t('compare.listFiltered') : t('compare.listAll') }}
          </h2>
          <!-- 结果区顶部轻量排序条（京东式，辅助非主打） -->
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="pixel-heading flex items-center gap-1 text-[12px] leading-[1.5]">
              <PxIcon name="sort" :size="12" />
              {{ t('sort.label') }}
            </span>
            <button
              v-for="s in SORTS_LITE"
              :key="s.id"
              class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
              :aria-pressed="sort === s.id"
              @click="onSort(s.id)"
            >
              {{ t(s.labelKey) }}
            </button>
          </div>
        </div>
        <p
          v-if="listed.length === 0"
          class="pixel-note mt-3 px-4 py-8 text-center text-[12px] leading-[1.5]"
          style="color: var(--color-parchment-dim)"
        >
          {{ t('compare.empty') }}
        </p>
        <ul v-else class="mt-3 space-y-1.5">
          <li v-for="p in listed" :key="p.id" class="pixel-row flex items-center gap-2 px-2 py-1.5">
            <input
              :id="`pick-${p.id}`"
              type="checkbox"
              class="h-4 w-4 flex-none accent-[var(--color-gold)]"
              :checked="picked.includes(p.id)"
              @change="togglePick(p.id)"
            />
            <label
              :for="`pick-${p.id}`"
              class="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
            >
              <SpriteImg :id="p.id" class="h-9 w-auto flex-none" />
              <span class="min-w-0 flex-1">
                <span
                  class="block truncate text-[12px] leading-[1.5]"
                  :style="{
                    color:
                      derived?.vendors.get(p.brand)?.accentColor ?? 'var(--color-parchment-lit)',
                  }"
                >
                  {{ p.name }}
                </span>
                <span
                  class="block truncate text-[12px] leading-[1.5]"
                  style="color: var(--color-parchment-dim)"
                >
                  {{ subline(p) }} · {{ p.releaseDate }}
                </span>
              </span>
              <span
                class="flex-none text-[12px] leading-[1.5]"
                style="color: var(--color-parchment)"
              >
                {{ fmtPriceCny(basePriceCny(p)) }}
              </span>
            </label>
            <RouterLink
              :to="`/product/${p.id}`"
              class="pixel-button flex-none px-2 py-1 text-[12px] leading-[1.5]"
            >
              {{ t('common.detail') }}
            </RouterLink>
          </li>
        </ul>
      </div>

      <!-- 右：对比台（窄屏时自然落到下方） -->
      <aside class="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <div class="pixel-panel p-3">
          <div class="mb-2 flex items-center gap-2">
            <h2
              class="pixel-outline font-pixel text-[24px] leading-[1.5] text-[var(--color-parchment-lit)]"
            >
              {{ t('compare.panelTitle') }}
            </h2>
            <span
              class="pixel-chip px-2 py-0.5 text-[12px] leading-[1.5]"
              style="color: var(--color-west)"
            >
              {{ t('common.countUnits', { n: pickedProds.length }) }}
            </span>
            <button
              v-if="pickedProds.length"
              class="pixel-button ml-auto px-2 py-1 text-[12px] leading-[1.5]"
              @click="clearPicked"
            >
              {{ t('filter.clear') }}
            </button>
          </div>

          <p
            v-if="!pickedProds.length"
            class="pixel-note px-3 py-4 text-center text-[12px] leading-[1.5]"
            style="color: var(--color-parchment-dim)"
          >
            {{ t('compare.panelEmpty1') }}<br />
            {{ t('compare.panelEmpty2') }}
          </p>

          <template v-else>
            <ul class="mb-2 space-y-1">
              <li
                v-for="p in pickedProds"
                :key="p.id"
                class="pixel-row-flat flex items-center gap-2 px-2 py-1"
              >
                <SpriteImg :id="p.id" class="h-7 w-auto flex-none" />
                <span
                  class="min-w-0 flex-1 truncate text-[12px] leading-[1.5] text-[var(--color-parchment-lit)]"
                >
                  {{ p.name }}
                </span>
                <button
                  class="pixel-button flex-none px-1.5 py-0.5 text-[12px] leading-[1.5]"
                  :aria-label="t('compare.removeAria', { name: p.name })"
                  @click="togglePick(p.id)"
                >
                  {{ t('common.remove') }}
                </button>
              </li>
            </ul>

            <!-- 1 台：直接给详情，不逼用户「再选一台才能看到东西」 -->
            <template v-if="single">
              <div class="mb-2 flex flex-col items-center gap-1.5">
                <VendorRoof
                  :color="singleVendor?.accentColor ?? 'var(--color-gold)'"
                  :continent="continentOf(singleVendor)"
                />
                <SpriteImg :id="single.id" class="h-20 w-auto" />
                <RouterLink
                  :to="`/product/${single.id}`"
                  class="text-center text-[12px] leading-[1.5] text-[var(--color-parchment-lit)]"
                >
                  {{ single.name }}
                </RouterLink>
                <span class="flex flex-wrap justify-center gap-1">
                  <span
                    class="pixel-chip px-1.5 py-0.5 text-[12px]"
                    style="color: var(--color-parchment-dim)"
                  >
                    {{ categoryLabel(categoryOf(single)) }}
                  </span>
                  <span
                    class="pixel-chip px-1.5 py-0.5 text-[12px]"
                    style="color: var(--color-parchment-dim)"
                  >
                    {{ seriesLabel(seriesOf(single)) }}
                  </span>
                  <span
                    class="pixel-chip px-1.5 py-0.5 text-[12px]"
                    style="color: var(--color-parchment-dim)"
                  >
                    {{ fmtPriceCny(basePriceCny(single)) }}
                  </span>
                </span>
              </div>
              <AbilityBars :rows="singleRows" :hud="singleVendor?.accentColor" />
              <RouterLink
                :to="`/product/${single.id}`"
                class="pixel-button mt-2 flex items-center justify-center gap-1 px-2 py-1 text-[12px] leading-[1.5]"
              >
                {{ t('compare.openDetail') }}
                <PxIcon name="arrow" :size="10" />
              </RouterLink>
            </template>

            <p
              v-else
              class="pixel-note px-3 py-3 text-center text-[12px] leading-[1.5]"
              style="color: var(--color-parchment-dim)"
            >
              {{ t('compare.multiHint', { n: pickedProds.length }) }}
            </p>
          </template>
        </div>
      </aside>
    </div>

    <!-- 多选对比表：全宽展开（1 台时不存在） -->
    <div v-if="matrix" class="mt-6">
      <SectionFrame
        :title="t('compare.matrixTitle', { n: matrix.list.length })"
        hud="var(--color-west)"
        icon="compare"
      >
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <span class="pixel-heading text-[12px] leading-[1.5]">{{ t('compare.display') }}</span>
          <button
            class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
            :aria-pressed="!diffOnly"
            @click="setDiffOnly(false)"
          >
            {{ t('compare.allItems', { n: matrix.order.length }) }}
          </button>
          <button
            class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
            :aria-pressed="diffOnly"
            @click="setDiffOnly(true)"
          >
            {{ t('compare.diffOnly', { n: matrix.diffCount }) }}
          </button>
          <span class="mx-1 h-4 w-px" style="background: var(--color-ink)" />
          <button
            class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
            :aria-pressed="highlight"
            @click="setHighlight(!highlight)"
          >
            {{ highlight ? t('compare.highlightOn') : t('compare.highlightOff') }}
          </button>
        </div>
        <div class="mb-3 overflow-x-auto">
          <table
            class="w-full border-collapse text-[12px]"
            :style="{ minWidth: `${Math.max(560, matrix.list.length * 220 + 120)}px` }"
          >
            <thead>
              <tr>
                <th
                  class="sticky left-0 z-1 w-28 border-2 border-[var(--color-ink)] bg-[var(--color-panel-lit)] p-2 text-left"
                  style="color: var(--color-parchment-dim)"
                >
                  {{ t('compare.modelHeader') }}
                </th>
                <th
                  v-for="p in matrix.list"
                  :key="p.id"
                  class="border-2 border-[var(--color-ink)] bg-[var(--color-panel-lit)] p-2"
                >
                  <div class="flex flex-col items-center gap-1">
                    <RouterLink :to="`/product/${p.id}`">
                      <SpriteImg :id="p.id" class="h-14 w-auto" />
                    </RouterLink>
                    <RouterLink
                      :to="`/product/${p.id}`"
                      class="text-center text-[12px] leading-[1.5] text-[var(--color-parchment-lit)]"
                    >
                      {{ p.name }}
                    </RouterLink>
                    <span class="text-[12px] leading-[1.5]" style="color: var(--color-parchment)">
                      {{ fmtPriceCny(basePriceCny(p)) }}
                    </span>
                    <button
                      class="pixel-button px-1.5 py-0.5 text-[12px] leading-[1.5]"
                      :aria-label="t('compare.removeAria', { name: p.name })"
                      @click="togglePick(p.id)"
                    >
                      {{ t('common.remove') }}
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <template v-for="g in visibleGroups" :key="g">
              <tr>
                <th
                  colspan="99"
                  class="border-x-2 border-b-0 border-[var(--color-ink)] bg-[var(--color-ink)] px-2 py-1 text-left text-[12px] leading-[1.5]"
                  style="color: var(--color-gold)"
                >
                  {{ g }}
                </th>
              </tr>
              <tr v-for="o in visibleOrder.filter((x) => x.group === g)" :key="o.label">
                <td
                  class="sticky left-0 z-1 border-2 border-[var(--color-ink)] bg-[var(--color-panel)] px-2 py-1"
                  :style="rowStyle(o)"
                >
                  {{ o.label }}
                </td>
                <td
                  v-for="(m, i) in matrix.per"
                  :key="i"
                  class="border-2 border-[var(--color-ink)] bg-[var(--color-panel)] px-2 py-1"
                  :style="{
                    ...rowStyle(o),
                    color:
                      m.get(`${o.group}|${o.label}`) === '—'
                        ? 'var(--color-ink-soft)'
                        : 'var(--color-parchment-lit)',
                    fontWeight: highlight && o.different ? 600 : 400,
                  }"
                >
                  {{ m.get(`${o.group}|${o.label}`) ?? '—' }}
                </td>
              </tr>
            </template>
          </table>
        </div>
        <p class="pixel-note px-3 py-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)]">
          {{ t('compare.noteDash') }}<br />
          {{ t('compare.noteGoldBefore') }}<b style="color: var(--color-gold)">{{
            t('compare.noteGold')
          }}</b
          >{{ t('compare.noteLapisBefore') }}<b style="color: var(--color-lapis)">{{
            t('compare.noteLapis')
          }}</b
          >{{ t('compare.noteA11y') }}<br />
          {{ t('compare.noteNoVerdict') }}
        </p>
      </SectionFrame>
    </div>
  </div>
</template>
