/**
 * 用 xlsx 里的两色网格**逐格直出** favicon.svg —— 2026-10-08 重做版。
 *
 * ## 为什么不从 SVG 反推几何
 * 之前是「从源 SVG 解析式重算理想网格」，那套几何已通过逐格对拍（212 → 0 格）。
 * 但本轮用户决策改了**构图**（纯黑白 + 去环 + 满幅 45° 斜分），
 * 而 xlsx 里已经有一张**设计师逐格给出的 32×32 两色网格**
 * （两色各 512 格，构图完整：满幅 45° 斜分 + 居中太极 + 两个鱼眼）。
 * ⇒ **xlsx 网格是更权威的像素源**，几何反推那条路没必要了。
 *
 * ## 为什么用 512x512 sheet 而不是 32x32
 * 两个 sheet 内容一致（512 降采样到 32 与 32 表逐格相同，实测 0/1024 不符）。
 * 但 **512 表是设计师真正面对的画布**：圆心、圆直径、鱼眼位置在其中是整数像素，
 * 32 表是它的直接抽稀。用 512 表可以在注释里记录真实几何。
 * ⚠️ 但**出图仍用 32 表**——favicon 就是要 32 格。
 *
 * ## 判据只有一个真源
 * 网格提取在 `from-xlsx.py`（承担「c@s 是 cellXfs 下标而非 fills 下标」这个坑）；
 * 图形判据在 `scripts/selftest.mjs` 的 favicon 小节（XML 合法性 / 网格 / 颜色 / crispEdges），
 * 反向测在 `scripts/verify-favicon-gates.mjs`。本脚本只做**按 run 合并写 rect**，
 * 不重新实现任何图形判据。
 * （旧版曾「校验复用 verify-favicon.mjs 的 faviconGrid」，那套从源 SVG 反推几何的对拍
 * 连同 render.cjs / grid.py 已于 2026-10-12 删除——构图换代后它描述的是已不存在的性质。）
 *
 * 用法: node scripts/favicon/make-from-xlsx.mjs <xlsx> [outSvg]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PY = 'C:/Program Files/Python312/python.exe';
const GRID_PY = path.join(ROOT, 'scripts/favicon/from-xlsx.py');

const src = process.argv[2];
const out = process.argv[3] ?? path.join(ROOT, 'public/favicon.svg');
if (!src) {
  console.error('用法: node scripts/favicon/make-from-xlsx.mjs <xlsx> [outSvg]');
  process.exit(1);
}

/** 调 from-xlsx.py 拿网格。
 *
 * ⚠️⚠️ 两个 Windows 特有的坑：
 * 1. Python 走文本模式输出 `\r\n`；不 `trimEnd()` 的话 `$` 锚点匹配不到行尾 `\r`，
 *    `/^[.#]+$/` 一行都匹配不上 ⇒ 表现为「脚本没输出网格行」，
 *    与「脚本坏了」难以区分。
 * 2. 网格行必须用**长度**过滤而不是 `/^[.#]+$/`：头部注释里也可能有纯点号行。
 */
function readGrid(xlsx, sheet) {
  const args = sheet ? [GRID_PY, xlsx, sheet] : [GRID_PY, xlsx];
  const outTxt = execFileSync(PY, args, { encoding: 'utf8' });
  const lines = outTxt.split('\n').map((l) => l.trimEnd());
  const cand = lines.filter((l) => /^[.#]+$/.test(l));
  if (!cand.length) {
    throw new Error(
      `from-xlsx.py 没输出网格行（前 3 行=${JSON.stringify(lines.slice(0, 3))}）`,
    );
  }
  // 网格是方的 ⇒ 用第一行长度当n，并**逐行校验长度**：
  // 少一行/多一行都不会被这个过滤放过去。
  const n = cand[0].length;
  const bad = cand.findIndex((l) => l.length !== n);
  if (bad >= 0) {
    throw new Error(
      `网格第 ${bad} 行长度 ${cand[bad].length} ≠ ${n} —— 表不是完整正方形。`,
    );
  }
  return {
    n,
    g: cand.map((r) => [...r].map((ch) => ch === '#')),
    head: lines.filter((l) => l.startsWith('# ') && !/^[.#]+$/.test(l)),
  };
}

/** 2026-10-08 用户决策：纯黑白（对齐参考图 #ffffff / #000000）。 */
const INK = '#000000';
const PAPER = '#ffffff';

/** 产物头部说明。⚠️⚠️ 这里的每个字都会被 XML 解析器读，
 *  而 **XML 注释体内禁止出现连续两个连字符**（`--`）。
 *  踩过的真实事故：注释里写了 Markdown 表格分隔线与命令行flag，
 *  整个 SVG 成了非法 XML、浏览器**直接拒绝渲染**（标签页显示破图），
 *  而本仓所有闸门都在**正则层**做、不关心 XML 合法性 ⇒ 全绿（P27）。
 *  ⇒ 写表格分隔线请用 `|  =  |`，写命令行请用方括号 `[flag]`。
 *  ⇒ 本段已由 selftest 的「必须是合法 XML」判据 + 反向测第 9 条守着。
 *
 *  一、构图：满幅45° 斜分背景 + 居中太极 + 两只鱼眼，纯黑白两色。
 *  二、格点：32×32，每格 1×1 单元，按行合并连续墨格成一个 rect。
 *  三、真源：设计师逐格给出的 WPS 表格（xlsx），见 make-from-xlsx.mjs 头注。
 *      提取脚本 scripts/favicon/from-xlsx.py 只做「读」，判据在 selftest.mjs。
 *  四、判据：scripts/selftest.mjs 的 favicon 小节；反向测 verify-favicon-gates.mjs。
 */
const HEADER = `<!--
  favicon：满幅 45° 斜分背景 + 居中太极（纯黑白）

  构图真源 = 设计师逐格给出的 WPS 表格，不是任何几何公式。
  改动流程：改 xlsx → node scripts/favicon/make-from-xlsx.mjs <xlsx>
            → npm run selftest → npm run favicon:gates
  本文件由脚本生成，手改会在下次生成时丢失。
-->
`;

/** 按 run 合并：同一行连续的墨格合成一个 rect，输出体积小一个量级。 */
function toSvg(g, n) {
  const lines = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (g[y][x]) {
        const s = x;
        while (x < n && g[y][x]) x++;
        lines.push(`  <rect x="${s}" y="${y}" width="${x - s}" height="1" fill="${INK}"/>`);
      } else x++;
    }
  }
  return (
    HEADER +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" ` +
    `viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">\n` +
    lines.join('\n') +
    `\n</svg>\n`
  );
}

const { n, g, head } = readGrid(src);
for (const h of head) console.error(h);
const ink = g.flat().filter(Boolean).length;
console.error(
  `墨格 ${ink}/${n * n} (${((ink / (n * n)) * 100).toFixed(1)}%)  —— 构图：满幅 45° 斜分 + 居中太极`,
);

fs.writeFileSync(out, toSvg(g, n), 'utf8');
console.error(`已写 ${out}`);
for (const row of g) console.log(row.map((v) => (v ? '#' : '.')).join(''));
