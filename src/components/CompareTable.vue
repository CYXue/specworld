<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { Product } from '../types';
import { specGroups, type SpecRowState } from '../lib/fields';
import { compareRowState } from '../lib/compare';
import { useCompare } from '../lib/useCompare';
import StatusBadge from './StatusBadge.vue';
import MissingBadge from './MissingBadge.vue';

/**
 * 对比表（评审 2026-10-17 对比页整改）：
 * - **相同值合并**：两台以上同值同态的行，值区合并为一个跨栏单元格（底色略暗 + ＝ 标记）
 *   ——「两次读同一句话」是对比表最大的效率损失；
 * - **差异标记二选一**：星号/≠ 记号全部删除，「只看差异」开关是唯一的差异筛选
 *   （同一信息两套标记等于没有标记）；顶部汇总条给 共 N 项 · 差异 D 项 · 相同 S 项；
 * - **缺失统一走 MissingBadge**：? / — / 整句灰字三种表现收敛为一枚徽章；
 * - 粒度警告提行级：混合深度行整行给提示条，不再缩在单元格角落 11px 灰字。
 */
const props = defineProps<{ products: Product[] }>();
const { t } = useI18n();
const { remove } = useCompare();
const diffOnly = ref(false);
const openIdentical = ref(false);

interface Row {
  title: string;
  label: string;
  values: Record<string, string>;
  /** 每列的缺失态（value/none/unpublished/uncollected）——粒度警告的判定依据 */
  states: Record<string, SpecRowState>;
}

const groups = computed<Array<{ title: string; rows: Row[] }>>(() => {
  const order: string[] = [];
  const acc = new Map<string, Row>();
  for (const p of props.products) {
    for (const g of specGroups(p)) {
      if (!order.includes(g.title)) order.push(g.title);
      for (const r of g.rows) {
        const key = g.title + '||' + r.label;
        if (!acc.has(key)) acc.set(key, { title: g.title, label: r.label, values: {}, states: {} });
        acc.get(key)!.values[p.id] = r.value;
        acc.get(key)!.states[p.id] = r.state;
      }
    }
  }
  return order.map((title) => ({ title, rows: [...acc.values()].filter((x) => x.title === title) }));
});

function stateFor(row: Row) {
  return compareRowState(props.products.map((p) => row.values[p.id] ?? '—'));
}

/** 全部列同值（且有真值）→ 可合并为跨栏单元格。缺失态不算「同值」——缺失走徽章 */
function allIdentical(row: Row): boolean {
  const s = stateFor(row);
  if (s.different || s.missing) return false;
  const vals = props.products.map((p) => row.values[p.id] ?? '—');
  return new Set(vals).size === 1 && vals[0] !== '—';
}

/**
 * 粒度警告（评审 2026-10-16：粒度差异 ≠ 真实差异）：
 * 同一行两侧采集深度不同（一侧有值、另一侧是「官网未公布」或「本站未收录」）时，
 * 不能渲染成「有 vs 无」——用户会基于缺失得出假结论。
 * 提行级提示条：这是避免误判的最重要信息，不该缩在角落。
 */
function mixedDepth(row: Row): boolean {
  const states = props.products.map((p) => row.states[p.id]);
  const hasValue = states.includes('value');
  const hasMissing = states.some((s) => s === 'unpublished' || s === 'uncollected');
  return hasValue && hasMissing;
}

/** 差异/缺失统计（顶部汇总条） */
const totals = computed(() => {
  let diff = 0;
  let same = 0;
  let missing = 0;
  for (const g of groups.value) {
    for (const r of g.rows) {
      const s = stateFor(r);
      if (s.different) diff++;
      else if (s.missing) missing++;
      else if (!allIdentical(r)) same++;
      else same++;
    }
  }
  const total = groups.value.reduce((a, g) => a + g.rows.length, 0);
  return { total, diff, same: same, missing };
});

/** 「只看差异」过滤：不同 or 缺失差异。相同项折叠为一个可展开的汇总行 */
function visibleRows(rows: Row[]) {
  if (!diffOnly.value) return rows;
  return rows.filter((r) => {
    const s = stateFor(r);
    return s.different || s.missing;
  });
}

/** 各分组里被「只看差异」折叠掉的相同行数（用于「相同项 N 项（展开）」汇总行） */
function identicalCount(rows: Row[]): number {
  return rows.length - visibleRows(rows).length;
}

/** 缺失单元格的 MissingBadge 语义：粒度未知保守取 uncollected */
function missingStateOf(row: Row, p: Product): 'unpublished' | 'uncollected' {
  return row.states[p.id] === 'unpublished' ? 'unpublished' : 'uncollected';
}

function val(p: Product, row: Row) {
  return row.values[p.id] ?? '—';
}

// ── 分组目录（吸顶，评审：上百字段一滚就迷路）──
const activeGroup = ref(0);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const i = Number((e.target as HTMLElement).dataset.group);
          if (Number.isFinite(i)) activeGroup.value = i;
        }
      }
    },
    // 表头吸顶占位修正：rootMargin 顶部留出吸顶表头高度
    { rootMargin: '-56px 0px -70% 0px', threshold: 0 },
  );
  document.querySelectorAll('[data-group-anchor]').forEach((el) => observer!.observe(el));
});
onBeforeUnmount(() => observer?.disconnect());

function jumpToGroup(i: number) {
  document.getElementById(`group-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
  <div>
    <!-- 汇总条 + 开关（评审：同一句话写两遍——说明只保留这一处） -->
    <div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <label class="flex cursor-pointer items-center gap-2 text-sm text-dim">
        <input type="checkbox" v-model="diffOnly" class="h-4 w-4 accent-[var(--color-accent)]" />
        {{ t('compare.diffOnlyCount', { n: totals.diff + totals.missing }) }}
      </label>
      <p class="num text-[13px] text-faint">
        {{ t('compare.totals', { total: totals.total, diff: totals.diff, same: totals.same }) }}
      </p>
      <p class="ml-auto hidden text-xs text-faint lg:block">{{ t('compare.noteNoVerdict') }}</p>
    </div>

    <!-- 分组目录吸顶条（桌面）：滚动高亮当前组，点击锚点跳转 -->
    <div class="sticky top-0 z-20 -mx-1 mb-2 hidden overflow-x-auto bg-surface/95 backdrop-blur md:block">
      <div class="flex items-center gap-1 px-1 py-1.5">
        <button
          v-for="(g, gi) in groups"
          :key="g.title"
          type="button"
          class="flex-none rounded-full px-2.5 py-1 text-[13px] transition-colors"
          :class="activeGroup === gi ? 'bg-surface-2 font-semibold text-fg' : 'text-dim hover:text-fg'"
          :aria-current="activeGroup === gi"
          @click="jumpToGroup(gi)"
        >
          {{ g.title }}
        </button>
      </div>
    </div>

    <!-- 桌面：横向滚动表 -->
    <div class="hidden overflow-x-auto md:block">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th class="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs font-semibold text-dim">参数</th>
            <th
              v-for="p in products"
              :key="p.id"
              class="min-w-44 border-b border-border px-3 py-2 text-left align-top"
            >
              <div class="flex items-start justify-between gap-2">
                <RouterLink :to="`/product/${p.id}`" class="font-semibold text-fg hover:text-link">
                  {{ p.name }}
                </RouterLink>
                <button
                  type="button"
                  class="tag-remove shrink-0"
                  :aria-label="t('compare.removeAria', { name: p.name })"
                  @click="remove(p.id)"
                >
                  ×
                </button>
              </div>
              <StatusBadge :status="p.status" />
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(g, gi) in groups" :key="g.title">
            <tr>
              <th
                :id="`group-${gi}`"
                data-group-anchor
                :data-group="gi"
                colspan="100"
                class="sticky top-0 z-10 bg-surface-2 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-dim"
              >
                {{ g.title }}
              </th>
            </tr>
            <!-- 只看差异时：被折叠的相同行收进一个可展开的汇总行 -->
            <tr v-if="diffOnly && identicalCount(g.rows) > 0">
              <td colspan="100" class="bg-surface-2/60 px-3 py-1.5">
                <button
                  type="button"
                  class="text-[13px] text-dim hover:text-fg"
                  :aria-expanded="openIdentical"
                  @click="openIdentical = !openIdentical"
                >
                  {{ openIdentical ? '▾' : '▸' }}
                  {{ t('compare.identicalFold', { n: identicalCount(g.rows) }) }}
                </button>
              </td>
            </tr>
            <template v-for="row in (diffOnly && !openIdentical ? visibleRows(g.rows) : g.rows)" :key="row.label">
              <tr class="border-b border-border/60" :class="mixedDepth(row) ? 'bg-warn-soft/40' : ''">
                <td class="sticky left-0 z-10 bg-surface px-3 py-2 align-top text-dim">
                  {{ row.label }}
                </td>
                <!-- 相同值合并：跨栏单元格，底色略暗 + ＝ 标记（评审：别让用户读两遍同一句话） -->
                <td
                  v-if="allIdentical(row)"
                  :colspan="products.length"
                  class="bg-surface-2/70 px-3 py-2 text-fg"
                >
                  <span class="mr-1.5 text-[10px] text-faint">＝</span>{{ val(products[0]!, row) }}
                </td>
                <template v-else>
                  <td
                    v-for="p in products"
                    :key="p.id"
                    class="px-3 py-2 align-top"
                  >
                    <MissingBadge
                      v-if="val(p, row) === '—' && row.states[p.id] !== 'none'"
                      :state="missingStateOf(row, p)"
                    />
                    <span v-else-if="val(p, row) === '—'" class="text-faint">—</span>
                    <span v-else class="text-fg">{{ val(p, row) }}</span>
                  </td>
                </template>
              </tr>
              <!-- 粒度警告：提行级（评审：这是避免误判的最重要提示，不该缩在角落） -->
              <tr v-if="mixedDepth(row)">
                <td colspan="100" class="px-3 pb-2 pt-0 text-xs text-dim">
                  <span class="inline-flex items-center gap-1">
                    <span class="text-warn">⚠</span>
                    {{ t('compare.mixedDepth') }}
                  </span>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 移动端：参数行卡片 -->
    <div class="space-y-4 md:hidden">
      <div v-for="p in products" :key="p.id" class="card p-3">
        <div class="mb-2 flex items-center justify-between gap-2">
          <RouterLink :to="`/product/${p.id}`" class="font-semibold text-fg hover:text-link">
            {{ p.name }}
          </RouterLink>
          <button type="button" class="tag-remove" :aria-label="t('compare.removeAria', { name: p.name })" @click="remove(p.id)">×</button>
        </div>
        <StatusBadge :status="p.status" />
        <dl class="mt-2 space-y-1.5">
          <template v-for="g in groups" :key="g.title">
            <p class="pt-1 text-xs font-semibold uppercase tracking-wide text-dim">{{ g.title }}</p>
            <div
              v-for="row in visibleRows(g.rows)"
              :key="row.label"
              class="flex justify-between gap-3 text-sm"
              :class="mixedDepth(row) ? 'rounded bg-warn-soft/40 px-1.5' : ''"
            >
              <dt class="text-dim">{{ row.label }}</dt>
              <dd class="text-right">
                <MissingBadge
                  v-if="val(p, row) === '—' && row.states[p.id] !== 'none'"
                  :state="missingStateOf(row, p)"
                />
                <span v-else :class="[val(p, row) === '—' ? 'text-faint' : 'text-fg']">{{ val(p, row) }}</span>
                <span v-if="mixedDepth(row)" class="block text-[10px] text-dim">⚠ {{ t('compare.mixedDepth') }}</span>
              </dd>
            </div>
          </template>
        </dl>
      </div>
    </div>

    <p v-if="!products.length" class="text-sm text-dim">{{ t('compare.emptyPick') }}</p>
  </div>
</template>
