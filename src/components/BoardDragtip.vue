<script setup lang="ts">
/**
 * 拖拽提示：居中「拖拽画面 → 无限回绕已就绪」。
 * 首次拖动后 500ms 隐藏（由父组件控制 hidden）。纯装饰，不挡交互。
 *
 * 像素化改造：
 * - 图标从「圆形 + 折线箭头」改成纯方块手指（Minecraft 指引图标的语言）
 * - 两端箭头从 clip-path 三角形（斜边）改成阶梯方块
 * - 网格底纹从 linear-gradient 双层渐变改成 repeating 方格
 */
defineProps<{ hidden: boolean }>();
const CODE = '1231221222121211212122';
</script>

<template>
  <div class="dragtip" :class="{ dragtip_hidden: hidden }" aria-hidden="true">
    <div class="dragtip_main">
      <div class="dragtip_main_content">
        <div class="dragtip_main_content_icon">
          <!-- 手指拖拽图标：全部用 4×4 方块拼，shape-rendering 保证硬边 -->
          <svg
            viewBox="0 0 16 16"
            shape-rendering="crispEdges"
            style="animation: dragicon 2s steps(4, end) infinite"
          >
            <g fill="var(--cb-theme)">
              <!-- 手掌 -->
              <rect x="5" y="6" width="6" height="8" />
              <!-- 手指 -->
              <rect x="5" y="3" width="2" height="3" />
              <rect x="7" y="2" width="2" height="4" />
              <rect x="9" y="3" width="2" height="3" />
              <!-- 拇指 -->
              <rect x="3" y="7" width="2" height="2" />
            </g>
            <!-- 移动方向箭头（点阵方块，不是斜线） -->
            <g fill="var(--color-gold)">
              <rect x="12" y="5" width="2" height="2" />
              <rect x="13" y="6" width="2" height="2" />
              <rect x="12" y="9" width="2" height="2" />
              <rect x="11" y="8" width="2" height="2" />
            </g>
          </svg>
        </div>
        <p class="dragtip_title">{{ $t('board.dragTitle') }}</p>
        <p class="dragtip_sub">{{ $t('board.dragSub') }}</p>
      </div>
    </div>
    <div class="dragtip_bottom">
      <div class="dragtip_bottom_text">{{ $t('board.wrapReady') }}</div>
      <div class="dragtip_bottom_code">
        <span v-for="(ch, i) in CODE.split('')" :key="i" :style="{ '--i': i }">{{ ch }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 拖拽提示层。配色与几何都换成了像素语言：
 * - 两端箭头用阶梯方块（clip-path 三角是斜边，像素风里没有斜边）
 * - 网格底纹用 repeating-linear-gradient 打硬边方格
 */
.dragtip {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 26rem;
  max-width: 90%;
  background: var(--color-ink);
  border: 2px solid var(--color-stone);
  box-shadow:
    inset 2px 2px 0 0 var(--color-panel-lit),
    inset -2px -2px 0 0 rgb(0 0 0 / 0.4),
    4px 4px 0 0 rgb(0 0 0 / 0.5);
  pointer-events: none;
  z-index: 10;
  transition: opacity 200ms steps(3, end);
}

/* 两端箭头：阶梯方块，不是三角形 */
.dragtip::before,
.dragtip::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 10px;
  height: 20px;
  margin-top: -10px;
  background-color: var(--color-stone);
}
.dragtip::before {
  left: -12px;
  clip-path: polygon(0 0, 100% 25%, 100% 40%, 40% 40%, 40% 60%, 100% 60%, 100% 75%, 0 100%);
}
.dragtip::after {
  right: -12px;
  clip-path: polygon(100% 0, 0 25%, 0 40%, 60% 40%, 60% 60%, 0 60%, 0 75%, 100% 100%);
}
.dragtip_hidden {
  opacity: 0;
}

.dragtip_main {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 10rem;
  border-bottom: 2px solid var(--color-stone);
}
.dragtip_main::after {
  content: '';
  position: absolute;
  inset: 0;
  /* 硬边方格网，不是连续渐变 */
  background-image:
    repeating-linear-gradient(0deg, rgb(255 255 255 / 0.06) 0 2px, transparent 2px 16px),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.06) 0 2px, transparent 2px 16px);
  pointer-events: none;
}
.dragtip_main_content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 18rem;
  z-index: 1;
}
.dragtip_main_content_icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  overflow: hidden;
  background: var(--color-panel);
  border: 2px solid var(--color-stone);
  box-shadow: inset 2px 2px 0 0 var(--color-panel-lit);
  margin-bottom: 1rem;
}
.dragtip_main_content_icon svg {
  width: 32px;
  height: 32px;
  shape-rendering: crispEdges;
}
@keyframes dragicon {
  0% {
    transform: translate(0, 0);
  }
  25% {
    transform: translate(-3px, 3px);
  }
  50% {
    transform: translate(2px, 5px);
  }
  75% {
    transform: translate(-2px, 2px);
  }
  100% {
    transform: translate(0, 0);
  }
}
.dragtip_title {
  color: var(--color-parchment-lit);
  font-family: var(--font-pixel);
  font-size: 24px;
  line-height: 1.5;
  letter-spacing: 0.1em;
  margin-bottom: 0.25rem;
}
.dragtip_sub {
  color: var(--color-parchment-dim);
  font-family: var(--font-pixel);
  font-size: 12px;
  line-height: 1.5;
  letter-spacing: 0.1em;
}
.dragtip_bottom {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 2rem;
}
.dragtip_bottom_text {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 1rem;
  height: 100%;
  border-right: 2px solid var(--color-stone);
  color: var(--color-gold);
  font-family: var(--font-pixel);
  white-space: nowrap;
  font-size: 12px;
  line-height: 1.5;
}
.dragtip_bottom_code {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1;
  height: 100%;
  padding-right: 0.25rem;
}
.dragtip_bottom_code span {
  display: inline-block;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-stone);
  /* steps 硬切闪烁，不用连续淡入淡出 */
  animation: codeblink 2s steps(1, end) infinite;
  animation-delay: calc(var(--i) * 0.1s);
}
@keyframes codeblink {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
  100% {
    opacity: 1;
  }
}
@media screen and (max-width: 700px) {
  .dragtip {
    width: 20rem;
  }
}
</style>
