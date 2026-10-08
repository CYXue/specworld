<script setup lang="ts">
import type { Continent } from '../types';

// 屋顶：品牌识别色的屋檐条。
// 西岸（苹果/国外）= 平顶带霓虹檐口；东岸（华为/国内）= 层叠瓦檐、檐角上翘。
// 借鉴参考项目，用厂商识别色上色，一眼分出阵营。
//
// 像素化要点：
// - viewBox 高度 14 → 16，坐标全整数，配合 crispEdges 不产生半像素边
// - 加 2px「瓦楞暗线」让屋檐有厚度（原版纯色条看着像贴纸，不像屋顶）
// - 东岸檐角用阶梯方块上翘，替代原本的平滑斜角
defineProps<{ color: string; continent: Continent }>();
</script>

<template>
  <svg
    viewBox="0 0 100 16"
    preserveAspectRatio="none"
    shape-rendering="crispEdges"
    class="block h-6 w-full"
    aria-hidden
  >
    <template v-if="continent === 'east'">
      <!-- 东岸：层叠瓦檐 -->
      <rect x="0" y="7" width="100" height="9" :fill="color" />
      <rect x="2" y="4" width="96" height="3" :fill="color" />
      <!-- 檐角上翘：阶梯方块，不是斜线 -->
      <rect x="0" y="4" width="6" height="3" :fill="color" />
      <rect x="0" y="1" width="3" height="3" :fill="color" />
      <rect x="94" y="4" width="6" height="3" :fill="color" />
      <rect x="97" y="1" width="3" height="3" :fill="color" />
      <!-- 瓦楞暗线 -->
      <g fill="rgb(0 0 0 / 0.28)">
        <rect v-for="x in 8" :key="`e${x}`" :x="x * 6" y="9" width="3" height="7" />
      </g>
      <rect x="0" y="7" width="100" height="2" fill="rgb(255 255 255 / 0.22)" />
      <rect x="0" y="14" width="100" height="2" fill="rgb(0 0 0 / 0.5)" />
    </template>

    <template v-else>
      <!-- 西岸：平顶 + 霓虹檐口 -->
      <rect x="0" y="5" width="100" height="11" :fill="color" />
      <rect x="0" y="3" width="100" height="2" :fill="color" opacity="0.65" />
      <!-- 檐口齿状垂饰 -->
      <g fill="rgb(0 0 0 / 0.3)">
        <rect v-for="x in 10" :key="`w${x}`" :x="x * 10" y="9" width="4" height="7" />
      </g>
      <rect x="0" y="3" width="100" height="2" fill="rgb(255 255 255 / 0.35)" />
      <rect x="0" y="5" width="100" height="2" fill="rgb(255 255 255 / 0.16)" />
      <rect x="0" y="14" width="100" height="2" fill="rgb(0 0 0 / 0.5)" />
    </template>
  </svg>
</template>
