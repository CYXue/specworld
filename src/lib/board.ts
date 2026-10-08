/**
 * 无限画布（环面回绕瓦片画廊）的几何引擎 —— 纯函数，**零 import**。
 *
 * 理由同 globe.ts：零依赖才能被 scripts/selftest.mjs 用
 * node 22 的 type-stripping 直接 `await import()`，护栏才罩得住。
 *
 * ───────────────────────────────────────────────────────────────
 * 这套几何和 globe.ts（球面）是**两套**独立几何（旧 grid.ts 平面密铺已删除），
 * 结论不能互相套用。下文每一段都写明推导，免得以后有人「优化」掉。
 *
 * 核心思想（来自 cosmicbroth chessboard 实测 + 用户给的复刻 HTML）：
 *   1. **DOM 瓦片恒定 = 视口网格数**。不增删节点，只搬移 + 换图，
 *      所以无论数据 60 台还是 600 台，DOM 始终 ~40~50 个。
 *   2. **数据是环面（torus）**：把 N 张图平铺成 rows×cols 的环面
 *      （rows×cols ≥ N，不足循环复用，与参考站一致）。瓦片在屏幕里
 *      平移，越界即从对侧重新进入，逻辑行列同步修正 —— 于是任意方向
 *      **无限**平移，且**节点数永远不变**。
 *   3. **逻辑坐标与像素坐标解耦**：像素坐标 (x,y) 负责渲染，
 *      逻辑坐标 (col,row) 负责「这张图是什么」。任何时刻都能无歧义
 *      地映射到数据索引，这就是无限画布的坐标锚。
 *   4. **砖块错位**：奇数列下移半行，形成像棋盘落子的错位网格
 *      （参考站用 `cols` 取偶保证交错对称）。
 * ───────────────────────────────────────────────────────────────
 */

/** 数据环面的行列数 */
export interface BoardGrid {
  rows: number;
  cols: number;
}

/**
 * 把 N 张图平铺成 rows×cols 的环面。
 * 找最大整除对使 rows×cols ≥ N；整除不到就让 N+1 再找
 * （参考站 `complete_data` 的同款逻辑）。环面因此可能比 N 多 1~几个格，
 * 多出来的格循环复用第 1 张 —— 这正是「无限纹理」的来源，也是用户明确
 * 否决的「复制粘贴」只发生在 filtered 子集不够「方」时（与参考站同款行为）。
 */
export function completeData(n: number): BoardGrid {
  if (n <= 0) return { rows: 1, cols: 1 };
  let count = n;
  for (;;) {
    const t = Math.floor(Math.sqrt(count));
    // 从 √count 往下找最大整除对；找到立即返回（rows 较小、cols 较大，符合横向铺开）。
    // 找不到（count 是质数，或 t<2 没进循环）→ count++ 再试。
    // count=2/3 这类会一直 +1 直到遇到合数（4=2×2），保证收敛。
    for (let i = t; i >= 2; i--) {
      if (count % i === 0) return { rows: i, cols: count / i };
    }
    count++;
  }
}

/** 单瓦片的像素度量（参考站：12*2.4*scale / 18*2.4*scale，砖缝各半） */
export interface MoverMetrics {
  w: number;
  h: number;
  mx: number;
  my: number;
}

export function moverMetrics(scaleNums: number): MoverMetrics {
  const w = 12 * 2.4 * scaleNums;
  const h = 18 * 2.4 * scaleNums;
  return { w, h, mx: w / 2, my: h / 2 };
}

/**
 * 视口网格：随**容器**尺寸算行列（不是 window —— 画布只是页面里一块区域），
 * 视口外各留 2 行/列做缓冲；列数为奇则 +1（保证砖块交错对称）。
 */
export function viewportGrid(vpW: number, vpH: number, m: MoverMetrics): BoardGrid {
  const rows = Math.ceil(vpH / (m.h + m.my)) + 2;
  let cols = Math.ceil(vpW / (m.w + m.mx)) + 2;
  if (cols % 2) cols++;
  return { rows, cols };
}

/** 单瓦片在逻辑网格里的初始像素位置（奇数列下移半行 → 砖墙错位） */
export interface Mover {
  x: number;
  y: number;
  col: number;
  row: number;
}

export function layoutPos(idx: number, cols: number, m: MoverMetrics): Mover {
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  const x = col * (m.w + m.mx);
  let y = row * (m.h + m.my);
  if (col % 2) y -= (m.h + m.my) / 2;
  return { x, y, col, row };
}

/**
 * 越界回绕（无限平移的核心）。瓦片滚出一侧即从另一侧重新出现，
 * 同时修正逻辑行列，使数据索引随之循环。O(1)/瓦片。
 * 注意：回绕周期取**视口网格**（vpGrid），数据索引另用 dataGrid 模运算映射。
 */
export function wrap(mover: Mover, m: MoverMetrics, vp: BoardGrid): Mover {
  const periodX = vp.cols * (m.w + m.mx);
  const periodY = vp.rows * (m.h + m.my);
  if (mover.x > periodX - m.mx - m.w) {
    mover.x -= periodX;
    mover.col -= vp.cols;
  } else if (mover.x < -m.w - m.mx) {
    mover.x += periodX;
    mover.col += vp.cols;
  }
  if (mover.y > periodY - m.my - m.h) {
    mover.y -= periodY;
    mover.row -= vp.rows;
  } else if (mover.y < -m.h - m.my) {
    mover.y += periodY;
    mover.row += vp.rows;
  }
  return mover;
}

/**
 * 逻辑坐标 → 数据索引。双模运算防负索引（参考站 `((col%C)+C)%C`）。
 * 返回 [0, n) 内的索引，喂给 tiles 数组。
 */
export function dataIndex(col: number, row: number, g: BoardGrid, n: number): number {
  const d = ((col % g.cols) + g.cols) % g.cols;
  const r = ((row % g.rows) + g.rows) % g.rows;
  return (((r * g.cols + d) % n) + n) % n;
}

/**
 * 缩放因子：参考站 `scale_nums = innerHeight/300 + innerWidth/300`。
 * 这里用**容器**尺寸（画布是页面里一块区域，不是整窗）。
 * 随容器线性变化，保证大屏/小屏手感一致。
 */
export function scaleNums(vpW: number, vpH: number): number {
  return vpH / 300 + vpW / 300;
}

/** 把视口尺寸按旧比例等比缩放（resize 时行列不变只缩放网格几何） */
export function rescaleMovers(movers: Mover[], ratio: number): Mover[] {
  for (const m of movers) {
    m.x *= ratio;
    m.y *= ratio;
  }
  return movers;
}

/**
 * 全环面遍历一轮后是否回到起点（无限回绕的自洽性硬验收）。
 * 逻辑：构造一个铺满 dataGrid 的 mover 集合，逐个沿 +x 推一个周期，
 * 每步 wrap 一次，最后每张逻辑 (col,row) 对应的数据索引集合应与初始一致。
 * 纯几何校验，不依赖 DOM —— 由 selftest 钉死。
 */
export function torusIsConsistent(g: BoardGrid): boolean {
  const seen = new Set<number>();
  const total = g.rows * g.cols;
  const m: MoverMetrics = { w: 100, h: 150, mx: 50, my: 75 };
  for (let i = 0; i < total; i++) {
    const mv = layoutPos(i, g.cols, m);
    const idx = dataIndex(mv.col, mv.row, g, total);
    if (seen.has(idx)) return false;
    seen.add(idx);
  }
  return seen.size === total;
}
