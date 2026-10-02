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
import {
  existsSync, readFileSync, writeFileSync, readdirSync, statSync,
} from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
const FOR_GITHUB = argv.includes('--github');

const DATA_FILE = join(ROOT, 'data/products.json');
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
          hash: createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16),
        });
      }
    }
  };
  walk(dir);
  return out;
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

  // 模板指纹：站点生成器的代码。改了版式/加了板块就应当重新发布
  const templateFiles = [
    ...collectFiles(join(ROOT, 'scripts/site'), ['.mjs']),
    ...collectFiles(join(ROOT, 'src/lib'), ['.mjs', '.ts']),
  ];
  const templateFingerprint = canonicalHash(
    templateFiles.map((f) => `${f.path}:${f.hash}`),
  );

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
export { compute, stripVolatile, canonicalHash };

/* 仅在被直接运行时执行 CLI 部分；被 import 时不做任何 IO */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
const current = compute();

/* ---------------- 比对：上次状态取入库的指针文件 ---------------- */
const previous = existsSync(POINTER_FILE)
  ? JSON.parse(readFileSync(POINTER_FILE, 'utf8'))
  : null;

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
console.log();
if (!previous) {
  console.log('首次计算，无历史可比对 → data.changed=true  site.changed=true');
} else {
  console.log(`数据内容变化：${result.changed.data ? '是' : '否'}（上次 ${previous.dataFingerprint}）`);
  console.log(`站点内容变化：${result.changed.site ? '是' : '否'}（上次 ${previous.siteFingerprint}）`);
}

const gh = [
  `data_fingerprint=${result.dataFingerprint}`,
  `site_fingerprint=${result.siteFingerprint}`,
  `data_changed=${result.changed.data}`,
  `site_changed=${result.changed.site}`,
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
