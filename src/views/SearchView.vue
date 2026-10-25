<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '../i18n';
import { useDataset, useDerived } from '../lib/useDataset';
import { buildDocs, searchWithMeta, suggestions } from '../lib/search';
import { abilityRows } from '../lib/specs';
import { useChunkedList } from '../lib/useChunkedList';
import LoadingState from '../components/LoadingState.vue';

// 搜索页：URL 即状态。
// q 与 brand 都写在 query 里（#/search?q=mate&brand=huawei），所以刷新、分享、
// 浏览器前进后退都能还原同一份结果 —— hash 路由下这是唯一可靠的做法，
// 拿组件内的 ref 存查询词会让「后退」直接失灵。
const route = useRoute();
const router = useRouter();
const { ds } = useDataset();
const derived = useDerived();

const q = ref(String(route.query.q ?? ''));
const brand = ref(String(route.query.brand ?? ''));

// 路由 → 输入框：用户点浏览器后退时，框里的字要跟着退回去
watch(
  () => [route.query.q, route.query.brand],
  ([nq, nb]) => {
    q.value = String(nq ?? '');
    brand.value = String(nb ?? '');
  },
);

const docs = computed(() => {
  const d = ds.value;
  if (!d) return [];
  return buildDocs(d.products, derived.value?.vendors ?? new Map());
});

const brands = computed(() => {
  const seen = new Map<string, { id: string; nameZh: string; count: number; accentColor: string }>();
  for (const doc of docs.value) {
    const cur = seen.get(doc.brand);
    if (cur) cur.count += 1;
    else
      seen.set(doc.brand, {
        id: doc.brand,
        nameZh: doc.vendor?.nameZh ?? doc.brand,
        count: 1,
        accentColor: doc.vendor?.accentColor ?? 'var(--color-fg)',
      });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
});

// 结果与「是否走了容错通道」一次算出（判据下沉在 lib/search.ts，
// 组件里不自己重判 —— 两个判据迟早分叉）。
const outcome = computed(() => searchWithMeta(docs.value, q.value, { brand: brand.value }));
const results = computed(() => outcome.value.results);
/** 分批渲染（同机型库）：品牌维度宽查询（如某品牌全部 864 台）也会直出大列表 */
const { shownList: resultsShown, total: resultsTotal, hasMore, showMore } = useChunkedList(results, 60);
const usedLooseMatch = computed(() => outcome.value.usedLooseMatch);
const hasQuery = computed(() => q.value.trim().length > 0 || brand.value.length > 0);
const hint = computed(() => suggestions(docs.value));

/** 容错提示里给出的「官方写法」参考：取第一条结果的机型名 */
const looseHint = computed(() => results.value[0]?.product.name ?? '');

/** 结果行上的三个关键值：与详情页同一套口径，缺失就是「官方未公布」 */
const brief = computed(() => {
  const b = derived.value?.bounds;
  if (!b) return null;
  return (id: string) => {
    const p = docs.value.find((d) => d.product.id === id)?.product;
    if (!p) return [];
    return abilityRows(p, b)
      .filter((r) => r.key !== 'camera' || r.raw != null)
      .slice(0, 3);
  };
});

function apply(nextQ?: string, nextBrand?: string) {
  const query: Record<string, string> = {};
  const nq = nextQ ?? q.value;
  const nb = nextBrand ?? brand.value;
  if (nq.trim()) query.q = nq.trim();
  if (nb) query.brand = nb;
  // replace 而不是 push：连续输入不该在历史里堆几十条记录
  router.replace({ path: '/search', query });
}

function pickBrand(id: string) {
  apply(undefined, brand.value === id ? '' : id);
}

function clearAll() {
  q.value = '';
  apply('', '');
}
</script>

<template>
  <div class="page-shell space-y-6 py-6">
    <LoadingState v-if="!ds" :label="t('common.loading')" />
    <template v-else>
    <section class="card p-5 sm:p-6">
      <h1 class="text-xl font-semibold text-fg">{{ t('search.title') }}</h1>
      <p class="mt-1 text-sm text-dim">{{ t('search.count', { n: results.length, total: docs.length }) }}</p>

      <label class="mt-4 block">
        <span class="sr-only">{{ t('search.ariaLabel') }}</span>
        <span class="relative block">
          <span
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            aria-hidden="true"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" stroke-linecap="round" />
            </svg>
          </span>
          <input
            id="site-search"
            v-model="q"
            type="search"
            :placeholder="t('search.placeholder')"
            class="input pl-9"
            autocomplete="off"
            @input="apply()"
          />
        </span>
      </label>

      <!--
        容错提示条：只在「精确匹配一个都没搜到、靠归一化兜住」时出现。
        不写的话用户会困惑「我明明打错了怎么还有结果」——
        与其让用户猜，不如告诉他系统做了什么（这也是数据诚信的一部分）。
      -->
      <p
        v-if="usedLooseMatch"
        class="mt-3 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" stroke-linecap="round" />
        </svg>
        {{ t('search.looseHint', { q, name: looseHint }) }}
      </p>

      <!-- 品牌过滤：只列数据里真实存在的品牌，台数是真实计数 -->
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <span class="text-sm text-dim">{{ t('search.brandLabel') }}</span>
        <button
          type="button"
          class="chip"
          :aria-pressed="!brand"
          @click="apply(undefined, '')"
        >
          {{ t('search.allBrands', { n: docs.length }) }}
        </button>
        <button
          v-for="b in brands"
          :key="b.id"
          type="button"
          class="chip"
          :aria-pressed="brand === b.id"
          :style="brand === b.id ? undefined : { color: b.accentColor }"
          @click="pickBrand(b.id)"
        >
          {{ b.nameZh }} {{ b.count }}
        </button>
        <button
          v-if="hasQuery"
          type="button"
          class="chip"
          style="color: var(--color-danger)"
          @click="clearAll"
        >
          {{ t('search.clear') }}
        </button>
      </div>
    </section>

    <!-- 未输入：给真实存在的建议词，而不是留白 -->
    <div v-if="!hasQuery" class="card p-5 sm:p-6">
      <p class="text-sm text-dim">
        {{ t('search.tipA') }}
        <b class="font-semibold text-fg">{{ t('search.tipBold') }}</b>
        {{ t('search.tipB') }}
        <span class="text-fg">nova 14 Ultra</span>
        {{ t('search.tipConj') }}
        <span class="text-fg">nova14ultra</span> {{ t('search.tipC') }}
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          v-for="h in hint"
          :key="h"
          type="button"
          class="chip"
          @click="
            q = h;
            apply(h);
          "
        >
          {{ h }}
        </button>
      </div>
    </div>

    <!-- 有查询无结果：说清是哪一部分没命中，而不是只说「无结果」 -->
    <div v-else-if="!results.length" class="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p class="text-lg font-semibold text-danger">{{ t('search.noResultTitle') }}</p>
      <p class="max-w-sm text-sm text-dim">{{ t('search.noResultBody') }}</p>
      <button type="button" class="btn btn-ghost px-3 py-1.5 text-sm" @click="clearAll">
        {{ t('search.clearConditions') }}
      </button>
    </div>

    <ul v-else class="space-y-2">
      <li v-for="(r, i) in resultsShown" :key="r.product.id">
        <RouterLink
          :to="`/product/${r.product.id}`"
          class="card card-hover grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
        >
          <span class="w-6 flex-none text-center text-xs text-dim">{{ i + 1 }}</span>
          <span class="min-w-0">
            <span class="flex items-center gap-2">
              <span class="truncate text-sm font-medium text-fg">{{ r.product.name }}</span>
              <span class="shrink-0 text-sm" :style="{ color: r.vendor?.accentColor }">
                {{ r.vendor?.nameZh ?? r.product.brand }}
              </span>
            </span>
            <span class="mt-0.5 block truncate text-xs text-dim">
              {{ r.product.line }}
              <template v-if="r.product.nameZh"> · {{ r.product.nameZh }}</template>
            </span>
          </span>
          <span class="hidden shrink-0 items-center gap-3 sm:flex">
            <span
              v-for="a in brief?.(r.product.id) ?? []"
              :key="a.key"
              class="text-xs"
              :style="{
                color: a.raw == null ? 'var(--color-faint)' : 'var(--color-dim)',
              }"
              >{{ a.label }} {{ a.display }}</span
            >
          </span>
        </RouterLink>
      </li>
    </ul>
    <div v-if="hasMore" class="mt-3 flex flex-col items-center gap-1.5">
      <button type="button" class="btn btn-ghost px-4 py-1.5 text-sm" @click="showMore">
        {{ t('common.showMore') }}
      </button>
      <span class="text-sm text-dim">
        {{ t('common.shownOf', { shown: resultsShown.length, total: resultsTotal }) }}
      </span>
    </div>
    </template>
  </div>
</template>
