<script setup lang="ts">
/**
 * 无限画布（环面回绕瓦片画廊）—— 主引擎。
 *
 * 完全复刻 cosmicbroth chessboard 的「无限画布复刻.html」：
 * DOM 瓦片恒定 = 视口网格数，越界即回绕、逻辑行列同步修正，于是任意方向
 * **无限**平移且节点数不变；点击瓦片进详情浮层，再点进全屏查看器。
 *
 * 工程纪律（都是踩过才知道）
 * --------------------------------
 * 1. **命令式管理瓦片**，不走逐帧 Vue 响应式。每帧只改 transform / img.src /
 *    textContent（合成层、零重排）。60 台时若用 Vue 响应式逐帧绑 50 个格子会掉帧。
 * 2. **setPointerCapture 必须拖过阈值才调用**（与 GlobeCanvas 同一坑）：
 *    按下就捕获会把兼容性鼠标事件（mouseup）重定向到容器，click 的 target 从瓦片
 *    <div> 变成容器，症状是「能拖能缩但点不进去」，零报错。
 * 3. **touch-action: none** 必须写（球面版漏写踩过）：默认 auto 时 Chrome 把触摸
 *    拖拽判成页面滚动手势，第 1 次 pointermove 后就发 pointercancel，手机上球一抖就停。
 * 4. 惯性由 ease 缓冲 + rAF 阻尼（*=0.95）实现；松手不主动停，让残速自然衰减。
 *    `prefers-reduced-motion` 下点击不惯性、拖拽也直接停。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  completeData,
  dataIndex,
  layoutPos,
  moverMetrics,
  scaleNums,
  viewportGrid,
  wrap,
  type BoardGrid,
  type Mover,
  type MoverMetrics,
} from '../lib/board';
import BoardBackground from './BoardBackground.vue';
import BoardDragtip from './BoardDragtip.vue';
import BoardViewbox from './BoardViewbox.vue';
import BoardImageview from './BoardImageview.vue';

export interface BoardTile {
  id: string;
  name: string;
  sprite: string;
  accent: string;
  detail: string;
}

const props = defineProps<{ tiles: BoardTile[] }>();
const emit = defineEmits<{ (e: 'count', n: number): void }>();

const router = useRouter();

const host = ref<HTMLElement | null>(null);
const scrollbox = ref<HTMLElement | null>(null);
const ready = ref(false);

const m = shallowRef<MoverMetrics>({ w: 120, h: 180, mx: 60, my: 90 });
const dataGrid = ref<BoardGrid>({ rows: 1, cols: 1 });
const vpGrid = ref<BoardGrid>({ rows: 1, cols: 1 });
let currentScale = 1;

interface MoverState extends Mover {
  ele: HTMLElement;
  img: HTMLImageElement;
  tip: HTMLElement;
  idx: number;
}
let movers: MoverState[] = [];

const ease = { x: 0, y: 0 };
let rafId = 0;
const mouse = { x: 0, y: 0, clickX: 0, clickY: 0 };
let ifMovable = false;
let captured: number | null = null;
const reduceMotion =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

// ── 叠层状态 ──
const dragtipHidden = ref(false);
let dragtipTimer: ReturnType<typeof setTimeout> | null = null;
const selected = ref<BoardTile | null>(null);
const imageviewUrl = ref<string | null>(null);

// 瓦片内 SVG 网格线（hover 时亮出，参考站同款）
const WEB_HZ = [60, 30, 90, 120, 150, 180, 210, 240, 270];
const WEB_VT = [25, 50, 75, 100, 125, 150, 175];
function webSvg(): string {
  let lines = '';
  for (const y of WEB_HZ)
    lines += `<line x1="0" y1="${y}" x2="200" y2="${y}" vector-effect="non-scaling-stroke"/>`;
  for (const x of WEB_VT)
    lines += `<line x1="${x}" y1="0" x2="${x}" y2="300" vector-effect="non-scaling-stroke"/>`;
  return `<svg class="board-mover_web" viewBox="0 0 200 300">${lines}</svg>`;
}

function stopInertia() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  ease.x = 0;
  ease.y = 0;
}

/** 位移 → 进 ease 缓冲；rAF 循环里逐帧应用 + 回绕 + 换图 */
function move(dx: number, dy: number) {
  ease.x += dx * 0.02 * currentScale;
  ease.y += dy * 0.02 * currentScale;
  if (rafId) return;
  rafId = requestAnimationFrame(step);
}

function step() {
  const n = props.tiles.length;
  const mm = m.value;
  const vp = vpGrid.value;
  const dg = dataGrid.value;
  for (const mv of movers) {
    mv.x += ease.x;
    mv.y += ease.y;
    wrap(mv, mm, vp);
    mv.ele.style.transform = `translate(${mv.x}px, ${mv.y}px)`;
    const idx = dataIndex(mv.col, mv.row, dg, n);
    if (idx !== mv.idx) {
      mv.idx = idx;
      const t = props.tiles[idx];
      mv.img.src = t?.sprite ?? '';
      mv.tip.textContent = t?.name ?? '';
      mv.ele.dataset.id = t?.id ?? '';
    }
  }
  ease.x *= 0.95;
  ease.y *= 0.95;
  if (Math.abs(ease.x) < 0.01 && Math.abs(ease.y) < 0.01) {
    ease.x = 0;
    ease.y = 0;
    rafId = 0;
    return;
  }
  rafId = requestAnimationFrame(step);
}

/** 构建视口网格瓦片（命令式）。tiles 变化 / 容器首次就绪 / 行列数变化都走这里 */
function build() {
  const el = scrollbox.value;
  const h = host.value;
  if (!el || !h) return;
  const rect = h.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const n = props.tiles.length;
  dataGrid.value = completeData(n);
  currentScale = scaleNums(rect.width, rect.height);
  m.value = moverMetrics(currentScale);
  vpGrid.value = viewportGrid(rect.width, rect.height, m.value);

  const mm = m.value;
  const periodW = vpGrid.value.cols * (mm.w + mm.mx) - mm.mx;
  const periodH = vpGrid.value.rows * (mm.h + mm.my) - mm.my;
  el.style.width = `${periodW}px`;
  el.style.height = `${periodH}px`;

  el.innerHTML = '';
  movers = [];
  const total = vpGrid.value.rows * vpGrid.value.cols;
  const web = webSvg();
  for (let i = 0; i < total; i++) {
    const p = layoutPos(i, vpGrid.value.cols, mm);
    const div = document.createElement('div');
    div.className = 'board-mover';
    div.style.width = `${mm.w}px`;
    div.style.height = `${mm.h}px`;
    div.style.transform = `translate(${p.x}px, ${p.y}px)`;
    div.innerHTML =
      web +
      `<div class="board-mover_image"><img alt="device" draggable="false" /></div>` +
      `<div class="board-mover_tip"></div>`;
    el.appendChild(div);
    const img = div.querySelector('img') as HTMLImageElement;
    const tip = div.querySelector('.board-mover_tip') as HTMLElement;
    const idx = dataIndex(p.col, p.row, dataGrid.value, n);
    const t = props.tiles[idx];
    img.src = t?.sprite ?? '';
    tip.textContent = t?.name ?? '';
    div.dataset.id = t?.id ?? '';
    movers.push({ ...p, ele: div, img, tip, idx });
  }
  emit('count', n);
}

// ── 尺寸 ──
let ro: ResizeObserver | null = null;
function onResize() {
  const h = host.value;
  const el = scrollbox.value;
  if (!h || !el) return;
  const rect = h.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const prevCols = vpGrid.value.cols;
  const prevRows = vpGrid.value.rows;
  const prevScale = currentScale;
  currentScale = scaleNums(rect.width, rect.height);
  const mm = moverMetrics(currentScale);
  const vp = viewportGrid(rect.width, rect.height, mm);
  if (vp.cols === prevCols && vp.rows === prevRows) {
    // 行列数不变：仅按比例缩放网格几何，保持瓦片相对位置
    const ratio = currentScale / prevScale;
    m.value = mm;
    vpGrid.value = vp;
    const periodW = vp.cols * (mm.w + mm.mx) - mm.mx;
    const periodH = vp.rows * (mm.h + mm.my) - mm.my;
    el.style.width = `${periodW}px`;
    el.style.height = `${periodH}px`;
    for (const mv of movers) {
      mv.x *= ratio;
      mv.y *= ratio;
      mv.ele.style.transform = `translate(${mv.x}px, ${mv.y}px)`;
    }
  } else {
    build();
  }
}

onMounted(() => {
  build();
  if (typeof ResizeObserver === 'function' && host.value) {
    ro = new ResizeObserver(onResize);
    ro.observe(host.value);
  }
  requestAnimationFrame(() => (ready.value = true));
});

onBeforeUnmount(() => {
  stopInertia();
  ro?.disconnect();
  if (dragtipTimer) clearTimeout(dragtipTimer);
});

watch(
  () => props.tiles,
  () => {
    stopInertia();
    build();
  },
  { deep: false },
);

// ── 拖拽平移 ──
function hideDragtip() {
  if (dragtipHidden.value) return;
  if (dragtipTimer) clearTimeout(dragtipTimer);
  dragtipTimer = setTimeout(() => (dragtipHidden.value = true), 500);
}

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  ifMovable = true;
  mouse.clickX = mouse.x = e.clientX;
  mouse.clickY = mouse.y = e.clientY;
  stopInertia();
}

function onPointerMove(e: PointerEvent) {
  if (!ifMovable) return;
  hideDragtip();
  const dx = e.clientX - mouse.x;
  const dy = e.clientY - mouse.y;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  const movedTotal = Math.abs(e.clientX - mouse.clickX) + Math.abs(e.clientY - mouse.clickY);
  // 拖过阈值才捕获：保住「拖出画布不丢 up」，又不影响点击（见文件头纪律 2）
  if (captured === null && movedTotal > 6) {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      captured = e.pointerId;
    } catch {
      /* 捕获失败就退化成不捕获 */
    }
  }
  move(dx, dy);
}

function onPointerUp(e: PointerEvent) {
  if (!ifMovable) return;
  ifMovable = false;
  const movedTotal = Math.abs(e.clientX - mouse.clickX) + Math.abs(e.clientY - mouse.clickY);
  if (captured !== null) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(captured);
    } catch {
      /* 已释放 */
    }
    captured = null;
  }
  if (movedTotal <= 6) {
    // 点击（位移极小）→ 打开指针下瓦片的详情，不触发惯性
    stopInertia();
    const target = (e.target as HTMLElement | null)?.closest?.(
      '.board-mover',
    ) as HTMLElement | null;
    const id = target?.dataset.id;
    if (id) openViewbox(id);
  }
  // movedTotal > 6：松手不主动停，让 ease 残速自然衰减成惯性
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  stopInertia();
  move(0, 10 * Math.sign(e.deltaY || 1));
}

function onContextMenu(e: Event) {
  e.preventDefault();
}

// ── 详情浮层 / 全屏查看器 ──
function openViewbox(id: string) {
  const t = props.tiles.find((x) => x.id === id);
  if (t) selected.value = t;
}
function closeViewbox() {
  selected.value = null;
}
function openImageview() {
  if (selected.value) imageviewUrl.value = selected.value.sprite;
}
function closeImageview() {
  imageviewUrl.value = null;
}
function gotoProduct(id: string) {
  closeViewbox();
  router.push(`/product/${id}`);
}

/** 重置视图：把瓦片重新铺回原点（筛选变化后想回到初始画面时用） */
function reset() {
  stopInertia();
  build();
  dragtipHidden.value = false;
}

function focusCanvas() {
  host.value?.focus();
}

defineExpose({ reset, focusCanvas });
</script>

<template>
  <div
    ref="host"
    class="board-host"
    :class="{ 'is-ready': ready }"
    tabindex="0"
    role="application"
    aria-label="设备无限画布：拖拽平移，点瓦片看详情"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel="onWheel"
    @contextmenu="onContextMenu"
  >
    <!-- 背景 Canvas 网格动画（鼠标/触摸扫过点亮 3×3 邻域） -->
    <BoardBackground />

    <!-- 瓦片层：唯一被命令式写入 transform 的容器 -->
    <div ref="scrollbox" class="board-scrollbox" aria-hidden="true" />

    <!-- 空结果 -->
    <div v-if="!tiles.length" class="board-empty">
      <p class="board-empty-title">画布上还没有设备</p>
      <p class="board-empty-sub">当前筛选没有命中任何机型，换个条件或清空看看全部。</p>
    </div>

    <!-- 拖拽提示 -->
    <BoardDragtip :hidden="dragtipHidden" />

    <!-- HUD -->
    <div class="board-hud" aria-hidden="true">
      <span class="board-hud-b">{{ tiles.length }} 台</span>
      <span class="board-hud-sep">/</span>
      <span>环面回绕 · 无限平移</span>
    </div>

    <!-- 详情浮层 -->
    <BoardViewbox
      v-if="selected"
      :tile="selected"
      @close="closeViewbox"
      @open-image="openImageview"
      @goto="gotoProduct"
    />

    <!-- 全屏查看器 -->
    <BoardImageview v-if="imageviewUrl" :src="imageviewUrl" @close="closeImageview" />
  </div>
</template>

<style scoped>
.board-host {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  outline: none;
  /* 纪律 3：必须接管手势，否则触摸拖拽会被浏览器吃掉 */
  touch-action: none;
  overscroll-behavior: contain;
  cursor: grab;
  /*
   * 画布底色改成新调色板的深空色；主题色 --cb-theme 统一为青金石蓝。
   * 原值 #178ec5 是参考站的赛博青，与全站新配色（矿石系）不同调，
   * 会造成「点进画布像换了另一个站点」。
   */
  background: var(--color-ink);
  color: var(--color-parchment);
  font-family: var(--font-pixel);
  /*
   * 显式锁 12px：body 是 14px，而 build() 命令式建的瓦片是裸 <a>/<line>，
   * 没有 class 也没有显式字号 → 会继承 14px（非 12 的整数倍，点阵被重采样）。
   * 命令式 DOM 不吃 scoped 样式这条纪律见下方 :deep() 注释。
   */
  font-size: 12px;
  line-height: 2;
  --cb-theme: var(--color-lapis);
}
.board-host:focus-visible {
  outline: 2px solid var(--color-gold);
  outline-offset: -2px;
}
.board-host:active {
  cursor: grabbing;
}

.board-scrollbox {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  opacity: 0;
  transform: scale(1.06);
  transition:
    opacity 0.8s var(--ease_out, ease-out),
    transform 0.8s var(--ease_out, ease-out);
  will-change: transform;
}
.board-host.is-ready .board-scrollbox {
  opacity: 1;
  transform: scale(1);
}

/*
 * ⚠️ 瓦片是 `build()` 里用 document.createElement/innerHTML **动态创建**的，
 * 拿不到 Vue 编译期注入的 scoped 属性（data-v-xxx），所以 `.board-mover*` 的
 * scoped 规则**全都不会命中** —— 症状是 position:absolute 失效、瓦片掉进普通流
 * 竖直堆叠成一列（画面大面积空白地板），且 mask 造型与 hover 也全没了。
 * 必须用 :deep() 让选择器编译成 `.board-host[data-v-x] .board-mover`，
 * 才能命中「scoped 根的后代」里这些动态节点。这条是 smoke 抓到的真 bug。
 */
:deep(.board-mover) {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  will-change: transform;
}

/* 锯齿瓦片造型：SVG mask 裁出缺角（参考站同款 path） */
:deep(.board-mover_image) {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /*
   * 瓦片底板：主题色的**极暗档**（约 12% 混合）。
   * 一开始给到 30%，结果整屏变成大块蓝底板，把手机精灵图压成了「蓝底上的灰图」——
   * 底板的任务只是「让没加载到的瓦片有实体感」，不是抢戏。
   */
  background-color: color-mix(in srgb, var(--cb-theme) 12%, var(--color-ink));
  -webkit-mask-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'%3E%3Cpath d='M200 186.32v25.54l-12.77 12.76v49.86L161.71 300H0V127.66l12.77-12.77V89.36L0 76.6V25.53L25.53 0h161.7v173.56z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'%3E%3Cpath d='M200 186.32v25.54l-12.77 12.76v49.86L161.71 300H0V127.66l12.77-12.77V89.36L0 76.6V25.53L25.53 0h161.7v173.56z'/%3E%3C/svg%3E");
  -webkit-mask-size: cover;
  mask-size: cover;
}
:deep(.board-mover_image img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  /*
   * 精灵图是像素图，连续 scale(1.2) 会把它重采样成模糊的插值图。
   * 改成整数倍 2× + steps 硬切：放大后仍是锐利的像素块。
   */
  transition: transform 120ms steps(2, end);
}

/*
 * hover 网格线。原版用 radial-gradient 做径向渐隐 —— 连续渐变，不是像素语言。
 * 改成 repeating-linear-gradient 画硬边方格网，格子 12px，与全站「方块」母题一致。
 * 只改视觉，不动几何：这里换掉 mask 就够了，line 元素仍由 build() 生成（不动 DOM 结构）。
 */
:deep(.board-mover_web) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
  background-image:
    repeating-linear-gradient(0deg, var(--cb-theme) 0 2px, transparent 2px 12px),
    repeating-linear-gradient(90deg, var(--cb-theme) 0 2px, transparent 2px 12px);
  transition: opacity 120ms steps(2, end);
}
:deep(.board-mover_web line) {
  display: none;
}

/* hover 文案 */
:deep(.board-mover_tip) {
  position: absolute;
  bottom: calc(-1 * 2.2rem);
  left: 0;
  right: 0;
  text-align: center;
  font-size: 12px;
  color: var(--color-gold);
  opacity: 0;
  transform: translateY(50%);
  transition:
    opacity 120ms steps(2, end),
    transform 120ms steps(2, end);
  /* 硬投影而非辉光：辉光的 blur 半径让文字发虚，与点阵冲突 */
  text-shadow:
    2px 0 0 var(--color-ink),
    -2px 0 0 var(--color-ink),
    0 2px 0 var(--color-ink),
    0 -2px 0 var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.board-mover:hover .board-mover_image img) {
  transform: scale(2);
}
:deep(.board-mover:hover .board-mover_web) {
  opacity: 1;
}
:deep(.board-mover:hover .board-mover_tip) {
  opacity: 1;
  transform: translateY(0);
}
/* hover 瓦片外框点亮：像素风用「边框变色」而不是缩放/发光 */
:deep(.board-mover:hover .board-mover_image) {
  outline: 2px solid var(--color-gold);
  outline-offset: -2px;
}

.board-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none;
}
.board-empty-title {
  font-size: 24px;
  line-height: 1.5;
  color: var(--color-parchment-lit);
  text-shadow:
    2px 0 0 var(--color-ink),
    -2px 0 0 var(--color-ink),
    0 2px 0 var(--color-ink),
    0 -2px 0 var(--color-ink);
}
.board-empty-sub {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-ghost);
}

.board-hud {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-parchment-dim);
  /* HUD 条用实心底 + 硬边：半透明 + 1px 细边是玻璃拟态，不是像素 */
  background: var(--color-ink);
  border: 2px solid var(--color-stone-dark);
  box-shadow: 2px 2px 0 0 rgb(0 0 0 / 0.5);
  pointer-events: none;
}
.board-hud-b {
  color: var(--cb-theme);
}
.board-hud-sep {
  color: var(--color-stone);
}
</style>
