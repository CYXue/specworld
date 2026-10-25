#!/usr/bin/env node
/**
 * xiaomi.mjs — 小米商城（www.mi.com）手机品类「取数适配器」
 *
 * 数据源结论（来自 _work/mi-view.json / _work/mi-catalog.json，实测 2026-10-24）：
 *   - 商品数据走 https://api2.order.mi.com/product/view?product_id=X&version=2
 *     （JSON，无需登录）。返回 goods_list[].goods_info：
 *       name / price / class_parameters（「关键参数」name-value 对，官方结构化）
 *     注意参数名是 product_id（不是 gid / goods_id；goods_id 是 SKU 级 id）。
 *   - **完整规格表在商城是图片**（extend_info.desc_tabs_view 的 plain_view jpg），
 *     无结构化接口 → 本适配器只取 class_parameters 的「关键参数」，
 *     覆盖率天然偏浅是官网结构性事实，缺的留 null（数据诚信，不 OCR 不编造）。
 *   - 目录来源：www.mi.com/shop 首页 HTML 内嵌的 product_id（200 个，含全品类），
 *     逐个过 view 接口后按名称筛手机（/Xiaomi 1[78]|REDMI (K|Note|Turbo)/ 系）。
 *     随行 WiFi/平板/电视等同站点品类后续按同法扩充。
 *
 * 用法：
 *   node scripts/sources/xiaomi.mjs --out _work/xiaomi.raw.json
 *   node scripts/sources/xiaomi.mjs --offline           # 只用缓存
 *   node scripts/sources/xiaomi.mjs --only 25524        # 只跑指定 product_id
 *
 * 无第三方依赖（Node ≥18 内置 fetch）。只访问 www.mi.com 与 api2.order.mi.com。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOP_URL = 'https://www.mi.com/shop';
const VIEW_URL = 'https://api2.order.mi.com/product/view';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
/** 串行请求间隔（对齐华为适配器的礼貌口径） */
const DELAY_MS = 1100;
const TIMEOUT_MS = 20_000;
const RETRIES = 2;

/** 手机品类名称筛选（试点品类；Pad/Book/电视/米家电后续品类另加）。
 * 「不发货」是新品礼等非实体商品（无规格页数据），从目录里排除 */
const NON_PHYSICAL_RE = /不发货|新品礼/;

/**
 * 小米品类注册表：品类 id → 名称筛选正则（作用于商城商品名）。
 * 目录候选池是全站 200 个商品 id，每个品类用它自己的正则从池里筛。
 * 试点顺序按 schema 现成度：phone → tablet/laptop/tv/wearable/headset/speaker/display/network
 * （米家家电——空调/冰箱/洗衣机等——schema 未建，后置，见 docs/BRAND-CATEGORY-ONBOARDING.md）。
 */
const XIAOMI_CATEGORIES = Object.freeze({
  phone: /Xiaomi\s?1[789]|REDMI (K\d|Note \d|Turbo|K Pad)|Civi/i,
  tablet: /Pad/i,
  laptop: /Book/i,
  tv: /电视|TV/i,
  wearable: /手环|手表|WATCH|Band/i,
  headset: /Buds|耳机/i,
  speaker: /Sound(?!.*路由)|音箱/i,
  display: /显示器/i,
  network: /路由|WiFi|Wi-Fi/i,
  /** 米家家电：空调/冰箱/洗衣机/净化/厨电/清洁/门锁等（复用 home schema，见 BRAND-CATEGORY-ONBOARDING.md） */
  appliance:
    /空调|冰箱|洗衣机|净化|新风|除湿|加湿|吸尘|洗地|扫地|微波|电饭|电压力|净水|热水器|烟灶|蒸烤|空气炸|破壁|养生壶|风扇|取暖|电暖|门锁|猫眼|窗帘|开关|插座|温湿度|摄像头|可视门铃|电水壶|饮水|跑步机|健身/i,
});
const DEFAULT_CATEGORY = 'phone';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const WORK_DIR = path.join(PROJECT_ROOT, '_work');
const DEFAULT_CACHE_DIR = path.join(WORK_DIR, 'xiaomi.cache');
const DEFAULT_OUT = path.join(WORK_DIR, 'xiaomi.raw.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 极简 JSON 落盘缓存：_work/xiaomi.cache/<id>.json */
class Cache {
  constructor(dir, { offline = false } = {}) {
    this.dir = dir;
    this.offline = offline;
    fs.mkdirSync(dir, { recursive: true });
  }
  file(id) {
    return path.join(this.dir, `${id}.json`);
  }
  read(id) {
    if (fs.existsSync(this.file(id))) {
      try {
        return JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
      } catch {
        return null;
      }
    }
    return null;
  }
  write(id, data) {
    fs.writeFileSync(this.file(id), JSON.stringify(data), 'utf8');
  }
}

async function getView(productId) {
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(DELAY_MS * attempt * 2);
    try {
      const res = await fetch(`${VIEW_URL}?product_id=${productId}&version=2`, {
        headers: { 'User-Agent': UA, Referer: 'https://www.mi.com/' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const j = await res.json();
      if (j.code === 200) return j.data;
      // 业务错误（-50011 商品不存在等）不算网络失败，直接返回由调用方判
      return { __code: j.code, __msg: j.msg };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`view ${productId} failed: ${lastErr?.message || lastErr}`);
}

/** 从商城首页 HTML 抽全部 product_id（目录候选池） */
function extractProductIds(html) {
  return [...new Set((html.match(/product_id[=":]+(\d{4,10})/g) || []).map((x) => x.replace(/\D/g, '')))];
}

export async function fetchAll(options = {}) {
  const {
    category = DEFAULT_CATEGORY,
    cacheDir = DEFAULT_CACHE_DIR,
    offline = false,
    only = null,
    log = () => {},
  } = options;
  const nameRe = XIAOMI_CATEGORIES[category];
  if (!nameRe) {
    throw new Error(`unknown category: ${category} (known: ${Object.keys(XIAOMI_CATEGORIES).join(', ')})`);
  }
  const started = Date.now();
  const cache = new Cache(cacheDir, { offline });
  const skipped = [];
  const products = [];

  // ---- 目录候选池 ----
  const shopCacheFile = path.join(cacheDir, 'shop.html');
  let shopHtml;
  if (fs.existsSync(shopCacheFile)) {
    shopHtml = fs.readFileSync(shopCacheFile, 'utf8');
  } else {
    if (offline) throw new Error('OFFLINE: shop.html 未缓存');
    const res = await fetch(SHOP_URL, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    shopHtml = await res.text();
    fs.writeFileSync(shopCacheFile, shopHtml, 'utf8');
  }
  let ids = extractProductIds(shopHtml);
  log(`[catalog] ${SHOP_URL} → ${ids.length} 个商品 id（候选池）`);

  if (only?.length) {
    const want = new Set(only);
    ids = ids.filter((id) => want.has(id));
    notes_push(`--only 过滤：${ids.length} 个`);
  }

  const notes = [];
  // ---- 逐商品：view → 名称筛手机 → 关键参数 ----
  for (const id of ids) {
    let data = cache.read(id);
    if (!data) {
      if (offline) {
        skipped.push({ id: `xiaomi-${id}`, reason: 'offline cache miss' });
        continue;
      }
      try {
        data = await getView(id);
        cache.write(id, data);
      } catch (e) {
        skipped.push({ id: `xiaomi-${id}`, reason: `view failed: ${e.message}` });
        continue;
      }
      await sleep(DELAY_MS);
    }
    if (data.__code) {
      skipped.push({ id: `xiaomi-${id}`, reason: `view code ${data.__code}: ${data.__msg}` });
      continue;
    }
    const g = data.goods_list?.[0]?.goods_info;
    if (!g) {
      skipped.push({ id: `xiaomi-${id}`, reason: 'no goods_info' });
      continue;
    }
    if (!nameRe.test(g.name) || NON_PHYSICAL_RE.test(g.name)) continue; // 非本品类/非实体商品：静默跳过

    // 关键参数 → 扁平 raw 键值（原文直存，映射器负责判口径）
    const raw = {};
    const cp = g.class_parameters;
    if (cp?.list) {
      for (const item of cp.list) {
        if (item.name && item.value) raw[item.name] = item.value;
      }
    }
    raw['_catalog.price'] = g.price ?? '';
    raw['_catalog.productId'] = String(g.product_id ?? id);
    raw['_catalog.goodsId'] = String(g.goods_id ?? '');
    raw['_catalog.shopUrl'] = `https://www.mi.com/shop/buy/detail?product_id=${g.product_id ?? id}`;

    products.push({
      id: `xiaomi-${id}`,
      brand: 'xiaomi',
      name: g.name,
      specsUrl: raw['_catalog.shopUrl'],
      raw,
      extractedAt: new Date().toISOString(),
    });
    log(`ok  ${id} "${g.name}" 关键参数 ${Object.keys(raw).filter((k) => !k.startsWith('_')).length} 项`);
  }

  const accounted = products.length + skipped.filter((s) => !s.reason.includes('非手机')).length;
  notes.push(
    `抓取完成：${products.length} 款${category}成功 / ${skipped.length} 条跳过记录；` +
      `候选池 ${ids.length} 个商品 id；耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  if (accounted > ids.length) {
    notes.push(`⚠ 覆盖度不守恒：products(${products.length}) + skipped(${skipped.length}) > 候选池 ${ids.length}`);
  }

  return {
    source: 'xiaomi-official',
    fetchedAt: new Date().toISOString(),
    notes,
    skipped,
    products,
    catalog: { catalogUrl: SHOP_URL, productCount: ids.length, fetchedCount: products.length },
  };
}

function notes_push(msg) {
  /* --only 过滤的提示走 fetchAll 内部 notes，这里仅占位避免 lint 报未用 */
}

// ---------------------------------------------------------------- CLI

function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') out.offline = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--category') out.category = argv[++i];
    else if (a.startsWith('--category=')) out.category = a.slice(11);
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--cache') out.cache = argv[++i];
    else if (a === '--only') out.only = (out.only || []).concat(argv[++i].split(','));
    else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgv(process.argv.slice(2));
  const category = args.category || DEFAULT_CATEGORY;
  const outPath = path.isAbsolute(args.out || '')
    ? args.out
    : path.resolve(
        PROJECT_ROOT,
        args.out ||
          (category === DEFAULT_CATEGORY
            ? DEFAULT_OUT
            : path.join(WORK_DIR, `xiaomi-${category}.raw.json`)),
      );
  const log = args.quiet ? () => {} : (m) => process.stdout.write(`  ${m}\n`);

  console.log(`小米官方适配器 · 品类 ${category} · 目录 ${SHOP_URL}`);
  const result = await fetchAll({
    category,
    cacheDir: path.resolve(PROJECT_ROOT, args.cache || DEFAULT_CACHE_DIR),
    offline: !!args.offline,
    only: args.only || null,
    log,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n写入 ${outPath}  (${result.products.length} 机型)`);
  for (const n of result.notes) console.log(`note: ${n}`);
  if (result.skipped.length) {
    console.log(`-- 跳过 ${result.skipped.length} 条（前 5）：`);
    for (const s of result.skipped.slice(0, 5)) console.log(`  ${s.id} :: ${s.reason}`);
  }
}

// 主入口判断：Windows 下 argv[1] 是盘符路径、import.meta.url 是 file:/// URL，
// 直接比较会失配 → 统一转成 URL 再比（跨平台口径）。
const isMain = (() => {
  try {
    return new URL(`file://${process.argv[1]}`.replace(/\\/g, '/')).href === import.meta.url;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
