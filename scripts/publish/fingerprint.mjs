#!/usr/bin/env node
/**
 * 内容指纹：回答「这次跑完，用户看得见的东西变了吗」。
 *
 * 为什么不能直接哈希文件
 * ----------------------
 * data/products.json 里带着一串**运行时刻**字段：顶层 generatedAt、每台机器的
 * firstSeenAt / lastSeenAt / retiredAt、每个 SKU 的 listedAt、每个源的 fetchedAt。
 * 这些值每次跑管线都在变，跟官网数据有没有变毫无关系。
 *
 * 直接哈希整个文件的后果是：指纹每次都不同 → 「数据无变化就跳过提交」永远不成立
 * → CI 每 12 小时制造一次空提交 → 下游的「内容没变就不发布」也一并失效。
 * 实测连跑两次、一台机器的数据都没动，哈希从 3c0a68e2 变成 e637e240。
 *
 * 所以这里先剥掉运行时刻，再哈希剩下的内容。保留业务日期（releaseDate、windowStart），
 * 那是用户看得见的信息，变了就应当算变化。
 *
 * 站点指纹为什么 = 数据指纹 + 模板哈希
 * ------------------------------------
 * 页面是「数据 × 模板」的产物。两条路都会改变用户看到的东西：
 *   - 官网数据变了（新机发布、价格调整）→ 数据指纹变
 *   - 模板改了（新增板块、修版式）      → 模板哈希变
 * 反过来，页面里那些「数据快照 2026-10-02 15:01 UTC」是给用户看新鲜度的，
 * 每次都变但不该触发发布。用组合式指纹天然绕开了在 HTML 里剥离时间文本的难题——
 * 那种做法容易把业务日期（发布日期）一起误删。
 *
 * 用法
 * ----
 *   node scripts/publish/fingerprint.mjs              # 算指纹并写入 _work/fingerprint.json
 *   node scripts/publish/fingerprint.mjs --check      # 只比对，不写盘；输出给 CI 的 should_* 标志
 *   node scripts/publish/fingerprint.mjs --github     # --check 之外另写 $GITHUB_OUTPUT
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
const FOR_GITHUB = argv.includes('--github');

const DATA_FILE = join(ROOT, 'data/products.json');
/**
 * 待收录队列。**不参与 dataFingerprint**，单算一个指纹。
 *
 * 为什么单算：队列里是「官网已抓到但缺发布日期」的机型，它进不了 products.json，
 * 所以内容一变dataFingerprint 就不动、站点指纹也不动 ——
 * CI 若只看那两个标志，队列永远提交不进仓库。而这恰恰是「安静地丢了一台新机」
 * 最难发现的形态：台数没少、页面没变、没报错，只是多了一台本该上站的机器没人知道。
 *
 * 所以它有自己独立的 changed 标志，CI 拿它决定「要不要提交」，
 * 但**不参与站点指纹** —— 队列变化不该触发重新发布站点（用户看不到变化）。
 */
const PENDING_FILE = join(ROOT, 'data/discovery-pending.json');
/**
 * 用户手动数据层（v2 全品类目录）。与队列同理单算指纹：**不参与 dataFingerprint /
 * siteFingerprint**——用户改了参数，应用后的值已经落进 products.json，
 * 站点指纹自然会变；这里只要保证「CI 知道 overrides.json 变了、要提交」。
 */
const OVERRIDES_FILE = join(ROOT, 'data/overrides.json');
/**
 * 本次结果：含与上一次的比对。_work/ 不入库，只在同一次 CI job 内流通。
 */
const OUT_FILE = join(ROOT, '_work/fingerprint.json');
/**
 * 上一次的状态：**入库**，随数据一起提交。下一次 CI checkout 时读它做比对。
 * 这就是参考项目把指纹写进包根的同一个思路 —— 线上那份即上次发布的记录。
 * 里面不含时间戳，否则每次 git diff 都非空，去重又失效。
 */
const POINTER_FILE = join(ROOT, 'data/.fingerprint');

/**
 * 运行时刻字段：随每次管线运行变化，与用户看到的内容无关。
 * 只写字段名后缀，避免误伤业务日期。
 */
const VOLATILE_KEYS = new Set([
  'generatedAt',
  'firstSeenAt',
  'lastSeenAt',
  'retiredAt',
  'listedAt',
  'fetchedAt',
  'publishedAt',
  'syncedAt',
  'builtAt',
  'snapshotAt',
  'extractedAt',
]);

/** 深拷贝并剥掉运行时刻字段。递归时重建对象，保证键序稳定（键序影响序列化结果） */
function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value === null || typeof value !== 'object') return value;

  const out = {};
  for (const k of Object.keys(value).sort()) {
    if (VOLATILE_KEYS.has(k)) continue;
    const v = value[k];
    if (v === undefined) continue;
    out[k] = stripVolatile(v);
  }
  return out;
}

/** 稳定序列化：键序已在上一步排好，JSON.stringify 即可复现 */
function canonicalHash(obj) {
  const json = JSON.stringify(obj);
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/** 递归收集目录下指定后缀文件的 (相对路径, 内容哈希)，用于算模板指纹 */
function collectFiles(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (exts.some((e) => name.endsWith(e))) {
        out.push({
          path: relative(ROOT, p).split('\\').join('/'),
          // 归一化行尾再哈希。Windows 上 checkout 出来是 CRLF，Linux CI 上是 LF，
          // 同一份代码会算出两个模板指纹 —— 于是本地推一次、CI 就判成「站点变了」
          // 发布一次，反过来 CI 提交后本地又判一次变，两边来回空转。
          hash: createHash('sha256')
            .update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))
            .digest('hex')
            .slice(0, 16),
        });
      }
    }
  };
  walk(dir);
  return out;
}

/** 单文件取 (相对路径, 内容哈希)，文件不存在时返回 null，便于声明式列出 */
function collectOne(relPath) {
  const p = join(ROOT, relPath);
  if (!existsSync(p) || !statSync(p).isFile()) return null;
  return {
    path: relPath.split('\\').join('/'),
    hash: createHash('sha256')
      .update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))
      .digest('hex')
      .slice(0, 16),
  };
}

/** 队列指纹：内容就是纯数据（无时间戳），直接哈希字节即可 */
/**
 * 原始响应归档：也是独立指纹，同样**不参与 dataFingerprint / siteFingerprint**。
 *
 * 与队列同理：官网改版时归档件会变，但用户看到的页面可能完全没变
 * （比如官网只是把某个章节标题改了个字，而那个字段没进products.json）。
 * 这时站点不该重新发布，但归档必须更新 —— 否则它记的是上一个版本的官网。
 */
const RAW_DIR = join(ROOT, 'data/raw');

/** 剥掉 raw 归档里的运行时字段再哈希。
 *  `_source.fromCache` 随每次缓存命中翻转（false↔true），不剥的话
 *  rawFingerprint 会被缓存状态搅动，制造与内容无关的指纹变化。 */
function stripRawVolatile(text) {
  try {
    const parsed = JSON.parse(text);
    for (const p of parsed.products ?? []) {
      if (p.raw) delete p.raw['_source.fromCache'];
    }
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

function computeRawFingerprint() {
  if (!existsSync(RAW_DIR)) return { rawFingerprint: 'empty', rawBytes: 0 };
  const files = readdirSync(RAW_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const parts = [];
  let bytes = 0;
  for (const f of files) {
    const raw = readFileSync(join(RAW_DIR, f), 'utf8');
    bytes += Buffer.byteLength(raw);
    parts.push(
      `${f}:${createHash('sha256').update(stripRawVolatile(raw).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)}`,
    );
  }
  return {
    rawFingerprint: createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16),
    rawBytes: bytes,
  };
}

function computePendingFingerprint() {
  if (!existsSync(PENDING_FILE)) return { pendingFingerprint: 'empty', pendingCount: 0 };
  const raw = readFileSync(PENDING_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    pendingFingerprint: createHash('sha256')
      .update(raw.replace(/\r\n/g, '\n'))
      .digest('hex')
      .slice(0, 16),
    pendingCount: parsed?.count ?? parsed?.items?.length ?? 0,
  };
}

/** 用户数据层指纹：条目内容即用户可见内容，直接哈希字节 */
function computeOverridesFingerprint() {
  if (!existsSync(OVERRIDES_FILE)) return { overridesFingerprint: 'empty', overridesCount: 0 };
  const raw = readFileSync(OVERRIDES_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    overridesFingerprint: createHash('sha256')
      .update(raw.replace(/\r\n/g, '\n'))
      .digest('hex')
      .slice(0, 16),
    overridesCount: (parsed?.entries ?? []).length,
  };
}

function compute() {
  if (!existsSync(DATA_FILE)) {
    console.error('❌ 找不到 data/products.json，先跑一次管线');
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const stable = stripVolatile(raw);

  // 数据指纹：只反映用户看得见的规格内容
  const dataFingerprint = canonicalHash(stable);

  // 模板指纹：**Vite 前端的渲染层**。改了版式/加了板块/换组件就应当重新发布。
  //
  // 2026-10-03 渲染层从「mjs 手写模板」换成 Vite + Vue3 + TS + Tailwind v4 之后，
  // 这里的采集范围跟着换了三处：
  //   1. 主源从 scripts/**/*.mjs 换成 src/**（.vue 组件 / .ts 逻辑 / .css 设计令牌）。
  //      旧建站器（scripts/site/）已不是发布物路径，不该再算进指纹。
  //   2. 补上构建期配置：index.html（字体与 favicon 的内联声明）、vite.config.ts
  //      （base:'./' 是 Toy 能否加载的决定项）、postcss.config.mjs、package.json
  //      （依赖升级会改变产物字节）。这几个是单文件，声明式列出。
  //   （2026-10-16：原第 3 项「精灵图生成器 scripts/sprite/」随去像素化退役一并移除——
  //   立绘不再渲染，改画法不再改变任何用户可见产物。）
  //
  // 排除的：public/favicon.svg 等二进制资源（用固定哈希会被换资源时漏判；
  // 真正的字节变化由构建产物与 dataFingerprint 之外的手段兜底，
  // 换资源属于人工低频操作，按注释里的指针手动 --write-pointer 即可）。
  // （2026-10-17：原排除项里的 public/fonts 字体已随去像素化退役，路径不存在了。）
  const templateFiles = [
    ...collectFiles(join(ROOT, 'src'), ['.vue', '.ts', '.css']),
    ...[
      collectOne('index.html'),
      collectOne('vite.config.ts'),
      collectOne('postcss.config.mjs'),
      collectOne('package.json'),
    ].filter(Boolean),
  ];
  const templateFingerprint = canonicalHash(templateFiles.map((f) => `${f.path}:${f.hash}`));

  // 站点指纹：数据与模板的组合。任一变化都意味着用户看到的东西变了
  const siteFingerprint = createHash('sha256')
    .update(`${dataFingerprint}|${templateFingerprint}`)
    .digest('hex')
    .slice(0, 16);

  const products = raw.products ?? [];
  const byBrand = products.reduce((a, p) => {
    a[p.brand] = (a[p.brand] ?? 0) + 1;
    return a;
  }, {});

  return {
    dataFingerprint,
    templateFingerprint,
    siteFingerprint,
    ...computePendingFingerprint(),
    ...computeOverridesFingerprint(),
    ...computeRawFingerprint(),
    // 下面这些只用于日志与 issue 摘要，不参与指纹计算
    stats: {
      products: products.length,
      byBrand,
      templateFiles: templateFiles.length,
      releaseDates: products.filter((p) => p.releaseDate).length,
    },
    strippedKeys: [...VOLATILE_KEYS],
  };
}

/* 顶层导出：pipeline.mjs 直接 import，不重复实现一遍指纹逻辑 */
export { compute };

/* 仅在被直接运行时执行 CLI 部分；被 import 时不做任何 IO */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const current = compute();

  /* ---------------- 比对：上次状态取入库的指针文件 ---------------- */
  const previous = existsSync(POINTER_FILE) ? JSON.parse(readFileSync(POINTER_FILE, 'utf8')) : null;

  const result = {
    ...current,
    previous: previous
      ? {
          dataFingerprint: previous.dataFingerprint,
          siteFingerprint: previous.siteFingerprint,
        }
      : null,
    changed: {
      data: previous ? previous.dataFingerprint !== current.dataFingerprint : true,
      site: previous ? previous.siteFingerprint !== current.siteFingerprint : true,
      /**
       * 队列变化。指针里没有这一项时算「变了」——
       * 那意味着队列是这次新加的功能（升级瞬间），第一轮就该把队列提交进去。
       * 用 `!==` 而不是「指针里存在才比」，避免新增功能上线时队列被永久漏掉。
       */
      pending: previous ? previous.pendingFingerprint !== current.pendingFingerprint : true,
      /** 归档变化。与队列同理：不参与站点发布，但要能提交。 */
      raw: previous ? previous.rawFingerprint !== current.rawFingerprint : true,
      /** 用户数据层变化。同理：不参与站点发布，但要能提交。 */
      overrides: previous ? previous.overridesFingerprint !== current.overridesFingerprint : true,
    },
    computedAt: new Date().toISOString(),
  };

  if (!CHECK_ONLY) {
    writeFileSync(OUT_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  /**
   * --write-pointer：把当前状态推进到入库的指针文件。
   * 只在真正提交/发布之后调用 —— 它代表「线上现在就是这一版」。
   */
  if (argv.includes('--write-pointer')) {
    const pointer = {
      dataFingerprint: current.dataFingerprint,
      siteFingerprint: current.siteFingerprint,
      templateFingerprint: current.templateFingerprint,
      products: current.stats.products,
      // 队列指纹同样要进指针，否则下一轮算不出「队列变了没」
      pendingFingerprint: current.pendingFingerprint,
      rawFingerprint: current.rawFingerprint,
      // 用户数据层指纹同理
      overridesFingerprint: current.overridesFingerprint,
    };
    writeFileSync(POINTER_FILE, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8');
    console.log(`已推进入库指针 data/.fingerprint → ${current.siteFingerprint}`);
  }

  /* ---------------- 输出 ---------------- */
  const s = result.stats;
  const brandSummary = Object.entries(s.byBrand)
    .map(([k, v]) => `${k} ${v}`)
    .join(' / ');

  console.log('数据指纹      ', result.dataFingerprint);
  console.log('模板指纹      ', result.templateFingerprint, `（${s.templateFiles} 个文件）`);
  console.log('站点指纹      ', result.siteFingerprint);
  console.log(`机型 ${s.products} 台（${brandSummary}）· 有发布日期 ${s.releaseDates} 台`);
  console.log(
    `待收录队列 ${current.pendingCount} 台（指纹 ${current.pendingFingerprint}）` +
      (current.pendingCount ? '——缺发布日期，需人工补 data/release-dates.json' : ''),
  );
  console.log(
    `原始响应归档 ${(current.rawBytes / 1024).toFixed(1)} KB（指纹 ${current.rawFingerprint}）`,
  );
  console.log(
    `用户数据层 ${current.overridesCount} 条（指纹 ${current.overridesFingerprint}）`,
  );
  console.log();
  if (!previous) {
    console.log('首次计算，无历史可比对 → data.changed=true  site.changed=true');
  } else {
    console.log(
      `数据内容变化：${result.changed.data ? '是' : '否'}（上次 ${previous.dataFingerprint}）`,
    );
    console.log(
      `站点内容变化：${result.changed.site ? '是' : '否'}（上次 ${previous.siteFingerprint}）`,
    );
    console.log(
      `待收录队列变化：${result.changed.pending ? '是' : '否'}` +
        `（上次 ${previous.pendingFingerprint ?? '（指针里没有，说明是本功能上线后的第一轮）'}）`,
    );
  console.log(
    `归档变化：${result.changed.raw ? '是' : '否'}` +
      `（上次 ${previous.rawFingerprint ?? '（指针里没有，本功能上线后的第一轮）'}）`,
  );
  console.log(
    `用户数据层变化：${result.changed.overrides ? '是' : '否'}` +
      `（上次 ${previous.overridesFingerprint ?? '（指针里没有，本功能上线后的第一轮）'}）`,
  );
  }

  const gh = [
    `data_fingerprint=${result.dataFingerprint}`,
    `site_fingerprint=${result.siteFingerprint}`,
    `data_changed=${result.changed.data}`,
    `site_changed=${result.changed.site}`,
    `pending_changed=${result.changed.pending}`,
    `pending_count=${current.pendingCount}`,
    `raw_changed=${result.changed.raw}`,
    `raw_fingerprint=${current.rawFingerprint}`,
    `overrides_changed=${result.changed.overrides}`,
    `overrides_count=${current.overridesCount}`,
    `products=${s.products}`,
  ];

  if (FOR_GITHUB) {
    const outPath = process.env.GITHUB_OUTPUT;
    if (!outPath) {
      console.error('❌ --github 需要 GITHUB_OUTPUT 环境变量（只在 GitHub Actions 里有）');
      process.exit(1);
    }
    // 追加而非覆盖：同一个 job 里前面的步骤可能已经写过
    const { appendFileSync } = await import('node:fs');
    appendFileSync(outPath, `${gh.join('\n')}\n`, 'utf8');
    console.log(`\n已写入 GITHUB_OUTPUT：${gh.join('  ')}`);
  } else {
    console.log(`\nCI 可用标志：${gh.join('  ')}`);
  }
}
