<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import { useDataset } from '../lib/useDataset';
import { CODE_LICENSE, LICENSE_PATH, REPO_URL } from '../lib/site';

// 关于页 = 项目说明 + 数据与原则 + 许可与署名。
// 「数据与原则」原先挂在每个页面底部的 SiteFooter，用户要求收敛到独立关于页，
// 避免在所有页面重复铺开。这里自己取数据源（与 App 同源单例），不再经 props 下钻。
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

/**
 * 数据来源行。`note` 是管线拼好的中文串，**不能直接展示**（英文页会吐中文）——
 * 展示走管线同时写下的 `noteKey` + `noteParams`（2026-10-14 i18n 深扫修）。
 * 老快照没有 noteKey 时回落到 note：宁可显示中文，也不要整行空掉。
 */
const sources = computed(() =>
  Object.entries(ds.value?.sources ?? {}).map(([key, v]) => ({
    key,
    note: v.noteKey ? t(v.noteKey, v.noteParams ?? {}) : v.note,
    ok: v.ok,
  })),
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
    terms: t(l.termsKey, { license: CODE_LICENSE }),
    body: t(l.bodyKey),
    links: l.links.map((x) => ({ label: t(x.labelKey), href: x.href })),
  })),
);
</script>

<template>
  <div class="page-shell space-y-8 py-6">
    <!-- 刊头：kicker + 大墨字标题（与首页同一套刊头语言） -->
    <header>
      <p class="kicker">Specworld</p>
      <h1 class="mt-1 text-3xl font-bold tracking-tight text-fg">{{ t('about.title') }}</h1>
      <p class="mt-1 text-sm text-dim">{{ t('about.subtitle') }}</p>
    </header>

    <!-- 01 / 项目说明 -->
    <section class="card space-y-3 p-5">
      <h2 class="kicker">01 / {{ t('about.introTitle') }}</h2>
      <p class="text-sm leading-relaxed text-fg">
        {{ t('about.introA') }}<b class="text-accent">{{ t('about.introBold') }}</b>{{ t('about.introB') }}
      </p>
      <!-- 首版范围表：mono 键值对（纸上数据库的「规格行」） -->
      <ul class="grid gap-0 overflow-hidden rounded-[4px] border border-border sm:grid-cols-2">
        <li
          v-for="row in scope"
          :key="row.key"
          class="flex items-baseline gap-2 border-b border-border px-3 py-2 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0"
        >
          <span class="kicker">{{ row.label }}</span>
          <span class="num text-sm text-fg">{{ row.value }}</span>
        </li>
      </ul>
      <p class="text-sm leading-relaxed text-faint">{{ t('about.why') }}</p>
    </section>

    <!-- 02 / 数据与原则 -->
    <section class="card space-y-3 p-5">
      <h2 class="kicker">02 / {{ t('about.dataTitle') }}</h2>
      <ul class="space-y-2.5">
        <li v-for="(p, i) in principles" :key="p.key" class="flex gap-3">
          <span class="num mt-0.5 flex-none text-sm font-semibold text-faint">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="text-sm leading-relaxed text-fg"
            ><b class="text-accent">{{ p.title }}：</b>{{ p.body }}</span
          >
        </li>
      </ul>
      <div class="border-t border-border pt-3">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span class="kicker">{{ t('about.snapshot') }}</span>
          <span v-if="generatedAt" class="num text-fg">{{ generatedAt }}</span>
          <span v-else class="text-faint">{{ t('about.loading') }}</span>
        </div>
        <div v-if="sources.length" class="mt-2 flex flex-wrap gap-1.5">
          <span
            v-for="s in sources"
            :key="s.key"
            class="badge"
            :class="
              s.ok
                ? 'border-success/30 bg-success-soft text-success'
                : 'border-danger/30 bg-danger-soft text-danger'
            "
            :title="s.note"
          >
            {{ s.ok ? '✓' : '×' }} {{ s.key }}
          </span>
        </div>
      </div>
      <p class="text-sm leading-relaxed text-faint">{{ t('about.dataFooter') }}</p>
    </section>

    <!-- 03 / 许可与署名 -->
    <section class="card space-y-3 p-5">
      <h2 class="kicker">03 / {{ t('about.licenseTitle') }}</h2>
      <ul class="grid gap-2">
        <li v-for="l in licenses" :key="l.key" class="border border-border bg-surface-2 px-3 py-2">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <span class="text-sm font-semibold text-fg">{{ l.name }}</span>
            <span class="text-sm text-dim">{{ l.terms }}</span>
          </div>
          <p class="mt-1 text-sm leading-relaxed text-dim">{{ l.body }}</p>
          <p
            v-if="l.links.length"
            class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          >
            <template v-for="(lk, i) in l.links" :key="lk.href">
              <span v-if="i > 0" class="text-faint" aria-hidden="true">·</span>
              <a :href="lk.href" target="_blank" rel="noopener noreferrer" class="text-link hover:underline">{{
                lk.label
              }}</a>
            </template>
          </p>
        </li>
      </ul>
      <p class="text-sm leading-relaxed text-faint">{{ t('about.artNote') }}</p>
    </section>
  </div>
</template>
