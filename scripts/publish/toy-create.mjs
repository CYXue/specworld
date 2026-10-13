#!/usr/bin/env node
/**
 * 首次发布到 B 站 Toy（create 两段式）。
 *
 * 与 CI 的分工
 * ------------
 * CI（.github/workflows/toy.yml）只跑 **update** —— 它每天自动送审，前提是
 * Toy 已经存在。**第一次发布必须人工**：slug 一旦定下不可改（平台规则），
 * 这个决定不该由定时任务替用户做。本脚本就是那次人工发布的辅助。
 *
 * 两段式（对应官方 skill 的铁律）
 * ------------------------------
 *   第一段：node scripts/publish/toy-create.mjs
 *           doctor 预检 → 打包 → toy create（**不带 --yes**）→ 拿预览链接，
 *           打印摘要后停下。人去浏览器看预览。
 *   第二段：node scripts/publish/toy-create.mjs --commit
 *           用户看过预览、明确确认后，同参数加 --yes 提交审核。
 * 预览前绝不提交 —— 用户没看到页面就送审，追不回来。
 *
 * 前置闸门
 * --------
 *   1. toy-meta.json 的 slugConfirmed 必须为 true（slug 不可改，防手滑）。
 *   2. 官方 toy_doctor.py 能找到就跑（ERROR 阻断，WARN 只提示）；
 *      找不到不阻断 —— verify-dist.mjs 已覆盖其核心 ERROR（入口/外链/绝对路径/失效引用/体积）。
 *   3. 资产生成过（make-toy-assets.mjs）、包打过（pack.mjs）。
 *
 * 退出码：0 正常（含第一段停在预览）；1 闸门未过 / 命令失败。
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HERE = dirname(fileURLToPath(import.meta.url));
const META = join(HERE, 'toy-meta.json');
const PKG = join(ROOT, '.toy-pkg');
const COMMIT = process.argv.includes('--commit');

const meta = JSON.parse(readFileSync(META, 'utf8'));
const assetPath = (rel) => join(HERE, rel);

/* ---------- 闸门 1：slug 已确认 ---------- */
if (!meta.slugConfirmed) {
  console.error('❌ slug 尚未确认（toy-meta.json: slugConfirmed = false）');
  console.error(`   当前候选 slug：${meta.slug}`);
  console.error('   slug 发布后不可改（平台规则），改它 = 删除重建、分享链接全失效。');
  console.error('   用户拍板后把 slugConfirmed 改成 true 再跑本脚本。');
  process.exit(1);
}

/* ---------- 闸门 2：toy CLI 与登录态 ---------- */
const toyBin = (() => {
  try {
    return execSync('command -v toy', { shell: 'bash', stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim() || 'toy';
  } catch {
    return null;
  }
})();
if (!toyBin) {
  console.error('❌ 找不到 toy CLI。安装：curl -fsSL https://boss.hdslb.com/toy-cli/toy/install.sh | bash');
  process.exit(1);
}
/**
 * 调 toy CLI。Windows 上必须经 bash 包装，不能直接 execFileSync(toyBin)：
 * `command -v toy` 返回的是 MSYS 风格路径（/c/Users/.../toy），
 * 且该可执行文件没有 .exe 扩展名 —— Windows CreateProcess 两样都不认，
 * 直接 spawn 报 ENOENT，被误判成「未登录」（2026-10-12 实踩：
 * whoami 明明在线，预览却跑不起来）。
 * bash -c 'toy "$@"' 的写法让 bash 自己按 PATH 找 toy，参数逐个传递、
 * 不手拼引号，值里带空格/中文/点号都安全（CI 的 Linux runner 上
 * bash 同样存在，走同一条路，行为一致）。
 */
const runToy = (args, opts = {}) => {
  if (process.platform === 'win32') {
    return execFileSync('bash', ['-c', 'toy "$@"', 'toy', ...args], opts);
  }
  return execFileSync(toyBin, args, opts);
};
try {
  const who = JSON.parse(runToy(['whoami', '--json'], { encoding: 'utf8' }));
  console.log(`✅ 已登录：${who.name}（uid ${who.uid}）`);
} catch {
  console.error('❌ 未登录或登录态失效。跑一次 toy login 后重试（重试一次就停，别循环）。');
  process.exit(1);
}

/* ---------- 闸门 3：官方 doctor 预检（找到才跑，ERROR 阻断） ---------- */
const doctor = (() => {
  const cands = [
    process.env.TOY_DOCTOR,
    join(process.env.USERPROFILE || process.env.HOME, '.agents/skills/toy/scripts/toy_doctor.py'),
    '/c/Users/EAWAC/.agents/skills/toy/scripts/toy_doctor.py',
  ].filter(Boolean);
  return cands.find((p) => existsSync(p)) || null;
})();
if (doctor) {
  console.log('▶ 官方 toy_doctor.py 预检');
  try {
    const py = process.env.TOY_PYTHON || 'C:/Program Files/Python312/python.exe';
    // ⚠️ 必须传 --poster：validate_poster 在 poster 参数缺失时直接 return，
    // 「格式/4:3 比例」校验被静默跳过、零 findings 是假象（2026-10-12 实踩：
    // 16:9 封面偏差 0.44 超容差，预检却报 ok）。
    execFileSync(py, [doctor, PKG, '--slug', meta.slug, '--poster', assetPath(meta.poster), '--json'], { stdio: 'inherit' });
  } catch {
    console.error('❌ doctor 预检未通过 —— 按上面的 ERROR 逐条修，修完重跑。');
    process.exit(1);
  }
} else {
  console.log('⚠️ 未找到官方 toy_doctor.py（~/.agents/skills/toy/），跳过预检。');
  console.log('   核心 ERROR 已由 scripts/publish/verify-dist.mjs 在 build 后覆盖。');
}

/* ---------- 闸门 4：资产与包 ---------- */
for (const [label, p] of [
  ['icon', assetPath(meta.icon)],
  ['poster', assetPath(meta.poster)],
]) {
  if (!existsSync(p)) {
    console.error(`❌ 缺 ${label} 资产：${p} —— 先跑 node scripts/publish/make-toy-assets.mjs`);
    process.exit(1);
  }
}
if (!existsSync(join(PKG, 'index.html'))) {
  console.error('❌ .toy-pkg/ 不存在或没有入口 —— 先跑 npm run build && node scripts/publish/pack.mjs');
  process.exit(1);
}

/* ---------- create ---------- */
const args = [
  'create',
  PKG,
  '--title',
  meta.title,
  '--slug',
  meta.slug,
  '--category',
  meta.category,
  '--icon',
  assetPath(meta.icon),
  '--poster',
  assetPath(meta.poster),
  '--visibility',
  meta.visibility,
  '--json',
];
if (meta.watermark) args.push('--watermark');

if (COMMIT) {
  args.push('--yes');
  console.log('▶ 提交审核（--yes）…');
  let out;
  try {
    out = runToy(args, { encoding: 'utf8' });
  } catch (e) {
    console.error(e.stdout || e.message);
    console.error('❌ 提交失败 —— 按上面的 message 处理，不要盲目重试。');
    process.exit(1);
  }
  console.log(out);
  try {
    execFileSync(process.execPath, [join(HERE, 'pack.mjs'), '--mark-released'], { stdio: 'inherit' });
  } catch {
    console.error('⚠️ mark-released 失败，手动跑：node scripts/publish/pack.mjs --mark-released');
  }
  console.log('\n送审后：');
  console.log('  · 审核通常 10 分钟内；被驳回不会自动重发，按平台整改意见人工处理');
  console.log('  · 查状态：toy mylist --json');
  console.log(`  · 分享链接（审核过后生效）：${meta.share}`);
  console.log('  · 记得提交本次发布记录：git add data/.toy-release.json scripts/publish/toy-meta.json');
  process.exit(0);
}

/* 第一段：预览，绝不加 --yes */
console.log('▶ 创建预览（不带 --yes，不会提交审核）…');
let out;
try {
  out = runToy(args, { encoding: 'utf8' });
} catch (e) {
  console.error(e.stdout || e.message);
  console.error('❌ 预览失败 —— 按上面的 message 处理。');
  process.exit(1);
}
let previewUrl = null;
try {
  const j = JSON.parse(out);
  previewUrl = j.preview_url || j.previewUrl || (j.data && (j.data.preview_url || j.data.previewUrl)) || null;
} catch {
  /* 输出不是 JSON 就原样打印 */
}
if (previewUrl) {
  console.log(`\n预览链接：${previewUrl}`);
  console.log('（在浏览器里打开检查；未登录 B 站的浏览器可能打不开）');
} else {
  console.log(out);
}
console.log('\n即将发布的摘要：');
console.log(`  操作：create（首次发布）    名称：${meta.title}`);
console.log(`  slug：${meta.slug}（发布后不可改！）`);
console.log(`  分类：${meta.category}    可见性：${meta.visibility}`);
console.log(`  封面：${meta.poster}    图标：${meta.icon}    包：./.toy-pkg`);
console.log('\n请先在浏览器检查预览页面。确认无误后执行：');
console.log('  node scripts/publish/toy-create.mjs --commit');
