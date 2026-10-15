<script setup lang="ts">
/**
 * 无限画布页（环面回绕瓦片画廊）：筛选条 + 画布。
 *
 * 完全复刻 cosmicbroth chessboard 的「无限画布复刻.html」：
 * 拖拽/滚轮无限平移、瓦片越界回绕、点击进详情浮层、再点进全屏查看器。
 * 像素赛博风（黑底 + 主题蓝 + 等宽字体）由 BoardCanvas 自带 scoped 样式保证。
 *
 * URL 即状态（#/canvas?brand=huawei&line=Mate&year=2025&sort=ppi）——
 * 与 /search 同一套做法：刷新、分享、浏览器前进后退都能还原同一份画面。
 * hash 路由下这是唯一可靠的方式，拿组件内 ref 存筛选会让「后退」直接失灵。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDataset, useDerived } from '../lib/useDataset';
import { useCanvasFilter } from '../lib/useCanvasFilter';
import { chipNameLabel } from '../lib/catalog';
import { SORTS, sortLabel, type CanvasDoc } from '../lib/canvasFilter';
import { spriteUrl } from '../lib/assets';
import { renderExportCanvas } from '../lib/renderExportImage';
import PxIcon from '../components/PxIcon.vue';
import type { BoardTile } from '../components/BoardCanvas.vue';
import BoardCanvas from '../components/BoardCanvas.vue';

const { t } = useI18n();
const { ds } = useDataset();
const derived = useDerived();

// 筛选 → 瓦片数据的公共管线（与 /globe 同源，见 useCanvasFilter 头注）
const {
  filter,
  docs,
  items,
  brands,
  lines,
  years,
  accentOf,
  setFilter,
  setSort,
  clearAll,
  total,
  shown,
  dirty,
  err,
} = useCanvasFilter('/canvas');

/** 按 id 建产品索引，给 viewbox 拼短规格文案用 */
const prodById = computed(() => new Map((ds.value?.products ?? []).map((p) => [p.id, p])));

/** 拼一行短规格（如「Kirin 9020 · 6.8″ · 120Hz · 5050mAh」），缺字段直接略过不估算 */
function composeDetail(d: CanvasDoc): string {
  const p = prodById.value.get(d.id);
  const parts: string[] = [];
  // 走 chipNameLabel：芯片型号有官方英文名，短规格行在英文页里不能吐「A18 芯片」
  const chip = p?.chipset?.name ? chipNameLabel(p.chipset.name) : '';
  if (chip) parts.push(chip);
  const size = p?.display?.sizeIn;
  if (size != null) parts.push(`${size}″`);
  const hz = p?.display?.refreshHz;
  if (hz != null) parts.push(`${hz}Hz`);
  const mah = p?.battery?.capacityMah;
  if (mah != null) parts.push(`${mah}mAh`);
  return parts.join(' · ') || t('canvas.noSpecs');
}

/** 喂给画布的瓦片：精灵图 + 品牌色 + 短规格文案 */
const tiles = computed<BoardTile[]>(() =>
  items.value.map((d) => ({
    id: d.id,
    name: d.nameZh ?? d.name,
    sprite: spriteUrl(d.id),
    accent: accentOf(d.brand),
    detail: composeDetail(d),
  })),
);

const board = ref<InstanceType<typeof BoardCanvas> | null>(null);

// ── 导出 PNG（当前筛选集合成一张图）──
const exporting = ref(false);
function buildFilterText(): string {
  const parts: string[] = [];
  if (filter.value.brand) {
    parts.push(derived.value?.vendors.get(filter.value.brand)?.nameZh ?? filter.value.brand);
  }
  if (filter.value.line) parts.push(filter.value.line);
  if (filter.value.year) parts.push(filter.value.year);
  if (filter.value.q.trim()) parts.push(`“${filter.value.q.trim()}”`);
  if (filter.value.sort !== 'newest') {
    const s = SORTS.find((x) => x.key === filter.value.sort);
    if (s) parts.push(t('canvas.sortPrefix', { name: sortLabel(s.key) }));
  }
  return parts.length ? parts.join(' · ') : t('canvas.allDevices');
}

async function exportPng() {
  if (!items.value.length || exporting.value) return;
  exporting.value = true;
  try {
    const productsById = new Map((ds.value?.products ?? []).map((p) => [p.id, p]));
    const vendorsById = derived.value?.vendors ?? new Map();
    const canvas = await renderExportCanvas({
      items: items.value,
      productsById,
      vendorsById,
      filterText: buildFilterText(),
    });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = t('canvas.exportFilename', { n: items.value.length });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  } finally {
    exporting.value = false;
  }
}

/**
 * 画布高度必须是一个**确定值**，不能靠 flex-1 撑（详见 BoardCanvas 注释：
 * 高度塌 0 时画面照样渲染但指针全死，是拖不动缩不了的隐形坑）。
 * 矮屏（横屏手机、Toy 横屏）少留点，别把筛选条挤出屏幕。
 */
const vh = ref(typeof window !== 'undefined' ? window.innerHeight : 800);

/**
 * 筛选条下面还剩多少可视高度（2026-10-15）。
 *
 * 为什么要量：品类从 16 增到 17、机型到 913 台后，年份/产品线 chips 换行变多，
 * 筛选条从 ~400px 长到 578px —— 画布被整块顶到首屏之外（1440×900 下
 * board-host 落在 y=620..1228），鼠标/触摸全落在屏幕外，表现为「拖不动、滚不动、
 * 点不进」。这与 globe 移动端「chips 变高把球面推出首屏」是同一类故障。
 *
 * 所以光给画布一个 vh 比例不够（比例不随上方内容变化），必须按**实测剩余空间**兜住。
 */
const filterShell = ref<HTMLElement | null>(null);
const availBelow = ref(0);
function measureAvail() {
  const el = filterShell.value;
  if (!el) return;
  const b = el.getBoundingClientRect();
  // b.bottom 是视口相对值：元素在视口下方/上方都要夹住，不能拿去减出负数。
  const bottom = Math.max(0, Math.min(b.bottom, vh.value));
  availBelow.value = Math.max(0, vh.value - bottom);
}
let onResize: (() => void) | null = null;
let ro: ResizeObserver | null = null;
onMounted(() => {
  onResize = () => {
    vh.value = window.innerHeight;
    measureAvail();
  };
  window.addEventListener('resize', onResize);
  measureAvail();
  // chips 数量随筛选联动变化（换品类/品牌后行数不同）→ 高度要跟着量，不能只量一次
  if (filterShell.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => measureAvail());
    ro.observe(filterShell.value);
  }
});
onBeforeUnmount(() => {
  if (onResize) window.removeEventListener('resize', onResize);
  ro?.disconnect();
});

const canvasH = computed(() => {
  const ratio = vh.value < 620 ? 0.56 : 0.68;
  const wanted = Math.round(vh.value * ratio);
  // 上方筛选条实测占掉之后，剩下的空间才给画布（留 20px 下边距）。
  // 剩余不足 320px 时不硬压（矮屏宁可让用户滚一点，也不要把画布压成一条缝）。
  const capped = availBelow.value > 0 ? Math.min(wanted, Math.round(availBelow.value - 20)) : wanted;
  return `${Math.max(320, capped)}px`;
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-if="err" class="page-shell py-10 text-center" style="color: var(--color-east)">
      {{ t('common.loadFailed', { err }) }}
    </div>

    <template v-else>
      <!-- 筛选条：品牌 / 产品线 / 年份 / 排序 -->
      <div ref="filterShell" class="page-shell pt-5 pb-3">
        <div class="pixel-panel mb-4 p-3">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 class="pixel-outline font-pixel text-[24px] leading-[1.5]">
                {{ t('canvas.title') }}
              </h1>
              <p
                class="mt-1 flex flex-wrap items-center gap-2 text-[12px] leading-[1.5]"
                style="color: var(--color-ink-soft)"
              >
                <span>{{ t('canvas.howto') }}</span>
                <span class="pixel-chip px-1.5 py-0.5 text-[var(--color-gold)]">{{ shown }}</span>
                <span>{{ t('filter.matchedTotal', { shown, total }) }}</span>
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
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
                @click="board?.reset()"
              >
                <PxIcon name="gear" :size="12" />
                {{ t('canvas.resetView') }}
              </button>
              <button
                class="pixel-button flex items-center gap-1 px-2.5 py-1.5 text-[12px] leading-[1.5]"
                :disabled="!shown || exporting"
                @click="exportPng"
              >
                <PxIcon name="image" :size="12" />
                {{ exporting ? t('canvas.exporting') : t('canvas.exportPng') }}
              </button>
            </div>
          </div>

          <!-- 三组分面：计数都是当前条件下的真实台数，随其它维度联动 -->
          <!-- 分面区自身限高滚动：品类/年份 chips 换行后不能无限长高，
               否则会把下面整块画布顶出首屏（canvasH 的 availBelow 兜底是第二道防线） -->
          <div
            class="mt-3 max-h-[38vh] space-y-2 overflow-y-auto border-t-2 border-[var(--color-ink)] pt-3"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="w-10 shrink-0 text-[12px] leading-[1.5]"
                style="color: var(--color-gold)"
                >{{ t('canvas.brand') }}</span
              >
              <button
                v-for="f in brands"
                :key="f.value || 'all'"
                class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
                :aria-pressed="filter.brand === f.value"
                @click="setFilter({ brand: f.value })"
              >
                {{
                  f.value
                    ? (docs.find((d) => d.brand === f.value)?.brandZh ?? f.value)
                    : t('canvas.all')
                }}
                {{ f.count }}
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <span
                class="w-10 shrink-0 text-[12px] leading-[1.5]"
                style="color: var(--color-gold)"
                >{{ t('canvas.line') }}</span
              >
              <button
                v-for="f in lines"
                :key="f.value || 'all'"
                class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
                :aria-pressed="filter.line === f.value"
                @click="setFilter({ line: f.value })"
              >
                {{ f.value || t('canvas.all') }} {{ f.count }}
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <span
                class="w-10 shrink-0 text-[12px] leading-[1.5]"
                style="color: var(--color-gold)"
                >{{ t('canvas.year') }}</span
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
                <label class="sr-only" for="canvas-q">{{ t('canvas.searchLabel') }}</label>
                <input
                  id="canvas-q"
                  :value="filter.q"
                  type="search"
                  :placeholder="t('canvas.searchPlaceholder')"
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

      <!-- 画布本体：高度是确定值，见 canvasH 的注释（不能靠 flex-1 撑） -->
      <div class="page-shell pb-5">
        <div class="pixel-panel p-0" :style="{ height: canvasH }">
          <BoardCanvas ref="board" :tiles="tiles" />
        </div>
      </div>

      <!--
        无障碍等价物：画布是纯视觉界面（拖拽 + 回绕），读屏与纯键盘用户没法遍历。
        这里给一份视觉隐藏、但可被读屏与 Tab 走到的线性列表 —— 画布类界面的标准做法。
        刻意不 display:none：那样读屏也读不到，等于没有。
      -->
      <nav class="sr-only" :aria-label="t('canvas.a11yNavLabel')">
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
