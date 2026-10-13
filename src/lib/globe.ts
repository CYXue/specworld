/**
 * 球面画布的几何 —— 纯函数，**零 import**。理由同 board.ts：
 * 零依赖才能被 scripts/selftest.mjs 直接 import，护栏才罩得住。
 *
 * 这是**真球面**，不是平面密铺
 * --------------------------
 * 设备贴在半径 R 的球壳上，拖动 = 转球（改相机经纬度），内容从视野一侧
 * 转到另一侧，绕完整圈回到原位 —— 像转地球仪，永远不出现「边界」。
 * 这与 board.ts（环面回绕）是两套几何，结论不能互相套用。
 *
 * 循环是怎么保证的
 * ----------------
 * 相机经度是**模 360 的**，normalizeLon() 把它绕回 [0, 360)。
 * 于是 lon 从 0 转到 360 时画面精确复原 —— 不是「看起来差不多」，
 * 而是同一批设备回到同一批屏幕位置。这是循环效果能成立的前提，
 * 也是自测要盯死的一条（转 360 度后逐点比坐标）。
 *
 * 坐标系（两套，别混）
 * --------------------
 *   球面坐标：设备固定在球壳上的 (lat, lon)，度。lat 北正南负，lon 东正。
 *   相机系：旋转后的 (x, y, z)，球心为原点，**z 指向观者**。
 *   屏幕：像素，透视投影得出。
 *
 * 为什么相机用经纬度而不是欧拉角
 * ------------------------------
 * 经纬度把「哪些设备在背面」变成一次 z 分量读取，天然没有万向锁，
 * 且绕圈后精确复原。欧拉角在极点附近会抖，且很难保证「转一圈等于没转」。
 *
 * 旋转与投影的推导（改这里之前先读完）
 * ------------------------------------
 * 相机方向单位向量 c = (sin(lon)cos(lat), sin(lat), cos(lon)cos(lat))。
 * 要把 c 转到 +z 轴（相机系里相机看向 -z、球心在原点）：
 *   ① rotY(-lon)：c → (0, sin(lat), cos(lat))
 *   ② rotX(lat) ：c → (0, 0, 1)                       ← 正对相机
 * 顺序不能反，反了会在高纬度处整体偏斜。
 *
 * 投影：相机在相机系 (0, 0, dist)，球壳点 Q：
 *   屏幕 x = cx + Q.x * f / (dist - Q.z)
 *   屏幕 y = cy - Q.y * f / (dist - Q.z)      （屏幕 y 向下，故取负）
 * 分母 dist - Q.z 是「到相机的深度」：Q.z 越大越近 → 投影越大（近大远小）。
 * ⚠️ 必须保证 dist > R 恒成立，否则分母会过零或变负，
 *   投影会翻到屏幕另一侧（表现为「转着转着设备突然镜像」）。
 *   所以 DIST_MIN 恒大于 R，且 zoomDist 夹紧后不许越过这条线。
 */

// ── 常量 ──

interface Viewport3 {
  w: number;
  h: number;
}

export interface Camera3 {
  /** 相机所在经度（度），模 360 */
  lon: number;
  /** 相机所在纬度（度），钳在 ±LAT_LIMIT */
  lat: number;
  /** 相机到球心的距离（世界单位），恒大于 R */
  dist: number;
}

interface SpherePoint {
  /** 纬度（度），北正 */
  lat: number;
  /** 经度（度） */
  lon: number;
}

export interface Projected {
  /** 屏幕坐标 */
  x: number;
  y: number;
  /** 相对尺寸：1 = 位于球心深度处 */
  scale: number;
  /** 深度 [-1, 1]：1 正对观者，-1 完全在背面 */
  depth: number;
  /** 不透明度 */
  opacity: number;
}

/** 球半径。固定为 1，所有距离都以此为基准，改它等于整体换单位 */
export const R = 1;
/** 相机距离范围。下限必须 > R，否则透视分母过零 */
export const DIST_MIN = 1.55;
export const DIST_MAX = 6;
export const DIST_DEFAULT = 2.8;
/** 纬度上限：到 ±90 时经线汇聚成一点，画面会突然翻转 */
export const LAT_LIMIT = 85;
/** 自动自转速度（度/秒）。「一直在循环」的直观体现，约 60 秒一圈 */
export const AUTO_SPIN_DPS = 6;
/** 球体占视口高度的比例（赤道处） */
const FIT_RATIO = 0.42;
/** 背面设备的最低不透明度：0 就是实心球（背面看不见），此处取线框球口径 */
const BACK_OPACITY = 0.22;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const GOLDEN = Math.PI * (1 + Math.sqrt(5));

// ── 球面分布 ──

/**
 * Fibonacci 球面分布：把 i 均匀撒在球壳上。
 * 用 (i + 0.5) 而不是 i，是为了避开正好落在南北极 —— 极点处经度无意义，
 * 两台设备会叠在一起（表现为「球顶少了一台」）。
 */
function fiboPoint(i: number, n: number): SpherePoint {
  const phi = Math.acos(1 - (2 * (i + 0.5)) / n); // 极角 0..π
  const theta = GOLDEN * i;
  return {
    lat: 90 - phi * RAD,
    lon: normalizeLon(theta * RAD),
  };
}

/**
 * 按 count 铺满球面。groups 给出分段（如 [47, 13]），
 * 分段之间沿**纬度带**依次排开 —— 因为 Fibonacci 的 index 与纬度线性相关，
 * 所以「前 47 台」自然占北半球+赤道、「后 13 台」占南半球，
 * 品牌分区因此不需要额外的几何代码。
 */
export function spherePoints(count: number, groups: number[] = []): SpherePoint[] {
  if (count <= 0) return [];
  const segs = groups.length ? groups.filter((n) => n > 0) : [count];
  const total = segs.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const out: SpherePoint[] = [];
  let i = 0;
  for (const n of segs) {
    for (let j = 0; j < n && out.length < count; j++) {
      out.push(fiboPoint(i, total));
      i++;
    }
  }
  return out;
}

// ── 旋转 ──

export function clampLat(lat: number): number {
  if (Number.isNaN(lat)) return 0;
  return Math.min(LAT_LIMIT, Math.max(-LAT_LIMIT, lat));
}

export function clampDist(d: number): number {
  // NaN / ±Infinity 必须三者分开判（clampZoom 当年踩过同一个坑）：
  // 写成 !isFinite → 默认值 会把溢出算出的 Infinity 当成「距离未知」跳回默认。
  if (Number.isNaN(d)) return DIST_DEFAULT;
  if (d === Infinity) return DIST_MAX;
  if (d === -Infinity) return DIST_MIN;
  return Math.min(DIST_MAX, Math.max(DIST_MIN, d));
}

/** 经度绕回 [0, 360)。循环的地基 —— 转满一圈必须回到同一个数 */
export function normalizeLon(lon: number): number {
  if (Number.isNaN(lon)) return 0;
  return ((lon % 360) + 360) % 360;
}

export function rotateBy(cam: Camera3, dLon: number, dLat: number): Camera3 {
  return {
    lon: normalizeLon(cam.lon + dLon),
    lat: clampLat(cam.lat + dLat),
    dist: cam.dist,
  };
}

/** 改视距。factor < 1 拉近（dist 变小），> 1 拉远 */
export function zoomDist(cam: Camera3, factor: number): Camera3 {
  return { ...cam, dist: clampDist(cam.dist * factor) };
}

/**
 * 双指捏合的缩放系数：张开（两指距离变大）→ 拉近（< 1），捏拢 → 推远（> 1）。
 *
 * 抽成纯函数是为了能被自测覆盖 —— 这里有除零与 NaN 的口子：
 * 手指刚落下时距离可能是 0，两个点重合时 hypot 也可能给 0。
 * 系数再夹在 [0.5, 2]：单帧内手指跳变（或 CDP 模拟的大步长）不该让球瞬移。
 */
export function pinchFactor(prevDist: number, dist: number): number {
  // NaN / ±Infinity / 0 一律「不改视距」。注意不能只判 > 0：
  // Infinity > 0 成立，100 / Infinity = 0 会被夹成 0.5，等于一次瞬移到最近。
  if (!Number.isFinite(prevDist) || !Number.isFinite(dist)) return 1;
  if (prevDist <= 0 || dist <= 0) return 1;
  const k = prevDist / dist;
  return Math.min(2, Math.max(0.5, k));
}

// ── 投影 ──

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 球面点 → 单位向量 */
function toVec(p: SpherePoint): Vec3 {
  const la = p.lat * DEG;
  const lo = p.lon * DEG;
  return { x: Math.cos(la) * Math.sin(lo), y: Math.sin(la), z: Math.cos(la) * Math.cos(lo) };
}

function rotY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

function rotX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

/**
 * 球面点 → 相机系坐标。顺序是 rotY(-lon) 再 rotX(lat)，
 * 反了会在高纬度处整体偏斜（推导见文件头）。
 */
function toCameraSpace(p: SpherePoint, cam: Camera3): Vec3 {
  return rotX(rotY(toVec(p), -cam.lon * DEG), cam.lat * DEG);
}

/** 焦距（px）：让赤道处的球面点落在视口高度的 FIT_RATIO 处 */
function focal(cam: Camera3, vp: Viewport3): number {
  return (Math.min(vp.w, vp.h) * FIT_RATIO * cam.dist) / R;
}

/** 球体在屏幕上的轮廓半径（px）。正球任何角度的轮廓都是圆，这个是精确值 */
export function globeRadiusPx(cam: Camera3, vp: Viewport3): number {
  const f = focal(cam, vp);
  const d2 = cam.dist * cam.dist - R * R;
  if (!(d2 > 0)) return f;
  return (f * R) / Math.sqrt(d2);
}

/** 深度 → 不透明度。线框球口径：背面仍可见，只是变暗 */
export function depthOpacity(depth: number): number {
  const t = Math.min(1, Math.max(-1, depth));
  return BACK_OPACITY + (1 - BACK_OPACITY) * ((t + 1) / 2);
}

/**
 * 把球面点投影到屏幕。
 *
 * 分母夹紧到 EPS 而不是直接返回 null：相机距离恒大于 R，理论上分母恒正，
 * 但浮点误差 + dist 被外部改到临界值时可能擦到 0，那时 scale 会炸成天文数字，
 * 一个设备铺满全屏。夹紧后退化成「贴着相机」，比整屏白块好排查。
 */
export function project(p: SpherePoint, cam: Camera3, vp: Viewport3): Projected {
  const v = toCameraSpace(p, cam);
  const z = v.z * R;
  const denom = Math.max(1e-3, cam.dist - z);
  const f = focal(cam, vp);
  const k = f / denom;
  const depth = v.z; // 单位向量 → 天然在 [-1, 1]
  return {
    x: vp.w / 2 + v.x * R * k,
    y: vp.h / 2 - v.y * R * k,
    scale: cam.dist / denom,
    depth,
    opacity: depthOpacity(depth),
  };
}

/** 按深度排序用的比较器：depth 大的在后（画在上层） */
export function byDepth(a: { depth: number }, b: { depth: number }): number {
  return a.depth - b.depth;
}
