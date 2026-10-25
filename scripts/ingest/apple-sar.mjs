/**
 * 苹果 SAR 取数折叠：渲染 regulatoryinfo.apple.com RF 暴露页 → data/overrides.json。
 *
 * 纪律（沿袭 macdb-sync/fill.mjs 的形状）：
 *   - 只填**空缺**字段，已有值一律不碰（幂等，可反复跑）；
 *   - 默认预演，--apply 才写盘；写盘前留备份到 _work/；
 *   - 取不到值 = 官网没公布 = 跳过（记入 skipped 报告），绝不编造；
 *   - 来源统一标 source='apple-regulatory'，reason 带机型标识与页面 URL 可回溯。
 *
 * 用法：
 *   node scripts/ingest/apple-sar.mjs            # 预演
 *   node scripts/ingest/apple-sar.mjs --apply    # 写盘（备份到 _work/）
 *   node scripts/ingest/apple-sar.mjs --limit 3  # 只跑前 3 台（试跑）
 *
 * 渲染：页面是 Angular 客户端渲染（直连 HTML 无值），用 puppeteer-core + 系统 Chrome
 * （CHROME_PATH 可覆盖，探测逻辑与 scripts/smoke/_smoke-paths.cjs 同源）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import pathMod, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSarText } from './apple-sar-parse.mjs';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx > -1 ? Number(process.argv[limitIdx + 1]) : Infinity;

// ---------- Chrome 定位（与 smoke 同源：显式 CHROME_PATH > 常见系统路径，找不到就抛清晰错误） ----------
function findChrome() {
  const explicit = process.env.CHROME_PATH;
  const candidates = explicit
    ? [explicit]
    : process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          pathMod.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium',
        ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    '找不到 Chrome / Chromium。请设置 CHROME_PATH，例如：set CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe',
  );
}

// ---------- 产品清单：phone 品类 + 有 device.identifier + SAR 仍为空 ----------
const products = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
const targets = products.products.filter(
  (p) =>
    p.category === 'phone' &&
    p.brand === 'apple' &&
    p.specs['device.identifier'] &&
    p.specs['device.sarHeadWkg'] === undefined &&
    p.specs['device.sarBodyWkg'] === undefined,
);
const batch = targets.slice(0, Number.isFinite(LIMIT) ? LIMIT : targets.length);
console.log(`目标 ${batch.length} / ${targets.length} 台（SAR 空缺的 Apple 手机）${APPLY ? ' [APPLY]' : ' [预演]'}`);

// ---------- 渲染取值 ----------
const puppeteer = require('puppeteer-core');
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setUserAgent(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
);

/** identifier → 页面路径（regulatoryinfo 的路径形如 iPhone16,2；小写 iphone 也通） */
const pageUrl = (id) => `https://regulatoryinfo.apple.com/rfexposure/${encodeURIComponent(id)}/en`;

const fetched = []; // { productId, identifier, url, rows }
const skipped = []; // { productId, identifier, reason }
for (const p of batch) {
  const id = p.specs['device.identifier'];
  const url = pageUrl(id);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    // Angular 渲染完成标志：出现 "SAR" 字样；最多再等 8s
    await page
      .waitForFunction(() => document.body.innerText.includes('SAR'), { timeout: 8000 })
      .catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    const rows = parseSarText(text);
    if (!rows.length) {
      skipped.push({ productId: p.id, identifier: id, reason: '页面无 2.0(10g) SAR 段' });
      console.log(`  ⚠ ${p.id} (${id})：无 10g 口径数据，跳过`);
      continue;
    }
    // 多 Model 段取首个完整行（苹果同型号多变体的 10g 值通常一致；差异页会在 Model 行标注）
    fetched.push({ productId: p.id, identifier: id, url, rows });
    console.log(`  ✓ ${p.id} (${id})：Head ${rows[0].head10g} / Body ${rows[0].body10g} W/kg（${rows.length} 个 Model 段）`);
  } catch (e) {
    skipped.push({ productId: p.id, identifier: id, reason: `抓取失败：${e.message.slice(0, 80)}` });
    console.log(`  ✗ ${p.id} (${id})：${e.message.slice(0, 80)}`);
  }
}
await browser.close();

// ---------- 折叠进 overrides（只填空缺） ----------
mkdirSync(join(ROOT, '_work'), { recursive: true });
const report = { at: new Date().toISOString(), fetched: fetched.length, skipped };
writeFileSync(
  join(ROOT, '_work/apple-sar-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);

if (!fetched.length) {
  console.log('没有取到任何数据，未写盘。明细见 _work/apple-sar-report.json');
  process.exit(0);
}

if (APPLY) {
  const backup = join(ROOT, '_work/overrides.pre-apple-sar.json');
  writeFileSync(backup, readFileSync(join(ROOT, 'data/overrides.json')));
  const overrides = JSON.parse(readFileSync(join(ROOT, 'data/overrides.json')));
  const today = new Date().toISOString().slice(0, 10);
  let seq = overrides.entries.length + 1;
  const existingKeys = new Set(overrides.entries.map((e) => `${e.op}:${e.productId}:${e.field}`));
  const added = [];
  for (const f of fetched) {
    const { head10g, body10g } = f.rows[0];
    const pairs = [
      ['device.sarHeadWkg', head10g],
      ['device.sarBodyWkg', body10g],
    ];
    for (const [field, value] of pairs) {
      const key = `set-field:${f.productId}:${field}`;
      if (existingKeys.has(key)) continue; // 已有同键条目（包括值）一律不重复
      added.push({
        id: `ovr-apple-sar-${String(seq++).padStart(4, '0')}`,
        op: 'set-field',
        productId: f.productId,
        field,
        value,
        reason: `苹果 RF 暴露页 SAR（over 10g 口径，identifier ${f.identifier}）——${f.url}`,
        createdAt: today,
        active: true,
        source: 'apple-regulatory',
      });
    }
  }
  overrides.entries.push(...added);
  writeFileSync(join(ROOT, 'data/overrides.json'), JSON.stringify(overrides, null, 2) + '\n');
  console.log(`已写盘：新增 ${added.length} 条 set-field（备份：${backup}）`);
  console.log('请跑：npm run selftest && node scripts/pipeline.mjs --data-only');
} else {
  console.log(`（预演模式，未写盘。取到 ${fetched.length} 台；--apply 生效。明细：_work/apple-sar-report.json）`);
}
