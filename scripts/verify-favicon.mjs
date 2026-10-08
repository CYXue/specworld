/**
 * favicon 产物的**独立实现对拍** —— 与 selftest 里的结构断言互补。
 *
 * ## 为什么需要它
 * 结构断言（深色占比 / 旋转对称 / 环闭合）验的是「参数等于规格」，
 * 抓不到两类失效：
 *   1. **画反了** —— 黑白整体颠倒，占比与形状全都不变；
 *   2. **鱼眼回来了** —— S 形曲线尾部在 32 网格上必然产生孤立像素凹口，
 *      「找小方块」这种形状猜测会把它误报成鱼眼（真实踩过）。
 *
 * 解法（用户级 MEMORY 的「判据双轨制」）：
 * A 轨= selftest.mjs 的结构断言，查参数；
 * B 轨 = 本文件，**从源 SVG 的几何重新算一遍**理想网格，逐格对拍，查「哪一侧」与「有没有多东西」。
 *
 * ## B 轨怎么独立
 * 源 SVG 的构成是**解析式**的，不需要真的渲染：
 *   外层 `<g transform="matrix(-1 0 0 1 1024 0)">` ←⚠️ 见下，必须先走完
 *   圆：cx=cy=512, r=512（满幅；镜像不改变它，落在镜像轴上）
 *   S 形 path：极坐标曲线 `r(θ)`，两个 180° 镜像的半圆弧连接上下极点
 *   鱼眼：cy=256 的黑点（半径 85.33）、cy=768 的白点（半径 85.33）
 * 本文件从**像素中心到圆心的极坐标**判定每格颜色 —— 与 puppeteer 渲染、
 * PIL 降采样、SVG 生成三条路径都无共享代码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUnlocked } from './lib/gates-lock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAVICON = path.join(ROOT, 'public/favicon.svg');
/** 源设计文件在**仓库外**（用户提供的 SVG），路径写死在本机。
 *  ⇒ 本脚本**不是 CI 闸门**，CI 只跑 `selftest.mjs` 与 `verify-favicon-gates.mjs`。 */
const SRC =
  process.env.FAV_SRC ||
  'C:/Users/EAWAC/WorkBuddy/2026-10-07-18-24-25/output/数学完美太极_逆版.svg';
const FRAC = 0.8;

if (process.argv[1] === fileURLToPath(import.meta.url) && !fs.existsSync(SRC)) {
  // ⚠️ 必须**响亮失败**（退出码 2），不能「跳过并返回 0」。
  // 「源文件不在 ⇒ 报告通过」是最典型的静默失效：绿灯会让人以为对拍跑过了。
  console.error(`❌ 找不到源 SVG：${SRC}\n   用 FAV_SRC=<路径> 指定，或改 SRC 常量。`);
  console.error('   本脚本依赖仓库外的源设计文件，因此不是 CI 闸门；');
  console.error('   CI 的 favicon 防线是 selftest.mjs + verify-favicon-gates.mjs。');
  process.exit(2);
}

// 反向测会原地改写 public/favicon.svg；那期间读它做对拍只会读到**中间态**，
// 并自信地报出一个错的数字（真实踩过：并行跑时「抓到 0 格」，单跑两条都对）。
// 拿不到锁 ⇒ 退出码 2 响亮失败，不降级成 warning。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertUnlocked('favicon 逐格对拍');
}

/** sRGB 相对亮度（0=黑 1=白）。只用于「谁该是深色」这一件事。 */
function luminance(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 从 SVG 文本还原 N×N 布尔网格（True = 墨色）。必须先剥注释。
 *
 * ## ⚠️⚠️ 连`fill` 一起读出来 —— 只读「哪些格被 rect 覆盖」抓不到「颜色写反」
 * 原实现只解析 rect 的几何，把`fill` 全丢了 ⇒ 把 ink 与 paper 两个色值对调后
 * 解析结果**一模一样**，闸门报「0 格不符」。
 * 而产物若真把两色写反，图标就是**负片**（深色鱼变浅、浅色鱼变深）。
 * selftest 当时也只查「有没有 theme 之外的颜色」，**没查谁拿哪个颜色** ⇒ 全绿放行。
 * 这条是反向测抓出来的，不是想出来的。
 *
 * ⇒ 返回`base`（满幅底板的fill）与 `runFills`（行内墨段的 fill 集合）。
 */
function faviconGrid(svg) {
  const body = svg.replace(/<!--[\s\S]*?-->/g, '');
  const n = Number(body.match(/viewBox="0 0 (\d+)/)?.[1]);
  if (!n) throw new Error('viewBox 不是 "0 0 N N"');
  const g = Array.from({ length: n }, () => new Array(n).fill(false));
  const runFills = new Set();
  for (const m of body.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1"[^>]*fill="(#[0-9a-fA-F]+)"/g)) {
    for (let i = 0; i < Number(m[3]); i++) g[Number(m[2])][Number(m[1]) + i] = true;
    runFills.add(m[4].toLowerCase());
  }
  // 满幅底板：没有 x/y 的那条
  const base = body.match(/<rect width="(\d+)" height="(\d+)" fill="(#[0-9a-fA-F]+)"/)?.[3]?.toLowerCase();
  return { n, g, base, runFills: [...runFills] };
}

/** 从源 SVG 解析出太极的 path 多边形（大圆弧展开为折线）。
 *
 *  ## ⚠️⚠️ 为什么是「多边形 + 非零环绕」而不是解析式
 *  曾两次试图用「两个半圆弧的并集」写解析式，都错了：
 *   - 第一次相位猜错（以为 S 按上/下半圆分，实际 S 从上极点**向左**扫）；
 *   - 第二次照着极坐标表硬猜左右半，24% 的格子对不上。
 *  两次的共同错误：**在复述一个答案里已经写好的结构**。
 *
 *  path 本身已经把答案给全了（1201 个采样点 + 1 段圆弧）。
 *  正确做法是把它当**多边形**，用非零环绕规则做点在内部测试 ——
 *  这是通用算法，不含任何关于「太极长什么样」的知识，
 *  因此对「画反了」是真正独立的判据。
 *
 *  尾段 `A 512,512 0 0 0 512,0` 是大圆的半弧：
 *  两端点距离 = 1024 = 2r ⇒ 圆心必为中点 (512,512)；
 *  sweep=0 ⇒ 角度递减 ⇒ 从底部 (0,+r) 递减到 (r,0) ⇒ **经右中点**。
 *  这两点必须算对，否则围出的区域整体差一个半圆。
 */
/** 两个仿射矩阵相乘：`m ∘ n`（先作用 n 再作用 m）。 */
function mulAffine(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * ## ⚠️⚠️⚠️ 必须走完 `<g transform>` —— 漏了它整张图左右镜像（真实踩过）
 * 源 SVG 把 circle / rect / path **全部**包在
 * `<g transform="matrix(-1 0 0 1 1024.0 0)">` 里，即以 x=512 为轴的水平镜像。
 *
 * 症状：解析式画出来的太极**形状、占比、深浅全对，唯独整幅左右翻转**，
 * 与产物逐格对拍报 **212 格（20.7%）不符，且漏黑 106 / 漏白 106 完全对称**
 * ——「对称的不符」正是镜像的指纹（若真是采样口径差，两侧不会这么整齐）。
 *
 * 为什么会漏：`<g>` 是**渲染器**的事，解析式实现直接读 `d="..."` 里的原始坐标，
 * 眼睛看到「path 就是 S 曲线」就以为拿到了最终坐标。
 * ⇒ **凡是从 SVG 反推几何，必须把变换链走完再当结论。**
 *
 * 这里**解析并合成**文件里出现的全部 `matrix(...)`（按文档顺序），
 * 而不是硬编码这一条 —— 源文件若换了变换，不能又悄悄错回镜像。
 * 镜像会翻转环绕方向，但非零环绕的判定只看 `!== 0`，故 `insidePolygon` 不受影响。
 */
function composedMatrix(t) {
  let m = [1, 0, 0, 1, 0, 0];
  for (const [, body] of t.matchAll(/transform="matrix\(([^)]+)\)"/g)) {
    const n = body.trim().split(/[\s,]+/).map(Number);
    if (n.length !== 6 || n.some((v) => !Number.isFinite(v))) {
      throw new Error(`matrix() 参数不是 6 个有限数：${body}`);
    }
    m = mulAffine(n, m);
  }
  return m;
}

function parseSource(text) {
  const t = text ?? fs.readFileSync(SRC, 'utf8');
  const M = composedMatrix(t);
  const apply = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  if (M.every((v, i) => v === [1, 0, 0, 1, 0, 0][i])) {
    console.warn('⚠️ 源 SVG 未找到任何 matrix 变换 —— 若产物是镜像渲染，本脚本会误报');
  }

  const big = t.match(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/);
  if (!big) throw new Error('源 SVG 里找不到大圆');
  const [cx, cy] = apply(Number(big[1]), Number(big[2]));
  const r = Number(big[3]); // matrix 只有平移+缩放时半径不变；本文件无缩放

  // 鱼眼：大圆之外的 circle（cy ≠大圆的 cy）
  const eyes = [...t.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"[^>]*fill="(#\w+)"[^>]*\/>/g)]
    .map((m) => {
      const [ex, ey] = apply(Number(m[1]), Number(m[2]));
      return { x: ex, cy: ey, r: Number(m[3]), fill: m[4] };
    })
    .filter((e) => Math.hypot(e.x - cx, e.cy - cy) > 1e-6);
  // 用「圆心与大圆圆心不同」来排除大圆本身 —— 比「r 不同」更稳（大圆 r 最大但不该写死）

  // path → 折线（含尾段圆弧展开）
  // ⚠️ 圆弧在**路径自身坐标系**里定义（rx=512、圆心为端点中点都是该系下的事实），
  //   所以先在原坐标系展开，最后再整体过一遍 `<g>` 变换 —— 顺序反了会得到错误的弧。
  const d = t.match(/<path d="([^"]+)"/)[1];
  const poly = [];
  let cursor = null;
  for (const seg of d.split(/(?=[MLAZ])/)) {
    if (!seg) continue;
    const cmd = seg[0];
    if (cmd === 'M' || cmd === 'L') {
      const m = seg.slice(1).match(/([-\d.]+),\s*([-\d.]+)/);
      cursor = [Number(m[1]), Number(m[2])];
      poly.push(cursor);
    } else if (cmd === 'A') {
      const m = seg.match(
        /A\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([01])[,\s]+([01])[,\s]+([-\d.]+)[,\s]+([-\d.]+)/,
      );
      if (!m) throw new Error(`圆弧段解析失败：${seg.slice(0, 60)}`);
      const [rx, , , , sweep, x1, y1] = [
        Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]),
        Number(m[5]), Number(m[6]), Number(m[7]),
      ];
      if (Math.abs(rx - r) > 1e-6) throw new Error('圆弧半径与大圆不一致，实现假设需重审');
      // 端点距离 = 2r ⇒ 半圆、圆心为中点
      const mx = (cursor[0] + x1) / 2;
      const my = (cursor[1] + y1) / 2;
      const a0 = Math.atan2(cursor[1] - my, cursor[0] - mx);
      const a1 = Math.atan2(y1 - my, x1 - mx);
      // sweep=1 角度递增、=0 递减；large=0 取劣弧（这里恰为半圆）
      let delta = a1 - a0;
      if (sweep === 1 && delta < 0) delta += Math.PI * 2;
      if (sweep === 0 && delta > 0) delta -= Math.PI * 2;
      const STEPS = Math.max(8, Math.ceil((Math.abs(delta) / (Math.PI / 2)) * 64));
      for (let i = 1; i <= STEPS; i++) {
        const a = a0 + (delta * i) / STEPS;
        poly.push([mx + rx * Math.cos(a), my + rx * Math.sin(a)]);
      }
      cursor = [x1, y1];
    }
  }
  if (poly.length > 1 && Math.hypot(poly[0][0] - poly.at(-1)[0], poly[0][1] - poly.at(-1)[1]) < 1e-6) {
    poly.pop(); // 闭合点重复
  }
  for (const p of poly) {
    const [qx, qy] = apply(p[0], p[1]);
    p[0] = qx;
    p[1] = qy;
  }
  return { cx, cy, r, eyes, poly, matrix: M };
}

/** 非零环绕规则的点在多边形内测试。通用算法，不含任何太极知识。 */
function insidePolygon(px, py, poly) {
  let winding = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi <= py) {
      if (yj > py && (xj - xi) * (py - yi) - (px - xi) * (yj - yi) > 0) winding++;
    } else if (yj <= py && (xj - xi) * (py - yi) - (px - xi) * (yj - yi) < 0) {
      winding--;
    }
  }
  return winding !== 0;
}

/**
 * 太极的**独立解析式**颜色判定：
 *   圆外 → null（底板）
 *   鱼眼（若保留） → 鱼眼自身色
 *   path 多边形内 → 白（path fill=#FFFFFF）
 *   否则 → 黑（大圆 fill=#000000）
 */
function idealAt(px, py, geo, keepEyes) {
  const d = Math.hypot(px - geo.cx, py - geo.cy);
  if (d > geo.r) return null;
  if (keepEyes) {
    for (const e of geo.eyes) {
      if (Math.hypot(px - e.x, py - e.cy) <= e.r) {
        return e.fill.toLowerCase() === '#000000' ? 'ink' : 'paper';
      }
    }
  }
  return insidePolygon(px, py, geo.poly) ? 'paper' : 'ink';
}

/**
 * 把一格内的解析式按**面积**投票，阈值与产物一致。
 *
 * ## ⚠️⚠️ 口径必须与产物一致，否则会「差一格」而误报
 * 产物（`_fav_grid.py`）的做法是 BOX 面积平均 + 0.5 阈值 = **面积多数表决**。
 * 若这里只取**格中心单点**的颜色，两者在每条边界上必然差一格。
 * ⇒ 判据与产物必须**同口径**：这里取 T×T 子采样算白占比，`> 0.5` 判白。
 * T=16（256 点/格）足够把边界格的判定误差压到远小于半格；
 * T 太小会引入量化噪声，太大只是白费时间，不必更大。
 *
 * ## ⚠️ 三态不能塌成两态
 * `idealAt` 对圆外返回 `null`（= 底板米白），不是 `'paper'`。
 * 漏判 `null` 就会把**整圈圆外留白**算成墨。
 */
function idealCell(x0, y0, size, geo, keepEyes) {
  let white = 0;
  let outside = 0;
  const T = 16;
  for (let sy = 0; sy < T; sy++) {
    for (let sx = 0; sx < T; sx++) {
      const w = idealAt(x0 + ((sx + 0.5) / T) * size, y0 + ((sy + 0.5) / T) * size, geo, keepEyes);
      if (w === null) outside++;
      else if (w === 'paper') white++;
    }
  }
  const n = T * T;
  // 圆占多数 ⇒ 整格算圆内，按黑白面积比；否则算留白
  if (outside > n / 2) return null;
  return white > (n - outside) / 2 ? 'paper' : 'ink';
}

/**
 * 逐格对拍，返回差异清单。
 *
 *  ## 环的处理
 *  产物在圆周额外加了一圈墨色环（见 public/favicon.svg 文档 §二，
 *  没有它白鱼就与米白底板同色而消失）。环带判据 =「圆周穿过的格」
 *  （9 点采样内外混合），与 `_fav_grid.py` 同一判据 —— 两处必须一致，
 *  否则环带宽度不同 ⇒ 对拍把环算进鱼身、或把鱼身算进环 ⇒ 整片误报。
 *
 *  ## 映射比例
 *  网格宽 n，圆直径 = FRAC×n ⇒ 源 SVG 的 1024 单位对应 FRAC×n 网格像素
 *  ⇒ `scale = 1024 / (FRAC × n)`，**不是** `1/(FRAC×n/1024)`。
 *  写反会让整张图错位 22%，而错位图看起来仍像太极 ⇒ 不易发现。
 *
 *  ## 可注入的文本
 *  `srcText` / `faviconText` 供反向测在内存里造故障，不落临时文件。
 */
function compare({
  keepEyes = false,
  verbose = false,
  srcText = null,
  faviconText = null,
} = {}) {
  const geo = parseSource(srcText);
  const { n, g, base, runFills } = faviconGrid(faviconText ?? fs.readFileSync(FAVICON, 'utf8'));
  const rPix = (FRAC * n) / 2;
  const scale = 1024 / (FRAC * n);
  const cell = scale; // 一格对应多少源单位
  const PTS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]];
  const diffs = [];

  // ── 颜色语义：底板必须是亮的，行内段必须是暗的 ─────────────────────
  //按**亮度**判定，不读 style.css —— 这样即便项目改了配色，判据依然独立。
  if (!base) diffs.push({ x: -1, y: -1, want: '有满幅底板', got: '无', why: '缺底板' });
  else if (luminance(base) <= 0.5) {
    diffs.push({ x: -1, y: -1, want: '底板=亮色', got: base, why: '底板偏暗（两色写反？）' });
  }
  for (const f of runFills) {
    if (luminance(f) >= 0.5) {
      diffs.push({ x: -1, y: -1, want: '墨段=暗色', got: f, why: '墨段偏亮（两色写反？）' });
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const got = g[y][x] ? 'ink' : 'paper';
      // 环带判据（与 _fav_grid.py 一致）：圆周穿过该格
      let ins = 0;
      for (const [qx, qy] of PTS) {
        const dx = x + qx / 2 - n / 2;
        const dy = y + qy / 2 - n / 2;
        if (dx * dx + dy * dy <= rPix * rPix) ins++;
      }
      if (ins > 0 && ins < 9) {
        if (got !== 'ink') diffs.push({ x, y, want: 'ink(环)', got, why: '环缺失' });
        continue;
      }
      const sx = (x - n / 2) * scale + 512;
      const sy = (y - n / 2) * scale + 512;
      const want = idealCell(sx, sy, cell, geo, keepEyes);
      if (want === null) {
        if (got !== 'paper') diffs.push({ x, y, want: 'paper(留白)', got, why: '圆外却有墨' });
      } else if (want !== got) {
        diffs.push({ x, y, want, got, why: want === 'ink' ? '漏黑' : '漏白' });
      }
    }
  }
  if (verbose) {
    for (let y = 0; y < n; y++) {
      let a = '';
      let b = '';
      for (let x = 0; x < n; x++) {
        const w = idealCell((x - n / 2) * scale + 512, (y - n / 2) * scale + 512, cell, geo, keepEyes);
        a += w === null ? '.' : w === 'ink' ? '#' : 'o';
        b += g[y][x] ? '#' : '.';
      }
      console.log(`${String(y).padStart(2)} ${a} | ${b}`);
    }
  }
  return { n, diffs, total: n * n, matrix: geo.matrix };
}

/**
 * ## 闸门必须**反向测** —— 且不止一条失败路径
 * 「当前合规态通过」只证明它**不误报**，证明不了它**能拦住**。
 * 每条故障注入都必须先被抓住，这个脚本才算有资格给出 ✅。
 *
 * 五条注入分别覆盖五类真实失效（缺一条就少一类防线）：
 * | 注入 | 对应的真实事故 |
 * |---|---|
 * | 源去掉 `<g transform>` | 左右镜像（本脚本自己踩过，212 格） |
 * | 产物黑白整体颠倒 | 「画反了」—— 结构断言全 PASS，只有对拍能抓 |
 * | 产物挖掉环的一段 | 环断裂 ⇒ 白鱼漏进底板 |
 * | 产物挖掉鱼身一格 | 单格退化 |
 * | `--eyes` 打开 | 鱼眼回来了（产物无鱼眼 ⇒ 必须报不符） |
 *
 * ⚠️ 最后一条是**死代码探测**：若 `keepEyes` 分支被改成恒等，它会静默失效，
 * 而正向对拍仍然全绿 —— 只有拿「预期不符」当断言才抓得住。
 */
function gateSelfTest() {
  const fav = fs.readFileSync(FAVICON, 'utf8');
  const body = fav.replace(/<!--[\s\S]*?-->/g, '');
  const src = fs.readFileSync(SRC, 'utf8');

  const CASES = [
    {
      name: '源去掉 <g transform> ⇒ 镜像',
      opts: { srcText: src.replace(/\s*transform="matrix\([^)]*\)"/g, '') },
      min: 100,
    },
    {
      name: '产物黑白整体颠倒',
      // ⚠️ 必须走**占位符**：直接 `#12151f→#fffaf0` 再 `#fffaf0→#12151f`
      // 会把上一轮刚写进去的又换回来，净效果为零 —— 注入自己失效，
      // 闸门报「抓不住」看起来像闸门的锅，其实是注入的锅。
      // **注入失败与闸门失败必须能区分开**，否则反向测会自我误导。
      opts: {
        faviconText: body
          .replace(/#12151f/g, '#__A__')
          .replace(/#fffaf0/g, '#12151f')
          .replace(/#__A__/g, '#fffaf0'),
      },
      // 判据按**亮度**判语义，故这是 2 条（底板偏暗 + 墨段偏亮），不是逐格差异
      min: 2,
    },
    {
      name: '产物挖掉环的第一段（环断裂）',
      opts: { faviconText: body.replace(/<rect x="\d+" y="3" width="\d+" height="1"[^>]*\/>/, '') },
      min: 1,
    },
    {
      name: '产物挖掉鱼身一格（格 (16,16)）',
      opts: {
        faviconText: body.replace(
          /<rect x="(\d+)" y="16" width="(\d+)" height="1"/,
          (m, x, w) => `<rect x="${x}" y="16" width="${Number(w) - 1}" height="1"`,
        ),
      },
      min: 1,
    },
    { name: '打开鱼眼（产物无鱼眼 ⇒ 应报不符）', opts: { keepEyes: true }, min: 1 },
  ];

  const rows = [];
  let failed = 0;
  for (const c of CASES) {
    const { diffs } = compare(c.opts);
    const caught = diffs.length >= c.min;
    if (!caught) failed++;
    rows.push(`  ${caught ? '✅' : '❌'} ${c.name}：抓到 ${diffs.length} 格（要求 ≥${c.min}）`);
  }
  return { rows, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const eyeMode = process.argv.includes('--eyes');
  const { n, diffs, total, matrix } = compare({
    keepEyes: eyeMode,
    verbose: process.argv.includes('--print'),
  });
  const rate = ((diffs.length / total) * 100).toFixed(1);
  console.log(`\n源矩阵 [${matrix.map((v) => +v.toFixed(4)).join(' ')}]`);
  console.log(`对拍：${n}×${n} = ${total} 格，不一致 ${diffs.length} 格 (${rate}%)  鱼眼=${eyeMode ? '保留' : '已去'}`);
  if (diffs.length) {
    const byWhy = {};
    for (const d of diffs) byWhy[d.why] = (byWhy[d.why] ?? 0) + 1;
    console.log('分类：', byWhy);
    console.log(
      '前 12处：',
      diffs
        .slice(0, 12)
        .map((d) => (d.x < 0 ? `【${d.why}: ${d.got}】` : `(${d.x},${d.y})${d.why}`))
        .join(' '),
    );
    process.exit(1);
  }

  console.log('\n闸门反向测：');
  const { rows, failed } = gateSelfTest();
  for (const r of rows) console.log(r);
  if (failed) {
    console.log(`❌ 反向测失败 ${failed} 条 —— 这个闸门抓不住故障，不能信任它`);
    process.exit(1);
  }
  console.log('\n✅ 逐格与源 SVG 的解析式完全一致，且五条故障注入全部被抓到');
}

export { faviconGrid, parseSource, insidePolygon, idealAt, idealCell, luminance, compare, gateSelfTest };