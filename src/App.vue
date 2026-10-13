<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import PxIcon from './components/PxIcon.vue';
import SiteFooter from './components/SiteFooter.vue';
import SiteNav from './components/SiteNav.vue';

const route = useRoute();
const { t, locale } = useI18n();

/**
 * 导航在首页**不显示**（它已经压进首页 banner 的天空上了），
 * 避免同一条导航出现两次。其余页面照常显示在顶栏。
 *
 * 2026-10-06 参照参考项目（ai-model-world）重做首页 banner 时引入：
 * 它把 `SiteNav` 放在 `page.tsx` 的 header 里，**不在 layout 里**，
 * 所以只有首页有导航，其余页面走各自的头部。
 * 本项目的顶栏是全局的（hash 路由 + 8 个页面），不能照抄「只有首页有」，
 * 但「首页不放重复导航」这条是一致的。
 */
const navInBanner = computed(() => route.name === 'home');

/**
 * `<html lang>` 与 `<title>` / meta description 跟随语言（a11y + 分享卡片）：
 * index.html 里的静态值是 zh-CN 的预 hydration 缺省，之后由这里接管。
 * immediate: 首屏就跑一次，保证「默认中文但 localStorage 里存了 en」的
 * 直接进来就是英文全套（含 title），而不是中文 title + 英文正文的混搭。
 */
watch(
  locale,
  (l) => {
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
    document.title = t('meta.title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <!--
      全局 HUD 顶栏。刻意不用 backdrop-blur —— 模糊是高斯连续的，
      与像素世界的硬边语言冲突；改用不透明底 + 硬底边分层。

      **首页整条顶栏都不显示** —— 站名与导航都压进 banner 的天空上了（`navInBanner`）。
      之前只藏了导航、留着 logo，结果 logo 与 banner 里的 h1 **重复**同一句话
      （截图里两行「参数世界」上下挨着）——既然首页有完整 HUD，
      顶栏在首页就是纯冗余，还白占40px。

      其余页面：logo + 导航居中一整组连续元素。
      为什么不是 `justify-between`（logo 靠左、导航靠右）？
      试过，宽屏下两端之间会空一大段，而顶栏元素本来就不多 ——
      **元素少时两端对齐只会让它更散**。

      高度预算 40px（实测 38px）。曾经是 76px，其中一半是装饰：
      4px 底边 + 4px 投影 + 8px 纵向 padding + logo 24px 字（36px 行高）
      + 导航按钮 3px 投影撑出的 6px。
      教训：**装饰的视觉重量必须与它所在的容器匹配**——
      12px 高的按钮不该有 3px 立体投影，那读作「厚度」，只适合页面里的大按钮。
      顶栏导航用 `.pixel-button-flat`（纯平面，见 style.css 的说明）。
    -->
    <header v-if="!navInBanner" class="pixel-header sticky top-0 z-20">
      <div
        class="page-shell flex flex-wrap items-center justify-center gap-x-3 gap-y-0 py-1.5"
      >
        <RouterLink
          to="/"
          class="pixel-outline flex items-center gap-1.5 font-pixel text-[24px] leading-none"
        >
          <PxIcon name="home" :size="16" />
          {{ $t('brand.name') }}
        </RouterLink>
        <SiteNav />
      </div>
    </header>

    <main class="flex-1">
      <RouterView />
    </main>

    <SiteFooter />
  </div>
</template>