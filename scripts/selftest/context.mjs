/**
 * selftest 共享上下文：原单文件 selftest.mjs 的全部顶层声明（原样搬运）。
 * 分域文件 import 这里的同名符号；本模块在第一个分域文件执行前整体求值完
 * （含全部顶层 await import —— check() 是同步 try/catch，async 用例会静默假绿，
 * 这条纪律由「声明全部前置」天然保证）。
 */
// 原文件 24-101 行的 import 原样搬入（路径已上移一级）
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// 必须在任何 `await import('../src/lib/*.ts')` 之前装好：search.ts / query.ts
// 内部用 Vite 约定写 `from '../query'`（无扩展名），Node 默认解析不了，靠这个钩子补。
installTsResolver();
import {
  ARCHIVE_TOP_FIELDS,
  ARCHIVE_VOLATILE_FIELDS,
  productFields,
  shapeOfArchive,
} from '../lib/archive-shape.mjs';
import * as DERIVE from '../lib/derive.mjs';
import { assertUnlocked } from '../lib/gates-lock.mjs';
import { applyOverrides, loadOverrides, validateOverrides } from '../lib/overrides.mjs';
import {
  __clearSchemaOverridesForTest,
  __overrideSchemaForTest,
  fieldMap,
  isRegisteredCategory,
  LIFECYCLE_STATUS_VALUES,
  loadCategories,
  loadSchema,
  quantifiableFields,
  validateSchema,
  validateSpecs,
  validateSpecValue,
  groupsOf,
  fieldsByGroup,
  valueStatus,
  validateStatusMap,
} from '../lib/schema.mjs';
import { expandSpecs, flattenSpecs, pick, setSpec, SPEC_GROUPS } from '../lib/specs.mjs';
import { mapAppleSpecs, mapAppleCompare } from '../normalize/brands/apple.mjs';
import {
  mapHuawei,
  mapHuaweiTablet,
  mapHuaweiWearable,
  mapHuaweiMonitor,
  mapHuaweiLaptop,
  mapHuaweiAudio,
  mapHuaweiVision,
  mapHuaweiRouter,
} from '../normalize/brands/huawei.mjs';
import {
  mapXiaomi,
  mapXiaomiTablet,
  mapXiaomiLaptop,
  mapXiaomiVision,
  mapXiaomiWearable,
  mapXiaomiAudio,
  mapXiaomiMonitor,
  mapXiaomiRouter,
  mapXiaomiAppliance,
  mapXiaomiHistory,
} from '../normalize/brands/xiaomi.mjs';
import {
  stripInvisible,
  normalizeKey,
  firstNumber,
  allNumbers,
  parseMm,
  parseG,
  parseInch,
  parsePpi,
  parseWatt,
  parseNits,
  parseHz,
  parseCapacity,
  parseStorageList,
  parseResolution,
  parseRefresh,
  parseWeight,
  parseBrightness,
  sliceByVariants,
  slugify,
} from '../normalize/parse.mjs';
import { parseOis } from '../normalize/shared.mjs';
import * as WQ from '../sync/queue.mjs';
import {
  validate,
  LIMITS,
  REQUIRED_PATHS,
  FIELD_LIMITS,
  SCHEMA_RANGE_PATHS,
} from '../sync/validate.mjs';
import { installTsResolver } from '../ts-resolver.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 嵌套形状的原始模板（phone/fleet 内部共用；对外一律走 phone() 的 v2 形状） */
function phoneRaw(over = {}) {
  return {
    id: 'test-x1',
    brand: 'apple',
    // 闸门 11b 要求 category 必填且已注册（2026-10-13 审计 H1 起，缺失也拒）
    category: 'phone',
    // 闸门 11a 要求生命周期 status 在权威枚举内（2026-10-17 审计 A1 起，缺失也拒）——
    // 夹具必须是「合法产品」的样板，否则每条闸门用例都会先红在这里
    status: 'on-sale',
    name: 'Test X1',
    releaseDate: '2026-01-15',
    provenance: {
      'body.weightG': 'apple',
      'display.sizeIn': 'apple',
      'battery.capacityMah': 'apple',
      releaseDate: 'apple',
      // 对象型字段的 provenance 同时登记父路径与子路径（与 putObject 口径一致）。
      // 闸门第 10b 条查的是子路径 `.w`——这里必须跟着对，否则闸门会对每台机器误报。
      'display.resolutionPx': 'apple',
      'display.resolutionPx.w': 'apple',
      'display.resolutionPx.h': 'apple',
    },
    body: { weightG: 200, thicknessMm: 8 },
    // 这个样本要覆盖 REQUIRED_PATHS 的每一条，否则闸门会因「必填缺失」
    // 报出噪声，让真正想测的那条闸门被淹没（实测踩过：漏 resolutionPx 时，
    // 失败原因永远是必填缺失，别的闸门根本测不到）。
    // 2026-10-21 消除 v1 双真源时暴露的实证：v1 夹具没有 specs 容器，
    // schema 类型校验整段被跳过（validate 的 if (p.specs)），字符串版
    // resolutionPx 一直是非法数据却零报错。v2 化后必须给真实形状（{w,h} 对象）。
    display: { sizeIn: 6.1, resolutionPx: { w: 2622, h: 1206 }, ppi: 460, refreshHz: '120' },
    battery: { capacityMah: 4000, capacityCaliber: 'typical' },
    memory: { storageGb: [128, 256, 512] },
    skus: [{ priceCny: 5999 }],
    scores: [],
    ...over,
  };
}

/** v2 化：嵌套段拍平进 specs、删嵌套组（与 sync 层对盘上数据做的事完全一致） */
function v2ify(p) {
  const specs = flattenSpecs(p);
  for (const g of SPEC_GROUPS) delete p[g];
  return { ...p, specs };
}

/** 造一台最小可用机型，供闸门测试复用（v2 形状：参数在扁平 specs 容器里） */
function phone(over = {}) {
  return v2ify(phoneRaw(over));
}

/**
 * 造一整机群。闸门第 1 条要求机型数 ≥ LIMITS.minProducts（20），
 * 所以「只测某一条闸门」的用例也得先凑够台数——否则失败原因永远是「低于下限」，
 * 测不到真正想测的那条。
 *
 * over 对`display` / `body` / `battery` / `memory` / `provenance` 做段内合并，
 * 其余整体覆盖。理由：传 `{display: {ppi: 2622}}` 不该顺手把 resolutionPx、
 * refreshHz 抹掉——必填缺失的噪声会盖住真正想测的那条闸门（实测踩过）。
 */
function fleet(over = {}) {
  const MERGE_INTO = new Set(['display', 'body', 'battery', 'memory', 'provenance']);
  // 显式标记为空的段走整段替换：测「有值但缺口径」「有值但缺 provenance」这类
  // 闸门，必须能把整段清空，深合并会护住本该缺的字段，闸门就测不到了。
  const REPLACE = new Set(over.__replace ?? []);
  // base 用**嵌套模板**：__replace 替换的是嵌套段；若拿已 v2 化的 phone() 当 base，
  // specs 里残留的旧段键（如 capacityCaliber）会混进 flatten 起点，注入就失效了。
  const base = phoneRaw();
  const apply = (target) => {
    const out = { ...target };
    for (const [k, v] of Object.entries(over)) {
      if (k === '__replace') continue;
      out[k] =
        !REPLACE.has(k) && MERGE_INTO.has(k) && v && typeof v === 'object' && !Array.isArray(v)
          ? { ...(target[k] || {}), ...v }
          : v;
    }
    return out;
  };
  // id 必须放在 apply 之后覆盖：apply(base) 返回的 base 自带 id='test-x1'，
  // 若排在前面会把每台机器的唯一 id 盖回同一个值，闸门第 2 条会报 24 条「id 重复」
  // （实测踩过：失败原因完全指不到真正想测的地方）。
  // 若调用方显式传了 id，则以调用方为准。
  // 合并完（嵌套段语义生效）才 v2 化——顺序不能反。
  return {
    products: Array.from({ length: 25 }, (_, i) =>
      v2ify({ ...apply(base), id: over.id ?? `x${i}` }),
    ),
  };
}

const { refreshHzNumber } = await import('../../src/lib/fields.ts');

// v2 结构的最小机型（flat specs 容器 + line），供新闸门测试复用。
// fleet() 夹具是 v1 嵌套结构且不带 line——25 台全同规格正是「健康」前提，
// 新闸门按同 line 唯一性判，v1 夹具天然不触发（specs 为空），不用改旧夹具。
function v2(over = {}) {
  const { specs, ...rest } = over;
  return phone({
    category: 'phone',
    line: 'iPhone',
    ...rest,
    specs: {
      'device.identifier': 'iPhone17,3',
      'device.modelCodes': ['A3288'],
      ...specs,
    },
  });
}
function v2Fleet(make) {
  return { products: Array.from({ length: 25 }, (_, i) => make(i)) };
}

const BRAND_FIXTURE_DIR = join(ROOT, 'scripts/normalize/brands/__fixtures__');
function assertGolden(mapper, fixtureName, label) {
  const fp = join(BRAND_FIXTURE_DIR, fixtureName);
  const gp = join(BRAND_FIXTURE_DIR, fixtureName.replace(/\.json$/, '.golden.json'));
  assert.ok(existsSync(fp), `${label}: 缺少 fixture ${fp}`);
  assert.ok(existsSync(gp), `${label}: 缺少 golden ${gp}`);
  const got = mapper(JSON.parse(readFileSync(fp, 'utf8')));
  const golden = JSON.parse(readFileSync(gp, 'utf8'));
  assert.deepEqual(got, golden, `${label}: 映射产物与 golden 不一致（上游改版或映射逻辑变动？）`);
}

const P2025 = (id, extra = {}) => ({ id, brand: 'apple', releaseDate: '2025-03-01', ...extra });

const FP = await import('../publish/fingerprint.mjs');

const S = await import('../../src/lib/search.ts');
const Q = await import('../../src/lib/query.ts');

/** 造一台最小机型，只带搜索用得到的字段 */
function sdoc(over = {}) {
  return {
    id: over.id ?? 'x1',
    name: 'X1',
    nameZh: null,
    line: '',
    brand: 'x',
    provenance: {},
    ...over,
  };
}

/** 三台真实形态的机型：官方写法带空格，中文名同款 */
const DOCS = S.buildDocs(
  [
    sdoc({ id: 'a', name: 'HUAWEI nova 14 Ultra', nameZh: 'HUAWEI nova 14 Ultra', line: 'nova' }),
    sdoc({ id: 'b', name: 'iPhone 16 Pro Max', nameZh: null, line: 'iPhone' }),
    // 芯片名**故意不带空格**：真实数据里两种写法并存（麒麟 9020 / 麒麟9020）
    sdoc({ id: 'c', name: 'Test C', chipset: { name: '麒麟9020' } }),
    // 缺失芯片名：官网未公布。绝不能因此被任何查询命中
    sdoc({ id: 'd', name: 'Test D', chipset: null }),
  ],
  new Map([['x', { id: 'x', name: 'XBrand', nameZh: '测试牌', accentColor: '#fff' }]]),
);

const names = (q) => S.search(DOCS, q).map((d) => d.product.id);

/** 中文与西文连写的机型集合：中式叫法 + 苹果那一批（中文只在厂商名里） */
const CJK_DOCS = S.buildDocs(
  [
    sdoc({ id: 'ip16', name: 'iPhone 16', line: 'iPhone', brand: 'apple' }),
    sdoc({ id: 'ip16p', name: 'iPhone 16 Pro', line: 'iPhone', brand: 'apple' }),
    sdoc({ id: 'ip16pm', name: 'iPhone 16 Pro Max', line: 'iPhone', brand: 'apple' }),
    sdoc({ id: 'ip17', name: 'iPhone 17', line: 'iPhone', brand: 'apple' }),
    sdoc({ id: 'nv14', name: 'HUAWEI nova 14', line: 'nova', brand: 'huawei' }),
    sdoc({ id: 'nv14u', name: 'HUAWEI nova 14 Ultra', line: 'nova', brand: 'huawei' }),
    // 品牌词本身含「Pro」，用来验证「型号」与「修饰词」都在同一条链路上
    sdoc({ id: 'ipair', name: 'iPhone Air', line: 'iPhone', brand: 'apple' }),
  ],
  new Map([
    ['apple', { id: 'apple', name: 'Apple', nameZh: '苹果', accentColor: '#fff' }],
    ['huawei', { id: 'huawei', name: 'HUAWEI', nameZh: '华为', accentColor: '#fff' }],
  ]),
);
const cjkIds = (q) =>
  S.search(CJK_DOCS, q)
    .map((d) => d.product.id)
    .sort();

const C = await import('../../src/lib/catalog.ts');
const F = await import('../../src/lib/facets.ts');

const REAL = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
// v2 适配：REAL_P 与前端加载同路——data.ts 的 loadDataset 会过 toPhoneViews
// （specs 容器 → 嵌套视图），这里同步过一遍，保证自测断言的就是前端真实形状，
// 而不是管线内部形状。不过这层的话 facets/catalog 的嵌套读取会全数 undefined。
const ADAPT = await import('../../src/lib/adapt.ts');
const REAL_P = ADAPT.toPhoneViews(REAL.products);
const REAL_LABELS = new Map(REAL.vendors.map((v) => [v.id, v.nameZh]));
const DIMS = [...F.DIMENSION_KEYS];

/** 造一台最小机型，只带品类/系列/变体/价格判定用得到的字段 */
function pdoc(over = {}) {
  return {
    id: 'x',
    brand: 'apple',
    line: 'iPhone',
    name: 'iPhone X',
    releaseDate: '2024-01-01',
    skus: [],
    memory: { ramGb: [], storageGb: [] },
    rawOfficial: {},
    ...over,
  };
}

// ── 设备视觉区几何（2026-10-16 二轮优化：品牌色块 + 屏幕比例矩形）──
// 组件不各自算比例/取色，全站卡片共用这一份派生事实；改一档就是改全部卡。
// ⚠️ import 必须在模块顶层：check() 是同步 try/catch，回调里 await 会让
// 断言失败变成未捕获 rejection、用例永远绿（本项目踩过的坑）。
const DV = await import('../../src/lib/deviceVisual.ts');
const SUMMARY = await import('../../src/lib/summary.ts');

const RAW_ARCHIVE_DIR = join(ROOT, 'data/raw');

const SRC_DIR = join(ROOT, 'src');
function allVueSource(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(allVueSource(p));
    else if (name.endsWith('.vue')) out.push(readFileSync(p, 'utf8'));
  }
  return out.join('\n');
}

/* 前端目录模块：对账断言用。必须在 check() 之前加载完——
 * check 的 runner 是同步 try/catch，async 用例的断言失败会变成未捕获 rejection，
 * 用例永远显示通过（比没写测试更糟）。所以这里顶层 await import，check 里只放同步回调。 */
const CAT = await import('../../src/lib/catalog.ts');
const FIELDS_LIB = await import('../../src/lib/fields.ts');
const SPECS_LIB = await import('../../src/lib/specs.ts');
const FACETS_LIB = await import('../../src/lib/facets.ts');
const CMP = await import('../../src/lib/compare.ts');

/** 构造一台最小合法产品（v2 形状），供 override 测试复用 */
function makeProduct(id, over = {}) {
  return {
    id,
    slug: id,
    brand: 'apple',
    category: 'phone',
    name: id,
    releaseDate: '2026-09-01',
    specs: { 'display.sizeIn': 6.1, 'body.weightG': 170 },
    provenance: { 'display.sizeIn': 'apple-official', 'body.weightG': 'apple-official' },
    ...over,
  };
}

export {
  assert, createHash, existsSync, readFileSync, readdirSync, statSync, writeFileSync,
  mkdirSync, rmSync, tmpdir, join, resolve, dirname, fileURLToPath,
  DERIVE, WQ, FP, S, Q, C, F, ADAPT, DV, SUMMARY, CAT, FIELDS_LIB, SPECS_LIB,
  FACETS_LIB, CMP,
  ARCHIVE_TOP_FIELDS, ARCHIVE_VOLATILE_FIELDS, productFields, shapeOfArchive,
  assertUnlocked, applyOverrides, loadOverrides, validateOverrides,
  __clearSchemaOverridesForTest, __overrideSchemaForTest, fieldMap, isRegisteredCategory,
  LIFECYCLE_STATUS_VALUES, loadCategories, loadSchema, quantifiableFields, validateSchema,
  validateSpecs, validateSpecValue, groupsOf, fieldsByGroup, valueStatus, validateStatusMap,
  expandSpecs, flattenSpecs, pick, setSpec, SPEC_GROUPS, mapAppleSpecs, mapAppleCompare, mapHuawei, mapHuaweiTablet, mapHuaweiWearable, mapHuaweiMonitor, mapHuaweiLaptop, mapHuaweiAudio, mapHuaweiVision, mapHuaweiRouter, mapXiaomi, mapXiaomiTablet, mapXiaomiLaptop, mapXiaomiVision, mapXiaomiWearable, mapXiaomiAudio, mapXiaomiMonitor, mapXiaomiRouter, mapXiaomiAppliance, mapXiaomiHistory,
  stripInvisible, normalizeKey, firstNumber, allNumbers, parseMm, parseG, parseInch,
  parsePpi, parseWatt, parseNits, parseHz, parseCapacity, parseStorageList, parseResolution,
  parseRefresh, parseWeight, parseBrightness, sliceByVariants, slugify, parseOis,
  validate, LIMITS, REQUIRED_PATHS, FIELD_LIMITS, SCHEMA_RANGE_PATHS, installTsResolver,
  ROOT, phone, fleet, refreshHzNumber, v2, v2Fleet, BRAND_FIXTURE_DIR, assertGolden,
  P2025, sdoc, DOCS, names, CJK_DOCS, cjkIds, REAL, REAL_P, REAL_LABELS, DIMS, pdoc,
  RAW_ARCHIVE_DIR, SRC_DIR, allVueSource, makeProduct,
};
