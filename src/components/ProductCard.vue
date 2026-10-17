<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { Product } from '../types';
import { shortDateLabel, formLabelOf } from '../lib/catalog';
import { specSlotsOf, type SpecSlot } from '../lib/summary';
import { useCompare } from '../lib/useCompare';
import { hexToRgba, screenBox } from '../lib/deviceVisual';
import StatusBadge from './StatusBadge.vue';
import PriceTag from './PriceTag.vue';

/**
 * 设备卡（评审 2026-10-17 设备库整改）：
 * - **左上角勾选热区**是唯一加入对比的入口（未选空心圆 / 已选金色实心 + 序号），
 *   「加入对比」金色按钮删除——913 张卡不该有 913 个最强视觉元素；
 * - **整卡可点进详情**，「详情」按钮删除；
 * - 摘要走**固定 3 槽**（specSlotsOf）：缺值渲染虚线空槽，不前挤，同列卡片数字对齐；
 * - 在售状态从右上角移到标题行下方的小字位（不再与勾选热区抢角）。
 */
const props = defineProps<{ product: Product; vendorName?: string; vendorColor?: string; order?: number }>();
const { t, locale } = useI18n();
const { has, toggle, ids } = useCompare();

/** 副标题 =「时间 · 形态」（评审：品牌/产品线/子线三者重名，「标准」对多数机型是废话） */
const subline = computed(() =>
  [shortDateLabel(props.product), formLabelOf(props.product)].filter(Boolean).join(' · '),
);

/** 固定 3 槽，按状态轴切换：停售机走档案要点（评审：1986 年配件不挂「电池 —」） */
const slots = computed<SpecSlot[]>(() =>
  specSlotsOf(props.product, locale.value, props.product.status === 'retired' ? 'archive' : 'buy'),
);

const checked = computed(() => has(props.product.id));
/** 已选序号（托盘里的 1/2/3），未选为 null */
const pickedOrder = computed(() => {
  if (!checked.value) return null;
  const i = ids.value.indexOf(props.product.id);
  return i >= 0 ? i + 1 : null;
});

function onToggle() {
  toggle(props.product.id);
}

// 视觉区：无图紧凑规则（品牌色小芯片 + 屏幕比例矩形，纯 CSS 几何）
const chipBg = computed(() => hexToRgba(props.vendorColor, 0.13));
const screen = computed(() => ({
  ...screenBox(props.product, 18),
  background: hexToRgba(props.vendorColor, 0.5),
  borderColor: hexToRgba(props.vendorColor, 0.9),
}));
</script>

<template>
  <article class="card card-hover relative flex flex-col gap-2 p-4 pt-3" :class="checked ? 'border-accent/60' : ''">
    <!-- 左上角勾选热区：唯一加入对比入口。独立于整卡链接（stop 冒泡），热区 ≥44px -->
    <button
      type="button"
      class="absolute left-2 top-2 z-10 grid h-11 w-11 place-items-center rounded-full"
      :aria-pressed="checked"
      :aria-label="checked ? t('compare.added') : t('compare.add')"
      @click.stop="onToggle"
    >
      <span
        class="grid h-6 w-6 place-items-center rounded-full border text-xs font-bold transition-colors"
        :class="checked ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong bg-surface text-faint hover:border-faint'"
      >
        {{ pickedOrder ?? '' }}
      </span>
    </button>

    <!-- 标题行：小品类图标芯片 + 名称。整卡点击进详情（勾选热区 stop 冒泡不受影响） -->
    <div class="flex items-center gap-2.5 pl-10">
      <span
        class="flex h-9 w-9 flex-none items-center justify-center rounded-md"
        :style="{ background: chipBg }"
        aria-hidden="true"
      >
        <span class="rounded-[3px] border" :style="screen" />
      </span>
      <RouterLink
        :to="`/product/${product.id}`"
        class="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg hover:text-link"
      >
        {{ product.name }}
      </RouterLink>
    </div>

    <!-- 副标题 + 在售状态：状态降为小字（圆点 + 文字，不靠颜色单独表意），不再与勾选抢角 -->
    <div class="flex items-center gap-2 pl-10">
      <p class="min-w-0 flex-1 truncate text-[13px] text-dim">{{ subline }}</p>
      <span class="flex flex-none items-center gap-1 text-xs text-dim">
        <StatusBadge :status="product.status" />
      </span>
    </div>

    <!-- 固定 3 槽：缺值留同宽空白（保列对齐），不渲染「标签 —」的占位噪音 -->
    <div class="grid grid-cols-[1fr_1fr_0.8fr] gap-1.5 pl-10">
      <template v-for="s in slots" :key="s.label">
        <span
          v-if="s.value"
          class="flex flex-col leading-tight"
          :title="s.label"
        >
          <span class="num text-[17px] font-semibold text-fg">{{ s.value }}</span>
          <span class="text-[11px] text-faint">{{ s.label }}</span>
        </span>
        <span v-else aria-hidden="true" />
      </template>
    </div>

    <div class="mt-auto flex items-center justify-between gap-3">
      <PriceTag :product="product" size="lg" />
    </div>
  </article>
</template>
