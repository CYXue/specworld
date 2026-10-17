#!/usr/bin/env node
/**
 * 管线自测：不联网，只测那些「错了也不会报错、只会静默产出脏数据」的纯函数。
 *
 *   node scripts/selftest.mjs            # 跑全部
 *   node scripts/selftest.mjs --verbose  # 逐项打印
 *
 * 为什么必须有这层
 * --------------
 * 校验闸门（sync/validate.mjs）是「拒绝写盘」的唯一防线，但它只能拦住**数值越界**。
 * 解析器犯的错往往在合理区间内——1440 Hz 的 PWM 调光频率当刷新率是荒谬的，
 * 但它是个「看起来很像Hz 的数」，只能靠解析器自己不走错那条路。
 *
 * 历史事故全部来自这里：
 *   - 旧parseRefresh 取「整段文本里第一个 Hz 之前的全部数字的最大值」，
 *     于是 iPhone 17 的 `2622 x 1206 像素分辨率` 被当成刷新率 2622。
 *   - Mate 70 Air 的 `2160 Hz 高频 PWM 调光` 被当成刷新率 2160。
 * 两次都是靠肉眼发现、再补一条闸门 `refreshHz: [48, 240]` 兜住的——
 * 闸门按住了症状，根因在解析器。没有自测的话，下一个同类改写还会再犯。
 *
 * 纪律：每一条断言都必须能说出「它防的是哪种真实故障」，答不上来就不要加。
 */

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
// 内部用 Vite 约定写 `from './query'`（无扩展名），Node 默认解析不了，靠这个钩子补。
installTsResolver();
import {
  ARCHIVE_TOP_FIELDS,
  ARCHIVE_VOLATILE_FIELDS,
  productFields,
  shapeOfArchive,
} from './lib/archive-shape.mjs';
import * as DERIVE from './lib/derive.mjs';
import { assertUnlocked } from './lib/gates-lock.mjs';
import * as I18N from './lib/i18n-keys.mjs';
import { applyOverrides, loadOverrides, validateOverrides } from './lib/overrides.mjs';
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
} from './lib/schema.mjs';
import { expandSpecs, flattenSpecs, pick, setSpec } from './lib/specs.mjs';
import { mapAppleSpecs, mapAppleCompare } from './normalize/brands/apple.mjs';
import { mapHuawei } from './normalize/brands/huawei.mjs';
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
} from './normalize/parse.mjs';
import { parseOis } from './normalize/shared.mjs';
import * as WQ from './sync/queue.mjs';
import {
  validate,
  LIMITS,
  REQUIRED_PATHS,
  FIELD_LIMITS,
  SCHEMA_RANGE_PATHS,
} from './sync/validate.mjs';
import { installTsResolver } from './ts-resolver.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VERBOSE = process.argv.includes('--verbose');

let passed = 0;
const failures = [];
let group = '';

function section(name) {
  group = name;
  if (VERBOSE) console.log(`\n── ${name}`);
}

function check(name, fn) {
  try {
    fn();
    passed += 1;
    if (VERBOSE) console.log(`  ✅ ${name}`);
  } catch (e) {
    failures.push({ group, name, message: e.message });
    if (VERBOSE) console.log(`  ❌ ${name}\n     ${e.message.split('\n')[0]}`);
  }
}

/** 造一台最小可用机型，供闸门测试复用 */
function phone(over = {}) {
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
    display: { sizeIn: 6.1, resolutionPx: '2622 x 1206', ppi: 460, refreshHz: '120' },
    battery: { capacityMah: 4000, capacityCaliber: 'typical' },
    memory: { storageGb: [128, 256, 512] },
    skus: [{ priceCny: 5999 }],
    scores: [],
    ...over,
  };
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
  const base = phone();
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
  return {
    products: Array.from({ length: 25 }, (_, i) =>
      phone({ ...apply(base), id: over.id ?? `x${i}` }),
    ),
  };
}

/* ================================================================ *
 * 1. 零宽字符 —— 华为机型名污染的根源
 * ================================================================ */
section('零宽与不可见字符');

check('U+2008 夹在中文里被清掉', () => {
  // 防的是：华为页面把「非凡大师」写成「非<U+2008>凡<U+2008>大<U+2008>师」，
  // 不清掉就没法和别处的机型名对齐，id 对不上 → 整机数据挂到错误的 key 上
  assert.equal(stripInvisible('Mate 90 非\u2008凡\u2008大\u2008师'), 'Mate 90 非凡大师');
});

check('HTML 实体零宽字符被清掉', () => {
  // 防的是：&#8203; (ZWSP) 以实体形式出现，stripInvisible 的 Unicode 区间覆盖不到它
  assert.equal(stripInvisible('iPhone&#8203; 17 Pro'), 'iPhone 17 Pro');
  assert.equal(stripInvisible('a&nbsp;b'), 'ab');
});

check('非常规空格 U+2000-U+200A 被清掉但普通空格保留', () => {
  assert.equal(stripInvisible('a\u2005b'), 'ab');
  assert.equal(stripInvisible('a b'), 'a b');
});

check('null / undefined 不炸', () => {
  assert.equal(stripInvisible(null), '');
  assert.equal(stripInvisible(undefined), '');
  assert.equal(stripInvisible(123), '123');
});

/* ================================================================ *
 * 2. 键名归一化 —— 别名匹配的底座
 * ================================================================ */
section('键名归一化');

check('全角括号与半角括号归一到同一个键', () => {
  // 防的是：「运行内存（RAM）」与「运行内存(RAM)」是两个 key，
  // 同一个字段被当成两个字段，一个有值一个没值，闸门报覆盖率不足。
  // 注意口径：这里只归一括号本身，括号内的内容保留——
  // `运行内存（RAM）` 与 `运行内存` 语义确实不同（前者注明了内存类型），
  // 所以它们的归一结果本来就该不同，那是正确的。
  assert.equal(normalizeKey('运行内存（RAM）'), normalizeKey('运行内存(RAM)'));
  assert.notEqual(normalizeKey('运行内存（RAM）'), normalizeKey('运行内存'));
});

check('英文键大小写归一', () => {
  assert.equal(normalizeKey('Display Size'), normalizeKey('display size'));
});

check('分隔符归一：·.。:：/\\|', () => {
  const a = normalizeKey('屏幕·尺寸');
  assert.equal(a, normalizeKey('屏幕.尺寸'));
  assert.equal(a, normalizeKey('屏幕:尺寸'));
  assert.equal(a, normalizeKey('屏幕/尺寸'));
});

/* ================================================================ *
 * 3. 单位解析 —— 「解析不出来就null，绝不猜」
 * ================================================================ */
section('单位解析');

check('毫米与英寸不串', () => {
  // 防的是：原文「150.0 毫米 (5.91 英寸)」，取错单位会让厚度变成 5.91
  assert.equal(parseMm('150.0 毫米 (5.91 英寸)'), 150);
  assert.equal(parseInch('150.0 毫米 (5.91 英寸)'), 5.91);
});

check('克：\\b 对非 ASCII 无效，中文单位必须单独一支', () => {
  // 这是 parse.mjs 里明确注释过的坑：`克\b` 永远匹配不上（克不是 \w）
  assert.equal(parseG('211 克'), 211);
  assert.equal(parseG('211g'), 211);
  assert.equal(parseG('211 grams'), 211);
});

check('重量不吃盎司', () => {
  assert.equal(parseG('211 克 (7.44 盎司)'), 211);
});

check('千位分隔符被清掉', () => {
  assert.equal(parseNits('峰值亮度 2,000 尼特'), 2000);
  assert.equal(parseWatt('100 W'), 100);
  assert.equal(firstNumber('1,024'), 1024);
});

check('PPI 只认 ppi 后缀，不被裸数字骗', () => {
  assert.equal(parsePpi('460 ppi'), 460);
  assert.equal(parsePpi('分辨率 2622 x 1206'), null);
});

check('W 不吞掉 w 之外的单位（瓦）', () => {
  assert.equal(parseWatt('80 瓦'), 80);
});

check('解析失败一律 null，绝不返回 0', () => {
  // 这是全项目最重要的一条纪律：0 会在界面上冒充「真实测得 0」
  for (const f of [parseMm, parseG, parseInch, parsePpi, parseWatt, parseNits, parseHz]) {
    assert.equal(f('没有任何数字'), null, `${f.name} 应返回 null`);
    assert.equal(f(''), null, `${f.name} 空串应返回 null`);
  }
  assert.equal(firstNumber('无'), null);
  assert.deepEqual(allNumbers('无'), []);
});

check('负号被正确识别（不该被吞成正数）', () => {
  // 防的是：firstNumber 的正则写成 \d+ 会让 -5 变成 5
  assert.equal(firstNumber('约 -5 mm'), -5);
});

/* ================================================================ *
 * 4. 电池容量 —— 口径必须一起出来
 * ================================================================ */
section('电池容量与口径');

check('典型值口径', () => {
  assert.deepEqual(parseCapacity('6800 mAh（典型值）'), { value: 6800, caliber: 'typical' });
});

check('额定值口径', () => {
  assert.deepEqual(parseCapacity('5000 mAh（额定值）'), { value: 5000, caliber: 'rated' });
});

check('毫安时中文单位', () => {
  assert.equal(parseCapacity('6800 毫安时').value, 6800);
});

check('没有口径标注时 caliber 为 null（交给闸门拦）', () => {
  // 防的是：悄悄塞一个默认口径，把「典型 6800」和「额定 5000」混成一列
  const r = parseCapacity('6800 mAh');
  assert.equal(r.value, 6800);
  assert.equal(r.caliber, null);
});

/* ================================================================ *
 * 5. 存储档位
 * ================================================================ */
section('存储档位');

check('TB 折 GB 并去重升序', () => {
  assert.deepEqual(parseStorageList('256 GB / 512 GB / 1 TB'), [256, 512, 1024]);
});

check('顺序打乱也归一（确定性）', () => {
  assert.deepEqual(parseStorageList('1TB / 256GB / 512GB'), [256, 512, 1024]);
});

check('重复档位去重', () => {
  assert.deepEqual(parseStorageList('256GB / 256GB'), [256]);
});

check('非GB/TB 数字不当成存储（如 12 GB RAM 混在 ROM 字段）', () => {
  // 0.5 TB = 512；小数不应被 round 成 1
  assert.deepEqual(parseStorageList('0.5 TB'), [512]);
});

/* ================================================================ *
 * 6. 分辨率
 * ================================================================ */
section('分辨率');

check('x / × / * 三种分隔符', () => {
  assert.deepEqual(parseResolution('2622 x 1206 像素'), { w: 2622, h: 1206 });
  assert.deepEqual(parseResolution('2868×1320'), { w: 2868, h: 1320 });
  assert.deepEqual(parseResolution('1206*2622'), { w: 1206, h: 2622 });
});

check('没有分辨率返回 null', () => {
  assert.equal(parseResolution('全面屏'), null);
});

check('竖屏写法不会把宽高搞反（按原文顺序）', () => {
  // 契约里 w/h 是数学意义上的宽高还是字面顺序必须一致；
  // 这里锁住「字面顺序」这一现行口径，改动会让全部已入库数据错位
  assert.deepEqual(parseResolution('1206 x 2622'), { w: 1206, h: 2622 });
});

/* ================================================================ *
 * 7. 刷新率 —— 两起真实事故的现场，必须逐条锁死
 * ================================================================ */
section('刷新率（历史事故高发区）');

check('事故一：分辨率数字不得被当成刷新率', () => {
  // iPhone 17 官网原文。旧解析器误得 2622（甚至 6.3-2622）
  const t =
    '6.3 英寸全面屏，2622 x 1206 像素分辨率，460 ppi，ProMotion 自适应刷新率技术，最高可达 120Hz';
  const r = parseRefresh(t);
  assert.equal(r.maxHz, 120, `应得 120，实得 ${r?.maxHz}`);
  assert.ok(!String(r.text).includes('2622'), '结果里绝不能出现分辨率数字');
});

check('事故二：PWM 调光频率不得被当成刷新率', () => {
  // Mate 70 Air / Mate XTS 官网原文。旧解析器误得 2160 / 1440
  assert.equal(parseRefresh('2160 Hz 高频 PWM 调光'), null);
  assert.equal(parseRefresh('1440 Hz 高频 PWM 调光'), null);
});

check('触控采样率与闪烁频率同样排除', () => {
  assert.equal(parseRefresh('240 Hz 触控采样率'), null);
  assert.equal(parseRefresh('1920 Hz 闪烁调光'), null);
});

check('PWM 与真实刷新率同段落时，只取真实那个', () => {
  const r = parseRefresh('LTPO 1-120Hz 自适应刷新率，2160 Hz PWM 调光');
  assert.equal(r.maxHz, 120);
  assert.equal(r.text, '1-120', 'LTPO 区间必须保留，不能压成 120');
});

check('LTPO 区间保留下限（1Hz 有信息量）', () => {
  const r = parseRefresh('1-120Hz 自适应刷新率');
  assert.equal(r.maxHz, 120);
  assert.equal(r.minHz, 1);
  assert.equal(r.text, '1-120');
});

check('离散档位并列显示，不谎称中间值也支持', () => {
  // 60/90 合成「60-90」等于谎称 75Hz 也支持。
  // 这两串都是真实官网原文（huawei.raw.json 里的 changxiang-80 就是 LCD，支持 60 Hz / 90 Hz 刷新率）
  for (const t of ['LCD，支持 60 Hz / 90 Hz 刷新率', '60 Hz / 90 Hz', '60 Hz、90 Hz']) {
    const r = parseRefresh(t);
    assert.equal(r.text, '60/90', `「${t}」应得 60/90，实得 ${r?.text}`);
    assert.equal(r.discrete, true, `「${t}」应标记为离散档位`);
    assert.equal(r.maxHz, 90, `「${t}」上限应为 90`);
  }
});

check('裸 Hz 写法后带中文尾巴时不被丢弃（回归）', () => {
  // 事故（2026-10-03 自测抓到）：`^…Hz$` 严格锚定让 `60 Hz / 90 Hz 屏幕`
  // 里的 90Hz 整段被丢掉，上限从 90 掉到 60。
  // 危险在于 60 落在闸门区间 48–240 内 → 闸门不拦 → 脏数据静默发布。
  const r = parseRefresh('60 Hz / 90 Hz 屏幕');
  assert.equal(r.maxHz, 90, `上限不应掉到 ${r?.maxHz}`);
  assert.equal(r.text, '60/90');
});

check('带尾巴的写法仍不误收PWM / 采样率', () => {
  // 放开尾巴的代价必须被守住：这几种危险写法仍然要判null
  assert.equal(parseRefresh('2160 Hz 高频 PWM 调光'), null);
  assert.equal(parseRefresh('300 Hz 触控采样率屏幕'), null);
  assert.equal(parseRefresh('1440 Hz 屏幕调光'), null);
});

check('单值写法', () => {
  const r = parseRefresh('最高可达 120Hz');
  assert.equal(r.maxHz, 120);
  assert.equal(r.text, '120');
});

check('修饰词被容忍（最高可达 / 高达 / 支持）', () => {
  assert.equal(parseRefresh('最高可达 144Hz').maxHz, 144);
  assert.equal(parseRefresh('高达 165Hz').maxHz, 165);
  assert.equal(parseRefresh('支持 90Hz').maxHz, 90);
});

check('完全没提刷新率返回 null（官网没写就是没写）', () => {
  assert.equal(parseRefresh('6.7 英寸 OLED 显示屏'), null);
  assert.equal(parseRefresh(''), null);
  assert.equal(parseRefresh(null), null);
});

check('结果始终是合法区间（供闸门二次确认）', () => {
  // 自检用：不变量检查。任何输出都必须落在闸门区间内，
  // 否则闸门会以「疑似把 PWM 当刷新率」拦下，等于数据白跑一趟
  const samples = [
    'ProMotion 自适应刷新率技术，最高可达 120Hz',
    '1-120Hz 自适应刷新率',
    '60 Hz / 90 Hz 屏幕',
    '2160 Hz 高频 PWM 调光',
    '2622 x 1206 像素分辨率，460 ppi，最高可达 120Hz',
  ];
  for (const s of samples) {
    const r = parseRefresh(s);
    if (!r) continue;
    const top = Math.max(
      ...String(r.text)
        .split(/[-–~/]/)
        .map(Number)
        .filter(Number.isFinite),
    );
    assert.ok(
      top >= LIMITS.refreshHz[0] && top <= LIMITS.refreshHz[1],
      `「${s}」产出 ${r.text}（上界 ${top}）落在闸门区间 ${LIMITS.refreshHz.join('–')} 之外`,
    );
  }
});

/* ================================================================ *
 * 8. 重量与亮度
 * ================================================================ */
section('重量与亮度');

check('并列重量取第一个，不取平均', () => {
  // 防的是：平均 234.5 是编造出来的数字，官网从来没这么说过
  const r = parseWeight('标准版 234g / 典藏版 235g');
  assert.equal(r.value, 234);
  assert.ok(r.note, '并列时必须留 note 要求人工确认');
});

check('单一重量无 note', () => {
  const r = parseWeight('211 克 (7.44 盎司)');
  assert.equal(r.value, 211);
  assert.equal(r.note, null);
});

check('重量不吃盎司单位', () => {
  assert.equal(parseWeight('7.44 盎司').value, null);
});

check('峰值亮度与典型亮度分开', () => {
  const r = parseBrightness('峰值亮度 2000 尼特');
  assert.equal(r.peak, 2000);
  assert.equal(r.typical, null);
});

check('典型亮度不会被误标成峰值', () => {
  const r = parseBrightness('典型亮度 1000 尼特');
  assert.equal(r.typical, 1000);
  assert.equal(r.peak, null);
});

check('峰值不得小于典型（闸门第7 条依赖这个语义）', () => {
  // 这里锁住 parseBrightness 的口径语义，闸门那条「峰值 < 典型」才有效
  const r = parseBrightness('峰值亮度 2000 尼特，典型亮度 1000 尼特');
  assert.ok(r.peak >= r.typical, '峰值应 >= 典型');
});

check('亮度千位分隔', () => {
  assert.equal(parseBrightness('峰值 2,500 尼特').peak, 2500);
});

/* ================================================================ *
 * 9. 多机型切片与slug
 * ================================================================ */
section('切片与 slug');

check('按机型名切片', () => {
  const r = sliceByVariants('[iPhone 18 Pro] 71.9 毫米 [iPhone 18 Pro Max] 78.0 毫米', [
    'iPhone 18 Pro',
    'iPhone 18 Pro Max',
  ]);
  assert.ok(r['iPhone 18 Pro'].startsWith('71.9'));
  assert.ok(r['iPhone 18 Pro Max'].startsWith('78.0'));
});

check('只命中一个机型名时返回 null，不瞎切', () => {
  // 防的是：强行切片会把整页文本塞给某台机器，那台机器的每个字段都变成整页的
  assert.equal(sliceByVariants('[A] 1 [B] 2', ['A']), null);
  assert.equal(sliceByVariants('没有机型名', ['A', 'B']), null);
  assert.equal(sliceByVariants('[A] 1', []), null);
});

check('slug 去掉点号与多余连字符', () => {
  assert.equal(slugify('iPhone 17 Pro Max'), 'iphone-17-pro-max');
  assert.equal(slugify('  iPhone 17  '), 'iphone-17');
  // 参考项目踩过：slug 带点号会让某些静态托管的路径解析出问题
  assert.ok(!slugify('iPhone 17 Pro Max').includes('.'));
  assert.ok(!slugify('Mate 90 RS 非凡大师').startsWith('-'));
  assert.ok(!slugify('---').includes('-'), '全符号输入不应产生前导连字符');
});

/* ================================================================ *
 * 10. 闸门自身 —— 防线自己也要被测
 * ================================================================ */
section('校验闸门（防线自己也要被测）');

check('健康数据通过', () => {
  assert.deepEqual(validate(fleet(), null), []);
});

// A4 收口（2026-10-13 审计 H1）：categoryOf() 对缺失品类静默回落 'phone'，
// 上游闸门原先只拦「未注册值」不拦「缺失值」。真实数据 62 台全部带 category
// （data/products.json 实测），管线必写、用户层 add-product 也已校验
// （scripts/lib/overrides.mjs）——缺失只可能是解析器/合并层写漏，
// 那正是必须显性失败、不许静默回落默认品类的形态。
check('category 缺失被拦（缺失与未注册同样拒绝）', () => {
  const f = validate(fleet({ category: undefined }), null);
  assert.ok(
    f.some((x) => x.includes('品类')),
    'category 缺失必须报错，不许静默回落默认品类',
  );
});

check('category 未注册被拦（原有闸门，防回归）', () => {
  const f = validate(fleet({ category: 'watch' }), null);
  assert.ok(
    f.some((x) => x.includes('品类')),
    '未注册品类必须报错',
  );
});

// 2026-10-14 审计 P1-4：品类注册了但 schema 文件缺失（tablet/laptop/audio 的现状）
// 曾让字段校验/status 映射/孤儿键检测**全部空转且静默**——数据脏着写盘，
// 每次同步却都是绿的。现在显性失败；这两条锁住「空转不许回来」。
// 2026-10-15：六品类 schema 全部落盘后，原注入（category:'tablet'）已失效——
// tablet 真的有 schema 了。改用 schema.mjs 的测试注入缝造「注册表有、磁盘缺」
// 场景，分支覆盖不能因为合规态演进而丢失。
check('品类注册但无 schema 被拦（空转回归防护）', () => {
  __overrideSchemaForTest('phone', null); // 「注册表里有、磁盘上没有」的模拟态
  try {
    const f = validate(fleet({ specs: { 'display.sizeIn': 6.9 } }), null);
    assert.ok(
      f.some((x) => x.includes('没有 schema')),
      `无 schema 品类必须显性失败，实际：${f.join('|')}`,
    );
  } finally {
    __clearSchemaOverridesForTest();
  }
});

check('合规态对账：categories.json 注册的每个品类磁盘上都有 schema', () => {
  // 正向守卫：上面反向测保分支活着，这条保合规态不退化（谁删了 schema 文件当场红）。
  const cats = loadCategories()?.categories ?? [];
  assert.ok(cats.length >= 6, `六品类注册表应有 ≥6 项，实际 ${cats.length}`);
  for (const c of cats) {
    assert.ok(loadSchema(c.id), `品类 ${c.id} 已注册但 data/schemas/${c.schema}.json 缺失`);
  }
});

check('库函数对空 schema 抛错（不装没事）', () => {
  assert.throws(
    () => validateSpecs({ id: 'x', specs: { 'display.sizeIn': 6.9 } }, null),
    /空 schema/,
    'validateSpecs(null) 必须抛错，不许 return []',
  );
  assert.throws(
    () => validateStatusMap({ id: 'x', valueStatus: {} }, null),
    /空 schema/,
    'validateStatusMap(null) 必须抛错，不许 return []',
  );
});

// 2026-10-14 审计 P1-3：上面两条只证明「闸门会拦」，但拦不拦得到还取决于
// **调用顺序**——曾经的 sync/index.mjs 在 validate() 之前就把缺失 category
// 兜底成 'phone'，闸门注释写「缺失也拒绝」而实现永远等不到那一天。
// 这条断言锁住数据侧契约：真源里每条产品都必须**显式**带 category，
// 不靠任何下游兜底。normalize 出口已显式声明（手机通道即 'phone'）。
check('数据契约：products.json 每条产品显式声明 category', () => {
  const list = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
  const products = list.products ?? list;
  const missing = products.filter((p) => !p.category).map((p) => p.id);
  assert.equal(
    missing.length,
    0,
    `这些产品缺 category（数据源漏声明，不许靠同步层兜底）：${missing.slice(0, 10).join(', ')}`,
  );
});

check('机型数低于下限被拦', () => {
  const few = { products: Array.from({ length: 3 }, (_, i) => phone({ id: `x${i}` })) };
  assert.ok(validate(few, null).some((f) => f.includes('低于下限')));
});

check('id 重复被拦', () => {
  assert.ok(
    validate({ products: Array.from({ length: 25 }, () => phone()) }, null).some((f) =>
      f.includes('id 重复'),
    ),
  );
});

check('空数组被拦（上游返回空是最常见的失败形态）', () => {
  assert.ok(validate({ products: [] }, null).length > 0);
});

check('PPI 越界被拦', () => {
  assert.ok(
    validate(fleet({ display: { sizeIn: 6.1, ppi: 2622 } }), null).some((f) =>
      f.includes('display.ppi'),
    ),
  );
});

check('刷新率 2160 被拦（这就是补闸门那次拦住的）', () => {
  const f = validate(fleet({ display: { sizeIn: 6.1, refreshHz: '2160' } }), null);
  assert.ok(
    f.some((x) => x.includes('refreshHz') && x.includes('PWM')),
    '应给出「疑似把 PWM 调光频率当成刷新率」的提示',
  );
});

check('刷新率区间上界合法则放过', () => {
  assert.ok(
    !validate(fleet({ display: { sizeIn: 6.1, refreshHz: '1-120' } }), null).some((x) =>
      x.includes('refreshHz'),
    ),
  );
});

// 刷新率归一函数的契约测试。
// 注意：check() 是**同步**的（try/catch 抓不到 Promise rejection），所以这里用顶层
// await 预加载模块、再传同步回调。写成 `async () => {}` 会让断言失败变成未捕获的
// rejection → 用例永远显示通过（比没写测试更糟）。这正是「静默失效」类缺陷。
const { refreshHzNumber } = await import('../src/lib/fields.ts');

check('refreshHzNumber：区间/多档取上界，纯数字直取', () => {
  assert.strictEqual(refreshHzNumber('1-120'), 120, '可变量程应取上界');
  assert.strictEqual(refreshHzNumber('60/90'), 90, '多档应取最高档');
  assert.strictEqual(refreshHzNumber('120'), 120);
  assert.strictEqual(refreshHzNumber(120), 120, '已是 number 应原样返回');
  assert.strictEqual(refreshHzNumber(2160), 2160, 'number 不做区间过滤，只做归一');
});

check('refreshHzNumber：无法解析返回 null 而非 0（0 与「未公布」语义不同）', () => {
  assert.strictEqual(refreshHzNumber(null), null);
  assert.strictEqual(refreshHzNumber(undefined), null);
  assert.strictEqual(refreshHzNumber('abc'), null, '无数字应返回 null');
  assert.strictEqual(refreshHzNumber(''), null);
  assert.notStrictEqual(refreshHzNumber('abc'), 0, '绝不能把「解析不出」退化成 0');
});

check('有容量无口径被拦（不可比）', () => {
  // 整段替换掉 battery，才能制造出「有容量、没口径」这个组合
  assert.ok(
    validate(fleet({ battery: { capacityMah: 4000 }, __replace: ['battery'] }), null).some((f) =>
      f.includes('capacityCaliber'),
    ),
  );
});

check('峰值亮度小于典型亮度被拦', () => {
  assert.ok(
    validate(
      fleet({ display: { sizeIn: 6.1, brightnessPeakNits: 800, brightnessTypicalNits: 1000 } }),
      null,
    ).some((f) => f.includes('峰值亮度小于典型亮度')),
  );
});

check('有值但缺 provenance 被拦', () => {
  assert.ok(
    validate(fleet({ provenance: {}, __replace: ['provenance'] }), null).some((f) =>
      f.includes('provenance'),
    ),
  );
});

check('对象型字段的 provenance 查子路径而不是父路径（回归）', () => {
  // 事故（2026-10-03 由 scripts/qa/coverage.mjs 抓到）：
  // display.resolutionPx 是 {w,h} 对象，规范化层登记的是 `display.resolutionPx.w`，
  // 闸门却查父路径 `display.resolutionPx` —— 结果 **60 台全部**报「缺 provenance」，
  // 每台一条假警。规范化层早已特判过子路径，闸门这边漏了。
  //
  // 这条断言的作用是锁住两端口径必须一致：登记侧写子路径，校验侧也得查子路径。
  const noSub = fleet({
    provenance: { 'display.resolutionPx': 'apple' },
    __replace: ['provenance'],
  });
  assert.ok(
    validate(noSub, null).some((f) => f.includes('resolutionPx') && f.includes('.w')),
    '只有父路径、子路径缺失时必须报出来',
  );

  // 反向：只登记父路径、漏了子路径 —— 这才是闸门要拦的那一种
  // （闸门只查子路径 `.w` 是有意的：它守的是「值从哪来」这条信息，
  //   规范侧 putObject 会同时写父路径与子路径，缺子路径说明登记侧漏了）
  const noSubOnly = fleet({ provenance: {}, __replace: ['provenance'] });
  for (const p of noSubOnly.products) p.provenance['display.resolutionPx'] = 'apple';
  assert.ok(
    validate(noSubOnly, null).some((f) => f.includes('resolutionPx')),
    '只有父路径、缺子路径时必须报出来（值有但溯源粒度不够）',
  );
});

check('品牌不在注册表被拦', () => {
  assert.ok(validate(fleet({ brand: 'xiaomi' }), null).some((f) => f.includes('品牌不在注册表')));
});

check('发布日期在未来被拦', () => {
  assert.ok(validate(fleet({ releaseDate: '2099-01-01' }), null).some((f) => f.includes('在未来')));
});

check('发布日期无法解析被拦', () => {
  assert.ok(validate(fleet({ releaseDate: '去年某天' }), null).some((f) => f.includes('无法解析')));
});

check('机型数暴跌被拦（抓取整体失败的信号）', () => {
  const prev = { products: Array.from({ length: 100 }, (_, i) => phone({ id: `old${i}` })) };
  const now = { products: Array.from({ length: 20 }, (_, i) => phone({ id: `x${i}` })) };
  assert.ok(validate(now, prev).some((f) => f.includes('减少')));
});

check('必填覆盖率下跌被拦', () => {
  const prev = { products: Array.from({ length: 30 }, (_, i) => phone({ id: `o${i}` })) };
  // 现在有一半缺 releaseDate
  const now = {
    products: Array.from({ length: 30 }, (_, i) =>
      phone({ id: `x${i}`, ...(i % 2 ? { releaseDate: null } : {}) }),
    ),
  };
  assert.ok(validate(now, prev).some((f) => f.includes('覆盖率')));
});

/* ---- 闸门 14–17：身份串号 / 时间线倒挂 / 假精度 / 相机阵列交叉 ---- */

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

check('闸门14：同 line 内 identifier 串号被拦，跨 line 不拦', () => {
  const bad = v2Fleet((i) =>
    v2({ id: `sx${i}`, specs: { 'device.identifier': 'iMac,1' }, line: 'iMac' }),
  );
  assert.ok(validate(bad, null).some((f) => f.includes('串号')));
  // 反向：不同 line 用同一个标识是合法的（不同产品族各自从 ,1 开始）
  const ok = v2Fleet((i) => v2({ id: `sx${i}`, specs: { 'device.identifier': `X,${i}` } }));
  assert.ok(!validate(ok, null).some((f) => f.includes('device.identifier')));
});

check('闸门14：identifier 畸形值（纯数字 / - / 型号代码误填）被拦', () => {
  for (const junk of ['72', '-', 'M3076']) {
    const bad = v2Fleet((i) => v2({ id: `sx${i}`, specs: { 'device.identifier': junk } }));
    assert.ok(
      validate(bad, null).some((f) => f.includes('device.identifier')),
      `"${junk}" 应被判为畸形标识`,
    );
  }
});

check('闸门14：同 line 内 modelCode 串号被拦；畸形 code 被拦', () => {
  const dup = v2Fleet((i) => v2({ id: `sx${i}`, specs: { 'device.modelCodes': ['M4984'] } }));
  assert.ok(validate(dup, null).some((f) => f.includes('modelCode') && f.includes('串号')));
  const junk = v2Fleet((i) =>
    v2({ id: `sx${i}`, specs: { 'device.modelCodes': ['??'] } }),
  );
  assert.ok(validate(junk, null).some((f) => f.includes('非法值')));
});

check('闸门15：retiredAt 早于 releaseDate 被拦（时间线倒挂）', () => {
  const bad = v2Fleet((i) =>
    v2({ id: `sx${i}`, releaseDate: '2012-06-11', retiredAt: '2008-03' }),
  );
  assert.ok(validate(bad, null).some((f) => f.includes('时间线倒挂')));
  // 反向：正常停售不拦
  const ok = v2Fleet((i) =>
    v2({ id: `sx${i}`, releaseDate: '2008-03-11', retiredAt: '2012-06' }),
  );
  assert.ok(!validate(ok, null).some((f) => f.includes('倒挂')));
});

check('闸门16：天级精度压在 01-01 被拦，year 精度不拦', () => {
  const bad = v2Fleet((i) =>
    v2({ id: `sx${i}`, releaseDate: '1993-01-01', releaseDatePrecision: 'day' }),
  );
  assert.ok(validate(bad, null).some((f) => f.includes('天级精度')));
  // 反向：year 精度 + 形状一致的年日期不拦（注意：'1993-01-01'+year 自 2026-10-17
  // 审计 A3 起是**违规**——那正是闸门18 管的事，这里用形状一致的 '1993'）
  const ok = v2Fleet((i) =>
    v2({ id: `sx${i}`, releaseDate: '1993', releaseDatePrecision: 'year' }),
  );
  assert.ok(!validate(ok, null).some((f) => f.includes('天级精度')));
  const junk = v2Fleet((i) => v2({ id: `sx${i}`, releaseDatePrecision: 'guess' }));
  assert.ok(validate(junk, null).some((f) => f.includes('不在枚举内')));
});

check('闸门17：rawOfficial「N摄」与 camera.rear 数量不符被拦', () => {
  // 双摄却塞了 3 条镜头（iPhone 16 曾平白多出一条 tele）
  const bad = v2Fleet((i) =>
    v2({
      id: `sx${i}`,
      rawOfficial: '4800 万像素融合式双摄系统',
      specs: {
        'camera.rear': [
          { role: 'main', mp: 48 },
          { role: 'ultrawide', mp: 12 },
          { role: 'tele', mp: 12 },
        ],
      },
    }),
  );
  assert.ok(validate(bad, null).some((f) => f.includes('双摄')));
  // 反向：两条正好吻合
  const ok = v2Fleet((i) =>
    v2({
      id: `sx${i}`,
      rawOfficial: '先进的双摄系统',
      specs: {
        'camera.rear': [
          { role: 'main', mp: 48 },
          { role: 'ultrawide', mp: 12 },
        ],
      },
    }),
  );
  assert.ok(!validate(ok, null).some((f) => f.includes('摄」')));
  // 反向：16e 的「二合一摄像头系统」不触发计数（无「N摄」字样）
  const fusion = v2Fleet((i) =>
    v2({
      id: `sx${i}`,
      rawOfficial: '4800 万像素融合式二合一摄像头系统',
      specs: { 'camera.rear': [{ role: 'main', mp: 48 }] },
    }),
  );
  assert.ok(!validate(fusion, null).some((f) => f.includes('摄」')));
});

check('闸门18：日期精度形状不符被拦（year 给 YYYY-MM-DD / day 给 YYYY）', () => {
  // 2026-10-17 审计 A3：65 台「year + 'YYYY-01-01'」曾一路绿灯写盘（data-guards D
  // 只在 selftest 跑，写盘闸门没接）。接入 validate.mjs 后必须双向可判：
  const legacy = v2Fleet((i) =>
    v2({ id: `sx${i}`, releaseDate: '1993-01-01', releaseDatePrecision: 'year' }),
  );
  assert.ok(validate(legacy, null).some((f) => f.includes('形状与 releaseDatePrecision 不符')));
  const junk = v2Fleet((i) => v2({ id: `sx${i}`, releaseDate: '1976', releaseDatePrecision: 'day' }));
  assert.ok(validate(junk, null).some((f) => f.includes('形状与 releaseDatePrecision 不符')));
  // 反向：形状与精度一致不拦（含 01-01 之外的正常日 / 月 / 年）
  const ok = v2Fleet((i) => v2({ id: `sx${i}`, releaseDate: '1993', releaseDatePrecision: 'year' }));
  assert.ok(!validate(ok, null).some((f) => f.includes('形状与')));
});

check('闸门11a：生命周期 status 枚举外取值被拦（已废弃 discontinued / 编造值 / 缺失）', () => {
  // 2026-10-17 审计 A1：'discontinued' 曾带病写盘 812 台（生成脚本硬编码），
  // 而 validate.mjs 没有任何一条顶层 status 枚举校验——「闸门太静」的标准形态。
  // 历史残留值必须拒：
  const legacy = v2Fleet((i) => v2({ id: `sx${i}`, status: 'discontinued' }));
  assert.ok(validate(legacy, null).some((f) => f.includes('status') && f.includes('不在权威枚举')));
  // 随意编造的值同样拒：
  const junk = v2Fleet((i) => v2({ id: `sx${i}`, status: 'halted' }));
  assert.ok(validate(junk, null).some((f) => f.includes('不在权威枚举')));
  // 缺失也拒（顶层身份字段，与 category 缺失同级处理）：
  const missing = v2Fleet((i) => {
    const p = v2({ id: `sx${i}` });
    delete p.status;
    return p;
  });
  assert.ok(validate(missing, null).some((f) => f.includes('不在权威枚举')));
  // 反向：三个合法值全部放行
  for (const s of LIFECYCLE_STATUS_VALUES) {
    const ok = v2Fleet((i) => v2({ id: `sx${i}`, status: s }));
    assert.ok(!validate(ok, null).some((f) => f.includes('status')), `合法值 ${s} 不应被拦`);
  }
});

check('同一赛制两种量纲被拦（跨赛制分数永不混算）', () => {
  assert.ok(
    validate(
      fleet({
        scores: [
          { league: 'A', score: 100, unit: '分' },
          { league: 'A', score: 0.9, unit: 'pass@1' },
        ],
      }),
      null,
    ).some((f) => f.includes('两种量纲')),
  );
});

// 2026-10-14 审计 P2-1：原用例断言输出含「非正数」，但那条消息出自**死闸门**
// （判据与闸门 4 的 schema 区间完全重叠，永不独立触发）。0 值真实的拦截路径
// 是闸门 4 的「超出合理区间」（schema range 下界 > 0）——断言必须指向
// **真正跑的那条路径**，否则删掉死闸门后用例才红，保护的是幻觉。
check('零值不被当作缺数据混过（正数校验）', () => {
  assert.ok(
    validate(fleet({ body: { weightG: 0, thicknessMm: 8 } }), null).some((f) =>
      f.includes('超出合理区间'),
    ),
    'weightG=0 必须被 schema 区间闸门拦（下界 > 0）',
  );
});

// 反向测：删掉 SCHEMA_RANGE_PATHS 里这三条 = 零值/负值彻底没防线，必须红。
check('非正值防线依赖 SCHEMA_RANGE_PATHS 覆盖（死闸门回归防护）', () => {
  for (const path of ['body.weightG', 'body.thicknessMm', 'display.sizeIn']) {
    assert.ok(
      SCHEMA_RANGE_PATHS.includes(path),
      `${path} 不在 SCHEMA_RANGE_PATHS —— 它的非正值/越界就再没有防线了`,
    );
  }
});

check('字段区间闸门接线自洽（FIELD_LIMITS ≡ schema.range，单一真源）', () => {
  // 硬编码审计 A2 治理（2026-10-13）：区间真源已迁到 schema.range，validate 从 schema 派生。
  // 本测试钉死接线：① 每个受控路径的闸门区间恒等于 schema.range；
  // ② LIMITS 键集合钉死——只允许进程阈值 + refreshHz 字符串适配器，
  //    防止有人把字段区间双源加回来（反向测：加回即红）。
  const schema = loadSchema('phone');
  const byPath = new Map(schema.fields.map((f) => [f.path, f]));
  for (const path of SCHEMA_RANGE_PATHS) {
    const f = byPath.get(path);
    assert.ok(
      f && Array.isArray(f.range),
      `SCHEMA_RANGE_PATHS 里的 ${path} 应在 schema 且有 range`,
    );
    assert.deepEqual(
      FIELD_LIMITS[path],
      f.range,
      `${path} 的闸门区间应恒等于 schema.range（单一真源被破坏）`,
    );
  }
  assert.deepEqual(
    Object.keys(LIMITS).sort(),
    ['maxCoverageDrop', 'maxDropRatio', 'minProducts', 'refreshHz'],
    'LIMITS 只允许进程阈值 + refreshHz 字符串适配器；字段区间一律走 schema.range（审计 A2）',
  );
  for (const [key, range] of Object.entries(LIMITS)) {
    if (!Array.isArray(range)) continue;
    assert.ok(range.length === 2, `LIMITS.${key} 应为 [下界, 上界]，实得 ${range}`);
    assert.ok(range[0] < range[1], `LIMITS.${key} 上下界写反了：${range}`);
    // 下界允许 0（如 chargeW：0 表示不支持有线快充，是合法数据），
    // 但不允许负数——那是解析器把减号吞了的症状
    assert.ok(range[0] >= 0, `LIMITS.${key} 下界不应为负：${range}`);
  }
  for (const p of REQUIRED_PATHS) {
    // 顶层字段（如 releaseDate）就是没有点号的，其余必须是点号路径。
    // 反过来漏写点号才是 bug：get() 会对 undefined 取属性而静默返回 undefined，
    // 那条必填路径就永远不会报警——是一条静默失效的闸门。
    if (!p.includes('.')) {
      assert.ok(p in phone(), `REQUIRED_PATH「${p}」是顶层字段，应确实存在于机型上`);
    } else {
      const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), phone());
      assert.notEqual(v, undefined, `REQUIRED_PATH「${p}」指向的字段不存在于机型上`);
    }
  }
});

/* ================================================================ *
 * 品牌映射层 golden 测试（防「静默映射错路径」）
 * ----------------------------------------------------------------
 * ENGINEERING-REVIEW 维度六指出：最脆弱、上游改版最先崩的品牌映射层
 * （mapHuawei / mapAppleSpecs / mapAppleCompare，600+ 行）此前零单测——
 * 闸门只查 REQUIRED_PATHS 等少量字段，一个字段被静默映射到错误路径不会触发闸门。
 * 这里对「固定在仓库里的 raw fixture」跑完整映射函数，断言产物与提交的 golden
 * 逐字段一致；上游改版或映射逻辑变动都会让 golden 失配，逼人工 review。
 * fixture / golden 由 scripts/normalize/brands/__fixtures__/ 下（纯 .json，不进指纹）。
 * ================================================================ */
section('品牌映射层 golden 测试');
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
check('华为规格页映射 ↔ golden', () => assertGolden(mapHuawei, 'huawei.json', '华为'));
check('苹果规格页映射 ↔ golden', () =>
  assertGolden(mapAppleSpecs, 'apple-specs.json', '苹果规格页'),
);
check('苹果对比页映射 ↔ golden', () =>
  assertGolden(mapAppleCompare, 'apple-compare.json', '苹果对比页'),
);

// 反向断言：NFC 的「不支持」包含子串「支持」，解析器必须先排除否定写法——
// 否则官网写「不支持 NFC」会被发布成 nfc=true（把没有的能力说成有）。
check('华为 NFC：明确写「不支持」必须解析为 false', () => {
  const rec = mapHuawei({
    id: 'test-nfc-no',
    name: 'Test NFC No',
    raw: { NFC: '不支持 NFC' },
  });
  assert.equal(rec.connectivity.nfc, false);
});

// 反向断言：官网没提防抖 ≠ 确认没有。parseOis 返回 false 会让
// apple.mjs 的回填守卫（ois === false 才跳过）把「没写」的镜头钉死成无防抖。
check('OIS：原文没提防抖必须返回 null（不编造「确认无」）', () => {
  assert.equal(parseOis(''), null);
  assert.equal(parseOis('5000 万像素，f/1.8 光圈'), null);
  assert.equal(parseOis('支持 OIS 光学防抖'), true);
  assert.equal(parseOis('不支持光学防抖'), false);
});

/* ================================================================ *
 * 11. 窗口过滤与待收录队列
 * ----------------------------------------------------------------
 * 这段判据原先内联在 main() 里，自测碰不到 —— 而它恰好是「错了也不报错」的那一类：
 * 把「无发布日期」误判成「窗口外」，新机静默消失、零报错；把「窗口外」误判成
 * 「待收录」，队列塞满正常老机型、永远清不掉。两个方向都不会抛异常。
 *
 * 队列文件更有一条静默失效：只要带一个时间戳进去，「队列没变」就永远不成立，
 * CI 每 12 小时制造一次空提交。所以下面有专门一条断言盯「同输入同字节」。
 * ================================================================ */
section('窗口过滤与待收录队列');

const P2025 = (id, extra = {}) => ({ id, brand: 'apple', releaseDate: '2025-03-01', ...extra });

check('三类丢弃各归其位：缺日期入队、窗口外不入队、模糊边界收进来', () => {
  const input = [
    { id: 'a-no-date', brand: 'apple', name: 'A' }, // 无发布日期 → missing-date，入队
    P2025('b-old', { releaseDate: '2019-09-20' }), // 明确早于窗口 → window，不入队
    P2025('c-in', {}), // 窗口内 → kept
    // 日期精度只到月，且压在边界上（2024-09 距2024-09-01 不到 45 天）→ kept + windowNote
    P2025('d-fuzz', { releaseDate: '2024-09', releaseDatePrecision: 'month' }),
    // 精度不足但离边界很远 → 仍按 window 出局
    P2025('e-fuzz-far', { releaseDate: '2023-11', releaseDatePrecision: 'month' }),
  ];
  const r = WQ.classifyByWindow(input, { windowStart: '2024-09-01' });

  assert.deepEqual(
    r.kept.map((p) => p.id).sort(),
    ['c-in', 'd-fuzz'],
    '窗口内 + 边界模糊的必须收进来',
  );
  assert.deepEqual(
    r.dropped.map((d) => [d.id, d.kind]).sort(),
    [
      ['a-no-date', 'missing-date'],
      ['b-old', 'window'],
      ['e-fuzz-far', 'window'],
    ],
    '丢弃项必须标清 kind，否则队列分不清「可行动」与「产品侧决定」',
  );
  assert.deepEqual(
    r.pending.map((q) => q.id),
    ['a-no-date'],
    '只有缺发布日期的入队 —— 入队标准收窄或放宽都会造成垃圾或漏报',
  );
});

check('反向测：模糊边界必须按精度区分，两侧都试一遍', () => {
  // 只测「边界附近的收进来」会漏掉另一半：若某天有人把 fuzz 条件写成永远 true，
  // 2019 年的老机型会被全收进来。单测要能区分两个方向，所以造一组对照。
  const near = WQ.classifyByWindow(
    [P2025('near', { releaseDate: '2024-09', releaseDatePrecision: 'month' })],
    {
      windowStart: '2024-09-01',
    },
  );
  const far = WQ.classifyByWindow(
    [P2025('far', { releaseDate: '2023-11', releaseDatePrecision: 'month' })],
    {
      windowStart: '2024-09-01',
    },
  );
  assert.equal(near.kept.length, 1, '边界附近的应保留');
  assert.equal(far.kept.length, 0, '离边界远的应出局 —— 若此项也保留，fuzz 条件失效了');
  // 反向：精度到天但压在同一天之前 → 不走fuzz 分支（fuzz 只对精度不足生效）
  const day = WQ.classifyByWindow(
    [P2025('day', { releaseDate: '2024-08-20', releaseDatePrecision: 'day' })],
    {
      windowStart: '2024-09-01',
    },
  );
  assert.equal(day.kept.length, 0, '精度到天的应严格按日期判定，不吃fuzz 豁免');
});

check('窗口起点非法时抛错，而不是静默把所有机型都判出局', () => {
  assert.throws(
    () => WQ.classifyByWindow([P2025('x')], { windowStart: 'not-a-date' }),
    /windowStart/,
    'Date.parse 得到 NaN 时若不抛错，NaN 比较恒为 false，会把全部机型误判为窗口外',
  );
});

check('待收录项带可执行的人工动作（不是一句「失败了」）', () => {
  const r = WQ.classifyByWindow([{ id: 'iphone-99', brand: 'apple', name: 'iPhone 99' }], {
    windowStart: '2024-09-01',
  });
  const q = r.pending[0];
  assert.ok(q.action.includes('release-dates.json'), '必须指明补哪张表');
  assert.ok(q.action.includes('"id": "iphone-99"'), '必须把要补的那条 id 写出来，照抄即可');
  assert.equal(q.brand, 'apple', '要带品牌，否则 60 台里人工分不清是谁');
});

check('队列文件是纯数据的函数：同输入必须逐字节一致（反向：带时间戳必失败）', () => {
  const pending = [
    {
      id: 'b',
      kind: 'missing-date',
      brand: 'apple',
      name: null,
      nameZh: null,
      slug: null,
      action: 'x',
    },
    {
      id: 'a',
      kind: 'missing-date',
      brand: 'huawei',
      name: null,
      nameZh: null,
      slug: null,
      action: 'y',
    },
  ];
  const s1 = JSON.stringify(WQ.buildQueueFile(pending, { windowStart: '2024-09-01' }));
  const s2 = JSON.stringify(WQ.buildQueueFile(pending, { windowStart: '2024-09-01' }));
  assert.equal(s1, s2, '同输入必须同字节 —— 否则 CI 每轮都判「队列变了」，制造空提交');

  // 反向测：顺序打乱也必须同字节（排序只认 id，不认传入顺序）
  const s3 = JSON.stringify(
    WQ.buildQueueFile([...pending].reverse(), { windowStart: '2024-09-01' }),
  );
  assert.equal(s1, s3, '顺序打乱后仍须一致 —— 说明排序生效');

  // 反向测：文件里不得含任何看起来像时间戳的字段。
  // 判据用字段名而不是值 —— 直接搜 2024-09-01 会误伤 windowStart（它是业务日期，该留）。
  const queue = WQ.buildQueueFile(pending, { windowStart: '2024-09-01' });
  const VOLATILE =
    /generatedAt|firstSeenAt|lastSeenAt|fetchedAt|syncedAt|builtAt|snapshotAt|checkedAt|updatedAt/;
  const walk = (n, p) => {
    if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${p}[${i}]`));
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) {
        assert.ok(!VOLATILE.test(k), `${p}.${k} 是运行时刻字段，进队列文件必然造成空提交`);
        walk(v, `${p}.${k}`);
      }
    }
  };
  walk(queue, '$');
  assert.equal(queue.count, 2, 'count 必须与 items 长度一致');
});

check('真实快照里不该有大批待收录项（>5 说明 release-dates 表该补了）', () => {
  const snap = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
  const dated = snap.products.filter((p) => p.releaseDate).length;
  assert.equal(
    dated,
    snap.products.length,
    `快照里 ${snap.products.length - dated} 台没有发布日期 —— 收录窗口靠发布日期过滤，没有日期的进不来`,
  );
});

/* ================================================================ *
 * 12. 待收录队列 ↔ 指纹层的接线
 * ----------------------------------------------------------------
 * 队列本身测过了，但还有一条「接上去之后能不能被发现」的链路。
 * 这类接线最容易出的事是：**功能写对了，可它挂在一条判据从来不看的分支上**。
 *
 * 具体故障：新机发布却缺发布日期时，它进不了 products.json →
 * dataFingerprint 不动、siteFingerprint 不动 →
 * CI 的提交条件只看这两个标志 → data/discovery-pending.json 永远不进仓库。
 * 台数没少、页面没变、零报错，只是多了一台本该上站的机器没人知道。
 *
 * 所以这里测的是「队列变化能被独立算出来」，量法本身必须先证明有效。
 * ================================================================ */
section('待收录队列与指纹接线');

const FP = await import('./publish/fingerprint.mjs');

check('量法 sanity check：同一份队列文件必须算出同一指纹', () => {
  // 先证明「量法本身有效」：同内容两次算出的指纹必须一致，内容变了必须不同。
  // 量法失效（永远返回常量）的话，下面所有关于 pending_changed 的断言都是空的。
  const fp = FP.compute();
  const again = FP.compute();
  assert.equal(
    fp.pendingFingerprint,
    again.pendingFingerprint,
    '量法失效：同一份内容两次算出不同指纹，下面关于 pending_changed 的断言都不可信',
  );
  assert.equal(typeof fp.pendingFingerprint, 'string');
  assert.ok(fp.pendingFingerprint.length > 0, '队列指纹不能是空串');
});

check('反向测：队列内容一变，指纹必须跟着变（否则 CI 永远发现不了新机）', () => {
  // 先 sanity check 量法：同内容两次算出的指纹必须一致。量法失效（永远返回常量）
  // 的话，下面所有关于 pending_changed 的断言都是空的。
  const fp = FP.compute();
  const again = FP.compute();
  assert.equal(
    fp.pendingFingerprint,
    again.pendingFingerprint,
    '量法失效：同一份内容两次算出不同指纹',
  );

  // 再反向测内容敏感性：队列增减必须改变指纹。
  // 算法与 fingerprint.mjs 的 computePendingFingerprint 一致（sha256 前 16 位）。
  const h = (obj) =>
    createHash('sha256')
      .update(JSON.stringify(obj, null, 2).replace(/\r\n/g, '\n'))
      .digest('hex')
      .slice(0, 16);
  const one = { windowStart: '2024-09-01', count: 1, items: [{ id: 'a' }] };
  const two = { windowStart: '2024-09-01', count: 2, items: [{ id: 'a' }, { id: 'b' }] };
  assert.notEqual(
    h(one),
    h(two),
    '队列增减必须改变指纹 —— 这一条若不成立，pending_changed 永远是 false，队列提交不进仓库',
  );

  // 接线必须真的接上了：compute() 要吐出这些字段，缺一个 CI 就拿不到信号
  assert.ok('pendingFingerprint' in fp, 'compute() 必须返回 pendingFingerprint');
  assert.equal(typeof fp.pendingCount, 'number', 'compute() 必须返回 pendingCount');
  assert.ok('rawFingerprint' in fp, 'compute() 必须返回 rawFingerprint（归档接线）');
  assert.equal(typeof fp.rawBytes, 'number', 'compute() 必须返回 rawBytes');
});

check('归档若存在，指纹必须随它变化（官网改版时raw_changed 要能被发现）', () => {
  const fp = FP.compute();
  const dir = join(ROOT, 'data/raw');
  if (!existsSync(dir)) {
    // 还没归档过：必须报 empty，且指针里那一项也不能是空串以外的乱值
    assert.equal(fp.rawFingerprint, 'empty', '没有 data/raw/ 时应返回 empty');
    assert.equal(fp.rawBytes, 0);
    return;
  }
  assert.notEqual(fp.rawFingerprint, 'empty', 'data/raw/ 有文件却算出 empty —— 接线断了');
  assert.ok(fp.rawBytes > 0, '归档非空时 rawBytes 必须 > 0');
});

check('队列文件不存在时指纹是 empty 而非崩溃（60 台发布日期齐全是常态）', () => {
  const fp = FP.compute();
  const p = join(ROOT, 'data/discovery-pending.json');
  if (!existsSync(p)) {
    assert.equal(fp.pendingFingerprint, 'empty', '没有队列文件时应返回 empty');
    assert.equal(fp.pendingCount, 0);
  } else {
    assert.notEqual(fp.pendingFingerprint, 'empty', '队列文件存在却算出 empty —— 接线断了');
    assert.ok(fp.pendingCount > 0, '队列非空时 pendingCount 必须 > 0');
  }
});

check('队列指纹不参与站点指纹（用户看不到队列变化，不该触发重新发布）', () => {
  const fp = FP.compute();
  //站点指纹 = data × template，公式里没有队列这一项。
  // 这是刻意的：队列变了只需要提交，不需要重新发布站点。
  assert.ok(
    fp.siteFingerprint !== fp.pendingFingerprint || fp.pendingFingerprint === 'empty',
    '队列指纹与站点指纹不应是同一个值',
  );
  assert.ok(
    fp.siteFingerprint && fp.dataFingerprint && fp.templateFingerprint,
    '三个指纹都必须有值',
  );
});

check('入库指针 data/.fingerprint 必须记队列指纹（否则下一轮算不出变化）', () => {
  const ptrPath = join(ROOT, 'data/.fingerprint');
  assert.ok(existsSync(ptrPath), `缺少入库指针 ${ptrPath} —— CI 下一轮没法比对`);
  const ptr = JSON.parse(readFileSync(ptrPath, 'utf8'));
  for (const k of ['dataFingerprint', 'siteFingerprint', 'templateFingerprint', 'products']) {
    assert.ok(k in ptr, `指针缺字段 ${k}`);
  }
  // pendingFingerprint 允许暂时缺失（功能刚上线的那一轮还没推进指针），
  // 但只要它存在就不能是 undefined —— 显式 undefined 会让JSON.stringify 丢键，
  // 下轮比对时又变成「没有」，形成静默的永久漏报。
  if ('pendingFingerprint' in ptr) {
    assert.equal(typeof ptr.pendingFingerprint, 'string', 'pendingFingerprint 存在就必须是字符串');
  }
});

check('data/discovery-pending.json 若存在，必须是无时间戳的纯数据文件', () => {
  const p = join(ROOT, 'data/discovery-pending.json');
  if (!existsSync(p)) {
    // 当前没有待收录项是正常状态（60 台发布日期齐全）。
    // 但必须确认「真的没有」而不是「忘了生成」—— 用 release-dates 的条数佐证。
    const rd = JSON.parse(readFileSync(join(ROOT, 'data/release-dates.json'), 'utf8'));
    assert.ok(
      rd.entries.length >= 60,
      `既没有待收录队列，取证表也只有 ${rd.entries.length} 条 —— 两者必有一处不对`,
    );
    return;
  }
  const raw = readFileSync(p, 'utf8');
  const q = JSON.parse(raw);
  assert.equal(typeof q.count, 'number', 'count 必须是数字');
  assert.equal(q.count, q.items.length, 'count 必须与 items 长度一致');
  assert.equal(q.windowStart, '2024-09-01', 'windowStart 应与管线窗口一致');
  assert.ok(
    !/generatedAt|firstSeenAt|fetchedAt|syncedAt/.test(raw),
    '队列文件含时间戳字段，会造成空提交',
  );
  for (const it of q.items) {
    assert.equal(it.kind, 'missing-date', '队列里只该有缺发布日期这一类');
    assert.ok(it.action?.includes('release-dates.json'), '每条都要指明补哪张表');
  }
});

/* ================================================================ *
 * 搜索：写法容错
 *
 * 为什么这组值得钉死：搜索是纯函数、零依赖，能被 selftest 直接 import，
 * 而**它的故障形态是静默的** —— 匹配规则写错不会报错，只会让用户「搜不到」
 * 或「搜出一堆不相干的」。本组每一条都来自**真实数据探测**，不是设想的风险：
 *   - 真机抓到的：芯片名两种写法并存 → `麒麟9020` 1 台 vs `麒麟 9020` 3 台
 *   - 探测抓到的：`苹果16` 0 台（中文用户必打的写法）
 *   - 探测抓到的：`mate 1` 命中 Mate 80 Pro（芯片名里 `（16 GB RAM 版本）` 的 1）
 *   - 探测抓到的：`splitRuns` 只返回汉字段 → `苹果16` 悄悄变成只搜「苹果」13 台
 * ================================================================ */
section('搜索：写法容错（不要求用户照抄空格）');

const S = await import('../src/lib/search.ts');
const Q = await import('../src/lib/query.ts');

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

check('搜索：带空格 / 不带空格 / 混合大小写 命中同一台机', () => {
  // 需求原文：「官方是 nova 14 Ultra，但用户可能会输入 nova14ultra」
  assert.deepEqual(names('nova 14 Ultra'), ['a'], '官方写法');
  assert.deepEqual(names('nova14ultra'), ['a'], '连写');
  assert.deepEqual(names('Nova14Ultra'), ['a'], '连写 + 混合大小写');
  assert.deepEqual(names('NOVA 14 ULTRA'), ['a'], '全大写 + 带空格');
  assert.deepEqual(names('nova 14ultra'), ['a'], '空格位置乱打');
  assert.deepEqual(names('nova   14   Ultra'), ['a'], '多空格');
});

check('搜索：全角输入也能命中（中文输入法常见）', () => {
  assert.deepEqual(names('nova １４ ｕｌｔｒａ'), ['a'], '全角数字与字母');
  assert.deepEqual(names('ＮＯＶＡ　１４　ＵＬＴＲＡ'), ['a'], '全角大写 + 全角空格');
});

check('搜索：常见分隔符等价（- _ · + （））', () => {
  // 数据里芯片名同时存在「麒麟 9020」与「麒麟9020」，不能要求用户猜哪种写法
  assert.deepEqual(names('麒麟 9020'), ['c'], '官方写法（这里数据本身无空格）');
  assert.deepEqual(names('麒麟9020'), ['c'], '连写');
  assert.deepEqual(names('麒麟-9020'), ['c'], '连字符');
  assert.deepEqual(names('麒麟_9020'), ['c'], '下划线');
  assert.deepEqual(names('iPhone-16-Pro-Max'), ['b'], '连字符代替空格');
  assert.deepEqual(names('nova 14 (优享版)'), [], '括号内是查询词，不能凭空造出机型');
});

check('搜索：分级匹配 —— 精确优先，无果才放宽', () => {
  /*
   * 这条判据改过两次，过程写在这里以免以后有人重复踩：
   *
   * ① 第一版：「`iPhone 1` 不该命中 16e」。反向测（改成两通道并集）时**居然全绿** ——
   *    因为 `haystack.includes('iphone 1')` 对 `iPhone 16e` 本来就为真，
   *    精确通道自己就命中了。那个例子证明不了任何事。
   * ② 第二版：「精确有结果时不读 compact」。修完下面「数据写法不统一」那个真 bug 后
   *    又红了 —— 因为现在 matchExact **本来就该读 compact**（token 无空格时要去认同源写法）。
   *    用「读 compact 的次数」当判据本身就是错的：它随实现细节漂移。
   * ③ 第三版（当前）：只验**行为** —— 精确有结果时，search() 的结果必须等于
   *    独立实现的精确通道结果。实现怎么变都不影响这条。
   *
   * ⚠️ 诚实的边界：③ **抓不到「并集」这个具体变体**（反向测过，并集下仍全绿）。
   *    因为整串归一化对多词查询必然**更严格**，所以并集 ≡ 精确 ——
   *    分级与并集在当前口径下行为完全一致，没有能区分它们的行为差异。
   *    那就不假装能抓。「精确优先」在这里是**防御性设计**：
   *    防止将来有人把整串归一化改成「分词后逐词归一化」（那才会真的放宽、污染好结果）。
   *    本条现在守的是「精确通道与整串通道口径一致」这个真正的不变量。
   */
  // 精确通道的独立实现（用最笨的写法把口径重算一遍，避免"用被测代码测自己"）
  const exactOnlyResult = (docs, q) => {
    const ts = S.tokenize(q);
    if (!ts.length) return [];
    return docs
      .filter((d) =>
        ts.every((t) => {
          if (d.haystack.includes(t)) return true;
          const c = S.compact(t);
          return c.length > 0 && d.compact.includes(c);
        }),
      )
      .map((d) => d.product.id);
  };

  // 比较只看「结果集」不看「顺序」：search() 按相关度重排，参考实现保输入序，
  // 两者顺序天然不同；这条用例钉的是「精确有果时集合不受 compact 通道污染」。
  const setEq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  for (const q of ['nova 14', 'nova', 'iPhone 16', '麒麟 9020', '测试']) {
    const ex = exactOnlyResult(DOCS, q);
    assert.ok(ex.length > 0, `前提：「${q}」必须有精确结果，否则本用例失去区分力`);
    assert.ok(setEq(names(q), ex), `「${q}」精确有结果时，结果集必须等于精确通道的结果`);
  }

  // 精确无果 → 归一化通道兜底（这才是容错通道存在的意义）
  assert.deepEqual(names('nova14ultra'), ['a'], '精确无果 → 整串归一化兜底');
  // 精确无果且归一化也无果 → 空结果，不得回退成「全部」
  assert.deepEqual(names('zzz不存在zzz'), [], '两条通道都无果时返回空，不是全部');
  assert.deepEqual(names('ip16'), [], '差太多的缩写不兜底（不做编辑距离）');
});

check('搜索：数据里写法不统一时，两种写法必须等价（真 bug 回归）', () => {
  /*
   * 这条来自**真机 smoke 抓到的真 bug**，不是设想的风险：
   * 官方数据里芯片名三种写法并存 ——
   *   Mate 80 芯片 = `麒麟9020`
   *   Mate XTs 芯片 = `麒麟 9020`
   *   Mate 70 Air 芯片 = `麒麟 9020A 麒麟 9020B`
   * 精确通道原本只做 `haystack.includes(token)`，于是
   *   搜「麒麟9020」 → 1 台（只有 Mate 80 那台字面量匹配）
   *   搜「麒麟 9020」→ 3 台
   * **两个本该等价的查询给出不同结果** —— 用户不可能知道官网有三种写法。
   *
   * 修法：token 先按原样试，再按抹掉分隔符的形态试（见 matchExact 注释）。
   * 这条用例钉死「写法不同 ≠ 结果不同」。
   */
  const mixed = S.buildDocs(
    [
      sdoc({ id: 'c1', name: 'M1', chipset: { name: '麒麟9020' } }),
      sdoc({ id: 'c2', name: 'M2', chipset: { name: '麒麟 9020' } }),
      sdoc({ id: 'c3', name: 'M3', chipset: { name: '麒麟 9020A' } }),
      sdoc({ id: 'other', name: 'M9', chipset: { name: '麒麟 9000' } }),
    ],
    new Map(),
  );
  const ids = (q) =>
    S.search(mixed, q)
      .map((d) => d.product.id)
      .sort();

  assert.deepEqual(ids('麒麟9020'), ['c1', 'c2', 'c3'], '连写要命中全部三种写法');
  assert.deepEqual(ids('麒麟 9020'), ['c1', 'c2', 'c3'], '带空格要命中全部三种写法');
  assert.deepEqual(ids('麒麟9020'), ids('麒麟 9020'), '两种写法结果集必须相同');
  assert.deepEqual(ids('麒麟9000'), ['other'], '不相关芯片不能被带上');
});

check('搜索：分词 AND 语义不因容错而丢失', () => {
  // 「华为 mate」用 AND：不能因为容错就把 OR 引进来越搜越多
  assert.equal(S.search(DOCS, 'nova x').length, 1, '两个词都要命中');
  assert.equal(S.search(DOCS, 'nova 芯片').length, 0, '不存在的词不能被容错成命中');
});

// 下面两条钉的是 2026-10-14 审计 P0-1 的故障原型：
// 「要不要弹容错提示」曾复用检索用的 matchExact（内部含 compact 回落），
// 于是「靠抹掉空格才命中」也被算作精确命中 ⇒ usedLooseMatch 恒 false
// ⇒ 提示条永不显示；而承载这条需求的 _smoke-search.cjs 既没进 CI 也没注册
// npm script，连着 14 项红灯没有任何一次自动运行看得见。
// 教训：判据一旦合并，某一方向必然静默失效 —— 这里两个方向同时钉死。

check('容错提示判据：字面通道必须严格（紧凑写法判为「写法不同」）', () => {
  const d = { haystack: 'huawei nova 14 ultra', compact: 'huaweinova14ultra' };
  // 走真实调用路径（与 SearchView 一致：tokenize → matchLiteral）
  assert.equal(
    Q.matchLiteral(d, Q.tokenize('nova 14 ultra')),
    true,
    '与官方写法一致（含空格）⇒ 字面命中',
  );
  assert.equal(
    Q.matchLiteral(d, Q.tokenize('nova14ultra')),
    false,
    '紧凑写法缺空格 ⇒ 字面必须判否，否则提示条永不显示（P0-1 故障原型）',
  );
  assert.equal(
    Q.matchLiteral(d, Q.tokenize('nova   14   ultra')),
    true,
    '空白数量差异不算写法不同（分词时已折叠）',
  );
});

check('容错提示判据：检索通道必须宽松（与字面通道不许合并）', () => {
  const d = { haystack: 'huawei nova 14 ultra', compact: 'huaweinova14ultra' };
  assert.equal(
    Q.matchExact(d, ['nova14ultra']),
    true,
    '检索必须容错：用户打紧凑写法也要能搜到',
  );
  // 反向测：两条通道若被「顺手合并」成同一份实现，上面两条用例必有一条变红。
  assert.notEqual(
    Q.matchLiteral(d, ['nova14ultra']),
    Q.matchExact(d, ['nova14ultra']),
    '字面与检索必须是两个判据 —— 合并其一，必有一方向静默失效',
  );
});

check('搜索：缺失字段不参与匹配（空串被 any query 命中的老故障）', () => {
  // 文档 d 的 chipset 为 null，若参与匹配，空串会让任何查询都命中它
  assert.ok(!names('任意查询').includes('d'), '官网未公布的字段不能被匹配');
  assert.ok(!names('芯片').includes('d'), '搜「芯片」不该命中芯片缺失的那台');
});

check('搜索：空查询返回空，不返回全部', () => {
  assert.deepEqual(names(''), [], '空串不能变成「全部机型」');
  assert.deepEqual(names('   '), [], '纯空格同理');
});

check('compact 归一化本身的行为（不改大小写以外的东西）', () => {
  assert.equal(S.compact('nova 14 Ultra'), 'nova14ultra');
  assert.equal(S.compact('Nova-14_Ultrа'.replace('а', 'a')), 'nova14ultra');
  // NFKC：全角 → 半角
  assert.equal(S.compact('ＮＯＶＡ'), 'nova');
  // 分隔符全抹，但数字与字母保留
  assert.equal(S.compact('Pro+'), 'pro', '加号是分隔符');
  assert.equal(S.compact('Mate 70'), 'mate70', '不能把数字抹掉（否则 mate7 命中 mate70）');
});

/* ── 以下四条来自 _probe-search.mjs 对 60 台真实数据的探测 ── */

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

check('搜索：中文与西文连写（苹果16 / 华为nova14）', () => {
  /*
   * 真实缺口：用户打的是「苹果16」，不是「苹果 16」。苹果那一批的机型名是
   * iPhone，中文只出现在厂商名里，于是「苹果16」在检索串里找不到 → 0 台。
   * 中文用户几乎必然会这么打，零结果是不可接受的。
   */
  assert.deepEqual(cjkIds('苹果16'), ['ip16', 'ip16p', 'ip16pm'], '连写与带空格必须等价');
  assert.deepEqual(cjkIds('苹果 16'), cjkIds('苹果16'), '两个写法结果集必须相同');
  assert.deepEqual(cjkIds('苹果16pro'), ['ip16p', 'ip16pm'], '连写 + 修饰词');
  assert.deepEqual(cjkIds('苹果16promax'), ['ip16pm'], '连写 + 完整型号');
  assert.deepEqual(cjkIds('华为nova14'), ['nv14', 'nv14u'], '华为那一批同款');
  assert.deepEqual(cjkIds('华为 nova 14'), cjkIds('华为nova14'), '带空格等价');
  // 反向：不该因为放宽就连品牌都搜不到具体型号
  assert.ok(!cjkIds('苹果16').includes('ip17'), 'iPhone 17 不该被「16」命中');
});

check('splitRuns 必须返回全部段，不能只返回汉字段', () => {
  /*
   * ⚠️ 这条来自一个**真的、零报错的 bug**。
   * 实现曾写成 `token.match(HAN_RUN)` —— `match` 只给汉字段，于是
   *   `苹果16` → `['苹果']`（`16` 被静默丢弃）
   * 结果查询被悄悄改成「只搜苹果」→ 13 台；`畅享90` → 6 台（把畅享 80、70X
   * 也拉进来）；`麒麟9020` → 28 台。一个正则的偷懒换来一批假结果，零报错。
   *
   * 判据钉两件事：**段数**与**每段内容**。只钉「非空」这类弱判据是抓不住的。
   */
  assert.deepEqual(Q.splitRuns('苹果16'), ['苹果', '16'], '汉字段 + 非汉字段，两段都要在');
  assert.deepEqual(Q.splitRuns('apple手机壳'), ['apple', '手机壳'], '顺序敏感，字母在前');
  assert.deepEqual(Q.splitRuns('16pro苹果'), ['16pro', '苹果'], '非汉段保留完整，不切碎');
  assert.deepEqual(Q.splitRuns('mate80'), ['mate80'], '无汉字 → 原样');
  assert.deepEqual(Q.splitRuns('苹果'), ['苹果'], '纯汉字 → 原样，不重复');
  assert.deepEqual(
    Q.splitRuns('苹果手机'),
    ['苹果手机'],
    '纯汉字整词原样返回，不空拆（见 splitRuns 注释）',
  );
});

check('拆词只放宽、不收紧（不变量）', () => {
  /*
   * 拆出的每一段都是原词的子串，原词能命中的检索串必然也含各段，
   * 所以 `every` 的结果只会 false→true。反向测：把任意文档集合里
   * 「不拆也能搜到」的所有查询拿来，逐条断言拆词后仍能搜到。
   */
  const probes = [
    ['HUAWEI nova 14 Ultra', 'nv14u'],
    ['iPhone 16 Pro Max', 'ip16pm'],
    ['苹果16', 'ip16'],
    ['华为 nova 14', 'nv14'],
    ['iPhone Air', 'ipair'],
  ];
  for (const [q, id] of probes) {
    const before = S.search(CJK_DOCS, q).map((d) => d.product.id);
    const tokens = Q.queryTokens(q);
    // 断言「拆词后的词表覆盖了原词的每个字符片段」——这是放宽的充要条件。
    // 注意 queryTokens 内部已 NFKC + 小写，joined 是小写串，所以原字符要先 lowercase 再比
    const joined = tokens.join('');
    assert.ok(
      [...q].every((c) => joined.includes(c.toLowerCase()) || /\s/.test(c)),
      `「${q}」拆词后必须覆盖原字符（tokens=${JSON.stringify(tokens)}）`,
    );
    assert.ok(before.includes(id), `前提：「${q}」原本就该命中 ${id}`);
  }
});

check('数字边界：纯数字词不许命中更长数字的一部分', () => {
  /*
   * 真实数据：HUAWEI Mate 80 Pro 的芯片名是 `麒麟9030 Pro（16 GB RAM 版本）`，
   * 里面那个 "1" 让 `mate 1` 命中了它 —— 用户搜 Mate 一代（不存在），
   * 屏幕上出现的是一台 8 字头 Pro。子串匹配的固有噪音，用窄判据挡掉。
   *
   * 判据只拦**紧邻的数字**，不拦字母：`麒麟9030` 前面是「麟」，
   * 字母不算，否则中英混排的芯片名会被自己的前缀否掉。
   */
  const noisy = S.buildDocs(
    [
      sdoc({ id: 'p80', name: 'Mate 80 Pro', chipset: { name: '麒麟9030 Pro（16 GB RAM 版本）' } }),
      sdoc({ id: 'k90', name: 'Mate 90', chipset: { name: '麒麟9030' } }),
      sdoc({ id: 'k80a', name: 'Mate 80', chipset: { name: '麒麟 8000A' } }),
      sdoc({ id: 'xt2', name: 'Mate XT 2', line: 'Mate' }),
      sdoc({ id: 'x7', name: 'Mate X7', line: 'Mate' }),
    ],
    new Map(),
  );
  // 结果排序由相关度决定，本用例只验「命中集合」，故排序后再比
  const ids = (q) =>
    S.search(noisy, q)
      .map((d) => d.product.id)
      .sort();

  assert.deepEqual(ids('mate 1'), [], '「1」落在 16 内部 → 不得命中');
  assert.deepEqual(ids('mate 80 1'), [], '同上，多词也一样');
  assert.deepEqual(ids('mate 2'), ['xt2'], '2 独立成词 → 命中 XT 2，且不该命中 8000A');
  assert.deepEqual(ids('mate 7'), ['x7'], '7 独立成词 → 命中 X7，且不该命中 70/80 里的 7');
  // 排序：机型名精确等于「mate80」的 k80a 应压过「mate80pro」的 p80
  assert.deepEqual(ids('mate 80'), ['k80a', 'p80'], '80 独立成词 → 照常命中');
  // 字母不算边界：9030 前面是「麟」
  assert.deepEqual(ids('9030'), ['k90', 'p80'], '汉字前缀不该把 9030 否掉');
});

check('纯数字词不许回落到 compact 通道（守卫的后门）', () => {
  /*
   * ⚠️ 这是本组最容易被「顺手加个兜底」破坏的不变量。
   * compact 串已经抹掉分隔符，数字边界信息**全部丢失**；若纯数字词也去查
   * compact 串，守卫等于从后门把 `mate 1` 放回 Mate 80 Pro。
   * 判据：直接测 matchExact 单独用它，绕开 search 的分级逻辑。
   */
  const d = {
    haystack: 'mate 80 pro 麒麟9030 pro（16 gb ram 版本）',
    compact: Q.compact('mate 80 pro 麒麟9030 pro（16 gb ram 版本）'),
  };
  assert.equal(Q.matchExact(d, ['1']), false, '「1」必须被边界守卫拒');
  assert.equal(Q.matchExact(d, ['80']), true, '「80」独立成词必须收');
  // 反向测：若有人给纯数字词加 compact 回落，compact 串里含 "1" → 上面的 false 变 true
  assert.ok(d.compact.includes('1'), '前提：compact 串确实含 1，说明回落会真的破防');
});

/*
 * 历史记载（2026-10-16）：原「搜索与画布筛选口径一致」检查对照画布的 tokenize 通道，
 * 防止「同一个词两个答案」。画布页面移除后，搜索是唯一入口，对照对象已不存在，整条退役。
 * 若未来新增第二个搜索入口，必须恢复「同一批查询，两个入口集合相同」的对照。
 */

check('相关度排序：第一位必须是最佳匹配，不能由录入顺序决定', () => {
  /*
   * 故障形态是**被习惯掩盖**的：原先结果顺序 = products.json 行号，
   * 看久了没人觉得是 bug。但第一位是用户唯一一定会看的那一条，
   * 让它由行号决定等于把「最相关的」交给一个跟相关性无关的变量。
   */
  const first = (q) => S.search(CJK_DOCS, q)[0]?.product.id;
  assert.equal(first('苹果16'), 'ip16', '「苹果16」第一位必须是 iPhone 16');
  assert.equal(first('苹果16promax'), 'ip16pm', '完整型号必须排第一');
  assert.equal(first('nova14'), 'nv14', 'nova 14 应在 nova 14 Ultra 之前');
  assert.equal(first('苹果 16 pro'), 'ip16p', 'Pro 应在 Pro Max 之前');
  // 精确整串优先于「更长但包含它」的（用带空格的写法，否则 'ip16' 不是 'iPhone 16' 的子串）
  assert.equal(first('iphone 16'), 'ip16', 'iPhone 16 精确匹配应压过 16 Pro');
  assert.equal(first('iphone air'), 'ipair', 'iPhone Air 只有一台，稳');
});

/* ================================================================ *
 * 广场三榜 / 品类 / 系列+变体 / 芯片归一 / 全量筛选
 *
 * 这一批锁的是「派生口径」。它们最危险的形态是**静默错**：
 * 页面照常渲染、机型照常列出，只是最贵那台选错了、折叠屏全被判成直板、
 * 或者筛了某芯片后 19 台「人间蒸发」，全程零报错。
 * 每条断言都对着一个具体故障写。
 * ================================================================ */
section('广场三榜 / 品类 / 系列+变体 / 芯片归一 / 全量筛选');

const C = await import('../src/lib/catalog.ts');
const F = await import('../src/lib/facets.ts');

const REAL = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
// v2 适配：REAL_P 与前端加载同路——data.ts 的 loadDataset 会过 toPhoneViews
// （specs 容器 → 嵌套视图），这里同步过一遍，保证自测断言的就是前端真实形状，
// 而不是管线内部形状。不过这层的话 facets/catalog 的嵌套读取会全数 undefined。
const ADAPT = await import('../src/lib/adapt.ts');
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

// ── 折叠屏判据 ──

check('折叠屏判据认「折叠态」也认「折叠：」（同品牌两种措辞）', () => {
  // 真实故障：Mate X6 / X7 官网写「折叠：73.78 mm | 展开：144.04 mm」，**没有「态」字**，
  // 而 Mate XT 写「折叠态」。按一家一种措辞写正则必然漏判，且漏了不报错。
  const withZhuang = pdoc({ rawOfficial: { 尺寸与重量: '折叠态：12.3 mm | 三屏态：4.0 mm' } });
  const withColon = pdoc({ rawOfficial: { 尺寸与重量: '折叠：73.78 mm | 展开：144.04 mm' } });
  assert.equal(C.isFoldable(withZhuang), true, '带「态」字应命中');
  assert.equal(C.isFoldable(withColon), true, '不带「态」字也必须命中（真 bug 回归）');
});

check('反向测：主屏尺寸永不参与折叠判定（阈值是估算，官网原文才算）', () => {
  // 2026-10-06 真 bug 的判据侧回归：立绘曾用 `sizeIn >= 7.5` 判折叠，而折叠机主屏只有
  // 5.4–6.5 英寸 —— 7 台真折叠机漏了 3 台。立绘已随去像素化退役，这条守住 foldable.mjs
  // 自身不退回尺寸阈值：大屏无折叠原文 ⇒ 否；小屏有折叠原文 ⇒ 是。尺寸永远不参与判定。
  const bigBar = pdoc({
    id: 'fake-big-bar',
    name: 'Tablet 8.3',
    rawOfficial: { 尺寸与重量: '220 mm | 130 mm | 6.1 mm' },
    display: { sizeIn: 8.3 },
  });
  assert.equal(C.isFoldable(bigBar), false, '8.3 英寸大屏没有折叠原文依据，不得判为折叠');
  const smallFold = pdoc({
    id: 'fake-small-fold',
    name: 'Foldable 6.1',
    rawOfficial: { 尺寸与重量: '展开态：220 mm | 折叠态：130 mm' },
    display: { sizeIn: 6.1 },
  });
  assert.equal(C.isFoldable(smallFold), true, '官网写了折叠就必须认，哪怕主屏只有 6.1 英寸');
});

check('折叠屏判据不误伤直板机（对照组取真实机型）', () => {
  const bars = REAL_P.filter((p) => !C.isFoldable(p)).map((p) => p.name);
  assert.ok(bars.includes('iPhone 16'), 'iPhone 16 应判为直板');
  assert.ok(bars.includes('HUAWEI Mate 90'), 'Mate 90 应判为直板');
  assert.ok(bars.includes('华为畅享 90'), '畅享 90 应判为直板');
  for (const p of REAL_P) {
    if (C.isFoldable(p)) continue;
    const dims = String(p.rawOfficial?.['尺寸与重量'] ?? '');
    assert.ok(!/折叠|展开/.test(dims), `${p.name} 被误判成折叠屏`);
  }
});

check('折叠屏判据在真实数据上命中已知机型', () => {
  const names = REAL_P.filter(C.isFoldable).map((p) => p.name);
  for (const n of [
    'HUAWEI Mate X6',
    'HUAWEI Mate X7',
    'HUAWEI Mate XT 2 非凡大师',
    'HUAWEI Pocket 2 优享版',
    'HUAWEI Pura X',
    'iPhone Duo',
  ]) {
    assert.ok(names.includes(n), `${n} 应判为折叠屏`);
  }
});

check('body.folded 全为 null 时不塌成「无折叠屏」（字段陷阱回归）', () => {
  // `body.folded` 类型是 `unknown | null`，看着能用，实测 60 台全是 null。
  // 一旦谁拿它当判据，折叠屏会静默全灭。
  const allNull = REAL_P.every((p) => p.body?.folded == null);
  assert.ok(
    allNull && REAL_P.filter(C.isFoldable).length > 0,
    'folded 恒为 null 但仍需靠官网原文判出折叠屏 —— 说明判据没误用该字段',
  );
});

// ── 品类 / 形态 / 系列 / 变体 ──

check('品类计数之和等于在册台数（不能有机型漏归类）', () => {
  const counts = {};
  for (const c of C.CATEGORY_ORDER) counts[c.id] = 0; // 注册表内：0 台也可见
  for (const p of REAL_P) {
    const id = C.categoryOf(p);
    counts[id] = (counts[id] ?? 0) + 1; // 注册表外的意外品类在这里现形
  }
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, REAL_P.length, '每台都必须落进某个品类，不能凭空消失');
  // 2026-10-15 六品类扩充：phone 是主流但不再是全集（iPad/Mac/Watch 陆续入库）。
  // 性质断言：phone 池非空且与折叠屏判定同源（折叠屏归形态维度）。
  assert.ok(counts.phone > 0, 'phone 品类必须有数据');
});

check('形态维度：折叠屏 / 直板两类，之和等于全集（用户 2026-10-06 纠正）', () => {
  const forms = REAL_P.map(C.formOf);
  const fold = forms.filter((f) => f === 'foldable').length;
  const bar = forms.filter((f) => f === 'bar').length;
  assert.equal(fold + bar, REAL_P.length, '每台都必须有形态');
  // 台数从数据推导，不钉当期值：新机型入库（折叠或直板）时判据不该假警报。
  // 这里测的是性质 —— 恰好两类、之和等于全集、与 isFoldable 严格同源。
  assert.equal(bar, REAL_P.length - fold, '直板台数 = 全集 - 折叠台数');
  assert.equal(fold, REAL_P.filter(C.isFoldable).length, '折叠台数必须与 isFoldable 判据同源');
  // 反向测：形态与 isFoldable 必须严格同源，不能各判各的
  for (const p of REAL_P) {
    assert.equal(C.formOf(p) === 'foldable', C.isFoldable(p), `${p.name} 形态与折叠判据不一致`);
  }
});

// ── persona 限定域与折叠判据同源（2026-10-14 审计 P2-2）──
// derive.mjs 的 foldable 域 filter 曾按机型名反推（/折叠|Mate X|Pocket|Flip/i），
// 与唯一真源 foldable.mjs（官网原文「折叠/展开」）分叉——分叉是静默的：
// persona 照样产出合法字符串，没有任何现成测试会红。现在 filter 直接引
// isFoldableOfficial，这两条把同源钉死。
check('persona 折叠域与 isFoldable 判据严格同源（真实数据逐台比对）', () => {
  const foldableDomain = DERIVE.DOMAINS.find((d) => d.id === 'foldable');
  assert.ok(foldableDomain, 'DOMAINS 里应有 foldable 域');
  for (const p of REAL_P) {
    assert.equal(
      foldableDomain.filter(p),
      C.isFoldable(p),
      `${p.name}：persona 折叠域与 isFoldable 判据不一致`,
    );
  }
});

check('persona 折叠域不按机型名反推（旧错法回归防护）', () => {
  // 名字带 Flip / Mate X 但官网原文没写「折叠/展开」⇒ 必须判否。
  // 旧实现 /折叠|Mate X|Pocket|Flip/i.test(line+name) 会把它算进折叠池 ——
  // 名字反推形态正是 foldable.mjs 头注明文否定的做法。
  const foldableDomain = DERIVE.DOMAINS.find((d) => d.id === 'foldable');
  const fake = pdoc({
    id: 'fake-flip',
    name: 'HUAWEI Pocket Flip 90',
    line: 'Pocket',
    rawOfficial: { 尺寸与重量: '162.9 mm | 75.3 mm | 7.2 mm' },
  });
  assert.equal(
    foldableDomain.filter(fake),
    false,
    '官网原文没写折叠/展开 ⇒ 不许按机型名判成折叠屏',
  );
  // 反向：名字平平无奇但官网原文含「折叠」⇒ 必须判是（防改过头）
  const plain = pdoc({
    id: 'fake-fold',
    name: 'HUAWEI Mate 90',
    line: 'Mate',
    rawOfficial: { 尺寸与重量: '折叠：73.78 mm | 展开：144.04 mm' },
  });
  assert.equal(
    foldableDomain.filter(plain),
    true,
    '官网原文写了折叠 ⇒ 必须判为折叠屏（判据落在语义最小单位上）',
  );
});

// ── 设备视觉区几何（2026-10-16 二轮优化：品牌色块 + 屏幕比例矩形）──
// 组件不各自算比例/取色，全站卡片共用这一份派生事实；改一档就是改全部卡。
// ⚠️ import 必须在模块顶层：check() 是同步 try/catch，回调里 await 会让
// 断言失败变成未捕获 rejection、用例永远绿（本项目踩过的坑）。
const DV = await import('../src/lib/deviceVisual.ts');

check('视觉区比例：直板/折叠/平板/笔记本各一档，未知品类不猜（方形兜底）', () => {
  const bar = pdoc({ id: 'bar', category: 'phone' });
  assert.equal(DV.deviceScreenRatio(bar), 0.46, '直板手机应是竖长条');
  const fold = pdoc({
    id: 'fold',
    category: 'phone',
    rawOfficial: { 尺寸与重量: '展开态：220 mm | 折叠态：130 mm' },
  });
  assert.equal(DV.deviceScreenRatio(fold), 0.66, '折叠手机展开态接近方形，必须比直板宽（单独一档）');
  assert.equal(DV.deviceScreenRatio(pdoc({ id: 'tab', category: 'tablet' })), 0.72, '平板一档');
  assert.equal(DV.deviceScreenRatio(pdoc({ id: 'lap', category: 'laptop' })), 1.6, '笔记本横屏一档');
  // 反向：没登记的品类 → 1.0 方形兜底，不许猜出一个比例
  assert.equal(DV.deviceScreenRatio(pdoc({ id: 'x', category: 'no-such-cat' })), 1, '未知品类必须兜底方形');
});

check('screenBox：按比例缩放且不越出区域高度', () => {
  const phone = pdoc({ id: 'bar', category: 'phone' });
  assert.deepEqual(DV.screenBox(phone, 112), { width: '52px', height: '112px' }, '直板：高撑满区域，宽按比例');
  const laptop = pdoc({ id: 'lap', category: 'laptop' });
  assert.deepEqual(DV.screenBox(laptop, 112), { width: '112px', height: '70px' }, '横屏：宽不越过区域高度');
});

check('hexToRgba：品牌色正确拆分；坏值回退中性灰而不是抛错或透明', () => {
  assert.equal(DV.hexToRgba('#0071e3', 0.5), 'rgba(0, 113, 227, 0.5)', '苹果蓝');
  assert.equal(DV.hexToRgba('#cf0a2c', 0.13), 'rgba(207, 10, 44, 0.13)', '华为红');
  assert.equal(DV.hexToRgba(undefined, 0.5), 'rgba(100, 112, 138, 0.5)', '缺失 → --color-faint');
  assert.equal(DV.hexToRgba('not-a-color', 0.5), 'rgba(100, 112, 138, 0.5)', '坏形态 → 中性灰，不许抛');
});

check('各注册品类的计数都是非负整数（数据诚信：0 台就如实 0，不拿别的品类凑数）', () => {
  // 原「tablet/laptop/audio 必须为 0」断言是单品类时代的防造数据哨——
  // 2026-10-15 iPad 真实入库后过时；改为性质断言：计数结构合法 + phone/tablet 非空。
  const counts = {};
  for (const p of REAL_P) counts[C.categoryOf(p)] = (counts[C.categoryOf(p)] ?? 0) + 1;
  for (const c of C.CATEGORY_ORDER) {
    const n = counts[c.id] ?? 0;
    assert.ok(Number.isInteger(n) && n >= 0, `品类 ${c.id} 计数必须是非负整数`);
  }
  assert.ok((counts.tablet ?? 0) > 0, 'tablet 品类已有真实数据（iPad 全代）');
});

check('苹果系列只有四条线，Pro/Pro Max/Plus 归入「标准」（用户口径）', () => {
  // 用户 2026-10-05 明确：Pro / Pro Max / Plus 都是**标准系列的后缀**，
  // 与标准系列平级是错的（会让人以为它们是并行的独立产品线）。
  const apple = REAL_P.filter((p) => p.brand === 'apple');
  const series = new Set(apple.map(C.seriesOf));
  assert.deepEqual([...series].sort(), ['Air', 'SE', '标准', '折叠屏'].sort());
  const byName = Object.fromEntries(apple.map((p) => [p.name, C.seriesOf(p)]));
  for (const n of ['iPhone 18 Pro', 'iPhone 18 Pro Max', 'iPhone 16 Plus', 'iPhone 17']) {
    assert.equal(byName[n], '标准', `${n} 应属标准系列`);
  }
  assert.equal(byName['iPhone Air'], 'Air');
  assert.equal(byName['iPhone Duo'], '折叠屏');
  assert.equal(byName['iPhone 17e'], 'SE');
});

check('变体判定长后缀优先：Pro Max 不落进 Pro 档', () => {
  // iPhone 18 Pro Max 同时含 Pro 与 Max，先判 Pro Max 才不会少一档。
  const v = Object.fromEntries(
    REAL_P.filter((p) => p.brand === 'apple').map((p) => [p.name, C.variantOf(p)]),
  );
  assert.equal(v['iPhone 18 Pro Max'], 'Pro Max');
  assert.equal(v['iPhone 18 Pro'], 'Pro');
  assert.equal(v['iPhone 16 Plus'], 'Plus');
  assert.equal(v['iPhone 16'], '标准');
  assert.equal(v['iPhone Duo'], '折叠双屏');
});

check('反向测：名字含「Core 2 Duo / Core Duo / PowerBook Duo」的苹果 Mac 不得判成折叠屏（处理器多核 ≠ 折叠屏）', () => {
  // 真实 bug：苹果系列/foldVariant 的 name 匹配曾写 `\\bDuo\\b`，
  // 命中了产品名里的「Core 2 Duo / Core Duo / PowerBook Duo」（处理器双核命名），
  // 把一整批 1990s–2000s 的 Mac/PowerBook 误判成「折叠屏」系列 +「折叠双屏」变体。
  // 折叠屏是形态（iPhone Duo），处理器叫多核和折叠毫无关系。
  const apple = REAL_P.filter((p) => p.brand === 'apple');
  const bySeries = Object.fromEntries(apple.map((p) => [p.name, C.seriesOf(p)]));
  const byVariant = Object.fromEntries(apple.map((p) => [p.name, C.variantOf(p)]));
  const misnamed = apple.filter(
    (p) => /\bDuo\b/i.test(p.name) && !/iPhone\s*Duo/i.test(p.name),
  );
  assert.ok(misnamed.length > 0, '应存在名字含 Duo 但非 iPhone Duo 的机型（真 bug 回归防护）');
  for (const p of misnamed) {
    assert.notEqual(bySeries[p.name], '折叠屏', `${p.name}：处理器双核命名不得判为折叠屏系列`);
    assert.notEqual(byVariant[p.name], '折叠双屏', `${p.name}：处理器双核命名不得判为折叠双屏变体`);
  }
  // 反向：真折叠机仍必须判对（防改过头）
  assert.equal(bySeries['iPhone Duo'], '折叠屏', 'iPhone Duo 必须仍是折叠屏系列');
  assert.equal(byVariant['iPhone Duo'], '折叠双屏', 'iPhone Duo 必须仍是折叠双屏变体');
});

check('系列分面计数之和等于品牌台数（不能有机型漏分系列）', () => {
  for (const brand of ['apple', 'huawei']) {
    const pool = REAL_P.filter((p) => p.brand === brand);
    for (const f of C.seriesFacets(pool)) {
      assert.ok(f.count > 0, `${brand} 的系列 ${f.id} 计数不能为 0`);
    }
    const sum = C.seriesFacets(pool).reduce((a, b) => a + b.count, 0);
    assert.equal(sum, pool.length, `${brand} 有机型没落进任何系列`);
    const vs = C.variantFacets(pool).reduce((a, b) => a + b.count, 0);
    assert.equal(vs, pool.length, `${brand} 有机型没落进任何变体`);
  }
});

check('华为系列直接用官网 line 字段（不被机型名规则污染）', () => {
  const hua = REAL_P.filter((p) => p.brand === 'huawei');
  for (const p of hua) {
    assert.equal(C.seriesOf(p), p.line, `${p.name} 系列应等于官网 line`);
  }
  const ids = C.seriesFacets(hua)
    .map((f) => f.id)
    .sort();
  assert.deepEqual(ids, ['Pocket', 'Pura', 'Mate', 'nova', '畅享'].sort());
});

// ── 芯片归一 ──

check('芯片归一合并同款不同写法（空格 / 规格括号）', () => {
  // 实测：麒麟 8000 与麒麟8000 是同款；麒麟9030 Pro（16 GB RAM 版本）是内存版本不是另一颗芯片。
  const a = pdoc({ chipset: { name: '麒麟 8000' } });
  const b = pdoc({ chipset: { name: '麒麟8000' } });
  assert.equal(C.chipName(a), C.chipName(b), '空格写法必须合并');
  const withVer = pdoc({ chipset: { name: '麒麟9030 Pro（16 GB RAM 版本）' } });
  assert.equal(C.chipName(withVer), '麒麟9030Pro', '去掉内存版本括号后与裸型号一致');
  assert.equal(
    C.chipName(pdoc({ chipset: { name: 'A18 芯片' } })),
    'A18',
    '「芯片」二字是描述词不是型号',
  );
});

check('芯片归一不得吃掉型号里的 Pro（麒麟9030Pro ≠ 麒麟9030）', () => {
  assert.notEqual(
    C.chipName(pdoc({ chipset: { name: '麒麟9030 Pro' } })),
    C.chipName(pdoc({ chipset: { name: '麒麟9030' } })),
    'Pro 是型号的一部分，去掉就变成两种芯片了',
  );
});

check('缺芯片名归到「未公布」而不是空串/消失', () => {
  assert.equal(C.chipName(pdoc({ chipset: null })), C.UNKNOWN);
  assert.equal(C.chipName(pdoc({ chipset: { name: '   ' } })), C.UNKNOWN);
});

check('官网并列写多颗芯片要被标出来（且不误伤单颗）', () => {
  // 官网把同系列不同批次并列写在一格里。第一版用「长度>8」判，把 ×5 的单颗
  // 麒麟9030Pro 也标成并列了；第二版用「去掉后缀后还有两个数字」判，A18 几乎全中。
  assert.equal(C.isMultiChip('麒麟9020A麒麟9020B'), true);
  assert.equal(C.isMultiChip('麒麟9050Pro麒麟9050'), true);
  for (const single of ['麒麟9030Pro', '麒麟9010S', 'A19Pro', '麒麟8000A', 'A18', 'A20Pro']) {
    assert.equal(C.isMultiChip(single), false, `${single} 是单颗，不该标为并列`);
  }
});

check('芯片显示名只补 Pro 接缝，不动型号尾字母', () => {
  assert.equal(C.chipNameLabel('麒麟9030Pro'), '麒麟9030 Pro');
  assert.equal(C.chipNameLabel('A19Pro'), 'A19 Pro');
  // 型号尾字母（S/A）**不补空格** —— 补了会把型号拆碎：
  // `麒麟9020A` → 「麒麟9020 A」读不通（这正是第二版踩的坑）
  assert.equal(C.chipNameLabel('麒麟9010S'), '麒麟9010S');
  assert.equal(C.chipNameLabel('麒麟8000A'), '麒麟8000A');
  // 并列写法两段型号都要完整
  const multi = C.chipNameLabel('麒麟9020A麒麟9020B');
  assert.ok(multi.includes('9020A') && multi.includes('9020B'), `并列写法被拆碎：${multi}`);
});

check('芯片分面计数之和等于台数（不能有芯片名重复计数或丢失）', () => {
  const sum = C.chipFacets(REAL_P).reduce((a, b) => a + b.count, 0);
  assert.equal(sum, REAL_P.length);
});

// ── 价格 / 三榜 ──

check('官方起售价取多容量档的最低档（问的是「多少钱起步」）', () => {
  const p = REAL_P.find((x) => x.name === 'iPhone 18 Pro');
  const prices = (p.skus ?? []).map((s) => s.priceCny).filter((v) => typeof v === 'number');
  assert.ok(prices.length > 1, '该机型应有多档容量');
  assert.equal(C.basePriceCny(p), Math.min(...prices));
});

check('缺价机型返回 null 而非 0（0 会被「最便宜」榜当成真价格）', () => {
  const p = REAL_P.find((x) => x.name === 'iPhone 17 Pro');
  assert.equal(
    (p.skus ?? []).every((s) => s.priceCny == null),
    true,
    '前置条件：确实缺价',
  );
  assert.equal(C.basePriceCny(p), null);
  assert.equal(C.fmtPriceCny(null), '官方未公布中国区售价');
});

check('三榜：最贵榜不出现缺价机型，且真的是有价里最贵', () => {
  for (const s of C.spotlights(REAL_P)) {
    if (!s.priciest) continue;
    const price = C.basePriceCny(s.priciest);
    assert.notEqual(price, null, `${s.priciest.name} 缺价却进了最贵榜`);
    const pool = REAL_P.filter((p) => C.categoryOf(p) === s.category.id)
      .map(C.basePriceCny)
      .filter((v) => v != null);
    assert.equal(price, Math.max(...pool), `${s.category.label}最贵榜选错`);
    assert.equal(C.basePriceCny(s.cheapest), Math.min(...pool), `${s.category.label}最便宜榜选错`);
  }
});

check('三榜：最新按发布日期倒序，不走 Date 解析', () => {
  const latest = C.spotlights(REAL_P).find((s) => s.category.id === 'phone').latest;
  for (const p of REAL_P) {
    if (C.categoryOf(p) !== 'phone') continue;
    assert.ok(p.releaseDate <= latest.releaseDate, `${p.name} 比「最新」还新`);
  }
});

// ── 全量筛选 ──

check('默认筛选 = 全量（不能少任何一台）', () => {
  assert.equal(F.applyFilter(REAL_P, F.emptyFilter()).length, REAL_P.length);
});

check('维度间取交集、同维度内取并集', () => {
  const both = F.applyFilter(REAL_P, { ...F.emptyFilter(), brand: ['apple', 'huawei'] });
  assert.equal(both.length, REAL_P.length, '同维度多选是「或」');
  const appleFold = F.applyFilter(REAL_P, {
    ...F.emptyFilter(),
    brand: ['apple'],
    form: ['foldable'],
  });
  assert.ok(
    appleFold.every((p) => p.brand === 'apple' && C.isFoldable(p)),
    '维度间是「与」',
  );
  // 台数从数据推导：苹果出折叠机那天这条不该假警报
  assert.equal(
    appleFold.length,
    REAL_P.filter((p) => p.brand === 'apple' && C.isFoldable(p)).length,
    '苹果折叠台数必须与筛选结果一致',
  );
});

check('缺数据机型可被筛出来（无芯片 / 无内存的机型不是隐形消失）', () => {
  // 不给「未公布」选项的话，筛「芯片=A19」后这些机型会人间蒸发且无处可寻。
  // 台数不钉数值（官网补全数据时会变），测的是自洽性：
  // 筛「未公布」的结果 == 数据里真正缺该项的机型，一台不差。
  const noChip = F.applyFilter(REAL_P, { ...F.emptyFilter(), chip: [C.UNKNOWN] });
  const chipFacet = F.facetOf(REAL_P, 'chip', REAL_P).find((c) => c.id === C.UNKNOWN);
  assert.ok(chipFacet, '芯片分面必须有「未公布」档位，否则缺数据的机型无处可寻');
  assert.equal(noChip.length, chipFacet.count, '筛「未公布芯片」的结果必须与分面计数一致');
  assert.ok(
    noChip.every((p) => !p.chipset?.name),
    '筛出来的必须真的没有芯片名',
  );
  const noRam = F.applyFilter(REAL_P, { ...F.emptyFilter(), ram: [C.UNKNOWN] });
  const ramFacet = F.facetOf(REAL_P, 'ram', REAL_P).find((c) => c.id === C.UNKNOWN);
  assert.ok(ramFacet, '内存分面必须有「未公布」档位');
  assert.equal(noRam.length, ramFacet.count, '筛「未公布内存」的结果必须与分面计数一致');
});

check('分面计数联动但选项枚举看全集（0 计数灰显保留，选中后仍能改主意）', () => {
  const fa = { ...F.emptyFilter(), brand: ['apple'] };
  const chips = F.facetOf(REAL_P, 'chip', F.applyExcept(REAL_P, fa, 'chip'));
  // 京东式：所有档位常驻，不兼容的 0 计数灰显 —— 华为芯片还在列表里但 count=0
  const qilin = chips.filter((c) => c.id.includes('麒麟'));
  assert.ok(qilin.length > 0, '选苹果后麒麟芯片必须仍出现在分面里（否则无法反悔）');
  assert.ok(
    qilin.every((c) => c.count === 0),
    '选苹果后麒麟芯片计数必须为 0（灰显依据）',
  );
  // 联动计数正确：苹果自己的芯片计数 = 苹果池内台数
  const a19 = chips.find((c) => c.id === 'A19Pro');
  assert.ok(a19 && a19.count > 0, '选苹果后 A19 Pro 必须还有计数');
  // 而品牌分面自身不受限制，两个品牌都还能看到
  const brands = F.facetOf(REAL_P, 'brand', F.applyExcept(REAL_P, fa, 'brand'), REAL_LABELS);
  assert.equal(brands.length, 2, '品牌分面不应被自己的选择收窄');
  assert.equal(
    brands.find((b) => b.id === 'huawei')?.count,
    REAL_P.filter((p) => p.brand === 'huawei').length,
    '华为分面计数必须与数据里的华为台数一致（曾写死 47，华为 49 台那天假警报）',
  );
});

check('反向测：选华为芯片后品牌分面仍含苹果（0 计数），维度不会整体消失', () => {
  // 曾经的真 bug：facetOf 枚举走 pool，选两个华为芯片后苹果从品牌分面蒸发，
  // FilterBar 的 dims 过滤（选项 >1 才显示）把品牌触发器整个藏掉 —— 用户没法反悔。
  const fa = { ...F.emptyFilter(), chip: ['麒麟9010S', '麒麟9030Pro'] };
  const brands = F.facetOf(REAL_P, 'brand', F.applyExcept(REAL_P, fa, 'brand'), REAL_LABELS);
  assert.equal(brands.length, 2, '品牌分面必须仍有两个品牌');
  const apple = brands.find((b) => b.id === 'apple');
  assert.ok(apple, '苹果必须还在品牌分面里');
  assert.equal(apple?.count, 0, '苹果计数应为 0（灰显不可点）');
  assert.equal(
    brands.find((b) => b.id === 'huawei')?.count,
    F.applyFilter(REAL_P, fa).length,
    '华为计数 = 芯片筛选后命中台数',
  );
});

check('各维度分面计数之和 = 该维度池内台数', () => {
  for (const d of DIMS) {
    const pool = F.applyExcept(REAL_P, F.emptyFilter(), d);
    const sum = F.facetOf(REAL_P, d, pool, REAL_LABELS).reduce((a, b) => a + b.count, 0);
    assert.equal(sum, pool.length, `${d} 分面计数之和与池内台数不符`);
  }
});

check('「未公布」分面项排在最后（它不是一个小数值）', () => {
  const chips = F.facetOf(REAL_P, 'chip', REAL_P);
  const last = chips[chips.length - 1];
  assert.equal(last.id, C.UNKNOWN, '「未公布」必须排最后，混在数字里会被误读成最小/最大');
  assert.equal(last.isUnknown, true, '要带 isUnknown 标记供页面标注');
  const ram = F.facetOf(REAL_P, 'ram', REAL_P);
  assert.equal(ram[ram.length - 1].id, C.UNKNOWN, '内存同理');
});

check('价格升序把缺价排末尾，不当成 0 元顶到榜首', () => {
  // 最阴的一条：把 null 当 0 排序，「官方未公布」会被渲染成「全站最便宜」。
  const asc = F.applySort(REAL_P, 'price-asc');
  const firstMissing = asc.findIndex((p) => C.basePriceCny(p) == null);
  if (firstMissing >= 0) {
    for (let i = firstMissing; i < asc.length; i++) {
      assert.equal(C.basePriceCny(asc[i]), null, `缺价机型 ${asc[i].name} 混进了价格区`);
    }
  }
  const desc = F.applySort(REAL_P, 'price-desc');
  const firstPriced = desc.findIndex((p) => C.basePriceCny(p) != null);
  if (firstPriced >= 0) {
    const lastPriced = desc.map((p) => C.basePriceCny(p) != null).lastIndexOf(true);
    assert.ok(firstPriced <= lastPriced, '降序时缺价应聚在末尾');
  }
});

check('四个能力维度排序：缺值同样排末尾', () => {
  for (const s of ['ppi-desc', 'weight-asc', 'battery-desc', 'camera-desc']) {
    const rows = F.applySort(REAL_P, s);
    const keys = rows.map((p) => {
      switch (s) {
        case 'ppi-desc':
          return p.display?.ppi ?? null;
        case 'weight-asc':
          return p.body?.weightG ?? null;
        case 'battery-desc':
          return p.battery?.capacityMah ?? null;
        default:
          return C.mainCameraMp?.(p) ?? null;
      }
    });
    const firstNull = keys.findIndex((v) => v == null);
    if (firstNull >= 0) {
      for (let i = firstNull; i < keys.length; i++) {
        assert.equal(keys[i], null, `${s}：缺值机型 ${rows[i].name} 混进了排序区`);
      }
    }
  }
});

check('排序键与榜单四条能力一一对应（榜单下钻能命中）', () => {
  for (const k of ['display', 'light', 'battery', 'camera']) {
    assert.ok(F.ABILITY_SORT[k], `${k} 缺排序映射，点「看全部」会跳到默认排序`);
    assert.ok(F.isSortKey(F.ABILITY_SORT[k]), `${k} 的排序键必须合法`);
  }
});

// ── 价格维度筛选（京东式价格段）──

check('priceBucket 分桶：边界与缺价正确', () => {
  const mk = (priceCny) => ({ skus: priceCny == null ? [] : [{ priceCny }] });
  assert.equal(C.priceBucket(mk(0)), C.UNKNOWN, '0 元不是有效价格，归未公布');
  assert.equal(C.priceBucket(mk(1)), '0-1999');
  assert.equal(C.priceBucket(mk(1999)), '0-1999');
  assert.equal(C.priceBucket(mk(2000)), '2000-2999');
  assert.equal(C.priceBucket(mk(7999)), '6000-7999');
  assert.equal(C.priceBucket(mk(8000)), '8000+');
  assert.equal(C.priceBucket(mk(99999)), '8000+');
  assert.equal(C.priceBucket({}), C.UNKNOWN, '缺价档必须归「未公布」');
});

check('筛选：选某价格档只保留该档机型（反向测价格维度真生效）', () => {
  // 若 applyFilter 把 price 维度忽略（回归），结果会混入其它档 → 断言失败。
  const priced = REAL_P.find((p) => C.basePriceCny(p) != null);
  assert.ok(priced, '数据集应有有价机型');
  const b = C.priceBucket(priced);
  const got = F.applyFilter(REAL_P, { ...F.emptyFilter(), price: [b] });
  assert.ok(got.length > 0 && got.length < REAL_P.length, '应减员且非空');
  for (const p of got) assert.equal(C.priceBucket(p), b, `${p.name} 不应出现在档 ${b}`);
});

check('筛选：选「未公布」价格档只含无价机型', () => {
  const got = F.applyFilter(REAL_P, { ...F.emptyFilter(), price: [C.UNKNOWN] });
  for (const p of got) assert.equal(C.priceBucket(p), C.UNKNOWN);
  assert.ok(
    got.every((p) => C.basePriceCny(p) == null),
    '有价机型混入说明价格维度失效',
  );
});

check('价格分面：金额升序、未公布排最后', () => {
  const items = F.facetOf(REAL_P, 'price', REAL_P);
  const ranks = items
    .filter((i) => i.id !== C.UNKNOWN)
    .map((i) => C.PRICE_BUCKETS.find((b) => b.id === i.id)?.min ?? -1);
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i - 1] <= ranks[i], '价格档应按金额升序');
  }
  assert.equal(items[items.length - 1].id, C.UNKNOWN, '未公布排最后');
});

check('URL 往返：价格档写读一致', () => {
  const f = { ...F.emptyFilter(), price: ['6000-7999'] };
  const back = F.readFilter(
    new URLSearchParams(F.writeFilter(f)),
    F.buildCatalog(REAL_P, DIMS, REAL_LABELS),
  );
  assert.deepEqual(back.filter.price, ['6000-7999']);
});

check('多级排序：一级决定大顺序，一级相等才看二级（榜单核心语义）', () => {
  // 优先「电池大→小」(battery-desc) 是一级，「相机高→低」(camera-desc) 是二级。
  const mk = (id, battery, camera, release = '2025-01-01') => ({
    id,
    name: id,
    releaseDate: release,
    skus: [{ priceCny: 1000 }],
    display: { ppi: 400 },
    body: { weightG: 200 },
    battery: { capacityMah: battery },
    camera: { rear: camera != null ? [{ role: 'main', mp: camera }] : [] },
  });
  const arr = [
    mk('a', 5000, 50, '2025-01-01'),
    mk('b', 5000, 80, '2025-02-01'), // 电池同 a，相机更高 → 二级决定 b 在 a 前
    mk('c', 6000, 10, '2025-03-01'), // 电池最大 → 排第一
    mk('d', 4000, 99, '2025-04-01'), // 电池最小，尽管相机最高 → 排最后
  ];
  const r = F.applyMultiSort(arr, ['battery-desc', 'camera-desc']);
  assert.deepEqual(
    r.map((p) => p.id),
    ['c', 'b', 'a', 'd'],
    '电池 c 第一；a/b 同电池，b 相机更高排前；d 电池最小垫底',
  );
});

check('多级排序的反向测：优先级顺序必须生效（一级能压过二级）', () => {
  // 与上一条同一批数据，但把相机提到一级、电池降到二级。
  // 若实现退化成「只按最后一级排序」或「各级平权」，这个断言会红 —— 正是要抓的 bug。
  const mk = (id, battery, camera, release = '2025-01-01') => ({
    id,
    name: id,
    releaseDate: release,
    skus: [{ priceCny: 1000 }],
    display: { ppi: 400 },
    body: { weightG: 200 },
    battery: { capacityMah: battery },
    camera: { rear: camera != null ? [{ role: 'main', mp: camera }] : [] },
  });
  const arr = [mk('a', 5000, 50), mk('b', 5000, 80), mk('c', 6000, 10), mk('d', 4000, 99)];
  const r = F.applyMultiSort(arr, ['camera-desc', 'battery-desc']);
  assert.deepEqual(
    r.map((p) => p.id),
    ['d', 'b', 'a', 'c'],
    '一级是相机：d(99) > b(80) > a(50) > c(10)，电池不再主导',
  );
});

check('多级排序：缺值一律排末尾（无论升/降序，且不因二级翻盘）', () => {
  const mk = (id, battery, camera) => ({
    id,
    name: id,
    releaseDate: '2025-01-01',
    skus: [{ priceCny: 1000 }],
    display: { ppi: 400 },
    body: { weightG: 200 },
    battery: { capacityMah: battery },
    camera: { rear: camera != null ? [{ role: 'main', mp: camera }] : [] },
  });
  const arr = [
    mk('g', null, null), // 两级都缺
    mk('h', null, 70), // 一级缺但二级有
    mk('i', 5000, 5), // 两级都有
  ];
  const r = F.applyMultiSort(arr, ['battery-desc', 'camera-desc']);
  assert.deepEqual(
    r.map((p) => p.id),
    ['i', 'h', 'g'],
    '有电池的 i 第一；h 一级缺排第二；g 两级都缺垫底',
  );
});

check('空排序链 = 默认按发布日期倒序', () => {
  const mk = (id, release) => ({
    id,
    name: id,
    releaseDate: release,
    skus: [{ priceCny: 1000 }],
    display: { ppi: 400 },
    body: { weightG: 200 },
    battery: { capacityMah: 5000 },
    camera: { rear: [{ role: 'main', mp: 50 }] },
  });
  const arr = [mk('x', '2025-01-01'), mk('y', '2025-03-01'), mk('z', '2025-02-01')];
  const r = F.applyMultiSort(arr, []);
  assert.deepEqual(
    r.map((p) => p.id),
    ['y', 'z', 'x'],
    '无排序键时按发布日期倒序兜底',
  );
});

check('URL 往返：写什么就读回什么（多级排序用逗号分隔的 o）', () => {
  const cat = F.buildCatalog(REAL_P, DIMS, REAL_LABELS);
  const want = {
    ...F.emptyFilter(),
    brand: ['apple'],
    series: ['标准'],
    chip: ['A19Pro'],
    year: ['2026'],
  };
  const back = F.readFilter(
    new URLSearchParams(F.writeFilter(want, ['battery-desc', 'camera-desc'])),
    cat,
  );
  assert.deepEqual(back.filter.brand, ['apple']);
  assert.deepEqual(back.filter.series, ['标准']);
  assert.deepEqual(back.filter.chip, ['A19Pro']);
  assert.deepEqual(back.filter.year, ['2026']);
  assert.deepEqual(back.sorts, ['battery-desc', 'camera-desc'], '排序优先级链要能经 URL 往返');
  // 默认态不写任何 query（URL 保持干净）
  assert.deepEqual(F.writeFilter(F.emptyFilter(), []), {}, '默认（无排序）不应写 o');
});

check('手改 URL 的非法值被丢弃（不产生永远 0 台的死条件）', () => {
  const cat = F.buildCatalog(REAL_P, DIMS, REAL_LABELS);
  const r = F.readFilter(new URLSearchParams('c=不存在的芯片&o=炸&a=平板'), cat);
  assert.deepEqual(r.filter.chip, [], '非法芯片应被丢弃');
  assert.deepEqual(r.sorts, [], '非法排序键被丢弃，回落为空（默认按发布日期）');
  assert.equal(r.filter.category.length, 0, '该品牌真实存在的品类才会被接受');
});

check('筛选 + 排序串联后结果一致（两者口径不能互相干扰）', () => {
  const f = { ...F.emptyFilter(), brand: ['apple'], variant: ['Pro Max'] };
  const rows = F.applySort(F.applyFilter(REAL_P, f), 'release');
  // 2026-10-15 iPhone 全代收录后：11/12/13/14/15/16/17/18 Pro Max 共 8 台
  assert.equal(rows.length, 8, '苹果 Pro Max 共 8 台');
  for (const p of rows) {
    assert.equal(C.seriesOf(p), '标准');
    assert.equal(C.variantOf(p), 'Pro Max');
  }
});

check('「未公布」筛选条件能经 URL 往返（否则分享链接会丢条件）', () => {
  // 反向测抓到的缺口：readFilter 按 valid 集过滤，手改代码把「未公布」排除掉时，
  // **没有任何用例报警** —— 因为原先只测了 applyFilter，没测 URL 往返。
  // 症状是「本页点未公布能筛出 19 台，但把链接发给别人就筛不出来了」。
  const cat = F.buildCatalog(REAL_P, DIMS, REAL_LABELS);
  const want = { ...F.emptyFilter(), chip: [C.UNKNOWN], ram: [C.UNKNOWN] };
  const qs = F.writeFilter(want);
  assert.ok(qs.c && qs.r, '缺数据条件必须写进 URL');
  const back = F.readFilter(new URLSearchParams(qs), cat);
  assert.deepEqual(back.filter.chip, [C.UNKNOWN], '芯片的「未公布」丢了');
  assert.deepEqual(back.filter.ram, [C.UNKNOWN], '内存的「未公布」丢了');
  assert.equal(
    F.applyFilter(REAL_P, back.filter).length,
    F.applyFilter(REAL_P, want).length,
    '往返前后筛出的台数必须一致',
  );
});

check('isFiltered 只认真实条件，不把排序当筛选', () => {
  const empty = F.emptyFilter();
  assert.equal(F.isFiltered(empty), false);
  assert.equal(F.activeCount(empty), 0);
  const one = F.toggleValue(empty, 'brand', 'apple');
  assert.equal(F.isFiltered(one), true);
  assert.equal(F.activeCount(one), 1);
  const off = F.toggleValue(one, 'brand', 'apple');
  assert.equal(F.isFiltered(off), false, '再点一次应取消');
});

check('品类是筛选条的第一个维度（用户 2026-10-05 明确要求置顶）', () => {
  assert.equal(F.DIMENSION_KEYS[0], 'category', '品类必须排第一');
});

check('形态是第二个维度，品类里已无折叠屏（用户 2026-10-06 纠正概念）', () => {
  assert.equal(F.DIMENSION_KEYS[1], 'form', '形态必须紧跟品类');
  assert.ok(F.DIMENSION_KEYS.includes('category') && F.DIMENSION_KEYS.includes('form'));
  const catFacets = F.facetOf(REAL_P, 'category', REAL_P);
  // 2026-10-15 六品类扩充：品类分面不再只有 phone，但**顺序必须与 CATEGORY_ORDER 一致**
  // 且折叠机永远落在 phone 池内（折叠屏是形态不是品类）。
  const catIds = catFacets.map((f) => f.id);
  const expected = C.CATEGORY_ORDER.map((c) => c.id).filter((id) => catIds.includes(id));
  assert.deepEqual(catIds, expected, '品类分面顺序必须与注册表一致，且不得出现注册表外的品类');
  const foldablePool = REAL_P.filter(C.isFoldable);
  assert.ok(
    foldablePool.every((p) => C.categoryOf(p) === 'phone'),
    '折叠屏必须全部落在 phone 品类里',
  );
  const formFacets = F.facetOf(REAL_P, 'form', REAL_P);
  // 顺序与标签钉死（折叠屏在前），台数从数据推导 —— 曾写死 7/53，
  // 华为入库两台直板机那天 deepEqual 整体失败，而性质毫无问题。
  assert.deepEqual(
    formFacets.map((f) => [f.id, f.label]),
    [
      ['foldable', '折叠屏'],
      ['bar', '直板'],
    ],
    '形态分面 = 折叠屏 + 直板两类，折叠屏在前',
  );
  const realFold = REAL_P.filter(C.isFoldable).length;
  assert.deepEqual(
    formFacets.map((f) => f.count),
    [realFold, REAL_P.length - realFold],
    '形态分面计数必须与数据一致',
  );
});

check('形态条件经 URL 往返（参数 m）', () => {
  const cat = F.buildCatalog(REAL_P, F.DIMENSION_KEYS);
  const want = { ...F.emptyFilter(), form: ['foldable'] };
  const back = F.readFilter(new URLSearchParams(F.writeFilter(want)), cat);
  assert.deepEqual(back.filter.form, ['foldable'], '形态条件必须能从 URL 完整读回');
});

/* ================================================================ *
 * 13. 原始响应归档（data/raw/）
 * ----------------------------------------------------------------
 * 归档件存在的唯一理由：解析器改坏之后能喂同一份官网原文离线复现。
 * 所以它的形状纪律与 products.json 不同 —— **不要往里塞运行时刻字段**。
 *
 * 最危险的坑：fetchedAt / extractedAt 一进归档，每轮归档都不同 →
 * CI 每 12 小时一次空提交（本项目已因此踩过两次，见 fingerprint.mjs 的注释）。
 * ================================================================ */
section('原始响应归档');

const RAW_ARCHIVE_DIR = join(ROOT, 'data/raw');

check('归档件若存在，必须不含运行时刻字段（否则造成空提交）', () => {
  if (!existsSync(RAW_ARCHIVE_DIR)) return; // 还没跑过取数
  const files = readdirSync(RAW_ARCHIVE_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const a = JSON.parse(readFileSync(join(RAW_ARCHIVE_DIR, f), 'utf8'));
    const bad = ARCHIVE_VOLATILE_FIELDS.filter((k) => JSON.stringify(a).includes(`"${k}"`));
    assert.deepEqual(bad, [], `${f} 含运行时刻字段 ${bad.join(',')} —— 每轮归档都不同会造成空提交`);
  }
});

check('归档件的形状只保留回放必需的字段（不多不少，按渠道）', () => {
  if (!existsSync(RAW_ARCHIVE_DIR)) return;
  const files = readdirSync(RAW_ARCHIVE_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'data/raw/ 存在却没有任何归档件 —— 孤儿目录应被清理');
  for (const f of files) {
    const a = JSON.parse(readFileSync(join(RAW_ARCHIVE_DIR, f), 'utf8'));
    // 顶层只允许这三个键 —— 多出来的说明有人往里塞了不该塞的东西
    assert.deepEqual(
      Object.keys(a).sort(),
      ARCHIVE_TOP_FIELDS,
      `${f} 顶层键应恰好是 ${ARCHIVE_TOP_FIELDS.join('/')}，多出来的都会造成版本库噪声或空提交`,
    );
    // 形状按渠道断言：规格通道是 id/name/raw/specsUrl，价格通道是另一套 14 字段
    // （startPriceCny/pricesByStorage/evidence…，没有 specsUrl/raw）。
    // 曾用一套模子套所有渠道：价格通道 7/7 台被 JSON.stringify 剥得只剩 id/name，
    // 价格原文全丢而归档目录看着正常 —— 2026-10-12 第一次提交 data/raw/ 时现形。
    // 期望字段从 lib/archive-shape.mjs 引（生成器与判据的唯一真源）。
    const shape = shapeOfArchive(f);
    const expect = productFields(shape);
    for (const p of a.products) {
      assert.deepEqual(
        Object.keys(p).sort(),
        expect,
        `${f}（${shape} 渠道）: ${p.id} 的键应恰好是 ${expect.join('/')}`,
      );
      // raw 的值必须是页面原文（字符串），不是换算后的数字 —— 换算是规范化层的职责。
      // 这里判字符串而不只是判真值：数字 6.9 与字符串「6.9 英寸」都能通过真值检查，
      // 但后者才是原文；数字进归档等于把换算结果当成了输入，破坏回放的意义。
      // 价格渠道没有 raw 键（它的原文是价格字段），不适用这条。
      if (shape !== 'spec') continue;
      for (const [k, v] of Object.entries(p.raw)) {
        assert.equal(
          typeof v,
          'string',
          `${f}: ${p.id}.raw['${k}'] 必须是页面原文字符串，不是 ${typeof v}`,
        );
      }
    }
  }
});

check('归档体积在闸门内（超了会让版本库不可逆地膨胀）', () => {
  if (!existsSync(RAW_ARCHIVE_DIR)) return;
  let total = 0;
  for (const f of readdirSync(RAW_ARCHIVE_DIR)) {
    total += statSync(join(RAW_ARCHIVE_DIR, f)).size;
  }
  assert.ok(
    total < 4 * 1024 * 1024,
    `data/raw/ 共 ${(total / 1024 / 1024).toFixed(2)} MB，超过 4 MB 闸门 —— 确认是否该改为「只归档字段名清单」`,
  );
});

check('反向测：归档通道若漏一个，检查必须报出（否则「改了版却以为没改」会静默）', () => {
  // 造一个「归档里字段被改名」的形状，确认形状检查能区分改版前后。
  // 不去真改 data/raw/（那是真数据），只验判据本身能区分两个不同形状。
  const before = {
    source: 'x',
    products: [{ id: 'a', name: 'A', specsUrl: 'u', raw: { '电池.容量': '6600 mAh' } }],
    skipped: [],
  };
  const after = {
    source: 'x',
    products: [{ id: 'a', name: 'A', specsUrl: 'u', raw: { '电池.容量新写法': '6600 mAh' } }],
    skipped: [],
  };
  assert.notEqual(
    JSON.stringify(before),
    JSON.stringify(after),
    '官网把章节改名后，归档内容必须不同 —— 否则 --check 永远绿灯，改版无人发现',
  );
});

/* ================================================================ *
 * 15. 路由可达性（防孤儿页）
 * ----------------------------------------------------------------
 * 孤儿页 = 有路由、能打开，但没有任何导航链接能到达。
 * 搜索引擎能进来，用户走不进来 —— 且**零报错**，
 * 冒烟脚本也抓不到（它们只测「已知入口还能用」，不测「有没有漏掉的入口」）。
 *
 * 2026-10-06 把「关于」从主导航移到页脚时就差点造出一个，靠这条断言拦住。
 * ================================================================ */
section('路由可达性（防孤儿页）');

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

check('每个静态路由都必须有站内链接指向它（孤儿页零报错）', () => {
  const vueSrc = allVueSource(SRC_DIR);
  const routerSrc = readFileSync(join(SRC_DIR, 'router/index.ts'), 'utf8');
  const routes = [...routerSrc.matchAll(/path:\s*'([^']+)',\s*name:\s*'([^']+)'/g)].map((m) => ({
    path: m[1],
    name: m[2],
  }));
  const staticRoutes = routes.filter((r) => !r.path.includes('pathMatch') && !r.path.includes(':'));
  assert.ok(
    staticRoutes.length >= 6,
    `解析到的静态路由只有 ${staticRoutes.length} 条，正则可能失效了`,
  );

  const orphans = [];
  for (const r of staticRoutes) {
    const sub = r.path.replace(/^\//, '');
    // 同时识别模板属性写法 `to="/x"` 与脚本对象写法 `to: '/x'`（AppTopNav 的 links 数组用后者），
    // 否则导航里确有链接、却被判成孤儿页的误报。
    const byPath =
      vueSrc.includes(`to="/${sub}"`) ||
      vueSrc.includes(`to: '/${sub}'`) ||
      vueSrc.includes(`to: "${sub}"`) ||
      vueSrc.includes(`path: '${r.path}'`);
    const byName = new RegExp(`['"\`]${r.name}['"\`]`).test(vueSrc);
    if (!byPath && !byName) orphans.push(`${r.name}(${r.path})`);
  }
  assert.deepEqual(
    orphans,
    [],
    `孤儿页：${orphans.join('、')} 有路由能打开，但没有任何导航链接能到 —— 用户只能手输 URL`,
  );
});





/* ================================================================ *
 * v2 全品类目录：specs 容器 / 品类 schema / 用户数据层
 *
 * 这一节守的是 2026-10-13 全品类改造的三个新机制。它们共同的结构性风险是
 * **「静默写错」**：字段路径拼错、值类型漂移、override 引用悬空——全部不报错，
 * 只是让某个值安静地失效。所以每个机制都配反向测（注入违规必须报出）。
 * ================================================================ */
section('v2 全品类目录：specs 容器');

check('flattenSpecs → expandSpecs 往返相等（拍平不丢字段）', () => {
  // 往返是「拍平没丢字段」的唯一硬证据。少一个键，前端那个参数就恒为「未公布」。
  const v1 = {
    id: 'x',
    brand: 'apple',
    body: { weightG: 199, colors: ['黑'], folded: null },
    display: { sizeIn: 6.3, resolutionPx: { w: 1206, h: 2622 }, refreshHz: '1-120' },
    chipset: { name: 'A19', processNm: null },
    memory: { ramGb: [8], storageGb: [256, 512] },
    battery: { capacityMah: 4500, capacityCaliber: 'typical' },
    camera: { rear: [{ role: 'main', mp: 48 }], front: { mp: 12 } },
    connectivity: { fiveG: true, esim: null },
    os: { launch: 'iOS 26', upgradableTo: null },
  };
  const specs = flattenSpecs(v1);
  assert.equal(specs['body.weightG'], 199);
  assert.equal(specs['display.sizeIn'], 6.3);
  assert.deepEqual(specs['display.resolutionPx'], { w: 1206, h: 2622 }, '对象值整体存，不拆叶子');
  assert.deepEqual(specs['memory.storageGb'], [256, 512], '数组值整体存');
  assert.equal(specs['camera.rear'].length, 1);
  assert.equal(specs['chipset.processNm'], null, 'null 是「未公布」的正确状态，照样搬');
  assert.ok(!('body' in v1) === false, '拍平不改原对象');
  const back = expandSpecs(specs);
  for (const g of [
    'body',
    'display',
    'chipset',
    'memory',
    'battery',
    'camera',
    'connectivity',
    'os',
  ]) {
    assert.deepEqual(back[g], v1[g], `组 ${g} 往返后不一致`);
  }
});

check('pick specs-first：v2 读容器，v1 回退嵌套（迁移期双兼容）', () => {
  // 只读 specs 会让迁移后第一轮的覆盖率对比跌到 0 触发拒写；只读嵌套则用户修正永远不生效。
  const v2 = { id: 'a', specs: { 'display.sizeIn': 6.9 }, display: { sizeIn: 6.1 } };
  const v1 = { id: 'b', display: { sizeIn: 6.1 } };
  assert.equal(pick(v2, 'display.sizeIn'), 6.9, 'specs 优先——用户修正必须赢过嵌套旧值');
  assert.equal(pick(v1, 'display.sizeIn'), 6.1, 'v1 回退嵌套');
  assert.equal(pick(v1, 'display.ppi'), undefined, '两处都没有就是 undefined（不是 0）');
  const p = { id: 'c', specs: {} };
  setSpec(p, 'body.weightG', 199);
  assert.equal(pick(p, 'body.weightG'), 199);
});

check('真实快照的 specs 键全部在**其品类** schema 注册（防手改数据绕过管线）', () => {
  // 管线有闸门拦未注册键，但直接手改 products.json 不过管线。这条断言让
  // 「schema 漏登记」与「数据里多出幽灵键」两种漂移都在自测层现形。
  // 2026-10-15 六品类：按产品品类查各自 schema（battery.capacityWh 只在 tablet 注册）。
  if (!existsSync(join(ROOT, 'data/products.json'))) return;
  const snap = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
  for (const p of snap.products ?? []) {
    const schema = loadSchema(p.category ?? 'phone');
    assert.ok(schema, `${p.id} 的品类 ${p.category} 必须有 schema`);
    const fields = fieldMap(schema);
    for (const path of Object.keys(p.specs ?? {})) {
      assert.ok(
        fields.has(path),
        `${p.id} 的 specs 键 "${path}" 未在 ${p.category ?? 'phone'} schema 注册`,
      );
    }
  }
  // 反向：schema 声明的每个字段至少要在一台真实机器上出现过（死字段 = 契约腐烂）
  // 例外：rawOfficial 原文里没有、契约预留的字段允许零覆盖（如 measuredHours）。
  // 2026-10-13 新增 haptic.motor / audio.speakers（用户要求马达/扬声器进比较）：
  // 官网原文待解析器接入或人工补录（用户纠错链路），落数据前允许零覆盖。
  const PREVIEW_ONLY = new Set([
    'battery.measuredHours',
    'display.protection',
    'haptic.motor',
    'audio.speakers',
  ]);
  const seen = new Set();
  for (const p of snap.products ?? []) for (const k of Object.keys(p.specs ?? {})) seen.add(k);
  // 反向（死字段检测）仍按 phone schema：phone 是最完整、历史最长的字段表
  const phoneSchema = loadSchema('phone');
  assert.ok(phoneSchema, 'phone schema 必须可加载');
  for (const f of phoneSchema.fields) {
    if (PREVIEW_ONLY.has(f.path)) continue;
    assert.ok(seen.has(f.path), `schema 字段 ${f.path} 在真实数据里零出现（死字段或拼错）`);
  }
});

/* 前端目录模块：对账断言用。必须在 check() 之前加载完——
 * check 的 runner 是同步 try/catch，async 用例的断言失败会变成未捕获 rejection，
 * 用例永远显示通过（比没写测试更糟）。所以这里顶层 await import，check 里只放同步回调。 */
const CAT = await import('../src/lib/catalog.ts');
const FIELDS_LIB = await import('../src/lib/fields.ts');
const SPECS_LIB = await import('../src/lib/specs.ts');
const FACETS_LIB = await import('../src/lib/facets.ts');
const CMP = await import('../src/lib/compare.ts');

/* 渲染对账闸门（2026-10-13 首建，同日升级为视图字典版）：specGroups 已重构为
 * 「全声明式视图字典 + 泛化引擎」（data/view-phone.json），新字段默认自动出现。
 * 本闸门升级为**双向对账**，豁免从硬编码 EXEMPT 变成视图字典的 hidden 数据：
 * ① 正向：每个 schema 字段要么被视图引用、要么在 view.hidden（哨兵值实测、走与前端同一条链）；
 * ② 反向：视图字典引用的每个 path 必须已在 schema 注册（视图也是数据，拼错也要被拦）。 */
check('渲染对账（视图字典版）：schema↔视图双向对账（防页面静默丢字段/防视图拼错）', () => {
  const schema = loadSchema('phone');
  const fields = [...fieldMap(schema).values()];
  const view = JSON.parse(readFileSync(join(ROOT, 'data', 'view-phone.json'), 'utf8'));
  const referenced = new Set();
  for (const g of view.groups) {
    for (const r of g.rows) {
      for (const p of r.fields ?? []) referenced.add(p);
      if (r.field) referenced.add(r.field);
      if (r.expand) referenced.add(r.expand);
    }
  }
  const hidden = new Set(view.hidden ?? []);
  const byPath = new Map(schema.fields.map((f) => [f.path, f]));
  /*
   * 视图字典给某些行配了**专用格式化器**（resolution / bands / dimensions…），
   * 通用 object 哨兵 `{w,h}` 对它们不生效 —— bands 只认制式分组键，喂 `{w:1,h:2}`
   * 会渲染成「—」，闸门于是误报「字段没上页面」，而下意识的处理又是「塞进 hidden」。
   * 所以哨兵要按该行声明的 format 定制：格式化器认什么键，就往什么键里塞哨兵。
   */
  const fmtByPath = new Map();
  for (const g of view.groups) {
    for (const r of g.rows) {
      if (!r.format) continue;
      for (const p of r.fields ?? (r.field ? [r.field] : [])) fmtByPath.set(p, r.format);
    }
  }

  // ② 反向：视图引用必须已注册
  for (const p of referenced) {
    assert.ok(
      byPath.has(p),
      `视图字典 data/view-phone.json 引用了未注册字段 "${p}"——要么拼错了，要么先在 schema 注册`,
    );
  }

  // ① 正向：哨兵实测。每字段塞**全局唯一**哨兵值（number 走 i*10 步进，object 的 h 用 +1
  // 避让下一个字段），在引擎渲染输出文本里找哨兵——比按 label 找可靠（合并行）。
  const specs = {};
  const token = new Map();
  fields.forEach((f, i) => {
    const n = 100000 + i * 10;
    let v;
    let t;
    if (f.type === 'number') {
      v = n;
      t = String(n);
    } else if (f.type === 'array:number') {
      v = [n];
      t = String(n);
    } else if (f.type === 'string') {
      v = `ZQ${i}ZQ`;
      t = v;
    } else if (f.type === 'array:string') {
      v = [`ZQ${i}ZQ`];
      t = `ZQ${i}ZQ`;
    } else if (f.type === 'object') {
      v =
        fmtByPath.get(f.path) === 'bands'
          ? { nrFdd: [`n${n}`], nrTdd: [], lteFdd: [], lteTdd: [], umts: [], gsm: [] }
          : { w: n, h: n + 1 };
      t = String(n);
    } else if (f.type === 'array:object') {
      v = [{ role: 'main', mp: n, aperture: 'f/1.6', ois: true }];
      t = String(n);
    } else {
      // boolean 哨兵 'true' 无唯一性——当前 schema 的 boolean 字段全部在 view.hidden；
      // 新增非 hidden 的 boolean 字段时必须让它渲染成可唯一识别，否则闸门对它失明。
      v = true;
      t = 'true';
    }
    specs[f.path] = v;
    token.set(f.path, t);
  });
  const rendered = FIELDS_LIB.specGroups({ id: 'selftest-render-gate', category: 'phone', specs })
    .map((g) => g.rows.map((r) => r.value).join('\n'))
    .join('\n');
  const boolFields = [];
  for (const f of fields) {
    if (hidden.has(f.path)) continue;
    // boolean 走下面的专用判据（哨兵 'true' 对它不成立）
    if (f.type === 'boolean') {
      boolFields.push(f);
      continue;
    }
    assert.ok(
      rendered.includes(token.get(f.path)),
      `schema 字段 ${f.path}（${f.label}）既未被视图字典引用、也未列入 view.hidden` +
        `——详情页/对比台会静默不显示；请在 data/view-phone.json 加行（或加入 hidden 豁免）`,
    );
  }

  /*
   * ② boolean 专用判据（2026-10-14 补，原闸门对它失明）。
   * boolean 的哨兵 true 被渲染成「有」而不是字面 'true'，`rendered.includes('true')`
   * **恒为 false** —— 只要出现一个非 hidden 的 boolean 字段（本次新增的 irBlaster 就是），
   * 闸门立刻误报，而误报的下一步通常是「把它塞进 hidden 了事」，
   * 于是这个字段真的永远不上页面，闸门还显示绿灯。
   * 改成：只给这一个字段置 true（其余字段全部缺省），渲染结果里必须**有行不是「—」**。
   * 唯一性来自「全场只有一个字段有值」，与「有/无」的本地化文案无关。
   *
   * ⚠️ 诚实的边界：本条**抓不到**「视图字典没引用该字段」—— 自动补挂会把未引用的字段
   * 照样渲染出来（实测：摘掉 view-phone.json 里 irBlaster 那行，本条仍全绿）。
   * 它真正守的是「boolean 必须渲染成非「—」」这件事，即 defaultFormat 的 boolean 分支
   * 没被改坏：把那个分支改成恒返回「—」，本条立刻报红（反向测做过）。
   */
  for (const f of boolFields) {
    const rows = FIELDS_LIB.specGroups({
      id: 'selftest-render-gate',
      category: 'phone',
      specs: { [f.path]: true },
    }).flatMap((g) => g.rows.map((r) => r.value));
    const shown = rows.filter((v) => v && v !== '—');
    assert.ok(
      shown.length >= 1,
      `schema 字段 ${f.path}（${f.label}）置 true 后页面没有任何一行显示它` +
        `——请在 data/view-phone.json 加行（或加入 hidden 豁免）`,
    );
  }
});

/* ── 硬编码审计 A1 治理（2026-10-13）：榜单/能力字段表与 schema 对账 ──
 * 此前「能力/榜单字段」存在三份定义：schema(dir/quantifiable 权威)、derive.mjs METRICS(后端
 * 榜单)、specs.ts ABILITIES(前端能力条)，改 schema 时后两份静默漂移且无闸门。以下两条把
 * 同步要求变成机器闸门：path 必须已注册；schema.dir 非空时方向语义必须一致。 */

check('derive.mjs METRICS 与 phone schema 对账（path 已注册、dir 语义一致）', () => {
  const schema = loadSchema('phone');
  const byPath = new Map(schema.fields.map((f) => [f.path, f]));
  for (const [key, m] of Object.entries(DERIVE.METRICS)) {
    // 身份/SKU 派生指标不走 specs 字段表（skus/releaseDate 是顶层结构）
    if (m.path === 'skus' || m.path === 'releaseDate') continue;
    const f = byPath.get(m.path);
    assert.ok(
      f,
      `METRICS.${key} 的 path "${m.path}" 未在 schema 注册——榜单会静默使用旧字段（审计 A1）`,
    );
    if (f && f.dir != null) {
      assert.equal(
        m.dir,
        f.dir,
        `METRICS.${key}.dir(${m.dir}) 与 schema.dir(${f.dir}) 不一致——方向真源是 schema`,
      );
    }
    // schema.dir 为 null 的数组派生指标（如 storageMaxGb 取 max(storageGb)）允许指标层
    // 显式自declared 方向——豁免理由：数组字段本身不可排序，派生值才有方向。
  }
});

check('specs.ts ABILITIES 与 phone schema 对账（字段已注册、higherBetter ≡ dir）', () => {
  const schema = loadSchema('phone');
  const byPath = new Map(schema.fields.map((f) => [f.path, f]));
  // 能力条消费的字段映射——specs.ts rawFor 改字段时必须同步此表（显性化，测试即文档）
  const ABILITY_PATHS = {
    display: 'display.ppi',
    light: 'body.weightG',
    battery: 'battery.capacityMah',
    camera: 'camera.rear',
  };
  for (const a of SPECS_LIB.ABILITIES) {
    const path = ABILITY_PATHS[a.key];
    assert.ok(path, `ABILITIES 出现未知能力 key：${a.key}（需在 selftest 对账表登记）`);
    const f = byPath.get(path);
    assert.ok(f, `ABILITIES.${a.key} 的字段 ${path} 未在 schema 注册（审计 A1）`);
    if (f && f.dir != null) {
      assert.equal(
        a.higherBetter,
        f.dir === 'high',
        `ABILITIES.${a.key}.higherBetter(${a.higherBetter}) 与 schema.dir(${f.dir}) 不一致——方向真源是 schema`,
      );
    }
    // camera.rear 是数组（dir=null，主摄 MP 派生），与 METRICS.storageMaxGb 同一豁免逻辑
  }
});

check('后台录入页在 admin/ 而非 public/（Q1：不随 dist 发布到线上）', () => {
  // 2026-10-13 审计 Q1 裁决 B：overrides-editor.html 从 public/ 移至 admin/，
  // 由 editor-server 直读。public/ 会被 vite 原样拷进 dist —— 放回去等于把管理后台
  // 界面发布到 GitHub Pages / Toy 上（无后端写不进去，但界面与字段结构暴露）。
  // 本条守「源」：有人挪回 public/ 时在最快的一道闸门红掉；
  // verify-dist 的「dist 非入口 HTML」闸门守「产物」，两道互补。
  assert.ok(
    existsSync(join(ROOT, 'admin/overrides-editor.html')),
    'admin/overrides-editor.html 应存在（editor-server 从那里读）',
  );
  assert.ok(
    !existsSync(join(ROOT, 'public/overrides-editor.html')),
    'public/ 下不得有 overrides-editor.html——会被 vite 拷进 dist 发布到线上',
  );
});

check('editor.html 值校验类型集与 schema 弱对账（零构建拷贝的看守）', () => {
  // 硬编码审计 A3：editor.html 无法 import 共享校验模块（零构建），保留手工拷贝。
  // 本测试看守「类型集」不漂移：schema 出现新 type 而拷贝没跟 → default 分支静默放行 → 红。
  const html = readFileSync(join(ROOT, 'admin/overrides-editor.html'), 'utf8');
  const cases = new Set([...html.matchAll(/case '([a-z:]+)':/g)].map((m) => m[1]));
  const schema = loadSchema('phone');
  for (const f of schema.fields) {
    assert.ok(
      cases.has(f.type),
      `schema 类型 "${f.type}"（${f.path}）在 overrides-editor.html 的 validateValue 里没有 case 分支` +
        `——类型系统演进后该页会对它静默走 default，请同步手工拷贝`,
    );
  }
});

/* ── 硬编码审计 P2 治理（2026-10-13）：策展表外置对账 ──
 * 变体/系列/多芯/价格档已从 catalog.ts 搬进 data/curated/facets.json（数据化策展）。
 * 数据也要被闸门管：结构合法性 + 哨兵语义（「Pro Max 在 Pro 前」的长后缀优先即反向测）+
 * 真实数据冒烟。加变体/调价格档/接新品牌 = 改 JSON，闸门在此确保改不坏。 */

check('策展字典结构合法（id 唯一/正则可编译/长后缀优先/价格档升序衔接）', () => {
  const dict = JSON.parse(readFileSync(join(ROOT, 'data', 'curated', 'facets.json'), 'utf8'));
  const vIds = new Set();
  const vLabels = new Set();
  for (const v of dict.variants) {
    assert.ok(!vIds.has(v.id), `变体 id 重复：${v.id}`);
    assert.ok(!vLabels.has(v.label), `变体 label 重复：${v.label}`);
    vIds.add(v.id);
    vLabels.add(v.label);
    assert.doesNotThrow(
      () => new RegExp(v.match, v.flags ?? ''),
      `变体 ${v.id} 的 match 不是合法正则`,
    );
  }
  const idxPro = dict.variants.findIndex((v) => v.id === 'pro');
  const idxProMax = dict.variants.findIndex((v) => v.id === 'pro-max');
  assert.ok(
    idxPro >= 0 && idxProMax >= 0 && idxProMax < idxPro,
    'Pro Max 必须排在 Pro 之前（长后缀优先，否则分面计数少一台）',
  );
  for (const [brand, cfg] of Object.entries(dict.series.brands ?? {})) {
    assert.ok(cfg.series.length >= 1, `${brand} 系列表不能为空`);
    assert.ok(
      cfg.series.some((s) => s.fallback),
      `${brand} 系列表必须有 fallback 行（兜底「标准」）`,
    );
    for (const s of cfg.series) {
      if (s.fallback) continue;
      assert.doesNotThrow(
        () => new RegExp(s.match ?? '', s.flags ?? ''),
        `${brand} 系列规则「${s.label}」正则非法`,
      );
    }
  }
  const bIds = new Set();
  dict.priceBuckets.forEach((b, i) => {
    assert.ok(!bIds.has(b.id), `价格档 id 重复：${b.id}`);
    bIds.add(b.id);
    assert.ok(typeof b.min === 'number' && b.min >= 0, `价格档 ${b.id} 的 min 非法`);
    const last = i === dict.priceBuckets.length - 1;
    if (last) assert.ok(b.max === null, `最后一条价格档 ${b.id} 的 max 应为 null（无穷）`);
    else {
      assert.ok(typeof b.max === 'number' && b.max >= b.min, `价格档 ${b.id} 的 max 非法`);
      if (i > 0) {
        assert.ok(
          b.min === dict.priceBuckets[i - 1].max + 1,
          `价格档 ${b.id} 与上一档不衔接（会有价格静默落错档）`,
        );
      }
    }
  });
});

check('策展字典哨兵语义（变体长后缀优先/系列策略/多芯判据/价格档）', () => {
  const fake = (brand, name) => ({
    id: 't',
    brand,
    name,
    line: brand === 'apple' ? 'iPhone' : name.split(' ')[0],
    category: 'phone',
  });
  // 变体：长后缀优先——顺序被人调换时这些断言全红（反向测）
  assert.equal(CAT.variantOf(fake('apple', 'iPhone 18 Pro Max')), 'Pro Max');
  assert.equal(CAT.variantOf(fake('apple', 'iPhone 18 Pro')), 'Pro');
  assert.equal(CAT.variantOf(fake('apple', 'iPhone 18')), '标准');
  assert.equal(CAT.variantOf(fake('apple', 'iPhone 18 Plus')), 'Plus');
  assert.equal(CAT.variantOf(fake('huawei', 'Mate 80 RS')), 'RS');
  assert.equal(CAT.variantOf(fake('huawei', 'nova 14 Ultra')), 'Ultra');
  assert.equal(CAT.variantOf(fake('huawei', 'nova 14 优享版')), '优享版');
  assert.equal(CAT.variantOf(fake('huawei', '畅享 70 风驰版')), '风驰版');
  // 苹果系列（from:'name' 策略）
  assert.equal(CAT.seriesOf(fake('apple', 'iPhone Duo')), '折叠屏');
  assert.equal(CAT.seriesOf(fake('apple', 'iPhone Air')), 'Air');
  assert.equal(CAT.seriesOf(fake('apple', 'iPhone 17e')), 'SE');
  assert.equal(CAT.seriesOf(fake('apple', 'iPhone 18 Pro Max')), '标准'); // Pro Max 是变体不是系列
  assert.equal(CAT.seriesOf(fake('huawei', 'nova 14')), 'nova'); // 未配置品牌走 default:'line'
  // foldVariant：形态即变体
  assert.equal(CAT.variantOf(fake('apple', 'iPhone Duo')), '折叠双屏');
  // 多芯判据（前缀出现两次）
  assert.equal(CAT.isMultiChip('麒麟9020A麒麟9020B'), true);
  assert.equal(CAT.isMultiChip('麒麟9030Pro'), false);
  assert.equal(CAT.isMultiChip('A18A19'), true);
  assert.equal(CAT.isMultiChip('A18Pro'), false);
  assert.equal(CAT.isMultiChip('天玑9400天玑9300'), true);
  assert.equal(CAT.isMultiChip('A18'), false);
  // 价格档
  const withPrice = (v) => ({ skus: [{ priceCny: v }] });
  assert.equal(CAT.priceBucket(withPrice(599)), '0-1999');
  assert.equal(CAT.priceBucket(withPrice(1999)), '0-1999');
  assert.equal(CAT.priceBucket(withPrice(2000)), '2000-2999');
  assert.equal(CAT.priceBucket(withPrice(15000)), '8000+');
  assert.equal(CAT.priceBucket({ skus: [] }), CAT.UNKNOWN); // 缺价不编造
});

check('策展字典真实数据冒烟（62 台变体/系列解析 + 已知机型抽查）', () => {
  if (!Array.isArray(REAL_P) || !REAL_P.length) return;
  for (const p of REAL_P) {
    const v = CAT.variantOf(p);
    const s = CAT.seriesOf(p);
    assert.ok(v && s, `${p.id} 变体/系列解析为空`);
  }
  const proMax = REAL_P.find((p) => p.id === 'apple-iphone-17-pro-max');
  if (proMax) assert.equal(CAT.variantOf(proMax), 'Pro Max');
  const pro = REAL_P.find((p) => p.id === 'huawei-mate70-pro');
  if (pro) assert.equal(CAT.variantOf(pro), 'Pro');
});

check('多实例子字典深校验（camera.rear：mp 越界/role 拼错/多余键 → 拦）', () => {
  // 最优解「两处结构升级」②：array:object 不再是无底洞——每项按子字典逐键校验。
  const schema = loadSchema('phone');
  const rear = (items) => ({ id: 't', specs: { 'camera.rear': items } });
  // 正测：现有形态全合法（ois/sensorNote 等缺失 = null 语义）
  assert.deepEqual(
    validateSpecs(
      rear([{ role: 'main', mp: 48, aperture: 'f/1.6', ois: true, sensorNote: null }]),
      schema,
    ),
    [],
  );
  assert.deepEqual(validateSpecs(rear([{ role: 'main' }]), schema), []);
  // 反测 ×3：数值越界 / 枚举拼错 / 多余键
  const over = validateSpecs(rear([{ role: 'main', mp: 999 }]), schema);
  assert.ok(
    over.some((f) => f.includes('超出合理区间')),
    `mp=999 应被子字典区间拦：${over.join('|')}`,
  );
  const badRole = validateSpecs(rear([{ role: 'foo', mp: 48 }]), schema);
  assert.ok(
    badRole.some((f) => f.includes('不在枚举')),
    `role=foo 应被枚举拦：${badRole.join('|')}`,
  );
  const extra = validateSpecs(rear([{ role: 'main', mp: 48, zoom: '10x' }]), schema);
  assert.ok(
    extra.some((f) => f.includes('子字典注册')),
    `多余键 zoom 应被拦（静默落盘没人读）：${extra.join('|')}`,
  );
  // schema 自身结构：phone.json 的 subfields 声明必须过 validateSchema
  assert.deepEqual(validateSchema(schema), [], 'phone schema（含子字典声明）结构应合法');
});

check('参数级筛选（schema facet → 分面/相等类取值/URL 往返/非法值丢弃）', () => {
  // 最优解相等类泛化：schema facet:true 的字段自动成为筛选维度（键=字段路径）
  const mk = (id, specs) => ({
    id,
    category: 'phone',
    brand: 'apple',
    name: id,
    line: 'iPhone',
    releaseDate: '2026-01-01',
    skus: [],
    specs,
  });
  const products = [
    mk('a', {
      'connectivity.nfc': true,
      'display.refreshHz': '120',
      'haptic.motor': 'X 轴线性马达',
    }),
    mk('b', { 'connectivity.nfc': false, 'display.refreshHz': '60/90' }),
    mk('c', {}), // 全缺 → 未公布（UNKNOWN）
  ];
  // 分面：boolean 三值 + 是/否标签
  const nfc = FACETS_LIB.facetOf(products, 'connectivity.nfc', products);
  assert.deepEqual(nfc.map((f) => f.id).sort(), ['false', 'true', '未公布'].sort());
  assert.equal(nfc.find((f) => f.id === 'true')?.label, '是');
  assert.equal(nfc.find((f) => f.id === 'false')?.label, '否');
  // 相等类筛选生效
  const filter = { ...FACETS_LIB.emptyFilter(), 'connectivity.nfc': ['true'] };
  assert.deepEqual(
    FACETS_LIB.applyFilter(products, filter).map((p) => p.id),
    ['a'],
  );
  // URL 往返（参数维度键 = 字段路径）
  const q = FACETS_LIB.writeFilter(filter, []);
  assert.equal(q['connectivity.nfc'], 'true');
  const catalog = {
    filter: { ...FACETS_LIB.emptyFilter(), 'connectivity.nfc': ['true', 'false', '未公布'] },
    sorts: [],
  };
  const back = FACETS_LIB.readFilter(new URLSearchParams('connectivity.nfc=true'), catalog);
  assert.deepEqual(back.filter['connectivity.nfc'], ['true']);
  // 反测：非法值丢弃（不产生永远 0 台的死条件）
  const bad = FACETS_LIB.readFilter(new URLSearchParams('connectivity.nfc=maybe'), catalog);
  assert.deepEqual(bad.filter['connectivity.nfc'], []);
  // string 原文分面（刷新率官网原文形态）
  const hz = FACETS_LIB.facetOf(products, 'display.refreshHz', products)
    .map((f) => f.id)
    .sort();
  assert.deepEqual(hz, ['120', '60/90', '未公布'].sort());
});

check('orderDeriver 声明与注册表对账（序类适配器不游离）', () => {
  // 最优解「序类引擎显式声明制」最小闭环：schema 声明名字 → 引擎注册表给实现。
  const schema = loadSchema('phone');
  let declared = 0;
  for (const f of schema.fields) {
    if (!f.orderDeriver) continue;
    declared += 1;
    const impl = FIELDS_LIB.orderDeriverFor(f.path);
    assert.ok(
      impl,
      `${f.path} 声明了 orderDeriver "${f.orderDeriver}" 但 fields.ts 注册表没有该实现（拼错或漏注册）`,
    );
    // 反测：适配器对 null 返回 null（不产生 0 冒充「未公布」——类型漂移铁律）
    assert.equal(impl(null), null, `${f.path} 的序类适配器应把 null 映射为 null`);
    assert.equal(impl(undefined), null);
  }
  assert.ok(
    declared >= 1,
    'phone schema 应至少声明一个 orderDeriver（refreshHz），声明丢失说明被误删',
  );
});

check('对比差异判定纯函数（准绳口径：缺失不参与值比较，缺失/不等分两类）', () => {
  // 完整采用准绳方案（用户 2026-10-13 裁决）。对照准绳判据：
  // 「有值 vs 缺失→标缺失色；双方都缺→不标；相等→不标；不等→标不等色」。
  const S = CMP.compareRowState;
  // 关键 case：缺失混入不污染相等判断——120 / — / 120 是「缺失差异」，不是「值不等」
  assert.deepEqual(S(['120', '—', '120']), { different: false, missing: true });
  assert.deepEqual(S(['120', '—', '200']), { different: true, missing: true });
  assert.deepEqual(S(['120', '120', '120']), { different: false, missing: false });
  assert.deepEqual(S(['120', '200']), { different: true, missing: false });
  assert.deepEqual(S(['—', '—']), { different: false, missing: false }); // 全缺失不标
  assert.deepEqual(S(['X 轴线性马达', '转子马达', '—']), { different: true, missing: true });
  // 上浮入选条件就是内联判断 isDifferent || isMissing（准绳 sortDiffUp 口径）
  assert.equal(S(['120', '120']).different || S(['120', '120']).missing, false);
  assert.equal(S(['120', '—']).different || S(['120', '—']).missing, true);
  assert.equal(S(['120', '200']).different || S(['120', '200']).missing, true);
});

section('v2 全品类目录：品类 schema 校验');

check('schema 值校验：六种类型各放行一个合法值', () => {
  const schema = loadSchema('phone');
  const f = (path) => fieldMap(schema).get(path);
  assert.equal(validateSpecValue(f('body.weightG'), 199, 't'), null);
  assert.equal(validateSpecValue(f('body.weightG'), null, 't'), null, 'null 恒合法（未公布）');
  assert.equal(validateSpecValue(f('battery.capacityCaliber'), 'typical', 't'), null);
  assert.equal(validateSpecValue(f('connectivity.fiveG'), true, 't'), null);
  assert.equal(validateSpecValue(f('memory.storageGb'), [256, 512], 't'), null);
  assert.equal(validateSpecValue(f('camera.rear'), [{ role: 'main' }], 't'), null);
  assert.equal(validateSpecValue(f('display.resolutionPx'), { w: 1, h: 2 }, 't'), null);
  assert.equal(validateSpecValue(f('body.ipRating'), 'IP68', 't'), null);
});

check('反向测：类型漂移 / 区间越界 / 枚举越界都必须报出', () => {
  // 每种报错对应一种真实故障：TS 声明 number 运行时进字符串（一排序就 NaN）、
  // 官网改版把 PWM 频率写进刷新率（区间外）、口径值拼错。
  const schema = loadSchema('phone');
  const f = (path) => fieldMap(schema).get(path);
  assert.ok(validateSpecValue(f('body.weightG'), '199', 't'), '字符串重量必须报错');
  assert.ok(validateSpecValue(f('body.weightG'), 1990, 't'), '超区间重量必须报错');
  assert.ok(validateSpecValue(f('battery.capacityCaliber'), 'typ', 't'), '枚举越界必须报错');
  assert.ok(validateSpecValue(f('connectivity.fiveG'), 'yes', 't'), '布尔漂移成字符串必须报错');
  assert.ok(validateSpecValue(f('memory.storageGb'), ['256'], 't'), '数组元素类型错必须报错');
  assert.ok(validateSpecValue(f('display.resolutionPx'), [1, 2], 't'), '对象位进数组必须报错');
});

check('反向测：specs 未注册键整机报错（拼错字段名的唯一防线）', () => {
  const schema = loadSchema('phone');
  const bad = { id: 'ghost', category: 'phone', specs: { 'display.sizes': 6.9 } };
  const errs = validateSpecs(bad, schema);
  assert.equal(errs.length, 1, '未注册键必须报出');
  assert.ok(/display\.sizes/.test(errs[0]), '错误信息要指出具体键名');
  const good = { id: 'ok', category: 'phone', specs: { 'display.sizeIn': 6.9 } };
  assert.deepEqual(validateSpecs(good, schema), [], '合法 specs 必须零报错');
});

check('品类注册表与前端 CATEGORY_ORDER 顺序对账（双真源防漂移）', () => {
  // 注册表（data/categories.json）管「有哪些品类 → 哪个 schema」，
  // 前端 CATEGORY_ORDER 管「页面展示顺序」。两个文件各写一份顺序，
  // 不加这道对账迟早分叉——症状是页面品类 tabs 与数据里的品类对不上。
  const reg = loadCategories();
  assert.ok(reg, 'categories.json 必须存在');
  assert.deepEqual(
    reg.categories.map((c) => c.id),
    CAT.CATEGORY_ORDER.map((c) => c.id),
    '注册表顺序必须与前端 CATEGORY_ORDER 一致',
  );
  for (const c of reg.categories) {
    assert.ok(isRegisteredCategory(c.id), `${c.id} 必须注册`);
    if (c.builtin !== false) assert.ok(loadSchema(c.id), `已建设品类 ${c.id} 必须有 schema 文件`);
  }
  assert.ok(quantifiableFields(loadSchema('phone')).length > 0, 'phone 必须有可量化字段');

  // 展示名也要对账，而不只是顺序：**以前这里只比 id 顺序**，
  // 于是 catalog.ts 里那行注释「与 data/categories.json 的 label/labelEn 双字段同源
  // （selftest 对账）」是句假话——把注册表的 labelEn 改成 'Tabl3t' 自测依旧 266 全绿。
  // 注释比代码更会骗人：人会照着注释相信「改一处就够」，然后两处悄悄分叉
  // （症状：筛选条显示英文、详情页显示中文，且零报错）。
  for (const c of reg.categories) {
    const front = CAT.CATEGORY_ORDER.find((x) => x.id === c.id);
    assert.ok(front, `${c.id} 必须在前端 CATEGORY_ORDER 里`);
    assert.equal(front.label, c.label, `${c.id} 的中文名两处必须一致`);
    assert.equal(front.labelEn, c.labelEn, `${c.id} 的英文名两处必须一致`);
  }
});

check('schema 结构校验：phone 无分组/字段错误', () => {
  // 借鉴准绳 groups 表：字段必须归属到一个已注册分组，分组 id 不可重复。
  const schema = loadSchema('phone');
  assert.deepEqual(validateSchema(schema), [], 'phone schema 结构必须零报错');
});

check('反向测：schema 字段引用不存在的分组 / 分组 id 重复必须报出', () => {
  const bad = JSON.parse(JSON.stringify(loadSchema('phone')));
  bad.fields[0].group = 'ghost';
  assert.ok(
    validateSchema(bad).some((e) => /ghost/.test(e)),
    '字段引用不存在的分组必须报出',
  );
  bad.groups.push({ id: 'body', name: 'dup', nameEn: 'dup', type: 'single' });
  assert.ok(
    validateSchema(bad).some((e) => /重复/.test(e)),
    '分组 id 重复必须报出',
  );
});

check('显式分组：groups 覆盖全部字段，无 orphan（前端分组不用再猜 path 前缀）', () => {
  // 准绳用 groups 表驱动分面与详情分组，specworld 同样不让前端从 path 前缀隐式推导。
  const schema = loadSchema('phone');
  const byGroup = fieldsByGroup(schema);
  assert.ok(byGroup.get('__orphan__').length === 0, '不允许有未分组字段');
  const covered = [...byGroup.values()].reduce((n, arr) => n + arr.length, 0);
  assert.equal(covered, schema.fields.length, '所有字段必须被某个分组覆盖');
  // 分组顺序与 schema 声明一致，且包含 camera 这种 multi 型
  const ids = groupsOf(schema).map((g) => g.id);
  assert.ok(ids.includes('camera'), 'camera 分组必须存在');
  assert.equal(groupsOf(schema).find((g) => g.id === 'camera').type, 'multi', '摄像头是多实例分组');
});

check(
  '四态 valueStatus：present→available / absent→unknown / none→none / not_applicable→not_applicable',
  () => {
    // 准绳 value_status 的四条语义。valueStatus 映射只存 none/not_applicable 例外，其余靠 presence 推导。
    const p = {
      specs: { 'display.sizeIn': 6.1, 'body.weightG': 170 },
      valueStatus: { 'body.weightG': 'none', 'display.type': 'not_applicable' },
    };
    assert.equal(valueStatus(p, 'display.sizeIn'), 'available', 'specs 有值 = available');
    assert.equal(valueStatus(p, 'body.thicknessMm'), 'unknown', 'specs 缺键 = unknown');
    assert.equal(valueStatus(p, 'body.weightG'), 'none', 'valueStatus none 覆盖 presence');
    assert.equal(
      valueStatus(p, 'display.type'),
      'not_applicable',
      'valueStatus not_applicable 覆盖 presence',
    );
    // 生命周期 status 字符串绝不被误当映射：valueStatus 缺省时只按 specs presence 推导
    const q = { status: 'on-sale', specs: { 'display.sizeIn': 6.1 } };
    assert.equal(valueStatus(q, 'display.sizeIn'), 'available', '生命周期 status 不得被当四态映射');
    assert.equal(
      valueStatus(q, 'body.weightG'),
      'unknown',
      '生命周期 status 不得被当四态映射（缺键=unknown）',
    );
  },
);

check('四态 valueStatus：specs 有键但值为 null/空数组 → unknown（官方未公布，不是已填）', () => {
  // 本项目把「官方未公布」存成 specs 里的 null（如 display.refreshHz=null）或空数组
  // （如 memory.ramGb=[]）。值不存在却按 available 算，会让填充率虚高、前端把 null 渲染成空白。
  const p = {
    specs: { 'display.refreshHz': null, 'memory.ramGb': [], 'body.weightG': 170 },
    valueStatus: { 'display.refreshHz': 'none' },
  };
  // 显式 none 仍覆盖（即便值为 null，none 是人工判定「确实无」）
  assert.equal(valueStatus(p, 'display.refreshHz'), 'none', '显式 none 覆盖 null 值');
  assert.equal(valueStatus(p, 'memory.ramGb'), 'unknown', '空数组视为未公布 = unknown');
  assert.equal(valueStatus(p, 'body.weightG'), 'available', '非 null 真值仍 = available');
  // 既没有值、也没有 none/n_a 例外 → unknown（与缺键一致）
  const q = { specs: { 'chipset.processNm': null } };
  assert.equal(valueStatus(q, 'chipset.processNm'), 'unknown', 'null 值无例外 = unknown');
});

check(
  '反向测：无效 valueStatus 键 / 非法 valueStatus 值必须被闸门拒绝（写错字段名会静默隐藏参数）',
  () => {
    // validateStatusMap 是闸门 11c 的底层；与 validateSpecs 同级，写错一样拒绝写盘。
    const schema = loadSchema('phone');
    const errGhost = validateStatusMap(
      { id: 'p', category: 'phone', specs: {}, valueStatus: { 'display.sizes': 'none' } },
      schema,
    );
    assert.ok(
      errGhost.some((e) => /display\.sizes/.test(e)),
      'valueStatus 引用未注册字段必须报出',
    );
    const errVal = validateStatusMap(
      { id: 'p', category: 'phone', specs: {}, valueStatus: { 'display.sizeIn': 'maybe' } },
      schema,
    );
    assert.ok(
      errVal.some((e) => /maybe/.test(e)),
      '非法 valueStatus 值必须报出',
    );
    assert.deepEqual(
      validateStatusMap(
        { id: 'p', category: 'phone', specs: {}, valueStatus: { 'display.sizeIn': 'none' } },
        schema,
      ),
      [],
      '合法 valueStatus 例外不误报',
    );
  },
);

check('闸门反向测：注入非法 valueStatus 必须拒绝写盘，合法 valueStatus 放行', () => {
  const base = (valueStatus) => ({
    generatedAt: '2026-10-13T00:00:00Z',
    products: Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      slug: `p${i}`,
      brand: 'apple',
      category: 'phone',
      name: `P${i}`,
      releaseDate: '2026-09-01',
      status: 'on-sale',
      specs: {
        'display.sizeIn': 6.1,
        'body.weightG': 170,
        'display.resolutionPx': { w: 1206, h: 2622 },
      },
      provenance: {
        'display.sizeIn': 'apple-official',
        'body.weightG': 'apple-official',
        releaseDate: 'apple-official',
        'display.resolutionPx.w': 'apple-official',
      },
      firstSeenAt: '2026-10-13T00:00:00Z',
      lastSeenAt: '2026-10-13T00:00:00Z',
      ...(i === 0 && valueStatus ? { valueStatus } : {}),
    })),
  });
  assert.ok(
    validate(base({ 'display.sizes': 'none' }), null).some((f) => /valueStatus/.test(f)),
    '非法 valueStatus 键必须拒写',
  );
  assert.deepEqual(
    validate(base({ 'display.sizeIn': 'none' }), null),
    [],
    '合法 valueStatus 例外必须放行',
  );
});

section('v2 全品类目录：用户数据层');

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

check('set-field：值替换 + provenance 标 user-manual + 官网原值进 report', () => {
  const products = [makeProduct('p1')];
  const { products: out, report } = applyOverrides(products, {
    entries: [
      {
        id: 'o1',
        op: 'set-field',
        productId: 'p1',
        field: 'display.sizeIn',
        value: 6.9,
        reason: '官网抓漏',
        createdAt: '2026-10-13',
        createdBy: '道友',
      },
    ],
  });
  assert.equal(pick(out[0], 'display.sizeIn'), 6.9, '用户值必须生效');
  assert.equal(out[0].provenance['display.sizeIn'], 'user-manual', '必须标明被用户修正');
  assert.equal(out[0].provenance['body.weightG'], 'apple-official', '没碰的字段 provenance 不动');
  assert.equal(report.replaced.length, 1, '被覆盖的官网原值必须记录（可回查）');
  assert.equal(report.replaced[0].from, 6.1);
  assert.equal(products[0].specs['display.sizeIn'], 6.1, 'applyOverrides 不改原数组');
});

check('add-product：整机入池 + 身份字段兜底 + provenance 完整', () => {
  const { products: out, report } = applyOverrides([makeProduct('p1')], {
    entries: [
      {
        id: 'o2',
        op: 'add-product',
        createdAt: '2026-10-13',
        product: {
          id: 'u1',
          brand: 'huawei',
          category: 'phone',
          name: '用户机',
          releaseDate: '2026-08-01',
          specs: { 'body.weightG': 180 },
        },
        reason: '官网没有但已上市',
      },
    ],
  });
  assert.equal(out.length, 2, '新产品必须入池');
  const u = out.find((p) => p.id === 'u1');
  assert.equal(u.status, 'on-sale', 'status 缺省 on-sale');
  assert.equal(u.granularity, 'manual');
  assert.equal(u.provenance['body.weightG'], 'user-manual', 'specs 全键标 user-manual');
  assert.equal(
    u.provenance.releaseDate,
    'user-manual',
    'releaseDate 有值也要 provenance（硬闸门）',
  );
  assert.equal(report.added.length, 1);
});

check('软删除与冲突：active=false 不生效；同目标多条后者赢', () => {
  const products = [makeProduct('p1')];
  const { products: out, report } = applyOverrides(products, {
    entries: [
      {
        id: 'a',
        op: 'set-field',
        productId: 'p1',
        field: 'display.sizeIn',
        value: 7.0,
        reason: '先改',
        createdAt: '2026-10-01',
      },
      {
        id: 'b',
        op: 'set-field',
        productId: 'p1',
        field: 'display.sizeIn',
        value: 7.2,
        reason: '后改',
        createdAt: '2026-10-02',
      },
      {
        id: 'c',
        op: 'set-field',
        productId: 'p1',
        field: 'body.weightG',
        value: 999,
        reason: '作废',
        createdAt: '2026-10-03',
        active: false,
      },
    ],
  });
  assert.equal(pick(out[0], 'display.sizeIn'), 7.2, '同字段多条，createdAt 在后者生效');
  assert.equal(pick(out[0], 'body.weightG'), 170, 'active=false 的条目不应用');
  assert.equal(report.skipped.length, 1, '软删除要留痕');
  assert.equal(report.conflicts.length, 1, '冲突要显式记录');
  assert.equal(report.conflicts[0].winner, 'b');
});

check('反向测：引用悬空 / 字段未注册 / 值越界 / id 冲突 / 品牌未注册全部报错', () => {
  // 五类错误对应五种手滑。任何一类被静默跳过，用户都会以为改好了而页面纹丝不动。
  const products = [makeProduct('p1')];
  const base = {
    id: 'x',
    op: 'set-field',
    productId: 'p1',
    field: 'display.sizeIn',
    value: 6.9,
    reason: 'r',
    createdAt: '2026-10-13',
  };
  assert.ok(
    validateOverrides({ entries: [{ ...base, productId: 'ghost' }] }, products).length,
    '引用不存在的机型必须报错',
  );
  assert.ok(
    validateOverrides({ entries: [{ ...base, field: 'display.sizes' }] }, products).length,
    '字段未注册必须报错',
  );
  assert.ok(
    validateOverrides({ entries: [{ ...base, value: 69 }] }, products).length,
    '值越界必须报错',
  );
  assert.ok(
    validateOverrides({ entries: [{ ...base, reason: '' }] }, products).length,
    '缺 reason 必须报错',
  );
  assert.ok(
    validateOverrides({ entries: [{ ...base, createdAt: 'not-a-date' }] }, products).length,
    'createdAt 非法必须报错',
  );
  assert.ok(
    validateOverrides(
      {
        entries: [
          {
            id: 'n',
            op: 'add-product',
            product: makeProduct('p1'),
            reason: 'r',
            createdAt: '2026-10-13',
          },
        ],
      },
      products,
    ).length,
    'add-product id 冲突必须报错',
  );
  assert.ok(
    validateOverrides(
      {
        entries: [
          {
            id: 'n',
            op: 'add-product',
            product: makeProduct('u9', { brand: 'nokia' }),
            reason: 'r',
            createdAt: '2026-10-13',
          },
        ],
      },
      products,
    ).length,
    '品牌未注册必须报错',
  );
  // 排除集合：add-product 已并入的 id 不构成「与现有产品冲突」（validate 二次校验踩过）
  assert.deepEqual(
    validateOverrides(
      {
        entries: [
          {
            id: 'n',
            op: 'add-product',
            product: makeProduct('u9'),
            reason: 'r',
            createdAt: '2026-10-13',
          },
        ],
      },
      [...products, makeProduct('u9')],
      { excludeIds: ['u9'] },
    ),
    [],
    'excludeIds 里的 id 是用户层自己加的，不算冲突',
  );
});

check('闸门反向测：v2 快照注入未注册键 / 越界值必须拒绝写盘', () => {
  // validate 是新格式的唯一防线。反向测两步：注入违规 → 必须报出；改回 → 必须恢复绿灯。
  // 注意 LIMITS.minProducts=20：夹具必须造够台数，否则第一道总量闸门先拦，
  // 被测的 schema 闸门有没有生效反而看不出（夹具缺陷假装成闸门缺陷）。
  const good = {
    generatedAt: '2026-10-13T00:00:00Z',
    products: Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      slug: `p${i}`,
      brand: 'apple',
      category: 'phone',
      name: `P${i}`,
      releaseDate: '2026-09-01',
      status: 'on-sale',
      specs: {
        'display.sizeIn': 6.1,
        'body.weightG': 170,
        'display.resolutionPx': { w: 1206, h: 2622 },
        'memory.storageGb': [256],
      },
      provenance: {
        'display.sizeIn': 'apple-official',
        'body.weightG': 'apple-official',
        releaseDate: 'apple-official',
        'display.resolutionPx.w': 'apple-official',
      },
      firstSeenAt: '2026-10-13T00:00:00Z',
      lastSeenAt: '2026-10-13T00:00:00Z',
    })),
  };
  assert.deepEqual(validate(good, null), [], '合规 v2 快照必须零报错');

  const ghost = JSON.parse(JSON.stringify(good));
  ghost.products[0].specs['display.sizes'] = 6.9;
  assert.ok(
    validate(ghost, null).some((f) => /display\.sizes/.test(f)),
    '未注册键必须被闸门拦下',
  );

  const oob = JSON.parse(JSON.stringify(good));
  oob.products[0].specs['body.weightG'] = 1990;
  assert.ok(
    validate(oob, null).some((f) => /weightG/.test(f)),
    '越界值必须被闸门拦下',
  );

  const badCat = JSON.parse(JSON.stringify(good));
  badCat.products[0].category = 'toaster';
  assert.ok(
    validate(badCat, null).some((f) => /品类缺失或未注册/.test(f)),
    '未注册品类必须被闸门拦下',
  );

  assert.deepEqual(validate(good, null), [], '改回后必须恢复绿灯（闸门没被反向测污染）');
});

check('用户数据层经闸门：注入违规的 override 必须拒绝写盘', () => {
  // validate 的 overrides 参数把用户层校验并进闸门。这条守住「写错显性失败」。
  const snapshot = {
    generatedAt: '2026-10-13T00:00:00Z',
    products: Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      slug: `p${i}`,
      brand: 'apple',
      category: 'phone',
      name: `P${i}`,
      releaseDate: '2026-09-01',
      status: 'on-sale',
      specs: {
        'display.sizeIn': 6.1,
        'body.weightG': 170,
        'display.resolutionPx': { w: 1206, h: 2622 },
        'memory.storageGb': [256],
      },
      provenance: {
        'display.sizeIn': 'apple-official',
        'body.weightG': 'apple-official',
        releaseDate: 'apple-official',
        'display.resolutionPx.w': 'apple-official',
      },
      firstSeenAt: '2026-10-13T00:00:00Z',
      lastSeenAt: '2026-10-13T00:00:00Z',
    })),
  };
  const badOverride = {
    entries: [
      {
        id: 'o',
        op: 'set-field',
        productId: 'p1',
        field: 'display.sizes',
        value: 6.9,
        reason: '手滑',
        createdAt: '2026-10-13',
      },
    ],
  };
  const fail = validate(snapshot, null, { overrides: badOverride });
  assert.ok(
    fail.some((f) => /用户数据层/.test(f) && /display\.sizes/.test(f)),
    'override 字段未注册必须拒绝写盘',
  );
  assert.deepEqual(validate(snapshot, null, { overrides: { entries: [] } }), [], '空用户层不误报');
});

check('data/overrides.json 入库文件自身合法（防手滑提交坏层）', () => {
  const ovr = loadOverrides();
  const snap = existsSync(join(ROOT, 'data/products.json'))
    ? JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'))
    : { products: [] };
  // add-product 申报的 id 在管线 merge 后就在 products.json 里了——不排除会
  // 「自己冲突自己」（2026-10-15 iPhone 全代 add-product 后实测踩中）。
  // 与 sync/index.mjs 的 appliedIds 同一排除语义。
  const appliedIds = (ovr.entries ?? [])
    .filter((e) => e.op === 'add-product')
    .map((e) => e.product?.id)
    .filter(Boolean);
  const errs = validateOverrides(ovr, snap.products ?? [], { excludeIds: appliedIds });
  assert.deepEqual(errs, [], `入库的 overrides.json 必须合法：${errs.join('; ')}`);
});

/* ================================================================ *
 * i18n 对账（B2 方案：全量抽取 + 中英双语 + 覆盖闸门）
 * ------------------------------------------------------------------
 * 反面教材是 DevEco Code：有 i18next 骨架、有语言切换对话框，实际覆盖约
 * 16/719（3%）——用户切到中文「几乎没变化」。那种伤害不是「翻译没排期」，
 * 而是**没有任何闸门知道翻译没做完**。以下五条把这件事变成红灯。
 * ================================================================ */
section('i18n 覆盖');

check('i18n 双向对账：键集一致 / 引用↔定义 / 插值参数一致', () => {
  const problems = I18N.checkI18n(ROOT);
  assert.deepEqual(
    problems,
    [],
    `i18n 对账未过（${problems.length} 项）：\n  - ${problems.slice(0, 12).join('\n  - ')}`,
  );
});

check('i18n 数据侧双语：schema / 视图字典 / 策展字典 / 品类注册表 labelEn 齐全', () => {
  const problems = I18N.checkDataBilingual(ROOT);
  assert.deepEqual(
    problems,
    [],
    `数据侧缺英文字段（${problems.length} 项）——英文页会混进中文：\n  - ${problems.join('\n  - ')}`,
  );
});

check('i18n 缺键 = 抛错（不设 fallbackLocale，绝不静默回退到另一种语言）', () => {
  // 直接读装配源码断言，避免为了测它而真的把 i18n 拉起来（selftest 跑在裸 node）
  const src = readFileSync(join(ROOT, 'src/i18n/index.ts'), 'utf8');
  assert.ok(/missing:/.test(src), 'src/i18n/index.ts 必须配置 missing handler');
  assert.ok(/throw new Error/.test(src), 'missing handler 必须抛错而不是回退');
  assert.ok(
    !/fallbackLocale\s*:/.test(src),
    '不应设 fallbackLocale —— 回退到另一种语言就是「切了没生效」的 DevEco 式背叛',
  );
});

check('i18n 闸门自身被反向测试：四类注入必须报红，撤销后必须恢复绿灯', () => {
  const base = join(tmpdir(), `specworld-i18n-rt-${Date.now()}`);
  const write = (rel, obj) => {
    const abs = join(base, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  };
  const clean = {
    zh: { a: { b: '你好 {n}' }, c: { d: '已用' } },
    en: { a: { b: 'hello {n}' }, c: { d: 'used' } },
  };
  const srcTs = "export const K = { x: 'c.d' };\nexport const f = () => t('a.b');\n";

  const build = (zh, en, ts = srcTs) => {
    rmSync(base, { recursive: true, force: true });
    write('src/locales/zh.json', zh);
    write('src/locales/en.json', en);
    write('src/app.ts', ts);
  };

  // 0. 干净样本必须是绿灯（否则后面的红灯都不可信）
  build(clean.zh, clean.en);
  assert.deepEqual(I18N.checkI18n(base), [], '干净样本应当是绿灯');

  // 1. en 缺键
  build(clean.zh, { a: { b: 'hello {n}' } });
  assert.ok(
    I18N.checkI18n(base).some((x) => /en\.json 缺少键/.test(x)),
    'en 缺键必须报红',
  );

  // 2. 引用了不存在的键
  build(clean.zh, clean.en, srcTs + "export const g = () => t('a.nope');\n");
  assert.ok(
    I18N.checkI18n(base).some((x) => /引用了不存在的键/.test(x)),
    '引用不存在的键必须报红',
  );

  // 3. 僵尸键（译了没人用）
  build({ ...clean.zh, zz: { q: '没用' } }, { ...clean.en, zz: { q: 'unused' } });
  assert.ok(
    I18N.checkI18n(base).some((x) => /无人引用/.test(x)),
    '语言包里有未被引用的键必须报红',
  );

  // 4. 插值参数不一致
  build({ a: { b: '你好 {n}' }, c: { d: 'x' } }, { a: { b: 'hello {m}' }, c: { d: 'x' } });
  assert.ok(
    I18N.checkI18n(base).some((x) => /插值参数不一致/.test(x)),
    '中英插值参数不一致必须报红',
  );

  // 撤销后恢复绿灯（防「闸门一次性生效」的假绿）
  build(clean.zh, clean.en);
  assert.deepEqual(I18N.checkI18n(base), [], '撤销注入后应恢复绿灯');

  rmSync(base, { recursive: true, force: true });
});

check('i18n 闸门看得见注释里的假键（剥注释不能省）', () => {
  // 反向：注释里写 `t('a.b')` 不该被当成引用；若剥注释失效，这里会变成
  // 「僵尸键」与「假引用」同时出现，正是本项目 2026-10-04 记下的闸门失效形态。
  const zh = I18N.loadLocalePack(ROOT, 'zh.json');
  const ns = I18N.namespacesOf(zh);
  const used = I18N.collectUsedKeys(ROOT, ns);
  assert.ok(used.size > 100, `引用键数量异常（${used.size}）——扫描器可能整体失灵`);
  assert.ok(
    !used.has('product.id'),
    '注释/模板属性里的 product.id 不应被当成 i18n 键（剥注释或引号判定失效）',
  );
});

/* i18n 装配：预装载后交给同步用例（⚠️ check() 是同步的，传 async 回调会让断言
 * 失败变成未捕获的 Promise rejection —— 用例会显示通过，比没写测试更糟） */
const I18NCFG = await import('../src/i18n/index.ts');
const FIELDS_LIB_TOP = await import('../src/lib/fields.ts');
const SPEC_TOP = await import('../src/lib/specs.ts');
const CAT_TOP = await import('../src/lib/catalog.ts');

const CJK = /[\u4e00-\u9fff]/;

/** 切语言（同步），供下面的对账用例使用 */
function withLocale(locale, fn) {
  const prev = I18NCFG.currentLocale();
  I18NCFG.setLocale(locale);
  try {
    return fn();
  } finally {
    I18NCFG.setLocale(prev);
  }
}

check('i18n 运行时：语言包每个键都能解析（缺键必须抛错，不能静默回退）', () => {
  const zh = I18N.loadLocalePack(ROOT, 'zh.json');
  const keys = [...zh.keys()];
  assert.ok(keys.length > 100, `键数量异常（${keys.length}）`);
  const bad = [];
  for (const k of keys) {
    try {
      // 插值参数全量喂一遍：占位符写错也在这里炸，而不是等用户切过去才炸
      I18NCFG.i18n.global.t(k, { n: 1, total: 2, m: 3, err: 'e', name: 'N', value: 'V' });
    } catch (e) {
      bad.push(`${k}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  assert.deepEqual(bad, [], `以下键解析失败：\n  - ${bad.slice(0, 10).join('\n  - ')}`);
});

check('i18n 反半吊子：切到英文后参数表/维度名/能力名不得残留中文', () => {
  assert.ok(REAL_P.length > 0, '需要真实数据');
  const probe = REAL_P[0];

  const enBad = [];
  withLocale('en', () => {
    for (const g of FIELDS_LIB_TOP.specGroups(probe)) {
      if (CJK.test(g.title)) enBad.push(`组标题 ${g.title}`);
      for (const r of g.rows) if (CJK.test(r.label)) enBad.push(`行标签 ${r.label}`);
    }
    for (const k of F.DIMENSION_KEYS) {
      if (CJK.test(F.dimLabel(k))) enBad.push(`维度名 ${k} → ${F.dimLabel(k)}`);
      if (CJK.test(F.dimAllLabel(k))) enBad.push(`「全部」 ${k} → ${F.dimAllLabel(k)}`);
    }
    for (const a of SPEC_TOP.ABILITIES) {
      if (CJK.test(SPEC_TOP.abilityLabel(a.key))) enBad.push(`能力名 ${a.key}`);
    }
    for (const s of F.SORTS) if (CJK.test(F.sortLabel(s.id))) enBad.push(`排序名 ${s.id}`);
    for (const s of ['on-sale', 'upcoming', 'retired']) {
      if (CJK.test(CAT_TOP.statusLabelOf(s))) enBad.push(`状态名 ${s}`);
    }
  });
  assert.deepEqual(
    enBad,
    [],
    `英文界面残留中文（这就是「切了没变化」的半吊子）：\n  - ${enBad.slice(0, 12).join('\n  - ')}`,
  );

  // 反向：中文下必须**有**中文，否则说明读的根本不是中文包（假绿）
  const zhOk = withLocale('zh-CN', () => FIELDS_LIB_TOP.specGroups(probe).map((g) => g.title));
  assert.ok(
    zhOk.some((t) => CJK.test(t ?? '')),
    '中文下参数表组标题应含中文（否则语言切换根本没生效）',
  );
});

check('status 枚举跨镜像一致：管线枚举每个值都有前端标签映射（不回落原始键）', () => {
  // 2026-10-17 审计 A1：812 台 'discontinued' 的事故形态 = 闸门缺失 + 前端缺映射
  // （statusLabelOf 回落原文，页面显示原始键）。管线侧 LIFECYCLE_STATUS_VALUES
  // 与前端 catalog.ts STATUS_LABEL_KEY 必须对齐，缺一个值就红。
  for (const s of LIFECYCLE_STATUS_VALUES) {
    const label = CAT_TOP.statusLabelOf(s);
    assert.ok(label && label !== s, `status "${s}" 在前端缺标签映射（会回落显示原始键）`);
  }
});

/* ================================================================ *
 * 参数值官方术语表（data/curated/glossary.json）
 * ================================================================ */

const GLOSS = await import('../src/lib/glossary.ts');
const GLOSS_JSON = JSON.parse(readFileSync(join(ROOT, 'data/curated/glossary.json'), 'utf8'));

check('术语表：每条都有官方英文与可核验出处，且没把中文当英文填', () => {
  const bad = [];
  const sources = GLOSS_JSON._sources ?? {};
  const evOk = (ev) => typeof ev === 'string' && ev in sources;

  for (const [zh, e] of Object.entries(GLOSS_JSON.exact ?? {})) {
    if (!e?.en) bad.push(`exact「${zh}」缺 en`);
    else if (CJK.test(e.en)) bad.push(`exact「${zh}」的 en 仍是中文：${e.en}`);
    else if (e.en === zh) bad.push(`exact「${zh}」en 与中文相同（复制粘贴？）`);
    if (!evOk(e?.ev)) bad.push(`exact「${zh}」的 ev 不在 _sources 里（出处不可核验）`);
  }
  for (const p of GLOSS_JSON.patterns ?? []) {
    if (!p?.en) bad.push(`pattern ${p?.re} 缺 en`);
    else if (CJK.test(p.en)) bad.push(`pattern ${p.re} 的 en 仍是中文：${p.en}`);
    if (!evOk(p?.ev)) bad.push(`pattern ${p.re} 的 ev 不在 _sources 里`);
    try {
      new RegExp(p.re);
    } catch (err) {
      bad.push(`pattern ${p.re} 不是合法正则：${err.message}`);
    }
  }
  for (const p of GLOSS_JSON.prefixes ?? []) {
    if (!p?.zh || !p?.en) bad.push(`prefix ${JSON.stringify(p)} 缺 zh/en`);
    else if (CJK.test(p.en)) bad.push(`prefix「${p.zh}」的 en 仍是中文：${p.en}`);
    if (!evOk(p?.ev)) bad.push(`prefix「${p?.zh}」的 ev 不在 _sources 里`);
  }
  assert.deepEqual(bad, [], `术语表不合法：\n  - ${bad.slice(0, 10).join('\n  - ')}`);
});

check('术语表：中文界面原样返回，英文界面才动手（哨兵值）', () => {
  const zh = '超视网膜 XDR 显示屏';
  assert.equal(
    withLocale('zh-CN', () => GLOSS.localizeSpecValue(zh)),
    zh,
    '中文下不许改写官网原文',
  );
  const en = withLocale('en', () => GLOSS.localizeSpecValue(zh));
  assert.equal(en, 'Super Retina XDR display', '英文下应换成苹果官方用词');
  assert.ok(!CJK.test(en), '翻译结果不该还有中文');
  // 数值/英文原文零开销
  assert.equal(
    withLocale('en', () => GLOSS.localizeSpecValue('6.1 英寸')),
    '6.1 英寸',
  );
});

check('术语表：每台机器的芯片名在英文下都能拿到官方英文名（不许残留中文）', () => {
  assert.ok(REAL_P.length > 0, '需要真实数据');
  const bad = withLocale('en', () =>
    REAL_P.filter((p) => p.chipset?.name)
      .map((p) => ({ id: p.id, out: CAT_TOP.chipNameLabel(p.chipset.name) }))
      .filter((x) => CJK.test(x.out) && !/（/.test(x.out)) // 括号内是官网脚注，属原文
      .map((x) => `${x.id} → ${x.out}`),
  );
  assert.deepEqual(
    bad,
    [],
    `芯片名仍是中文（芯片型号是标识，厂商有官方英文名就必须用）：\n  - ${bad.slice(0, 10).join('\n  - ')}`,
  );
});

check('术语表覆盖率不下降（新增中文术语会把它压低，逼你去补官方译名）', () => {
  const vals = new Set();
  for (const p of REAL_P) {
    for (const v of Object.values(p.specs ?? {})) {
      if (typeof v === 'string' && CJK.test(v)) vals.add(v.trim());
    }
  }
  assert.ok(vals.size > 50, `含中文的 specs 值太少（${vals.size}）——数据或扫描出了问题`);
  const done = withLocale(
    'en',
    () => [...vals].filter((v) => !CJK.test(GLOSS.localizeSpecValue(v))).length,
  );
  const rate = done / vals.size;
  // 基线取 i18n-coverage-baseline.json 里上次通过的实测值（只防下降，不设绝对下限）：
  // 苹果全系列补进大量 1984–2004 年代设备后，许多术语在厂商官网已无英文页可核，
  // 按「查不到官方英文不登记」纪律这类值合法保留中文——硬编码 60% 会逼出编造译名。
  // 收录偏重官方文档丰富的新设备时覆盖率会自然回升，届时可手动上调基线值。
  const baselinePath = join(ROOT, 'scripts/i18n-coverage-baseline.json');
  let baseline = 0.6;
  if (existsSync(baselinePath)) {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).minRate ?? 0.6;
  } else if (rate >= 0.6) {
    writeFileSync(baselinePath, JSON.stringify({ minRate: Math.round(rate * 1000) / 1000, note: '首次落盘=当前实测；只防下降。收录历史设备导致合法下降时手动更新。' }, null, 2) + '\n');
  }
  assert.ok(
    rate >= baseline,
    `术语表覆盖率 ${(rate * 100).toFixed(1)}%（${done}/${vals.size}）低于基线 ${(baseline * 100).toFixed(1)}% ——` +
      '要么新数据带进了没登记的术语（去 data/curated/glossary.json 补官方英文），' +
      '要么词表被删改了。历史设备的中文值若确认无官方英文页可核，手动下调基线值并注明原因。',
  );
});

check('术语表闸门自身被反向测试：把官方英文改成中文必须报红', () => {
  // 反向测的是「上面那条哨兵用例」的判据本身：如果判据写错（比如恒真），
  // 这里就会安静地通过，然后词表失效时你也发现不了。
  const real = GLOSS.GLOSSARY_EXACT['铝金属设计'];
  assert.ok(real, '词表里应有「铝金属设计」');
  const backup = real.en;
  try {
    real.en = '铝金属设计'; // 假装有人把 en 抄成了中文
    const bad = CJK.test(real.en);
    assert.ok(bad, '把 en 写成中文必须能被 CJK 判据抓到');
  } finally {
    real.en = backup;
  }
  assert.equal(real.en, 'Aluminum design', '反向测必须还原现场');
});

check('i18n 接线：详情参数表（specGroups）必须应用 localizeSpecValue，术语表能译的词不得残留中文', () => {
  // 反向测：若有人把 specGroups 出口的 localizeSpecValue 调用删了（回到「中文官网原文直接吐」），
  // 本条必红。只盯「术语表能译的词」——诚实保留的中国特有项（不在词表里）不算漏。
  // 注意：wifi/卫星/出厂系统 这几个 path 在 view-phone.json 里是 hidden，详情页与分面都不渲染，
  // 它们只会在 DataFeedback 纠错表单里以「当前值」出现（见下条），所以这里用真实可见字段验收接线。
  const terms = new Set();
  for (const k of Object.keys(GLOSS.GLOSSARY_EXACT)) if (CJK.test(k)) terms.add(k);
  /*
   * pattern 的汉字片段**不再**进 terms —— 旧写法用「值里出现了这个汉字片段」判定可译，
   * 于是 `^支持 (\d+) Hz 刷新率$` 这类**上下文锚定**的 pattern 会贡献出通用前缀「支持」，
   * 任何含「支持」二字的官网原文（如 NFC 原文「支持读卡器模式的 NFC」）都被判成漏译 —— 误报。
   * 误报的下场几乎总是「把字段塞进 hidden 了事」，字段就真的永远不上页面了。
   *
   * ⚠️ 诚实的边界：pattern 级漏译**不为它单独造判据**。实测过——把 specGroups 出口的
   * localizeSpecValue 摘掉，可见行里没有任何一段能被某条 pattern 完整匹配（真实数据里
   * 那 738 处匹配全在 hidden 字段上），所以「完整匹配」式判据在这里恒绿、等于假闸门。
   * 反向测能力由上面的 exact / prefixes / screenLabels 的 terms 承担：摘掉出口调用后
   * 本条确实变红（已验证），只是报的是「含未译术语」而不是「pattern 未命中」。
   */
  for (const p of GLOSS_JSON.prefixes ?? []) if (CJK.test(p.zh)) terms.add(p.zh);
  for (const p of GLOSS_JSON.prefixes ?? []) if (CJK.test(p.zh)) terms.add(p.zh);
  for (const k of Object.keys(GLOSS_JSON.screenLabels ?? {})) if (CJK.test(k)) terms.add(k);
  const bad = withLocale('en', () => {
    const out = [];
    for (const p of REAL_P) {
      for (const g of FIELDS_LIB_TOP.specGroups(p)) {
        for (const r of g.rows) {
          const v = r.value ?? '';
          for (const term of terms) if (v.includes(term)) out.push(`${p.id} / ${r.label} → 含未译术语「${term}」：${v}`);

        }
      }
    }
    return out;
  });
  assert.deepEqual(
    bad,
    [],
    `英文详情页残留术语表能译的中文（specGroups 没过 localizeSpecValue？）：\n  - ${bad.slice(0, 12).join('\n  - ')}`,
  );
});

check('术语表：卫星/无线局域网/出厂系统 关键条目必须可译（删词条会报红）', () => {
  // 反向测：删掉 glossary.json 里任意一条卫星/WLAN 词条，这里必红，
  // 防止「DataFeedback 当前值英文化」靠的是词表、词表被删却无人发现。
  const want = {
    北斗卫星消息: 'Beidou satellite messaging',
    天通卫星通信: 'Tiantong satellite communication',
    天通卫星通话: 'Tiantong satellite calling',
    卫星寻呼: 'satellite paging',
    双向北斗卫星消息: 'two-way Beidou satellite messaging',
    畅连北斗卫星消息: 'Link Beidou satellite messaging',
    运营商北斗卫星短信: 'carrier Beidou satellite SMS',
    '802.11be 无线局域网': '802.11be WLAN',
    不支持: 'Not supported',
    '鸿蒙操作系统 5.0': 'HarmonyOS 5.0',
  };
  const bad = withLocale('en', () =>
    Object.entries(want)
      .map(([zh, en]) => {
        const got = GLOSS.localizeSpecValue(zh);
        return got === en ? null : `${zh} → 期望「${en}」实得「${got}」`;
      })
      .filter(Boolean),
  );
  assert.deepEqual(bad, [], `术语表关键条目失效：\n  - ${bad.slice(0, 10).join('\n  - ')}`);
});

// ── i18n: EN 残留词表不新增（与 scripts/i18n-residual-baseline.json 比对）──
// 单一真源是 i18n-residual.mjs 的 collectResidualTokens：覆盖 specGroups + chipNameLabel
// + facets 三个 localizeSpecValue 出口。基线是一份「当前已知不可核验、诚实保留」的残留清单；
// 若未来数据新增了「能查到官方英文出处却忘了补术语表」的中文词，它会作为基线外的新词出现并判失败。
section('i18n: EN 残留词表不新增');
{
  const { collectResidualTokens: scanResiduals } = await import('./i18n-residual.mjs');
  const baseline = JSON.parse(
    readFileSync(join(ROOT, 'scripts/i18n-residual-baseline.json'), 'utf8'),
  );
  const baselineSet = new Set(baseline.tokens ?? []);
  const current = await scanResiduals();
  const regression = current.filter((t) => !baselineSet.has(t));
  check(`EN 残留词表不新增（当前 ${current.length} / 基线 ${baselineSet.size}）`, () => {
    if (regression.length) {
      throw new Error(
        '新增未译中文词：' + regression.join('、') +
          '\n（若系有意补登术语表后残留收窄，跑 `node scripts/i18n-residual.mjs --write-baseline` 更新基线）',
      );
    }
  });
}

// ── 缺失三态判定（评审 2026-10-17：官网真没有 / 本站没采到 / 品类无此项 必须可区分）──
section('缺失三态判定');
{
  const { classifyMissing, isNonePlaceholder } = await import('./lib/missing-state.mjs');
  check('有真值 → value（null 与空串不构成值）', () => {
    if (classifyMissing([123, null], undefined) !== 'value') throw new Error('数值应判 value');
    if (classifyMissing([null, ''], undefined) === 'value') throw new Error('空串不应算值');
    if (classifyMissing([null, 0], undefined) !== 'value') throw new Error('0 是真值（数据诚信：null 才是没公布）');
  });
  check("占位 '/' / '—' → not_applicable（品类无此项）", () => {
    if (classifyMissing(['/', null], 'specs-page') !== 'not_applicable') throw new Error("/ 应判 not_applicable");
    if (classifyMissing(['—'], undefined) !== 'not_applicable') throw new Error('— 应判 not_applicable');
  });
  check('全空 + specs-page → not_published（官网真没有）', () => {
    if (classifyMissing([null, null], 'specs-page') !== 'not_published') throw new Error('specs-page 全空应判 not_published');
  });
  check('全空 + compare-matrix / 未知粒度 → not_collected（保守：宁可少说，不替官网下结论）', () => {
    if (classifyMissing([null], 'compare-matrix') !== 'not_collected') throw new Error('对比页通道应判 not_collected');
    if (classifyMissing([null], undefined) !== 'not_collected') throw new Error('粒度未知必须保守判 not_collected');
    if (classifyMissing([null], '') !== 'not_collected') throw new Error('空粒度同上');
  });
  check('占位判定不误伤空串与 null', () => {
    if (isNonePlaceholder('')) throw new Error('空串不是占位符');
    if (isNonePlaceholder(null)) throw new Error('null 不是占位符');
    if (isNonePlaceholder('—xx')) throw new Error('含 — 的长文不是占位符');
  });
}

// ── 数据事故防线（评审 2026-10-17 十/§十二-3：串号/倒挂/自嵌套/假精度/双轨）──
section('数据事故防线');
{
  const g = await import('./lib/data-guards.mjs');
  const mk = (over = {}) => ({
    id: 'x-1',
    line: 'X',
    modelCode: 'X1',
    releaseDate: '2020-05',
    releaseDatePrecision: 'month',
    retiredAt: null,
    specs: {},
    ...over,
  });

  check('A 族内串号：同 line 两台同签名同型号代码 → 报出', () => {
    const s = { specs: { 'chipset.name': 'A6', 'chipset.gpu': 'G1', 'display.resolutionPx': { w: 1, h: 1 }, 'body.weightG': 100 } };
    const bad = g.findDuplicateIdentities([mk({ id: 'a', ...s }), mk({ id: 'b', ...s })]);
    if (bad.length !== 1 || bad[0] !== 'X') throw new Error('应报 1 条 ' + JSON.stringify(bad));
  });
  check('A 反向：签名不同 / modelCode 为空的配件类不判串号', () => {
    const s1 = { specs: { 'chipset.name': 'A6', 'body.weightG': 100 } };
    const ok = g.findDuplicateIdentities([
      mk({ id: 'a', ...s1 }),
      mk({ id: 'b', ...s1, modelCode: 'X2' }),
      mk({ id: 'c', ...s1, modelCode: null }), // 无型号代码的配件
      mk({ id: 'd', ...s1, modelCode: null }),
    ]);
    if (ok.length) throw new Error('不应报 ' + JSON.stringify(ok));
  });

  check('B 时间倒挂：停售早于发布 → 报出', () => {
    const bad = g.findInvertedLifetimes([
      mk({ id: 'a', releaseDate: '2012-06', retiredAt: '2008-03' }),
      mk({ id: 'b', releaseDate: '2012-06-11', retiredAt: '2008' }),
    ]);
    if (bad.length !== 2) throw new Error('两条都应报 ' + JSON.stringify(bad));
  });
  check('B 反向：正常生命周期与无停售记录不报', () => {
    const ok = g.findInvertedLifetimes([
      mk({ id: 'a', releaseDate: '2008-03', retiredAt: '2012-06' }),
      mk({ id: 'b', releaseDate: '2012-06-11', retiredAt: null }),
    ]);
    if (ok.length) throw new Error('不应报 ' + JSON.stringify(ok));
  });

  check('C 芯片 token 自嵌套：型号 token 重复且无官网原文 → 报出', () => {
    const bad = g.findChipTokenDuplicates([
      mk({ id: 'a', specs: { 'chipset.name': '麒麟9050 Pro 麒麟9050' } }),
    ]);
    if (bad.length !== 1) throw new Error('应报 ' + JSON.stringify(bad));
  });
  check('C 反向：官网原文照录豁免；两颗芯片并列（M2|R1）不误伤', () => {
    const ok = g.findChipTokenDuplicates([
      mk({ id: 'a', specs: { 'chipset.name': '麒麟9050 Pro 麒麟9050' }, rawOfficial: { 处理器: '麒麟9050 Pro 麒麟9050' } }),
      mk({ id: 'b', specs: { 'chipset.name': 'Apple M2 芯片 | Apple R1 芯片' } }),
    ]);
    if (ok.length) throw new Error('不应报 ' + JSON.stringify(ok));
  });

  check('D 日期精度形状：day 给 YYYY、month 给 YYYY-MM-DD → 报出', () => {
    const bad = g.findDateShapeViolations([
      mk({ id: 'a', releaseDate: '1976', releaseDatePrecision: 'day' }),
      mk({ id: 'b', releaseDate: '1993-01-01', releaseDatePrecision: 'month' }),
    ]);
    if (bad.length !== 2) throw new Error('两条都应报 ' + JSON.stringify(bad));
  });
  check('D 反向：形状与精度一致不报', () => {
    const ok = g.findDateShapeViolations([
      mk({ id: 'a', releaseDate: '1976-07-01', releaseDatePrecision: 'day' }),
      mk({ id: 'b', releaseDate: '2026-10', releaseDatePrecision: 'month' }),
      mk({ id: 'c', releaseDate: '1993', releaseDatePrecision: 'year' }),
    ]);
    if (ok.length) throw new Error('不应报 ' + JSON.stringify(ok));
  });

  check('E 重量双轨：同台并存 weightG 与 weightKg → 报出', () => {
    const bad = g.findDualWeightUnits([
      mk({ id: 'a', specs: { 'body.weightG': 217, 'body.weightKg': 0.217 } }),
    ]);
    if (bad.length !== 1) throw new Error('应报 ' + JSON.stringify(bad));
  });

  check('真实数据当前零违规（五条防线全绿，违规即数据回归）', () => {
    const ps = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8')).products;
    const findings = {
      dup: g.findDuplicateIdentities(ps),
      inv: g.findInvertedLifetimes(ps),
      chip: g.findChipTokenDuplicates(ps),
      date: g.findDateShapeViolations(ps),
      weight: g.findDualWeightUnits(ps),
    };
    const n = findings.dup.length + findings.inv.length + findings.chip.length + findings.date.length + findings.weight.length;
    if (n > 0) {
      throw new Error('真实数据出现事故（每类最多列 5 条）: ' + JSON.stringify(
        Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.slice(0, 5)])),
      ));
    }
  });
}

// ── 较上代派生（评审 2026-10-17 §十一-1：谱系差异是竞品抄不走的能力）──
section('较上代派生');
{
  const gd = await import('./lib/generation-delta.mjs');
  const mp = (over = {}) => ({
    id: 'x-2',
    brand: 'b',
    line: 'L',
    releaseDate: '2021-01',
    specs: {},
    ...over,
  });

  check('代际链：同线按发布排序，上一代 = 严格更早且最近', () => {
    const a = mp({ id: 'a', releaseDate: '2020-01' });
    const b = mp({ id: 'b', releaseDate: '2020-06' });
    const c = mp({ id: 'c', releaseDate: '2021-01' });
    const chain = gd.buildGenerationChains([c, a, b]);
    if (chain.get('c')?.id !== 'b') throw new Error('c 的上一代应是 b');
    if (chain.get('b')?.id !== 'a') throw new Error('b 的上一代应是 a');
    if (chain.get('a')) throw new Error('首代不应有上一代');
  });
  check('代际链反向：跨品牌/跨线不成链，缺发布日期不入链', () => {
    const chain = gd.buildGenerationChains([
      mp({ id: 'a', releaseDate: '2020-01' }),
      mp({ id: 'b', brand: 'other', releaseDate: '2021-01' }),
      mp({ id: 'c', line: 'Other', releaseDate: '2021-02' }),
      mp({ id: 'd', releaseDate: null }),
    ]);
    if (chain.get('b') || chain.get('c') || chain.get('d')) throw new Error('不应成链');
  });

  check('差异摘要：双方都有值才出现，符号正确', () => {
    const cur = mp({ specs: { 'battery.capacityMah': 6600, 'body.weightG': 217, 'display.sizeIn': 6.9 } });
    const old = mp({ specs: { 'battery.capacityMah': 6100, 'body.weightG': 229, 'display.sizeIn': 6.75 } });
    const d = gd.generationDelta(cur, old);
    if (d.battery !== 500) throw new Error('battery Δ ' + d.battery);
    if (d.weight !== -12) throw new Error('weight Δ ' + d.weight);
    if (d.size !== 0.15) throw new Error('size Δ ' + d.size);
  });
  check('差异摘要反向：单边缺失不出现（绝不估算补位），无上代 → null', () => {
    const d1 = gd.generationDelta(
      mp({ specs: { 'battery.capacityMah': 6600 } }),
      mp({ specs: {} }),
    );
    if (d1 == null || 'battery' in d1) throw new Error('单边缺电池不应出现该字段');
    if (gd.generationDelta(mp({}), null) !== null) throw new Error('无上代应返回 null');
    const d2 = gd.generationDelta(mp({ specs: {} }), mp({ specs: {} }));
    if (d2 == null || Object.keys(d2).length !== 0) throw new Error('无可比字段应为空对象');
  });
  check('Kg/G 归一：上代 Kg 本机 G 可比', () => {
    const d = gd.generationDelta(
      mp({ specs: { 'body.weightG': 200 } }),
      mp({ specs: { 'body.weightKg': 0.25 } }),
    );
    if (d.weight !== -50) throw new Error('weight Δ ' + d.weight);
  });
  check('徽章文本：优先电池，带符号', () => {
    if (gd.deltaBadgeText({ battery: 500 }, 'zh') !== '+500 mAh') throw new Error('battery 文案');
    if (gd.deltaBadgeText({ weight: -12 }, 'zh') !== '-12 g') throw new Error('weight 文案');
    if (gd.deltaBadgeText({}, 'zh') !== null) throw new Error('空差异不渲染');
  });
}

/* ================================================================ *
 * 汇总
 * ================================================================ */
console.log('');
if (failures.length) {
  console.log('─'.repeat(64));
  for (const f of failures) {
    console.log(`❌ [${f.group}] ${f.name}`);
    console.log(`   ${f.message.split('\n').slice(0, 4).join('\n   ')}\n`);
  }
  console.log('─'.repeat(64));
  console.log(`自测结果：${passed} 项通过，${failures.length} 项失败\n`);
  process.exit(1);
}

console.log(`✅ 自测全通过：${passed} 项`);
console.log('');
console.log('改了解析器或闸门之后请重跑这条命令：node scripts/selftest.mjs');
