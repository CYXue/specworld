/**
 * 字体覆盖检测：确认 SpecPixel 真的提供了项目需要的每一个字形。
 *
 * 为什么不能只看 computed font-family
 * ────────────────────────────────────
 * `getComputedStyle(el).fontFamily` 只会告诉你「样式声明了 SpecPixel」，
 * 哪怕字体文件里根本没有那个字形，浏览器也会照常回退到系统字体并**零报错**。
 * 这正是本站踩过的坑：旧字体只覆盖 45% 的汉字，肉眼看着「有些字像素、有些字圆滑」，
 * 代码里所有检查都是绿的。
 *
 * 为什么不能用 measureText 比宽度
 * ──────────────────────────────
 * 试过了，**对 CJK 完全无效**：汉字在绝大多数字体里都是全角等宽（1em），
 * 于是「用 SpecPixel 量」与「用回退字体量」宽度永远相同 → 满屏误报。
 * （这是本脚本的第一版，报 124/124 全红，而字体其实是好的。教训和既往
 *  「闸门命中的是注释」「resolver 忽略 query」同源：先证明量法有效，再用它下结论。）
 *
 * 怎么测：像素级比对
 * ──────────────────
 * 把同一个字分别用 ① `SpecPixel, monospace` ② **单独** `monospace` 画到 canvas，
 * 取 ImageData 做逐字节比较：
 *   - ① === ②  → SpecPixel 没有这个字形，浏览器回退到了列表里的 monospace ⇒ 缺字
 *   - ① !== 空白 → 确实画出了东西（不是豆腐块/空白）
 * sanity：ASCII 'A' 必须在字体里，所以 ① 必须 !== ②（证明量法不是恒真）。
 *
 * ⚠️ 对照组**必须**是「单独 monospace」，不能用「一个不存在的字体名 + monospace」。
 * 第二版踩了这个坑：字体名不存在时整条 font-family 列表解析失败，浏览器走**系统默认字体**；
 * 而 SpecPixel 缺字时回退到**列表里的 monospace**。两者本来就不同 →
 * 无论字体有没有缺口都判「不缺」，闸门永远报绿。
 * 这就是「闸门必须反向测」的又一个实例：不做反向测，它比没有闸门更危险。
 */
const puppeteer = require('puppeteer-core');
const { chromePath } = require('./_smoke-paths.cjs');

const BASE = process.env.SMOKE_BASE || 'http://localhost:4173/';

/** 页内执行：逐字渲染成像素后比对 */
const PROBE = async () => {
  /*
   * ⚠️ 必须先等字体加载完，否则画出来的是回退字形。
   * canvas 不会自动等 @font-face 的异步加载。
   */
  await document.fonts.ready;
  await document.fonts.load('24px "SpecPixel"', '参数世界测试');

  const SZ = 24;
  const cv = document.createElement('canvas');
  cv.width = SZ;
  cv.height = SZ;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  /** 画一个字符返回其像素字节（32 位整数数组的字符串摘要） */
  const stamp = (font, ch) => {
    ctx.clearRect(0, 0, SZ, SZ);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.font = `${SZ}px ${font}`;
    ctx.fillText(ch, 0, 0);
    return ctx.getImageData(0, 0, SZ, SZ).data.join(',');
  };

  // 对照组：单独 monospace。SpecPixel 缺字时正是回退到它，所以「两者像素相同」= 缺字。
  const PIXEL = `'SpecPixel', monospace`;
  const FALLBACK = 'monospace';
  const BLANK = stamp('monospace', ' '); // 空白基准

  const eq = (a, b) => a === b;

  // sanity：ASCII 必须在字体里，① 必须 !== ② —— 否则整个比对方法失效
  const methodWorks = !eq(stamp(PIXEL, 'A'), stamp(FALLBACK, 'A'));

  const text = document.body.innerText.replace(/\s+/g, '');
  const chars = [...new Set([...text])].filter((c) => c.codePointAt(0) > 0x7f);

  const missing = [];
  const blank = [];
  for (const ch of chars) {
    const p = stamp(PIXEL, ch);
    if (eq(p, stamp(FALLBACK, ch))) missing.push(ch);
    else if (eq(p, BLANK)) blank.push(ch);
  }

  return {
    checked: chars.length,
    missing,
    blank,
    methodWorks,
    sample: missing.slice(0, 20).join(''),
  };
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });

  const ROUTES = [
    '#/',
    '#/timeline',
    '#/rankings',
    '#/compare',
    '#/search?q=mate',
    '#/canvas',
    '#/globe',
  ];
  const allMissing = new Set();
  const allBlank = new Set();
  let methodOk = true;

  for (const r of ROUTES) {
    await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // networkidle2 曾因 vite preview 的 HMR websocket 长连接随机超时（2026-10-14 两次
    // 挂在 globe :268/:348）。换 domcontentloaded + fonts.ready：等字体加载是确定性
    // 信号，语义不减、随机红消除。
    await page
      .waitForFunction(() => document.fonts.status === 'loaded', { timeout: 10000 })
      .catch(() => {});
    await new Promise((res) => setTimeout(res, 800));
    const p = await page.evaluate(PROBE);
    if (!p.methodWorks) methodOk = false;
    p.missing.forEach((c) => allMissing.add(c));
    p.blank.forEach((c) => allBlank.add(c));
    console.log(
      `${r.padEnd(16)} 检查 ${String(p.checked).padStart(3)} 个非 ASCII 字符 · ` +
        (p.missing.length ? `❌ 回退 ${p.missing.length}` : '✅ 全部由 SpecPixel 渲染') +
        (p.blank.length ? ` · ⚠空白 ${p.blank.length}` : ''),
    );
  }

  console.log('');
  if (!methodOk) {
    console.log('❌ 量测方法本身失效（ASCII 也区分不开），本次结果不可信');
  } else if (allBlank.size) {
    console.log(`❌ ${allBlank.size} 个字符渲染为空白：${[...allBlank].join('')}`);
  } else if (allMissing.size) {
    console.log(`❌ ${allMissing.size} 个字符回退到系统字体：${[...allMissing].join('')}`);
  } else {
    console.log('✅ 字体覆盖完整：所有页面汉字均由 SpecPixel 渲染，无回退、无空白');
  }

  await browser.close();
  process.exit(!methodOk || allBlank.size || allMissing.size ? 1 : 0);
})();
