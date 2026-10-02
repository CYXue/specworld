/**
 * 站点构建：把 products.json + analytics.json 变成一整套自包含静态页。
 *
 * 产出（_work/site/）：
 *   index.html          今日格局：多维冠军 + 六维总览 + 分类入口
 *   categories.html     分类查看：形态 / 价格档 / 产品线
 *   rankings.html       排行榜：多榜 + 筛选
 *   brands.html         厂商分区（国内 / 国外）
 *   brand/<id>.html     单厂商页：定位 + 产品线 + 进化时间线
 *   timeline.html       全局发布史时间线
 *   products/<id>.html  机型详情页（60 张）
 *   all.html            全部机型（可搜索排序）
 *   compare/*.html      对比页（复用 preview/render.mjs）
 *   search-index.js     搜索索引（内联进每页，不单独请求）
 *
 * 纪律：
 *   - 零外链、零密钥、零外部请求；双击 index.html 即可浏览
 *   - 文案由数据套模板，不调用 LLM
 *   - 缺数据显式标注「官方未公布」，绝不用 0 或 — 冒充
 *   - 搜索索引内联为 window.__SW_INDEX__，每页自带
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shell, searchIndexBlock, esc, brandOf, badge, lineColor, UNPUB,
  fmtNum, fmtPrice, fmtDate, fmtMonth, fmtPct,
  axesBlock, productCard, champCard, champGap, leagueTable,
} from './lib/ui.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, '_work/site');

const P = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
const products = P.products ?? P;
const A = JSON.parse(readFileSync(join(ROOT, '_work/analytics.json'), 'utf8'));

const byId = new Map(products.map((p) => [p.id, p]));
const nameOf = (id) => byId.get(id)?.name ?? id;
const detailOf = (id) => A.detail[id];

/* ------------------------------------------------------------------ *
 * 搜索索引
 * ------------------------------------------------------------------ */
/** 能力关键词 → 用于「按能力搜索」。取值全部来自数据推导，不手工维护名单 */
function abilityTags(p) {
  const d = detailOf(p.id);
  const t = [];
  const tier = A.priceTiers.find((x) => x.key === d.priceTier);
  if (tier) t.push(tier.label);
  if (d.formFactor === 'foldable') t.push('折叠', '折叠屏');
  if (p.line) t.push(p.line);
  // 按客观参数给能力标签，门槛写死且与页面口径一致
  if (typeof p.display?.ppi === 'number' && p.display.ppi >= 440) t.push('细腻屏');
  if (typeof p.body?.weightG === 'number' && p.body.weightG <= 170) t.push('轻薄');
  if (typeof p.battery?.capacityMah === 'number' && p.battery.capacityMah >= 7000) t.push('长续航', '大电池');
  if (typeof p.battery?.wiredChargeW === 'number' && p.battery.wiredChargeW >= 80) t.push('快充');
  const stor = p.memory?.storageGb ?? [];
  if (stor.length && Math.max(...stor) >= 1024) t.push('1TB', '大存储');
  if ((p.camera?.rear ?? []).some((c) => c.role === 'periscope')) t.push('潜望长焦', '长焦');
  if (d.price !== null && d.price <= 3000) t.push('便宜', '性价比');
  if (d.price !== null && d.price >= 8000) t.push('旗舰');
  if (typeof p.display?.sizeIn === 'number' && p.display.sizeIn >= 7) t.push('大屏');
  if (p.connectivity?.satellite) t.push('卫星通信');
  return [...new Set(t)];
}

const SEARCH_INDEX = {
  items: products.map((p) => {
    const b = brandOf(p.brand);
    const d = detailOf(p.id);
    return {
      id: p.id,
      n: p.name,
      v: b.nameZh,
      m: b.monogram,
      c: b.accent,
      p: d.price !== null ? fmtPrice(d.price) : '',
      t: abilityTags(p),
    };
  }),
};

/** 把搜索索引塞进页面头部。shell() 不含 <head> 内的脚本，这里做字符串注入 */
function withIndex(html) {
  return html.replace('</head>', `${searchIndexBlock(SEARCH_INDEX)}\n</head>`);
}

function write(rel, html) {
  const f = join(OUT, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, withIndex(html), 'utf8');
}

/* ------------------------------------------------------------------ *
 * 首页：今日格局
 * ------------------------------------------------------------------ */

/** 冠军位定义。每一项都要能回答「凭什么是他」 */
function champions() {
  const out = [];
  const leagues = new Map(A.leagues.map((l) => [l.key, l]));
  const push = (key, title, fmt, why) => {
    const l = leagues.get(key);
    if (!l || !l.top.length) {
      out.push({ gap: true, title, have: l?.pool ?? 0, need: A.total, reason: why.gap });
      return;
    }
    const t = l.top[0];
    const p = byId.get(t.id);
    if (!p) return;
    out.push({
      product: p,
      title,
      value: fmt(t.value),
      unit: l.unit,
      why: why.ok(t.value, l),
      gold: why.gold === true,
    });
  };

  push('weightG', '最轻', (v) => fmtNum(v, 0), {
    ok: (v) => `整机 ${v} g`,
    gap: '两家官网都公布整机重量，这个位置应该有冠军',
    gold: true,
  });
  push('thicknessMm', '最薄', (v) => fmtNum(v, 2), {
    ok: (v) => `机身 ${v} mm`,
    gap: '两家官网都公布机身厚度',
  });
  push('screenIn', '屏幕最大', (v) => fmtNum(v, 2), {
    ok: (v) => `${v} 英寸`,
    gap: '两家官网都公布屏幕尺寸',
  });
  push('ppi', '屏幕最细腻', (v) => fmtNum(v, 0), {
    ok: (v) => `${v} ppi`,
    gap: '两家官网都公布像素密度',
    gold: true,
  });
  push('batteryMah', '电池最大', (v) => fmtNum(v, 0), {
    ok: (v) => `${v} mAh`,
    gap: '苹果不公布电池容量，只有华为机型参赛',
  });
  push('wiredChargeW', '充电最快', (v) => fmtNum(v, 0), {
    ok: (v) => `${v} W 有线`,
    gap: '苹果不公布有线充电功率，只有华为机型参赛',
  });
  push('storageMaxGb', '存储最大', (v) => (v >= 1024 ? `${v / 1024} TB` : `${v} GB`), {
    ok: (v) => (v >= 1024 ? `最高 ${v / 1024} TB` : `最高 ${v} GB`),
    gap: '两家官网都公布最大存储',
  });
  push('priceCny', '起售价最低', (v) => fmtPrice(v), {
    ok: (v, l) => `${l.pool} 台有官方价格`,
    gap: '两家官网的价格覆盖不足',
  });
  return out;
}

function indexPage() {
  const ch = champions();
  const champHtml = ch
    .map((c) =>
      c.gap
        ? champGap({ title: c.title, have: c.have, need: c.need, reason: c.reason })
        : champCard({ title: c.title, product: c.product, value: c.value, unit: c.unit, why: c.why, gold: c.gold })
    )
    .join('');

  // 六维分布：每个维度当前池内最强的一台
  const dimBest = A.dimensions
    .map((dim) => {
      const withScore = products
        .map((p) => ({ p, s: detailOf(p.id).axes[dim.key]?.score }))
        .filter((x) => typeof x.s === 'number')
        .sort((a, b) => b.s - a.s);
      if (!withScore.length) return null;
      const top = withScore[0];
      const n = withScore.length;
      return { dim, top, n, median: withScore[Math.floor(n / 2)] };
    })
    .filter(Boolean);

  const distHtml = dimBest
    .map(
      ({ dim, top, n, median }) => `<a class="pcard" href="products/${esc(top.p.id)}.html">
  <div class="top">${badge(top.p, { size: 'sm' })}<span class="bn">${esc(dim.label)}最强</span></div>
  <h3>${esc(top.p.name)}</h3>
  <div class="sp" style="margin-bottom:9px">池内分位 <b class="mono">${fmtPct(top.s)}</b> / 100 · ${n} 台参赛</div>
  ${axesBlock(detailOf(top.p.id), [dim])}
  <div class="srcline">池内中位：${esc(median.p.name)}（${fmtPct(median.s)} 分位）</div>
</a>`
    )
    .join('');

  const formRows = A.formFactors
    .map((f) => {
      const ids = A.byForm[f.key] ?? [];
      return `<a class="pcard" href="categories.html#form-${esc(f.key)}">
  <div class="top">${badge({ brand: 'huawei' }, { size: 'sm' })}<span class="bn">形态</span></div>
  <h3>${esc(f.label)}</h3>
  <div class="price">${ids.length} 台</div>
  <div class="sp">${esc(f.desc)}</div>
  <div class="foot">${ids.slice(0, 4).map((id) => `<span class="tag">${esc(nameOf(id))}</span>`).join('')}${ids.length > 4 ? `<span class="tag">+${ids.length - 4}</span>` : ''}</div>
</a>`;
    })
    .join('');

  const tierRows = A.priceTiers
    .filter((t) => (A.byTier[t.key] ?? []).length)
    .map((t) => {
      const ids = A.byTier[t.key] ?? [];
      const withPrice = ids.filter((id) => detailOf(id).price !== null);
      const prices = withPrice.map((id) => detailOf(id).price).sort((a, b) => a - b);
      const range = prices.length ? `${fmtPrice(prices[0])} – ${fmtPrice(prices[prices.length - 1])}` : '价格未公布';
      return `<a class="pcard" href="categories.html#tier-${esc(t.key)}">
  <div class="top">${badge({ brand: 'apple' }, { size: 'sm' })}<span class="bn">价格档</span></div>
  <h3>${esc(t.label)}</h3>
  <div class="price">${ids.length} 台</div>
  <div class="sp">${esc(range)}</div>
  <div class="foot">${ids.slice(0, 3).map((id) => `<span class="tag">${esc(nameOf(id))}</span>`).join('')}${ids.length > 3 ? `<span class="tag">+${ids.length - 3}</span>` : ''}</div>
</a>`;
    })
    .join('');

  const newest = A.timeline[0];
  const newestHtml = newest
    ? `<section class="card">
  <h2>最近发布 <span class="c">${esc(fmtMonth(newest.month))} · ${newest.count} 台</span></h2>
  <p class="lede">最新一批机器。按发布时间从新到旧。</p>
  <div class="grid g3">${newest.ids
    .slice(0, 6)
    .map((id) => productCard(byId.get(id), detailOf(id), A))
    .join('')}</div>
  <p class="srcline" style="margin-top:11px">完整发布史见 <a href="timeline.html" style="color:var(--ink3);text-decoration:underline">时间线</a>（${A.timeline.length} 个月 / ${A.total} 台）。</p>
</section>`
    : '';

  const totalMissing = A.total * Object.keys(A.detail[products[0].id].axes).length;
  const naCount = Object.values(A.detail).reduce(
    (acc, d) => acc + Object.values(d.axes).filter((x) => x.score === null).length,
    0
  );

  return shell({
    title: '今日格局',
    nav: 'home',
    body: `
<section class="card">
  <h2>今日格局 <span class="c">在售池 <b>${A.total}</b> 台 · 华为 ${A.brands.huawei?.count ?? 0} / 苹果 ${A.brands.apple?.count ?? 0} · 窗口 ${esc(A.windowStart ?? '')} 起</span></h2>
  <p class="lede">每个位置都写清楚了凭什么。数据来自两家官网的规格页与对比页，脚本自动同步，不人工维护。</p>
  <div class="champs">${champHtml}</div>
  <div class="note warn"><b>为什么没有「性能最强」这一栏？</b>手机圈没有可公开核查的第三方成绩源（安兔兔需登录、Geekbench 无公开 API、3DMark 收费）。本站不给性能分，只展示官方客观参数 —— 没测过就是没测过，不用估算值填坑。</div>
</section>

<section class="card">
  <h2>六个维度，谁在池内最强 <span class="c">每维按已公布参数加权，全部可追溯</span></h2>
  <p class="lede">分位 = 该机在当前 ${A.total} 台在售池中的位置（100 = 池内最好）。某维参数不足时不打分，条留空。</p>
  <div class="grid g3">${distHtml}</div>
  <details style="margin-top:14px">
    <summary style="cursor:pointer;font-size:12.5px;color:var(--ink3)">展开六维权重表与缺失情况</summary>
    <div style="margin-top:11px">
      <table>
        <thead><tr><th>维度</th><th>参与参数与权重</th><th style="text-align:right">可打分</th><th style="text-align:right">数据不足</th></tr></thead>
        <tbody>${A.dimensions
          .map((d) => {
            const withScore = products.filter((p) => detailOf(p.id).axes[d.key]?.score !== null).length;
            return `<tr>
        <td><b>${esc(d.label)}</b></td>
        <td style="color:var(--ink2);font-size:12px">${d.parts.map((x) => `${esc(x.label)} ${(x.weight * 100).toFixed(0)}%`).join(' · ')}<br><span style="color:var(--ink4)">${esc(d.desc)}</span></td>
        <td class="n" style="text-align:right">${withScore}</td>
        <td class="n" style="text-align:right;color:${A.total - withScore ? 'var(--ink3)' : 'var(--ink4)'}">${A.total - withScore}</td>
      </tr>`;
          })
          .join('')}</tbody>
      </table>
      <p class="srcline">共 ${totalMissing} 个维度位，其中 ${naCount} 个因官网未公布而留空（${((naCount / totalMissing) * 100).toFixed(1)}%）。留空是事实，不是缺陷。</p>
    </div>
  </details>
</section>

${newestHtml}

<section class="card">
  <h2>按形态看 <span class="c">${A.formFactors.length} 类</span></h2>
  <p class="lede">折叠屏的判据是官网明确列出内屏/外屏，不靠外形猜。</p>
  <div class="grid g3">${formRows}</div>
</section>

<section class="card">
  <h2>按价格档看 <span class="c">${A.priceTiers.filter((t) => (A.byTier[t.key] ?? []).length).length} 档</span></h2>
  <p class="lede">分档线写死并公开。价格未公布的机型单独成档，不参与任何价格相关排行。</p>
  <div class="grid g3">${tierRows}</div>
</section>

<section class="card">
  <h2>怎么用这个站</h2>
  <div class="grid g3">
    <a class="pcard" href="rankings.html"><h3>排行榜</h3><div class="sp">${A.leagues.length} 个客观参数榜，可按品牌、形态、价格档筛选</div></a>
    <a class="pcard" href="brands.html"><h3>厂商</h3><div class="sp">${Object.keys(A.brands).length} 家厂商，国内外分区与产品线演进</div></a>
    <a class="pcard" href="timeline.html"><h3>时间线</h3><div class="sp">${A.timeline.length} 个月 ${A.total} 台机器的完整发布史</div></a>
    <a class="pcard" href="all.html"><h3>全部机型</h3><div class="sp">一张表看全部 ${A.total} 台，六个关键参数并排</div></a>
    <a class="pcard" href="categories.html"><h3>分类查看</h3><div class="sp">形态 / 价格档 / 产品线三个维度切分</div></a>
    <a class="pcard" href="#search"><h3>搜索</h3><div class="sp">顶栏按 / 键，搜机型名、厂商或能力（如「折叠」「长续航」）</div></a>
  </div>
</section>`,
  });
}

/* ------------------------------------------------------------------ *
 * 分类页
 * ------------------------------------------------------------------ */
function categoriesPage() {
  const dimGrid = (dims, buckets, keyOf, describe) =>
    dims
      .map((d) => {
        const ids = buckets[d.key] ?? [];
        if (!ids.length) return '';
        // 该桶内的池内分位榜：只在该桶内部排名，折叠屏不和直板机比
        const sub = new Map();
        for (const dim of A.dimensions) {
          const vals = ids
            .map((id) => ({ id, s: detailOf(id).axes[dim.key]?.score }))
            .filter((x) => typeof x.s === 'number')
            .sort((a, b) => b.s - a.s);
          if (vals.length >= 3) sub.set(dim.key, vals);
        }
        const bestDim = [...sub.entries()].sort((a, b) => b[1].length - a[1].length)[0];
        return `<section class="card" id="${keyOf(d)}">
  <h2>${esc(d.label)} <span class="c">${ids.length} 台 · ${esc(describe(d))}</span></h2>
  ${d.desc ? `<p class="lede">${esc(d.desc)}</p>` : ''}
  ${
    bestDim
      ? `<p class="srcline" style="margin-bottom:11px">本组池内最强（按${esc(bestDim[0].label)}分位）：${bestDim[1]
          .slice(0, 3)
          .map((x, i) => `<a href="products/${esc(x.id)}.html" style="color:var(--ink2);text-decoration:underline">${i + 1}. ${esc(nameOf(x.id))}（${fmtPct(x.s)}）</a>`)
          .join(' · ')}</p>`
      : `<p class="srcline" style="margin-bottom:11px">本组样本不足 3 台，不做组内排名。</p>`
  }
  <div class="grid g4">${ids.map((id) => productCard(byId.get(id), detailOf(id), A)).join('')}</div>
</section>`;
      })
      .join('');

  const formHtml = dimGrid(A.formFactors, A.byForm, (d) => `form-${d.key}`, (d) => d.desc);
  const tierHtml = dimGrid(A.priceTiers.filter((t) => t.key !== 'unknown'), A.byTier, (d) => `tier-${d.key}`, (d) => d.desc);
  const unknownIds = A.byTier.unknown ?? [];
  const lineEntries = Object.entries(A.lines).sort((a, b) => b[1].length - a[1].length);
  const lineHtml = lineEntries
    .map(([line, ids]) => {
      const lh = lineColor(line);
      const brand = byId.get(ids[0])?.brand ?? 'huawei';
      const b = brandOf(brand);
      const prices = ids.map((id) => detailOf(id).price).filter((v) => v !== null).sort((a, b2) => a - b2);
      return `<section class="card">
  <h2><span class="badge sm" style="--bw:22px;--bf:11px;background:${b.accentSoft};color:${b.accent};border-color:${b.accentLine}">${esc(b.monogram)}</span> ${esc(line)} <span class="c">${ids.length} 台${prices.length ? ` · ${fmtPrice(prices[0])} – ${fmtPrice(prices[prices.length - 1])}` : ' · 价格未公布'}</span></h2>
  <p class="srcline" style="margin-bottom:11px">本线池内最强（按屏幕分位）：${(() => {
    const ranked = ids
      .map((id) => ({ id, s: detailOf(id).axes.screen?.score }))
      .filter((x) => typeof x.s === 'number')
      .sort((a, b2) => b2.s - a.s)[0];
    return ranked ? `<a href="products/${esc(ranked.id)}.html" style="color:var(--ink2);text-decoration:underline">${esc(nameOf(ranked.id))}（${fmtPct(ranked.s)}）</a>` : '数据不足';
  })()}</p>
  <div class="grid g4">${ids.map((id) => productCard(byId.get(id), detailOf(id), A)).join('')}</div>
</section>`;
    })
    .join('');

  return shell({
    title: '分类查看',
    nav: 'categories',
    lede: '三个维度切分全部由数据推导，不维护人工名单。每一组内部单独排名 —— 折叠屏不跟直板机比重量。',
    body: `
<div class="note"><b>组内排名的口径</b>：某一组只有 3 台以上、且某维参数足够的机型才给组内排名。样本不足时只列机型，不硬凑名次。</div>
${formHtml}
${tierHtml}
${
  unknownIds.length
    ? `<section class="card" id="tier-unknown">
  <h2>价格未公布 <span class="c">${unknownIds.length} 台</span></h2>
  <p class="lede">官网未公开起售价。这组机型不参与任何价格相关排行与性价比计算，但其他参数照常展示。</p>
  <div class="grid g4">${unknownIds.map((id) => productCard(byId.get(id), detailOf(id), A)).join('')}</div>
</section>`
    : ''
}
${lineHtml}`,
  });
}

/* ------------------------------------------------------------------ *
 * 排行榜页
 * ------------------------------------------------------------------ */
function rankingsPage() {
  // 筛选在前端做：把所有机型 × 所有维度的分数一次性内联，页面本地过滤
  const matrix = products.map((p) => {
    const d = detailOf(p.id);
    return {
      id: p.id,
      b: p.brand,
      f: d.formFactor,
      t: d.priceTier,
      l: p.line ?? '未归线',
      a: Object.fromEntries(A.dimensions.map((dim) => [dim.key, d.axes[dim.key]?.score ?? null])),
    };
  });

  const filterState = { brand: '', form: '', tier: '', dim: '' };
  const json = JSON.stringify({ matrix, dims: A.dimensions.map((d) => ({ key: d.key, label: d.label })) });
  const names = JSON.stringify(Object.fromEntries(products.map((p) => [p.id, p.name])));
  const brands = JSON.stringify(Object.fromEntries(products.map((p) => [p.id, brandOf(p.brand).nameZh])));
  const links = JSON.stringify(Object.fromEntries(products.map((p) => [p.id, `products/${p.id}.html`])));

  const leagueCards = A.leagues
    .map((l) => {
      const rk = new Map(l.top.map((t, i) => [t.id, i + 1]));
      const body = l.pool < 6
        ? `<p class="srcline">参赛仅 ${l.pool} 台，不足以成榜。</p>`
        : `<table>
<thead><tr><th style="width:38px">#</th><th>机型</th><th style="text-align:right">${esc(l.label)}</th></tr></thead>
<tbody>${l.top.map((t) => {
            const g = t.rank === 1 ? ' g1' : t.rank === 2 ? ' g2' : t.rank === 3 ? ' g3' : '';
            return `<tr data-brand="${esc(byId.get(t.id).brand)}" data-id="${esc(t.id)}">
      <td><span class="rk${g}">${t.rank}</span></td>
      <td><a href="products/${esc(t.id)}.html" style="font-weight:600">${esc(nameOf(t.id))}</a></td>
      <td class="n" style="text-align:right">${esc(fmtNum(t.value, Number.isInteger(t.value) ? 0 : 2))}${l.unit ? ` ${esc(l.unit)}` : ''}</td>
    </tr>`;
          }).join('')}</tbody></table>
<p class="srcline">口径：${esc(l.label)}（${l.dir === 'low' ? '越低越强' : '越高越强'}）· 参赛 ${l.pool} 台（占在售池 ${(l.coverage * 100).toFixed(0)}%）${
            l.partial ? ' · <b>样本有限</b>：只有部分厂商公布该参数，榜首不等于全网最强' : ''
          }</p>`;
      return `<section class="card league" data-league="${esc(l.key)}">
  <h2>${esc(l.label)} <span class="c">${esc(l.dir === 'low' ? '越低越强' : '越高越强')}${l.unit ? ` · 单位 ${esc(l.unit)}` : ''}</span>${l.partial ? ' <span class="tag" style="background:#fff3d6;color:#8a6300">样本有限</span>' : ''}</h2>
  ${body}
</section>`;
    })
    .join('');

  // 维度分榜（不设固定池，按筛选结果动态算）
  const dimCards = A.dimensions
    .map(
      (d) => `<section class="card league dimcard" data-dim="${esc(d.key)}" hidden>
  <h2>${esc(d.label)} <span class="c">按${esc(d.desc)}</span></h2>
  <table><thead><tr><th style="width:38px">#</th><th>机型</th><th style="text-align:right">池内分位</th></tr></thead>
  <tbody></tbody></table>
  <p class="srcline"></p>
</section>`
    )
    .join('');

  const script = `<script>
(function(){
  var M=${json}, N=${names}, B=${brands}, L=${links};
  var ROWS = M.matrix;   // M 是 {matrix, dims} 容器，机型数组在 M.matrix
  var dims=${JSON.stringify(A.dimensions.map((d) => ({ key: d.key, label: d.label, desc: d.desc })))};
  var f={brand:'',form:'',tier:'',dim:''};
  function q(sel){return Array.prototype.slice.call(document.querySelectorAll(sel))}
  function apply(){
    var rows=ROWS.filter(function(m){
      if(f.brand && m.b!==f.brand) return false;
      if(f.form && m.f!==f.form) return false;
      if(f.tier && m.t!==f.tier) return false;
      return true;
    });
    // 客观榜：按筛选隐藏行
    q('.league:not(.dimcard) tbody tr').forEach(function(tr){
      var ok = rows.some(function(m){return m.id===tr.getAttribute('data-id')});
      tr.hidden = !ok;
    });
    q('.league:not(.dimcard)').forEach(function(sec){
      var shown = sec.querySelectorAll('tbody tr:not([hidden])').length;
      sec.hidden = shown===0;
      // 筛选后「参赛 60 台」会变成误导（榜单实际只剩筛选后的几行），补一句当前筛选下的行数
      var note = sec.querySelector('.srcline');
      if(!note) return;
      note.textContent = note.textContent.replace(/\\s*·\\s*当前筛选下 \\d+ 行/, '');
      if(shown) note.textContent += ' · 当前筛选下显示 ' + shown + ' 行';
    });
    // 维度分榜：动态排序
    q('.dimcard').forEach(function(sec){
      var k=sec.getAttribute('data-dim');
      sec.hidden = f.dim!==k;
      if(sec.hidden) return;
      var list=rows.map(function(m){return {m:m,s:m.a[k]}}).filter(function(x){return typeof x.s==='number'});
      list.sort(function(a,b){return b.s-a.s});
      var tb=sec.querySelector('tbody');
      tb.innerHTML = list.slice(0,20).map(function(x,i){
        var g = i===0?' g1':i===1?' g2':i===2?' g3':'';
        return '<tr><td><span class="rk'+g+'">'+(i+1)+'</span></td>'
          +'<td><a href="'+L[x.m.id]+'" style="font-weight:600">'+N[x.m.id]+'</a></td>'
          +'<td class="n" style="text-align:right">'+Math.round(x.s*100)+'</td></tr>';
      }).join('');
      var d=dims.filter(function(x){return x.key===k})[0];
      sec.querySelector('.srcline').textContent = '当前筛选 '+list.length+' 台参赛 · '+d.desc
        +' · 分位 100 = 当前筛选池内最好';
      if(!list.length) tb.innerHTML='<tr><td colspan="3" class="unpub">当前筛选下没有参数足够的机型</td></tr>';
    });
  }
  q('.chip[data-f]').forEach(function(ch){
    ch.addEventListener('click',function(){
      var k=ch.getAttribute('data-f'), v=ch.getAttribute('data-v');
      f[k] = (f[k]===v) ? '' : v;
      q('.chip[data-f="'+k+'"]').forEach(function(o){o.classList.toggle('on', o.getAttribute('data-v')===f[k] && f[k]!=='')});
      apply();
    });
  });
  apply();
})();
</script>`;

  const chipRow = (label, key, options) =>
    `<span class="fl">${label}</span>` +
    options.map((o) => `<span class="chip" data-f="${key}" data-v="${esc(o[0])}">${esc(o[1])}</span>`).join('');

  return shell({
    title: '排行榜',
    nav: 'rankings',
    lede: `${A.leagues.length} 个客观参数榜 + ${A.dimensions.length} 个综合维度分。全部基于官网已公布参数，缺数据不进榜。`,
    body: `
<div class="card">
  <h2>筛选</h2>
  <div class="filters">${chipRow('品牌', 'brand', [...new Set(products.map((p) => p.brand))].map((b) => [b, brandOf(b).nameZh]))}</div>
  <div class="filters">${chipRow('形态', 'form', A.formFactors.map((f) => [f.key, f.label]))}</div>
  <div class="filters">${chipRow('价格档', 'tier', A.priceTiers.filter((t) => (A.byTier[t.key] ?? []).length).map((t) => [t.key, t.label]))}</div>
  <div class="filters">${chipRow('维度分', 'dim', A.dimensions.map((d) => [d.key, d.label]))}</div>
  <p class="srcline">筛选只影响本页显示，不改动任何数据。维度分榜按当前筛选结果重新计算分位（100 = 筛选池内最好）。</p>
</div>
${leagueCards}
${dimCards}
${script}`,
  });
}

/* ------------------------------------------------------------------ *
 * 厂商分区 + 单厂商页
 * ------------------------------------------------------------------ */
function brandsPage() {
  const groups = [
    { key: 'cn', label: '国内厂商', desc: '中国内地注册的品牌' },
    { key: 'global', label: '国外厂商', desc: '海外注册的品牌' },
    { key: 'other', label: '其他', desc: '归属未确认' },
  ];
  const sections = groups
    .map((g) => {
      const list = Object.values(A.brands).filter((b) => (b.region ?? 'other') === g.key);
      if (!list.length) return '';
      return `<section class="card">
  <h2>${esc(g.label)} <span class="c">${list.length} 家 · ${esc(g.desc)}</span></h2>
  <div class="grid g2">${list
    .map((b) => {
      const ids = b.ids;
      const lines = b.lines
        .map((l) => `<span class="tag" style="--lh:${lineColor(l.key).h}">${esc(l.key)} ${l.count}</span>`)
        .join('');
      const prices = ids.map((id) => detailOf(id).price).filter((v) => v !== null).sort((x, y) => x - y);
      const newest = ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((x, y) => (y.releaseDate ?? '').localeCompare(x.releaseDate ?? ''))[0];
      return `<a class="pcard" href="brand/${esc(b.id)}.html" style="--lw:1px">
  <div class="top"><span class="badge lg" style="--bw:44px;--bf:19px;background:${b.accentColor ? b.accentColor + '18' : 'var(--line3)'};color:${b.accentColor ?? 'var(--ink2)'};border-color:${b.accentColor ? b.accentColor + '44' : 'var(--line)'}">${esc(b.nameZh.slice(0, 1))}</span>
  <div style="min-width:0"><h3 style="margin:0">${esc(b.nameZh)}</h3><div class="bn" style="font-size:11.5px;color:var(--ink3)">${esc(b.name)} · ${esc(b.countryLabel ?? '')}</div></div></div>
  <div class="price">${ids.length} 台在售</div>
  <div class="sp">${prices.length ? `${fmtPrice(prices[0])} – ${fmtPrice(prices[prices.length - 1])}` : '价格未公布'}${newest ? ` · 最新 ${esc(newest.name)}` : ''}</div>
  <div class="foot">${lines}</div>
</a>`;
    })
    .join('')}</div>
</section>`;
    })
    .join('');

  return shell({
    title: '厂商',
    nav: 'brands',
    lede: '厂商信息来自快照的 vendors 注册表。不画厂商 logo（商标风险），用品牌色 monogram 徽章。',
    body: sections,
  });
}

function brandPage(id) {
  const b = A.brands[id];
  if (!b) return null;
  const meta = brandOf(id);
  const ids = b.ids;
  const prices = ids.map((x) => detailOf(x).price).filter((v) => v !== null).sort((a, b2) => a - b2);

  // 历代之最：只在本公司内部排名
  const records = A.dimensions
    .map((dim) => {
      const list = ids
        .map((x) => ({ id: x, s: detailOf(x).axes[dim.key]?.score }))
        .filter((x) => typeof x.s === 'number')
        .sort((a, b2) => b2.s - a.s);
      return list.length ? { dim, top: list[0] } : null;
    })
    .filter(Boolean);

  const monthMap = new Map();
  for (const pid of ids) {
    const p = byId.get(pid);
    if (!p?.releaseDate) continue;
    const mk = p.releaseDate.slice(0, 7);
    if (!monthMap.has(mk)) monthMap.set(mk, []);
    monthMap.get(mk).push(pid);
  }
  const months = [...monthMap.entries()].sort((a, b2) => b2[0].localeCompare(a[0]));

  const timelineHtml = months
    .map(
      ([mk, list]) => `<div class="tlmon${list.length === 1 ? ' dim' : ''}">
  <div class="tlh"><span class="m">${esc(fmtMonth(mk))}</span><span class="n">${list.length} 台</span></div>
  <div class="tlrow">${list
    .map((pid) => {
      const p = byId.get(pid);
      return `<a class="tag line" style="--lh:${lineColor(p.line).h}" href="../products/${esc(pid)}.html">${esc(p.name)}</a>`;
    })
    .join('')}</div>
</div>`
    )
    .join('');

  return shell({
    title: `${b.nameZh} 机型`,
    nav: 'brands',
    depth: 1,
    lede: `${b.nameZh}（${b.name}）在售 ${ids.length} 台，覆盖 ${b.lines.length} 条产品线。全部参数取自官网规格页。`,
    body: `
<section class="card">
  <div class="hero">
    <span class="badge lg" style="--bw:56px;--bf:24px;background:${meta.accentSoft};color:${meta.accent};border-color:${meta.accentLine}">${esc(meta.monogram)}</span>
    <div class="info">
      <h1>${esc(b.nameZh)}</h1>
      <div class="meta"><span>${esc(b.name)}</span><span class="sep">·</span><span>${esc(b.countryLabel ?? '')}</span><span class="sep">·</span><span>在售 ${ids.length} 台</span>${
        prices.length ? `<span class="sep">·</span><span class="mono">${fmtPrice(prices[0])} – ${fmtPrice(prices[prices.length - 1])}</span>` : '<span class="sep">·</span><span class="unpub">官网未公开起售价</span>'
      }</div>
    </div>
  </div>
</section>

<section class="card">
  <h2>产品线 <span class="c">${b.lines.length} 条</span></h2>
  <p class="lede">每条产品线按发布时间从新到旧排列。</p>
  ${b.lines
    .map((l) => {
      const first = byId.get(l.firstId);
      const latest = byId.get(l.latestId);
      const span = first?.releaseDate && latest?.releaseDate ? `${first.releaseDate.slice(0, 7)} 至今` : '日期不全';
      return `<details style="border-bottom:1px solid var(--line2);padding:9px 0">
    <summary style="cursor:pointer;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap">
      <span class="tag line" style="--lh:${lineColor(l.key).h};font-size:12px;padding:2px 9px">${esc(l.key)}</span>
      <b style="font-size:13.5px">${l.count} 台</b>
      <span style="font-size:11.5px;color:var(--ink3)">${esc(span)}</span>
    </summary>
    <div class="grid g4" style="margin-top:11px">${l.ids.map((pid) => productCard(byId.get(pid), detailOf(pid), A, { depth: 1 })).join('')}</div>
  </details>`;
    })
    .join('')}
</section>

<section class="card">
  <h2>历代之最 <span class="c">只在 ${esc(b.nameZh)} 内部排名</span></h2>
  <p class="lede">同一厂商内比较，不跨品牌。</p>
  <div class="grid g3">${records
    .map(
      ({ dim, top }) => `<a class="pcard" href="../products/${esc(top.id)}.html">
  <div class="top">${badge(byId.get(top.id), { size: 'sm' })}<span class="bn">${esc(dim.label)}最强</span></div>
  <h3>${esc(nameOf(top.id))}</h3>
  <div class="sp" style="margin-bottom:8px">本品牌内分位 <b class="mono">${fmtPct(top.s)}</b> / 100</div>
  ${axesBlock(detailOf(top.id), [dim])}
</a>`
    )
    .join('')}</div>
</section>

<section class="card">
  <h2>发布史 <span class="c">${months.length} 个月 · ${ids.length} 台</span></h2>
  <p class="lede">按发布月份从新到旧。${months[0] ? `最新一批是 ${esc(fmtMonth(months[0][0]))}，${months[0][1].length} 台。` : ''}</p>
  <div class="tl">${timelineHtml}</div>
</section>

<section class="card">
  <h2>全部机型 <span class="c">${ids.length} 台</span></h2>
  <table>
    <thead><tr><th>机型</th><th>上市</th><th style="text-align:right">屏幕</th><th style="text-align:right">重量</th><th style="text-align:right">起售价</th></tr></thead>
    <tbody>${ids
      .map((pid) => {
        const p = byId.get(pid);
        const d = detailOf(pid);
        return `<tr>
      <td><a href="../products/${esc(pid)}.html" style="font-weight:600">${esc(p.name)}</a>${p.line ? ` <span class="tag line" style="--lh:${lineColor(p.line).h}">${esc(p.line)}</span>` : ''}</td>
      <td class="n">${p.releaseDate ? esc(p.releaseDate) : UNPUB}</td>
      <td class="n" style="text-align:right">${typeof p.display?.sizeIn === 'number' ? `${p.display.sizeIn}″` : UNPUB}</td>
      <td class="n" style="text-align:right">${typeof p.body?.weightG === 'number' ? `${p.body.weightG} g` : UNPUB}</td>
      <td class="n" style="text-align:right">${d.price !== null ? esc(fmtPrice(d.price)) : UNPUB}</td>
    </tr>`;
      })
      .join('')}</tbody>
  </table>
</section>`,
  });
}

/* ------------------------------------------------------------------ *
 * 时间线
 * ------------------------------------------------------------------ */
function timelinePage() {
  const total = products.filter((p) => p.releaseDate).length;
  const first = A.timeline[A.timeline.length - 1];
  const months = A.timeline
    .map((m) => {
      const list = m.ids.map((id) => byId.get(id)).filter(Boolean);
      const brands = [...new Set(list.map((p) => p.brand))];
      return `<div class="tlmon${m.count === 1 ? ' dim' : ''}">
  <div class="tlh"><span class="m">${esc(fmtMonth(m.month))}</span><span class="n">${m.count} 台</span><span class="n">${brands.map((b) => brandOf(b).nameZh).join(' / ')}</span></div>
  <div class="tlrow">${m.ids
    .map((id) => {
      const p = byId.get(id);
      const b = brandOf(p.brand);
      return `<a class="tag line" style="--lh:${lineColor(p.line).h};border-left:2.5px solid ${b.accent}" href="products/${esc(id)}.html" title="${esc(p.name)} · ${esc(p.releaseDate)} · ${esc(p.line)}">${esc(p.name)}</a>`;
    })
    .join('')}</div>
</div>`;
    })
    .join('');

  const byYear = {};
  for (const p of products) {
    if (!p.releaseDate) continue;
    const y = p.releaseDate.slice(0, 4);
    byYear[y] = (byYear[y] ?? 0) + 1;
  }

  return shell({
    title: '发布史时间线',
    nav: 'timeline',
    lede: `${total} 台机器按发布月份从新到旧铺开，覆盖 ${A.timeline.length} 个月（${esc(A.timeline[A.timeline.length - 1].month)} 至 ${esc(A.timeline[0].month)}）。`,
    body: `
<section class="card">
  <h2>概览</h2>
  <div class="grid g4">${Object.entries(byYear)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(
      ([y, n]) => `<div class="pcard" style="cursor:default">
  <div class="top"><span class="bn">${y} 年</span></div>
  <div class="price">${n} 台</div>
  <div class="sp">月均 ${(n / 12).toFixed(1)} 台</div>
</div>`
    )
    .join('')}</div>
  <div class="note"><b>关于时间覆盖范围</b>本站只收录两家官网当前仍在售的机型规格页，因此窗口从 ${esc(A.windowStart ?? '—')} 起。已停售机型在窗口外，官网归档页不可达 —— 这是数据可达性的边界，不是遗漏。</div>
</section>

<section class="card">
  <h2>时间线 <span class="c">${A.total} 台 · ${A.timeline.length} 个月</span></h2>
  <div class="tl">${months}</div>
</section>`,
  });
}

/* ------------------------------------------------------------------ *
 * 全部机型
 * ------------------------------------------------------------------ */
function allPage() {
  const rows = products
    .slice()
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
    .map((p) => {
      const d = detailOf(p.id);
      const b = brandOf(p.brand);
      return `<tr>
  <td><a href="products/${esc(p.id)}.html" style="font-weight:600">${esc(p.name)}</a></td>
  <td><span class="tag" style="background:${b.accentSoft};color:${b.accent}">${esc(b.nameZh)}</span></td>
  <td>${p.line ? `<span class="tag line" style="--lh:${lineColor(p.line).h}">${esc(p.line)}</span>` : ''}${d.formFactor === 'foldable' ? ' <span class="tag fold">折叠</span>' : ''}</td>
  <td class="n">${p.releaseDate ? esc(p.releaseDate) : UNPUB}</td>
  <td class="n" style="text-align:right">${typeof p.display?.sizeIn === 'number' ? `${p.display.sizeIn}″` : UNPUB}</td>
  <td class="n" style="text-align:right">${typeof p.body?.weightG === 'number' ? `${p.body.weightG} g` : UNPUB}</td>
  <td class="n" style="text-align:right">${typeof p.body?.thicknessMm === 'number' ? `${p.body.thicknessMm} mm` : UNPUB}</td>
  <td class="n" style="text-align:right">${typeof p.battery?.capacityMah === 'number' ? `${p.battery.capacityMah}` : UNPUB}</td>
  <td class="n" style="text-align:right">${d.price !== null ? esc(fmtPrice(d.price)) : UNPUB}</td>
</tr>`;
    })
    .join('');

  return shell({
    title: '全部机型',
    nav: 'all',
    lede: `${A.total} 台在售机型，按发布时间从新到旧。任何一格为空都表示官网未公布，不是 0。`,
    body: `
<section class="card">
  <h2>全部机型 <span class="c">${A.total} 台</span></h2>
  <div style="overflow-x:auto">
  <table>
    <thead><tr><th>机型</th><th>品牌</th><th>产品线</th><th>上市</th><th style="text-align:right">屏幕</th><th style="text-align:right">重量</th><th style="text-align:right">厚度</th><th style="text-align:right">电池 mAh</th><th style="text-align:right">起售价</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>
  <p class="srcline">苹果不公布电池容量、有线充电功率与运行内存 —— 这三列对苹果机型全部为空，是官网事实。华为部分机型不公布处理器型号。</p>
</section>`,
  });
}

/* ------------------------------------------------------------------ *
 * 机型详情页
 * ------------------------------------------------------------------ */
function productPage(p) {
  const d = detailOf(p.id);
  const b = brandOf(p.brand);
  const lh = lineColor(p.line);
  const gen = A.lineage[p.line]?.gen?.[p.id];

  // 身份卡
  const hero = `<section class="card">
  <div class="hero">
    <span class="badge lg" style="--bw:56px;--bf:24px;background:${b.accentSoft};color:${b.accent};border-color:${b.accentLine}">${esc(b.monogram)}</span>
    <div class="info">
      <div class="meta" style="margin-bottom:2px">
        <a href="../brand/${esc(p.brand)}.html" style="color:${b.accent}">${esc(b.nameZh)}</a>
        <span class="sep">·</span>
        ${p.line ? `<span class="tag line" style="--lh:${lh.h}">${esc(p.line)}</span>` : ''}
        ${d.formFactor === 'foldable' ? '<span class="tag fold">折叠屏</span>' : ''}
        ${p.status === 'on-sale' ? '<span class="tag">在售</span>' : `<span class="tag">${esc(p.status)}</span>`}
      </div>
      <h1>${esc(p.name)}</h1>
      <div class="meta">
        <span class="mono">${p.releaseDate ? esc(p.releaseDate) : '<span class="unpub">上市日期未公布</span>'}</span>
        <span class="sep">·</span>
        <span>${d.price !== null ? esc(fmtPrice(d.price)) : '<span class="unpub">起售价未公布</span>'}</span>
        <span class="sep">·</span>
        <span class="mono">${esc(p.id)}</span>
      </div>
    </div>
  </div>
</section>`;

  // 六维能力条
  const axes = `<section class="card">
  <h2>六维能力 <span class="c">分位 100 = 当前 ${A.total} 台在售池内最好</span></h2>
  <p class="lede">每维由若干已公布参数加权而成。参数不足时留空 —— 本站不做估算填充。</p>
  ${axesBlock(d, A.dimensions)}
  <details style="margin-top:13px">
    <summary style="cursor:pointer;font-size:12.5px;color:var(--ink3)">展开每维的计算明细</summary>
    <table style="margin-top:10px">
      <thead><tr><th>维度</th><th>参与参数</th><th style="text-align:right">权重</th><th style="text-align:right">原始值</th><th style="text-align:right">分位</th></tr></thead>
      <tbody>${A.dimensions
        .map((dim) => {
          const ax = d.axes[dim.key];
          if (!ax.parts.length) {
            return `<tr><td><b>${esc(dim.label)}</b></td><td colspan="4" class="unpub">官网未公布任何参与参数，本维度不打分</td></tr>`;
          }
          return ax.parts
            .map(
              (pt, i) => `<tr>
        <td>${i === 0 ? `<b>${esc(dim.label)}</b>` : '<span style="color:var(--ink4)">└</span>'}</td>
        <td>${esc(dim.parts.find((x) => x.metric === pt.metric)?.label ?? pt.metric)}</td>
        <td class="n" style="text-align:right">${(pt.weight * 100).toFixed(0)}%</td>
        <td class="n" style="text-align:right">${esc(fmtNum(pt.raw, Number.isInteger(pt.raw) ? 0 : 2))}</td>
        <td class="n" style="text-align:right">${ax.score !== null ? fmtPct(ax.score) : '—'}</td>
      </tr>`
            )
            .join('');
        })
        .join('')}</tbody>
    </table>
  </details>
</section>`;

  // 类比换算
  const ana = `<section class="card">
  <h2>换算成生活里的量 <span class="c">${d.analogies.length} 条</span></h2>
  <p class="lede">给数字一个体感锚点。假设全部写在下表里，可以自己判断靠不靠谱。</p>
  ${d.analogies
    .map(
      (a) => `<div class="ana">
    <span class="lb">${esc(a.label)}</span>
    <span class="vl">${esc(a.value)}</span>
    <span style="font-size:12.5px;color:var(--ink2)">${esc(a.unit)}</span>
    <span class="fr">依据：${esc(a.from)}</span>
    <span class="as">${esc(a.assume)}</span>
  </div>`
    )
    .join('')}
  <p class="srcline">换算是估算，用来建立直觉，不是测量结论。</p>
</section>`;

  // 代际链
  const lineage = (() => {
    if (!p.line || !gen) return '';
    const ordered = A.lineage[p.line].ordered;
    const idx = ordered.indexOf(p.id);
    const lineageItems = ordered
      .map((id, i) => {
        const q = byId.get(id);
        const qq = detailOf(id);
        const isMe = id === p.id;
        return `<a class="tag line" style="--lh:${lh.h};${isMe ? `background:${b.accent};color:#fff;font-weight:600;` : ''}" href="${isMe ? '#' : `../products/${esc(id)}.html`}">${esc(q.name)}${isMe ? ' ← 本机' : ''}</a>`;
      })
      .join('');
    return `<section class="card">
  <h2>${esc(p.line)} 产品线 <span class="c">第 ${idx + 1} / ${ordered.length} 代</span></h2>
  <p class="lede">同产品线按发布时间排列。左边是上一代，右边是下一代。</p>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
    ${gen.prev ? `<a class="chip" href="../products/${esc(gen.prev)}.html">← 上一代 ${esc(nameOf(gen.prev))}</a>` : '<span class="chip" style="opacity:.5;cursor:default">← 本线最早一代</span>'}
    <span class="tag line" style="--lh:${lh.h};background:${b.accent};color:#fff;font-weight:600">${esc(p.name)}</span>
    ${gen.next ? `<a class="chip" href="../products/${esc(gen.next)}.html">下一代 ${esc(nameOf(gen.next))} →</a>` : '<span class="chip" style="opacity:.5;cursor:default">本线最新一代 →</span>'}
  </div>
  <div class="tlrow">${lineageItems}</div>
</section>`;
  })();

  // 规格表
  const na = (v) => v === null || v === undefined || v === '' ? UNPUB : v;
  const rear = p.camera?.rear ?? [];
  const kv = [
    ['上市日期', p.releaseDate ? esc(p.releaseDate) : na(null)],
    ['状态', p.status === 'on-sale' ? '在售' : na(null)],
    ['起售价', d.price !== null ? esc(fmtPrice(d.price)) : na(null)],
    ['屏幕', typeof p.display?.sizeIn === 'number' ? `${p.display.sizeIn} 英寸 · ${esc(p.display.type ?? '')}` : na(null)],
    ['分辨率', p.display?.resolutionPx ? `${p.display.resolutionPx.w} × ${p.display.resolutionPx.h}${p.display.ppi ? ` · ${p.display.ppi} ppi` : ''}` : na(null)],
    ['刷新率', p.display?.refreshHz ? esc(p.display.refreshHz) + ' Hz' : na(null)],
    ['亮度', p.display?.brightnessPeakNits ? `峰值 ${p.display.brightnessPeakNits} nits${p.display.brightnessTypicalNits ? ` · 典型 ${p.display.brightnessTypicalNits} nits` : ''}` : na(null)],
    ['处理器', p.chipset?.name ? esc(p.chipset.name) : na(null)],
    ['CPU 核心', typeof p.chipset?.cpuCores === 'number' ? `${p.chipset.cpuCores} 核` : na(null)],
    ['运行内存', p.memory?.ramGb?.length ? `${Math.max(...p.memory.ramGb)} GB` : na(null)],
    ['存储', p.memory?.storageGb?.length ? `${[...p.memory.storageGb].sort((a, b) => a - b).join(' / ')} GB` : na(null)],
    ['电池', p.battery?.capacityMah ? `${p.battery.capacityMah} mAh（${esc(p.battery.capacityCaliber ?? '口径未注明')}）` : na(null)],
    ['有线充电', typeof p.battery?.wiredChargeW === 'number' ? `${p.battery.wiredChargeW} W` : na(null)],
    ['无线充电', typeof p.battery?.wirelessChargeW === 'number' ? `${p.battery.wirelessChargeW} W` : na(null)],
    ['标称视频播放', typeof p.battery?.vendorClaimedVideoHours === 'number' ? `${p.battery.vendorClaimedVideoHours} 小时` : na(null)],
    ['后摄', rear.length ? rear.map((c) => `${roleLabel(c.role)}${c.mp ? ` ${c.mp} MP` : ''}${c.aperture ? ` ${esc(c.aperture)}` : ''}`).join(' · ') : na(null)],
    ['前摄', p.camera?.front ? `${p.camera.front.mp} MP${p.camera.front.aperture ? ` ${esc(p.camera.front.aperture)}` : ''}` : na(null)],
    ['视频', p.camera?.videoMax ? esc(p.camera.videoMax) : na(null)],
    ['尺寸', [p.body?.heightMm, p.body?.widthMm, p.body?.thicknessMm].every((v) => typeof v === 'number') ? `${p.body.heightMm} × ${p.body.widthMm} × ${p.body.thicknessMm} mm` : na(null)],
    ['重量', typeof p.body?.weightG === 'number' ? `${p.body.weightG} g` : na(null)],
    ['防护', p.body?.ipRating ? esc(p.body.ipRating) : na(null)],
    ['材质', p.body?.material ? esc(p.body.material) : na(null)],
    ['配色', p.body?.colors?.length ? esc(p.body.colors.join(' / ')) : na(null)],
    ['Wi-Fi', p.connectivity?.wifi ? esc(p.connectivity.wifi) : na(null)],
    ['蓝牙', p.connectivity?.bluetooth ? esc(p.connectivity.bluetooth) : na(null)],
    ['NFC', p.connectivity?.nfc === true ? '支持' : p.connectivity?.nfc === false ? '不支持' : na(null)],
    ['卫星通信', p.connectivity?.satellite === true ? '支持' : p.connectivity?.satellite === false ? '不支持' : na(null)],
    ['SIM', p.connectivity?.sim ? esc(p.connectivity.sim) : na(null)],
    ['USB', p.connectivity?.usb ? esc(p.connectivity.usb) : na(null)],
    ['系统', p.os?.launch ? esc(p.os.launch) : na(null)],
  ];
  const kvHtml = `<section class="card">
  <h2>规格 <span class="c">${kv.filter(([, v]) => !String(v).includes('unpub')).length} / ${kv.length} 项已公布</span></h2>
  <div class="cols">
    <dl class="kv">${kv.slice(0, Math.ceil(kv.length / 2)).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    <dl class="kv">${kv.slice(Math.ceil(kv.length / 2)).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
  </div>
</section>`;

  // SKU
  const skuHtml = (p.skus ?? []).length
    ? `<section class="card">
  <h2>版本与价格 <span class="c">${p.skus.length} 个 SKU</span></h2>
  <div style="overflow-x:auto"><table>
    <thead><tr><th>存储</th><th style="text-align:right">运行内存</th><th style="text-align:right">官网价</th><th>价格说明</th></tr></thead>
    <tbody>${p.skus
      .map(
        (s) => `<tr>
      <td class="n">${s.storageGb ? `${s.storageGb >= 1024 ? `${s.storageGb / 1024} TB` : `${s.storageGb} GB`}` : UNPUB}</td>
      <td class="n" style="text-align:right">${s.ramGb ? `${s.ramGb} GB` : UNPUB}</td>
      <td class="n" style="text-align:right;font-weight:600">${s.priceCny ? esc(fmtPrice(s.priceCny)) : UNPUB}</td>
      <td style="color:var(--ink3);font-size:12px">${esc(s.priceNote ?? '—')}</td>
    </tr>`
      )
      .join('')}</tbody>
  </table></div>
</section>`
    : '';

  // 访客评价（预留位）
  const ratingHtml = `<section class="card">
  <h2>访客评价 <span class="c">${A.visitorRatings.enabled ? '已启用' : '未启用'}</span></h2>
  ${
    d.visitorRating
      ? `<div class="ratingbox" style="border-style:solid"><span class="stars">${'★'.repeat(Math.round(d.visitorRating.score))}${'☆'.repeat(5 - Math.round(d.visitorRating.score))}</span><span><b>${d.visitorRating.score}</b> / 5 · ${d.visitorRating.count} 人评价</span></div>`
      : `<div class="ratingbox">
    <span class="stars">☆☆☆☆☆</span>
    <div><div class="big">暂无访客评价</div><div class="sm">${esc(A.visitorRatings.reason)}</div></div>
  </div>
  <details style="margin-top:11px">
    <summary style="cursor:pointer;font-size:12.5px;color:var(--ink3)">这个位置将来怎么填</summary>
    <p class="srcline" style="margin-top:8px;line-height:1.8">
      位置和文案已经留好，接入数据源时不需要改页面代码。两种方式：<br>
      A. 离线快照 —— 把聚合后的评分写成 <code class="mono">${esc(A.visitorRatings.file)}</code>（字段：${Object.entries(A.visitorRatings.schema).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('，')}），构建时读入；<br>
      B. 表单提交 —— 接一个 Serverless 函数接收评分，再由 GitHub Actions 定时导出成同样的 JSON 快照，保持纯静态站形态。
    </p>
  </details>`
  }
</section>`;

  // 数据来源
  const prov = p.provenance ?? {};
  const provCount = Object.keys(prov).length;
  const srcHtml = `<section class="card">
  <h2>数据来源 <span class="c">${provCount} 个字段有据可查</span></h2>
  <dl class="kv">
    <dt>主源</dt><dd>${esc(A.sources[`${p.brand}-official`]?.note ?? '厂商官网规格页')}</dd>
    <dt>抓取时间</dt><dd class="mono">${esc(A.sources[`${p.brand}-official`]?.fetchedAt?.slice(0, 19).replace('T', ' ') ?? '—')} UTC</dd>
    <dt>快照时间</dt><dd class="mono">${esc((A.dataGeneratedAt ?? '').slice(0, 19).replace('T', ' ') || '—')} UTC</dd>
    <dt>发布日期</dt><dd class="mono">${esc(p.releaseDate ?? '—')}${p.releaseDatePrecision ? `（${esc(p.releaseDatePrecision)} 精度）` : ''}</dd>
  </dl>
  <p class="srcline">本站参数全部来自厂商官网，不引用第三方评测、不做估算。抓取与规范化脚本开源，链路可复现。</p>
</section>`;

  return shell({
    title: p.name,
    nav: '',
    depth: 1,
    body: hero + axes + ana + lineage + kvHtml + skuHtml + ratingHtml + srcHtml,
  });
}

function roleLabel(role) {
  return { main: '主摄', ultrawide: '超广角', tele: '长焦', periscope: '潜望长焦', depth: '景深' }[role] ?? role;
}

/* ------------------------------------------------------------------ *
 * 构建入口
 * ------------------------------------------------------------------ */
async function build() {
  rmSync(OUT, { recursive: true, force: true });
  for (const d of ['products', 'brand', 'compare', 'compare/hq']) mkdirSync(join(OUT, d), { recursive: true });

  write('index.html', indexPage());
  write('categories.html', categoriesPage());
  write('rankings.html', rankingsPage());
  write('brands.html', brandsPage());
  write('timeline.html', timelinePage());
  write('all.html', allPage());
  for (const id of Object.keys(A.brands)) {
    const html = brandPage(id);
    if (html) write(`brand/${id}.html`, html);
  }
  for (const p of products) write(`products/${p.id}.html`, productPage(p));

  /* 对比页：复用 preview/render.mjs 的行定义与阈值判断 */
  const render = await import('../preview/render.mjs');
  const spec = await import('../../src/lib/compare-spec.mjs');
  const derived = render.loadDerived(join(ROOT, '_work/derived.json'));

  const { CSS: SITE_CSS } = { CSS: '' };
  const comparePage = (x, y) => {
    const opts = {
      a: x, b: y, brandA: x.brand, brandB: y.brand,
      accentA: { accent: '#0071e3', soft: 'rgba(0,113,227,.13)', line: 'rgba(0,113,227,.38)' },
      accentB: { accent: '#cf0a2c', soft: 'rgba(207,10,44,.13)', line: 'rgba(207,10,44,.38)' },
      fixture: false, autoPicked: false, autoWhy: null, showSideTag: true,
      derivedPath: derived?.path ?? null,
    };
    const entries = spec.ROWS.map((row) => render.evaluateRow(row, x, y, { a: null, b: null }));
    const html = render.renderPage({
      a: x, b: y, opts, entries,
      dataInfo: { products: [x, y], vendors: [], generatedAt: P.generatedAt ?? new Date().toISOString(), path: 'data/products.json', mtime: null, isSnapshot: true, tried: [] },
      derived, generatedAt: new Date().toISOString(),
    });
    const bodyM = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
    const styleM = (html.match(/<style>([\s\S]*)<\/style>/g) ?? []).map((s) => s.replace(/<\/?style>/g, '')).join('\n');
    return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(x.name)} vs ${esc(y.name)} · 手机参数世界</title>
<style>${styleM}</style></head>
<body><div style="max-width:1140px;margin:0 auto;padding:0 20px 72px">
<p style="padding:16px 0 0;font-size:13px"><a href="../index.html" style="color:var(--ink3)">← 回首页</a></p>
<h1 style="font-size:22px;margin:6px 0 0">${esc(x.name)} <span style="color:var(--ink4)">VS</span> ${esc(y.name)}</h1>
${bodyM ? bodyM[1] : html}
</div></body></html>`;
  };

  // 对对阵列：每台苹果机 vs 价格最接近的华为机
  const pairs = [];
  for (const a of products.filter((p) => p.brand === 'apple')) {
    const pa = detailOf(a.id).price;
    if (pa === null) continue;
    let best = null, gap = Infinity;
    for (const b of products.filter((p) => p.brand === 'huawei')) {
      const pb = detailOf(b.id).price;
      if (pb === null) continue;
      const g = Math.abs(pa - pb);
      if (g < gap) { gap = g; best = b; }
    }
    if (best) pairs.push([a, best]);
  }
  for (const [x, y] of pairs) write(`compare/${x.id}-vs-${y.id}.html`, comparePage(x, y));
  // 固定加一张旗舰对阵
  const fa = byId.get('huawei-mate90-pro');
  const fb = byId.get('apple-iphone-18-pro');
  if (fa && fb && !pairs.some(([x, y]) => x.id === fa.id && y.id === fb.id)) {
    write(`compare/${fa.id}-vs-${fb.id}.html`, comparePage(fa, fb));
  }

  // 源码行说明（页脚用）
  const line = [
    `index.html          今日格局`,
    `categories.html     分类查看`,
    `rankings.html       排行榜（${A.leagues.length} 榜 + ${A.dimensions.length} 维）`,
    `brands.html         厂商分区`,
    `brand/<id>.html     厂商页 × ${Object.keys(A.brands).length}`,
    `timeline.html       发布史时间线`,
    `all.html            全部机型`,
    `products/<id>.html  详情页 × ${products.length}`,
    `compare/*.html      对比页 × ${pairs.length}`,
  ].join('\n');
  console.log(`站点已生成 → ${OUT}`);
  console.log(line);
  console.log(`\n搜索索引：${SEARCH_INDEX.items.length} 条，每页内联（file:// 可直接用）`);
  console.log(`六维能力：${A.dimensions.map((d) => d.label).join(' / ')}`);
  console.log(`访客评价：${A.visitorRatings.enabled ? '已启用' : '预留未启用（页面已留位）'}`);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
