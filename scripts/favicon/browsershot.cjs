/** 在**真实浏览器**里按 favicon 的实际显示尺寸验证（浅色/深色标签栏各一份）。
 *
 * ## 为什么不能用 PIL 拼图代替
 * PIL 预览要么 1:1（16px 只有 16 个像素，看不清细节），
 * 要么用 NEAREST 放大（每格放大 15 倍 ⇒ 1px 环看着像 15px 粗，**严重误导**）。
 * 唯一能回答「16px 下读不读得出太极」的测法：
 * **让 Chrome 把 SVG 栅格化到 16px**，再用 deviceScaleFactor 放大截图。
 *
 * 用法: node scripts/favicon/browsershot.cjs out.png <svg> [svg...]
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SCALE = 8;   // deviceScaleFactor：栅格化后放大这么多倍看
const SIZES = [16, 20, 24, 32, 48];
const THEMES = [
  ['light', '#f5f5f7', '#1b1c20'], // 标签栏底色, 文字色
  ['dark', '#1b1c20', '#e8e8ea'],
];

(async () => {
  const [out, ...files] = process.argv.slice(2);
  if (!out || !files.length) {
    console.error('用法: node scripts/favicon/browsershot.cjs out.png <svg> [svg...]');
    process.exit(1);
  }

  const b = await puppeteer.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  // ⚠️ CSS 布局必须用 **1:1 真实像素**（图标 width=n 就是 n CSS px）。
  // 放大**只**由 deviceScaleFactor 提供。若布局里也乘 SCALE 就会放大两次
  // （实测截图 50496×6832 ≈ 3.4亿像素，直接触发 PIL 的解压炸弹）。
  const cellW = Math.max(...SIZES) + 14;
  const rowH = Math.max(...SIZES) + 26;
  const W = 24 + files.length * (SIZES.length * cellW + 18);
  const H = 24 + THEMES.length * (rowH + 26);

  const rows = THEMES.map(([theme, bg, fg]) => {
    const cells = files
      .map(
        (f) => `<div style="width:${SIZES.length * cellW}px;display:flex">` +
          SIZES.map(
            (n) =>
              `<div style="width:${cellW}px;text-align:center;color:${fg};font:11px monospace">` +
              `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(
                fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, ''),
              )}" width="${n}" height="${n}">` +
              `<div>${n}px</div></div>`,
          ).join('') +
          `</div>`,
      )
      .join('');
    return `<div style="background:${bg};padding:10px 18px"><div style="color:${fg};font:11px monospace">${theme} tab bar</div>${cells}</div>`;
  }).join('');

  const pg = await b.newPage();
  await pg.setViewport({ width: W, height: H, deviceScaleFactor: SCALE });
  await pg.setContent(
    `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#8a8f9c;width:${W}px">${rows}</body>`,
    { waitUntil: 'load' },
  );
  await pg.waitForFunction(
    () => [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 30000 },
  );
  fs.writeFileSync(out, await pg.screenshot({ clip: { x: 0, y: 0, width: W, height: H } }));
  await b.close();
  console.log('->', out, `${W * SCALE}x${H * SCALE}`);
})();