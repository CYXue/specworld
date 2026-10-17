<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AppTopNav from './components/AppTopNav.vue';
import AppFooter from './components/AppFooter.vue';

const route = useRoute();
const { t, locale } = useI18n();

// 标题/语言跟随（a11y + 分享卡片），首次即跑一次。
watch(
  locale,
  (l) => {
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
    document.title = t('meta.title');
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', t('meta.description'));
  },
  { immediate: true },
);

// 全局顶栏常驻：不再把导航藏进首页 banner（去游戏化后没有 banner 了）。
const showNav = computed(() => true);
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-bg">
    <AppTopNav v-if="showNav" />
    <main class="flex-1">
      <RouterView />
    </main>
    <AppFooter />
  </div>
</template>
