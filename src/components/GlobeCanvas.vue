<script setup lang="ts">
/**
 * 设备球：60 台贴在球壳上，拖动转球，内容从一侧转到另一侧，绕一圈复原。
 *
 * 与 BoardCanvas（环面）的区别，别照搬那边的结论
 * ----------------------------------------------
 * 1. **没有视口裁剪**：所有 60 台始终渲染。平面版靠裁剪撑住无限，
 *    球面版的「无限」来自**曲面本身没有边界**，60 个 DOM 节点根本不需要裁剪。
 * 2. **没有边界，也就没有 fit**：fitCamera 那套「装进视口」在这里不存在，
 *    球永远在视口中央，缩放改的是相机距离 dist。
 * 3. **深度决定层次**：z-index 与尺寸、不透明度都由 depth 算出，
 *    近的压住远的。平面版所有格子同层。
 * 4. **背面仍然渲染**（线框球口径），只是变暗 —— 全部 60 台始终可见，
 *    不是「转到背面就看不见了」的实心球。
 *
 * 自动自转：默认一直慢慢转（AUTO_SPIN_DPS 度/秒），拖拽时暂停、松手后恢复。
 * 这是「一直在循环」最直观的体现 —— 不用拖它也在转。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  AUTO_SPIN_DPS,
  DIST_DEFAULT,
  LAT_LIMIT,
  project,
  rotateBy,
  zoomDist,
  globeRadiusPx,
  byDepth,
  pinchFactor,
  spherePoints,
  type Camera3,
  type Projected,
} from '../lib/globe';
import type { CanvasDoc } from '../lib/canvasFilter';

const props = defineProps<{
  documents: CanvasDoc[];
  /** 品牌分组的台数，用于把不同品牌排到不同纬度带 */
  groups: number[];
  accentOf: (brand: string) => string;
  /** 是否自动自转 */
  spin?: boolean;
}>();

const emit = defineEmits<{ (e: 'ready'): void }>();

const host = ref<HTMLElement | null>(null);
/** 视口尺寸 */
const vp = shallowRef({ w: 900, h: 560 });
const cam = ref<Camera3>({ lon: 0, lat: 12, dist: DIST_DEFAULT });
const dragging = ref(false);
/**
 * 拖拽位移超过这个像素数就不算「点击」：
 * 既不给惯性（否则点一台设备球会飘出去），也吃掉随之而来的 click（否则误跳详情页）。
 */
const DRAG_SLOP = 6;
/** 本次按下到松开的像素位移 */
const moved = ref(0);
/*
 * 原先这里有个 `hovered` ref 专门给圆点加 3px 描边（box-shadow）。
 * 改成方块节点后，hover 反馈走 CSS `:hover` 缩放（见 .globe-dot）就够了，
 * 少一个每帧可能被写到的响应式状态，也少一次无谓的重渲染。
 */

const reduceMotion =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/**
 * 每台设备的球面位置 + 投影结果。
 * 球面位置只随文档列表变（computed 缓存），投影每帧随相机变。
 */
const placed = computed(() => {
  // 动态 import 会破坏 computed 的依赖追踪，这里直接用已 import 的 spherePoints
  const pts = spherePoints(props.documents.length, props.groups);
  return props.documents.map((d, i) => ({ doc: d, at: pts[i] ?? { lat: 0, lon: 0 } }));
});

const projected = computed(() => {
  const v = vp.value;
  const c = cam.value;
  return placed.value.map(({ doc, at }) => ({ doc, ...project(at, c, v) })).sort(byDepth);
});

const radiusPx = computed(() => globeRadiusPx(cam.value, vp.value));

// ── 自动自转 ──
let spinRaf = 0;
let lastSpin = 0;

function stopSpin() {
  if (spinRaf) cancelAnimationFrame(spinRaf);
  spinRaf = 0;
  lastSpin = 0;
}

function startSpin() {
  if (spinRaf || reduceMotion?.matches || props.spin === false) return;
  const step = (t: number) => {
    const dt = lastSpin ? Math.min(64, t - lastSpin) : 16;
    lastSpin = t;
    cam.value = rotateBy(cam.value, (AUTO_SPIN_DPS * dt) / 1000, 0);
    spinRaf = requestAnimationFrame(step);
  };
  spinRaf = requestAnimationFrame(step);
}

watch(
  () => props.spin,
  (on) => (on === false ? stopSpin() : startSpin()),
);

// ── 惯性 ──
let glideRaf = 0;
let vLon = 0;
let vLat = 0;
let lastGlide = 0;

function stopInertia() {
  if (glideRaf) cancelAnimationFrame(glideRaf);
  glideRaf = 0;
  vLon = 0;
  vLat = 0;
  lastGlide = 0;
}

function glide() {
  if (reduceMotion?.matches) {
    stopInertia();
    startSpin();
    return;
  }
  const step = (t: number) => {
    const dt = lastGlide ? Math.min(48, t - lastGlide) : 16;
    lastGlide = t;
    // 每秒衰减到约 3%，与帧率无关（固定系数在 120Hz 屏上会滑得更远）
    const k = Math.pow(0.03, dt / 1000);
    vLon *= k;
    vLat *= k;
    cam.value = rotateBy(cam.value, (vLon * dt) / 1000, (vLat * dt) / 1000);
    if (Math.abs(vLon) < 1 && Math.abs(vLat) < 1) {
      stopInertia();
      startSpin();
      return;
    }
    glideRaf = requestAnimationFrame(step);
  };
  glideRaf = requestAnimationFrame(step);
}

// ── 指针 ──
/** 活动指针。≥2 个时进入捏合缩放（手机没有滚轮，这是移动端唯一的缩放手段） */
const pointers = new Map<number, { x: number; y: number }>();
let lastX = 0;
let lastY = 0;
/** 上一次 move 的时间戳，用来按真实帧间隔算惯性速度（写死 16ms 会在慢拖时过冲） */
let lastT = 0;
/** 上一次的两指距离 */
let pinchDist = 0;
/**
 * 已捕获的指针 id。**不能**在 pointerdown 里就捕获 —— 见 onPointerMove 里的说明：
 * 一按下就捕获会把 click 的 target 从设备 <a> 劫持到容器上，设备就再也点不进去了。
 */
let capturedId: number | null = null;

function twoPointerDistance(): number {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function beginDrag(x: number, y: number, t: number) {
  dragging.value = true;
  moved.value = 0;
  lastX = x;
  lastY = y;
  lastT = t;
}

function onPointerDown(e: PointerEvent) {
  /*
   * moved 必须在**任何分支之前**清零。
   * 只在拖拽分支里清会有个很隐蔽的坑：一旦 pointers 里残留了没收到 up 的指针
   * （真机切后台、浏览器吞掉 pointerup 都会发生），后续 pointerdown 会误判成捏合
   * 而不清 moved —— 于是「上一次拖拽的大位移」一直有效，把真正的点击也吃掉，
   * 症状是「点设备没反应」。真机实测抓到过一次，代价是整页再也点不进去。
   */
  moved.value = 0;
  // 第三根手指落下说明状态已经不一致（正常最多两指），直接重开一轮，宁可丢一次捏合
  if (pointers.size >= 2) pointers.clear();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  stopInertia();
  stopSpin();
  if (pointers.size >= 2) {
    // 第二根手指落下：转为捏合，把已积累的转球动作收掉
    dragging.value = false;
    pinchDist = twoPointerDistance();
    return;
  }
  beginDrag(e.clientX, e.clientY, e.timeStamp || performance.now());
}

function onPointerMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // 捏合：张开 = 拉近，捏拢 = 推远（手机没有滚轮，这是移动端唯一的缩放手段）
  if (pointers.size >= 2) {
    const d = twoPointerDistance();
    // 捏合的手指位移一样要计入 moved，否则捏完松手落在设备上会误跳详情
    moved.value += Math.abs(d - pinchDist);
    cam.value = zoomDist(cam.value, pinchFactor(pinchDist, d));
    pinchDist = d;
    return;
  }
  if (!dragging.value) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  const now = e.timeStamp || performance.now();
  const dt = Math.max(1, Math.min(64, now - lastT));
  lastX = e.clientX;
  lastY = e.clientY;
  lastT = now;
  moved.value += Math.abs(dx) + Math.abs(dy);
  /*
   * 拖过阈值才捕获指针。
   * ⚠️ 不能在 pointerdown 里就 setPointerCapture：捕获会把**兼容性鼠标事件**
   * （mouseup，以及由 down/up 共同祖先决定的 click）一起重定向到捕获元素，
   * 于是 click 的 target 从设备 <a> 变成容器 div —— 表现为「球能转，但设备永远点不进去」。
   * 真机实测抓到：elementFromPoint 明明命中 <a>，click 事件的 target 却是 DIV，
   * 且没有任何报错。拖过阈值再捕获既保住了「拖出球外不丢 up」，又不影响点击。
   */
  if (capturedId === null && moved.value > DRAG_SLOP) {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      capturedId = e.pointerId;
    } catch {
      /* 捕获失败就退化成不捕获，拖拽仍可用（只是拖出容器会丢事件） */
    }
  }
  // 拖多少像素转多少度。纬度方向取反：向下拖应该是把球往下转（看到北半球）
  const dLon = -dx * 0.32;
  const dLat = dy * 0.32;
  cam.value = rotateBy(cam.value, dLon, dLat);
  vLon = (dLon * 1000) / dt;
  vLat = (dLat * 1000) / dt;
}

function endPointer(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (capturedId !== null) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(capturedId);
    } catch {
      /* 指针已释放 */
    }
    capturedId = null;
  }
  // 双指还剩一根：回到单指转球，重新起算基准点，否则会瞬移一个「两指间距」
  if (pointers.size >= 1) {
    const p = [...pointers.values()][0];
    if (p) beginDrag(p.x, p.y, e.timeStamp || performance.now());
    return;
  }
  pinchDist = 0;
  if (!dragging.value) {
    startSpin();
    return;
  }
  dragging.value = false;
  // 点击（没怎么移动）不该启动惯性 —— 否则点一台设备球会飘出去一段
  if (moved.value > DRAG_SLOP) glide();
  else startSpin();
}

/**
 * 转球时如果起手落在某台设备上，松手（哪怕只挪了几像素、或拖出去又拖回来）
 * 浏览器照样会派发 click → 误跳详情页。位移过阈值就在捕获阶段吃掉它。
 */
function onClickCapture(e: MouseEvent) {
  if (moved.value > DRAG_SLOP) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  // deltaMode 归一化：1 = 行、2 = 页，不归一的话触控板上会一格跳很远
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
  const d = e.deltaY * unit;
  cam.value = zoomDist(cam.value, Math.exp(d * 0.0012));
}

function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  const stepDeg = e.shiftKey ? 30 : 12;
  if (e.key === 'ArrowLeft') cam.value = rotateBy(cam.value, stepDeg, 0);
  else if (e.key === 'ArrowRight') cam.value = rotateBy(cam.value, -stepDeg, 0);
  else if (e.key === 'ArrowUp') cam.value = rotateBy(cam.value, 0, stepDeg);
  else if (e.key === 'ArrowDown') cam.value = rotateBy(cam.value, 0, -stepDeg);
  else if (e.key === '+' || e.key === '=') cam.value = zoomDist(cam.value, 0.9);
  else if (e.key === '-' || e.key === '_') cam.value = zoomDist(cam.value, 1.1);
  else return;
  e.preventDefault();
}

function reset() {
  stopInertia();
  cam.value = { lon: 0, lat: 12, dist: DIST_DEFAULT };
  startSpin();
}

/**
 * 指针在球外结束时的兜底清理（拖出窗口、切后台、浏览器吞掉 pointerup）。
 * 不清理的话 pointers 会一直留着旧 id，下一次按下就被当成「第二根手指」进捏合。
 */
function onDocPointerEnd(e: PointerEvent) {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size === 0) {
    dragging.value = false;
    pinchDist = 0;
  }
}

// ── 视口 ──
let ro: ResizeObserver | null = null;
let onWinResize: (() => void) | null = null;

onMounted(() => {
  const el = host.value;
  if (!el) return;
  const read = () => {
    const r = el.getBoundingClientRect();
    // 高度为 0（父级塌了）时沿用旧值 —— 0 会让投影全部退化为除零
    if (r.width > 0 && r.height > 0) vp.value = { w: r.width, h: r.height };
  };
  read();
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(read);
    ro.observe(el);
  } else {
    onWinResize = read;
    window.addEventListener('resize', read);
  }
  document.addEventListener('pointerup', onDocPointerEnd);
  document.addEventListener('pointercancel', onDocPointerEnd);
  startSpin();
  emit('ready');
});

onBeforeUnmount(() => {
  stopSpin();
  stopInertia();
  document.removeEventListener('pointerup', onDocPointerEnd);
  document.removeEventListener('pointercancel', onDocPointerEnd);
  ro?.disconnect();
  if (onWinResize) window.removeEventListener('resize', onWinResize);
});

function cellStyle(p: Projected & { doc: CanvasDoc }) {
  return {
    transform: `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%) scale(${p.scale})`,
    opacity: p.opacity,
    zIndex: String(100 + Math.round((p.depth + 1) * 50)),
    // 背面的设备不抢指针：否则点正面那台会被背面的挡住
    pointerEvents: p.depth < -0.15 ? ('none' as const) : ('auto' as const),
  };
}

defineExpose({ reset, stopSpin, startSpin });
</script>

<template>
  <!--
    role="application" 是必要的：这是自定义交互画布，不是可遍历的文档流。
    代价是读屏与纯键盘用户进不来，所以页面底部另有一份 sr-only 线性列表兜底。
  -->
  <div
    ref="host"
    class="globe-host relative select-none overflow-hidden"
    :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
    tabindex="0"
    role="application"
    aria-label="设备球：拖动可旋转球面，浏览全部设备"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endPointer"
    @pointercancel="endPointer"
    @click.capture="onClickCapture"
    @wheel="onWheel"
    @keydown="onKeydown"
  >
    <!-- 球体：正球任何角度的轮廓都是圆，所以一个圆就够，不必每帧重算。
         border-radius:50% 是几何必需，见 .globe-body 的注释。 -->
    <div
      class="globe-body pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      :style="{
        width: `${radiusPx * 2}px`,
        height: `${radiusPx * 2}px`,
      }"
    />

    <!-- 设备节点 -->
    <RouterLink
      v-for="p in projected"
      :key="p.doc.id"
      :to="`/product/${p.doc.id}`"
      class="globe-cell absolute left-0 top-0"
      :style="cellStyle(p)"
      :title="`${p.doc.nameZh ?? p.doc.name} · ${p.doc.releaseDate.slice(0, 7)}`"
    >
      <!-- 方块节点（原版是圆点）：hover 时靠 CSS 放大一格，见 .globe-dot -->
      <span class="globe-dot block" :style="{ background: accentOf(p.doc.brand) }" />
      <span
        v-if="p.scale > 1.05 && p.depth > 0.35"
        class="globe-label"
        :style="{ color: accentOf(p.doc.brand) }"
      >
        {{ p.doc.nameZh ?? p.doc.name }}
      </span>
    </RouterLink>

    <!-- HUD -->
    <div class="globe-hud">
      {{ documents.length }} 台 · 经度 {{ Math.round(cam.lon) }}° · 纬度 {{ Math.round(cam.lat) }}°
      · 视距 {{ cam.dist.toFixed(2) }}
    </div>

    <div v-if="!documents.length" class="globe-empty">球上一台设备都没有</div>
  </div>
</template>

<style scoped>
/*
 * 球体：很淡的填充 + 描边，只为让「这是一个球」看得出来，不抢设备的注意力。
 *
 * ⚠️ 这里的 `border-radius: 50%` 是**几何必需**，不是风格遗留：
 * 正球在任何一个视角下的轮廓都是正圆，缺了它就看不出「这是个球」而不是一片星空。
 * 所以像素改造只动球体**内部**的质感与描边，不动它的圆形轮廓 ——
 * 「全站零圆角」这条纪律对球面几何不适用，别为了守规矩把球画成方块。
 */
.globe-body {
  border: 2px solid var(--color-stone-dark);
  /* 原版是 radial-gradient 高光 —— 连续渐变。改成离散色环：3 层纯色圆 + 实心边。 */
  background:
    radial-gradient(circle at 38% 32%, rgb(255 255 255 / 0.06) 0 22%, transparent 22%),
    radial-gradient(circle at 50% 50%, transparent 0 62%, rgb(0 0 0 / 0.25) 62% 100%);
  box-shadow: inset 0 0 0 2px rgb(0 0 0 / 0.35);
}

.globe-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  will-change: transform;
  text-decoration: none;
}

/*
 * 设备节点：像素风的「星球上的方块」而不是圆点。
 * 这是全站唯一保留圆形的地方是 .globe-body（球），节点本身是方的 ——
 * 方块在暗背景上比圆点更醒目，也与全站的方块母题一致。
 */
.globe-dot {
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-ink);
  box-shadow: 1px 1px 0 0 rgb(0 0 0 / 0.5);
  transition: transform 90ms steps(2, end);
}
.globe-cell:hover .globe-dot {
  /* hover = 放大一格 + 外框点亮，不缩放整行（会抖） */
  transform: scale(1.5);
}

.globe-label {
  font-family: var(--font-pixel);
  font-size: 12px;
  line-height: 1.5;
  max-width: 92px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 硬投影，不是 2px 柔和阴影 */
  text-shadow:
    2px 0 0 var(--color-ink),
    -2px 0 0 var(--color-ink),
    0 2px 0 var(--color-ink),
    0 -2px 0 var(--color-ink);
}

.globe-hud {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 4px 8px;
  font-family: var(--font-pixel);
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-parchment-dim);
  background: var(--color-ink);
  border: 2px solid var(--color-stone-dark);
  box-shadow: 2px 2px 0 0 rgb(0 0 0 / 0.5);
  pointer-events: none;
}

.globe-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: var(--font-pixel);
  font-size: 24px;
  line-height: 1.5;
  color: var(--color-parchment-dim);
  text-shadow:
    2px 0 0 var(--color-ink),
    -2px 0 0 var(--color-ink),
    0 2px 0 var(--color-ink),
    0 -2px 0 var(--color-ink);
}

/*
 * ⚠️ height: 100% 是必须的，不是装饰。
 * 本组件内部全是 absolute 定位的子元素，内容高度为 0；父容器虽然给了确定像素高度，
 * 但本元素不写 height:100% 就拿不到它，实测高度是 **0**。
 * 症状和 /canvas 那次一模一样：画面照样完整渲染（视口有 fallback 兜底），
 * 但指针事件全部落空 —— 拖不动、滚不了，只有点击和键盘能用。
 * 构建成功、单测全绿、截图看着都对，只有真机去拖才抓得到。
 */
.globe-host {
  height: 100%;
  /*
   * touch-action: none 是必须的，不是装饰。
   * 默认 auto 时 Chrome 把触摸拖拽判成「页面滚动手势」，随即发出 pointercancel 中断拖拽
   * —— 实测手机上球**完全转不动**（HUD 经度纹丝不动），而且不报任何错。
   * 代价：球区域内滚不了页面，所以球高被限制在 56vh，球外留有充足的滚动区。
   * 顺带把双指捏合也接管过来做缩放（手机没有滚轮，否则移动端根本无法改视距）。
   */
  touch-action: none;
}

.globe-host:focus-visible {
  outline: 2px solid rgb(255 255 255 / 0.5);
  outline-offset: -2px;
}
</style>
