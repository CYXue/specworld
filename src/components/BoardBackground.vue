<script setup lang="ts">
/**
 * 背景 Canvas 网格动画（参考站 `BG`）。
 * 鼠标/触摸扫过处点亮 3×3 邻域方块，alpha 逐帧衰减。纯装饰层，不挡交互。
 * 只覆盖画布区域（position:absolute; inset:0），坐标按画布自身 rect 换算。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

const canvas = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let rafId = 0;
let blocks: Array<Array<{ active: boolean; alpha: number }>> = [];
let cols = 0;
let rows = 0;
let blockSize = 30;
let dpr = 1;
let lastKey = '';
/**
 * 网格线颜色。必须与 BoardCanvas 的 `--cb-theme` 同源，
 * 否则背景网格与瓦片是两套色，点进画布会看到「两层不同调」的底纹。
 */
const theme = '#4a7fd4';

function parseTheme(): [number, number, number] {
  const h = theme.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const [TR, TG, TB] = parseTheme();

/**
 * 减动效偏好（a11y：prefers-reduced-motion）。开启时「点亮」改为硬切：
 * 满 alpha 一帧即灭、不做逐格淡出；且无活跃方块时 rAF 完全停止。
 * 与 GlobeCanvas（自转/glide）、BoardCanvas（惯性）同一口径。
 */
const reduceMotion =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function resize() {
  const c = canvas.value;
  if (!c) return;
  if (rafId) cancelAnimationFrame(rafId);
  dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, c.offsetWidth * dpr);
  c.height = Math.max(1, c.offsetHeight * dpr);
  blockSize = (Math.min(c.offsetWidth, c.offsetHeight) / 100) * 5 * dpr;
  cols = Math.ceil(c.width / blockSize);
  rows = Math.ceil(c.height / blockSize);
  blocks = [];
  for (let r = 0; r < rows; r++) {
    blocks[r] = [];
    for (let cc = 0; cc < cols; cc++) blocks[r][cc] = { active: false, alpha: 0 };
  }
  draw();
}

function select(clientX: number, clientY: number) {
  const c = canvas.value;
  if (!c) return;
  const rect = c.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const col = Math.floor((x * dpr) / blockSize);
  const row = Math.floor((y * dpr) / blockSize);
  const key = `${col},${row}`;
  if (key !== lastKey) {
    trigger(col, row);
    lastKey = key;
  }
}

function trigger(cc: number, rr: number) {
  for (let e = -1; e <= 1; e++) {
    for (let o = -1; o <= 1; o++) {
      const c = cc + o;
      const i = rr + e;
      if (blocks[i] && blocks[i][c] && Math.random() > 0.5) {
        blocks[i][c].active = true;
        blocks[i][c].alpha = 1;
      }
    }
  }
  // 循环只在有活跃方块时驻留（见 draw 尾部）；这里负责唤醒
  if (!rafId) rafId = requestAnimationFrame(draw);
}

function draw() {
  const c = canvas.value;
  if (!c || !ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  let anyActive = false;
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      const b = blocks[r][cc];
      const ox = cc * blockSize;
      const oy = r * blockSize;
      ctx.strokeStyle = 'rgba(138,144,160,0.12)';
      ctx.strokeRect(ox, oy, blockSize, blockSize);
      if (b.active) {
        /*
         * 像素风的「点亮」是硬切到满亮再逐格熄灭，不是 alpha 连续淡出。
         * 这里用量化 alpha（4 档）代替浮点渐变 —— 淡出过程会看见一排半透明灰，
         * 那不是像素画该有的东西。
         */
        if (reduceMotion?.matches) {
          // 减动效：硬切点亮、不淡出，本帧即灭（循环随之停止）
          ctx.strokeStyle = `rgba(${TR},${TG},${TB},1)`;
          b.active = false;
          b.alpha = 0;
        } else {
          ctx.strokeStyle = `rgba(${TR},${TG},${TB},${Math.ceil(b.alpha * 4) / 4})`;
          b.alpha -= 0.03;
          if (b.alpha <= 0) {
            b.alpha = 0;
            b.active = false;
          }
        }
        ctx.strokeRect(ox, oy, blockSize, blockSize);
        if (b.active) anyActive = true;
      }
    }
  }
  // 没有活跃方块就停循环：减动效下一帧必停；常规态也省下一个常驻 rAF
  // （原实现永不归零，鼠标不动时也在每帧重画同一张网格）。
  if (anyActive) rafId = requestAnimationFrame(draw);
  else rafId = 0;
}

function onMove(e: PointerEvent | MouseEvent | TouchEvent) {
  if ('touches' in e && e.touches.length) {
    select(e.touches[0].clientX, e.touches[0].clientY);
  } else if ('clientX' in e) {
    select(e.clientX, e.clientY);
  }
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  const c = canvas.value;
  if (!c) return;
  ctx = c.getContext('2d');
  resize();
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(resize);
    ro.observe(c);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: true });
});
onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId);
  ro?.disconnect();
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('touchmove', onMove);
});
</script>

<template>
  <canvas ref="canvas" class="board-bg" aria-hidden="true" />
</template>

<style scoped>
.board-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}
</style>
