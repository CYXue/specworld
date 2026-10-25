<script setup lang="ts">
// 全局顶栏常驻：不再把导航藏进首页 banner（去游戏化后没有 banner 了）。
import AppTopNav from './components/AppTopNav.vue';
import AppFooter from './components/AppFooter.vue';
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-bg">
    <AppTopNav />
    <main class="flex-1">
      <RouterView />
    </main>
    <AppFooter />
  </div>
</template>
