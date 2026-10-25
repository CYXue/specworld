<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import { RouterLink } from 'vue-router';
import type { Product } from '../types';
import { shortDateLabel, formLabelOf } from '../lib/catalog';
import { specSlotsOf, type SpecSlot } from '../lib/summary';
import { useCompare } from '../lib/useCompare';
import { hexToRgba, screenBox } from '../lib/deviceVisual';
import StatusBadge from './StatusBadge.vue';
import PriceTag from './PriceTag.vue';

/**
 * 设备卡（纸上数据库 v4 重设计）：
 * - 「规格表」卡：白纸面 + 发丝线，数据值一律 mono；
 * - 左上角勾选热区是唯一加入对比的入口（未选空心圆 / 已选墨块实心 + 序号），
 *   整卡可点进详情；
 * - 摘要走固定 3 槽（specSlotsOf）：缺值渲染虚线空槽，不前挤，同列卡片数字对齐；
 * - 在售状态在标题行下方的小字位（圆点 + 文字，不靠颜色单独表意）。
 */
const props = defineProps<{ product: Product; vendorName?: string; vendorColor?: string; order?: number }>();
const { has, toggle, ids } = useCompare();

/** 副标题 =「时间 · 形态」（评审：品牌/产品线/子线三者重名，「标准」对多数机型是废话） */
const subline = computed(() =>
  [shortDateLabel(props.product), formLabelOf(props.product)].filter(Boolean).join(' · '),
);

/** 固定 3 槽，按状态轴切换：停售机走档案要点（评审：1986 年配件不挂「电池 —」） */
const slots = computed<SpecSlot[]>(() =>
  specSlotsOf(props.product, props.product.status === 'retired' ? 'archive' : 'buy'),
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

// 视觉区：无图紧凑规则（品牌色小芯片 + 屏幕比例矩形，纯 CSS 几何；纸底上品牌色稍提饱和）
const chipBg = computed(() => hexToRgba(props.vendorColor, 0.14));
const screen = computed(() => ({
  ...screenBox(props.product, 18),
  background: hexToRgba(props.vendorColor, 0.55),
  borderColor: hexToRgba(props.vendorColor, 0.95),
}));
</script>

<template>
  <article class="card card-hover relative flex flex-col gap-2.5 p-4" :class="checked ? 'border-ink' : ''">
    <!-- 左上角勾选热区：唯一加入对比入口。独立于整卡链接（stop 冒泡），热区 ≥44px -->
    <button
      type="button"
      class="absolute left-2 top-2 z-10 grid h-11 w-11 place-items-center rounded-full"
      :aria-pressed="checked"
      :aria-label="checked ? t('compare.added') : t('compare.add')"
      @click.stop="onToggle"
    >
      <span
        class="num grid h-6 w-6 place-items-center rounded-[4px] border text-xs font-bold transition-colors"
        :class="checked ? 'border-ink bg-ink text-ink-fg' : 'border-border-strong bg-surface text-faint hover:border-dim'"
      >
        {{ pickedOrder ?? '' }}
      </span>
    </button>

    <!-- 标题行：小品类图标芯片 + 名称。整卡点击进详情（勾选热区 stop 冒泡不受影响） -->
    <div class="flex items-center gap-2.5 pl-10">
      <span
        class="flex h-9 w-9 flex-none items-center justify-center rounded-[4px]"
        :style="{ background: chipBg }"
        aria-hidden="true"
      >
        <span class="rounded-[2px] border" :style="screen" />
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
      <p class="num min-w-0 flex-1 truncate text-[12px] text-dim">{{ subline }}</p>
      <span class="flex flex-none items-center gap-1 text-xs text-dim">
        <StatusBadge :status="product.status" />
      </span>
    </div>

    <!-- 规格 3 槽：mono 数值 + kicker 标签，发丝线上边线（规格表的「行」） -->
    <div class="grid grid-cols-[1fr_1fr_0.8fr] gap-1.5 border-t border-border pl-10 pt-2.5">
      <template v-for="s in slots" :key="s.label">
        <span
          v-if="s.value"
          class="flex flex-col leading-tight"
          :title="s.label"
        >
          <span class="num text-[14px] font-semibold text-fg sm:text-[16px]">{{ s.value }}</span>
          <span class="mt-0.5 text-[11px] text-faint">{{ s.label }}</span>
        </span>
        <span v-else aria-hidden="true" />
      </template>
    </div>

    <div class="mt-auto flex items-center justify-between gap-3">
      <PriceTag :product="product" size="lg" />
    </div>
  </article>
</template>
