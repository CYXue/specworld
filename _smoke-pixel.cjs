/**
 * 像素风视觉核对：逐页截图 + 自动检测「非像素残留」。
 *
 * 这个脚本本身也是闸门 —— 风格统一最容易回归的地方是「又加了 backdrop-blur」
 * 「又用了 rounded-full」「字号又出现 13px」，光靠人眼看不住，所以机器先扫一遍。
 *
 * 检测项（对每个页面跑）：
 *  1. console 错误 / 请求失败
 *  2. 带模糊的元素（backdrop-filter / filter:blur）
 *  3. 带圆角的元素（border-radius > 0，排除球体这类几何必需）
 *  4. 非 12 倍数的字号（像素字重采样后会糊）
 *  5. 字体是否真的用上了 SpecPixel（拿 computed font-family 核对）
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { chromePath } = require('./_smoke-paths.cjs');

const BASE = process.env.SMOKE_BASE || 'http://localhost:4173/';
const OUT = path.join(__dirname, '_shots-pixel');

/**
 * 要扫的路由。
 *
 * ⚠️ **这是硬编码白名单**：不在清单里的页面，脚本压根不会打开，
 * 但输出照样写「✅ 零违规」—— 措辞比覆盖面宽，别被骗
 * （`#/about` 曾因此带着 3 处违规字号长期隐身，见 docs/PITFALLS.md P19）。
 *
 * **纪律：加了路由就把对应的 hash 加进来。** 动态段给一个真实样本。
 */
const PAGES = [
  ['home', '#/'],
  ['timeline', '#/timeline'],
  ['rankings', '#/rankings'],
  ['compare', '#/compare'],
  ['search', '#/search?q=mate'],
  ['search-empty', '#/search'],
  ['canvas', '#/canvas'],
  ['globe', '#/globe'],
  ['about', '#/about'],
  ['brand', '#/brand/apple'],
  ['product', '#/product/apple-iphone-16'],
  ['notfound', '#/nope'],
];

/** 扫描页面里的风格违规 */
const AUDIT = () => {
  const blur = [];
  const round = [];
  const badSize = [];
  let fonts = new Set();

  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    // 1. 模糊
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || '';
    if (bf && bf !== 'none') blur.push(el.className || el.tagName);
    const f = cs.filter || '';
    if (f && f !== 'none' && f.includes('blur')) blur.push(el.className || el.tagName);

    // 2. 圆角（球体 .globe-body 几何必需，白名单）
    const r = parseFloat(cs.borderRadius) || 0;
    const cls = String(el.className || '');
    const isGlobe = cls.includes('globe-body');
    if (r > 0 && !isGlobe) round.push(`${cls || el.tagName}:${cs.borderRadius}`);

    // 3. 字号：像素字只认 12 的整数倍与 12 本身
    //    排除两类「合理例外」，否则噪声会让人整体忽略这个检查：
    //      · .sr-only —— 视觉隐藏的无障碍等价物（含其**后代**，用 closest 而非自身匹配：
    //        画布/球面的文本等价列表里 <h2>/<a> 自己不带 class，只在祖先里）
    //      · <title>/<style>/<head> 内的元素 —— 根本不渲染
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      const hidden =
        el.closest('.sr-only') !== null ||
        el.closest('head') !== null ||
        ['TITLE', 'STYLE', 'SCRIPT', 'META', 'LINK'].includes(el.tagName);
      const fs = parseFloat(cs.fontSize);
      if (!hidden && fs && fs !== 12 && fs % 12 !== 0)
        badSize.push(`${String(el.className || '') || el.tagName}:${fs}px`);
      if (!hidden) fonts.add(cs.fontFamily.split(',')[0].replace(/["']/g, ''));
    }
  }
  return {
    blur: [...new Set(blur)],
    round: [...new Set(round)],
    badSize: [...new Set(badSize)],
    fonts: [...fonts],
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('requestfailed', (r) => errors.push('[reqfail] ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http${r.status()}] ` + r.url()); });

  let bad = 0;
  for (const [name, hash] of PAGES) {
    await page.goto(BASE + hash, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 同 _smoke-font.cjs：弃 networkidle2（HMR websocket 随机超时），改 fonts.ready 确定性等待
    await page
      .waitForFunction(() => document.fonts.status === 'loaded', { timeout: 10000 })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 900));
    const a = await page.evaluate(AUDIT);
    const line = [
      a.blur.length ? `❌模糊×${a.blur.length}` : '✅无模糊',
      a.round.length ? `❌圆角×${a.round.length}` : '✅无圆角',
      a.badSize.length ? `⚠字号×${a.badSize.length}` : '✅字号整数',
      `字体:${a.fonts.join('/')}`,
    ].join('  ');
    console.log(`${name.padEnd(14)} ${line}`);
    if (a.blur.length) { console.log('   模糊:', a.blur.slice(0, 4)); bad++; }
    if (a.round.length) { console.log('   圆角:', a.round.slice(0, 4)); bad++; }
    // 字号违规**必须计数**：曾经这里只打印不 bad++，13 个页面每页一处 14px
    // 连着跑了几十轮都是「✅ 像素风自检通过」—— 告警疲劳比没有闸门更糟，
    // 它训练所有人忽略这一行的输出（2026-10-14 审计 P2-5 修）。
    if (a.badSize.length) { console.log('   字号:', a.badSize.slice(0, 6)); bad++; }
    if (!a.fonts.includes('SpecPixel')) { console.log('   ❌ 字体未生效'); bad++; }

    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  }

  // 移动端窄屏：验证固定像素布局没破
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  for (const [name, hash] of [['home-m', '#/'], ['canvas-m', '#/canvas'], ['globe-m', '#/globe']]) {
    await page.goto(BASE + hash, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`窄屏 ${name} 已截图`);
  }

  console.log('\n' + (errors.length ? '❌ 运行时错误:\n' + errors.join('\n') : '✅ 零运行时错误'));
  console.log(bad === 0 && errors.length === 0 ? '✅ 像素风自检通过' : `❌ ${bad} 项不合规`);
  await browser.close();
  process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
})();
