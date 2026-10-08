const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox'],
  });
  const p = await b.newPage();
  for (const w of [1280, 390]) {
    await p.setViewport({ width: w, height: 900 });
    await p.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));
    const m = await p.evaluate(() => {
      const sec = document.querySelector('section.relative');
      const row = sec.querySelector('div.page-shell');
      const h1 = sec.querySelector('h1');
      const nav = sec.querySelector('nav, .pixel-nav, [class*="nav"]');
      const r = (e) => (e ? { t: Math.round(e.getBoundingClientRect().top), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) } : null);
      return {
        secH: Math.round(sec.getBoundingClientRect().height),
        row: r(row),
        h1: r(h1),
        nav: r(nav),
        // 内容实际占位：row 的高度 + 上padding
        contentBottom: row ? Math.round(row.getBoundingClientRect().bottom - sec.getBoundingClientRect().top) : null,
      };
    });
    console.log(w, JSON.stringify(m));
  }
  await b.close();
})();