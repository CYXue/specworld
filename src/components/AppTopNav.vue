<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import { useRoute, RouterLink } from 'vue-router';
import SearchBox from './SearchBox.vue';
import { useCompare } from '../lib/useCompare';

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
  <header class="sticky top-0 z-30 border-b border-border bg-surface">
    <div class="page-shell flex h-14 items-center gap-4">
      <!-- logo：墨块方标 + mono 字标（纸上数据库的刊头） -->
      <RouterLink to="/" class="flex shrink-0 items-center gap-2 text-fg">
        <span
          class="grid h-6 w-6 place-items-center rounded-[4px] bg-ink font-mono text-[13px] font-bold text-ink-fg"
        >{{ monogram }}</span>
        <span class="text-[16px] font-bold tracking-tight">{{ t('brand.name') }}</span>
      </RouterLink>

      <!-- 主导航：方角文本项，当前页墨块反白 -->
      <nav class="ml-1 hidden items-center gap-0.5 md:flex" :aria-label="t('nav.label')">
        <RouterLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="rounded-[4px] px-3 py-1.5 text-sm font-medium text-dim transition-colors hover:bg-surface-2 hover:text-fg"
          active-class="nav-active"
          :aria-current="route.path === l.to ? 'page' : undefined"
        >
          {{ t(l.key) }}
        </RouterLink>
      </nav>

      <!-- 搜索（桌面）。首页不显示：Hero 里已有主搜索框，同屏两个搜索入口是重复设计 -->
      <div v-if="route.path !== '/'" class="ml-auto hidden w-60 lg:block">
        <SearchBox />
      </div>

      <!-- 对比入口：发丝线方角按钮 + mono 计数 -->
      <RouterLink
        to="/vs"
        class="relative flex h-9 items-center gap-2 rounded-[4px] border border-border-strong px-3 text-sm font-medium text-dim transition-colors hover:border-dim hover:text-fg lg:ml-0"
        :class="{ 'ml-auto': route.path === '/' }"
        :aria-label="t('compare.title')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h7M3 12h11M3 18h6" stroke-linecap="round" />
          <path d="M14 4v16M21 7v10" stroke-linecap="round" />
        </svg>
        <span class="hidden sm:inline">{{ t('nav.compareDock', { n: compareCount }) }}</span>
        <span
          v-if="compareCount"
          class="num grid h-5 min-w-5 place-items-center rounded-[3px] bg-ink px-1 text-[11px] font-bold text-ink-fg sm:hidden"
          >{{ compareCount }}</span
        >
      </RouterLink>
    </div>

    <!-- 移动端搜索栏（首页同样隐藏——Hero 搜索就是首屏主入口） -->
    <div v-if="route.path !== '/'" class="page-shell pb-2.5 lg:hidden">
      <SearchBox />
    </div>
  </header>
</template>
