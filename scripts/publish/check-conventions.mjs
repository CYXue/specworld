#!/usr/bin/env node
/**
 * 规范自检：把 CONVENTIONS.md 里能用机器判的条款变成闸门。
 *
 *   node scripts/publish/check-conventions.mjs
 *
 * 为什么要有这个
 * --------------
 * 规范写在文档里就会被绕过。本脚本只检查「能机器判定」的条款——
 * 主观的（注释写得好不好、命名贴不贴切）不查，避免制造噪声让人整体忽略闸门。
 *
 * 覆盖的条款（对应 docs/CONVENTIONS.md）：
 *   §1.4  Toy 平台硬约束：base 必须是 './'、必须用 hash 路由
 *   §4.1  提交的 lock 必须纯官方源（与 normalize-lock.mjs 同一判据，这里只看是否干净）
 *   §5.3  src/ 零 console.* / debugger（用户看得到，污染且可能泄露内部路径）
 *   §2.5  命令式注入的 DOM 拿不到 scoped 样式 → 检出未加 :deep() 的 innerHTML 用法
 *
 * 纪律：新增检查项时必须能说出「它防的是哪种真实故障」，答不上来就不要加。
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = resolve(ROOT, 'src');

const failures = [];
const notes = [];

function fail(file, line, rule, msg) {
  failures.push({ file, line, rule, msg });
}

/** 递归列出 src/ 下所有源文件。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.ts', '.vue'].includes(extname(p))) out.push(p);
  }
  return out;
}

const rel = (abs) => abs.slice(ROOT.length + 1).replace(/\\/g, '/');

/**
 * 逐行剥掉 // 注释（保留行内字符串里的内容，但去掉注释部分）。
 * 匹配配置项时必须先剥注释——注释里常出现「正确值」的示例，
 * 不剥就会让闸门被注释骗过（真踩过）。
 */
function stripLineComments(text) {
  return text
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

/* ---- §1.4 Toy 平台硬约束 ---- */
{
  const vitePath = resolve(ROOT, 'vite.config.ts');
  // ⚠️ 必须先剥掉行注释再匹配：base 那一行的上方通常有一行说明注释
  //（「base: './' 是发布到 B 站 Toy 的硬要求」），它含有 './' 会让正则命中，
  // 于是真的把 base 改成 '/' 也检不出来。**闸门自己被注释骗过一次，别再犯。**
  const vite = stripLineComments(readFileSync(vitePath, 'utf8'));
  if (!/base\s*:\s*['"]\.\/['"]/.test(vite)) {
    fail(
      'vite.config.ts',
      0,
      'CONVENTIONS §1.4',
      "base 必须是 './'（Toy 挂在子路径下，绝对路径会 404 白屏）",
    );
  }

  const routerPath = resolve(SRC, 'router/index.ts');
  const router = readFileSync(routerPath, 'utf8');
  if (!/createWebHashHistory/.test(router)) {
    fail(
      'src/router/index.ts',
      0,
      'CONVENTIONS §1.4',
      '必须用 createWebHashHistory()——history 模式在 Toy 子路径下刷新即 404',
    );
  }
}

/* ---- §5.3 调试日志：src/ 零 console / debugger ---- */
{
  const files = walk(SRC);
  // 允许的例外：注释里解释「为什么没有 console」不算违规，这里只匹配真实代码调用。
  const codeRe = /(?<![\w.$])console\s*\.(log|debug|info|warn|error)\s*\(|\bdebugger\b/;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('<!--')) return;
      if (codeRe.test(line)) {
        fail(
          rel(f),
          i + 1,
          'CONVENTIONS §5.3',
          'src/ 里不应有 console.* 或 debugger（调试走 Vue Devtools，用后即删）',
        );
      }
    });
  }
  if (files.length === 0) notes.push('src/ 下没扫到 .ts/.vue 文件，检查是否正常');
}

/* ---- §2.5 命令式 innerHTML + scoped 样式陷阱 ---- */
{
  // 历史真 bug：BoardCanvas 用 innerHTML 注入瓦片，节点没有 data-v-xxx，
  // scoped 样式不命中 → 瓦片竖直堆叠。约定是这类结构必须 :deep() 或写全局样式。
  for (const f of walk(SRC)) {
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (!/innerHTML\s*(\+)?=/.test(line)) return;
      const m = /innerHTML\s*(\+)?=\s*[`'"]([^`'"]*)/.exec(line);
      const snippet = m ? m[2] : '';
      if (!snippet) return;
      if (/<(div|span|img|a|ul|li)\b/.test(snippet)) {
        fail(
          rel(f),
          i + 1,
          'CONVENTIONS §2.5',
          'innerHTML 注入含标签的结构时，scoped 样式对它无效；请改用 :deep() 或写全局样式',
        );
      }
    });
  }
}

/* ---- §4.1 lock 源纯度（只报不改） ---- */
{
  const lockPath = resolve(ROOT, 'package-lock.json');
  if (!existsSync(lockPath)) {
    notes.push('没有 package-lock.json，跳过依赖源检查');
  } else {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const offenders = Object.values(lock.packages ?? {}).filter(
      (p) => typeof p?.resolved === 'string' && !p.resolved.includes('registry.npmjs.org'),
    );
    if (offenders.length > 0) {
      fail(
        'package-lock.json',
        0,
        'CONVENTIONS §4.1',
        `${offenders.length} 条 resolved 不是官方源（修法：npm run lock:fix）`,
      );
    }
  }
}

/* ---- 数据管线契约：品类不许在同步层兜底 ---- */
{
  // 2026-10-14 审计 P1-3。曾经的写法：
  //   sync/index.mjs 拍平循环里 `if (!p.category) p.category = 'phone'`
  // 它发生在 validate() **之前**，于是「品类缺失或未注册」闸门永远看不到缺失值 ——
  // 闸门注释声称「缺失也拒绝」，实现却静默放行，违约机型按错误字段表渲染、零报错。
  // 修法：品类由数据源层显式声明（normalize/index.mjs 出口），本层删兜底。
  //
  // 这条守卫防回归：谁再把兜底写回 sync 层，当天就被拦。
  // ⚠️ 必须剥掉**行注释与块注释**再匹配：修法注释里就引用着那行历史代码
  // （「曾经的 `if (!p.category) p.category = 'phone'`」），不剥就会自己误报自己 ——
  // 「闸门被注释骗」的变体，项目在 §1.4 已经踩过一次。
  const syncPath = resolve(ROOT, 'scripts/sync/index.mjs');
  if (existsSync(syncPath)) {
    // 逐行剥注释（行注释 + 跨行块注释），**保持行号不变**——
    // 报错时给的行号必须能直接在编辑器里跳过去，剥完再 join 会整体错行。
    const lines = readFileSync(syncPath, 'utf8').split('\n');
    let inBlock = false;
    lines.forEach((line, i) => {
      let t = line;
      if (inBlock) {
        const end = t.indexOf('*/');
        if (end < 0) return; // 整行仍在块注释内
        t = t.slice(end + 2);
        inBlock = false;
      }
      t = t.replace(/\/\*[\s\S]*?\*\//g, '');
      const open = t.indexOf('/*');
      if (open >= 0) {
        t = t.slice(0, open);
        inBlock = true;
      }
      const c = t.indexOf('//');
      if (c >= 0) t = t.slice(0, c);
      if (/\.category\s*=\s*['"]phone['"]/.test(t)) {
        fail(
          'scripts/sync/index.mjs',
          i + 1,
          '管线契约 §品类',
          "同步层不许兜底 category='phone'（兜底先于闸门 ⇒ 缺失永远看不到）；品类由 normalize 出口显式声明",
        );
      }
    });
  }
}

/* ---- 报告 ---- */
for (const n of notes) console.log(`⚠ ${n}`);

if (failures.length === 0) {
  console.log('✅ 规范自检通过：Toy base/hash 路由、零调试日志、命令式 DOM 样式、依赖源纯度、管线品类契约');
  process.exit(0);
}

console.error(`✗ 规范自检发现 ${failures.length} 处问题：\n`);
const byRule = new Map();
for (const f of failures) {
  if (!byRule.has(f.rule)) byRule.set(f.rule, []);
  byRule.get(f.rule).push(f);
}
for (const [rule, list] of byRule) {
  console.error(`  ${rule}（${list.length} 处）`);
  for (const f of list.slice(0, 5)) {
    console.error(`    ${f.file}${f.line ? ':' + f.line : ''}  ${f.msg}`);
  }
  if (list.length > 5) console.error(`    …… 另有 ${list.length - 5} 处`);
  console.error('');
}
console.error('  说明：这是规范闸门，不是审美检查。详见 docs/CONVENTIONS.md');
process.exit(1);
