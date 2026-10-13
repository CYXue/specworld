<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useDataset, useDerived } from '../lib/useDataset';
import { buildDocs, search, suggestions, tokenize } from '../lib/search';
import { abilityRows } from '../lib/specs';
import PxIcon from '../components/PxIcon.vue';
import SectionFrame from '../components/SectionFrame.vue';
import SpriteImg from '../components/SpriteImg.vue';

// 搜索页：URL 即状态。
// q 与 brand 都写在 query 里（#/search?q=mate&brand=huawei），所以刷新、分享、
// 浏览器前进后退都能还原同一份结果 —— hash 路由下这是唯一可靠的做法，
// 拿组件内的 ref 存查询词会让「后退」直接失灵。
const { t } = useI18n();
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
  const seen = new Map<string, { id: string; nameZh: string; count: number; accent: string }>();
  for (const doc of docs.value) {
    const cur = seen.get(doc.brand);
    if (cur) cur.count += 1;
    else
      seen.set(doc.brand, {
        id: doc.brand,
        nameZh: doc.vendor?.nameZh ?? doc.brand,
        count: 1,
        accent: doc.vendor?.accentColor ?? 'var(--color-parchment)',
      });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
});

const results = computed(() => search(docs.value, q.value, { brand: brand.value }));
const hasQuery = computed(() => q.value.trim().length > 0 || brand.value.length > 0);
const hint = computed(() => suggestions(docs.value));

/**
 * 本次结果是不是靠「忽略大小写/空格」的容错通道兜出来的。
 *
 * 判据：**精确通道一个都没命中，但归一化通道有** —— 与 search() 的分级逻辑同源。
 * 用「用户输入去掉空格后是否等于原样」来判是错的：那只能覆盖连写这一种写法，
 * 漏掉大小写、全角、分隔符等等，而那些同样是容错生效的场景。
 */
const usedLooseMatch = computed(() => {
  const tokens = tokenize(q.value);
  if (!tokens.length) return false;
  const byExact = docs.value.filter((d) => tokens.every((t) => (d.haystack ?? '').includes(t)));
  return byExact.length === 0 && results.value.length > 0;
});

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
    <SectionFrame :title="t('search.title')" hud="var(--color-crown)" icon="search">
      <template #aside>{{ t('search.count', { n: results.length, total: docs.length }) }}</template>

      <label class="block">
        <span class="sr-only">{{ t('search.ariaLabel') }}</span>
        <input
          v-model="q"
          type="search"
          :placeholder="t('search.placeholder')"
          class="pixel-input w-full px-3 py-2 text-[12px] leading-[1.5]"
          autocomplete="off"
          @input="apply()"
        />
      </label>

      <!--
        容错提示条：只在「精确匹配一个都没搜到、靠归一化兜住」时出现。
        不写的话用户会困惑「我明明打错了怎么还有结果」——
        与其让用户猜，不如告诉他系统做了什么（这也是数据诚信的一部分）。
      -->
      <p
        v-if="usedLooseMatch"
        class="mt-2 flex items-center gap-2 px-2 py-1 text-[12px] leading-[1.5]"
        style="color: var(--color-dawn)"
      >
        <PxIcon name="search" :size="12" class="flex-none" />
        {{ t('search.looseHint', { q, name: looseHint }) }}
      </p>

      <!-- 品牌过滤：只列数据里真实存在的品牌，台数是真实计数 -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="w-10 shrink-0 text-[12px] leading-[1.5]" style="color: var(--color-ink-soft)"
          >{{ t('search.brandLabel') }}</span
        >
        <button
          class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
          :aria-pressed="!brand"
          @click="apply(undefined, '')"
        >
          {{ t('search.allBrands', { n: docs.length }) }}
        </button>
        <button
          v-for="b in brands"
          :key="b.id"
          class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
          :aria-pressed="brand === b.id"
          :style="brand === b.id ? undefined : { color: b.accent }"
          @click="pickBrand(b.id)"
        >
          {{ b.nameZh }} {{ b.count }}
        </button>
        <button
          v-if="hasQuery"
          class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
          style="color: var(--color-east)"
          @click="clearAll"
        >
          {{ t('search.clear') }}
        </button>
      </div>
    </SectionFrame>

    <!-- 未输入：给真实存在的建议词，而不是留白 -->
    <div v-if="!hasQuery" class="pixel-note pixel-stripe p-4">
      <p class="mb-3 text-[12px] leading-[1.5]" style="color: var(--color-parchment-dim)">
        {{ t('search.tipA') }}
        <b class="text-[var(--color-gold)]">{{ t('search.tipBold') }}</b>
        {{ t('search.tipB') }}
        <span style="color: var(--color-parchment)">nova 14 Ultra</span> 与
        <span style="color: var(--color-parchment)">nova14ultra</span> {{ t('search.tipC') }}
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="h in hint"
          :key="h"
          class="pixel-tag px-2 py-1 text-[12px] leading-[1.5]"
          style="color: var(--color-parchment)"
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
    <div v-else-if="!results.length" class="pixel-note p-6 text-center">
      <p
        class="pixel-outline font-pixel text-[24px] leading-[1.5]"
        style="color: var(--color-ember)"
      >
        {{ t('search.noResultTitle') }}
      </p>
      <p class="mt-3 text-[12px] leading-[1.5]" style="color: var(--color-ink-soft)">
        {{ t('search.noResultBody') }}
      </p>
      <button class="pixel-button mt-4 px-3 py-1.5 text-[12px] leading-[1.5]" @click="clearAll">
        {{ t('search.clearConditions') }}
      </button>
    </div>

    <ul v-else class="space-y-2">
      <li v-for="(r, i) in results" :key="r.product.id">
        <RouterLink
          :to="`/product/${r.product.id}`"
          class="pixel-row grid grid-cols-[auto_auto_1fr] items-center gap-3 px-2.5 py-2 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto]"
        >
          <span
            class="pixel-chip w-6 py-0.5 text-center text-[12px] leading-[1.5]"
            style="color: var(--color-ink-soft)"
            >{{ i + 1 }}</span
          >
          <SpriteImg :id="r.product.id" :delay="i * 0.12" class="h-9 w-auto" />
          <span class="min-w-0">
            <span class="flex items-center gap-2">
              <span class="truncate text-[12px] leading-[1.5] text-[var(--color-parchment-lit)]">{{
                r.product.name
              }}</span>
              <span class="shrink-0 text-[12px]" :style="{ color: r.vendor?.accentColor }">
                {{ r.vendor?.nameZh ?? r.product.brand }}
              </span>
            </span>
            <span
              class="mt-0.5 block truncate text-[12px] leading-[1.5]"
              style="color: var(--color-ink-soft)"
            >
              {{ r.product.line }}
              <template v-if="r.product.nameZh"> · {{ r.product.nameZh }}</template>
            </span>
          </span>
          <span class="hidden shrink-0 items-center gap-3 sm:flex">
            <span
              v-for="a in brief?.(r.product.id) ?? []"
              :key="a.key"
              class="text-[12px] leading-[1.5]"
              :style="{
                color: a.raw == null ? 'var(--color-ink-soft)' : 'var(--color-parchment-dim)',
              }"
              >{{ a.label }} {{ a.display }}</span
            >
          </span>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
