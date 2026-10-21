// macDB 对账：sitemap → 详情页标题 → 与本站目录 diff
// 用法：node scripts/macdb-sync/reconcile.mjs [--fetch] [--json <out>]
// 默认读 _work/macdb-titles.txt 缓存；--fetch 重新拉取。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const WORK = ROOT + '_work/';

function siteProducts() {
  const d = JSON.parse(readFileSync(ROOT + 'data/products.json', 'utf8'));
  const list = d.products || d;
  return list.filter(p => !/华为|HUAWEI/i.test(p.name)).map(p => ({ id: p.id, name: p.name }));
}

function macdbTitles() {
  const f = WORK + 'macdb-titles.txt';
  if (!existsSync(f)) throw new Error('缺少 _work/macdb-titles.txt，先跑 --fetch');
  return readFileSync(f, 'utf8').split('\n').filter(Boolean)
    .map(line => { const [slug, title] = line.split('|');
      return { slug, name: (title || '').split('参数配置')[0].trim() }; })
    .filter(r => r.name);
}

function fetchAll() {
  mkdirSync(WORK + 'macdb-all', { recursive: true });
  console.log('拉取 sitemap…');
  const xml = execFileSync('curl', ['-s', 'https://macdb.cn/sitemap.xml'], { encoding: 'utf8' });
  const slugs = [...xml.matchAll(/macdb\.cn\/device\/([^<]*)/g)].map(m => m[1]);
  console.log('设备页:', slugs.length);
  writeFileSync(WORK + 'macdb-slugs.txt', [...new Set(slugs)].sort().join('\n'));
  // 标题与页面：并发 curl（12 路），断点续传
  const titles = WORK + 'macdb-titles.txt';
  execFileSync('bash', ['-c', `
    cat ${WORK}macdb-slugs.txt | xargs -P 12 -I{} sh -c 'test -s "${WORK}macdb-all/{}.html" || curl -s --max-time 20 "https://macdb.cn/device/{}" -o "${WORK}macdb-all/{}.html"'
    for f in ${WORK}macdb-all/*.html; do
      slug=$(basename "$f" .html)
      t=$(grep -o '<title>[^<]*</title>' "$f" | head -1 | sed 's/<\\/\\?title>//g')
      echo "$slug|$t"
    done | sort > ${titles}
  `], { stdio: 'inherit' });
  console.log('标题缓存:', readFileSync(titles, 'utf8').split('\n').filter(Boolean).length);
}

// ---- token 归一化（与历轮规则一致，含代数/英寸/全角标点）----
const CN_NUM = { '零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10 };
export function toks(s) {
  s = s.toLowerCase().replace(/（/g, '(').replace(/）/g, ')')
    .replace(/第\s*([一二三四五六七八九十\d]+)\s*代/g, (_, n) => ' gen' + (CN_NUM[n] ?? n) + ' ')
    .replace(/(\d+)(?:st|nd|rd|th)\s*generation/gi, ' gen$1 ')
    .replace(/(\d+(?:\.\d+)?)\s*(?:英寸|″|")/g, '$1in ');
  const out = [];
  for (const t of s.split(/[^a-z0-9.]+/).filter(Boolean)) out.push(/^\d+$/.test(t) ? 'gen' + t : t);
  return new Set(out);
}
const jac = (a, b) => { const i = [...a].filter(x => b.has(x)).length; return i / new Set([...a, ...b]).size; };

const args = process.argv.slice(2);
if (args.includes('--fetch')) fetchAll();

const site = siteProducts();
const titles = macdbTitles();
const matchTable = JSON.parse(readFileSync(new URL('./match-table.json', import.meta.url), 'utf8'));
const byId = new Map(site.map(p => [p.id, p]));
const mapped = new Map(matchTable.map(m => [m.slug, m]));

const report = { total: titles.length, mapped: 0, missing: [], dangling: [], catMismatch: [] };
for (const r of titles) {
  const m = mapped.get(r.slug);
  if (m) {
    report.mapped++;
    if (!byId.has(m.productId)) report.dangling.push({ slug: r.slug, productId: m.productId });
    continue;
  }
  // 未在映射表里 → 给出最高相似候选，供人工研判
  const t = toks(r.name);
  let best = null;
  for (const p of site) {
    const j = jac(t, toks(p.name));
    if (!best || j > best.j) best = { id: p.id, j: +j.toFixed(2) };
  }
  report.missing.push({ slug: r.slug, name: r.name, best });
}
for (const m of matchTable) {
  const p = byId.get(m.productId);
  if (!p) continue;
  // 跨品类粗检：slug 机型类别 vs 目标品类
  const catOf = (slug) => {
    if (/display$|monitor|portrait-display/.test(slug)) return 'display';
    if (/drive$|floppy|hard-disk|raid|hi-fi$/.test(slug)) return 'storage|audio';
    if (/earphones|headset/.test(slug)) return 'audio';
    if (/^ipad(?!-keyboard)/.test(slug)) return 'tablet';
    if (/^ipod-touch/.test(slug)) return 'phone|media';
    if (/^ipod/.test(slug)) return 'media|audio';
    if (/^iphone(?!-bluetooth|-stereo)/.test(slug)) return 'phone';
    if (/^airpods|^earpods|headphone/.test(slug)) return 'audio';
    if (/keyboard|mouse|trackpad|keypad|tablet$|pencil|remote|adapter|dock|folio/.test(slug)) return 'input|accessory';
    if (/watch/.test(slug)) return 'wearable';
    if (/^xserve/.test(slug)) return 'desktop|laptop|network|storage';
    if (/^imac|^mac-|^macintosh|^power-|^powerbook|^ibook|^emac|^workgroup|^lisa|^apple-i/.test(slug)) return 'desktop|laptop';
    return null;
  };
  const expect = catOf(m.slug);
  if (expect && !expect.split('|').includes(m.cat)) report.catMismatch.push({ slug: m.slug, productId: m.productId, cat: m.cat, expect });
}

console.log('macDB 设备:', report.total, ' 已映射:', report.mapped, ' 未映射:', report.missing.length);
if (report.dangling.length) console.log('⚠ 悬空引用:', report.dangling.length, report.dangling.slice(0, 5));
if (report.catMismatch.length) console.log('⚠ 品类可疑:', report.catMismatch.length, report.catMismatch.slice(0, 5));
for (const m of report.missing.slice(0, 30)) console.log('  -', m.slug, '|', m.name, '→ 最相似:', m.best?.id, `(${m.best?.j})`);

if (args.includes('--json')) {
  const out = args[args.indexOf('--json') + 1];
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log('报告已写:', out);
}
