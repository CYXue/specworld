/**
 * 搜索容错的真机验证：在**真实页面**上逐条输入用户可能的写法，看结果与提示。
 *
 * 为什么不能只靠 selftest：selftest 验的是 lib/search.ts 的纯函数，
 * 而这里验的是「用户真打进去之后，看到的条数对不对、容错提示出不出来」。
 * 这两件事会不一致 —— 典型是页面把 brand 过滤也拼进去之后，
 * 结果集已经不是 lib 返回的那一批。
 *
 * 用法：node _smoke-search.cjs（需先 npm run build && npm run preview；
 * 端口由 vite.config.ts 的 preview.port 钉死为 4173，只监听 localhost）
 */
const path = require('path');
const puppeteer = require('puppeteer-core');
// 截图目录走集中解析（ensureShotsDir），不写死相对路径 ——
// 否则未先跑 _smoke-pixel 时目录不存在，这里直接 ENOENT。
const { chromePath, ensureShotsDir } = require('./_smoke-paths.cjs');

const BASE = process.env.SMOKE_BASE || 'http://localhost:4173/';

/**
 * [查询, 期望命中台数, 期望出现「容错提示」吗]
 *
 * ⚠️ 期望值是**实测数据**定的，不是拍的。第一版有三条写错了（详见 docs/PITFALLS.md）：
 *   · `mate-70-pro` 期望 1 → 实际 3（Mate 70 Pro / Pro+ / Pro 优享版）。
 *     `Pro` 是 `Pro+` 的子串，官方写法 `mate 70 pro` 同样命中 3 台 —— 结果是对的，
 *     错的是我「以为只有一台」。
 *   · `麒麟 9020` 期望 1 → 实际 3。芯片字段里 `麒麟 9020`、`麒麟 9020A 麒麟 9020B`、
 *     `麒麟9020` 三种写法分属三台机，全都该命中。
 * 教训与搜索那条同源：**期望值错了会把正确实现判成 bug，然后被「修」坏。**
 */
const CASES = [
  // 需求原文：官方是 nova 14 Ultra，但用户可能输入 nova14ultra
  ['nova 14 Ultra', 1, false],
  ['nova14ultra', 1, true],
  ['NOVA14ULTRA', 1, true],
  ['Nova 14 Ultra', 1, false],
  ['ＮＯＶＡ　１４　ＵＬＴＲＡ', 1, true],
  ['nova   14   ultra', 1, false],
  // 连字符 / 下划线（台数与官方写法一致，见上方说明）
  ['mate-70-pro', 3, true],
  ['mate_70_pro', 3, true],
  ['mate 70 pro', 3, false],
  // 中文连写（畅享 90 系列现为 4 台：90 / 90 Plus / 90 Pro Max / 90m Plus）
  ['华为畅享90', 4, true],
  ['华为畅享 90', 4, false],
  // 芯片名：数据里三种写法并存，三台都该命中
  ['麒麟9020', 3, false],
  ['麒麟 9020', 3, false],
  // 精确通道的 AND 语义：多一个词就该零结果
  ['nova 14 ultra pro', 0, false],
  // 完全不存在
  ['zzzz不存在', 0, false],
  // 空查询不应展示「全部」
  ['', 0, false],
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('[console] ' + m.text());
  });

  await page.goto(BASE + '#/search', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 700));

  let pass = 0;
  let fail = 0;

  for (const [q, wantCount, wantLooseNote] of CASES) {
    // 直接改 URL 状态（页面把 q 写进 query，等价于用户输入后回车）
    const url = BASE + '#/search' + (q ? `?q=${encodeURIComponent(q)}` : '');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 450));

    const got = await page.evaluate(() => {
      const aside = document.querySelector('header span.ml-auto');
      const m = aside?.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
      const note = Array.from(document.querySelectorAll('p')).find((p) =>
        p.textContent.includes('已忽略大小写与空格'),
      );
      return { count: m ? Number(m[1]) : -1, loose: Boolean(note) };
    });

    const okCount = got.count === wantCount;
    const okNote = got.loose === wantLooseNote;
    const ok = okCount && okNote;
    ok ? pass++ : fail++;
    console.log(
      `${ok ? '✅' : '❌'} ${JSON.stringify(q).padEnd(26)} 台数 ${String(got.count).padStart(2)}` +
        `(期望 ${String(wantCount).padStart(2)})  容错提示 ${got.loose ? '有' : '无'}` +
        `(期望 ${wantLooseNote ? '有' : '无'})`,
    );
  }

  // 截图一张容错提示
  await page.goto(BASE + '#/search?q=nova14ultra', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(ensureShotsDir(), 'search-loose.png') });

  /* ── 不变量：写法差异不得改变结果集 ──
   * 比逐条硬编码期望值更抗改：新增机型、改文案都不会让这条失效，
   * 而「同义写法结果不一致」这种 bug 一律抓得住。 */
  const PAIRED = [
    ['nova 14 Ultra', 'nova14ultra'],
    ['nova 14 Ultra', 'NOVA14ULTRA'],
    ['nova 14 Ultra', 'ＮＯＶＡ　１４　ＵＬＴＲＡ'],
    ['mate 70 pro', 'mate-70-pro'],
    ['mate 70 pro', 'mate_70_pro'],
    ['华为畅享 90', '华为畅享90'],
    ['麒麟 9020', '麒麟9020'],
  ];
  const countOf = async (q) => {
    await page.goto(BASE + '#/search?q=' + encodeURIComponent(q), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 400));
    return page.evaluate(() => {
      const m = document.querySelector('header span.ml-auto')?.textContent?.match(/(\d+)\s*\//);
      return m ? Number(m[1]) : -1;
    });
  };
  for (const [a, b] of PAIRED) {
    const ca = await countOf(a);
    const cb = await countOf(b);
    const ok = ca === cb && ca > 0;
    ok ? pass++ : fail++;
    console.log(
      `${ok ? '✅' : '❌'} 等价写法  ${JSON.stringify(a).padEnd(18)} = ${ca} 台  ` +
        `${JSON.stringify(b).padEnd(22)} = ${cb} 台`,
    );
  }

  console.log('');
  console.log(errors.length ? '❌ 运行时错误：\n' + errors.join('\n') : '✅ 零运行时错误');
  console.log(`搜索容错验证：${pass} 项通过，${fail} 项失败`);
  await browser.close();
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
})();
