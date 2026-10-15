/**
 * i18n SSR 冒烟：把整站在 zh-CN / en 两种语言下逐路由渲染一遍，抓两类红灯：
 *
 *  1. 缺键抛错 —— src/i18n 配了 missing: throw，任何没抽干净的键会在渲染期炸出来；
 *  2. 英文页界面残留中文 —— 数据本身带中文（华为/苹果/麒麟/鸿蒙/颜色名…）属正常，
 *     所以判定用「数据白名单」：从 public/data/*.json 里抽出所有 CJK 连续段作白名单，
 *     英文页里出现的 CJK 段若不在白名单内，就是没抽走的 UI 硬编码，判红。
 *
 * 零新增依赖：vite 走 devDep，@vue/server-renderer 随 vue 一起装好。
 *
 *   node scripts/smoke/i18n-ssr.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installTsResolver } from '../ts-resolver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
process.chdir(ROOT);

// 白名单要拿术语表的真身来算，不能另抄一份切分/匹配逻辑（第二真源 = 白名单漂移）。
//
// ⚠️ 注意这里有两份 i18n 实例：ts-resolver 加载的（本文件用）和 vite ssrLoadModule
// 加载的（下面渲染用）。两个 loader 各建一份模块注册表，setLocale 只影响自己那份。
// 所以白名单算之前必须**用 ts-resolver 这一份的 setLocale** 切到 en，
// 否则 localizeSpecValue 读到的还是默认语言、原文不动，白名单又变回「什么都放过」。
installTsResolver();
const { localizeSpecValue } = await import('../../src/lib/glossary.ts');
const { setLocale: setLocaleForGlossary } = await import('../../src/i18n/index.ts');

// ── 1. 数据白名单：数据里本来就有的中文不算泄漏 ────────────────────────────
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

/**
 * ⚠️ 白名单**只从真正会当「产品标识」展示的字段**抽，不能扫整个 JSON。
 *
 * 第一版图省事把 public/data/*.json 全文扫了一遍，结果 products.json 里的
 * rawOfficial（官网原文，中文成段）把「全部」「与」「麒麟」这类常用字全变成了
 * 白名单词——于是三处真的硬编码中文（画布分面的「全部」、搜索提示里的「与」、
 * 芯片名「麒麟」）在英文页上堂而皇之地显示，冒烟却一直绿。
 * **白名单越宽，闸门越像装饰品**：它当时放过的不是噪声，正是要抓的东西。
 *
 * 现在只认这几个字段：品牌名、机型名、中文机型名、产品线、型号代码。
 * 其余（芯片名、系列名、变体名、状态、价格档）一律必须翻译，不许残留中文。
 */
const WHITELIST_FIELDS = ['name', 'nameZh', 'line', 'modelCode'];

/**
 * 第二级白名单：specs 里的官网原文值 —— 但**只放行术语表翻译后仍残留的中文**。
 *
 * 参数值是从中文官网抓下来的原文。英文页本来会整段显示中文，现在
 * `src/lib/glossary.ts` 用「官方术语对照表」把能查到官方英文的词换掉
 * （`超视网膜 XDR 显示屏` → `Super Retina XDR display`），查不到的保留原文。
 *
 * ⚠️ 所以白名单必须**用同一个函数算**，不能把 specs 原文整段扫进来：
 * 整段扫等于把「铝金属设计」这类已经能翻译的词也洗白，术语表失效时冒烟照样绿
 * —— 正是 P32 那个洞的翻版。喂 `localizeSpecValue()` 再收残留，白名单才会
 * 自动跟着词表一起收窄：词表补一条，白名单瘦一圈，闸门紧一分。
 *
 * `chipset.name` 仍然整条排除：芯片型号有厂商官方英文名，是标识不是描述，
 * 不许残留（curated/facets.json 的 chipPrefixEn 与 glossary 的 Kirin 规则管这层）。
 */
const SPECS_WHITELIST_EXCLUDE = new Set(['chipset.name']);

// 算白名单要在 en 语境下（localizeSpecValue 只在英文下动手）
setLocaleForGlossary('en');

function dataCjkWhitelist() {
  const out = new Set();
  /**
   * ⚠️ 两类字段必须分开算，混在一起会让这条闸门自己失效（2026-10-15 实测）：
   *   - specs 值：英文页过 `localizeSpecValue`，所以只收「翻译完还是中文」的残留；
   *   - 机型标识字段（name/nameZh/line/modelCode）：**页面原样显示，不过术语表**
   *     （专有名词，没有官方英文就不该译）。若也按「翻译后」收，一旦某个名字里的
   *     词恰好被术语表新增词条译掉（如「机架式」→ rack-mount），该词就被剔出白名单，
   *     而页面还在原样显示它 —— 闸门立刻误报「界面残留中文」。
   *     实测正是这个词让 6 条路由同时误红：Mac Pro（2023 机架式）是机型名，不是泄漏。
   */
  const collect = (v, raw = false) => {
    if (typeof v !== 'string') return;
    const text = raw ? v : localizeSpecValue(v);
    for (const m of text.matchAll(CJK_RUN)) out.add(m[0]);
  };
  const dir = join(ROOT, 'public', 'data');
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of readdirSync(cur, { withFileTypes: true })) {
      const p = join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!ent.name.endsWith('.json')) continue;
      const json = JSON.parse(readFileSync(p, 'utf8'));
      // vendors：品牌展示名
      for (const v of json.vendors ?? []) {
        for (const f of WHITELIST_FIELDS) collect(v?.[f], true);
      }
      // products：机型标识字段 + specs 原文值（chipset.name 除外）
      for (const prod of json.products ?? []) {
        for (const f of WHITELIST_FIELDS) collect(prod?.[f], true);
        for (const [path, v] of Object.entries(prod?.specs ?? {})) {
          if (SPECS_WHITELIST_EXCLUDE.has(path)) continue;
          collect(v);
          if (Array.isArray(v)) for (const item of v) collect(item);
          else if (v && typeof v === 'object') for (const x of Object.values(v)) collect(x);
        }
      }
    }
  }
  return out;
}

// ── 2. 浏览器环境桩（必须在加载源码前装好）────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
// vue-router 会 querySelector('base') 再 getAttribute('href')，桩必须给出这些方法
const metaStub = { content: '', getAttribute: () => null, setAttribute() {} };
globalThis.document = {
  documentElement: { lang: 'zh-CN' },
  title: '',
  head: { appendChild() {} },
  querySelector: () => metaStub,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement: () => ({
    style: {},
    getContext: () => null,
    remove() {},
    click() {},
    setAttribute() {},
  }),
  body: { appendChild() {}, removeChild() {}, style: {} },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.window = {
  innerHeight: 900,
  innerWidth: 1440,
  devicePixelRatio: 1,
  location: {
    href: 'http://localhost/#/',
    hash: '#/',
    pathname: '/',
    search: '',
    host: 'localhost',
  },
  navigator: { language: 'zh-CN', userAgent: 'node' },
  // vue-router 的 useHistoryStateNavigation 解构的是 window.history / window.location
  history: {
    state: {},
    length: 1,
    pushState() {},
    replaceState() {},
    go() {},
    back() {},
    forward() {},
  },
  // intlify 在 NODE_ENV !== production 且 inBrowser 时会调 window.performance.now()
  // 给 devtools 打点；桩了 window 就得连这个一起给，否则每次 t() 都炸。
  performance: globalThis.performance ?? { now: () => Date.now() },
  console,
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: globalThis.localStorage,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  getComputedStyle: () => ({}),
};
// Node 22 自带只读的 navigator，只能用 defineProperty 覆盖
Object.defineProperty(globalThis, 'navigator', {
  value: globalThis.window.navigator,
  configurable: true,
  writable: true,
});
globalThis.location = globalThis.window.location;
// vue-router 的 createWebHashHistory/createRouter 读的是裸全局 location/history。
// 只要 import 路由表，模块顶层的 createRouter 就会执行，所以这两个桩绕不开。
// 渲染本身走 memory history，不会真去 pushState。
globalThis.history = {
  state: {},
  pushState() {},
  replaceState() {},
  go() {},
  back() {},
  forward() {},
};
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^(\.\/|\/)/, '');
  try {
    const text = readFileSync(join(ROOT, 'public', rel), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  }
};

const server = await createServer({
  root: ROOT,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const { createApp } = await import('vue');
const { renderToString } = await import('@vue/server-renderer');
const { default: App } = await server.ssrLoadModule('/src/App.vue');
const { i18n, setLocale } = await server.ssrLoadModule('/src/i18n/index.ts');
// 只取路由表，不取项目里那个 hash history 的 router —— 那玩意要 window.location/history，
// SSR 里没有。用 memory history 重现同一张表，路由不会和测试脚本分叉。
const { routes } = await server.ssrLoadModule('/src/router/index.ts');
// ⚠️ vue-router 必须经**项目文件转手**（ssr-deps.ts），不能裸说明符直调
// `ssrLoadModule('vue-router')`、更不能原生 import：这两条路径拿到的都与
// App.vue 内部 import 的不是同一个模块实例（实测 routeLocationKey Symbol
// 三方互不相等——vite 给直调路径解析到了另一份构建）。vue-router 的注入键
// 按 Symbol identity 比较，实例分裂 → provide 的键 ≠ 组件注入的键 →
// route 为 undefined、`route.name` 渲染期抛错，全路由红、零线索。
// 与文件头部「两份 i18n 实例」是同一类坑的第三次复发（前两次：i18n 双实例、
// 原生 import 直调），故固化为「转手文件 + 注入断言」双保险。
// createApp / renderToString 留原生 import 无妨——它们只被本脚本用、
// 不进组件注入链（最小复现实测混用可行）。
const { createRouter, createMemoryHistory, routeLocationKey } = await server.ssrLoadModule(
  '/scripts/smoke/ssr-deps.ts',
);

// 先把数据集灌进模块级 cache：useDataset 是在组件 setup 里发 fetch、异步回填单例 ref 的，
// 而 SSR 不等 onMounted、也不等这个 promise，不预热的话首轮渲染出来的是空壳
// （zh 与 en 长度会差好几倍，页面内容根本没覆盖到）。
const { loadDataset } = await server.ssrLoadModule('/src/lib/data.ts');
await loadDataset();
const { useDataset } = await server.ssrLoadModule('/src/lib/useDataset.ts');
const { ds, err: dsErr } = useDataset();
for (let i = 0; i < 100 && !ds.value && !dsErr.value; i++) {
  await new Promise((r) => setTimeout(r, 20));
}
if (!ds.value) {
  console.error(
    `❌ 数据集未就绪：${dsErr.value ?? '超时'}（预热失败，后面测的都是空壳，结果不可信）`,
  );
  await server.close();
  process.exit(1);
}

async function renderRoute(route) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.push(route);
  await router.isReady();
  const app = createApp(App);
  app.use(router);
  app.use(i18n);
  // 健全性检查（不是完整闸门，别误会它能拦实例分裂）：router 装了之后，
  // 它自己实例的注入键必须落进 provides。拦的是「router 压根没装上」
  // （use 顺序被改、install 被守卫挡掉之类）——那也会产出同一句看不懂的
  // 「reading 'name'」。真正的实例分裂拦不住也正常：createRouter 与
  // routeLocationKey 同源，符号永远自洽；跨实例的判据在下面 catch 的形态翻译。
  if (!(routeLocationKey in app._context.provides)) {
    throw new Error('router 注入键未生效：app.use(router) 没有 provide 成功（use 顺序/install 被挡？）');
  }
  try {
    return await renderToString(app);
  } finally {
    router.push('/');
    await router.isReady();
  }
}

const products = JSON.parse(readFileSync(join(ROOT, 'public/data/products.json'), 'utf8'));
const sampleId = products.products?.[0]?.id;
// 挑两个不同品牌的机型，覆盖详情页里「同系列 / 竞品」这类分支
const otherBrand = products.products?.find(
  (p) => p.brand && p.brand !== products.products[0]?.brand,
);
const sampleId2 = otherBrand?.id;

const ROUTES = [
  '/',
  '/compare',
  '/rankings',
  '/timeline',
  '/search',
  '/about',
  '/canvas',
  '/globe',
  '/brand/huawei',
  '/brand/apple',
  '/nope-404',
  ...(sampleId ? [`/product/${sampleId}`] : []),
  ...(sampleId2 ? [`/product/${sampleId2}`] : []),
];

// 界面里**刻意**保留的中文（不进语言包），逐条写明出处，别让它变成掩盖真泄漏的口子：
const UI_ALLOW = new Set([
  // LocaleSwitch.vue：切换器按业界惯例各语言写自己的自称（中文/English），
  // 「看不懂当前语言的人」要能认出救命入口，译成另一种语言反而认不出来。
  '语言',
  '中文',
]);

const ALLOW = dataCjkWhitelist();
const LOCALES = ['zh-CN', 'en'];
const problems = [];
const stats = [];

for (const locale of LOCALES) {
  setLocale(locale);
  for (const route of ROUTES) {
    const tag = `[${locale}] ${route}`;
    let html;
    try {
      html = await renderRoute(route);
    } catch (err) {
      if (process.env.SSR_SMOKE_TRACE) console.error(err);
      const msg = String(err?.message ?? err).split('\n')[0];
      // 形态翻译：这句报错历史上只由一件事产生——App.vue 里 `route` 为 undefined
      // （useRoute() 注入失败），而根因是 router 与组件不是同一模块实例
      // （vite SSR 下裸说明符直调 ssrLoadModule('vue-router') 会拿到另一份
      // 构建，Symbol 不相等）。原句与根因零关联，第一次排查挖了半小时——
      // 这里把结论直接写在脸上，后来者不用再挖一遍。
      const hint = msg.includes("reading 'name'")
        ? `${msg} ← App.vue 的 route 为 undefined：router 与组件模块实例分裂（见 scripts/smoke/ssr-deps.ts 头注）`
        : msg;
      problems.push(`${tag} 渲染抛错：${hint}`);
      continue;
    }
    if (html.length < 300) {
      problems.push(`${tag} 渲染过短（${html.length} 字符），疑似空页`);
      continue;
    }
    // 必须剥 HTML 注释：模板里大段中文「为什么这么写」的设计说明会被 SSR 原样输出成
    // <!-- -->，不剥的话几百条假警会淹没真正的泄漏（生产构建才会把这些注释编译掉）。
    const visible = html.replace(/<!--[\s\S]*?-->/g, '');
    const runs = [...visible.matchAll(CJK_RUN)].map((m) => m[0]);
    const leaks = [...new Set(runs.filter((s) => !ALLOW.has(s) && !UI_ALLOW.has(s)))];
    if (locale === 'en' && leaks.length) {
      problems.push(
        `${tag} 疑似界面残留中文（${leaks.length} 段）：${leaks.slice(0, 10).join(' / ')}`,
      );
      // 排查用：光报「哪个词」不够定位「哪个字段没过术语表」，设 I18N_LEAK_CONTEXT=1
      // 额外打印该词在页面里的上下文（含相邻标签），直接指出漏渲染的出口。
      if (process.env.I18N_LEAK_CONTEXT) {
        for (const leak of leaks) {
          const at = visible.indexOf(leak);
          if (at < 0) continue;
          console.log(
            `   ↳ 「${leak}」上下文：…${visible
              .slice(Math.max(0, at - 120), at + leak.length + 60)
              .replace(/\s+/g, ' ')}…`,
          );
        }
      }
    }
    if (locale === 'zh-CN' && runs.length === 0) {
      // 反向防假绿：中文页必须有中文，否则说明 t() 根本没接上
      problems.push(`${tag} 中文页一个汉字都没有，t() 可能没接上`);
    }
    stats.push({ locale, route, len: html.length, cjk: runs.length });
  }
}

console.log('── SSR 双语冒烟 ───────────────────────────────');
for (const s of stats) {
  console.log(
    `  ${s.locale.padEnd(5)} ${s.route.padEnd(28)} ${String(s.len).padStart(6)} 字符  CJK ${s.cjk}`,
  );
}
console.log(`  数据白名单：${ALLOW.size} 段`);
console.log('──────────────────────────────────────────────');
if (problems.length === 0) {
  console.log(`✅ ${stats.length} 次渲染全通过：无缺键抛错、英文页无界面残留中文、中文页确有中文`);
} else {
  for (const p of problems) console.log(`❌ ${p}`);
  console.log(`❌ ${problems.length} 处问题`);
}

await server.close();
process.exit(problems.length === 0 ? 0 : 1);
