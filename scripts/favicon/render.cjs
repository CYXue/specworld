/**
 * 从**源 SVG** 渲染太极（无背景），定位太极圆，裁剪 + 降采样成 N×N 网格。
 *
 * ## 一、⚠️ 源 PNG 与源 SVG 不是同一份设计 —— 别拿 PNG 的构图理解 SVG
 * 同名的两个文件内容完全不同（实测）：
 *
 * | 文件 | 构图 |
 * |---|---|
 * | `数学完美太极_逆版.png` | 太极**居中、直径约占画幅 1/3**，四周是左黑右白对半背景 |
 * | `数学完美太极_逆版.svg` | 太极**满幅**（`circle r=512` 正好切满 1024 viewBox），**没有背景** |
 *
 * ⇒ 用户看 PNG 说「太极居中 + 左右黑白对半背景」，而 SVG 里根本没有背景。
 * 这个错位造成过一次真实故障：把裁剪窗开到直径的 1.25 倍（想留 10% 边），
 * 超出 `viewBox` 的区域露出的是**背景的黑白矩形** ⇒ favicon 左上/左下角
 * 凭空多出黑块（用户截图里能直接看到）。**裁剪前必须先删掉背景 rect。**
 *
 * ## 二、所以正确流程是「删背景 → 定位圆 → 按 FRAC 裁」
 * 1. 删掉两个背景 `<rect>`（`x=-512` 白 / `x=512` 黑，注意父 `<g>` 带 x 镜像）；
 * 2. 页面底色 = 米白（parchment-lit），圆外即留白 —— 这才是用户要的那圈边；
 * 3. 「渲染两份求差」定位圆的精确外接方框（不依赖任何几何推断）；
 * 4. 以圆心为中心、边长 = 直径/FRAC 裁剪。
 *
 * ## 三、⚠️⚠️ 定位用的合成 ≠ 出图用的合成 —— 删背景会让差分「瞎掉」
 * 差分是拿 A 与 B 逐像素比亮度差。删掉背景后：
 * - B（空图）渲染出来是**米白** `#fffaf0`（亮度 0.98）；
 * - A 里**白色的 S 形 path**亮度 1.0，与米白只差 **0.02**；
 * - 判定阈值是 0.08 ⇒ **所有白色部分全部被判为「无差异」**。
 * 结果差分只剩黑色，量到的是**黑区外接框**而不是圆：
 * 实测 bbox 横向只到 1535、纵向到 2047（非正方形），
 * 而真圆是 0..2047 正方形（上一轮保留背景时量到的正是这个）。
 *
 * ⇒ **两条合成必须分开**：
 * | 用途 | 背景 | 差分基准 | 量到的是 |
 * |---|---|---|---|
 * | 定位（仅此一处保留背景） | 保留 | 左黑右白 ⇒ 黑白都差异 | 圆 |
 * | 出图（裁剪+降采样） | **删掉**，页面米白 | 不做差分 | 圆 + 米白留白 |
 * 这不是「两份代码重复」，是**同一图在两种测量下的可见性不同** ——
 * 判据与产物必须各自用对自己可见的那份渲染。
 *
 *
 * ## 四、⚠️ 定位圆必须「渲染两份求差」，不能手算（踩过两次）
 * 手算裁剪框错了两轮：
 *  1. 先把 PNG 实测半径按比例换算到 SVG 坐标系当圆心 —— 错，
 *     **PNG 与 SVG 不是同一张图**（见上一节）。
 *  2. 再用「竖直中线过零点」推出半径 341 —— 那个 341 是**白色 S 形 path 的边界**，
 *     不是黑色圆的真边界（大圆 `r=512` 是满幅的）。按它裁 ⇒ 圆心偏出画面约 28%，
 *     实测「无任何对称性」才暴露。
 *
 * 现在改成**差分定位**，不依赖任何几何推断：
 *   A = 太极圆 + S 形 path（+ 可选鱼眼）
 *   B = 空（圆、path、背景全删掉）⇒ 渲染出纯米白
 *   A≠B 的像素集合 = 太极图形的精确外接方框。
 * 圆心、半径、裁剪框全部由渲染结果自证。
 *
 * ## 五、为什么截图与降采样要分两段
 * canvas `drawImage` 只吃 img/canvas/svg/video/ImageBitmap，**不吃 div**（TypeError），
 * 而裁剪必须靠 DOM 的 `overflow:hidden`。⇒ 截图（puppeteer）与
 * BOX 降采样（PIL，在 scripts/favicon/grid.py）天然分两段。
 *
 * 用法（工作目录 = 仓库根）：
 *   FAV_FRAC=0.8 FAV_EYES=0 node scripts/favicon/render.cjs   # 渲染 → 差分定位 → 裁剪截图
 *   python scripts/favicon/grid.py --scheme=ring 32# → _work/favicon/taiji-32.svg
 *
 * 中间产物落在 `_work/favicon/`（已gitignore）：`_shot.png`（640×640裁剪截图）+ `meta.json`。
 * **`meta.json` 是圆几何的唯一真源**，`grid.py` 直接读它 —— 判据与产物同源，不重新目测。
 *
 * ⚠️ `FAV_SRC` 指向**仓库外**的源设计文件（用户提供的 SVG），默认路径写死在本机。
 *   CI 拿不到它 ⇒ 本脚本与 `scripts/verify-favicon.mjs` **都不是 CI 闸门**，
 *   CI 只跑 `scripts/selftest.mjs`（含 7 条 favicon 结构/手性判据 + 反向测）。
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SRC =
  process.env.FAV_SRC ||
  'C:/Users/EAWAC/WorkBuddy/2026-10-07-18-24-25/output/数学完美太极_逆版.svg';

const SVG_SIZE = 1024;
const KEEP_EYES = process.env.FAV_EYES === '1'; // 默认去鱼眼
const FRAC = Number(process.env.FAV_FRAC || 0.8); // 太极直径占画幅比例
const SS = 640; // 裁剪窗口的超采样截图边长
const PAPER = '#fffaf0'; // --color-parchment-lit，留白用它
const WORK = '_work/favicon'; // 中间产物目录（gitignored）

/** 拆出源 SVG 的各个元素，按需删改。
 *
 *  ⚠️ `bg` 是给**定位**用的（见 §三）：只有保留左黑右白的背景，
 *  白色 S 形才与基准有足够亮度差。**出图必须 bg:false**，否则会露出背景色块。
 */
function buildSvg({ bg, withFigure, withEyes }) {
  let t = fs.readFileSync(SRC, 'utf8');

  if (!bg) t = t.replace(/<rect[^>]*\/>/g, '');

  if (!withFigure) {
    // 只剩背景（或空）⇒ 渲染出背景色 / 页面底色，用作差分的基准
    t = t.replace(/<circle[^>]*\/>/g, '').replace(/<path[^>]*\/>/g, '');
  } else if (!withEyes) {
    // 两个鱼眼：cy=256 的黑点、cy=768 的白点
    t = t.replace(/<circle[^>]*cy="256\.0"[^>]*\/>/g, '');
    t = t.replace(/<circle[^>]*cy="768\.0"[^>]*\/>/g, '');
  }
  return t.replace('<svg ', '<svg style="display:block" ');
}

(async () => {
  // 定位用：保留背景（§三）
  const svgA = buildSvg({ bg: true, withFigure: true, withEyes: KEEP_EYES });
  const svgB = buildSvg({ bg: true, withFigure: false, withEyes: KEEP_EYES });
  // 出图用：删掉背景，页面米白 ⇒ 圆外是干净留白
  const svgOut = buildSvg({ bg: false, withFigure: true, withEyes: KEEP_EYES });
  const sizes = process.argv.slice(2).map(Number).filter(Boolean);
  const list = sizes.length ? sizes : [16, 20, 24, 32, 40];

  const b = await puppeteer.launch({
    executablePath: EXE,
    args: ['--no-sandbox'],
    protocolTimeout: 240000,
  });

  const R = 2048; // 2× 超采样渲染全画幅，定位更精确

  async function render(svg) {
    // ⚠️ 每次用**独立 page**。共用一个 page 反复 setContent 时，
    // waitForFunction 的 `getElementById('s')` 可能命中**上一轮已被替换、
    // 尚未重新 decode** 的旧节点 ⇒ 第二次拿到的是第一次的内容，
    // A、B 完全相同 ⇒ 差分 bbox 退化成空（实测 bbox 全是初始值）。
    // 这类「静默拿到旧值」和缓存 bug 同一类：结果错，但零报错。
    const pg = await b.newPage();
    await pg.setViewport({ width: R, height: R, deviceScaleFactor: 1 });
    // 用内容哈希当标记，断言「我等的正是这一张图」，杜绝命中旧节点
    const key = svg.length + ':' + svg.slice(600, 660);
    await pg.setContent(
      `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${PAPER}">` +
        `<img id="s" data-key="${key}" width="${R}" height="${R}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">` +
        `</body>`,
      { waitUntil: 'load' },
    );
    await pg.waitForFunction(
      (k) => {
        const i = document.getElementById('s');
        return i && i.dataset.key === k && i.complete && i.naturalWidth > 0;
      },
      { timeout: 30000 },
      key,
    );
    const lum = await pg.evaluate((size) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(document.getElementById('s'), 0, 0, size, size);
      const d = g.getImageData(0, 0, size, size).data;
      const out = [];
      for (let i = 0; i < size * size; i++) {
        const o = i * 4;
        out.push((0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255);
      }
      return out;
    }, R);
    await pg.close();
    return lum;
  }

  const A = await render(svgA);
  const B = await render(svgB);

  // 差分 ⇒ 太极图形的精确外接方框
  const bbox = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      if (Math.abs(A[y * R + x] - B[y * R + x]) > 0.08) {
        if (x < bbox.x0) bbox.x0 = x;
        if (x > bbox.x1) bbox.x1 = x;
        if (y < bbox.y0) bbox.y0 = y;
        if (y > bbox.y1) bbox.y1 = y;
      }
    }
  }
  if (bbox.x1 < 0) throw new Error('差分为空 —— A 与 B 渲染结果相同，定位失败（静默失效）');
  const k = SVG_SIZE / R; // 2048px 系 → 1024 viewBox 系
  const cc = ((bbox.x0 + bbox.x1) / 2) * k;
  const cy = ((bbox.y0 + bbox.y1) / 2) * k;
  const dia = Math.max(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0) * k;
  const cr = dia / 2;
  console.log(`差分定位 (${R}px系): bbox=${bbox.x0},${bbox.y0}..${bbox.x1},${bbox.y1}`);
  console.log(
    `  ⇒ SVG系: 圆心(${cc.toFixed(1)}, ${cy.toFixed(1)}) 直径 ${dia.toFixed(1)} 半径 ${cr.toFixed(1)}`,
  );
  console.log(`  ⇒ 占 view幅 ${((dia / SVG_SIZE) * 100).toFixed(1)}%（源 SVG 是满幅，≈100% 才算没裁偏）`);

  // 裁剪窗：圆心为中心，边长 = 直径 / FRAC（FRAC=0.8 ⇒ 上下左右各留 10%）
  const half = cr / FRAC;
  const scale = SS / (half * 2);
  const offX = -(cc - half) * scale;
  const offY = -(cy - half) * scale;

  const p = await b.newPage();
  await p.setViewport({ width: SS, height: SS, deviceScaleFactor: 1 });
  await p.setContent(
    `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${PAPER}">` +
      `<div id="win" style="position:relative;width:${SS}px;height:${SS}px;overflow:hidden">` +
      `<img id="s" style="position:absolute;left:${offX}px;top:${offY}px;` +
      `width:${SVG_SIZE * scale}px;height:${SVG_SIZE * scale}px" ` +
      `src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOut)}">` +
      `</div></body>`,
    { waitUntil: 'load' },
  );
  await p.waitForFunction(
    () => {
      const i = document.getElementById('s');
      return i && i.complete && i.naturalWidth > 0;
    },
    { timeout: 30000 },
  );
  fs.mkdirSync(WORK, { recursive: true });
  const shot = path.resolve(WORK, '_shot.png');
  fs.writeFileSync(shot, await p.screenshot({ clip: { x: 0, y: 0, width: SS, height: SS } }));
  await p.close();
  await b.close();

  fs.writeFileSync(
    path.join(WORK, 'meta.json'),
    JSON.stringify({ frac: FRAC, eyes: KEEP_EYES, cc, cy, cr, sizes: list }, null, 2),
  );
  console.log(`\nshot -> ${shot} (${SS}x${SS})  frac=${FRAC}  鱼眼=${KEEP_EYES ? '保留' : '已去'}`);
  console.log(`targets=${list.join(',')}`);
})();