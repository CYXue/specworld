<script setup lang="ts">
/**
 * 地面：草方块顶层 + 泥土层 + 石头层（Minecraft 式的地层剖面）。
 *
 * 原版是两条 linear-gradient 从亮到暗的连续过渡 —— 又是渐变。
 * 像素风的地层是**一块块纯色方块**，每层顶面亮、侧面暗，做出「立方体感」。
 * 草方块顶面用 2px 一格的锯齿边，模拟 Minecraft 草方块的像素碎边。
 *
 * 高度预算 40px（原 52px，2026-10-06）。地层剖面的表达力来自**层次**，
 * 不是厚度 —— 每层压 1-2px 之后依然读得出「草/土/石」三段，
 * 而首页首屏能少滚 12px。三层的比例（草亮面 : 土 : 石）保持不变，
 * 免得压薄后泥土层薄到看不出是一层。
 *
 * ⚠️ **2026-10-06：整体转灰阶**（天空改成黑白太极之后）。
 * 原来草层是 `--color-grass: #4a8c3a`（饱和绿），
 * 那是整个 banner 里**唯一的高饱和色** —— 在黑白天空下扎眼得像条荧光棒，
 * 而且与「太极」的黑白体系完全不在一个调里。
 *
 * **层次不能丢**：三段改灰后靠「顶亮/侧暗」与锯齿边区分，
 * 不靠色相 —— 这本来就是像素风该有的做法（形状与明度说话，颜色只是标识）。
 * 顺带把「草方块」的比喻也改成「地层」：没有草了。
 */
</script>

<template>
  <div class="relative w-full select-none" aria-hidden>
    <!-- 地层顶面：亮灰 + 下一行暗灰作侧面（原来是亮绿/深绿） -->
    <div class="flex h-1.5 w-full" style="background: #6a6a70" />
    <div class="h-0.5 w-full" style="background: #3c3c42" />

    <!-- 泥土层：亮面 + 暗面 + 零星石砾方块 -->
    <div class="relative h-3 w-full" style="background: #3a3a3e">
      <div class="absolute inset-x-0 top-0 h-1 w-full" style="background: #4e4e54" />
      <div
        class="absolute inset-x-0 bottom-0 h-1 w-full"
        style="background: #2a2a2e"
      />
      <svg
        class="absolute inset-0 h-full w-full"
        viewBox="0 0 160 8"
        preserveAspectRatio="none"
        shape-rendering="crispEdges"
      >
        <g fill="#232327">
          <rect x="8" y="2" width="4" height="2" />
          <rect x="30" y="5" width="4" height="2" />
          <rect x="56" y="2" width="4" height="2" />
          <rect x="78" y="4" width="4" height="2" />
          <rect x="104" y="2" width="4" height="2" />
          <rect x="132" y="5" width="4" height="2" />
          <rect x="150" y="2" width="4" height="2" />
        </g>
        <g fill="#5c5c62">
          <rect x="16" y="4" width="2" height="2" />
          <rect x="64" y="6" width="2" height="2" />
          <rect x="118" y="3" width="2" height="2" />
        </g>
      </svg>
    </div>

    <!-- 石头层：过渡到页面主背景 -->
    <div class="relative h-2 w-full" style="background: #26262a">
      <div class="absolute inset-x-0 top-0 h-1 w-full" style="background: #45454b" />
      <svg
        class="absolute inset-0 h-full w-full"
        viewBox="0 0 160 6"
        preserveAspectRatio="none"
        shape-rendering="crispEdges"
      >
        <g fill="#151518">
          <rect x="20" y="2" width="4" height="2" />
          <rect x="66" y="3" width="4" height="2" />
          <rect x="112" y="2" width="4" height="2" />
          <rect x="142" y="3" width="4" height="2" />
        </g>
      </svg>
    </div>
  </div>
</template>
