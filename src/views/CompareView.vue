<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDataset, useDerived } from '../lib/useDataset';
import { specGroups } from '../lib/fields';
import { abilityRows } from '../lib/specs';
import {
  basePriceCny,
  categoryOf,
  categoryLabel,
  chipNameLabel,
  fmtPriceCny,
  isFoldable,
  seriesOf,
  variantOf,
} from '../lib/catalog';
import {
  DIMENSIONS,
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
} from '../lib/facets';
import type { DimKey, FacetItem, FilterState, SortKey } from '../lib/facets';
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
const route = useRoute();
const router = useRouter();
const { ds } = useDataset();
const derived = useDerived();

const DIM_KEYS = DIMENSIONS.map((d) => d.key);
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

function push(nextFilter: FilterState, nextPicked: string[], nextSorts: SortKey[] = []) {
  router.replace({
    path: '/compare',
    query: {
      ...writeFilter(nextFilter, nextSorts),
      ...(nextPicked.length ? { p: nextPicked.join(',') } : {}),
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

/** 结果区顶部轻量排序条（辅助，非主打）：单级即可，多级排序交给榜单页。 */
const SORTS_LITE: Array<{ id: SortKey; label: string }> = [
  { id: 'release', label: '最新' },
  { id: 'price-asc', label: '价格 ↑' },
  { id: 'price-desc', label: '价格 ↓' },
  { id: 'battery-desc', label: '续航' },
  { id: 'ppi-desc', label: '屏幕' },
  { id: 'weight-asc', label: '轻薄' },
  { id: 'camera-desc', label: '影像' },
];

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
  const order: Array<{ group: string; label: string }> = [];
  const seen = new Set<string>();
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
  const groups: string[] = [];
  for (const o of order) if (!groups.includes(o.group)) groups.push(o.group);
  return { list, per, groups, order };
});

/** 列表项副标题：系列 · 变体 · 形态 · 芯片，一行说清是谁。 */
function subline(p: (typeof all.value)[number]): string {
  const chip = chipNameLabel(p.chipset?.name ?? '');
  return [
    seriesOf(p),
    variantOf(p) === '标准' ? null : variantOf(p),
    isFoldable(p) ? '折叠屏' : null,
    chip === '未公布' ? null : chip,
  ]
    .filter(Boolean)
    .join(' · ');
}
</script>

<template>
  <div class="page-shell py-6">
    <SectionFrame title="机型库 · 筛选与对比" hud="var(--color-west)" icon="compare">
      <p
        class="pixel-note mb-3 px-3 py-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)"
      >
        先筛出想要的机型，再勾左侧方块加入对比：勾 1 台看完整详情，勾 2 台以上并排对比，
        <span style="color: var(--color-gold)">不限台数</span>。条件与已选项都在网址里，可直接分享。
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
            {{ isFiltered(filter) ? '筛选结果' : '全部机型' }}
          </h2>
          <!-- 结果区顶部轻量排序条（京东式，辅助非主打） -->
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="pixel-heading flex items-center gap-1 text-[12px] leading-[1.5]">
              <PxIcon name="sort" :size="12" />
              排序
            </span>
            <button
              v-for="s in SORTS_LITE"
              :key="s.id"
              class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
              :aria-pressed="sort === s.id"
              @click="onSort(s.id)"
            >
              {{ s.label }}
            </button>
          </div>
        </div>
        <p
          v-if="listed.length === 0"
          class="pixel-note mt-3 px-4 py-8 text-center text-[12px] leading-[1.5]"
          style="color: var(--color-parchment-dim)"
        >
          没有符合条件的机型 —— 放宽某个条件试试（每个维度的「全部」只清该维度）。
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
              详情
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
              对比台
            </h2>
            <span
              class="pixel-chip px-2 py-0.5 text-[12px] leading-[1.5]"
              style="color: var(--color-west)"
            >
              {{ pickedProds.length }} 台
            </span>
            <button
              v-if="pickedProds.length"
              class="pixel-button ml-auto px-2 py-1 text-[12px] leading-[1.5]"
              @click="clearPicked"
            >
              清空
            </button>
          </div>

          <p
            v-if="!pickedProds.length"
            class="pixel-note px-3 py-4 text-center text-[12px] leading-[1.5]"
            style="color: var(--color-parchment-dim)"
          >
            勾选左侧机型加入对比。<br />
            1 台看详情，2 台以上并排比。
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
                  :aria-label="`从对比中移除 ${p.name}`"
                  @click="togglePick(p.id)"
                >
                  移除
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
                    {{ seriesOf(single) }}
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
                打开详情页
                <PxIcon name="arrow" :size="10" />
              </RouterLink>
            </template>

            <p
              v-else
              class="pixel-note px-3 py-3 text-center text-[12px] leading-[1.5]"
              style="color: var(--color-parchment-dim)"
            >
              已选 {{ pickedProds.length }} 台，往下看并排对比表。
            </p>
          </template>
        </div>
      </aside>
    </div>

    <!-- 多选对比表：全宽展开（1 台时不存在） -->
    <div v-if="matrix" class="mt-6">
      <SectionFrame
        :title="`并排对比 · ${matrix.list.length} 台`"
        hud="var(--color-west)"
        icon="compare"
      >
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
                  机型
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
                      :aria-label="`从对比中移除 ${p.name}`"
                      @click="togglePick(p.id)"
                    >
                      移除
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <template v-for="g in matrix.groups" :key="g">
              <tr>
                <th
                  colspan="99"
                  class="border-x-2 border-b-0 border-[var(--color-ink)] bg-[var(--color-ink)] px-2 py-1 text-left text-[12px] leading-[1.5]"
                  style="color: var(--color-gold)"
                >
                  {{ g }}
                </th>
              </tr>
              <tr v-for="o in matrix.order.filter((x) => x.group === g)" :key="o.label">
                <td
                  class="sticky left-0 z-1 border-2 border-[var(--color-ink)] bg-[var(--color-panel)] px-2 py-1"
                  style="color: var(--color-parchment-dim)"
                >
                  {{ o.label }}
                </td>
                <td
                  v-for="(m, i) in matrix.per"
                  :key="i"
                  class="border-2 border-[var(--color-ink)] bg-[var(--color-panel)] px-2 py-1"
                  :style="{
                    color:
                      m.get(`${o.group}|${o.label}`) === '—'
                        ? 'var(--color-ink-soft)'
                        : 'var(--color-parchment-lit)',
                  }"
                >
                  {{ m.get(`${o.group}|${o.label}`) ?? '—' }}
                </td>
              </tr>
            </template>
          </table>
        </div>
        <p class="pixel-note px-3 py-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)">
          「—」代表该机型官网未公布此参数，不是 0。
        </p>
      </SectionFrame>
    </div>
  </div>
</template>
