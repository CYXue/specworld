<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDataset } from '../lib/useDataset';
import PxIcon from '../components/PxIcon.vue';
import SectionFrame from '../components/SectionFrame.vue';
import { asset } from '../lib/assets';
import { CODE_LICENSE, FONT_NAME, FONT_UPSTREAM_URL, LICENSE_PATH, REPO_URL } from '../lib/site';

// 关于页 = 项目说明 + 数据与原则 + 许可与署名。
// 「数据与原则」原先挂在每个页面底部的 SiteFooter，用户要求收敛到独立关于页，
// 避免在所有页面重复铺开。这里自己取数据源（与 App 同源单例），不再经 props 下钻。
const { t } = useI18n();
const { ds } = useDataset();

const generatedAt = computed(() => {
  const t = ds.value?.generatedAt;
  if (!t) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
});

/** 首版范围表（键化：label/value 都进语言包，键同样字面量） */
const SCOPE = [
  { key: 'category', labelKey: 'about.scopeCategory.label', valueKey: 'about.scopeCategory.value' },
  { key: 'brands', labelKey: 'about.scopeBrands.label', valueKey: 'about.scopeBrands.value' },
  { key: 'models', labelKey: 'about.scopeModels.label', valueKey: 'about.scopeModels.value' },
  { key: 'form', labelKey: 'about.scopeForm.label', valueKey: 'about.scopeForm.value' },
  { key: 'data', labelKey: 'about.scopeData.label', valueKey: 'about.scopeData.value' },
] as const;
const scope = computed(() =>
  SCOPE.map((r) => ({ key: r.key, label: t(r.labelKey), value: t(r.valueKey) })),
);

const sources = computed(() =>
  Object.entries(ds.value?.sources ?? {}).map(([key, v]) => ({ key, note: v.note, ok: v.ok })),
);

/**
 * 原则条目：**键化**。整段中文散文塞在 .vue 里是最典型的「i18n 半吊子」——
 * 切换器存在、内容不跟着变。这里只存键，文案在 `locales/*.json` 的 `about.principle*`。
 *
 * ⚠️ **键必须写成字面量，不能拼字符串**：`t('about.principle' + n + '.title')` 这种
 * 拼法对账闸门看不见（它扫的是源码里的键字面量），拼错了要到运行时才炸。
 * 宁可多写几行，也要让「用了哪个键」在代码里一眼可见。
 */
const PRINCIPLES = [
  { key: 'one', titleKey: 'about.principleOne.title', bodyKey: 'about.principleOne.body' },
  { key: 'two', titleKey: 'about.principleTwo.title', bodyKey: 'about.principleTwo.body' },
  { key: 'three', titleKey: 'about.principleThree.title', bodyKey: 'about.principleThree.body' },
  { key: 'four', titleKey: 'about.principleFour.title', bodyKey: 'about.principleFour.body' },
  { key: 'five', titleKey: 'about.principleFive.title', bodyKey: 'about.principleFive.body' },
] as const;
const principles = computed(() =>
  PRINCIPLES.map((p) => ({ key: p.key, title: t(p.titleKey), body: t(p.bodyKey) })),
);

/**
 * 许可与署名。分四类，别混成一栏：
 *   代码/数据产物 = 本项目自己的，MIT；
 *   字体          = 第三方 OFL，**改了就得改名 + 披露**，这是 OFL 的硬要求；
 *   数据          = 厂商官网事实数据，没有「许可证」这回事，不能像 CC-BY 数据集那样标；
 *   商标          = 机型名是各厂商的商标，只能指称性使用。
 * 写成一行「数据来自 XX（CC-BY）」是错的 —— 事实数据不适用 CC-BY。
 */
/** 许可条目同样键化（同上：键一律字面量）；链接按条目类型分别写死，不动态拼。 */
const LICENSES = [
  {
    key: 'code',
    nameKey: 'about.licenseCode.name',
    termsKey: 'about.licenseCode.terms',
    bodyKey: 'about.licenseCode.body',
    links: [{ labelKey: 'about.licenseLinkView', href: `${REPO_URL}/blob/main/${LICENSE_PATH}` }],
  },
  {
    key: 'font',
    nameKey: 'about.licenseFont.name',
    termsKey: 'about.licenseFont.terms',
    bodyKey: 'about.licenseFont.body',
    links: [
      { labelKey: 'about.licenseLinkFull', href: asset('fonts/OFL.txt') },
      { labelKey: 'about.licenseLinkUpstream', href: FONT_UPSTREAM_URL },
    ],
  },
  {
    key: 'data',
    nameKey: 'about.licenseData.name',
    termsKey: 'about.licenseData.terms',
    bodyKey: 'about.licenseData.body',
    links: [],
  },
  {
    key: 'trademark',
    nameKey: 'about.licenseTrademark.name',
    termsKey: 'about.licenseTrademark.terms',
    bodyKey: 'about.licenseTrademark.body',
    links: [],
  },
] as const;
const licenses = computed(() =>
  LICENSES.map((l) => ({
    key: l.key,
    name: t(l.nameKey),
    terms: t(l.termsKey, { license: CODE_LICENSE, fontName: FONT_NAME }),
    body: t(l.bodyKey, { fontName: FONT_NAME }),
    links: l.links.map((x) => ({ label: t(x.labelKey), href: x.href })),
  })),
);
</script>

<template>
  <div class="page-shell space-y-6 py-6">
    <header>
      <h1
        class="pixel-outline font-pixel text-[24px] leading-[1.5] text-[var(--color-parchment-lit)]"
      >
        {{ t('about.title') }}
      </h1>
      <p class="mt-1 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)]">
        {{ t('about.subtitle') }}
      </p>
    </header>

    <SectionFrame :title="t('about.introTitle')">
      <p class="mb-3 text-[12px] leading-[1.6] text-[var(--color-parchment-lit)]">
        {{ t('about.introA') }}
        <b class="text-[var(--color-gold)]">{{ t('about.introBold') }}</b>
        {{ t('about.introB') }}
      </p>
      <ul class="grid gap-2 sm:grid-cols-2">
        <li
          v-for="row in scope"
          :key="row.key"
          class="pixel-panel px-3 py-2"
        >
          <span class="pixel-heading text-[12px] leading-[1.5]">{{ row.label }}</span>
          <span class="ml-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)]">{{
            row.value
          }}</span>
        </li>
      </ul>
      <p class="mt-3 text-[12px] leading-[1.6] text-[var(--color-ink-soft)]">
        {{ t('about.why') }}
      </p>
    </SectionFrame>

    <SectionFrame :title="t('about.dataTitle')">
      <ul class="space-y-2">
        <li v-for="p in principles" :key="p.key" class="flex gap-2">
          <PxIcon name="dot" :size="8" class="mt-1 flex-none text-[var(--color-gold)]" />
          <span class="text-[12px] leading-[1.6] text-[var(--color-parchment-lit)]">
            <b class="text-[var(--color-gold)]">{{ p.title }}：</b>{{ p.body }}
          </span>
        </li>
      </ul>

      <div class="mt-4 border-t-2 border-[var(--color-ink)] pt-3">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-[1.5]">
          <span class="pixel-heading">{{ t('about.snapshot') }}</span>
          <span v-if="generatedAt" class="text-[var(--color-parchment-lit)]">{{
            generatedAt
          }}</span>
          <span v-else class="text-[var(--color-ink-soft)]">{{ t('about.loading') }}</span>
        </div>

        <div v-if="sources.length" class="mt-2 flex flex-wrap gap-1.5">
          <span
            v-for="s in sources"
            :key="s.key"
            class="pixel-chip flex items-center gap-1 px-1.5 py-0.5 text-[12px] leading-[1.5]"
            :style="{ color: s.ok ? 'var(--color-newborn)' : 'var(--color-east)' }"
            :title="s.note"
          >
            <PxIcon :name="s.ok ? 'check' : 'cross'" :size="10" />
            {{ s.key }}
          </span>
        </div>
      </div>

      <p class="mt-3 text-[12px] leading-[1.6] text-[var(--color-ink-soft)]">
        {{ t('about.dataFooter') }}
      </p>
    </SectionFrame>

    <SectionFrame :title="t('about.licenseTitle')">
      <ul class="grid gap-2">
        <li v-for="l in licenses" :key="l.key" class="pixel-panel px-3 py-2">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <span class="pixel-heading text-[12px] leading-[1.5]">{{ l.name }}</span>
            <span class="text-[12px] leading-[1.5] text-[var(--color-parchment-lit)]">{{
              l.terms
            }}</span>
          </div>
          <p class="mt-1 text-[12px] leading-[1.6] text-[var(--color-parchment-dim)]">
            {{ l.body }}
          </p>
          <p
            v-if="l.links.length"
            class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-[1.5]"
          >
            <template v-for="(lk, i) in l.links" :key="lk.href">
              <span v-if="i > 0" class="text-[var(--color-stone)]" aria-hidden="true">·</span>
              <a class="pixel-link" :href="lk.href" target="_blank" rel="noopener noreferrer">{{
                lk.label
              }}</a>
            </template>
          </p>
        </li>
      </ul>
      <p class="mt-3 text-[12px] leading-[1.6] text-[var(--color-ink-soft)]">
        {{ t('about.artNote') }}
      </p>
    </SectionFrame>
  </div>
</template>
