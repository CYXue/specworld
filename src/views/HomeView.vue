<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { continentOf } from '../types';
import { useDataset, useDerived } from '../lib/useDataset';
import { championsByCategory } from '../lib/specs';
import { categoryLabel, latestN, spotlights } from '../lib/catalog';
import BrandGroup from '../components/BrandGroup.vue';
import ChampionRow from '../components/ChampionRow.vue';
import SectionFrame from '../components/SectionFrame.vue';
import SiteNav from '../components/SiteNav.vue';
import SpotlightStrip from '../components/SpotlightStrip.vue';

/** 首页每个品牌只列几台：门面要给「最新/最贵/最便宜」让位，不能铺 60 台下去。 */
const BRAND_PREVIEW = 4;

/**
 * ⚠️ 顶栏高度**不在这里定** —— 它是分断点的（见文末 `<style>` 的 `.banner-h`）。
 *
 * 为什么不写成 `BANNER_H = 'clamp(...)'`（2026-10-08 实测后删掉的写法）：
 * **内容高度随宽度是「非单调」的**，单一 clamp 表达不了。puppeteer 逐档量出来：
 * ```
 * 宽 ≥901 ：内容 72px（站名单行 + 导航单行）
 * 641–900：内容 106px（导航折到第二行）
 * ≤640  ：内容 106px
 * ≤380  ：内容 134px（导航折到第三行）
 * ```
 * 一个 clamp 只能满足一头 ⇒ 拆四档，每档 = 内容 + 底部 8px 呼吸。
 * **单一真源在 CSS**，不在 JS 常量：值与 `@media` 写在一起才读得懂，
 * 拆成「JS 数字 + CSS 媒体查询」两处必然对不上（同「判据只能有一个真源」）。
 */

/**
 * 顶栏底色 = **对角黑白灰阶过渡**，离散 16 档、**硬边**（不是连续渐变）。
 *
 * 为什么是离散色带而不是 `linear-gradient` 连续过渡：`CONVENTIONS.md` §2.5.1
 * 定的是**零渐变** —— 连续过渡靠插值，像素风靠枚举。全站零模糊/零渐变是硬边质感的根，
 * 一旦这里开了连续渐变，`_smoke-pixel.cjs` 抓不到（它只查模糊/圆角/字号），
 * 但风格统一会从这里开始漏。所以用「同一色硬写两遍、位置错开一档」造出阶梯边。
 *
 * 亮度序列（**WCAG 线性亮度**，单调递增）：
 *   1.0% → 1.9% → 2.8% → … → 16.7% → 17.5%（16 档等差）
 * - 必须在**线性亮度空间等差，不能在 sRGB 灰阶上等差**（低亮度端被压缩，
 *   按 sRGB 等差会排出「肉眼看不出差」的两档 —— 详见 `Sky.vue` 注释）。
 * - 峰值17.5% ⇒ 对纯白文字 **4.67:1** ≥ 4.5:1（WCAG AA），
 *   因为白色「参数世界」就压在这条带子上。
 * - 方向 `to bottom right`：左上最暗（标题所在），右下最亮（空白区）。
 *   这样标题永远落在最暗的一档上，对比度最优。
 *
 * ⚠️ **为什么是 16 档、不能再密**（2026-10-08 实测）：
 * 这段亮度区间的 8-bit 可用跨度只有 **91 级**（灰 25→116）。档数一多，
 * 相邻档的**灰阶跳变会掉到 1 级**，那一档就等于白占一行（看得见边、看不出色差）。
 * 实测：16 档 → 最小跳 **3 级**（安全）；20 档 → 2 级；24 档 → 2 级（开始浪费）。
 * 反过来档数太少（6 档）又显得**太粗**、没有层次。
 * 16 档 = 「每档都真实可辨」与「过渡够密」之间的上限。
 */
const DIAG_BANDS = [
  '#19191c', '#28282b', '#323235', '#3a3a3d', '#424245', '#48484b', '#4e4e51', '#535356',
  '#58585b', '#5d5d60', '#616164', '#656568', '#69696c', '#6d6d70', '#717174', '#747477',
];

/**
 * 把 16 档离散色带展开成 `linear-gradient` 的硬停点：
 * 每档写两遍（起始位置 = 结束位置），于是每一档内部纯色、档与档之间是硬边。
 * `linear-gradient` 只是**承载阶梯的工具**，视觉结果是 16 条硬边斜带，不是渐变。
 */
const bannerBackground = `linear-gradient(to bottom right, ${DIAG_BANDS.map((c, i) => {
  const a = ((i / DIAG_BANDS.length) * 100).toFixed(4);
  const b = (((i + 1) / DIAG_BANDS.length) * 100).toFixed(4);
  return `${c} ${a}%, ${c} ${b}%`;
}).join(', ')})`;

const { t } = useI18n();
const { ds, err } = useDataset();
const derived = useDerived();

const champs = computed(() => (ds.value ? championsByCategory(ds.value.products) : []));
const spots = computed(() => (ds.value ? spotlights(ds.value.products) : []));
const groups = computed(() => {
  const d = ds.value;
  // bounds 随 groups 一起下发：曾经模板写 `:bounds="bounds!"`，靠「ds 非空时
  // derived 必然算完」这条**推理链**保证 —— 推理不在类型里，加载时序一变就是
  // null 传进子组件。现在 groups 空转（数据未就绪）时整块不渲染，
  // 非空由数据结构保证，不需要 `!`（2026-10-14 审计 B4）。
  const b = derived.value?.bounds;
  if (!d || !b) return [];
  return d.vendors.map((v) => ({
    vendor: v,
    continent: continentOf(v),
    products: latestN(
      d.products.filter((p) => p.brand === v.id),
      BRAND_PREVIEW,
    ),
    total: d.products.filter((p) => p.brand === v.id).length,
    bounds: b,
  }));
});
/** 更新日期的**两个分量**分开算：语言包自己决定怎么拼（中文「3 月 5 日」、英文「Mar 5」）。 */
const updatedParts = computed(() => {
  const ts = ds.value?.generatedAt;
  if (!ts) return null;
  const d = new Date(ts);
  // 非法时间戳不能让 NaN 流到模板：`new Date('胡说')` 不抛错，
  // getUTCMonth() 返回 NaN ⇒ 页面渲染「NaN 月 NaN 日」（2026-10-14 审计 B8）。
  // 解析失败视为「没有更新日期」，整块不显示，不显示半个坏行。
  if (Number.isNaN(d.getTime())) return null;
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
});
const count = computed(() => ds.value?.products.length ?? 0);
</script>

<template>
  <div>
    <div v-if="err" class="page-shell py-10 text-center" style="color: var(--color-east)">
      {{ t('home.loadFailed', { err }) }}
    </div>

    <template v-else>
      <!--
        地平线带。**结构照参考项目（ai-model-world）重做**：标题**压**在天空上、
        导航在右侧同行，而不是把标题排在天空下面。

        它原来的写法是「半屏高的标题海报」，参考项目自己的注释说那是错的：
        「进站第一眼看到的是一张封面而不是一个世界」。
        我第一版也是错的结构 —— 天空 112px 之上再排 40px 的标题区，
        于是天空变成了纯装饰，标题区变成了正文。两段都在争同一块地方。

        改成 HUD 之后：
        - 标题与导航成为**一组**（本来就该是：站名 + 入口），右端`justify-between`；
        - 副标题与状态行贴在标题下方，同属「读数」区；
        - 整条banner 从 118px 降到 **96px**，且天空真正参与了排版（它是底板）。

        ⚠️ **顶栏那条「居中一整组」的规则在这里不适用** ——
        顶栏元素多、搜索框压右，居中才对；这里左右各一组、两端对齐才对。
        两条规则是各自容器决定的，不是「统一风格」。
      -->
      <!--
        首页顶栏 = 对角黑白灰阶过渡（16 档离散硬边色带，见上方 `bannerBackground`）。
        标题/导航浮在其上；不再用马赛克太极图，也不用 Sky 色带 + Ground 地层。

        结构沿用「HUD 而非标题海报」的判断：进站第一眼应该是这个世界，不是封面。
      -->
      <section
        class="banner-h relative overflow-hidden"
        :style="{ backgroundImage: bannerBackground }"
      >
        <div
          class="page-shell relative z-10 flex flex-wrap items-start justify-between gap-x-3 gap-y-2 pt-2"
        >
          <!-- 左：站名 + 读数区 -->
          <div class="min-w-0">
            <h1 class="pixel-outline font-pixel text-[24px] leading-[1.4]">{{ t('brand.name') }}</h1>
            <div class="mt-1.5 flex flex-wrap items-start gap-x-2 gap-y-1">
              <!--
                副标题保留（用户2026-10-06 拍板）：它是品牌标语不是自我介绍。
                参考项目把标语整条删了，理由是「用户是来看格局的」——
                但本站的定位句是「选择更清楚」，它说明的是**这个站在做什么取舍**
                （页脚同样有它），不是罗列规模。规模数据在右边那枚读数里。
              -->
              <p class="font-pixel text-[12px] leading-[1.5] text-[var(--color-parchment-lit)]">
                {{ t('brand.tagline') }}
              </p>
              <!--
                状态行做成「仪器读数」：细边框 + 半透底 + 呼吸灯。
                它浮在灰阶斜带上，底色随位置从近黑变到中灰，
                不加底色的这行字在亮的那半上是读不清的，故给一层半透深底。
              -->
              <p
                class="inline-flex items-center gap-1.5 border px-2 py-0.5 font-pixel text-[12px] leading-[1.5] text-[var(--color-parchment)]"
                style="
                  border-color: rgb(98 182 224 / 0.45);
                  background: rgb(13 16 23 / 0.55);
                "
              >
                <!-- 呼吸灯：纯色方块 + steps 动画，零模糊 -->
                <span
                  class="anim-blink inline-block h-2 w-2 flex-none"
                  style="background: var(--color-west)"
                  aria-hidden
                />
                {{ updatedParts ? t('home.status', { n: count, month: updatedParts.month, day: updatedParts.day }) : t('home.statusUndated', { n: count }) }}
              </p>
            </div>
          </div>
          <!-- 右：导航。窄屏时它换行占满（embedded 模式负责 w-full） -->
          <SiteNav embedded />
        </div>
      </section>

      <!-- 正文首屏：py-6 → py-4。hero 压掉 68px 之后，这里再让 16px，
           第一张卡片整体提前 84px 出现在首屏。 -->
      <div class="page-shell space-y-8 py-4">
        <!--
          最新 / 最贵 / 最便宜，按子品类各取一台。
          放在各品牌村落**之前** —— 用户进广场先看到的是「眼下什么最强最贵最便宜」，
          而不是先滚过 60 台机型卡片。
        -->
        <SectionFrame
          :title="t('home.spotlightTitle')"
          hud="var(--color-gold)"
          icon="trophy"
        >
          <p
            class="pixel-note mb-4 px-3 py-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)]"
          >
            {{ t('home.spotlightNote') }}
          </p>
          <SpotlightStrip :spots="spots" :vendors="derived?.vendors ?? new Map()" />
        </SectionFrame>

        <!-- 各品牌村落：每家只摆最新几台 -->
        <BrandGroup
          v-for="g in groups"
          :key="g.vendor.id"
          :vendor="g.vendor"
          :continent="g.continent"
          :products="g.products"
          :bounds="g.bounds"
          :limit="BRAND_PREVIEW"
        />

        <!--
          各维度第一：放在品牌村落之后。
          「最新/最贵/最便宜」讲的是**新与价**，这里讲的是**单项能力极值**，两者不重合
          （屏幕最锐的机器未必最贵），所以都留着而不是二选一。
          2026-10-15 六品类扩充：按品类分开发奖杯（口径同单位的手机/平板混池会让
          iPad 静默拿走手机头衔），与 SpotlightStrip 的品类 spotlight 同构。
        -->
        <SectionFrame :title="t('home.championTitle')" hud="var(--color-gold)" icon="trophy">
          <div v-for="cg in champs" :key="cg.category" class="mb-4 last:mb-0">
            <h3
              class="mb-2 px-1 text-[12px] leading-[1.5]"
              style="color: var(--color-parchment-dim)"
            >
              {{ categoryLabel(cg.category as Parameters<typeof categoryLabel>[0]) }}
            </h3>
            <div class="grid gap-3 sm:grid-cols-2">
              <ChampionRow
                v-for="c in cg.champions"
                :key="c.key + c.product.id"
                :champion="c"
                :accent="derived?.vendors.get(c.product.brand)?.accentColor"
                :vendors="derived?.vendors ?? new Map()"
              />
            </div>
          </div>
        </SectionFrame>
      </div>
    </template>
  </div>
</template>

<style scoped>
/**
 * 顶栏高度 —— **分四档，不用 clamp**（2026-10-08 puppeteer 逐档实测后改）。
 *
 * 为什么不用 `height: clamp(124px, 9vw, 152px)`：**内容高度随宽度是非单调的**，
 * 单一 clamp 只能满足一头。实测内容占位（`pt-2` 版，19 档宽度扫出来的）：
 * ```
 * 宽 ≥901 ：72px  （站名单行 + 导航单行）
 * 641–900 ：106px （导航折到第二行）
 * 381–640 ：106px
 * ≤380   ：134px （导航折到第三行）← 需要 148px，旧 clamp 的 124px 在这里裁掉 10px
 * ```
 * 旧值的问题是对**两头都不对**：桌面 124 − 72 = **52px 死空间**（白占地方），
 * 而 360px 窄屏**装不下被裁**。所以按断点分档，每档贴着它那档的真实内容高度。
 *
 * 两个断点都是**量出来的**，不是抄 Tailwind 断点：
 *  - **901px**：导航单行↔两行的翻转点在 900~901 之间（实测 901 单行、900 两行）。
 *  - **380px**：导航两行↔三行的翻转点在 390~375 之间（实测 390 两行、375 三行）。
 *    取 380 是**卡在实测翻转点内侧**，宁可多给一点高度也不裁内容
 *    —— 裁切是 `overflow-hidden` 的**静默**副作用，没有任何闸门会报。
 *
 * ⚠️ **改这四档前必须重跑 puppeteer 逐档量 `maxChildBottom`**，别拍：
 * 每档都要量过 `maxChildBottom ≤ section 高度` 才算过。
 *
 * 呼吸怎么分配（2026-10-08 二次实测后定的）：
 * 每档 = 内容高度 + **底部 8px**（顶部固定 `pt-2` 8px，上下必须对称）。
 * 之前桌面档是 92px，而内容只有 72px ⇒ 顶部 8px、**底部 20px** ——
 * **上下不对称，那 12px 是纯浪费**（不是设计，是没人算过）。收到 80px。
 * ⚠️ 底部不能收到 0：`pixel-outline` 的 text-shadow 是**硬投影**（外投影 2px），
 * 贴到 section 底边会被 `overflow-hidden` 削掉，所以 8px 是下限不是随便定的。
 */
.banner-h {
  height: 114px; /* ≤640：导航两行（内容 106 + 8 底部） */
}

@media (max-width: 380px) {
  .banner-h {
    height: 142px; /* 导航三行（内容 134 + 8 底部） */
  }
}

@media (min-width: 641px) and (max-width: 900px) {
  .banner-h {
    height: 114px; /* 导航两行（内容 106 + 8 底部） */
  }
}

@media (min-width: 901px) {
  .banner-h {
    height: 80px; /* 导航单行（内容 72 + 8 底部） */
  }
}
</style>
