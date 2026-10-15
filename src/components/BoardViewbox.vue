<script setup lang="ts">
/**
 * 详情浮层（参考站 `VB`）：点击瓦片后弹出。精灵图 + 设备名 + 短规格文案 + 装饰线。
 * 点图进全屏查看器（open-image），点「查看完整参数」跳产品页（goto）。
 * 入场用 CSS 过渡（opacity + 装饰线滑入），不依赖 WAAPI。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { BoardTile } from './BoardCanvas.vue';

defineProps<{ tile: BoardTile }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-image'): void;
  (e: 'goto', id: string): void;
}>();

const shown = ref(false);
onMounted(() => {
  requestAnimationFrame(() => (shown.value = true));
  // Esc 关闭 + 模态语义（2026-10-14 审计 B7）：监听挂 document ——
  // 焦点不在浮层内时 keydown 到不了它，键盘用户关不掉。
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
</script>

<template>
  <div
    class="viewbox"
    :class="{ viewbox_show: shown }"
    role="dialog"
    aria-modal="true"
    @click.self="emit('close')"
  >
    <div class="viewbox_imagebox">
      <!--
        原版这里有个 filter: blur(2rem) 的同图放大版当辉光底。
        模糊是高斯连续的，像素风里没有对应物，且它让精灵图边缘发糊 ——
        整个浮层里最显眼的东西反而最不像素，直接删掉（纯视觉，不影响交互）。
      -->
      <img
        class="viewbox_imagebox_image"
        :src="tile.sprite"
        :alt="tile.name"
        @click="emit('open-image')"
      />
    </div>

    <div class="viewbox_instrution">
      <div class="viewbox_instrution_line viewbox_instrution_line_left">
        <div />
        <div />
      </div>
      <div class="viewbox_instrution_content">
        <p class="viewbox_name">{{ tile.name }}</p>
        <p class="viewbox_detail">{{ tile.detail }}</p>
      </div>
      <div class="viewbox_instrution_line viewbox_instrution_line_right">
        <div />
        <div />
      </div>
    </div>

    <div class="viewbox_actions">
      <button class="viewbox_btn" @click="emit('goto', tile.id)">{{ $t('board.fullSpecs') }}</button>
    </div>

    <div class="viewbox_return">
      <button class="viewbox_return_btn" @click="emit('close')">{{ $t('board.backClose') }}</button>
    </div>
  </div>
</template>

<style scoped>
.viewbox {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 遮罩改不透明：#000013ec 是半透明，后面瓦片会隐约透出，破坏聚焦感 */
  background-color: var(--color-void);
  opacity: 0;
  pointer-events: none;
  z-index: 20;
  transition: opacity 150ms steps(3, end);
  --cb-theme: var(--color-lapis);
}
.viewbox_show {
  opacity: 1;
  pointer-events: auto;
}

.viewbox_imagebox {
  position: relative;
  height: 40vh;
  max-height: 320px;
  margin-bottom: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.viewbox_imagebox_image {
  position: relative;
  height: 100%;
  width: auto;
  cursor: pointer;
  opacity: 0;
  transform: scale(2);
  transition:
    opacity 150ms steps(3, end),
    transform 150ms steps(3, end);
}
/*
 * 入场从 2× 收到 1×：整数倍缩放 + steps 硬切。
 * 原版是 1.1× 配 0.8s ease-out —— 连续插值会把像素图重采样成模糊插值图。
 * 缩到一半才发现「图像糊了」，这是像素资源最容易被破坏的地方。
 */
.viewbox_show .viewbox_imagebox_image {
  opacity: 1;
  transform: scale(1);
}

.viewbox_instrution {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2rem;
}
.viewbox_instrution_line {
  display: flex;
  align-items: center;
}
/*
 * 装饰线：原版 1px 线 + linear-gradient mask 做「从中间长出来」的淡入。
 * 改成 2px 硬边虚线 + steps 位移：保留生长动效，去掉连续渐变。
 */
.viewbox_instrution_line > div:first-child {
  height: 2px;
  width: 4rem;
  background-image: repeating-linear-gradient(90deg, var(--cb-theme) 0 4px, transparent 4px 8px);
  transform: translateX(50%);
  opacity: 0;
  transition:
    transform 200ms steps(4, end),
    opacity 200ms steps(2, end);
}
.viewbox_instrution_line_right > div:first-child {
  transform: translateX(-50%);
}
.viewbox_show .viewbox_instrution_line_left > div:first-child,
.viewbox_show .viewbox_instrution_line_right > div:first-child {
  transform: translateX(0);
  opacity: 1;
}
/* 中间标记：去掉 rotate(45deg) 的斜边方块（像素风里没有斜边），
   改用 clip-path 菱形 + 内嵌深色方块，视觉仍是菱形但由直角台阶构成 */
.viewbox_instrution_line > div:nth-child(2) {
  position: relative;
  width: 10px;
  height: 10px;
  margin: 0 8px;
  background: var(--cb-theme);
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
}
.viewbox_instrution_line > div:nth-child(2)::after {
  content: '';
  position: absolute;
  inset: 3px;
  background: var(--color-void);
}

.viewbox_instrution_content {
  max-width: 22rem;
  text-align: center;
  color: var(--color-parchment);
}
.viewbox_name {
  font-size: 24px;
  line-height: 1.5;
  color: var(--color-parchment-lit);
  margin-bottom: 4px;
  /* 硬投影，不是 8px 辉光 */
  text-shadow:
    2px 0 0 var(--color-ink),
    -2px 0 0 var(--color-ink),
    0 2px 0 var(--color-ink),
    0 -2px 0 var(--color-ink);
}
.viewbox_detail {
  font-size: 12px;
  line-height: 2;
  color: var(--color-parchment-dim);
}

.viewbox_actions {
  margin-bottom: 2rem;
}
.viewbox_btn {
  background: var(--color-panel);
  border: 2px solid var(--color-ink);
  color: var(--cb-theme);
  font-family: var(--font-pixel);
  font-size: 12px;
  line-height: 1.5;
  padding: 6px 12px;
  cursor: pointer;
  box-shadow:
    inset 2px 2px 0 0 var(--color-panel-lit),
    inset -2px -2px 0 0 rgb(0 0 0 / 0.3),
    3px 3px 0 0 rgb(0 0 0 / 0.5);
  transition:
    transform 90ms steps(2, end),
    box-shadow 90ms steps(2, end);
}
.viewbox_btn:hover {
  background: var(--color-panel-lit);
}
.viewbox_btn:active {
  transform: translate(3px, 3px);
  box-shadow:
    inset 2px 2px 0 0 rgb(0 0 0 / 0.3),
    inset -2px -2px 0 0 var(--color-panel-lit);
}

.viewbox_return {
  position: absolute;
  left: 2rem;
  bottom: 2rem;
}
.viewbox_return_btn {
  background: var(--color-ink);
  border: 2px solid var(--color-stone-dark);
  color: var(--color-parchment);
  font-family: var(--font-pixel);
  font-size: 12px;
  line-height: 1.5;
  padding: 4px 8px;
  cursor: pointer;
  box-shadow: 2px 2px 0 0 rgb(0 0 0 / 0.5);
}
.viewbox_return_btn:hover {
  color: var(--color-gold);
  border-color: var(--color-gold);
}
</style>
