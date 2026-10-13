<script setup lang="ts">
/**
 * 全屏图片查看器（参考站 `IV`）：拖拽平移 + 滚轮/双指捏合缩放（钳制 0.5~3）。
 * 与画布不同 —— 这里只操作单张精灵图，不涉及环面回绕。
 */
import { onMounted, ref } from 'vue';

defineProps<{ src: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const img = ref<HTMLElement | null>(null);
const scale = ref(1);
const mx = ref(0);
const my = ref(0);
const shown = ref(false);

let ifDrag = false;
let sx = 0;
let sy = 0;
const pointers = new Map<number, { x: number; y: number }>();
let pinch: number | null = null;

function apply() {
  const el = img.value;
  if (!el) return;
  el.style.transform = `translate(${mx.value}px, ${my.value}px) scale(${scale.value})`;
}

function onDown(e: PointerEvent) {
  ifDrag = true;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  sx = e.clientX;
  sy = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* 捕获失败忽略 */
  }
}

function onMove(e: PointerEvent) {
  if (!ifDrag) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2 && pinch != null) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    scale.value = Math.max(0.5, Math.min(3, scale.value * (d / pinch)));
    pinch = d;
    apply();
    return;
  }
  const dx = e.clientX - sx;
  const dy = e.clientY - sy;
  sx = e.clientX;
  sy = e.clientY;
  mx.value += dx;
  my.value += dy;
  apply();
}

function onUp(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) ifDrag = false;
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  } catch {
    /* 已释放 */
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  scale.value = Math.max(0.5, Math.min(3, scale.value + (e.deltaY < 0 ? 0.1 : -0.1)));
  apply();
}

onMounted(() => {
  scale.value = 1;
  mx.value = 0;
  my.value = 0;
  apply();
  requestAnimationFrame(() => (shown.value = true));
});
</script>

<template>
  <div class="imageview" :class="{ imageview_show: shown }" @click.self="emit('close')">
    <div
      ref="img"
      class="imageview_image"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @wheel.prevent="onWheel"
    >
      <img :src="src" alt="" draggable="false" />
    </div>
    <p class="imageview_tip">{{ $t('board.imageviewTip') }}</p>
    <div class="imageview_return">
      <button class="imageview_return_btn" @click="emit('close')">{{ $t('board.backClose') }}</button>
    </div>
  </div>
</template>

<style scoped>
.imageview {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 不透明深色遮罩，理由同 BoardViewbox */
  background-color: var(--color-void);
  opacity: 0;
  pointer-events: none;
  z-index: 100;
  touch-action: none;
  --cb-theme: var(--color-gold);
}
.imageview_show {
  opacity: 1;
  pointer-events: auto;
}
.imageview_image {
  position: relative;
  height: 70%;
  max-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
  will-change: transform;
}
.imageview_image img {
  height: 100%;
  width: auto;
  max-width: 90vw;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}
.imageview_tip {
  position: relative;
  display: inline-block;
  padding: 4px 8px;
  color: var(--color-parchment);
  font-family: var(--font-pixel);
  font-size: 12px;
  line-height: 1.5;
  background: var(--color-ink);
  border: 2px solid var(--color-stone-dark);
  box-shadow: 2px 2px 0 0 rgb(0 0 0 / 0.5);
}
.imageview_return {
  position: fixed;
  left: 2rem;
  bottom: 2rem;
}
.imageview_return_btn {
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
.imageview_return_btn:hover {
  color: var(--color-gold);
  border-color: var(--color-gold);
}
@media screen and (max-width: 700px) {
  .imageview_image {
    height: auto;
    width: 80%;
  }
  .imageview_image img {
    height: auto;
    width: 100%;
  }
}
</style>
