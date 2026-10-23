<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '../i18n';
import { useRoute, RouterLink } from 'vue-router';
import { useDataset, useDerived } from '../lib/useDataset';
import type { Product } from '../types';
import { seriesOf, seriesLabel, chipName } from '../lib/catalog';
import { specGroups } from '../lib/fields';
import { hexToRgba, screenBox } from '../lib/deviceVisual';
import { asset } from '../lib/assets';
import { useCompare } from '../lib/useCompare';
import StatusBadge from '../components/StatusBadge.vue';
import SourceBadge from '../components/SourceBadge.vue';
import SpecSection from '../components/SpecSection.vue';
import ComplianceSection from '../components/ComplianceSection.vue';
import MetricCard from '../components/MetricCard.vue';
import RawOfficialDrawer from '../components/RawOfficialDrawer.vue';
import LoadingState from '../components/LoadingState.vue';

const route = useRoute();
const { ds, err } = useDataset();
const derived = useDerived();
const { has, toggle } = useCompare();

const product = computed(() => derived.value?.byId(String(route.params.id)));
const vendor = computed(() =>
  product.value ? derived.value?.vendors.get(product.value.brand) : undefined,
);
const groups = computed(() => (product.value ? specGroups(product.value) : []));
const seriesText = computed(() => (product.value ? seriesLabel(seriesOf(product.value)) : ''));

// 核心指标：从产品直接取关键字段（其余完整参数在下方 SpecSection 列出）。
// 价格不进这里：它是有值/缺失双态字段，走共用 PriceTag 渲染（见模板第一个指标卡）。
// 取值走扁平 specs 容器（v1 嵌套在全 v2 数据上不存在，只读嵌套会静默全部消失）。
function specNum(p: Product, key: string): number | null {
  const v = (p.specs ?? {})[key];
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}
const metrics = computed(() => {
  const p = product.value;
  if (!p) return [];
  const specs = p.specs ?? {};
  const out: { value: string; label: string }[] = [];
  const sizeIn = specNum(p, 'display.sizeIn');
  if (sizeIn != null) {
    const type = typeof specs['display.type'] === 'string' ? ` ${specs['display.type']}` : '';
    out.push({ value: `${sizeIn}″${type}`, label: t('ability.display') });
  }
  const chip = chipName(p);
  if (chip && chip !== '未公布') out.push({ value: chip, label: t('facet.chip') });
  const weightG = specNum(p, 'body.weightG');
  if (weightG != null) out.push({ value: `${weightG}g`, label: t('product.weightLabel') });
  const cap = specNum(p, 'battery.capacityMah');
  if (cap != null) out.push({ value: `${cap.toLocaleString('en-US')}mAh`, label: t('product.batteryLabel') });
  if (p.releaseDate) out.push({ value: p.releaseDate, label: t('product.releaseLabel') });
  return out;
});

const checked = computed(() => (product.value ? has(product.value.id) : false));
function onToggle() {
  if (product.value) toggle(product.value.id);
}

// 来源徽章落到卡片级（评审 2026-10-16）：采集粒度放在机型名旁边，不藏。
// specs-page = 官网完整规格页；compare-matrix = 官网对比页（字段较粗）；manual = 手册整理。
const granularityBadge = computed(() => {
  const g = product.value?.granularity;
  if (g === 'specs-page') return { key: 'product.granularitySpecsPage', cls: 'badge border border-border bg-surface-2 text-fg' };
  if (g === 'compare-matrix') return { key: 'product.granularityMatrix', cls: 'badge border border-border bg-surface-2 text-dim' };
  if (g === 'manual') return { key: 'product.granularityManual', cls: 'badge border border-border bg-surface-2 text-faint' };
  return null;
});

// keySpecs 化（评审 2026-10-16）：默认只展开前 3 组，其余收进「查看全部参数」。
// 全量字段上百个，一屏平铺既淹没重点又是移动端灾难。
const allGroupsShown = ref(false);
const KEY_GROUP_LIMIT = 3;
const visibleGroups = computed(() =>
  allGroupsShown.value ? groups.value : groups.value.slice(0, KEY_GROUP_LIMIT),
);
const hiddenGroupCount = computed(() =>
  Math.max(groups.value.length - KEY_GROUP_LIMIT, 0),
);

// 官网原文抽屉的数据源：构建期已把 rawOfficial 拆到 data/raw/{id}.json（split-raw.mjs），
// 点开才按需 fetch —— 主包不再为 62 台的原文付体积代价。
const rawSections = ref<Record<string, string> | null>(null);
const rawLoadedFor = ref<string>('');
watch(
  () => product.value?.id,
  async (id) => {
    rawSections.value = null;
    if (!id || rawLoadedFor.value === id) return;
    rawLoadedFor.value = id;
    try {
      const r = await fetch(asset(`data/raw/${id}.json`));
      if (r.ok && rawLoadedFor.value === id) rawSections.value = (await r.json()) as Record<string, string>;
    } catch {
      rawSections.value = null; // 拿不到就藏按钮，不阻塞详情页
    }
  },
  { immediate: true },
);
const specUrl = computed(() => {
  const u = (product.value?.specs ?? {})['device.specUrl'];
  return typeof u === 'string' && u.startsWith('http') ? u : undefined;
});

// 详情页 Hero 带：与产品卡同一套视觉语言（品牌色 + 屏幕比例），
// 但更高大 —— 单台设备页要「一台设备占满 attention」，不是又一张卡。
const heroBg = computed(() => hexToRgba(vendor.value?.accentColor, 0.16));
const heroScreen = computed(() =>
  product.value
    ? {
        ...screenBox(product.value, 128),
        background: hexToRgba(vendor.value?.accentColor, 0.5),
        borderColor: hexToRgba(vendor.value?.accentColor, 0.9),
      }
    : {},
);
</script>

<template>
  <div class="page-shell py-6">
    <div v-if="err" class="card p-6 text-center text-danger">{{ t('home.loadFailed', { err }) }}</div>
    <LoadingState v-else-if="!ds" variant="sheet" />

    <div v-else-if="!product" class="card p-12 text-center">
      <p class="font-semibold text-fg">{{ t('product.notFound') }}</p>
      <RouterLink to="/compare" class="btn btn-ghost mt-3">{{ t('brand.backToPlaza') }}</RouterLink>
    </div>

    <template v-else>
      <!-- 头部：设备 Hero 带（品牌色 + 屏幕比例）+ 身份信息 + 动作 -->
      <header class="card mb-6 overflow-hidden">
        <div class="relative flex h-32 items-center justify-center" :style="{ background: heroBg }">
          <div class="rounded-lg border shadow-sm" :style="heroScreen" aria-hidden="true" />
          <StatusBadge :status="product.status" class="absolute right-3 top-3" />
        </div>
        <div class="p-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h1 class="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{{ product.name }}</h1>
              <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
                <RouterLink
                  v-if="vendor"
                  :to="`/brand/${product.brand}`"
                  class="hover:text-link"
                  >{{ vendor.nameZh || vendor.name }}</RouterLink
                >
                <template v-if="seriesText">
                  <span class="text-faint">·</span><span>{{ seriesText }}</span>
                </template>
                <template v-if="product.line">
                  <span class="text-faint">·</span><span>{{ product.line }}</span>
                </template>
                <!-- 来源徽章落到卡片级：采集粒度不藏（specs-page 权重最高） -->
                <span v-if="granularityBadge" :class="granularityBadge.cls" :title="t('product.granularityHint')">
                  {{ t(granularityBadge.key) }}
                </span>
              </div>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-3">
            <SourceBadge :href="product.sourceUrl ?? undefined" :unpublished="!product.sourceUrl" />
            <button
              type="button"
              class="btn"
              :class="checked ? 'btn-subtle' : 'btn-ghost'"
              :aria-pressed="checked"
              @click="onToggle"
            >
              {{ checked ? '✓ ' + t('compare.added') : t('compare.add') }}
            </button>
            <!-- 官网原文抽屉：可核查的落点（有 rawOfficial 才渲染入口） -->
            <RawOfficialDrawer v-if="rawSections" :sections="rawSections" :spec-url="specUrl" />
          </div>
        </div>
      </header>

      <!-- 核心指标：第一张卡是价格（走共用 PriceTag 的有值/缺失双态规则） -->
      <section class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard :label="t('facet.price')">
          <template #value><PriceTag :product="product" size="xl" /></template>
        </MetricCard>
        <MetricCard v-for="m in metrics" :key="m.label" :value="m.value" :label="m.label" />
      </section>

      <!-- 合规认证：进网许可/SRRC/SAR/产地/能效——监管申报口径单列 + 官方验真入口 -->
      <section class="mb-6">
        <h2 class="kicker mb-3">合规认证</h2>
        <ComplianceSection :product="product" />
      </section>

      <!-- 完整规格：keySpecs 化 —— 默认只展开前 3 组，其余收进「查看全部参数」 -->
      <section class="space-y-4">
        <h2 class="kicker">{{ t('product.fullSpecs') }}</h2>
        <SpecSection v-for="g in visibleGroups" :key="g.title" :title="g.title" :rows="g.rows" />
        <button
          v-if="hiddenGroupCount > 0 && !allGroupsShown"
          type="button"
          class="btn btn-ghost w-full"
          @click="allGroupsShown = true"
        >
          {{ t('product.showAllGroups', { n: hiddenGroupCount }) }}
        </button>
      </section>
    </template>
  </div>
</template>
