<script setup lang="ts">
import PxIcon from './PxIcon.vue';

withDefaults(
  defineProps<{
    title?: string;
    hud?: string;
    id?: string;
    icon?: 'clock' | 'trophy' | 'grid' | 'globe' | 'compare' | 'search' | 'home';
  }>(),
  { title: '', hud: 'var(--color-gold)', id: undefined, icon: undefined },
);
</script>

<template>
  <!--
    全站小节框。原版边框是 rgb(255 255 255 / 0.14) 的半透明白 —— 那是「玻璃拟态」，
    在暗底上会随背景变化而漂移，与像素风的确定性配色冲突。改成实心墨边框 + 硬投影。
  -->
  <section :id="id" class="pixel-panel relative">
    <!-- 扫光：只走顶边，内容区之外 -->
    <div class="hud-scan-track">
      <div class="hud-scan" :style="{ '--hud': hud }" />
    </div>

    <header
      v-if="title"
      class="flex items-center gap-2 border-b-2 border-[var(--color-ink)] px-3 py-1.5"
      :style="{ background: `color-mix(in srgb, ${hud} 12%, transparent)` }"
    >
      <!-- 原版是一个 2×2 的小方块 + 8px 辉光；辉光是模糊，去掉后视觉太弱，改成像素图标 -->
      <PxIcon v-if="icon" :name="icon" :size="14" :style="{ color: hud }" />
      <span v-else class="inline-block h-2 w-2 flex-none" :style="{ background: hud }" />
      <h2 class="pixel-outline font-pixel text-[24px] leading-[1.5]">{{ title }}</h2>
      <span class="ml-auto text-[12px] leading-[1.5]" :style="{ color: hud }">
        <slot name="aside" />
      </span>
    </header>

    <div class="p-3 sm:p-4">
      <slot />
    </div>
  </section>
</template>
