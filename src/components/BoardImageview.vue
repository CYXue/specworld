<script setup lang="ts">
/**
 * 全屏图片查看器（参考站 `IV`）：拖拽平移 + 滚轮/双指捏合缩放（钳制 0.5~3）。
 * 与画布不同 —— 这里只操作单张精灵图，不涉及环面回绕。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

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
let downX = 0;
let downY = 0;
/** 已捕获的 pointerId（拖过阈值才赋值；null = 未捕获）。见 onDown 纪律注释 */
let captured: number | null = null;
const pointers = new Map<number, { x: number; y: number }>();
let pinch: number | null = null;

/**
 * 拖拽阈值（px）：与 BoardCanvas / GlobeCanvas 同一纪律。
 * pointerdown 里**无条件** setPointerCapture 会劫持后续事件——
 * click 的 target 从子元素变成容器，症状是「能拖能缩却点不中」且零报错。
 * 拖过阈值才捕获，两者兼得：拖出元素不丢 up，点击语义不被污染。
 */
const DRAG_SLOP = 6;

function capture(e: PointerEvent) {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    captured = e.pointerId;
  } catch {
    /* 捕获失败就退化成不捕获（拖拽仍可用，只是拖出元素可能丢 up） */
  }
}

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
  downX = e.clientX;
  downY = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    // 双指 = 捏合手势，不可能是点击：立即捕获，不等阈值
    capture(e);
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
  // 拖过阈值才捕获（BoardCanvas.vue:284 同一坑的修法）
  const movedTotal = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
  if (captured === null && movedTotal > DRAG_SLOP) capture(e);
  const dx = e.clientX - sx;
  const dy = e.clientY - sy;
  sx = e.clientX;
  sy = e.clientY;
  mx.value += dx;
  my.value += dy;
  apply();
}

function onUp(e: PointerEvent) {
  // 多指时只认被捕获那根手指的 up：另一根的 up 会提前结束拖拽
  if (captured !== null && e.pointerId !== captured) return;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) ifDrag = false;
  // 双指还剩一根：回到单指平移，**必须用剩余手指的当前位置重置基准** ——
  // 否则单指分支的 `dx = clientX - sx` 拿着双指期间没更新的旧 sx，
  // 下一次移动瞬间跳掉一个「两指间距」（GlobeCanvas 同款坑的修法，
  // 2026-10-14 审计 B6）。
  if (pointers.size >= 1) {
    const rest = [...pointers.values()][0];
    if (rest) {
      sx = rest.x;
      sy = rest.y;
    }
  }
  if (captured !== null) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(captured);
    } catch {
      /* 已释放 */
    }
    captured = null;
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
  // Esc 关闭：监听挂在 document 而不是浮层自身 —— 焦点在别处时（打开查看器后
  // 点了地址栏、或从没聚焦过浮层）keydown 到不了浮层元素，键盘用户就关不掉。
  // role/aria-modal 让屏幕阅读器把它当模态浮层播报（2026-10-14 审计 B7）。
  document.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
});

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
</script>

<template>
  <div
    class="imageview"
    :class="{ imageview_show: shown }"
    role="dialog"
    aria-modal="true"
    :aria-label="$t('board.imageTitle')"
    @click.self="emit('close')"
  >
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
