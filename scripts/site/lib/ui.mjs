/**
 * 站点共享库：设计系统、页面壳、品牌标识、格式化。
 *
 * 三条纪律：
 *   1. **零外链、零密钥、零行为脚本。** 每个页面把 CSS 内联进 <style>，
 *      双击 index.html 就能看，不需要起服务器。
 *   2. **缺数据长成「官方未公布」的样子**，绝不用 0、—、N/A 冒充。
 *   3. **文案由数据套模板**，不调用 LLM，逐字可追溯到 data/products.json 的某个字段。
 */

/* ------------------------------------------------------------------ *
 * 一、HTML 转义 —— 所有插值都必须过这一层
 * ------------------------------------------------------------------ */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ *
 * 二、品牌标识
 * ------------------------------------------------------------------ *
 * 不用厂商 logo（商标风险 + 零外链要求），改用 monogram 徽章：
 * 品牌首字母 + 品牌色，一眼可辨，零依赖。
 * 产品线（Mate / Pura / iPhone…）另有自己的色相映射，用于导航与分组。
 */

export const BRANDS = {
  apple: {
    id: 'apple',
    name: 'Apple',
    nameZh: '苹果',
    monogram: 'A',
    accent: '#0071e3',
    accentSoft: 'rgba(0,113,227,.10)',
    accentLine: 'rgba(0,113,227,.32)',
    country: 'US',
    countryLabel: '美国',
    region: 'global',
  },
  huawei: {
    id: 'huawei',
    name: 'HUAWEI',
    nameZh: '华为',
    monogram: 'H',
    accent: '#cf0a2c',
    accentSoft: 'rgba(207,10,44,.10)',
    accentLine: 'rgba(207,10,44,.32)',
    country: 'CN',
    countryLabel: '中国',
    region: 'cn',
  },
};

export function brandOf(id) {
  return BRANDS[id] ?? { id, name: id, nameZh: id, monogram: '?', accent: '#8a8f98', accentSoft: 'rgba(138,143,152,.10)', accentLine: 'rgba(138,143,152,.3)', country: '??', countryLabel: '未知', region: 'other' };
}

/** 品牌徽章：首字母 + 品牌色。用 CSS 变量承载颜色，页面自包含 */
export function badge(product, { size = 'md' } = {}) {
  const b = brandOf(product.brand);
  const px = size === 'lg' ? 44 : size === 'sm' ? 22 : 30;
  const fs = size === 'lg' ? 19 : size === 'sm' ? 11 : 14;
  return `<span class="badge ${size}" style="--bw:${px}px;--bf:${fs}px;background:${b.accentSoft};color:${b.accent};border-color:${b.accentLine}" title="${esc(b.nameZh)}">${esc(b.monogram)}</span>`;
}

/**
 * 产品线色相：同品牌下不同产品线给不同色相，用于时间线与列表的视觉分组。
 * 色相固定写死（不按名字哈希生成），保证每次构建颜色稳定。
 */
export const LINE_HUES = {
  Mate: 348, Pura: 322, nova: 18, 畅享: 42, Pocket: 280, iPhone: 210,
};
export function lineColor(line) {
  const h = LINE_HUES[line];
  if (h === undefined) return { h: 220, s: 12, l: 46 };
  return { h, s: 62, l: 44 };
}

/* ------------------------------------------------------------------ *
 * 三、格式化
 * ------------------------------------------------------------------ */

/** 「官方未公布」是这个站点的诚实底线：任何缺失都走这里 */
export const UNPUB = '<span class="unpub">官方未公布</span>';

export function fmtNum(v, digits = 0) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPrice(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return `¥${v.toLocaleString('zh-CN')}`;
}

export function fmtDate(iso, { withYear = false } = {}) {
  if (!iso) return null;
  const s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return withYear ? s : s.slice(5);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}$/.test(s)) return s;
  return null;
}

export function fmtMonth(m) {
  if (!m) return null;
  const [y, mo] = String(m).split('-');
  return `${y} 年 ${Number(mo)} 月`;
}

export function fmtSize(v) {
  return typeof v === 'number' ? `${v} 英寸` : null;
}

/** 分位 → 百分数文本 */
export function fmtPct(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return `${Math.round(score * 100)}`;
}

/* ------------------------------------------------------------------ *
 * 四、页面壳
 * ------------------------------------------------------------------ */

const CSS = `
:root{
  --ink:#16181c;--ink2:#4b525c;--ink3:#767d88;--ink4:#a6acb6;
  --line:#e3e6ea;--line2:#eef0f3;--line3:#f6f7f9;
  --bg:#f5f6f8;--card:#fff;--card2:#fafbfc;
  --accent:#1b64d9;--accentSoft:rgba(27,100,217,.09);--accentLine:rgba(27,100,217,.28);
  --gold:#b8860b;--goldSoft:rgba(184,134,11,.11);
  --sans:system-ui,-apple-system,"PingFang SC","Microsoft YaHei","Noto Sans SC","Hiragino Sans GB",sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono","Cascadia Mono",Consolas,monospace;
  --maxw:1140px;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
h1,h2,h3{margin:0;font-weight:650;letter-spacing:-.01em}
.unpub{color:var(--ink4);font-size:.92em;font-weight:400}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}

.wrap{max-width:var(--maxw);margin:0 auto;padding:0 20px 72px}

/* 顶栏 */
.topbar{position:sticky;top:0;z-index:50;background:rgba(245,246,248,.86);backdrop-filter:saturate(180%) blur(14px);border-bottom:1px solid var(--line)}
.topbar-in{max-width:var(--maxw);margin:0 auto;padding:11px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.brandmark{display:flex;align-items:center;gap:9px;font-weight:700;font-size:15px;letter-spacing:-.02em;flex-shrink:0}
.brandmark .dot{width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#7aa8ff);flex-shrink:0}
.nav{display:flex;gap:2px;flex-wrap:wrap;flex:1;min-width:0}
.nav a{padding:5px 11px;border-radius:8px;font-size:13.5px;color:var(--ink2);white-space:nowrap;transition:background .12s,color .12s}
.nav a:hover{background:rgba(0,0,0,.05);color:var(--ink)}
.nav a.on{background:var(--card);color:var(--ink);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.06)}

/* 搜索 */
.searchbox{position:relative;flex-shrink:0;min-width:210px}
.searchbox input{width:100%;padding:7px 12px 7px 30px;border:1px solid var(--line);border-radius:9px;background:var(--card);font:inherit;font-size:13px;color:var(--ink);outline:none;transition:border-color .12s,box-shadow .12s}
.searchbox input:focus{border-color:var(--accentLine);box-shadow:0 0 0 3px var(--accentSoft)}
.searchbox .ico{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--ink4);font-size:13px;pointer-events:none}
.searchbox .hint{position:absolute;right:9px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--ink4);font-family:var(--mono);pointer-events:none}
.sres{position:absolute;top:calc(100% + 6px);left:0;right:0;background:var(--card);border:1px solid var(--line);border-radius:11px;box-shadow:0 10px 34px rgba(0,0,0,.13);overflow:hidden;display:none;max-height:min(64vh,460px);overflow-y:auto}
.sres.open{display:block}
.sres .grp{padding:7px 13px 4px;font-size:11px;color:var(--ink4);letter-spacing:.06em;background:var(--card2);border-bottom:1px solid var(--line2);position:sticky;top:0}
.sres a{display:flex;align-items:center;gap:9px;padding:8px 13px;border-bottom:1px solid var(--line2);font-size:13px}
.sres a:last-child{border-bottom:0}
.sres a:hover,.sres a.sel{background:var(--accentSoft)}
.sres .nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sres .mt{margin-left:auto;font-size:11.5px;color:var(--ink3);white-space:nowrap;flex-shrink:0}
.sres .empty{padding:16px 13px;color:var(--ink3);font-size:12.5px;text-align:center}

/* 卡片 */
.card{background:var(--card);border:1px solid var(--line);border-radius:15px;padding:18px 20px;margin:15px 0}
.card>h2{font-size:15.5px;margin-bottom:4px;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.card>h2 .c{font-size:12px;color:var(--ink3);font-weight:400}
.card>h2 .c b{color:var(--ink2);font-weight:600}
.lede{color:var(--ink2);font-size:13px;margin:0 0 14px}

/* 冠军 */
.champs{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:10px}
.champ{display:block;background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:11px 13px;transition:border-color .12s,transform .12s}
.champ:hover{border-color:var(--ink4);transform:translateY(-1px)}
.champ .t{font-size:11.5px;color:var(--ink3)}
.champ .v{font-size:14.5px;font-weight:650;margin:3px 0 1px;line-height:1.3}
.champ .w{font-size:12px;color:var(--ink2);font-family:var(--mono)}
.champ .d{font-size:11px;color:var(--ink4);margin-top:3px}
.champ.gold{background:var(--goldSoft);border-color:rgba(184,134,11,.3)}
.champ.gold .t{color:var(--gold)}

/* 能力条 */
.axes{display:grid;gap:7px}
.axrow{display:grid;grid-template-columns:44px 1fr 40px;align-items:center;gap:9px;font-size:12px}
.axrow .lb{color:var(--ink3)}
.axbar{height:7px;background:var(--line2);border-radius:4px;overflow:hidden;position:relative}
.axbar i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,var(--accent),#69a0ff);transition:width .3s}
.axbar.na{background:repeating-linear-gradient(45deg,var(--line2),var(--line2) 4px,var(--line3) 4px,var(--line3) 8px)}
.axrow .nm{text-align:right;font-family:var(--mono);font-size:11.5px;color:var(--ink2)}
.axrow.zero .nm{color:var(--ink4)}

/* 网格 */
.grid{display:grid;gap:11px}
.g2{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.g3{grid-template-columns:repeat(auto-fill,minmax(232px,1fr))}
.g4{grid-template-columns:repeat(auto-fill,minmax(184px,1fr))}

/* 机型卡 */
.pcard{display:block;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:13px 14px;transition:border-color .12s,box-shadow .12s,transform .12s;min-width:0}
.pcard:hover{border-color:var(--ink4);box-shadow:0 3px 14px rgba(0,0,0,.07);transform:translateY(-1px)}
.pcard .top{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.pcard .bn{font-size:11.5px;color:var(--ink3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pcard h3{font-size:14px;line-height:1.35;margin-bottom:2px;overflow-wrap:anywhere}
.pcard .sub{font-size:11.5px;color:var(--ink3);margin-bottom:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.pcard .sub .sep{color:var(--line)}
.pcard .price{font-family:var(--mono);font-size:13.5px;font-weight:650;margin-bottom:7px}
.pcard .sp{font-size:11.5px;color:var(--ink2);font-family:var(--mono);margin-bottom:8px;overflow-wrap:anywhere}
.pcard .foot{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.tag{display:inline-block;padding:1.5px 7px;border-radius:5px;font-size:10.5px;background:var(--line3);color:var(--ink3);white-space:nowrap}
.tag.line{background:hsl(var(--lh,220) 62% 44% / .11);color:hsl(var(--lh,220) 62% 34%)}
.tag.fold{background:rgba(120,80,220,.12);color:#5b3fb0}

/* 徽章 */
.badge{display:inline-flex;align-items:center;justify-content:center;width:var(--bw);height:var(--bw);border-radius:8px;border:1px solid;font-weight:700;font-size:var(--bf);font-family:var(--mono);flex-shrink:0;line-height:1}
.badge.lg{border-radius:11px}

/* 表 */
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11.5px;color:var(--ink3);font-weight:500;padding:7px 9px;border-bottom:1.5px solid var(--line);white-space:nowrap}
td{padding:8px 9px;border-bottom:1px solid var(--line2);vertical-align:top}
tr:last-child td{border-bottom:0}
td.n{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.rk{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;background:var(--line3);color:var(--ink2);font-family:var(--mono);font-size:11.5px;font-weight:600}
.rk.g1{background:linear-gradient(135deg,#f5d97a,#e0b53c);color:#5a4208}
.rk.g2{background:linear-gradient(135deg,#e2e5ea,#c3c8d1);color:#4a5058}
.rk.g3{background:linear-gradient(135deg,#e8c9a8,#cd9f76);color:#5c3d20}

/* 筛选 */
.filters{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:13px}
.filters .fl{font-size:11.5px;color:var(--ink4);margin-right:1px}
.chip{padding:4px 11px;border:1px solid var(--line);border-radius:20px;background:var(--card);font-size:12.5px;color:var(--ink2);cursor:pointer;transition:all .12s;user-select:none}
.chip:hover{border-color:var(--ink4)}
.chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}

/* 时间线 */
.tl{position:relative;padding-left:22px}
.tl:before{content:'';position:absolute;left:6px;top:6px;bottom:6px;width:2px;background:linear-gradient(180deg,var(--accentLine),var(--line2))}
.tlmon{position:relative;margin-bottom:20px}
.tlmon:before{content:'';position:absolute;left:-19px;top:5px;width:11px;height:11px;border-radius:50%;background:var(--card);border:2.5px solid var(--accent)}
.tlmon.dim:before{border-color:var(--ink4)}
.tlh{display:flex;align-items:baseline;gap:9px;margin-bottom:8px;flex-wrap:wrap}
.tlh .m{font-size:14px;font-weight:650}
.tlh .n{font-size:11.5px;color:var(--ink3)}
.tlrow{display:flex;gap:7px;flex-wrap:wrap}

/* 详情页 */
.hero{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:start;padding:4px 0 2px}
.hero .info{min-width:0}
.hero h1{font-size:25px;line-height:1.22;margin:2px 0 5px;overflow-wrap:anywhere}
.hero .meta{font-size:12.5px;color:var(--ink3);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.persona{margin:12px 0 0;padding:9px 13px;border-left:3px solid var(--accent);background:var(--accentSoft);border-radius:0 8px 8px 0;font-size:13.5px;line-height:1.55}
.kv{display:grid;grid-template-columns:78px 1fr;gap:0;font-size:13px}
.kv dt{padding:8px 10px 8px 0;color:var(--ink3);border-bottom:1px solid var(--line2);white-space:nowrap}
.kv dd{padding:8px 0;margin:0;border-bottom:1px solid var(--line2);overflow-wrap:anywhere}
.kv dt:last-of-type,.kv dd:last-of-type{border-bottom:0}

.cols{display:grid;grid-template-columns:1fr 1fr;gap:15px}
@media (max-width:860px){.cols{grid-template-columns:1fr}}

.ana{display:flex;gap:11px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--line2);flex-wrap:wrap}
.ana:last-child{border-bottom:0}
.ana .lb{font-size:12.5px;color:var(--ink2);min-width:130px;flex-shrink:0}
.ana .vl{font-size:15px;font-weight:650;font-family:var(--mono)}
.ana .fr{font-size:11.5px;color:var(--ink4);margin-left:auto}
.ana .as{font-size:11px;color:var(--ink4);flex-basis:100%;padding-left:0}

/* 提示条 */
.note{display:flex;gap:9px;padding:10px 13px;border-radius:10px;background:var(--card2);border:1px solid var(--line);font-size:12.5px;color:var(--ink2);margin:12px 0}
.note.warn{background:#fff8e8;border-color:rgba(184,134,11,.28);color:#6b4f0d}
.note b{color:inherit}

.ratingbox{display:flex;align-items:center;gap:11px;padding:14px 16px;border:1px dashed var(--line);border-radius:11px;background:var(--card2)}
.ratingbox .big{font-size:15px;color:var(--ink3)}
.ratingbox .sm{font-size:11.5px;color:var(--ink4);margin-top:1px}
.stars{color:var(--line);font-size:17px;letter-spacing:1.5px}

footer{margin-top:34px;padding-top:18px;border-top:1px solid var(--line);font-size:11.5px;color:var(--ink4);line-height:1.75}
footer a{color:var(--ink3);text-decoration:underline;text-underline-offset:2px}
.srcline{font-size:11px;color:var(--ink4);margin-top:5px}

@media (max-width:640px){
  .wrap,.topbar-in{padding-left:14px;padding-right:14px}
  .g4,.g3{grid-template-columns:repeat(2,1fr)}
  .g2{grid-template-columns:1fr}
  .hero{grid-template-columns:1fr}
  .searchbox{order:10;width:100%;min-width:0}
  .ana .lb{min-width:0}
}
`;

/**
 * 页面壳。
 * @param {object} o
 * @param {string} o.title      浏览器标题（不含站名）
 * @param {string} o.body       主体 HTML
 * @param {string} [o.nav]      当前激活的导航项 key
 * @param {number} [o.depth]    相对站点根的层级（0=根，1=子目录），决定 <base> 与链接前缀
 * @param {boolean} [o.search]  是否显示搜索框
 */
export function shell({ title, body, nav = '', depth = 0, search = true, lede = '' }) {
  const root = depth === 0 ? '' : '../'.repeat(depth);
  const navItems = [
    { key: 'home', href: `${root}index.html`, label: '今日格局' },
    { key: 'categories', href: `${root}categories.html`, label: '分类' },
    { key: 'rankings', href: `${root}rankings.html`, label: '排行榜' },
    { key: 'brands', href: `${root}brands.html`, label: '厂商' },
    { key: 'timeline', href: `${root}timeline.html`, label: '时间线' },
    { key: 'all', href: `${root}all.html`, label: '全部机型' },
  ];
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · 手机参数世界</title>
<meta name="description" content="华为与苹果在售手机参数的可核查对比。数据全部来自厂商官网，缺失项标注「官方未公布」，不做估算。">
<style>${CSS}</style>
</head>
<body>
<header class="topbar"><div class="topbar-in">
<a class="brandmark" href="${root}index.html"><span class="dot"></span>手机参数世界</a>
<nav class="nav">${navItems.map((n) => `<a href="${n.href}"${n.key === nav ? ' class="on"' : ''}>${n.label}</a>`).join('')}</nav>
${search ? searchBox(root) : ''}
</div></header>
<div class="wrap">
${lede ? `<p class="lede" style="margin-top:18px">${lede}</p>` : ''}
${body}
<footer>
  参数全部取自厂商官网规格页与官方对比页，缺失项一律标注「官方未公布」，本站不做任何估算或填充。<br>
  本站不做跑分评分：手机圈没有可公开核查的第三方成绩源，给不出「综合性能分」，因此只展示官方客观参数。<br>
  <span class="srcline" id="srcline"></span>
</footer>
</div>
${search ? searchScript(root) : ''}
</body>
</html>`;
}

/** 搜索框 + 结果容器。结果由内联索引在浏览器端算，不发任何请求 */
function searchBox(root) {
  return `<div class="searchbox">
  <span class="ico">⌕</span>
  <input type="search" id="q" placeholder="搜机型、厂商、能力…" autocomplete="off" spellcheck="false" aria-label="搜索">
  <span class="hint">/</span>
  <div class="sres" id="sres" role="listbox"></div>
</div>`;
}

/**
 * 搜索脚本。
 * 索引由 <script> 注入的 window.__SW_INDEX__ 提供（构建时内联进本页）。
 * 无 fetch、无外链 —— file:// 直接双击也能用。
 */
function searchScript(root) {
  return `<script>
(function(){
  var IDX = window.__SW_INDEX__ || {items:[]};
  var input = document.getElementById('q');
  var box = document.getElementById('sres');
  if(!input || !box) return;
  var items = IDX.items || [];
  var cur = -1;
  /**
   * 站内相对路径前缀。深层页面（brand/、products/）需要 "../"。
   * 修复记录（2026-10-02）：这个变量原来直接写 \`root\`，但那只是 ui.mjs 函数的形参名，
   * 浏览器端根本没有它 —— 渲染第一条结果时抛 "root is not defined"，
   * 整个搜索静默失效（点任何关键词都是 0 结果）。
   */
  var root = ${JSON.stringify(root)};

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}

  function score(it, q){
    // 完全匹配优先：名称前缀 > 名称包含 > 厂商匹配 > 标签匹配
    var n = it.n.toLowerCase(), v = (it.v||'').toLowerCase(), tags = (it.t||[]).join(' ').toLowerCase();
    if(n === q) return 100;
    if(n.indexOf(q) === 0) return 90;
    if(n.indexOf(q) >= 0) return 70;
    if(v.indexOf(q) >= 0) return 55;
    for(var i=0;i<(it.t||[]).length;i++){ if(it.t[i].toLowerCase().indexOf(q) === 0) return 45; }
    if(tags.indexOf(q) >= 0) return 25;
    return 0;
  }

  function render(q){
    if(!q || q.length < 1){ box.className='sres'; box.innerHTML=''; return; }
    var ql = q.toLowerCase().trim();
    var hits = [];
    for(var i=0;i<items.length;i++){ var s = score(items[i], ql); if(s>0) hits.push({it:items[i], s:s}); }
    if(!hits.length){
      box.className='sres open';
      box.innerHTML = '<div class="empty">没有匹配「'+esc(q)+'」的机型<br><span style="font-size:11.5px">试试：折叠 / 长续航 / 便宜 / 苹果</span></div>';
      return;
    }
    hits.sort(function(a,b){ return b.s - a.s || a.it.n.length - b.it.n.length; });
    var top = hits.slice(0,40);
    var h = '';
    if(hits.length > top.length){
      h += '<div class="grp">前 '+top.length+' 条（共 '+hits.length+' 条匹配）</div>';
    }
    for(var i=0;i<top.length;i++){
      var it = top[i].it;
      h += '<a href="'+root+'products/'+it.id+'.html" data-i="'+i+'">'
        + '<span class="badge sm" style="--bw:22px;--bf:11px;background:'+it.c+'1f;color:'+it.c+';border-color:'+it.c+'55">'+esc(it.m)+'</span>'
        + '<span class="nm">'+esc(it.n)+'</span>'
        + '<span class="mt">'+esc(it.v)+(it.p?' · '+esc(it.p):'')+'</span></a>';
    }
    box.className='sres open';
    box.innerHTML = h;
    cur = -1;
  }

  input.addEventListener('input', function(){ render(input.value); });
  input.addEventListener('focus', function(){ if(input.value) render(input.value); });
  input.addEventListener('blur', function(){ setTimeout(function(){ box.className='sres'; }, 160); });
  input.addEventListener('keydown', function(e){
    var links = box.querySelectorAll('a');
    if(e.key === 'Escape'){ box.className='sres'; input.blur(); return; }
    if(e.key === 'Enter'){
      var first = box.querySelector('.sres a');
      if(first){ location.href = first.getAttribute('href'); }
      return;
    }
    if(e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if(!links.length) return;
    e.preventDefault();
    if(cur >= 0) links[cur].classList.remove('sel');
    cur = e.key === 'ArrowDown'
      ? (cur + 1) % links.length
      : (cur - 1 + links.length) % links.length;
    links[cur].classList.add('sel');
    links[cur].scrollIntoView({block:'nearest'});
  });
  document.addEventListener('keydown', function(e){
    if(e.key === '/' && document.activeElement !== input){
      e.preventDefault(); input.focus();
    }
  });
})();
</script>`;
}

/**
 * 把搜索索引内联进页面（在 <head> 之前，由各页面调用拼进 shell 之外）。
 * 单独导出是因为它是 <script> 块，必须紧跟 shell 输出。
 */
export function searchIndexBlock(index) {
  return `<script>window.__SW_INDEX__=${JSON.stringify(index)};</script>`;
}

/* ------------------------------------------------------------------ *
 * 五、可复用片段
 * ------------------------------------------------------------------ */

/** 能力条组。score 为 null 时画成斜纹空条 + 「未公布」，绝不用 0 冒充 */
export function axesBlock(detail, dims, { compact = false } = {}) {
  return `<div class="axes">${dims
    .map((dim) => {
      const ax = detail.axes[dim.key];
      const has = ax && typeof ax.score === 'number';
      const pct = has ? Math.round(ax.score * 100) : 0;
      return `<div class="axrow${has ? '' : ' zero'}" title="${esc(
        has
          ? `${dim.label}：由 ${ax.covered}/${ax.total} 项已公布参数算出（${dim.desc}）`
          : `${dim.label}：已公布参数不足 ${dim.minParts} 项，本站不给分`
      )}">
        <span class="lb">${esc(dim.label)}</span>
        <span class="axbar${has ? '' : ' na'}">${has ? `<i style="width:${pct}%"></i>` : ''}</span>
        <span class="nm">${has ? pct : '—'}</span>
      </div>`;
    })
    .join('')}</div>`;
}

/**
 * 机型卡（列表/分类/搜索结果通用）。
 * @param {object} o
 * @param {number} [o.depth] 相对站点根的层级，深层页面（brand/、products/）需要 ../ 前缀
 */
export function productCard(p, detail, A, { depth = 0 } = {}) {
  const b = brandOf(p.brand);
  const lh = lineColor(p.line);
  const root = depth === 0 ? '' : '../'.repeat(depth);
  const price = detail.price;
  const size = typeof p.display?.sizeIn === 'number' ? `${p.display.sizeIn}″` : null;
  const tags = [
    p.line ? `<span class="tag line" style="--lh:${lh.h}">${esc(p.line)}</span>` : '',
    detail.formFactor === 'foldable' ? '<span class="tag fold">折叠</span>' : '',
    p.status === 'on-sale' ? '' : `<span class="tag">${esc(p.status)}</span>`,
  ].filter(Boolean).join('');
  return `<a class="pcard" href="${root}products/${esc(p.id)}.html">
  <div class="top">${badge(p, { size: 'sm' })}<span class="bn">${esc(b.nameZh)}</span></div>
  <h3>${esc(p.name)}</h3>
  <div class="sub">${p.releaseDate ? `<span class="mono">${esc(fmtDate(p.releaseDate))}</span>` : '<span class="unpub">上市日期未公布</span>'}</div>
  <div class="price">${price !== null ? esc(fmtPrice(price)) : UNPUB}</div>
  <div class="sp">${[
    size ?? '<span class="unpub">尺寸未公布</span>',
    typeof p.body?.weightG === 'number' ? `${p.body.weightG} g` : null,
    typeof p.body?.thicknessMm === 'number' ? `${p.body.thicknessMm} mm` : null,
  ].filter(Boolean).join(' · ')}</div>
  <div class="foot">${tags}</div>
</a>`;
}

/** 冠军卡：值 + 凭什么（把判定依据写出来，而不是只给结论） */
export function champCard({ title, product, value, unit, why, gold = false, note = null }) {
  return `<a class="champ${gold ? ' gold' : ''}" href="products/${esc(product.id)}.html">
  <div class="t">${esc(title)}</div>
  <div class="v">${esc(product.name)}</div>
  <div class="w">${esc(value)}${unit ? ` ${esc(unit)}` : ''}</div>
  ${why ? `<div class="d">${esc(why)}</div>` : ''}
  ${note ? `<div class="d">${esc(note)}</div>` : ''}
</a>`;
}

/** 覆盖率不足时的诚实占位（不发光杯，写清楚为什么不发） */
export function champGap({ title, have, need, reason }) {
  return `<div class="champ" style="opacity:.72;cursor:default">
  <div class="t">${esc(title)}</div>
  <div class="v" style="font-size:12.5px;color:var(--ink3);font-weight:500">数据不足 · 不排名</div>
  <div class="d">官方公布该参数的只有 ${esc(have)}/${esc(need)} 台（需 ≥ ${esc(Math.ceil(need * 0.5))} 台）</div>
  <div class="d">${esc(reason)}</div>
</div>`;
}

/** 排行榜表格。dir='low' 表示越小越好，箭头要跟着反 */
export function leagueTable(league, nameOf, { limit = 10, depth = 0 } = {}) {
  const root = depth === 0 ? '' : '../'.repeat(depth);
  const better = league.dir === 'low' ? '越低越强' : '越高越强';
  return `<table>
<thead><tr><th style="width:38px">#</th><th>机型</th><th style="text-align:right">${esc(league.label)}</th></tr></thead>
<tbody>${league.top.slice(0, limit).map((t) => {
    const g = t.rank === 1 ? ' g1' : t.rank === 2 ? ' g2' : t.rank === 3 ? ' g3' : '';
    return `<tr><td><span class="rk${g}">${t.rank}</span></td>
  <td><a href="${root}products/${esc(t.id)}.html" style="font-weight:600">${esc(nameOf(t.id))}</a></td>
  <td class="n" style="text-align:right">${esc(fmtNum(t.value, Number.isInteger(t.value) ? 0 : 2))}${league.unit ? ` ${esc(league.unit)}` : ''}</td></tr>`;
  }).join('')}</tbody>
</table>
<p class="srcline">口径：${esc(league.label)}（${better}）· 参赛 ${league.pool} 台（占在售池 ${(league.coverage * 100).toFixed(0)}%）${
    league.partial ? ' · <b>样本有限</b>：只有部分厂商公布该参数，榜首不等于全网最强' : ''
  }</p>`;
}
