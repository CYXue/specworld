<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, RouterLink } from 'vue-router';
import SearchBox from './SearchBox.vue';
import { useCompare } from '../lib/useCompare';

const { t } = useI18n();
const route = useRoute();
const { ids } = useCompare();

const links = [
  { to: '/', key: 'nav.home' },
  { to: '/compare', key: 'nav.compare' },
  { to: '/rankings', key: 'nav.rankings' },
  { to: '/timeline', key: 'nav.timeline' },
];

const compareCount = computed(() => ids.value.length);
// 品牌首字徽标：跟随当前语言（zh「参数世界」→ 参，en「Specworld」→ S），避免英文界面残留中文。
const monogram = computed(() => t('brand.name').charAt(0));
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur">
    <div class="page-shell flex h-14 items-center gap-3">
      <!-- logo -->
      <RouterLink to="/" class="flex shrink-0 items-center gap-2 text-fg">
        <span class="grid h-6 w-6 place-items-center rounded bg-accent text-[13px] font-bold text-accent-fg">{{ monogram }}</span>
        <span class="text-[17px] font-bold tracking-tight">{{ t('brand.name') }}</span>
      </RouterLink>

      <!-- 主导航 -->
      <nav class="ml-2 hidden items-center gap-1 md:flex" :aria-label="t('nav.label')">
        <RouterLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="rounded px-3 py-1.5 text-sm font-medium text-dim transition-colors hover:bg-surface-2 hover:text-fg"
          active-class="nav-active !text-accent"
          :aria-current="route.path === l.to ? 'page' : undefined"
        >
          {{ t(l.key) }}
        </RouterLink>
      </nav>

      <!-- 搜索（桌面）。首页不显示：Hero 里已有主搜索框，同屏两个搜索入口是重复设计 -->
      <div v-if="route.path !== '/'" class="ml-auto hidden w-56 lg:block">
        <SearchBox />
      </div>

      <!-- 对比入口 -->
      <RouterLink
        to="/vs"
        class="relative ml-auto flex h-10 items-center gap-2 rounded px-3 text-sm font-medium text-dim transition-colors hover:bg-surface-2 hover:text-fg lg:ml-2"
        :aria-label="t('compare.title')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h7M3 12h11M3 18h6" stroke-linecap="round" />
          <path d="M14 4v16M21 7v10" stroke-linecap="round" />
        </svg>
        <span class="hidden sm:inline">{{ t('nav.compareDock', { n: compareCount }) }}</span>
        <span
          v-if="compareCount"
          class="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-fg sm:hidden"
          >{{ compareCount }}</span
        >
      </RouterLink>
    </div>

    <!-- 移动端搜索栏（首页同样隐藏——Hero 搜索就是首屏主入口） -->
    <div v-if="route.path !== '/'" class="page-shell pb-2 lg:hidden">
      <SearchBox />
    </div>
  </header>
</template>
