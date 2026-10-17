<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDataset, useDerived } from '../lib/useDataset';
import type { Product } from '../types';
import { lifecycleLines, lineRange, barGeometry } from '../lib/timeline';
import LoadingState from '../components/LoadingState.vue';

const { t } = useI18n();
const { ds } = useDataset();
const derived = useDerived();

// 两种视图：按年份（原有） / 按产品线生命周期（评审 2026-10-16）
const mode = ref<'year' | 'line'>('year');
const selectedLine = ref<string | null>(null);

function label(p: { releaseDate: string; releaseDatePrecision: string }) {
  const d = p.releaseDate || '';
  if (p.releaseDatePrecision === 'year') return d.slice(0, 4);
  if (p.releaseDatePrecision === 'month') return d.slice(0, 7);
  return d;
}

const lines = computed(() =>
  ds.value ? lifecycleLines(ds.value.products) : [],
);
const activeLine = computed(() =>
  lines.value.find((l) => l.line === selectedLine.value) ?? lines.value[0],
);
const activeRange = computed(() =>
  activeLine.value ? lineRange(activeLine.value.items) : { min: 2000, max: 2026 },
);

/** 只看异常（评审：时间倒挂是差异化功能，不能只写在说明里） */
const onlyInverted = ref(false);
const invertedCount = computed(
  () => lines.value.reduce((a, l) => a + l.items.filter((it) => it.inverted).length, 0),
);
const activeItems = computed(() => {
  const items = activeLine.value?.items ?? [];
  return onlyInverted.value ? items.filter((it) => it.inverted) : items;
});

/** 年份刻度轴：跨度自适应步长，约 4–6 条刻度 */
const axisTicks = computed<number[]>(() => {
  const { min, max } = activeRange.value;
  const span = Math.max(max - min, 1);
  const step = Math.max(1, Math.ceil(span / 5 / 5) * 5 || 1);
  const out: number[] = [];
  for (let y = Math.ceil(min / step) * step; y <= max; y += step) out.push(y);
  return out;
});

/**
 * 区分性行标签（评审：17 行里 17 行都以「MacBook Pro」开头且被截断）——
 * 产品线名抽到左侧泳道表头，行标签只写「配置差」；剥不干净退回全名，
 * 宁可长也不要截断成省略号。
 */
function rowLabel(p: Product): string {
  const name = p.name ?? '';
  const line = activeLine.value?.line ?? '';
  if (line && name.toLowerCase().startsWith(line.toLowerCase())) {
    const rest = name.slice(line.length).replace(/^[\s,，(（-]+/, '');
    if (rest) return rest;
  }
  return name;
}

const byYear = computed(() => {
  const list = derived.value?.byRelease ?? [];
  const map = new Map<string, typeof list>();
  for (const p of list) {
    const y = (p.releaseDate || '').slice(0, 4) || t('common.unknown');
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(p);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
});

/**
 * 分批渲染（同机型库，但按**年份组**切）：时间轴从最新往回铺全部 913 台。
 * 按「累计台数预算」决定显示到哪一年 —— 首批 80 台，之后每次放宽 60 台的年份，
 * 保证按钮一按就多出完整年份组（不会切半个年份）。
 */
const budget = ref(80);
const visibleByYear = computed(() => {
  const out: Array<[string, Product[]]> = [];
  let used = 0;
  for (const entry of byYear.value) {
    out.push(entry);
    used += entry[1].length;
    if (used >= budget.value) break;
  }
  return out;
});
const shownDevices = computed(() =>
  visibleByYear.value.reduce((n, [, list]) => n + list.length, 0),
);
const totalDevices = computed(() =>
  byYear.value.reduce((n, [, list]) => n + list.length, 0),
);
const hasMore = computed(() => visibleByYear.value.length < byYear.value.length);
function showMore() {
  budget.value += 60;
}
</script>

<template>
  <div class="page-shell space-y-6 py-6">
    <section class="card p-5 sm:p-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold text-fg">{{ t('timeline.title') }}</h1>
          <p class="mt-2 text-sm text-dim">{{ mode === 'year' ? t('timeline.note') : t('timeline.lifecycleNote') }}</p>
        </div>
        <!-- 视图切换：按年份 / 按产品线生命周期 -->
        <div class="flex gap-1">
          <button
            type="button"
            class="btn text-xs"
            :class="mode === 'year' ? 'btn-subtle' : 'btn-ghost'"
            @click="mode = 'year'"
          >{{ t('timeline.modeYear') }}</button>
          <button
            type="button"
            class="btn text-xs"
            :class="mode === 'line' ? 'btn-subtle' : 'btn-ghost'"
            @click="mode = 'line'"
          >{{ t('timeline.modeLine') }}</button>
        </div>
      </div>

      <LoadingState v-if="!ds" :label="t('common.loading')" />

      <!-- 产品线生命周期视图：左侧泳道表头（产品线名 + 计数）+ 年份刻度轴 +
           右侧每条 bar 只写「配置差」（评审：整页相同前缀被截断 = 信息量为零） -->
      <div v-else-if="mode === 'line' && activeLine" class="mt-4">
        <div class="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            v-for="l in lines.slice(0, 12)"
            :key="l.line"
            type="button"
            class="badge cursor-pointer border border-border bg-surface-2"
            :class="l.line === activeLine.line ? 'text-fg' : 'text-faint'"
            :aria-pressed="l.line === activeLine.line"
            @click="selectedLine = l.line"
          >{{ l.line }} <span class="text-faint">· {{ l.items.length }}</span></button>
        </div>

        <div class="mb-3 flex items-center gap-3">
          <label class="flex cursor-pointer items-center gap-2 text-sm text-dim">
            <input type="checkbox" v-model="onlyInverted" class="h-4 w-4 accent-[var(--color-danger)]" />
            {{ t('timeline.onlyInverted') }} ({{ invertedCount }})
          </label>
          <p class="text-xs text-faint">{{ t('timeline.onlyInvertedHint') }}</p>
        </div>

        <!-- 泳道表头：产品线名 + 台数（行标签不再重复它） -->
        <div class="flex items-baseline gap-3 border-b border-border pb-2">
          <h2 class="text-base font-semibold text-fg">{{ activeLine.line }}</h2>
          <span class="num text-sm text-faint">{{ activeLine.items.length }}</span>
        </div>

        <!-- 年份刻度轴：bar 长度终于可解读（评审：没有刻度 = 看不出 3 年和 1 年的差别） -->
        <div class="mt-2 flex items-center gap-3 pl-0">
          <span class="w-44 flex-none" aria-hidden="true" />
          <div class="relative h-4 min-w-0 flex-1">
            <span
              v-for="tick in axisTicks"
              :key="tick"
              class="num absolute top-0 -translate-x-1/2 text-[11px] text-faint"
              :style="{ left: ((tick - activeRange.min) / Math.max(activeRange.max - activeRange.min, 1)) * 100 + '%' }"
            >{{ tick }}</span>
          </div>
          <span class="w-24 flex-none" aria-hidden="true" />
        </div>

        <div class="space-y-1.5">
          <div
            v-for="it in activeItems"
            :key="it.product.id"
            class="flex items-center gap-3 text-sm"
          >
            <!-- 区分性行标签：配置差（年份/尺寸/芯片），全名进 title 兜底 -->
            <RouterLink
              :to="`/product/${it.product.id}`"
              class="w-44 flex-none truncate text-fg hover:text-link"
              :title="it.product.name"
            >{{ rowLabel(it.product) }}</RouterLink>
            <div class="relative h-4 min-w-0 flex-1 rounded bg-surface-2">
              <!-- 时间倒挂：停售早于发布 —— 红色虚线 + ⚠（数据事故的可视化目击） -->
              <span
                v-if="it.inverted"
                class="absolute inset-y-0 left-0 flex items-center gap-1 border-r-2 border-dashed border-danger pl-1 text-xs text-danger"
                :title="t('timeline.invertedDetail', { start: label(it.product), retired: it.product.retiredAt ?? '' })"
              >⚠ {{ t('timeline.inverted') }}</span>
              <div
                v-else
                class="absolute top-0.5 h-3 rounded-[2px]"
                :class="it.product.status === 'on-sale' ? 'bg-ink' : 'bg-border-strong'"
                :style="{
                  left: `${barGeometry(it, activeRange).leftPct}%`,
                  width: `${barGeometry(it, activeRange).widthPct}%`,
                  ...(barGeometry(it, activeRange).dashedTail
                    ? { borderRight: '2px dashed var(--color-faint)' }
                    : {}),
                }"
                :title="`${label(it.product)}${it.product.retiredAt ? ' → ' + it.product.retiredAt : ''}`"
              />
            </div>
            <span class="num w-24 flex-none text-right text-xs text-faint">{{ label(it.product) }}</span>
          </div>
        </div>

        <div class="mt-3 flex items-center gap-4 text-xs text-faint">
          <span class="inline-flex items-center gap-1"><span class="inline-block h-2 w-4 rounded-[2px] bg-ink" />{{ t('timeline.onSale') }}</span>
          <span class="inline-flex items-center gap-1"><span class="inline-block h-2 w-4 rounded-[2px] bg-border-strong" />{{ t('timeline.retired') }}</span>
          <span class="inline-flex items-center gap-1"><span class="inline-block h-2 w-4 rounded-[2px] border-r-2 border-dashed border-faint bg-border-strong" />{{ t('timeline.retireUnknown') }}</span>
        </div>
      </div>

      <template v-else-if="mode === 'year'">
        <div v-for="[year, list] in visibleByYear" :key="year" class="mb-6 last:mb-0">
        <div class="mb-3 flex items-center gap-3">
          <h2 class="text-2xl font-bold text-fg">{{ year }}</h2>
          <span class="text-sm text-dim">{{ t('common.models', { n: list.length }) }}</span>
          <span class="h-px flex-1 bg-border" />
        </div>
        <ul class="space-y-1.5">
          <li v-for="p in list" :key="p.id">
            <RouterLink
              :to="`/product/${p.id}`"
              class="card card-hover flex items-center gap-3 px-3 py-2"
            >
              <span
                class="w-20 flex-none text-center text-xs text-dim"
                >{{ label(p) }}</span
              >
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium text-fg">{{ p.name }}</span>
                  <span
                    class="text-sm"
                    :style="{ color: derived?.vendors.get(p.brand)?.accentColor }"
                  >
                    {{ derived?.vendors.get(p.brand)?.nameZh }}
                  </span>
                </span>
              </span>
            </RouterLink>
          </li>
        </ul>
      </div>

      <div v-if="hasMore" class="flex flex-col items-center gap-1.5 pt-1">
        <button type="button" class="btn btn-ghost px-4 py-1.5 text-sm" @click="showMore">
          {{ t('timeline.showOlder') }}
        </button>
        <span class="text-sm text-dim">
          {{ t('common.shownOf', { shown: shownDevices, total: totalDevices }) }}
        </span>
      </div>
      </template>
    </section>
  </div>
</template>
