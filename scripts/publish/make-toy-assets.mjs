#!/usr/bin/env node
/**
 * 生成 B 站 Toy 的发布资产：icon PNG + poster PNG。
 *
 * 为什么不在仓库里存 PNG
 * ----------------------
 * 两张图都能从「favicon.svg + poster.html + 字体」确定性再生，
 * 存二进制入库只会多一份会漂移的副本。真源是源文件，PNG 是产物 ——
 * 与 data/ vs dist/ 同一纪律。
 *
 * 为什么用 Chrome 栅格化而不是 PIL
 * --------------------------------
 * ① 字体。中文像素字体的渲染必须走浏览器才能保证字形/字距与站点一致，
 *    PIL 画不了 SpecPixel（也没有等宽中文点阵数据）。
 * ② favicon 的真消费者是浏览器。P31 的教训：像素级作品从渲染链取，
 *    不从降采样取 —— 这里干脆让 Chrome 直接渲染，绕开整条降采样链。
 *
 * 用法
 * ----
 *   node scripts/publish/make-toy-assets.mjs          # 生成 icon + poster
 *   node scripts/publish/make-toy-assets.mjs --force  # 忽略时间戳强制重生成
 *
 * 平台规格（toy create --help-json）
 * --------------------------------
 *   icon：PNG/JPEG，≤512KB，宽高 ≤1024px。这里取 512×512。
 *   poster：封面图，无硬性上限，取 960×540（16:9，B 站卡片主流比例）。
 *
 * 退出码：0 成功；1 资产不合规（体积/尺寸超限）。
 */

import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, 'toy-assets');
const META = join(HERE, 'toy-meta.json');
const FAVICON = join(ROOT, 'public/favicon.svg');
const POSTER_HTML = join(ASSETS, 'poster.html');
const ICON_PNG = join(ASSETS, 'icon-512.png');
const POSTER_PNG = join(ASSETS, 'poster.png');

/** 平台规格上限（写在这里而不是散在两处校验里）。 */
const ICON_MAX_BYTES = 512 * 1024;
const ICON_MAX_DIM = 1024;

/* ---------- Chrome 定位：本机已验证过的路径优先，环境变量兜底 ---------- */
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    // LOCALAPPDATA 在 Git Bash 里是 %LOCALAPPDATA%，拼成 Windows 路径给 Chrome 用
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/** 读 PNG 头部拿宽高（IHDR，big-endian）—— 不引 Pillow，node 原生够用。 */
function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** Chrome headless 截图。window-size 即画布；--force-device-scale-factor=1 保证 1 图素 = 1 CSS 像素。 */
function shoot(chrome, url, out, w, h) {
  execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--allow-file-access-from-files', // poster.html 要读同目录字体，file:// 下必须显式放行
      `--window-size=${w},${h}`,
      `--screenshot=${out}`,
      '--virtual-time-budget=2000', // 给字体加载留时间，截图时已是最终态
      url,
    ],
    { stdio: 'pipe' },
  );
}

/** 体检 HTML 源里的本地引用：字体/img 路径写错的症状是**静默回退**
 *  （字体掉回系统字形、img 显示破图），截图照样出、肉眼不放大看不出来 ——
 *  正是本项目反复吃过的静默失效类。所以在截图前先逐个 resolve 核对。 */
function checkLocalRefs(htmlFile) {
  const text = readFileSync(htmlFile, 'utf8');
  const dir = dirname(htmlFile);
  const refs = [
    ...[...text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((m) => m[1]),
    ...[...text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
  ];
  const bad = [];
  for (const u of refs.map((s) => s.trim()).filter((s) => s && !/^(https?:)?\/\//i.test(s) && !s.startsWith('data:') && !s.startsWith('#'))) {
    if (!existsSync(resolve(dir, u))) bad.push(u);
  }
  if (bad.length) {
    console.error(`❌ ${relative(ROOT, htmlFile)} 有解析不到的本地引用（会静默回退/破图）：`);
    for (const u of bad) console.error(`    ${u}`);
    process.exit(1);
  }
}

/* ---------- 主流程 ---------- */
const force = process.argv.includes('--force');
const meta = JSON.parse(readFileSync(META, 'utf8'));
if (!existsSync(FAVICON)) {
  console.error('❌ public/favicon.svg 不存在');
  process.exit(1);
}
if (!existsSync(POSTER_HTML)) {
  console.error('❌ toy-assets/poster.html 不存在（封面源文件）');
  process.exit(1);
}
const chrome = findChrome();
if (!chrome) {
  console.error('❌ 找不到 Chrome。设置 CHROME_PATH 环境变量指向 chrome.exe');
  process.exit(1);
}
mkdirSync(ASSETS, { recursive: true });

/* 时间戳判据：源比产物新才重画（与 --force 手动兜底）。 */
const stale = (src, out) => force || !existsSync(out) || statSync(src).mtimeMs > statSync(out).mtimeMs;

let jobs = 0;
if (stale(FAVICON, ICON_PNG)) {
  // favicon.svg 是 32×32，直接截图会得到 32px 小图。包一层 HTML 用 img
  // NEAREST 放大到 512 —— 像素作品的放大必须是硬最近邻，任何插值都糊。
  // 路径用 relative 现算（手写 '../..' 数错过一次，症状是静默破图）。
  const wrap = join(ASSETS, '.icon-wrap.html');
  const favRel = relative(ASSETS, FAVICON).replace(/\\/g, '/');
  writeFileSync(
    wrap,
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
     *{margin:0;padding:0}html,body{width:512px;height:512px;overflow:hidden;background:#f5f5f7}
     img{width:512px;height:512px;image-rendering:pixelated;image-rendering:crisp-edges;display:block}
     </style></head><body><img src="${favRel}"></body></html>`,
    'utf8',
  );
  checkLocalRefs(wrap);
  shoot(chrome, `file:///${wrap.replace(/\\/g, '/')}`, ICON_PNG, 512, 512);
  rmSync(wrap); // 一次性包装，截图后即删（真源是 favicon.svg，不是这个壳）
  jobs++;
}
if (stale(POSTER_HTML, POSTER_PNG)) {
  checkLocalRefs(POSTER_HTML);
  shoot(chrome, `file:///${POSTER_HTML.replace(/\\/g, '/')}`, POSTER_PNG, 960, 540);
  jobs++;
}
if (jobs === 0) console.log('资产都是新的，跳过（--force 可强制重生成）');

/* ---------- 合规校验：不合规就非零退出，别等发布时被平台打回 ---------- */
let bad = 0;
const check = (file, label, maxBytes, maxDim) => {
  if (!existsSync(file)) {
    console.error(`❌ ${label} 没生成：${file}`);
    bad++;
    return;
  }
  const size = pngSize(file);
  const bytes = statSync(file).size;
  const dimOk = size && size.w <= maxDim && size.h <= maxDim;
  const bytesOk = bytes <= maxBytes;
  const ok = dimOk && bytesOk;
  if (!ok) bad++;
  console.log(
    `${ok ? '✅' : '❌'} ${label}: ${size ? `${size.w}×${size.h}` : '非 PNG'} · ${(bytes / 1024).toFixed(1)} KB` +
      `${ok ? '' : dimOk ? '' : `（超过 ${maxDim}px）`}${bytesOk ? '' : `（超过 ${maxBytes / 1024} KB）`}`,
  );
};
check(ICON_PNG, `icon（平台限 ≤1024px / ≤512KB）`, ICON_MAX_BYTES, ICON_MAX_DIM);
check(POSTER_PNG, 'poster', 4 * 1024 * 1024, 2048);

if (bad) {
  console.error(`\n❌ ${bad} 项资产不合规`);
  process.exit(1);
}
console.log('\nToy 资产就绪（scripts/publish/toy-assets/）：');
console.log(`  icon   → ${meta.icon}`);
console.log(`  poster → ${meta.poster}`);
console.log(`  元信息 → scripts/publish/toy-meta.json（slug：${meta.slug}）`);
