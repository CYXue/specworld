<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DimKey, FacetItem, FilterState } from '../lib/facets';
import { DIMENSION_KEYS, dimAllLabel, dimLabel } from '../lib/facets';
import PxIcon from './PxIcon.vue';

const { t } = useI18n();

/**
 * 全量筛选条 —— 京东「高级筛选」式：**每个维度是一个收起的下拉选择器**。
 *
 * 交互约定：
 * 1. 触发器行恒一行：`品牌：苹果 ▾`，点开才浮出选项面板（参考京东高级筛选的
 *    「预留宽度 ▾ 总容积 ▾ …」那排，面板展开如「面板材质」的玻璃/ABS/金属…）。
 * 2. **同时只开一个下拉**（手风琴），点外部 / Esc 关闭；**点选项即收起**
 *    （京东范式：选定后面板自动合上，结果列表立刻可见；要多维组合就再点开下一个）。
 * 3. 触发器即状态：维度有选中项时金色高亮（复用全局 `[aria-pressed='true']`），
 *    文案显示已选值（多项显示「等 N 项」）—— 不开面板也知道筛了什么。
 * 4. 面板顶部有「全部 X」一键清该维度；count=0 的档灰显不可点。
 * 5. 「未公布」是可见可点的一项，带 ? 标注。
 * 6. 顶部保留「已选条件」可删 chip 汇总条。
 *
 * 为什么用下拉而不是行内铺开/截断：**扩充性**。维度数增长只让触发器行换行，
 * 单维度选项涨到几百个也只是面板内滚动，两种增长都不撑破布局。
 *
 * ⚠️ **筛选条没有排序**（排序是榜单的事，筛选只是 AND 组合的条件）。
 */
const props = withDefaults(
  defineProps<{
    filter: FilterState;
    /** 各维度的分面（含计数），由调用方按联动口径算好 */
    facets: Record<string, FacetItem[]>;
    totalCount: number;
    shownCount: number;
    /** 已选中的对比台数（机型库页用，品牌页不传） */
    pickedCount?: number;
  }>(),
  { pickedCount: 0 },
);

const emit = defineEmits<{
  (e: 'toggle', dim: DimKey, id: string): void;
  /** 只清空某个维度（面板里的「全部 X」），不是清空全部条件 */
  (e: 'clear-dim', dim: DimKey): void;
  (e: 'reset'): void;
}>();

/**
 * 维度展示规则：**品类强制显示**（用户 2026-10-06 明确：品类=产品大类维度必须常驻，
 * 哪怕当前数据集只有「手机」一个值 —— 未来接入平板/笔电时分面自动长出来）；
 * 其余维度只有「实际有 ≥2 个可选项」才展示（如只有「未公布」一项的维度不占位）。
 */
const ALWAYS_SHOWN: ReadonlySet<DimKey> = new Set(['category']);
const dims = computed(() =>
  DIMENSION_KEYS.filter((k) => ALWAYS_SHOWN.has(k) || (props.facets[k]?.length ?? 0) > 1).map(
    (key) => ({ key, label: dimLabel(key), allLabel: dimAllLabel(key) }),
  ),
);

/**
 * 分面项展示名。**直接吃 `f.label`**（lib 的 `facetLabel` 已按维度解析：
 * 品类走 CATEGORY_ORDER 双语、形态走 locale 键、芯片/价格各自有口径）。
 *
 * ⚠️ 这里原本另有一份 CATEGORY_CN / FORM_CN 中文映射（2026-10-13 i18n 治理时删）：
 * 它与 `src/lib/catalog.ts` 的同名字表是**两份真源**——加个品类要改两处，
 * 漏一处就是「筛选条显示平板的英文名、详情页显示中文」这种静默分叉。
 * 且它写死中文，等于在组件里埋了一片闸门看不见的硬编码。
 */
function displayLabel(_dim: DimKey, f: FacetItem): string {
  return f.label;
}

// ── 下拉状态：同时只开一个 ──
const openDim = ref<DimKey | null>(null);
const rootEl = ref<HTMLElement | null>(null);
/** 面板对齐方向：靠右缘的触发器面板右对齐，避免溢出视口。 */
const align = ref<'left' | 'right'>('left');
const trigEls = new Map<DimKey, HTMLElement>();

function setTrigEl(key: DimKey) {
  return (el: unknown) => {
    if (el) trigEls.set(key, el as HTMLElement);
    else trigEls.delete(key);
  };
}

function toggleDim(key: DimKey): void {
  if (openDim.value === key) {
    openDim.value = null;
    return;
  }
  openDim.value = key;
  // 打开前量一下触发器位置：面板 256px 宽 + 16px 余量，放不下就右对齐
  const el = trigEls.get(key);
  align.value =
    el && el.getBoundingClientRect().left + 256 + 16 > window.innerWidth ? 'right' : 'left';
}

function onDocClick(e: MouseEvent): void {
  if (openDim.value && rootEl.value && !rootEl.value.contains(e.target as Node)) {
    openDim.value = null;
  }
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') openDim.value = null;
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});

/** 面板内点选项 = 选定即收起（京东范式：点完自动合上，结果立刻可见）。 */
function pick(dim: DimKey, id: string): void {
  emit('toggle', dim, id);
  openDim.value = null;
}

/** 「全部 X」= 清空该维度，同样选定即收起。 */
function clearDim(dim: DimKey): void {
  emit('clear-dim', dim);
  openDim.value = null;
}

/** 触发器文案：未选显示维度名；选 1 项显示值；多项「值 等N项」。 */
function triggerText(d: { key: DimKey; label: string }): string {
  const sel = props.filter[d.key];
  if (!sel.length) return d.label;
  const f = props.facets[d.key]?.find((x) => x.id === sel[0]);
  const first = f ? displayLabel(d.key, f) : sel[0];
  return sel.length === 1
    ? t('filter.triggerOne', { name: d.label, value: first })
    : t('filter.triggerMore', { name: d.label, value: first, n: sel.length });
}

/** 京东式「已选条件」汇总：所有维度里被选中的项，可逐个删除。 */
const selected = computed<Array<{ dim: DimKey; id: string; label: string }>>(() => {
  const out: Array<{ dim: DimKey; id: string; label: string }> = [];
  for (const d of dims.value) {
    for (const id of props.filter[d.key]) {
      const f = props.facets[d.key]?.find((x) => x.id === id);
      out.push({ dim: d.key, id, label: f ? displayLabel(d.key, f) : id });
    }
  }
  return out;
});
</script>

<template>
  <div ref="rootEl" class="pixel-panel relative p-3">
    <!-- 命中计数 + 重置：一眼知道筛选有没有生效 -->
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <span class="pixel-chip px-2 py-0.5 text-[12px] leading-[1.5] text-[var(--color-gold)]">{{ shownCount }}</span>
      <span class="text-[12px] leading-[1.5]" style="color: var(--color-parchment-dim)">
        {{ t('filter.matchedTotal', { shown: shownCount, total: totalCount }) }}
      </span>
      <span v-if="pickedCount" class="pixel-chip px-2 py-0.5 text-[12px] leading-[1.5]" style="color: var(--color-west)">
        {{ t('filter.picked', { n: pickedCount }) }}
      </span>
      <button
        class="pixel-button ml-auto flex items-center gap-1 px-2 py-1 text-[12px] leading-[1.5]"
        @click="emit('reset')"
      >
        <PxIcon name="close" :size="10" />
        {{ t('filter.reset') }}
      </button>
    </div>

    <!-- 已选条件汇总条（京东/淘宝标志：顶部一行可删 chip） -->
    <div
      v-if="selected.length"
      class="mb-2 flex flex-wrap items-center gap-1.5 border-b-2 border-[var(--color-ink)] pb-2"
    >
      <span class="pixel-heading flex items-center gap-1 text-[12px] leading-[1.5]">
        <PxIcon name="dot" :size="8" />
        {{ t('filter.selected') }}
      </span>
      <button
        v-for="c in selected"
        :key="c.dim + ':' + c.id"
        class="pixel-tag flex items-center gap-1 px-2 py-1 text-[12px] leading-[1.5]"
        :title="t('filter.remove', { name: c.label })"
        @click="emit('toggle', c.dim, c.id)"
      >
        <span style="color: var(--color-parchment-dim)">{{
          dims.find((x) => x.key === c.dim)?.label
        }}：</span>{{ c.label }}
        <PxIcon name="close" :size="8" />
      </button>
      <button
        class="pixel-button px-2 py-1 text-[12px] leading-[1.5]"
        @click="emit('reset')"
      >
        {{ t('filter.clear') }}
      </button>
    </div>

    <!-- 维度触发器行（恒紧凑：每个维度一个下拉选择器） -->
    <div class="flex flex-wrap items-center gap-1.5">
      <span v-for="d in dims" :key="d.key" class="relative">
        <button
          :ref="setTrigEl(d.key)"
          class="pixel-tag flex items-center gap-1 px-2 py-1 text-[12px] leading-[1.5]"
          :aria-pressed="filter[d.key].length > 0"
          :aria-expanded="openDim === d.key"
          :title="t('filter.byDim', { name: d.label })"
          @click="toggleDim(d.key)"
        >
          {{ triggerText(d) }}
          <span style="color: var(--color-parchment-dim)">{{ openDim === d.key ? '▴' : '▾' }}</span>
        </button>
        <!-- 选项面板：绝对定位浮层，选项多时面板内滚动（不撑破页面） -->
        <div
          v-if="openDim === d.key"
          class="pixel-panel absolute top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto p-2"
          :class="align === 'right' ? 'right-0' : 'left-0'"
        >
          <button
            class="pixel-tag mb-1 flex w-full items-center justify-between px-2 py-1 text-left text-[12px] leading-[1.5]"
            :aria-pressed="filter[d.key].length === 0"
            @click="clearDim(d.key)"
          >
            {{ d.allLabel }}
          </button>
          <button
            v-for="f in facets[d.key]"
            :key="f.id"
            class="pixel-tag mb-1 flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-[12px] leading-[1.5]"
            :class="{ 'cursor-not-allowed opacity-40': f.count === 0 }"
            :aria-pressed="filter[d.key].includes(f.id)"
            :disabled="f.count === 0"
            :title="
              f.isUnknown
                ? t('filter.unknownTip')
                : f.count === 0
                  ? t('filter.zeroTip')
                  : undefined
            "
            @click="pick(d.key, f.id)"
          >
            <span class="min-w-0 truncate">
              {{ displayLabel(d.key, f) }}
              <span v-if="f.isUnknown" style="color: var(--color-ink-soft)">?</span>
            </span>
            <span class="flex-none" style="color: var(--color-parchment-dim)">{{ f.count }}</span>
          </button>
        </div>
      </span>
    </div>
  </div>
</template>
