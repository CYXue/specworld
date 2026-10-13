<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import PxIcon from './PxIcon.vue';
import LocaleSwitch from './LocaleSwitch.vue';

/**
 * `embedded` = 嵌进首页 banner（标题左侧、导航右侧同行）。
 *
 * 2026-10-06 之前导航在 App.vue 的顶栏里，与 logo 并排；那天参照参考项目
 * 改成「整条导航压进首页 banner 的天空上」。理由（参考项目 page.tsx 的原话）：
 * 「早先这里是半屏高的标题海报……那是错的」——
 * 站名 + 导航 + 搜索本来就是一个 HUD 概念，拆成上下两条既多占一行，
 * 又让「站名」和「导航」看起来是两个模块。
 *
 * ⚠️ **顶栏与 banner 的对齐规则是相反的**：
 *   - 顶栏（元素多、搜索框压右）→ 居中一整组连续元素（见 App.vue 注释）
 *   - banner（元素少、左右分两组）→ `justify-between` 两端对齐才对
 * 两者不能套用同一条规则，这不是「统一风格」而是「按容器定」。
 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false });

// 全站导航 + 搜索入口。
// 搜索框在导航里常驻（参考项目把搜索放在页头），但**不监听输入** ——
// 每敲一个字母就 router.replace 会把历史记录搅成一团，且重建整棵结果树。
// 这里只读输入框的值，回车/点按钮才跳到 /search?q=…，由搜索页自己接管输入。
// 换句话说：导航是「搜索的入口」，搜索页才是「搜索的地方」。
//
// 为什么是这四组（2026-10-06 重做）
// ------------------------------------
// 原来这里是 7 个带图标的按钮 + 一个「搜索」按钮，在 1080px 下就占满，
// 1024px 以下 flex-wrap 折成两行，把顶栏撑到两倍高。
// 冗余有四处，每一处都不是「少一个按钮」的问题：
//
// 1. **「搜索」按钮与搜索框重复**：按钮跳 /search，输入框回车也跳 /search。
//    两个入口做同一件事，却各占一个按钮位。删掉按钮，留框。
// 2. **7 个 12px 图标读不出信息**：图标占约 128px，在 12px 文字旁边
//    更像装饰而不是线索。像素风强调「形状即语义」，但前提是形状要能辨认；
//    16×16 网格缩到 12px 后，多数图标已经糊成一团色块。删掉。
// 3. **「对比」这个名不副实**：#/compare 那一页是「机型库 + 对比台」，
//    用户去它主要是为了**筛选机型**（京东式筛选条 + 价格段），
//    对比只是选中 ≥2 台后的结果。叫「机型库」才与实际用法一致。
//    这不是改文案讨好用户 —— 名不准会让用户点错。
// 4. **「关于」是低频页，不该占主导航的视觉预算**：它已经在页脚有署名、
//    关于页里有完整的项目说明与数据原则。移到页脚，主导航留给高频页。
//
// 分组：查数据（广场 / 机型库 / 榜单 / 时间线）与逛玩法（画布 / 设备球），
// 中间一条像素竖线，后者用弱化色 —— 这两组的使用节奏完全不同，
// 混在一排里用户读不出「哪些是工具、哪些是玩具」。
const route = useRoute();
const router = useRouter();
const { t } = useI18n();

/**
 * 查数据：用户来这里是为了找参数。按钮形态（可点面板）。
 * label 走 computed——setup 里直接 `const x = t('k')` 抓到的是当次语言的值，
 * 切语言不会重算（不是响应式的）；computed 里的 t() 读 locale，切语言自动重来。
 */
const primaryItems = computed(() => [
  { name: 'home', label: t('nav.home'), to: '/' },
  { name: 'compare', label: t('nav.compare'), to: '/compare' },
  { name: 'rankings', label: t('nav.rankings'), to: '/rankings' },
  { name: 'timeline', label: t('nav.timeline'), to: '/timeline' },
]);

/**
 * 逛玩法：探索型的可视化界面。使用频率明显低于查数据，
 * 所以用**弱化色文字链接**而不是按钮 —— 它们不需要和工具抢点击权重。
 * 仍然给 aria-current，当前页要能看出来（弱化不等于不可见）。
 */
const secondaryItems = computed(() => [
  { name: 'canvas', label: t('nav.canvas'), to: '/canvas' },
  { name: 'globe', label: t('nav.globe'), to: '/globe' },
]);

const isCurrent = (n: string) => route.name === n;

const keyword = ref('');
function submit() {
  const q = keyword.value.trim();
  if (!q) {
    router.push('/search');
    return;
  }
  router.push({ path: '/search', query: { q } });
}
</script>

<template>
  <nav
    :aria-label="$t('nav.label')"
    class="relative z-10 flex flex-wrap items-center gap-x-1 gap-y-1"
    :class="embedded ? 'w-full justify-center sm:w-auto' : ''"
  >
    <!-- 查数据 -->
    <RouterLink
      v-for="it in primaryItems"
      :key="it.name"
      :to="it.to"
      class="pixel-button-flat px-2 py-0.5 text-[12px] leading-[1.5]"
      :aria-current="isCurrent(it.name) ? 'page' : undefined"
    >
      {{ it.label }}
    </RouterLink>

    <!-- 逛玩法：弱化，与「查数据」分组。
         分隔线用 stone-gray 而不是 ink-soft —— 后者 #4a5468 在 ink 底上
         对比度太低，实测几乎看不见（暗底暗线 = 没有线）。 -->
    <span class="mx-1 h-3 w-0.5 bg-[var(--color-stone)]" aria-hidden="true"></span>
    <RouterLink
      v-for="it in secondaryItems"
      :key="it.name"
      :to="it.to"
      class="bg-[rgb(11_16_32/0.62)] px-2 py-0.5 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)] hover:text-[var(--color-parchment-lit)]"
      :aria-current="isCurrent(it.name) ? 'page' : undefined"
      :class="isCurrent(it.name) ? 'text-[var(--color-gold)]' : ''"
    >
      {{ it.label }}
    </RouterLink>

    <!-- 搜索：唯一的搜索入口（原来的「搜索」按钮与这个框重复，已删）。
         窄屏时输入框压到只剩放大镜图标，点它进搜索页 —— 搜索页自带输入框。 -->
    <form class="flex items-center" role="search" @submit.prevent="submit">
      <!-- 搜索框与导航紧邻，不加 ml-auto。
           之前试过两条路都不对：
           - `ml-auto`：搜索框被推到容器最右，与导航之间空出一大段（宽屏尤其明显）；
           - `flex-1 + ml-auto`：同上，只是空隙从导航内部挪到了导航与 logo 之间。
           结论：**顶栏是一组连续元素，不是「左logo + 右控件」的两端对齐布局**。
           窄屏时它靠 flex-wrap 自然折行，折行后仍紧邻。 -->
      <label class="sr-only" for="site-search">{{ $t('nav.searchLabel') }}</label>
      <input
        id="site-search"
        v-model="keyword"
        type="search"
        :placeholder="$t('nav.searchPlaceholder')"
        class="pixel-input hidden h-6 w-28 border-r-0 px-2 text-[12px] leading-[1.5] sm:block sm:w-36"
        autocomplete="off"
      />
      <button
        type="submit"
        class="pixel-button-flat h-6 px-1.5 leading-none sm:border-l-0"
        :aria-label="$t('nav.search')"
        :aria-current="route.name === 'search' ? 'page' : undefined"
      >
        <PxIcon :name="keyword ? 'enter' : 'search'" :size="12" />
      </button>
    </form>

    <!-- 语言切换器：全站唯一入口（顶栏与首页 banner 两种形态都经过本组件） -->
    <LocaleSwitch />
  </nav>
</template>