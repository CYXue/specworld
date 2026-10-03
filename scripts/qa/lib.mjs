/**
 * QA 公共库：只读加载 + 输出格式化。
 *
 * 三条纪律（照抄参考项目 scripts/qa/ 的做法）：
 *
 * 1. **只读。** 本目录下所有脚本只读 data/ 与 _work/，绝不写盘、绝不联网。
 *    「体检」和「修复」必须是两件事——体检顺手改了数据，就没人信它的结论了。
 *
 * 2. **离线确定性。** 同样的输入产出同样的输出，不含时间戳、不含随机数。
 *    否则没法用它来判断「这次改动引入了什么」。
 *
 * 3. **回答一个问题就退出。** 每个脚本只回答一件事，
 *    所以输出必须短到能一眼看完——满屏数字等于没回答问题。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 读入库快照。缺文件时给一句人话，而不是抛栈 */
export function loadProducts() {
  const f = join(ROOT, 'data/products.json');
  if (!existsSync(f)) {
    console.error('❌ 找不到 data/products.json。先跑一次：node scripts/pipeline.mjs --offline');
    process.exit(1);
  }
  const P = JSON.parse(readFileSync(f, 'utf8'));
  return P.products ?? P;
}

/** 读分析层产物。缺它意味着分析层没跑过 */
export function loadAnalytics() {
  const f = join(ROOT, '_work/analytics.json');
  if (!existsSync(f)) {
    console.error('❌ 找不到 _work/analytics.json。先跑一次：node scripts/pipeline.mjs --offline');
    process.exit(1);
  }
  return JSON.parse(readFileSync(f, 'utf8'));
}

/** 品牌中文名。取值来自统一品牌注册表 scripts/brands.mjs，不在这里另立一份 */
import { brandZh } from '../brands.mjs';
export { brandZh };

/* ------------------------------------------------------------------ *
 * 输出格式化
 * ------------------------------------------------------------------ */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: (s) => paint('1', s),
  dim: (s) => paint('2', s),
  red: (s) => paint('31', s),
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  blue: (s) => paint('36', s),
};

/** 表格输出。列宽按内容算，不写死 */
export function table(headers, rows, { align = [] } = {}) {
  if (!rows.length) return;
  const widths = headers.map((h, i) =>
    Math.max(displayWidth(h), ...rows.map((r) => displayWidth(String(r[i] ?? '')))));
  const line = (cells) =>
    cells.map((cell, i) => {
      const w = widths[i];
      const s = String(cell ?? '');
      const pad = w - displayWidth(s);
      return align[i] === 'r' ? ' '.repeat(pad) + s : s + ' '.repeat(pad);
    }).join('  ');
  console.log(c.dim(line(headers)));
  console.log(c.dim(line(widths.map((w) => '─'.repeat(w)))));
  for (const r of rows) console.log(line(r));
}

/** 中日韩字符按 2 列宽算，否则表格会歪 */
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
      ? 2
      : 1;
  }
  return w;
}

export const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - displayWidth(s)));
export const padL = (s, n) => ' '.repeat(Math.max(0, n - displayWidth(s))) + String(s);

/** 进度条：体检脚本用它一眼看出「哪些字段大面积缺数据」 */
export function bar(ratio, width = 20) {
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

/** 百分比如 0.933 → 93.3% */
export const pct = (v, digits = 1) => `${(v * 100).toFixed(digits)}%`;

/** 分档配色：>=90% 绿，>=60% 黄，否则红。与闸门的心情一致 */
export const ratioColor = (v) => (v >= 0.9 ? c.green : v >= 0.6 ? c.yellow : c.red);

/** 统一的小节标题 */
export function section(title) {
  console.log('');
  console.log(c.bold(title));
  console.log(c.dim('─'.repeat(Math.max(20, displayWidth(title)))));
}

/** 脚本统一的结尾：给一句「所以呢」 */
export function verdict(ok, good, bad) {
  console.log('');
  console.log(ok ? c.green(`✅ ${good}`) : c.yellow(`⚠️  ${bad}`));
  console.log('');
  process.exit(ok ? 0 : 1);
}