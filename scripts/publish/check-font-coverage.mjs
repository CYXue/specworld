/**
 * 字形覆盖闸门：确认像素字体覆盖站点会用到的每一个汉字与 ASCII。
 *
 * 为什么必须有这道闸门
 * ────────────────────
 * 字体缺字形时，浏览器**静默**回退到系统字体，零报错零警告：
 * 页面照常渲染，只是同一段文字里「有些字是像素的、有些字是圆滑的」。
 * 本站踩过一次 —— 旧字体只覆盖项目实需汉字的 45%（478/1059），
 * 而 computed font-family 明明写着像素字体，任何基于样式声明的检查都是绿的。
 * 「风格不统一」正是这种静默失效的典型。
 *
 * 数据从哪来（为什么不是现读 woff2）
 * ──────────────────────────────────
 * 走 `public/fonts/coverage.json`，由 `python scripts/font/build-subset.py` 在
 * **生成字体时**用 fontTools 读 cmap 落下，同时记下字体自身的 sha256。
 * 闸门这里做两件事：
 *   ① 校验 coverage.json 里的 sha256 与磁盘上的字体一致
 *      → 防止「换了字体忘了重生成清单」（那会让闸门拿旧数据报绿）
 *   ② 用清单里的码位集合与「源码 + 数据」求差集
 *
 * 为什么不自己解析 woff2
 * ────────────────────
 * 试过。手写 WOFF2 表目录解析的坑：表 tag 在目录项里是**预定义表的索引**而非
 * 4 字节 ASCII（索引 63 才是自定义 tag），读出来全是乱码、不报错、结论全错。
 * brotli 解压还要额外依赖。权威数据在生成期一次算清、闸门只做比对，
 * 既准确又让闸门保持零依赖（CI 的 selftest job 只装 Node）。
 *
 * ⚠️ 本闸门自己被反向测过：把字体换成只含 4 个汉字的子集后必须报红，
 * 换回完整字体必须恢复绿灯。见 docs/PITFALLS.md P8。
 *
 * 用法：node scripts/publish/check-font-coverage.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const FONT = join(ROOT, 'public', 'fonts', 'pixel-zh.woff2');
const COVERAGE = join(ROOT, 'public', 'fonts', 'coverage.json');

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

/* ── 1. 清单必须与字体同源 ── */
if (!existsSync(COVERAGE)) {
  fail(`❌ 缺少 ${relative(ROOT, COVERAGE)}\n` + '   生成：python scripts/font/build-subset.py');
}
const coverage = JSON.parse(readFileSync(COVERAGE, 'utf8'));
const sha = createHash('sha256').update(readFileSync(FONT)).digest('hex');
if (coverage.fontSha256 !== sha) {
  fail(
    `❌ 字体与 coverage.json 不同源\n` +
      `   字体 sha256 ${sha.slice(0, 16)}… / 清单记录 ${String(coverage.fontSha256).slice(0, 16)}…\n` +
      '   重新生成：python scripts/font/build-subset.py',
  );
}

const covered = new Set(coverage.codePoints);
if (!covered.size) fail('❌ coverage.json 的 codePoints 为空');

/* ── 2. 收集站点会用到的字符 ── */
function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.includes(extname(name))) out.push(p);
  }
  return out;
}

const chars = new Set();
for (const f of walk(join(ROOT, 'src'), ['.vue', '.ts', '.css'])) {
  chars.add(readFileSync(f, 'utf8'));
}
chars.add(readFileSync(join(ROOT, 'index.html'), 'utf8'));

// data/*.json 里的所有字符串（机型名、中文名都是数据里的）
const dataDir = join(ROOT, 'data');
const walkJson = (node) => {
  if (typeof node === 'string') for (const c of node) chars.add(c);
  else if (Array.isArray(node)) node.forEach(walkJson);
  else if (node && typeof node === 'object') Object.values(node).forEach(walkJson);
};
for (const f of walk(dataDir, ['.json'])) {
  try {
    walkJson(JSON.parse(readFileSync(f, 'utf8')));
  } catch {
    /* 损坏的 JSON 由 validate 管，这里不重复报 */
  }
}

/* ── 3. 求差集 ── */
const cjk = [...chars].filter((c) => {
  const p = c.codePointAt(0);
  return p >= 0x4e00 && p <= 0x9fff;
});
const cjkMissing = cjk.filter((c) => !covered.has(c.codePointAt(0)));
const asciiMissing = [];
for (let c = 0x20; c < 0x7f; c++) if (!covered.has(c)) asciiMissing.push(String.fromCharCode(c));

/* ── 4. 报告 ── */
console.log(`字形覆盖检查（${relative(ROOT, FONT)}）`);
console.log(
  `  字体 ${(readFileSync(FONT).length / 1024).toFixed(1)} KB · 覆盖码位 ${covered.size}`,
);
console.log(`  汉字 ${cjk.length - cjkMissing.length}/${cjk.length}`);
console.log(`  ASCII ${95 - asciiMissing.length}/95`);

let bad = false;
if (asciiMissing.length) {
  console.log(`  ❌ ASCII 缺：${asciiMissing.join('')}`);
  bad = true;
}
if (cjkMissing.length) {
  console.log(`  ❌ 汉字缺 ${cjkMissing.length} 个：${cjkMissing.slice(0, 60).join('')}`);
  bad = true;
}

if (bad) {
  console.log(
    '\n缺字形不会让构建失败、也不会在控制台报错，只会让那些字悄悄变回系统圆滑字体 —— ' +
      '这正是「风格不统一」最隐蔽的成因，所以在这里拦住。\n' +
      '修复：python scripts/font/build-subset.py',
  );
  process.exit(1);
}
console.log('\n✅ 字形覆盖完整：站点所有汉字与 ASCII 都由像素字体渲染，不会静默回退');
