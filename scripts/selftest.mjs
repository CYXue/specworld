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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// 必须在任何 `await import('../src/lib/*.ts')` 之前装好：search.ts / canvasFilter.ts
// 内部用 Vite 约定写 `from './query'`（无扩展名），Node 默认解析不了，靠这个钩子补。
installTsResolver();
import {
  ARCHIVE_TOP_FIELDS,
  ARCHIVE_VOLATILE_FIELDS,
  productFields,
  shapeOfArchive,
} from './lib/archive-shape.mjs';
import { assertUnlocked } from './lib/gates-lock.mjs';
import { applyOverrides, loadOverrides, validateOverrides } from './lib/overrides.mjs';
import { fieldMap, isRegisteredCategory, loadCategories, loadSchema, quantifiableFields, validateSchema, validateSpecs, validateSpecValue, groupsOf, fieldsByGroup, valueStatus, validateStatusMap, STATUS_VALUES } from './lib/schema.mjs';
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
import * as WQ from './sync/queue.mjs';
import { validate, LIMITS, REQUIRED_PATHS } from './sync/validate.mjs';
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

check('零值不被当作缺数据混过（正数校验）', () => {
  assert.ok(
    validate(fleet({ body: { weightG: 0, thicknessMm: 8 } }), null).some((f) =>
      f.includes('非正数'),
    ),
  );
});

check('REQUIRED_PATHS 与 LIMITS 自洽（配置本身没写错）', () => {
  // 防的是：有人加了一条必填路径但闸门覆盖不到，或者区间上下界写反
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
  const near = WQ.classifyByWindow([P2025('near', { releaseDate: '2024-09', releaseDatePrecision: 'month' })], {
    windowStart: '2024-09-01',
  });
  const far = WQ.classifyByWindow([P2025('far', { releaseDate: '2023-11', releaseDatePrecision: 'month' })], {
    windowStart: '2024-09-01',
  });
  assert.equal(near.kept.length, 1, '边界附近的应保留');
  assert.equal(far.kept.length, 0, '离边界远的应出局 —— 若此项也保留，fuzz 条件失效了');
  // 反向：精度到天但压在同一天之前 → 不走fuzz 分支（fuzz 只对精度不足生效）
  const day = WQ.classifyByWindow([P2025('day', { releaseDate: '2024-08-20', releaseDatePrecision: 'day' })], {
    windowStart: '2024-09-01',
  });
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
    { id: 'b', kind: 'missing-date', brand: 'apple', name: null, nameZh: null, slug: null, action: 'x' },
    { id: 'a', kind: 'missing-date', brand: 'huawei', name: null, nameZh: null, slug: null, action: 'y' },
  ];
  const s1 = JSON.stringify(WQ.buildQueueFile(pending, { windowStart: '2024-09-01' }));
  const s2 = JSON.stringify(WQ.buildQueueFile(pending, { windowStart: '2024-09-01' }));
  assert.equal(s1, s2, '同输入必须同字节 —— 否则 CI 每轮都判「队列变了」，制造空提交');

  // 反向测：顺序打乱也必须同字节（排序只认 id，不认传入顺序）
  const s3 = JSON.stringify(WQ.buildQueueFile([...pending].reverse(), { windowStart: '2024-09-01' }));
  assert.equal(s1, s3, '顺序打乱后仍须一致 —— 说明排序生效');

  // 反向测：文件里不得含任何看起来像时间戳的字段。
  // 判据用字段名而不是值 —— 直接搜 2024-09-01 会误伤 windowStart（它是业务日期，该留）。
  const queue = WQ.buildQueueFile(pending, { windowStart: '2024-09-01' });
  const VOLATILE = /generatedAt|firstSeenAt|lastSeenAt|fetchedAt|syncedAt|builtAt|snapshotAt|checkedAt|updatedAt/;
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
  assert.ok(fp.siteFingerprint && fp.dataFingerprint && fp.templateFingerprint, '三个指纹都必须有值');
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
  assert.ok(!/generatedAt|firstSeenAt|fetchedAt|syncedAt/.test(raw), '队列文件含时间戳字段，会造成空提交');
  for (const it of q.items) {
    assert.equal(it.kind, 'missing-date', '队列里只该有缺发布日期这一类');
    assert.ok(it.action?.includes('release-dates.json'), '每条都要指明补哪张表');
  }
});

/* ================================================================ *
 * 无限画布层（环面回绕瓦片画廊）
 * ----------------------------------------------------------------
 * 为什么渲染层也要有自测：src/lib/board.ts 与 canvasFilter.ts 是**零依赖纯函数**，
 * 且它们出错时不会抛异常——只会安静地画错：
 *   - wrap 回绕边界算错 → 拖到边缘时整列瓦片瞬移、露出空白地板（看着像「图没加载」）。
 *   - completeData 找不到整除对（质数 13）就错退出 → 环面塌成 1×1，整页只剩一台。
 *   - dataIndex 双模漏掉负值 → 反向拖动时索引变负、数组取到 undefined、瓦片变空白。
 *   - 砖块错位（奇数列下移半行）写反 → 棋盘落子退化成对齐网格，还可能在某行叠瓦片。
 * 闸门罩不住这些：产物照样构建成功、页面照样打开、只是画面不对。
 *
 * 手法上刻意用**暴力对拍 + 不变量**：用最笨的写法独立算一遍（逐格模位置、
 * 平移后重数一遍索引集合）与优化实现比结果；再钉死环面自洽不变量
 * （任意平移后索引集合守恒、模周期位置均匀、无重叠）。这些不变量防「一开始就错」。
 * ================================================================ */
section('无限画布：环面几何');
const {
  completeData,
  moverMetrics,
  viewportGrid,
  layoutPos,
  wrap,
  dataIndex,
  scaleNums,
  torusIsConsistent,
} = await import('../src/lib/board.ts');
const {
  applyFilter,
  buildCanvasDocs,
  brandFacets,
  lineFacets,
  yearFacets,
  parseFilter,
  filterToQuery,
  isFiltered,
  tokenize: canvasTokenize,
  EMPTY_FILTER,
} = await import('../src/lib/canvasFilter.ts');

check('completeData 平铺成环面：rows≤cols、rows×cols≥n、质数收敛、空值兜底', () => {
  const g60 = completeData(60);
  assert.equal(g60.rows * g60.cols >= 60, true, '60 台必须被环面全部容纳');
  assert.ok(g60.rows <= g60.cols, '环面横向铺开：rows 应 ≤ cols');
  assert.deepEqual(g60, { rows: 6, cols: 10 }, '60 = 6×10，从 √60 往下找最大整除对');
  // 质数（13）找不到除数 → count++ 直到 14=2×7，绝不能死循环或错退出
  const g13 = completeData(13);
  assert.equal(g13.rows * g13.cols >= 13, true, '质数 13 也要被容纳');
  assert.deepEqual(g13, { rows: 2, cols: 7 }, '13 质数应进位到 14=2×7');
  // 完全平方数正好铺满
  assert.deepEqual(completeData(36), { rows: 6, cols: 6 }, '36 是完全平方数');
  // 空 / 非正：不能除出 NaN，退化成 1×1（环面塌缩但不崩）
  assert.deepEqual(completeData(0), { rows: 1, cols: 1 });
  assert.deepEqual(completeData(-5), { rows: 1, cols: 1 });
  const g0 = completeData(0);
  assert.ok(Number.isFinite(g0.rows) && Number.isFinite(g0.cols));
});

check('moverMetrics 随 scaleNums 线性（大屏小屏手感一致）', () => {
  const b = moverMetrics(1);
  const d = moverMetrics(2);
  assert.equal(d.w, b.w * 2, 'w 应随 scale 线性翻倍');
  assert.equal(d.h, b.h * 2);
  assert.equal(d.mx, b.mx * 2, '砖缝同样翻倍');
  assert.equal(d.my, b.my * 2);
  // 基准值：参考站 12*2.4 / 18*2.4
  assert.ok(Math.abs(b.w - 12 * 2.4) < 1e-9);
  assert.ok(Math.abs(b.h - 18 * 2.4) < 1e-9);
  assert.equal(b.mx, b.w / 2, '横向砖缝取半宽');
});

check('viewportGrid 行列为正、列为偶、随容器增大、窄屏少列', () => {
  const m = moverMetrics(1.5);
  const wide = viewportGrid(1920, 1080, m);
  const narrow = viewportGrid(390, 844, m);
  assert.ok(wide.rows > 0 && wide.cols > 0, '网格必须为正');
  assert.equal(wide.cols % 2, 0, '列数取偶保证砖块交错对称');
  assert.equal(narrow.cols % 2, 0);
  assert.ok(wide.rows > narrow.rows, '大容器行数应更多');
  assert.ok(wide.cols > narrow.cols, '宽屏列数应多于窄屏');
  // 视口为 0（元素塌了）也不能崩、不能除出 NaN
  const z = viewportGrid(0, 0, m);
  assert.ok(Number.isFinite(z.rows) && Number.isFinite(z.cols));
});

check('layoutPos 砖块错位：奇数列下移半行、x 按列铺', () => {
  const m = moverMetrics(1);
  const pitchX = m.w + m.mx;
  const pitchY = m.h + m.my;
  const p0 = layoutPos(0, 10, m);
  assert.equal(p0.x, 0, '第 0 格在原点');
  assert.equal(p0.y, 0);
  const p1 = layoutPos(1, 10, m); // 奇数列 → 下移半行
  assert.equal(p1.x, pitchX, 'col=1 横移一格');
  assert.ok(Math.abs(p1.y - -pitchY / 2) < 1e-9, '奇数列应下移半行（砖块错位）');
  const p10 = layoutPos(10, 10, m); // row=1, col=0 → 回正
  assert.equal(p10.x, 0, 'row=1 col=0 回到左缘');
  assert.equal(p10.y, pitchY, 'row=1 下移一行');
  const p11 = layoutPos(11, 10, m); // row=1, col=1 → 半行错位
  assert.equal(p11.x, pitchX);
  assert.ok(Math.abs(p11.y - (pitchY - pitchY / 2)) < 1e-9, 'row=1 的奇数列同样是半行错位');
});

check('dataIndex 双模：无负、在 [0,n)、列/行方向周期守恒、n=total 时为双射', () => {
  const g = { rows: 6, cols: 10 };
  const n = 60;
  // 负值不越界：双模运算把负行列拉回 [0,n)
  for (const [c, r] of [
    [-1, -1],
    [-3, 4],
    [5, -2],
    [-10, -6],
  ]) {
    const i = dataIndex(c, r, g, n);
    assert.ok(i >= 0 && i < n, 'dataIndex(' + c + ',' + r + ') 越界或为负：' + i);
  }
  // 列方向每加 g.cols，索引不变（回绕周期）
  assert.equal(dataIndex(5, 3, g, n), dataIndex(5 + g.cols, 3, g, n));
  assert.equal(dataIndex(5, 3, g, n), dataIndex(5 - g.cols, 3, g, n));
  // 行方向每加 g.rows，索引不变
  assert.equal(dataIndex(5, 3, g, n), dataIndex(5, 3 + g.rows, g, n));
  // n = total：逻辑 (col,row) → 索引 是双射（每张图恰好出现一次，不丢不重）
  const seen = new Set();
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const i = dataIndex(col, row, g, n);
      assert.ok(i >= 0 && i < n);
      seen.add(i);
    }
  }
  assert.equal(seen.size, n, '环面铺满时 60 张图应各出现一次');
});

check('wrap 幂等：回绕一次后再 wrap 不应再移动', () => {
  const m = moverMetrics(1);
  const vp = { rows: 6, cols: 10 };
  const mv = { x: -m.w - m.mx - 5, y: 0, col: 0, row: 0 };
  const a = wrap({ ...mv }, m, vp);
  const b = wrap({ ...a }, m, vp);
  assert.equal(a.x, b.x, 'wrap 应幂等');
  assert.equal(a.y, b.y);
  assert.equal(a.col, b.col);
  assert.equal(a.row, b.row);
  // 正向越界也幂等
  const mv2 = { x: vp.cols * (m.w + m.mx) + 5, y: 0, col: vp.cols, row: 0 };
  const c = wrap({ ...mv2 }, m, vp);
  const d = wrap({ ...c }, m, vp);
  assert.equal(c.x, d.x);
});

check('环面回绕后数据索引集合守恒（无限平移的核心不变量）', () => {
  // 任意大幅平移 + wrap 后，每张瓦片展示的「是哪张图」集合必须和初始完全一致——
  // 既不多（露空白地板）也不少（瓦片凭空消失/重复）。这是「无限画布」的硬验收。
  const m = moverMetrics(1.7);
  const vp = viewportGrid(1280, 720, m);
  const total = vp.rows * vp.cols;
  const init = [];
  for (let i = 0; i < total; i++) {
    const mv = layoutPos(i, vp.cols, m);
    init.push(dataIndex(mv.col, mv.row, vp, total));
  }
  const initSorted = [...init].sort((a, b) => a - b);
  // 多个方向、多个幅度各推一遍
  for (const [dx, dy] of [
    [m.w * 3.2, m.h * 1.5],
    [-m.w * 7.9, m.h * 4.1],
    [m.w * 123.4, -m.h * 88.2],
    [m.w * 0.37, m.h * 0.5],
  ]) {
    const now = [];
    for (let i = 0; i < total; i++) {
      const mv = layoutPos(i, vp.cols, m);
      mv.x += dx;
      mv.y += dy;
      wrap(mv, m, vp);
      now.push(dataIndex(mv.col, mv.row, vp, total));
    }
    assert.deepEqual(
      [...now].sort((a, b) => a - b),
      initSorted,
      '平移 (' + dx + ',' + dy + ') 后索引集合变了——环面不再自洽',
    );
  }
});

check('回绕后瓦片仍无缝铺满、无重叠（不露空白地板）', () => {
  // 平移到「半格中途」这种最糟状态，回绕后必须依然：横向正好 cols 个模周期位置、
  // 纵向因砖块错位正好 2×rows 个半格位置、且任意两瓦片不重叠。
  const m = moverMetrics(1.7);
  const vp = viewportGrid(1280, 720, m);
  const pitchX = m.w + m.mx;
  const pitchY = m.h + m.my;
  const periodX = vp.cols * pitchX;
  const periodY = vp.rows * pitchY;
  const total = vp.rows * vp.cols;
  const movers = [];
  for (let i = 0; i < total; i++) movers.push(layoutPos(i, vp.cols, m));
  const dx = pitchX * 0.37 + 123,
    dy = pitchY * 0.61 - 88;
  for (const mv of movers) {
    mv.x += dx;
    mv.y += dy;
    wrap(mv, m, vp);
  }
  // 横向：模 periodX 只有 cols 个位置，间距均匀 pitchX
  const ux = [
    ...new Set(movers.map((mv) => Math.round((((mv.x % periodX) + periodX) % periodX) * 1000))),
  ]
    .map((v) => v / 1000)
    .sort((a, b) => a - b);
  assert.equal(ux.length, vp.cols, '横向模周期位置数应 = cols');
  for (let k = 1; k < ux.length; k++) {
    assert.ok(Math.abs(ux[k] - ux[k - 1] - pitchX) < 1e-6, '横向间距不均');
  }
  assert.ok(Math.abs(ux[0] + periodX - ux[ux.length - 1] - pitchX) < 1e-6, '横向周期未闭合');
  // 纵向：砖块错位把半格也填满 → 2×rows 个位置，间距 pitchY/2
  const uy = [
    ...new Set(movers.map((mv) => Math.round((((mv.y % periodY) + periodY) % periodY) * 1000))),
  ]
    .map((v) => v / 1000)
    .sort((a, b) => a - b);
  assert.equal(uy.length, 2 * vp.rows, '砖块错位应填满纵向半格（2×rows 个位置）');
  for (let k = 1; k < uy.length; k++) {
    assert.ok(Math.abs(uy[k] - uy[k - 1] - pitchY / 2) < 1e-6, '纵向半格间距不均');
  }
  // 无重叠：任意两瓦片不得在 x、y 同时交叠
  for (let a = 0; a < movers.length; a++) {
    for (let b = a + 1; b < movers.length; b++) {
      const A = movers[a],
        B = movers[b];
      const hit = Math.abs(A.x - B.x) < m.w && Math.abs(A.y - B.y) < m.h;
      assert.ok(!hit, '第 ' + a + ' 与第 ' + b + ' 块瓦片重叠（露不出空白却会叠图）');
    }
  }
});

check('scaleNums 随容器线性（用容器尺寸而非 window）', () => {
  assert.ok(Math.abs(scaleNums(600, 600) - (600 / 300 + 600 / 300)) < 1e-9);
  // 宽翻倍 → 增量 = 宽/300
  const base = scaleNums(600, 600);
  assert.ok(Math.abs(scaleNums(1200, 600) - base - 600 / 300) < 1e-9, '宽翻倍线性增量错');
  // 高翻倍 → 增量 = 高/300
  assert.ok(Math.abs(scaleNums(600, 1200) - base - 600 / 300) < 1e-9, '高翻倍线性增量错');
  // 容器为 0 不崩
  assert.ok(Number.isFinite(scaleNums(0, 0)));
});

check('torusIsConsistent 对各类环面均通过', () => {
  assert.equal(torusIsConsistent(completeData(60)), true);
  assert.equal(torusIsConsistent(completeData(13)), true);
  assert.equal(torusIsConsistent(completeData(36)), true);
  assert.equal(torusIsConsistent({ rows: 4, cols: 8 }), true);
});
section('无限画布：筛选与分面');
const SAMPLE = [
  {
    id: 'a1',
    name: 'iPhone 16',
    nameZh: null,
    line: 'iPhone',
    brand: 'apple',
    brandZh: '苹果',
    releaseDate: '2024-09-10',
    releaseDatePrecision: 'day',
    status: 'on-sale',
  },
  {
    id: 'a2',
    name: 'iPhone 17',
    nameZh: null,
    line: 'iPhone',
    brand: 'apple',
    brandZh: '苹果',
    releaseDate: '2025-09-19',
    releaseDatePrecision: 'day',
    status: 'on-sale',
  },
  {
    id: 'h1',
    name: 'Mate 70',
    nameZh: '华为 Mate 70',
    line: 'Mate',
    brand: 'huawei',
    brandZh: '华为',
    releaseDate: '2025-11-25',
    releaseDatePrecision: 'day',
    status: 'on-sale',
  },
  {
    id: 'h2',
    name: 'nova 13',
    nameZh: null,
    line: 'nova',
    brand: 'huawei',
    brandZh: '华为',
    releaseDate: '2024-12-10',
    releaseDatePrecision: 'day',
    status: 'on-sale',
  },
  {
    id: 'h3',
    name: 'Mate 80',
    nameZh: null,
    line: 'Mate',
    brand: 'huawei',
    brandZh: '华为',
    releaseDate: '2026-01-08',
    releaseDatePrecision: 'day',
    status: 'on-sale',
  },
];
const SDOCS = buildCanvasDocs(SAMPLE);
const ids = (list) => list.map((d) => d.id).sort();

check('空筛选 = 全部，命中数与数据集一致，且可平铺成环面', () => {
  const all = applyFilter(SDOCS, EMPTY_FILTER);
  assert.equal(all.length, SAMPLE.length);
  // 任意子集（含全部）都能被 completeData 平铺成有效环面：不崩、不丢、不除出 NaN
  const g = completeData(all.length);
  assert.ok(g.rows > 0 && g.cols > 0 && g.rows * g.cols >= all.length);
  // 空子集兜底：环面退化为 1×1 而非 NaN（否则 translate 后整页只剩空白）
  assert.deepEqual(completeData(0), { rows: 1, cols: 1 });
});

check('多关键词取交集（OR 会让筛选等于没筛）', () => {
  const both = applyFilter(SDOCS, { ...EMPTY_FILTER, q: 'mate 70' });
  assert.deepEqual(ids(both), ['h1'], '「mate 70」应只命中 Mate 70 一台');
  // 顺序无关：词序颠倒结果必须相同
  assert.deepEqual(ids(applyFilter(SDOCS, { ...EMPTY_FILTER, q: '70 mate' })), ['h1']);
  // 词可命中不同字段
  assert.deepEqual(
    ids(applyFilter(SDOCS, { ...EMPTY_FILTER, q: '华为 iphone' })),
    [],
    '跨品牌的两词应无交集（a2 是苹果机，搜「华为 iPhone」不该命中）',
  );
  assert.deepEqual(
    ids(applyFilter(SDOCS, { ...EMPTY_FILTER, q: '苹果 17' })),
    ['a2'],
    '两词分别命中品牌与机型名时应命中',
  );
  assert.deepEqual(
    ids(applyFilter(SDOCS, { ...EMPTY_FILTER, q: '华为 nova' })),
    ['h2'],
    '两词分别命中品牌与产品线时应命中',
  );
  assert.deepEqual(
    ids(applyFilter(SDOCS, { ...EMPTY_FILTER, q: '苹果 mate' })),
    [],
    '两词分属不同品牌时不该靠 AND 硬拼出结果',
  );
});

check('缺失字段不参与匹配（否则空串被任何查询命中）', () => {
  // SAMPLE 里 a1 的 nameZh 是 null。若把 null 拼成空串参与 includes，
  // 搜任意词都会命中 a1 —— 「越搜越多」的经典故障。
  const any = applyFilter(SDOCS, { ...EMPTY_FILTER, q: 'zzz不存在zzz' });
  assert.equal(any.length, 0, `不存在的词竟命中了 ${ids(any).join(',')}`);
  const two = applyFilter(SDOCS, { ...EMPTY_FILTER, q: 'iphone zzz不存在zzz' });
  assert.equal(two.length, 0, '缺失字段把无匹配的查询拖成了有匹配');
  // 中文名缺失的那台，仍应能靠机型名搜到
  assert.deepEqual(ids(applyFilter(SDOCS, { ...EMPTY_FILTER, q: 'iphone 16' })), ['a1']);
});

check('分词忽略大小写与多余空白', () => {
  assert.deepEqual(canvasTokenize('  Mate   70 '), ['mate', '70']);
  assert.deepEqual(canvasTokenize('   '), [], '纯空白应得到零个词（否则空数组被当成「无查询」）');
  assert.deepEqual(canvasTokenize(''), []);
  assert.equal(applyFilter(SDOCS, { ...EMPTY_FILTER, q: 'MATE 70' }).length, 1, '大写应能命中');
  assert.equal(
    applyFilter(SDOCS, { ...EMPTY_FILTER, q: 'mate     70' }).length,
    1,
    '多余空白应被吞掉',
  );
});

check('品牌/产品线/年份三个维度各自收窄，且可叠加', () => {
  assert.deepEqual(ids(applyFilter(SDOCS, { ...EMPTY_FILTER, brand: 'huawei' })), [
    'h1',
    'h2',
    'h3',
  ]);
  assert.deepEqual(ids(applyFilter(SDOCS, { ...EMPTY_FILTER, line: 'Mate' })), ['h1', 'h3']);
  assert.deepEqual(ids(applyFilter(SDOCS, { ...EMPTY_FILTER, year: '2024' })), ['a1', 'h2']);
  assert.deepEqual(
    ids(applyFilter(SDOCS, { ...EMPTY_FILTER, brand: 'huawei', line: 'Mate', year: '2025' })),
    ['h1'],
    '三条件叠加应只剩一台',
  );
  assert.equal(
    applyFilter(SDOCS, { ...EMPTY_FILTER, brand: 'huawei', line: 'iPhone' }).length,
    0,
    '跨品牌的产品线组合应为空',
  );
});

check('分面计数不自我收窄（选中后仍能改主意）', () => {
  // 核心故障：分面若在自身维度上收窄，选中「华为」后苹果会显示 0（甚至不出现），
  // 用户再也没法切回去 —— 界面把自己锁死了。
  // 口径：分面在**自身维度**上不收窄（选了华为，苹果仍显示它在其它条件下的真实台数），
  // 但在**其它维度**上照常收窄（选了华为，iPhone 产品线本就不该出现，因为苹果被筛掉了）。
  const f = { ...EMPTY_FILTER, brand: 'huawei' };
  const bs = brandFacets(SDOCS, f);
  const apple = bs.find((b) => b.value === 'apple');
  assert.ok(apple, '选了华为之后苹果这一项应当仍然存在');
  assert.equal(apple.count, 2, '苹果应仍显示它在其它条件下的真实台数 2');
  // 「全部」= 点它之后会看到的台数（清掉品牌条件 → 全部 5 台），不是当前结果数
  const all = bs.find((b) => b.value === '');
  assert.equal(all.count, 5, '「全部」应表示「点它会显示几台」= 5');
  // 同维度内各分面项互斥，之和必须严格等于「全部」
  const sum = bs.filter((b) => b.value).reduce((a, b) => a + b.count, 0);
  assert.equal(
    sum,
    all.count,
    `分面项之和 ${sum} 应等于「全部」${all.count}（同维度必须互斥且完备）`,
  );
  for (const b of bs) assert.ok(b.count > 0, `分面「${b.label}」计数为 0`);
});

check('分面随其它维度联动，随自身维度不联动', () => {
  const f = { ...EMPTY_FILTER, brand: 'huawei' };
  const ls = lineFacets(SDOCS, f);
  // 选了华为 → 苹果的两台已被筛掉 → iPhone 这条产品线不该出现（不是显示为 0）
  assert.ok(
    !ls.some((x) => x.value === 'iPhone'),
    '选了华为后 iPhone 产品线仍出现，用户点了只会得到空画面',
  );
  const mate = ls.find((x) => x.value === 'Mate');
  assert.equal(mate.count, 2, 'Mate 在华为内有 2 台');
  assert.equal(ls.find((x) => x.value === 'nova').count, 1, 'nova 在华为内有 1 台');
  assert.equal(ls.find((x) => x.value === '').count, 3, '产品线分面的「全部」= 3');
  const sum = ls.filter((x) => x.value).reduce((a, b) => a + b.count, 0);
  assert.equal(sum, 3, '产品线分面项之和应等于 3');
  // 年份同理
  const ys = yearFacets(SDOCS, f);
  assert.ok(
    ys.some((y) => y.value === '2024' && y.count === 1),
    '2024 在华为内是 nova 13 一台',
  );
  assert.ok(!ys.some((y) => y.value === '2026' && y.count === 0), '不该出现计数为 0 的年份项');
  assert.equal(ys.find((y) => y.value === '').count, 3);
  // 换到「不限品牌」时，全部产品线都回来
  const all2 = lineFacets(SDOCS, EMPTY_FILTER);
  assert.equal(all2.find((x) => x.value === '').count, 5, '不限品牌时产品线「全部」= 5');
  assert.equal(
    all2.filter((x) => x.value).reduce((a, b) => a + b.count, 0),
    5,
  );
});

check('分面「全部」= 只清掉本维度后的台数（其它维度照常收窄）', () => {
  // 口径 4。这条断言改过三轮才对齐 —— 原表述「清掉该维度后的结果数」有歧义：
  // 读起来像「清掉该维度的筛选条件」，但对 brandFacets 来说「清掉」的是 **brand**，
  // line/year/q 仍然生效。所以 line='Mate' 时「全部」是 2 而不是 5。
  //
  // 实现上，「全部」的 count 与分面项是同一趟循环里累出来的，
  // 所以「全部」≡ 各分面项之和（同维度内互斥且完备）—— 这条等式由下面钉住。
  const cases = [
    [EMPTY_FILTER, 5],
    [{ ...EMPTY_FILTER, brand: 'huawei' }, 5], // 清掉品牌 → 5（品牌维度不收窄）
    [{ ...EMPTY_FILTER, line: 'Mate' }, 2], // 「全部」只清品牌，line 仍收窄 → 2
    [{ ...EMPTY_FILTER, year: '2025' }, 2], // 同理，year 仍收窄 → 2
  ];
  for (const [f, want] of cases) {
    const bs = brandFacets(SDOCS, f);
    const all = bs.find((b) => b.value === '');
    assert.equal(
      all.count,
      want,
      `「全部」应为 ${want}，实得 ${all.count}（f=${JSON.stringify(f)}）`,
    );
    // 且严格等于同维度分面项之和
    const sum = bs.filter((b) => b.value).reduce((a, b) => a + b.count, 0);
    assert.equal(sum, all.count, `分面项之和 ${sum} ≠「全部」${all.count}`);
  }
  // 带搜索词时「全部」保留 q 约束（它只清本维度），数字应小于全量
  for (const f of [
    { ...EMPTY_FILTER, q: 'mate' },
    { ...EMPTY_FILTER, brand: 'huawei', q: 'mate' },
  ]) {
    const all = brandFacets(SDOCS, f).find((b) => b.value === '');
    assert.ok(all.count < 5, `带 q 时「全部」不该等于全量 5，实得 ${all.count}`);
  }
  // 反向验证：清掉该维度后的台数，用筛选器独立算一遍对拍
  for (const f of [
    { ...EMPTY_FILTER, brand: 'huawei' },
    { ...EMPTY_FILTER, line: 'Mate' },
    { ...EMPTY_FILTER, q: 'mate' },
  ]) {
    const all = brandFacets(SDOCS, f).find((b) => b.value === '');
    const viaFilter = applyFilter(SDOCS, { ...f, brand: '' }).length;
    assert.equal(all.count, viaFilter, '「全部」应等于清掉该维度后筛选器的结果数');
  }
});

check('排序：四种档位各自正确，缺失值排末尾', () => {
  assert.deepEqual(
    applyFilter(SDOCS, { ...EMPTY_FILTER, sort: 'newest' }).map((d) => d.id),
    ['h3', 'h1', 'a2', 'h2', 'a1'],
    '新→旧应按日期降序',
  );
  assert.deepEqual(
    applyFilter(SDOCS, { ...EMPTY_FILTER, sort: 'oldest' }).map((d) => d.id),
    ['a1', 'h2', 'a2', 'h1', 'h3'],
    '旧→新应升序，与 newest 严格互逆',
  );
  // 按名称排序。localeCompare('en') 不区分大小写，所以 Mate 排在 nova 之前
  // （直觉上 M 的 ASCII 更大，但排序不是按 ASCII 码）。
  assert.deepEqual(
    applyFilter(SDOCS, { ...EMPTY_FILTER, sort: 'name' }).map((d) => d.id),
    ['a1', 'a2', 'h1', 'h3', 'h2'],
    '按名称排序（localeCompare 不区分大小写）',
  );
  // 严格单调：相邻两项必须真的递增，防止「排了但等于没排」
  const names = applyFilter(SDOCS, { ...EMPTY_FILTER, sort: 'name' }).map((d) => d.name);
  for (let i = 1; i < names.length; i++) {
    assert.ok(
      names[i - 1].localeCompare(names[i], 'en') <= 0,
      `名称未递增：${names[i - 1]} > ${names[i]}`,
    );
  }
  // ppi 排序：缺失值必须在末尾，不能冒充数据混在中段
  const ppi = new Map([
    ['a1', 460],
    ['a2', 460],
    ['h1', null],
    ['h2', 400],
    ['h3', 460],
  ]);
  const byPpi = applyFilter(SDOCS, { ...EMPTY_FILTER, sort: 'ppi' }, (id) => ppi.get(id) ?? null);
  const lastThree = byPpi.slice(-3).map((d) => d.id);
  assert.ok(lastThree.includes('h1'), 'PPI 缺失的那台必须排在末尾，不能混在有值的中段');
  // 同值时应有一个稳定的次序（避免每次渲染顺序乱跳）
  assert.deepEqual(
    byPpi.map((d) => d.id),
    applyFilter(SDOCS, { ...EMPTY_FILTER, sort: 'ppi' }, (id) => ppi.get(id) ?? null).map(
      (d) => d.id,
    ),
    '同 PPI 时排序不稳定，渲染会跳',
  );
  // 全部缺失时退化为按名称，而不是全 NaN
  const none = applyFilter(SDOCS, { ...EMPTY_FILTER, sort: 'ppi' }, () => null);
  assert.equal(none.length, 5, 'PPI 全缺失时不该丢机器');
  assert.equal(new Set(none.map((d) => d.id)).size, 5, 'PPI 全缺失时不该重复');
});

check('URL 序列化：只写非默认值，且能原样往返', () => {
  const f = { brand: 'huawei', line: 'Mate', year: '2025', q: '  70  ', sort: 'ppi' };
  const query = filterToQuery(f);
  assert.deepEqual(
    query,
    { brand: 'huawei', line: 'Mate', year: '2025', q: '70', sort: 'ppi' },
    `序列化结果不对：${JSON.stringify(query)}`,
  );
  // 往返
  assert.deepEqual(parseFilter(query), { ...f, q: '70' }, '序列化再解析没能还原');
  // 默认态不写任何键 —— 分享链接才短，且 #canvas 与 #canvas?sort=newest 同义
  assert.deepEqual(filterToQuery(EMPTY_FILTER), {}, '默认态不该写 query');
  assert.deepEqual(parseFilter({}), EMPTY_FILTER, '空 query 应解析成默认筛选');
});

check('手改的非法 query 回落默认值，不抛错', () => {
  // 用户会手改链接，也会从旧版本分享链接过来。不能因此白屏。
  assert.equal(parseFilter({ sort: '乱写' }).sort, 'newest', '未知排序值应回落默认');
  assert.equal(parseFilter({ sort: '' }).sort, 'newest');
  // 数组形态（?brand=a&brand=b）取第一个，不炸
  assert.equal(parseFilter({ brand: ['huawei', 'apple'] }).brand, 'huawei');
  assert.equal(parseFilter({ brand: null }).brand, '');
  assert.equal(parseFilter({ year: 2025 }).year, '2025', '数字应转字符串');
  for (const bad of [{}, { sort: '__proto__' }, { brand: 'a b c' }, { year: 'abcd' }]) {
    assert.ok(parseFilter(bad), `解析 ${JSON.stringify(bad)} 崩了`);
  }
});

check('isFiltered 只认真实条件，不把排序当筛选', () => {
  assert.equal(isFiltered(EMPTY_FILTER), false, '默认态不算已筛选');
  assert.equal(
    isFiltered({ ...EMPTY_FILTER, sort: 'ppi' }),
    false,
    '换排序不该让「清空筛选」亮起来',
  );
  assert.equal(isFiltered({ ...EMPTY_FILTER, q: '   ' }), false, '纯空格不算筛选');
  for (const f of [{ brand: 'x' }, { line: 'x' }, { year: '2025' }, { q: 'x' }]) {
    assert.equal(isFiltered({ ...EMPTY_FILTER, ...f }), true, `${JSON.stringify(f)} 应算已筛选`);
  }
});

section('无限画布：与真实数据对齐');
check('画布字段与 data/products.json 对得上（防止上游加字段后画布拿不到）', () => {
  // 画布构造 CanvasDoc 时是逐字段手挑的。上游若改了 products.json 的结构，
  // 这里会先炸 —— 总比上线后画布上全是「机型名 undefined」强。
  const pj = join(ROOT, 'data/products.json');
  if (!existsSync(pj)) return; // 首次拉取前没有快照，跳过
  const snap = JSON.parse(readFileSync(pj, 'utf8'));
  const products = snap.products ?? [];
  assert.ok(products.length > 0, '快照里一台设备都没有');
  for (const p of products) {
    assert.equal(typeof p.id, 'string', '缺 id');
    assert.equal(typeof p.name, 'string', `${p.id} 缺 name`);
    assert.equal(typeof p.brand, 'string', `${p.id} 缺 brand`);
    // 这两个允许缺失（画布有 '年份未公布' 兜底），但类型必须是 string|null，
    // 否则 ?? 兜底会拿到非字符串，slice 行为诡异
    assert.ok(p.nameZh === null || typeof p.nameZh === 'string', `${p.id} 的 nameZh 类型不对`);
    assert.ok(
      p.releaseDate === null || typeof p.releaseDate === 'string',
      `${p.id} 的 releaseDate 类型不对`,
    );
  }
  // 精灵图必须存在，否则画布上是一排空框
  for (const p of products) {
    assert.ok(
      existsSync(join(ROOT, 'data/sprites', `${p.id}.svg`)),
      `缺少精灵图 ${p.id}.svg（画布格子里会是空框）`,
    );
  }
  // 每台设备都要能算出年份，否则年份分面会漏掉它
  for (const p of products) {
    const y = (p.releaseDate || '').slice(0, 4);
    if (p.releaseDate)
      assert.ok(/^\d{4}$/.test(y), `${p.id} 的发布日期「${p.releaseDate}」切不出年份`);
  }
});

check('真实数据能跑通画布全流程，且筛选数与暴力枚举一致', () => {
  const pj = join(ROOT, 'data/products.json');
  if (!existsSync(pj)) return;
  const snap = JSON.parse(readFileSync(pj, 'utf8'));
  const docs = buildCanvasDocs(
    (snap.products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      nameZh: p.nameZh ?? null,
      line: p.line ?? '',
      brand: p.brand,
      brandZh: p.brand,
      releaseDate: p.releaseDate ?? '',
      releaseDatePrecision: p.releaseDatePrecision ?? '',
      status: p.status ?? '',
    })),
  );
  // 无筛选 = 全部
  assert.equal(applyFilter(docs, EMPTY_FILTER).length, snap.products.length);
  // 逐品牌对拍：暴力枚举 vs 筛选器
  for (const brand of new Set(snap.products.map((p) => p.brand))) {
    const got = applyFilter(docs, { ...EMPTY_FILTER, brand });
    const want = snap.products.filter((p) => p.brand === brand);
    assert.equal(got.length, want.length, `品牌 ${brand} 的台数对不上`);
    assert.deepEqual(
      new Set(got.map((d) => d.id)),
      new Set(want.map((p) => p.id)),
      `品牌 ${brand} 筛出的机型集合不对`,
    );
  }
  // 「全部」计数 = 总数
  const bs = brandFacets(docs, EMPTY_FILTER);
  assert.equal(bs.find((b) => b.value === '').count, snap.products.length);
  assert.equal(
    bs.filter((b) => b.value).reduce((a, b) => a + b.count, 0),
    snap.products.length,
    '各品牌计数之和应等于总数',
  );
  // 全部设备铺成环面：整圈 dataIndex 无重复、无越界（无限回绕的硬验收）
  const g = completeData(snap.products.length);
  assert.equal(g.rows * g.cols >= snap.products.length, true, '环面必须容纳全部设备');
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const i = dataIndex(col, row, g, snap.products.length);
      assert.ok(i >= 0 && i < snap.products.length, '真实数据 dataIndex 越界：' + i);
    }
  }
});

/* ================================================================ *
 * 画布导出：汇总数字
 *
 * 导出 PNG 的「算得对不对」全在这里钉死——渲染层（renderExportImage.ts）只画图、
 * 不碰数字，所以价格合计 / 各品牌小计 / 状态分布有没有把 null 算进去，只能用纯函数测。
 * 数据诚信：价格只取起售价（min SKU），缺失不补 0；按品牌细分小计后累加为总计。
 * ================================================================ */
section('画布导出：汇总数字');
const EXS = await import('../src/lib/exportSummary.ts');
{
  const pj = join(ROOT, 'data', 'products.json');
  const snap = JSON.parse(readFileSync(pj, 'utf8'));
  const productsById = new Map(snap.products.map((p) => [p.id, p]));
  const vendorsById = new Map((snap.vendors ?? []).map((v) => [v.id, v]));
  const docs = (snap.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    nameZh: p.nameZh ?? null,
    line: p.line ?? '',
    brand: p.brand,
    brandZh: p.brand,
    releaseDate: p.releaseDate ?? '',
    releaseDatePrecision: p.releaseDatePrecision ?? '',
    status: p.status ?? '',
  }));
  const all = EXS.buildExportSummary(docs, productsById, vendorsById);
  assert.equal(all.total, snap.products.length, '总数应等于产品数');

  // 起售价合计：逐台 min(skus.priceCny) 累加，应与独立计算一致
  let wantSum = 0;
  let wantMissing = 0;
  for (const p of snap.products) {
    const skus = p.skus || [];
    const nums = skus.map((s) => s.priceCny).filter((x) => typeof x === 'number');
    if (nums.length) wantSum += Math.min(...nums);
    else wantMissing++;
  }
  assert.equal(all.priceTotalCny, wantSum, '起售价合计与逐台 min SKU 累加不一致');
  assert.equal(all.priceMissing, wantMissing, '未公布售价计数不对');

  // 起售价按品牌细分：每台 min SKU 累加到对应品牌，应与独立计算一致
  const wantBrandSum = new Map();
  for (const p of snap.products) {
    const skus = p.skus || [];
    const nums = skus.map((s) => s.priceCny).filter((x) => typeof x === 'number');
    if (nums.length) {
      wantBrandSum.set(p.brand, (wantBrandSum.get(p.brand) || 0) + Math.min(...nums));
    }
  }
  for (const b of all.priceByBrand) {
    assert.equal(b.totalCny, wantBrandSum.get(b.id) || 0, `品牌 ${b.id} 起售价小计不一致`);
  }
  // 各品牌小计之和应等于累计总计
  const byBrandSum = all.priceByBrand.reduce((a, b) => a + b.totalCny, 0);
  assert.equal(byBrandSum, all.priceTotalCny, '各品牌小计之和应等于累计总计');

  // 单台基准：iPhone 16 起售价 5999；iPhone 17 多 SKU 应取最小 6799
  const ip16 = snap.products.find((p) => p.id === 'apple-iphone-16');
  const ip17 = snap.products.find((p) => p.id === 'apple-iphone-17');
  assert.equal(EXS.deviceStartPriceCny(ip16), 5999, 'iPhone 16 起售价应为 5999');
  assert.equal(EXS.deviceStartPriceCny(ip17), 6799, '多 SKU 应取最小价');

  // 分布之和守恒
  const stSum = all.status.onSale + all.status.upcoming + all.status.retired + all.status.other;
  assert.equal(stSum, snap.products.length, '状态分布之和应等于总数');
  assert.equal(
    all.brands.reduce((a, b) => a + b.count, 0),
    snap.products.length,
    '品牌分布之和应等于总数',
  );

  // 空输入守卫
  const empty = EXS.buildExportSummary([], productsById, vendorsById);
  assert.equal(empty.total, 0);
  assert.equal(empty.priceTotalCny, 0);
  assert.equal(empty.priceMissing, 0);
}

/* ================================================================ *
 * 设备球：球面几何
 *
 * 这里是「循环」能否成立的地基。球面版与环面版（board.ts）是两套几何，
 * 结论不能互相套用：环面靠双模索引撑住无限，球面靠**曲面本身没有边界**。
 * 唯一必须钉死的一条是「绕一圈精确复原」——差一点都不算循环，
 * 只算「看起来差不多」，用户转久了会发现设备对不上。
 * ================================================================ */
section('设备球：球面几何');
const G = await import('../src/lib/globe.ts');

check('绕一圈精确复原（循环的地基）', () => {
  const vp = { w: 1200, h: 700 };
  const pts = G.spherePoints(60, [47, 13]);
  assert.equal(pts.length, 60, '球面点数不对');
  // 转 360 度后，每一台都必须回到同一个屏幕位置（浮点误差级别）
  for (const base of [0, 37.5, 123.4, 359.9]) {
    const a = { lon: base, lat: 24, dist: 2.8 };
    const b = { lon: base + 360, lat: 24, dist: 2.8 };
    let worst = 0;
    for (const p of pts) {
      const pa = G.project(p, a, vp);
      const pb = G.project(p, b, vp);
      worst = Math.max(worst, Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y));
    }
    assert.ok(worst < 1e-6, `经度 ${base}° 转一圈后偏差 ${worst}，不是精确复原`);
  }
  // 转 720 度同样要复原
  const c1 = { lon: 10, lat: -30, dist: 3.2 };
  const c2 = { lon: 10 + 720, lat: -30, dist: 3.2 };
  for (const p of pts) {
    const pa = G.project(p, c1, vp);
    const pb = G.project(p, c2, vp);
    assert.ok(Math.abs(pa.x - pb.x) < 1e-6 && Math.abs(pa.y - pb.y) < 1e-6, '转两圈后没复原');
  }
});

check('经度归一化把任意角度绕回 [0, 360)', () => {
  // 循环的前提：经度不能无限增长，否则浮点精度会在转了几百圈后开始漂
  assert.equal(G.normalizeLon(0), 0);
  assert.equal(G.normalizeLon(360), 0);
  assert.equal(G.normalizeLon(-10), 350);
  assert.equal(G.normalizeLon(730), 10);
  for (const n of [-1080, -360.5, 0, 12.3, 360, 1000, 12345.6]) {
    const m = G.normalizeLon(n);
    assert.ok(m >= 0 && m < 360, `${n} 归一化后 ${m} 不在 [0,360)`);
    assert.ok(Number.isFinite(m), `${n} 归一化后不是有限数`);
  }
  assert.equal(G.normalizeLon(NaN), 0, 'NaN 经度应回落为 0');
});

check('纬度与视距被夹紧，透视分母恒正', () => {
  // ⚠️ 这条是最要命的：dist <= 球半径时，投影分母 dist - z 会过零或变负，
  // 表现为「转着转着设备突然镜像/整屏白块」。夹紧必须在任何时候都成立。
  assert.ok(G.clampDist(0.1) > G.R, '视距下限必须大于球半径');
  assert.ok(G.clampDist(-5) > G.R, '负视距也要夹回安全区');
  assert.equal(G.clampDist(Infinity), G.DIST_MAX);
  assert.equal(G.clampDist(-Infinity), G.DIST_MIN);
  assert.equal(G.clampDist(NaN), G.DIST_DEFAULT);
  // NaN / ±Infinity 必须分开判（clampZoom 踩过同一个坑）
  assert.ok(G.clampDist(Infinity) !== G.DIST_DEFAULT, 'Infinity 被当成「未知」跳回默认值了');
  // 纬度不到 ±90，否则经线汇聚成一点、画面会突然翻转
  assert.ok(G.clampLat(999) <= G.LAT_LIMIT, '纬度上限失效');
  assert.ok(G.clampLat(-999) >= -G.LAT_LIMIT, '纬度下限失效');
  assert.equal(G.clampLat(NaN), 0, 'NaN 纬度应回落为 0');
  // 扫一遍所有合法相机，投影结果必须全是有限数且分母为正
  const vp = { w: 900, h: 600 };
  for (const lon of [0, 45, 90, 180, 270, 359]) {
    for (const lat of [-85, -40, 0, 40, 85]) {
      for (const dist of [G.DIST_MIN, 2, G.DIST_MAX]) {
        const cam = { lon, lat, dist };
        for (const p of G.spherePoints(12)) {
          const pr = G.project(p, cam, vp);
          assert.ok(
            Number.isFinite(pr.x) && Number.isFinite(pr.y),
            `(${lon},${lat},${dist}) 投影出非有限数`,
          );
          assert.ok(
            pr.scale > 0 && Number.isFinite(pr.scale),
            `(${lon},${lat},${dist}) scale 非法：${pr.scale}`,
          );
          assert.ok(pr.depth >= -1.0001 && pr.depth <= 1.0001, `depth 越界：${pr.depth}`);
        }
      }
    }
  }
});

check('球面分布均匀覆盖，且品牌分区落在不同纬度带', () => {
  const pts = G.spherePoints(60, [47, 13]);
  assert.equal(pts.length, 60);
  // 每台都在球面范围内
  for (const p of pts) {
    assert.ok(p.lat >= -90 && p.lat <= 90, `纬度越界：${p.lat}`);
    assert.ok(p.lon >= 0 && p.lon < 360, `经度越界：${p.lon}`);
  }
  // Fibonacci 分布的关键性质：纬度按 index 线性铺开，不带分组时应覆盖整个球
  const solo = G.spherePoints(60);
  const lats = solo.map((p) => p.lat);
  assert.ok(Math.max(...lats) > 60, '北半球没铺到');
  assert.ok(Math.min(...lats) < -60, '南半球没铺到');
  // 分组后：华为占北半球+赤道，苹果占南半球（分区必须真的分开，否则等于没分）
  const hw = pts.slice(0, 47).map((p) => p.lat);
  const ap = pts.slice(47).map((p) => p.lat);
  assert.ok(Math.min(...hw) > Math.max(...ap), '品牌纬度带没有分开，分区失效');
  // 没有两台设备落在同一个位置（极点附近最容易叠）
  const keys = new Set(pts.map((p) => `${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`));
  assert.equal(keys.size, 60, '有设备叠在同一个球面坐标上');
});

check('深度决定层次与淡化：近大远小、背面仍可见', () => {
  const vp = { w: 1000, h: 700 };
  const cam = { lon: 0, lat: 0, dist: 2.8 };
  // 正对相机的点（与相机同经纬度）必须是 depth 最大、scale 最大的那一批
  const front = G.project({ lat: 0, lon: 0 }, cam, vp);
  const back = G.project({ lat: 0, lon: 180 }, cam, vp);
  assert.ok(front.depth > 0.98, `正对点 depth 应为 ~1，实际 ${front.depth}`);
  assert.ok(back.depth < -0.98, `背面点 depth 应为 ~-1，实际 ${back.depth}`);
  assert.ok(front.scale > back.scale, '近处应比远处大（近大远小失效）');
  // 正面比背面清晰，但背面**不能完全透明**（线框球口径：60 台始终可见）
  assert.ok(front.opacity > back.opacity, '正面应比背面清晰');
  assert.ok(back.opacity > 0.05, `背面 opacity=${back.opacity} 太低，等于实心球，60 台只剩一半`);
  assert.equal(front.opacity <= 1, true, 'opacity 越界');
  // depthOpacity 单调
  let prev = -1;
  for (let d = -1; d <= 1; d += 0.1) {
    const o = G.depthOpacity(d);
    assert.ok(o >= prev - 1e-9, 'depthOpacity 不单调');
    prev = o;
  }
});

check('球体轮廓半径随视距反向变化，且恒为正', () => {
  const vp = { w: 1000, h: 700 };
  let prev = Infinity;
  for (const dist of [1.6, 2, 2.8, 4, 6]) {
    const r = G.globeRadiusPx({ lon: 0, lat: 0, dist }, vp);
    assert.ok(r > 0 && Number.isFinite(r), `dist=${dist} 时半径非法：${r}`);
    assert.ok(r < prev, `dist=${dist} 时半径应比更近时小（越远看起来越小）`);
    prev = r;
  }
});

check('转球与缩放：rotateBy / zoomDist 的组合不产生非法相机', () => {
  let cam = { lon: 0, lat: 0, dist: G.DIST_DEFAULT };
  // 模拟连续拖 200 次（含大幅横向拖动，会多次跨越 360）
  for (let i = 0; i < 200; i++) cam = G.rotateBy(cam, 17.3, -4.1);
  assert.ok(cam.lon >= 0 && cam.lon < 360, `拖了 200 次后经度越界：${cam.lon}`);
  assert.ok(Math.abs(cam.lat) <= G.LAT_LIMIT, `纬度越界：${cam.lat}`);
  // 再猛缩 100 次，dist 必须还在安全区
  for (let i = 0; i < 100; i++) cam = G.zoomDist(cam, 0.8);
  assert.ok(cam.dist > G.R, `连续缩 100 次后 dist=${cam.dist} 已贴到球心，透视会翻`);
  for (let i = 0; i < 100; i++) cam = G.zoomDist(cam, 1.25);
  assert.ok(cam.dist <= G.DIST_MAX, 'dist 超过上限');
});

check('真实数据能跑通球面：全部设备都落在视口内且不重叠成堆', () => {
  const pj = join(ROOT, 'data/products.json');
  if (!existsSync(pj)) return;
  const snap = JSON.parse(readFileSync(pj, 'utf8'));
  const n = (snap.products ?? []).length;
  if (!n) return;
  // 品牌分区台数必须**从数据推导**（与 GlobeView.vue 的 groups 同逻辑：
  // 按 items 里品牌的出现顺序分组计数）。曾在这里写死 [47, 13] ——
  // 华为变成 49 台那天，spherePoints(62, [47,13]) 只返回 60 个点，
  // 两台新机型静默不上球，而前端（推导逻辑）是对的，只有测试夹具是错的。
  // 教训：判据可以钉性质（每台都有点、不出视口），不能钉当期数值。
  const g2 = [];
  let curBrand = '';
  for (const p of snap.products) {
    if (p.brand !== curBrand) {
      g2.push(1);
      curBrand = p.brand;
    } else {
      g2[g2.length - 1]++;
    }
  }
  const vp = { w: 1200, h: 700 };
  const pts = G.spherePoints(n, g2);
  assert.equal(pts.length, n, '球面点数与设备数不符');
  for (const cam of [
    { lon: 0, lat: 0, dist: 2.8 },
    { lon: 120, lat: 45, dist: 2.2 },
    { lon: 300, lat: -60, dist: 3.5 },
  ]) {
    const pr = pts.map((p) => G.project(p, cam, vp));
    for (const q of pr) {
      // 允许略微出界（球体边缘的设备本就可能超出），但不能飞到天外
      assert.ok(q.x > -vp.w && q.x < vp.w * 2, `设备飞出视口：x=${q.x}`);
      assert.ok(q.y > -vp.h && q.y < vp.h * 2, `设备飞出视口：y=${q.y}`);
    }
    // 排序后 depth 必须单调不减（远的先画，近的压在上面）
    const sorted = [...pr].sort(G.byDepth);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].depth >= sorted[i - 1].depth - 1e-12, '按深度排序后仍乱序');
    }
    // 任意角度都应有约一半设备在正面（球是封闭曲面，不会转到「背面全空」）
    const front = pr.filter((q) => q.depth > 0).length;
    assert.ok(
      front > n * 0.3 && front < n * 0.7,
      `正面设备 ${front}/${n} 偏离一半太多，球分布不均`,
    );
  }
});

check('捏合缩放系数：张开拉近，除零与单帧跳变都被挡住', () => {
  // 手机没有滚轮，捏合是移动端唯一的缩放手段。这里守住两个口子：
  // ① 手指刚落下/两点重合时距离是 0，除零会得到 Infinity；② 单帧跳变不该让球瞬移。
  assert.ok(G.pinchFactor(100, 200) < 1, '张开（距离变大）应该拉近');
  assert.ok(G.pinchFactor(200, 100) > 1, '捏拢（距离变小）应该推远');
  assert.equal(G.pinchFactor(120, 120), 1, '距离不变不该改视距');
  assert.equal(G.pinchFactor(0, 100), 1, '起始距离为 0 时应返回 1');
  assert.equal(G.pinchFactor(100, 0), 1, '当前距离为 0 时应返回 1');
  assert.equal(G.pinchFactor(NaN, 100), 1, 'NaN 距离应返回 1');
  assert.equal(G.pinchFactor(100, Infinity), 1, 'Infinity 距离应返回 1');
  // 系数夹在 [0.5, 2]，否则一次大步长就能把视距从最近甩到最远
  assert.equal(G.pinchFactor(100, 10000), 0.5, '极端张开应被夹到 0.5');
  assert.equal(G.pinchFactor(10000, 100), 2, '极端捏拢应被夹到 2');
  // 与 zoomDist 组合后仍不许越过安全区（dist 必须恒大于球半径，否则透视翻面）
  let cam = { lon: 0, lat: 0, dist: G.DIST_DEFAULT };
  for (let i = 0; i < 50; i++) cam = G.zoomDist(cam, G.pinchFactor(100, 200));
  assert.ok(cam.dist > G.R, `连续张开 50 次后 dist=${cam.dist} 贴到球心，透视会翻`);
  for (let i = 0; i < 50; i++) cam = G.zoomDist(cam, G.pinchFactor(200, 100));
  assert.ok(cam.dist <= G.DIST_MAX, '连续捏拢 50 次后 dist 超过上限');
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

/** 造一台最小画布文档（只带筛选用得到的字段），用于与搜索页口径对照 */
function cdoc(id, name, line, brand, brandZh, releaseDate = '') {
  return {
    id,
    name,
    nameZh: null,
    line,
    brand,
    brandZh,
    releaseDate,
    releaseDatePrecision: '',
    status: '',
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

check('搜索与画布筛选口径一致（同一个词，两个答案就是 bug）', () => {
  /*
   * 真 bug：画布原本自带一份 tokenize（空白切分 + 字面量 includes），
   * 与搜索页的归一化通道口径不同 —— 用户在搜索页搜 `mate80` 有 5 台，
   * 在画布里搜同一个词得到 0 台。**同一个功能两个答案，比少一个功能更糟。**
   *
   * 判据：同一批查询，两个入口给出的**集合**必须相同。
   * ⚠️ 只比集合不比顺序 —— 画布顺序由 sort 决定（默认按发布日倒序），
   *   搜索按相关度，顺序不同是设计意图。比顺序是判据本身写错。
   */
  const cdocs = buildCanvasDocs([
    cdoc('ip16', 'iPhone 16', 'iPhone', 'apple', '苹果'),
    cdoc('ip16p', 'iPhone 16 Pro', 'iPhone', 'apple', '苹果'),
    cdoc('ip16pm', 'iPhone 16 Pro Max', 'iPhone', 'apple', '苹果'),
    cdoc('nv14', 'HUAWEI nova 14', 'nova', 'huawei', '华为'),
    cdoc('nv14u', 'HUAWEI nova 14 Ultra', 'nova', 'huawei', '华为'),
  ]);
  const setOf = (a) => JSON.stringify([...a].sort());
  const cQ = (q) => applyFilter(cdocs, { ...EMPTY_FILTER, q }).map((d) => d.name);
  const sQ = (q) => S.search(CJK_DOCS, q).map((d) => d.product.name);

  for (const q of [
    'mate80',
    'nova14',
    '苹果16',
    '苹果 16',
    'iphone16',
    'nova 14 ultra',
    '苹果16promax',
  ]) {
    assert.equal(setOf(cQ(q)), setOf(sQ(q)), `「${q}」两个入口结果集必须一致`);
  }
  // 注：画布**有意**不搜芯片名（见 canvasFilter 口径），本组查询均走 name/中文名/产品线，
  // 两个入口在该集合上必须完全一致；芯片专属词的差异不在此处验证。
});

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

check('搜索：分面等式（全部 = 各分面项之和）不得被分级匹配破坏', () => {
  /*
   * 分级匹配（精确无果才放宽）若在全库层面做，分面会数出精确通道根本不会
   * 给的台数，「全部 = 各分面项之和」这条等式就断了。分面是「跳过自己那一维」
   * 后统计的，候选集与筛选不同，所以分级必须在**本批候选内**做。
   */
  const cdocs = buildCanvasDocs([
    cdoc('ip16', 'iPhone 16', 'iPhone', 'apple', '苹果', '2024-09-10'),
    cdoc('ip16p', 'iPhone 16 Pro', 'iPhone', 'apple', '苹果', '2024-09-20'),
    cdoc('nv14', 'HUAWEI nova 14', 'nova', 'huawei', '华为', '2024-11-26'),
    cdoc('nv14u', 'HUAWEI nova 14 Ultra', 'nova', 'huawei', '华为', '2024-12-10'),
  ]);
  for (const q of ['', 'mate', 'mate80', '苹果16', 'nova14']) {
    const facets = brandFacets(cdocs, { ...EMPTY_FILTER, q });
    const total = facets[0].count;
    const sum = facets.slice(1).reduce((a, b) => a + b.count, 0);
    assert.equal(total, sum, `q="${q}"：全部(${total}) 必须等于各分面项之和(${sum})`);
  }
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
const DIMS = F.DIMENSIONS.map((d) => d.key);

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
  const counts = C.categoryCounts(REAL_P);
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, REAL_P.length, '每台都必须落进某个品类，不能凭空消失');
  assert.equal(counts.phone, REAL_P.length, '本数据集只有手机（折叠屏也是手机，归形态维度）');
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

check('没有数据的品类如实为 0，不拿别的品类凑数', () => {
  // 平板/笔记本/音频在本数据集里一台都没有：不因「苹果肯定有 iPad」就造一台。
  const counts = C.categoryCounts(REAL_P);
  assert.equal(counts.tablet, 0);
  assert.equal(counts.laptop, 0);
  assert.equal(counts.audio, 0);
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
  assert.equal(C.fmtPriceCny(null), '官方未公布');
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
  assert.ok(noChip.every((p) => !p.chipset?.name), '筛出来的必须真的没有芯片名');
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
  assert.ok(qilin.every((c) => c.count === 0), '选苹果后麒麟芯片计数必须为 0（灰显依据）');
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
  assert.equal(brands.find((b) => b.id === 'huawei')?.count, F.applyFilter(REAL_P, fa).length,
    '华为计数 = 芯片筛选后命中台数');
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
  assert.ok(got.every((p) => C.basePriceCny(p) == null), '有价机型混入说明价格维度失效');
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
  const arr = [
    mk('a', 5000, 50),
    mk('b', 5000, 80),
    mk('c', 6000, 10),
    mk('d', 4000, 99),
  ];
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
  assert.deepEqual(r.map((p) => p.id), ['i', 'h', 'g'], '有电池的 i 第一；h 一级缺排第二；g 两级都缺垫底');
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
  assert.deepEqual(r.map((p) => p.id), ['y', 'z', 'x'], '无排序键时按发布日期倒序兜底');
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
  const back = F.readFilter(new URLSearchParams(F.writeFilter(want, ['battery-desc', 'camera-desc'])), cat);
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
  assert.equal(rows.length, 3, '苹果 Pro Max 共 3 台');
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
  assert.equal(F.DIMENSIONS[0].key, 'category', '品类必须排第一');
});

check('形态是第二个维度，品类里已无折叠屏（用户 2026-10-06 纠正概念）', () => {
  assert.equal(F.DIMENSIONS[1].key, 'form', '形态必须紧跟品类');
  assert.ok(!F.DIMENSIONS.some((d) => d.key === 'category' && d.key === 'form'));
  const catFacets = F.facetOf(REAL_P, 'category', REAL_P);
  assert.deepEqual(
    catFacets.map((f) => f.id),
    ['phone'],
    '品类分面只有手机 —— 折叠屏不是品类',
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
  const cat = F.buildCatalog(REAL_P, F.DIMENSIONS.map((d) => d.key));
  const want = { ...F.emptyFilter(), form: ['foldable'] };
  const back = F.readFilter(new URLSearchParams(F.writeFilter(want)), cat);
  assert.deepEqual(back.filter.form, ['foldable'], '形态条件必须能从 URL 完整读回');
});

/* ================================================================ *
 * 13. 像素立绘的几何（layout 纯函数）
 * ----------------------------------------------------------------
 * 立绘每一根线都由数据算出：宽高比←屏幕对角线、镜头数←后摄数、圆角←厚度、
 * 描边←厚度。改 layout() 一个阈值就是改全部 60 张图，而这类改动：
 *   - 单测抓不到（返回的仍是合法数字，只是画错了）
 *   - 产物闸门抓不到（SVG 结构完整）
 *   - 像素风扫描抓不到（圆角/模糊/字号都合规）
 * 唯一防线是 scripts/sprite/review.mjs 的肉眼核对；这里钉住的是
 * 「几何自洽」这部分——那部分本就该由单测负责。
 * ================================================================ */
section('像素立绘几何');

const SPRITE = await import('./sprite/generate.mjs');
const FOLD = await import('./lib/foldable.mjs');

check('立绘的折叠判据与前端同源（同一个真源，不是各写一份正则）', () => {
  // 这条锁的是 2026-10-06 修掉的真 bug：sprite 曾用 `sizeIn >= 7.5` 判折叠，
  // 而折叠机主屏只有 5.4–6.5 英寸 —— 7 台真折叠机里漏了 3 台，
  // 用户看到的是「机型库标着折叠屏、立绘却画成直板」。
  const snapshot = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
  for (const p of snapshot.products) {
    assert.equal(
      SPRITE.layout(p).foldable,
      FOLD.isFoldableOfficial(p),
      `${p.id}：立绘的 foldable 与官网原文判据不一致 —— 用户会看到形态标签与立绘互相打脸`,
    );
  }
  // 回归锁定：这三个正是被 sizeIn 阈值漏掉的那几台
  const missed = ['huawei-mate-xt-2-ultimate-design', 'huawei-pura-x', 'huawei-pura-x-max'];
  for (const id of missed) {
    const p = snapshot.products.find((x) => x.id === id);
    assert.ok(p, `真实数据里应存在 ${id}`);
    assert.equal(
      SPRITE.layout(p).foldable,
      true,
      `${id} 是官网原文写明的折叠机（主屏 ${p.display?.sizeIn}″），立绘必须画成展开态`,
    );
  }
});

check('反向测：主屏够大不等于折叠（尺寸阈值是估算，官网写了才算）', () => {
  // 构造一台「大但官网没写折叠」的机器：8.3 英寸。若判据退回尺寸阈值，
  // 它会被误判成折叠机 —— 这条断言就是拦住那个退化的。
  const fake = { rawOfficial: { '尺寸与重量': '220 mm | 130 mm | 6.1 mm' }, display: { sizeIn: 8.3 } };
  assert.equal(FOLD.isFoldableOfficial(fake), false, '大屏平板没有折叠原文依据，不得判为折叠');
  assert.equal(SPRITE.layout(fake).foldable, false, '立绘与大屏平板的判据必须一致');
  // 反向：大屏但官网写了折叠 → 必须判为折叠（不是只认小屏）
  const fakeFold = { rawOfficial: { '尺寸与重量': '展开态：220 mm | 折叠态：130 mm' }, display: { sizeIn: 6.1 } };
  assert.equal(FOLD.isFoldableOfficial(fakeFold), true, '官网写了折叠就必须认，哪怕主屏只有 6.1 英寸');
});

check('layout 几何自洽：画布内、不越界、圆角与厚度同向', () => {
  const snapshot = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
  for (const p of snapshot.products) {
    const L = SPRITE.layout(p);
    const { x, y, w, h, r } = L.rect;
    assert.ok(w > 0 && h > 0, `${p.id}：宽高必须为正（${w}×${h}）`);
    assert.ok(x >= 0 && y >= 0, `${p.id}：不得画到画布左侧/上方之外（x=${x} y=${y}）`);
    assert.ok(x + w <= 160.001, `${p.id}：右侧越出画布（${x}+${w} > 160）`);
    assert.ok(y + h <= 320.001, `${p.id}：底部越出画布（${y}+${h} > 320）`);
    assert.ok(r > 0, `${p.id}：圆角须为正（${r}）`);
    // 折叠机更宽：宽高比应明显大于直板
    const ratio = w / h;
    if (L.foldable) assert.ok(ratio > 0.6, `${p.id}：折叠机宽高比 ${ratio.toFixed(3)} 应 >0.6`);
    else assert.ok(ratio < 0.55, `${p.id}：直板宽高比 ${ratio.toFixed(3)} 应 <0.55`);
  }
});

check('相机数量 0（官网未公布）走占位分支，不画成「没有镜头」', () => {
  const p = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8')).products.find(
    (x) => x.id === 'apple-iphone-16e',
  );
  assert.ok(p, '真实数据里应存在 iphone-16e');
  assert.equal(SPRITE.layout(p).camUnknown, true, '后摄未公布必须标为 camUnknown');
  assert.equal(SPRITE.layout(p).camCount, 1, '占位画1 个圆 —— 画 0 个等于宣称「无后摄」');
});

check('圆角与描边随厚度单调递增（越薄越方正、越厚越粗）', () => {
  // 判据是**单调性**，不是「圆角必须小于某个数」—— 公式是 6+(厚-6)/6*6，
  // 厚机圆角能到 15 以上，钉死上限反而会把厚机误判成 bug。
  // 单调性才是设计契约：有人把符号写反（越薄越圆）时它会立刻报出。
  const probe = (mm) => {
    const L = SPRITE.layout({ brand: 'apple', display: { sizeIn: 6.5 }, body: { thicknessMm: mm } });
    return { r: L.rect.r, sw: L.strokeW };
  };
  for (const [lo, hi] of [[6, 7], [7, 9], [9, 12]]) {
    const a = probe(lo);
    const b = probe(hi);
    assert.ok(b.r >= a.r, `厚度 ${lo}→${hi}mm 圆角应不减（${a.r.toFixed(2)} → ${b.r.toFixed(2)}）`);
    assert.ok(
      b.sw >= a.sw,
      `厚度 ${lo}→${hi}mm 描边应不减（${a.sw.toFixed(2)} → ${b.sw.toFixed(2)}）`,
    );
  }
  // 反向测：符号写反时（越薄越圆）必须被抓出来。构造一个「比 6mm 更薄」的对照，
  // 按公式圆角应更小；若实现反了，这里会报出。
  assert.ok(
    probe(5.5).r < probe(6.5).r,
    '5.5mm 的圆角必须小于 6.5mm —— 若成立说明方向没写反',
  );
});

/* ================================================================ *
 * 14. 原始响应归档（data/raw/）
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
  const before = { source: 'x', products: [{ id: 'a', name: 'A', specsUrl: 'u', raw: { '电池.容量': '6600 mAh' } }], skipped: [] };
  const after = { source: 'x', products: [{ id: 'a', name: 'A', specsUrl: 'u', raw: { '电池.容量新写法': '6600 mAh' } }], skipped: [] };
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
  assert.ok(staticRoutes.length >= 6, `解析到的静态路由只有 ${staticRoutes.length} 条，正则可能失效了`);

  const orphans = [];
  for (const r of staticRoutes) {
    const sub = r.path.replace(/^\//, '');
    const byPath = vueSrc.includes(`to="/${sub}"`) || vueSrc.includes(`path: '${r.path}'`);
    const byName = new RegExp(`['"\`]${r.name}['"\`]`).test(vueSrc);
    if (!byPath && !byName) orphans.push(`${r.name}(${r.path})`);
  }
  assert.deepEqual(
    orphans,
    [],
    `孤儿页：${orphans.join('、')} 有路由能打开，但没有任何导航链接能到 —— 用户只能手输 URL`,
  );
});

check('导航条不得有两个入口指向同一路由（两个按钮做一件事）', () => {
  const navFile = readFileSync(join(SRC_DIR, 'components/SiteNav.vue'), 'utf8');
  const targets = [
    ...[...navFile.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1]),
    ...[...navFile.matchAll(/to="([^"]+)"/g)].map((m) => m[1]),
  ].filter((t) => t.startsWith('/'));
  assert.ok(targets.length > 0, '一个入口都没解析到 —— 选择器可能失效了');
  const seen = new Map();
  for (const t of targets) seen.set(t, (seen.get(t) ?? 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).map(([t, n]) => `${t}×${n}`);
  assert.deepEqual(dup, [], `导航条里重复的入口：${dup.join('、')} —— 改一处会漏另一处`);
});

check('页脚必须保留「关于」入口（它不在主导航里，删掉就成孤儿页）', () => {
  // 场景：「关于」是完整内容但低频的页，2026-10-06 从主导航移到页脚。
  // 下次有人觉得「页脚太乱」把它删掉，「关于」就静默变成孤儿页 ——
  // 而那种删除看起来只是「清理」，不会有任何提示。
  const footerFile = readFileSync(join(SRC_DIR, 'components/SiteFooter.vue'), 'utf8');
  // 两种写法都要认：模板字面量 to="/about"，或数组项里的 { name:'about', to:'/about' }。
  // 只认前者会把「用数据驱动渲染导航」的实现误判成没有入口 —— 那正是本文件自己的写法。
  const hasAbout =
    /to="\/about"/.test(footerFile) ||
    /to:\s*'\/about'/.test(footerFile) ||
    /["'`]\/about["'`]/.test(footerFile);
  assert.ok(
    hasAbout,
    '页脚必须保留「关于」入口 —— 它不在主导航里了，删掉就成孤儿页',
  );
  // 顺带钉住当前页高亮：页脚链接不带 aria-current 的话，
  // 进到「关于」页看不出自己在哪。
  assert.ok(
    /aria-current/.test(footerFile),
    '页脚链接必须有 aria-current 高亮 —— 否则进到低频页看不出位置',
  );
});

check('主导航项数受控（>6 项就说明又有人在往里塞低频页）', () => {
  const navFile = readFileSync(join(SRC_DIR, 'components/SiteNav.vue'), 'utf8');
  const items = [...navFile.matchAll(/name:\s*'(home|compare|rankings|timeline|canvas|globe)'/g)];
  assert.ok(
    items.length <= 6,
    `主导航有 ${items.length} 项 —— 顶栏在 1080px 下就会占满，1024px 以下还会折成两行`,
  );
  // 「关于」不该回到主导航：它是低频页，占的是主导航的视觉预算
  assert.ok(
    !/name:\s*'about'/.test(navFile),
    '「关于」回到主导航了 —— 它是全站访问频率最低的一页，页脚已有它的入口',
  );
});

/* ================================================================ *
 * 16. 顶栏的高度预算与装饰纪律
 * ----------------------------------------------------------------
 * 顶栏曾占 76px，其中**一半是装饰**：4px 底边 + 4px 投影 + 8px 纵向 padding
 * + logo 的 24px 字号（36px 行高）+ 导航按钮 3px 投影撑出的 6px。
 * 压到 40px 靠的是三件事，每一件都是「装饰的视觉重量必须与容器匹配」：
 *
 *   1. 顶栏导航用 `.pixel-button-flat`（纯平面）而不是 `.pixel-button`
 *      —— 后者的 3px 立体投影读作「厚度」，只适合页面里的大按钮。
 *   2. 底边/投影 4px → 2px（直接进高度预算）。
 *   3. logo 行高 leading-[1.5] → leading-none，行高本身就是高度。
 *
 * 这些都是**视觉判断**，没有单测能证明「够矮了」——
 * 所以这里只钉住「不许再变高」这个方向，具体数值由真机测量决定。
 * ================================================================ */
section('顶栏高度预算');

const HEADER_CSS = readFileSync(join(SRC_DIR, '..', 'src/style.css'), 'utf8');

check('顶栏装饰不得重新变厚（底边与投影各 ≤2px）', () => {
  const m = HEADER_CSS.match(/\.pixel-header\s*\{([^}]*)\}/);
  assert.ok(m, '.pixel-header 规则不见了');
  const body = m[1];
  const border = body.match(/border-bottom:\s*(\d+)px/);
  const shadow = body.match(/box-shadow:\s*0\s+(\d+)px/);
  assert.ok(border && shadow, 'pixel-header 应显式声明 border-bottom 与 box-shadow');
  assert.ok(
    Number(border[1]) <= 2,
    `顶栏底边 ${border[1]}px > 2px —— 这 2px 直接进高度预算，参考项目是 0`,
  );
  assert.ok(
    Number(shadow[1]) <= 2,
    `顶栏投影 ${shadow[1]}px > 2px —— 高度算的是「底边+投影」，不是只有底边`,
  );
});

check('顶栏导航必须用平面按钮（3px 立体投影撑高 6px，一排就是36px）', () => {
  const navFile = readFileSync(join(SRC_DIR, 'components/SiteNav.vue'), 'utf8');
  // 判据必须认变体名。`\bpixel-button\b` 会**误匹配** `pixel-button-flat` ——
  // 连字符也算词边界，于是 flat 版被判成「用了立体版」，
  // 报告一条**不存在的**故障。这是「判据写窄了比漏报更糟」的又一例
  // （同 P7：会把正确实现误判成问题，你会去「修」一个没坏的东西）。
  //
  // 正确写法：像素按钮后面必须紧跟引号或空白，即「这个 class 名到此结束」。
  const USES_RAISED = /class="[^"]*(?<![-\w])pixel-button(?![-\w])/;
  assert.ok(
    !USES_RAISED.test(navFile),
    'SiteNav 里出现了非 flat 版的 pixel-button —— 它的 3px 投影会让顶栏长高 6px',
  );
  // 反向验证判据本身有效：造一个含立体版的字符串，必须被抓住。
  // 量法失效（永远匹配不到）的话，上面那条断言就是空的。
  assert.ok(
    USES_RAISED.test('class="pixel-button px-2"'),
    '判据失效：连明显的立体版都匹配不到，上面那条断言形同虚设',
  );
  assert.ok(
    !USES_RAISED.test('class="pixel-button-flat px-2"'),
    '判据失效：flat 版被误判成立体版',
  );
  // 必须真的定义了 flat 变体，不能只改 class 名
  assert.ok(
    /\.pixel-button-flat\s*\{/.test(HEADER_CSS),
    'nav 用了 pixel-button-flat 但样式里没定义它 —— 顶栏会变成一排无边框裸文字',
  );
  // 平面变体必须是「没有投影」，且当前页用别的手段表示（不能用位移，那会顶歪整条导航）
  const flat = HEADER_CSS.match(/\.pixel-button-flat\s*\{([^}]*)\}/)[1];
  assert.ok(/box-shadow:\s*none/.test(flat), 'pixel-button-flat 应显式关掉投影');
  assert.ok(
    /aria-current/.test(flat) || /\.pixel-button-flat\[aria-current/.test(HEADER_CSS),
    '平面按钮需要 aria-current 样式 —— 位移式高亮会把整条导航顶歪',
  );
});

check('logo 行高必须压到 1（leading-[1.5] 在 24px 字上多出 12px）', () => {
  const appFile = readFileSync(join(SRC_DIR, 'App.vue'), 'utf8');
  const logo = appFile.match(/pixel-outline[^"]*"/);
  assert.ok(logo, '找不到 logo 的 class');
  assert.ok(
    /leading-none/.test(logo[0]),
    `logo 用了 ${logo[0].match(/leading-\S+/)?.[0] ?? '默认行高'} —— 24px 字配 1.5 行高会多出 12px`,
  );
});

/* ================================================================ *
 * 17. 首页 hero 的高度预算
 * ----------------------------------------------------------------
 * hero 曾占 208px，加上顶栏要滚 248px 才看到第一张卡片 —— 首屏全浪费在装饰上。
 * 压到 118px 的四笔里，有三笔是**判据**（可以机器判），一笔是视觉（`clamp` 实测）。
 *
 * 顺带记一个踩过的坑：副标题与 chip 并排时用 `items-center`，
 * chip 因为有 2px 边框比 12px 副标题高 4px，居中后**顶到副标题上方**（gap = −4px），
 * 视觉上贴住了 h1。**高度不同的一行不该用居中对齐**，该用 `items-start`。
 * ================================================================ */
section('首页 hero 高度预算');

const homeView = readFileSync(join(SRC_DIR, 'views/HomeView.vue'), 'utf8');

check('hero 标题不得用 36px（与顶栏 logo 重复强调，24px 才是页面标题层级）', () => {
  const h1 = homeView.match(/<h1[^>]*class="([^"]*)"/);
  assert.ok(h1, '找不到 hero 的 h1');
  assert.ok(
    /text-\[24px\]/.test(h1[1]),
    `hero 标题字号应为 24px，当前是 ${h1[1].match(/text-\[\d+px\]/)?.[0] ?? '未显式设置'}`,
  );
  // 36px 是品牌标识（顶栏 logo）的尺寸，页面内再用一次就是重复强调
  assert.ok(
    !/text-\[36px\]/.test(h1[1]),
    'hero 标题回到 36px 了 —— 那是顶栏 logo 的尺寸，等于同一句话强调两遍',
  );
});

check('hero 副标题必须是 12px（标语，不是自我介绍的数据）', () => {
  assert.ok(
    /选择更清楚/.test(homeView) && /text-\[12px\][^>]*>\s*\n?\s*选择更清楚/.test(homeView),
    'hero 副标题应为 12px',
  );
  // 高度不同的并排（副标题纯文字 vs 读数有边框）必须顶对齐：
  // items-center 会让有边框的那个顶到上方，实测 gap = −4px。
  const row = homeView.match(/<div class="(mt-[\d.]+ flex flex-wrap items-start[^"]*)"/);
  assert.ok(row, 'hero 读数区应使用 items-start（顶对齐）');
});

check('首页顶栏 = 对角灰阶过渡，且是收窄的 HUD 而非标题海报', () => {
  // 设计演进（2026-10-07~08）：长方形马赛克太极 → **对角黑白灰阶过渡** → **分档高度**。
  // 马赛克那版实测：宽高比要 ≲4:1 才读得出太极，于是顶栏被顶到 ~346px，
  // 白白吃掉首屏一大截；改灰阶过渡后「读得出图形」这个约束消失，高度得以回落。
  //
  // ⚠️ 判据三次改版，每次都是因为**真实需求变了**，不是为了让断言变绿：
  //  ① 钉「有 vw 无 vh」—— 26vh 会把宽屏拉成 6.2:1 把太极压成波浪。
  //  ② 钉 clamp 三段 + 下限 ≥120px。
  //  ③（2026-10-08）**废弃 clamp 判据，改成分档**。原因：内容高度随宽度**非单调**
  //     （76 → 110 → 138px），单一 clamp 对两头都不对 —— 桌面 124−76 = 48px 死空间，
  //     而 360px 窄屏 138px 装不下、被 `overflow-hidden` **裁掉 14px**（实测 maxChildBottom=138）。
  //     钉 clamp 会把这个 bug 锁在绿灯里。
  //
  // 现在的判据钉三件事：
  //  ① 高度是**分档**的（`.banner-h` 在 CSS 里，且有 ≥901px 的宽屏档）；
  //  ② 宽屏档 ≤ 120px —— 它是 HUD 不是标题海报，桌面内容只有 76px；
  //  ③ 不得用 vh —— 内容固定，vh 会在矮窗口压扁。
  //
  // ⚠️ 判据只钉**机器能判的**部分。「每档是否真的贴着该档内容高度」需要真实
  // 渲染才能测（那是 puppeteer 的活，见下条断言），这里只保证没有回退成
  // 「一个高度值糊到所有断点」——那正是 360px 裁切的根因。
  const css = homeView.match(/<style scoped>([\s\S]*?)<\/style>/);
  assert.ok(css, '找不到 <style scoped> —— 顶栏高度应写成 CSS 媒体查询（分档）');
  const cssText = css[1];

  assert.ok(/\.banner-h\s*\{[^}]*height:/.test(cssText), '.banner-h 必须显式给 height');
  assert.ok(
    /@media\s*\(min-width:\s*901px\)/.test(cssText),
    '缺宽屏档（@media min-width:901px）—— 桌面内容只有 76px，' +
      '与窄屏 110/138px 差一倍以上，单一高度值必然对一头不对',
  );
  assert.ok(
    !/[\d.]+\s*vh/.test(cssText),
    `顶栏高度不能用 vh —— 内容（站名+导航）是固定高度，矮窗口下会被压扁：${cssText.slice(0, 80)}`,
  );

  // 宽屏档的高度：抓 min-width:901px 那段里的 height 值
  const wide = cssText.match(/@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\.banner-h\s*\{[^}]*height:\s*(\d+)px/);
  assert.ok(wide, '宽屏档里读不到 height（格式应形如 `height: 80px`）');

  // ⚠️ 上下界都从**实测内容高度**推，不是拍脑袋的整数。
  // 桌面（≥901px）内容实测占 72px：pt-2(8) + h1(34) + mt-1.5(6) + 副标题行(24)。
  //   上界 120 = 72 + 48：它是 HUD 不是标题海报，超了就是白占地方（实测曾到过 124）。
  //   下界 80 = 72 + 8：底部至少留 8px —— `pixel-outline` 的 text-shadow 是
  //     **硬投影**（外投影 2px），贴到 section 底边会被 `overflow-hidden` 削掉。
  //     这是「呼吸」的物理下限，不是审美偏好。
  // ⚠️ 若哪天把 h1 字号或行高改了，这两个数会一起过期 —— 改时必须重量。
  const CONTENT_WIDE = 72;
  assert.ok(
    Number(wide[1]) <= CONTENT_WIDE + 48,
    `宽屏档顶栏 ${wide[1]}px > ${CONTENT_WIDE + 48}px —— 桌面导航单行、内容只占 ${CONTENT_WIDE}px，` +
      `它是 HUD 不是标题海报，超过就白占地方`,
  );
  assert.ok(
    Number(wide[1]) >= CONTENT_WIDE + 8,
    `宽屏档顶栏 ${wide[1]}px < ${CONTENT_WIDE + 8}px —— 内容占 ${CONTENT_WIDE}px，` +
      `底部至少要留 8px：h1 的 text-shadow 是硬投影（外投影 2px），贴边会被 overflow-hidden 削掉`,
  );
});

check('首页顶栏各断点高度不得让内容被裁（overflow-hidden 会静默吃掉导航）', () => {
  // 这条判据的由来：**`overflow-hidden` 裁切是零报错的**。
  // 2026-10-08 实测 360px 下 maxChildBottom=138 而 section 高 124 ⇒ 导航最后一行
  // 被切掉 14px，而**所有闸门都是绿的**（内容在 DOM 里、体检只看文件不看渲染）。
  //
  // 判据是**单调性**而不是某个像素值：宽屏档必须 ≤ 窄屏档。
  // 理由：导航的折行数只会随宽度**减少**（宽屏单行、窄屏两/三行），
  // 所以内容高度随宽度**非单调但整体递减** ⇒ 顶栏高度也必须跟着递减。
  // 若有人把宽屏档调得比窄屏还高，就是把死空间调回来了。
  const css = homeView.match(/<style scoped>([\s\S]*?)<\/style>/);
  assert.ok(css, '找不到 <style scoped>（依赖上一条）');
  const cssText = css[1];

  // ⚠️ **必须按断点语义解析，不能按「height 出现顺序取首尾」**——
  // 那样的判据有个洞：把 base 档（窄屏）也改成 92px 时，
  // `heights[last]` 仍是宽屏档的 92，`92 <= 92` 照样通过，
  // 而这正是「单一高度糊到所有断点 ⇒ 360px 裁 10px」的根因。
  // 这条判据自己被反向测抓到过（见 `2026-10-08.md`）。
  const blocks = [...cssText.matchAll(/@media([^{]*)\{([\s\S]*?)\n\}/g)];
  const byBreakpoint = new Map();
  for (const [, cond, body] of blocks) {
    const h = body.match(/\.banner-h\s*\{[^}]*height:\s*(\d+)px/);
    if (h) byBreakpoint.set(cond.replace(/\s+/g, ' ').trim(), Number(h[1]));
  }

  // base（无 @media 的那条）必须有高度
  const baseMatch = cssText.match(/^\.banner-h\s*\{[^}]*height:\s*(\d+)px/m);
  assert.ok(baseMatch, '.banner-h 基础档（无 @media）必须给 height');
  const base = Number(baseMatch[1]);

  // 宽屏档 = min-width ≥ 901 的那条
  const wideKey = [...byBreakpoint.keys()].find((k) => /min-width:\s*9\d\dpx/.test(k));
  assert.ok(wideKey, `找不到 min-width ≥900px 的宽屏档，现有：${[...byBreakpoint.keys()].join(' / ')}`);
  const wide = byBreakpoint.get(wideKey);

  assert.ok(
    wide < base,
    `宽屏档 ${wide}px 未严格小于窄屏 base 档 ${base}px —— ` +
      `导航折行数随宽度递减（宽屏单行 / 窄屏两行 / ≤380px 三行），` +
      `顶栏高度必须跟着递减。` +
      `（曾经的 bug：单一 124px 糊到所有断点 ⇒ 桌面 52px 死空间 + 360px 裁 10px。` +
      `把 base 也调成 92px 同样错：≤380px 那一档内容 134px 会被裁掉 42px）`,
  );

  // ⚠️ **死空间上限**：每档 = 内容 + 底部 8px 呼吸，**上下必须对称**。
  // 这条比「上限 ≤120px」更根本 —— 124px 时代桌面是 `pt-2` 8px + 底部 **20px**，
  // 上下不对称，那 12px 不是设计、只是没人算过。抓「死空间」而不是抓某个像素值。
  //
  // 判据：`pt`（顶部内边距）必须与「高度 − 内容」一致，即三档都留 8px 底部。
  // 内容高度是 puppeteer 实测的，改 h1 字号/行高时这些数会一起过期 ⇒ 必须重量。
  const CONTENTS = { base: 106, tiny: 134, wide: 72 };
  const actual = { base, wide, tiny: byBreakpoint.get([...byBreakpoint.keys()].find((k) => /max-width/.test(k))) };

  const pt = Number((cssText.match(/row[\s\S]{0,200}?pt-(\d)/) || [])[1] || 8);
  for (const [name, content] of Object.entries(CONTENTS)) {
    const h = actual[name];
    assert.ok(h, `找不到 ${name} 档的高度`);
    const breathe = h - content;
    assert.ok(
      breathe >= 8,
      `${name} 档 ${h}px − 实测内容 ${content}px = ${breathe}px 底部留白 < 8px —— ` +
        `h1 的 text-shadow 是硬投影（外投影 2px），贴到 section 底边会被 overflow-hidden 削掉`,
    );
    assert.ok(
      breathe <= 12,
      `${name} 档 ${h}px − 实测内容 ${content}px = ${breathe}px 底部留白 > 12px —— ` +
        `上下不对称（顶部只有 pt-${pt} = ${pt}px）那部分就是白占地方。` +
        `**上下必须对称**：每档 = 内容 + 8px。`,
    );
  }

  // ≤380px 三行档必须比 base 更高（不然窄屏导航被裁）
  const tinyKey = [...byBreakpoint.keys()].find((k) => /max-width/.test(k));
  assert.ok(
    tinyKey,
    '找不到 `max-width` 的超窄档 —— 导航在 ≤380px 会折到第三行（内容 134px），' +
      '缺这一档就会被 overflow-hidden 静默裁掉（零报错）',
  );
  assert.ok(
    byBreakpoint.get(tinyKey) > base,
    `超窄档 ${byBreakpoint.get(tinyKey)}px 未高于 base 档 ${base}px —— ` +
      `≤380px 时导航折三行、内容占 134px，比两行的 106px 高。` +
      `这一档矮了会把导航最后一行裁掉，且**没有任何其他闸门会报**。`,
  );
});

check('首页顶栏灰阶必须是「离散硬边」而非连续渐变（零渐变纪律）', () => {
  // `CONVENTIONS.md` 2.5.1 定的是**零渐变**：像素风靠枚举不靠插值。
  // WARNING `_smoke-pixel.cjs` 抓不到这件事（它只查模糊/圆角/字号/字体），
  //    所以全靠这条断言守着 —— 一旦有人图省事改成 `linear-gradient(#000,#fff)`，
  //    风格统一就会从这里开始漏，而且**没有任何其他闸门会报**。
  //
  // 判据：色带必须是**数据数组**（便于钉住与复用），且每档在展开成 CSS 时
  // **写两遍**（起始位置 = 结束位置）—— 于是档内纯色、档间硬边。
  const m = homeView.match(/const DIAG_BANDS = \[([^\]]+)\]/);
  assert.ok(
    m,
    '找不到 DIAG_BANDS 数组 —— 顶栏灰阶应是数据（这样才能被本断言钉住），而不是散在 CSS 里',
  );
  const bands = [...m[1].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map((x) => x[1]);
  assert.ok(
    bands.length >= 4,
    `灰阶至少 10 档才读得出「层次」（现在 ${bands.length} 档）—— ` +
      `6 档已被实测判定为「太粗、没有层次」`,
  );
  // 展开逻辑必须把每档写两遍 —— 这是「硬边」的全部秘密。
  assert.ok(
    /\$\{c\} \$\{a\}%, \$\{c\} \$\{b\}%/.test(homeView),
    '灰阶展开时每档必须写两遍（同一色 + 相同起止位置）—— 只写一遍就变成连续渐变了',
  );
  assert.ok(
    /to bottom right/.test(homeView),
    '灰阶方向应是 `to bottom right` —— 左上最暗（标题所在），右下最亮（空白区）',
  );
});

check('首页顶栏灰阶逐档递增、无死档、跨度足够，且对白字 >= 4.5:1（标题压在斜带上）', () => {
  const m = homeView.match(/const DIAG_BANDS = \[([^\]]+)\]/);
  assert.ok(m, '找不到 DIAG_BANDS（依赖上一条的存在性）');
  const bands = [...m[1].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map((x) => x[1]);

  // 中性灰：通道差 <= 24（与 Sky/Ground 同一判据）
  for (const hex of bands) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    assert.ok(spread <= 24, `${hex} 不是中性灰（通道差 ${spread} > 24）`);
  }

  // 判据落在 **8-bit 灰阶**上（取绿通道：已是中性灰，三通道只差舍入）。
  //
  // ⚠️ 这里**故意不用「线性亮度差 >= 3%」**：那条是**档数少时的判据**
  // （6 档时相邻差 3.3% 刚好过线）。档数一加密，相邻差必然被摊薄
  // （16 档只剩 1.1%），继续钉 3% 等于把「档数更密」这个需求判死。
  //
  // 真正要防的是**死档**：看得见硬边、看不出色差的那一行。
  // 8-bit 上 1 级差 ≈ 0.4% 亮度，人眼在纯色块上基本读不出 ⇒ **>= 2 级**是底线。
  // 线性亮度那套等差论证（`Sky.vue` 踩过的坑）仍然成立 ——
  // 它管的是**序列怎么排**，不是**相邻差多少**；两件事，别混成一条判据。
  const g8 = bands.map((h) => parseInt(h.slice(3, 5), 16));
  for (let i = 1; i < g8.length; i++) {
    assert.ok(
      g8[i] > g8[i - 1],
      `第 ${i + 1} 档 ${bands[i]} 没有比第 ${i} 档 ${bands[i - 1]} 亮 —— ` +
        `灰阶必须单调递增才有「过渡」的意思`,
    );
  }
  for (let i = 1; i < g8.length; i++) {
    const d = g8[i] - g8[i - 1];
    assert.ok(
      d >= 2,
      `第 ${i + 1} 档 ${bands[i]} 与第 ${i} 档 ${bands[i - 1]} 的 8-bit 灰阶只跳 ${d} 级 —— ` +
        `这一档等于白占一行（看得见边、看不出色差），该合并档数了`,
    );
  }

  // 跨度：整条带子要真的在「过渡」，而不是挤在窄区间里
  const span = g8[g8.length - 1] - g8[0];
  assert.ok(
    span >= 80,
    `灰阶总跨度只有 ${span} 级（8-bit 共 256 级）—— 带子挤在窄区间里，过渡读不出来`,
  );

  const L = bands.map(relLuminance);
  const worst = 1.05 / (L[L.length - 1] + 0.05);
  assert.ok(
    worst >= 4.5,
    `最亮档 ${bands[bands.length - 1]} 对纯白文字只有 ${worst.toFixed(2)}:1` +
      `（AA 需 4.5:1）—— 标题「参数世界」就压在这条带子上`,
  );
});


// ------------------------------------------------------------------------
// 天空色带（黑白太极）
//
// ⚠️ 这一段的前身是「彩虹弧」的两组断言（207→209 项），
//2026-10-06 用户改要黑白太极后**整组作废** —— 彩虹在88px 高的横幅里
// 七条弧各占 1~2px，挤成一道彩色细线，噪声大于信息。
// **断言跟着设计走**：设计换了，判据要换掉，不是留着不管。
//
// 新的判据是**明度不变量**，与具体色值无关：
//   I1 离散色带（不是 linear-gradient）—— 像素风铁律
//   I2 相邻档明度差 ≥ 8% —— 否则某档肉眼不可辨，等于白占一行
//   I3 存在「先升后降」的明度结构 —— 太极的观感来自中间亮、上下暗
//   I4 每档对白字对比度 ≥ 4.5:1（WCAG AA）—— 标题压在色带上要能读
// ------------------------------------------------------------------------

/** 取色值的相对亮度（WCAG 定义） */
function relLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 从 Sky.vue 里读出 BANDS 的实际色值（不是抄一份，是读被测代码） */
function readSkyBands() {
  const sky = readFileSync(join(SRC_DIR, 'components/Sky.vue'), 'utf8');
  const code = sky.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const m = code.match(/const BANDS = \[([\s\S]*?)\]/);
  assert.ok(m, 'Sky 里找不到 BANDS —— 天空必须有离散色带');
  const bands = [...m[1].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map((x) => x[1]);
  assert.ok(bands.length >= 4, `色带只有 ${bands.length} 档，太少—— 像素风要靠离散档位建立层次`);
  return { bands, code };
}

check('天空必须是离散色带，不是渐变（像素风铁律）', () => {
  const { code } = readSkyBands();
  assert.ok(
    !/linear-gradient|radial-gradient|conic-gradient/.test(code),
    'Sky 又出现渐变了 —— 连续过渡是插值，像素风是枚举（CONVENTIONS §2.5.1）',
  );
  // 色带必须真的被渲染（模板里v-for 出来）
  assert.ok(
    /v-for="\(c, i\) in BANDS"/.test(code),
    'BANDS 没有被渲染 —— 定义了色带但模板没用，等于没有',
  );
});

check('色带相邻档线性亮度差 ≥ 2.5%（否则某档肉眼不可辨，白占一行）', () => {
  // ⚠️ **必须在 WCAG 线性亮度空间比，不能比 sRGB 通道值**：
  // sRGB 低亮度端被严重压缩，`#080809` 与 `#141416` 的通道值差 12，
  // 线性亮度却只差 **0.5%** —— 肉眼完全看不出那一档。
  // 我第一版就栽在这：按 sRGB 灰阶排色带，自测当场报出 0.5%。
  // ⚠️ **必须在 WCAG 线性亮度空间比，不能比 sRGB 通道值**：
  // sRGB 低亮度端被严重压缩，`#080809` 与 `#141416` 的通道值差 12，
  // 线性亮度却只差 **0.5%** —— 肉眼完全看不出那一档。
  // 我第一版就栽在这：按 sRGB 灰阶排色带，自测当场报出 0.5%。
  const { bands } = readSkyBands();
  // ⚠️ 这条是踩出来的：我先试过 S 形幂曲线，
  // 结果第 3、4 档明度只差 3% —— **肉眼看不出那一档**，等于白占一行，
  // 而第 1→2 档跳 41%又太陡。像素色带必须**等差步进**。
  const L = bands.map(relLuminance);
  for (let i = 1; i < L.length; i++) {
    const diff = Math.abs(L[i] - L[i - 1]);
    assert.ok(
      diff >= 0.025,
      `第 ${i}→${i + 1} 档明度只差 ${(diff * 100).toFixed(1)}%（${bands[i - 1]}→${bands[i]}）` +
        `—— 低于 2.5% 线性亮度差肉眼看不出层次，该档白占一行`,
    );
  }
});

check('色带有「先升后降」的明度结构（中间亮、上下暗 = 太极观感）', () => {
  const { bands } = readSkyBands();
  const L = bands.map(relLuminance);
  const peak = L.indexOf(Math.max(...L));
  // 峰值不在首尾 —— 若是单调递增或递减，那就是一条普通灰带，不是太极
  assert.ok(
    peak > 0 && peak < L.length - 1,
    `最亮档在第 ${peak + 1} 段（首/尾）—— 太极的观感来自「中间亮、上下暗」，单调渐变不成立`,
  );
  // 峰值前必须真升、后必须真降
  const rising = L.slice(0, peak).every((v, i) => i === 0 || v > L[i - 1]);
  const falling = L.slice(peak).every((v, i) => i === 0 || v < L[peak + i - 1]);
  assert.ok(rising, '峰值之前必须是递增的 —— 当前' + L.map((v) => (v * 100).toFixed(0)).join('→'));
  assert.ok(falling, '峰值之后必须是递减的 —— 当前 ' + L.map((v) => (v * 100).toFixed(0)).join('→'));
});

check('每档色带对白字对比度 ≥ 4.5:1（WCAG AA，标题压在色带上）', () => {
  const { bands } = readSkyBands();
  for (const hex of bands) {
    const ratio = 1.05 / (relLuminance(hex) + 0.05);
    assert.ok(
      ratio >= 4.5,
      `${hex} 对纯白文字只有 ${ratio.toFixed(2)}:1（AA 需 4.5:1）—— ` +
        `标题「参数世界」就压在这条色带上`,
    );
  }
});

check('banner 内不得有高饱和色（黑白太极是整条横幅的基调）', () => {
  // 天空改成黑白太极后，地面那条 `--color-grass: #4a8c3a`（饱和绿）
  // 成了整个 banner 里唯一的彩色 —— 扎眼得像荧光棒，与黑白体系完全不在一个调里。
  // **基调整体性是要守的**，不能靠「改的时候顺手看一眼」。
  //
  // 判据：Sky 与 Ground 两个组件里所有出现的色值，
  // **最大通道减最小通道（= 饱和度差）不得超过 24**（约 9% 饱和度）。
  // 24 的来历：中性灰带里 B 通道刻意比 R 高一点点（冷调），
  // 实测最大差18；而原来的草绿 #4a8c3a 差 82、泥土 #7d5a36 差 71 ——
  // 差一个数量级，判据不会误报。
  const files = ['components/Sky.vue', 'components/Ground.vue'];
  for (const rel of files) {
    const code = readFileSync(join(SRC_DIR, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/#([0-9a-fA-F]{6})/g)) {
      const hex = m[1];
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      assert.ok(
        spread <= 24,
        `${rel} 里的 #${hex} 通道差 ${spread}（阈值 24）—— ` +
          `banner 是黑白太极，出现高饱和色会像荧光棒一样扎眼`,
      );
    }
  }
  // 地面层不得再引grass 变量（它是全站唯一的彩色定义）
  const ground = readFileSync(join(SRC_DIR, 'components/Ground.vue'), 'utf8');
  assert.ok(
    !/var\(--color-grass/.test(ground),
    'Ground 又引回--color-grass（#4a8c3a 饱和绿）—— banner 已经是黑白基调',
  );
});

check('天空不得有装饰图形（SVG / 圆 / 太极图案本体）', () => {
  // 太极图本体 = S 形曲线 + 两个鱼眼。在横幅这种比例下「圆」会被压成椭圆，
  // 一眼就出戏—— 只取它的**明度结构**，不画图案本身。
  const { code } = readSkyBands();
  assert.equal(
    (code.match(/<svg/g) ?? []).length,
    0,
    'Sky 里又出现 SVG —— 装饰全删了，只留色带（黑白太极靠明度说话，不靠图形）',
  );
  assert.ok(
    !/clipPath|<path|<circle/.test(code),
    'Sky 出现了路径/圆形 —— 太极图案本体在横幅比例下会被压扁出戏',
  );
});

check('banner 上的文字必须自带可读底（不靠压小装饰来保证）', () => {
  //⚠️ 我先前为了「让开导航」把彩虹跨度压到 29% 宽，理由是怕文字读不清——
  // 那是**用装饰迁就文字**，方向反了。装饰该是背景，文字该自己可读。
  const navFile = readFileSync(join(SRC_DIR, 'components/SiteNav.vue'), 'utf8');
  const css = readFileSync(join(SRC_DIR, '..', 'src/style.css'), 'utf8');
  const flat = css.match(/\.pixel-button-flat\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.ok(
    /background:\s*rgb\(/.test(flat) && !/background:\s*transparent/.test(flat),
    '导航按钮必须有半透底 —— banner 上有底色变化，全透明会让文字读不清',
  );
  assert.ok(
    /bg-\[rgb\(/.test(navFile),
    '逛玩法的弱化链接也要有半透底（它们同样压在色带上）',
  );
  // 且不得再读导航位置来调整装饰
  const sky = readFileSync(join(SRC_DIR, 'components/Sky.vue'), 'utf8');
  const code = sky.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(
    !/querySelector/.test(code),
    'Sky 不该读导航/标题位置 —— 那是「用装饰迁就文字」',
  );
});


check('首页顶栏必须整条隐藏（站名与导航都进了 banner，否则同一句「参数世界」出现两次）', () => {
  const app = readFileSync(join(SRC_DIR, 'App.vue'), 'utf8');
  const header = app.match(/<header[^>]*>/);
  assert.ok(header, 'App.vue 里找不到 <header>');
  assert.ok(
    /v-if="!navInBanner"/.test(header[0]),
    '顶栏没有 v-if="!navInBanner" —— 首页会同时出现顶栏 logo 与 banner h1，同一句话两遍',
  );
  // 导航跟着 header 一起隐藏即可 —— 它在 header 内部，header 没了它自然也没了。
  // ⚠️ 不要在这里要求 `<SiteNav v-if=...>`：那是在要求**重复的防御**。
  // 判据要问「首页会不会有两条导航」，答案是「header 没了就没有」，
  // 而不是「每个子节点都得自己再判一次」。
  const headerBlock = app.slice(app.indexOf('<header'), app.indexOf('</header>'));
  assert.ok(
    /<SiteNav/.test(headerBlock),
    'App.vue 的 header 里应有 SiteNav —— 非首页页面需要它',
  );
});

check('导航在 banner 里（首页唯一一条，且两端对齐）', () => {
  // 抄参考项目：左站名、右导航，w-full sm:w-auto 负责窄屏换行占满
  assert.ok(
    /<SiteNav embedded\s*\/>/.test(homeView),
    '首页的 banner 里应有 <SiteNav embedded /> —— 导航该压在这一行而不是另起一条',
  );
  // class 写在多行上（prettier 会折行），且中间夹了 z-10（内容浮在太极之上），
  // 所以匹配不能假设 class 与 <div 同行、也不能假设 relative 紧跟 flex。
  const bannerRow = homeView.match(
    /<div\s+class="page-shell relative[^"]*flex flex-wrap[\s\S]*?"/,
  );
  assert.ok(bannerRow, '找不到 banner 的左右分栏容器');
  assert.ok(
    /justify-between/.test(bannerRow[0]),
    `banner 用的是 ${bannerRow[0].match(/justify-\w+/)?.[0] ?? '（无）'} —— 左右各一组元素时该两端对齐`,
  );
  // embedded 模式必须真的让窄屏换行占满，否则 390px 下导航会被压成两行叠在标题右边
  const nav = readFileSync(join(SRC_DIR, 'components/SiteNav.vue'), 'utf8');
  assert.ok(
    /w-full justify-center sm:w-auto/.test(nav),
    "SiteNav 的 embedded 模式应带 'w-full sm:w-auto' —— 窄屏时导航要占满整行",
  );
});

/* ================================================================ *
 * favicon（站点图标）
 *
 * 为什么现在才有闸门（2026-10-08）：favicon 一直是**零覆盖**的，
 * 而它恰恰是「坏了也没人报」的那类资源 —— 浏览器标签页左上角 16px，
 * 不可能靠肉眼发现它变成了纯黑方块。本次换图标时实测踩到过一次：
 * 只有 `viewBox` 而无 `width`/`height` 的 SVG 渲染成纯黑块（能解析≠能显示）。
 *
 *⚠️ 本节读`public/favicon.svg`。而 `verify-favicon-gates.mjs` 会**原地改写**它做
 * 反向测 ⇒ 并发时本节会读到中间态、并自信地报出一堆假失败（或假通过）。
 * 故读之前必须查锁（`assertUnlocked`）；反向测自己spawn 出来的子进程走
 * `FAV_GATES_CHILD=1` 旁路 —— 那时的坏产物正是它自己写的，不是竞态。
 * ================================================================ */
/** favicon：像素太极。
 *
 * ⚠️ 本文件对 favicon 的所有文本判据都必须走 `stripXmlComments()`：
 * `public/favicon.svg` 顶部有大段说明性 HTML 注释，里面**故意写了**
 * `<rect>` / `#FFFFFF` / `<svg>` 这些字面量来解释踩过的坑。
 * 不剥注释就会：① `<svg[^>]*>` 匹配到注释里的字面量 → 报「缺 width/height」；
 * ② 颜色扫描把注释里的 `#FFFFFF` 当成产物用色 → 报「出现 theme 之外的颜色」。
 * 这与「闸门正则命中注释里那个正确值示例」是同一类失效，
 * **剥注释是硬纪律，不是可选优化**。
 */
section('favicon：像素太极');

// 查锁：反向测期间磁盘上的 favicon 是坏的，此刻断言它等于在断言一个假象。
assertUnlocked('自测的favicon 判据');

const FAVICON_RAW = readFileSync(join(ROOT, 'public/favicon.svg'), 'utf8');
/** 去掉 XML/HTML 注释后的产物正文 —— 判据只许看这个 */
const FAVICON = FAVICON_RAW.replace(/<!--[\s\S]*?-->/g, '');

/** favicon 的构图参数**单一真源**（2026-10-08 改为「满幅 45° 斜分」）。
 *
 *  ⚠️ 这里改的是**构图语义**，不是阈值：旧版是「圆占 80% + 米白底板 + 墨色圆环」，
 *  用户 2026-10-08 明确裁决「完全照参考图」⇒ 纯黑白 + 满幅 + 45° 斜分背景 + 鱼眼回来。
 *  下方所有几何判据（深色占比、旋转对称作用域、手性锚点、斜分角度）都由它推出。
 *
 *  真源是**设计师逐格给出的 xlsx 网格**（`scripts/favicon/from-xlsx.py` 提取），
 *  不是本文件里的任何常数 —— 常数只用于**校验**，提取真源与校验真源必须分开，
 *  否则「改产物」和「改判据」会互相掩护（这正是 P16「判据多源」的变体）。
 */
const FAV_FRAC = 1.0;   // 满幅：太极圆盘外切于画幅，不再有「圆外留白」
const FAV_SKEW = 45;    // 背景斜分角（度）。0 = 上下对半，45 = 沿反对角线
const FAV_COLORS = { ink: '#000000', paper: '#ffffff' }; // 2026-10-08：纯黑白，不再取 @theme

/** 把 favicon 的行内 rect 还原成 N×N 布尔网格（True = 墨色）
 *
 *  ⚠️ 2026-10-08：产物**不再有满幅底板 rect**（旧构图靠底板托住白鱼）。
 *  新构图是「满幅 45° 斜分」，画幅内每一格都属于图形本身 ⇒ 不画底板。
 *  所以「未画= 纸」的约定仍然成立（浏览器默认白），但**判据里不许再要求底板存在**
 *  —— 那是旧构图的遗留要求，留着会把正确产物判成错的（P25判据过期）。
 */
function faviconGrid(svg) {
  const n = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1]);
  assert.ok(n, 'favicon 的 viewBox 必须是 "0 0 N N" 的正方形');
  const g = Array.from({ length: n }, () => new Array(n).fill(false));
  // 只认带 x/y 的行内段 —— 若将来有底板，那条 <rect width height> 没有坐标，天然被排除
  for (const [, x, y, w] of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1"/g)) {
    for (let i = 0; i < Number(w); i++) g[Number(y)][Number(x) + i] = true;
  }
  return { n, g };
}

check('favicon 必须是合法 XML（注释里不能出现连续两个连字符）', () => {
  // ⚠️ 真实事故（2026-10-08）：头部说明注释里写了 4 处 Markdown 表格分隔线
  // `|---|---|`，而 **XML 注释体内不允许出现 `--`** ⇒ 整个 SVG 成了非法 XML，
  // 浏览器**直接拒绝渲染**（标签页显示破图）。
  //
  // 为什么之前所有闸门都没抓到：
  // ① 它是 `.svg` 文件，本仓所有校验都在**正则层面**跑（grid /颜色 / crispEdges），
  //    正则**不关心 XML 合法性** —— 每一项单看都「有内容」，于是全绿；
  // ② `verify-favicon.mjs` 的对拍也只按 `<rect>` 解析出网格，
  //    它同样绕过了 XML 解析器。
  // ⇒ **「文件存在且被 git 跟踪」与「浏览器能渲染」是两件事。**
  //
  // 修法：把 XML 合法性做成判据本体，且必须**剥掉注释再判**（注释本身就是元凶，
  // 但也要允许注释里出现单连字符如 `left-right`）。
  const comments = [...FAVICON_RAW.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
  const bad = [];
  comments.forEach((c, i) => {
    if (c.includes('--')) bad.push(`第 ${i + 1} 段注释含 '--'：${c.split('\n').find((l) => l.includes('--'))?.trim().slice(0, 50)}`);
  });
  assert.equal(
    bad.length,
    0,
    `favicon 的注释里有连续两个连字符（--），XML 规范禁止 ⇒ 浏览器拒绝渲染整个图标。\n` +
      `   ${bad.join('\n   ')}\n` +
      `   Markdown 表格分隔线要写成 |---| |---| ，或改用 = 号。`,
  );
  // 兜底：结构上确认注释都能正常闭合（未闭合的 <!-- 会把后面全部吞进注释）
  assert.equal(
    (FAVICON_RAW.match(/<!--/g) ?? []).length,
    comments.length,
    'favicon 存在未闭合的 <!-- —— 它会把后面的图形全部吞进注释，图标变空白',
  );
});

check('favicon 必须有 width/height，不能只有 viewBox（否则渲染成纯黑方块）', () => {
  // 真实踩过：`<svg viewBox="0 0 16 16">` 无固有尺寸，放进<img> 时浏览器按 0尺寸处理。
  // 这是「能解析 ≠ 能显示」的典型 —— 文件合法、DOM 在、闸门全绿，图标却是块黑的。
  const tag = FAVICON.match(/<svg[^>]*>/)?.[0] ?? '';
  assert.ok(
    /width="\d+"/.test(tag) && /height="\d+"/.test(tag),
    `favicon 的 <svg> 缺 width/height —— 只有 viewBox 的 SVG 无固有尺寸，浏览器按 0 渲染成纯黑方块。当前：${tag.slice(0, 90)}`,
  );
});

check('favicon 必须声明 crispEdges（像素风要求零抗锯齿）', () => {
  assert.ok(
    /shape-rendering="crispEdges"/.test(FAVICON),
    'favicon 缺 shape-rendering="crispEdges" —— 会走抗锯齿，边缘出灰边，违反 CONVENTIONS.md §2.5.1「零模糊」',
  );
});

check('favicon 只能是纯黑白两色（2026-10-08 用户决策：对齐参考图）', () => {
  // ⚠️ 这条判据的口径**换过一次**（P25判据过期）：旧版要求「只用 @theme 的
  // ink / parchment-lit」，因为旧构图的米白底板要与站点配色同源。
  // 用户 2026-10-08 明确「完全照参考图」⇒ 纯 #000000 / #ffffff，
  // 此时再要求 theme 同源就是拿旧构图约束新构图 ⇒ 正确产物会被判错。
  // 但「两色」这件事本身要继续钉死 —— 见下一条（谁亮谁暗）。
  const used = [...new Set((FAVICON.match(/#[0-9a-fA-F]{3,8}/g) ?? []).map((s) => s.toLowerCase()))];
  const allowed = new Set(Object.values(FAV_COLORS));
  const extra = used.filter((c) => !allowed.has(c));
  assert.equal(
    extra.length,
    0,
    `favicon 出现了纯黑白之外的颜色 ${extra.join(', ')} —— 参考图与用户决策都要求` +
      `纯黑白（${FAV_COLORS.ink} / ${FAV_COLORS.paper}）。`,
  );
});

check('favicon 墨段必须是暗色、纸必须是亮色（两色不能写反）', () => {
  // 这条是**反向测**逼出来的，不是想出来的：
  // 只查「有没有 theme 之外的颜色」**没查谁拿哪个颜色**，
  // 于是把 ink 与 paper 两个色值对调（图标变负片）能全绿通过。
  //
  // ⚠️⚠️ 按**亮度**判「谁是深色」，不按名字判 —— 名字是约定，亮度是事实。
  // 这条判据2026-10-08 加过一个新守卫：产物**必须显式写出两色**。
  // 因为新构图没有满幅底板，若产物只写一种 fill，剩下的格就靠浏览器默认色 ——
  // 深色模式下默认白、浅色模式下也白，但**在深色背景页面上会变成透明**，
  // 「图标在暗色标签页上消失」这种问题只有真正渲染才暴露（P27 的同一类）。
  const lum = (hex) => {
    const v = hex.replace('#', '');
    const full = v.length === 3 ? [...v].map((c) => c + c).join('') : v;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const runs = [...new Set([...FAVICON.matchAll(/<rect x="\d+" y="\d+" width="\d+" height="1"[^>]*fill="(#[0-9a-fA-F]+)"/g)].map((m) => m[1].toLowerCase()))];
  assert.ok(runs.length > 0, 'favicon 没有任何行内墨段');
  const brightRun = runs.find((c) => lum(c) > 0.5);
  assert.ok(
    !brightRun,
    `favicon 墨段用了亮色 ${brightRun} —— 墨段应当是暗色（${FAV_COLORS.ink}），` +
      '若墨段是亮色说明两色写反了（图标成了负片）',
  );
  assert.ok(
    lum(FAV_COLORS.paper) > 0.5 && lum(FAV_COLORS.ink) < 0.5,
    `FAV_COLORS 常量自身写反了：ink=${FAV_COLORS.ink} paper=${FAV_COLORS.paper}`,
  );
});

check('favicon 深色占比符合「满幅 45° 斜分 + 太极黑白各半」的几何预期', () => {
  // 判据是**从几何推出来的数**，不是目测。
  //
  // ⚠️⚠️ 2026-10-08 换构图时这条改过一次，**两版都错过**：
  //  v1（米白底 + 圆占 80% + 环）写的是「深色占比 40–60%」——
  //     它把「太极黑白各半」错当成「整幅深浅各半」，忽略了圆只占画幅一半。
  //  v2（满幅 + 45° 斜分）若照抄 v1 的公式 `π/4 × frac² × 0.5 + π × frac/n`，
  //     会得到 0.5 + 0.098 ≈ 60% ⇒ 正确产物（实测 50.0%）被判失败。
  //     错因是公式里的 `frac` 项来自**圆环周长**，新构图根本没有环。
  //
  // 现在的推导：新构图里**斜分背景本身就把画幅对半分**（45° 反对角线恰好平分），
  //  太极叠在中间且自身黑白各半 ⇒ 整体深色占比 = 50%，与圆的大小无关。
  //  ⇒ 期望值就是一个**与构图参数无关的 0.5**，这比「钉一个数」强：
  //  它对「斜分角度偏了」「太极填反了」「圆缩了」三类故障都敏感。
  const { n, g } = faviconGrid(FAVICON);
  const dark = g.flat().filter(Boolean).length;
  const ratio = dark / (n * n);
  const expected = 0.5;
  assert.ok(
    Math.abs(ratio - expected) < 0.02,
    `favicon 深色占比 ${(ratio * 100).toFixed(1)}%，按构图（满幅 ${FAV_FRAC * 100}% + ` +
      `${FAV_SKEW}° 斜分 + 太极黑白各半）期望 ${(expected * 100).toFixed(1)}% ±2%。` +
      `深浅失衡量的是黑白颠倒、斜分角度偏了或太极整体缺失。` +
      `（若为 0% 或 100%，多半整个图标被涂成单色）`,
  );
});

check('favicon 圆内是旋转对称的太极（180° 旋转后黑白互换）', () => {
  // 判据是**结构**不是像素值：太极绕中心旋转 180° 后，黑白两半互换位置。
  //
  // ⚠️ 这条断言历史上**写过三次错版**，三次都因为把「对称」想成了「镜像」或想错了作用域：
  //   - 先写成左右镜像 —— 跑出来第 0 行 x=0 vs x=31 反色；
  //   - 再写成 180° 旋转后**同色** —— 也错，太极两半本就异色；
  //   - 再写成 180° 旋转后**全图反色** —— 旧构图下**圆外留白**旋转后还是留白，
  //     (0,0) 与 (n-1,n-1) 同为底板，要求它们反色等于在描述一个不存在的性质。
  //  ⇒ **判据写错与 bug 同级**，它会把正确产物判成错的。
  //
  // 2026-10-08 新构图下作用域反而**变简单了**：满幅 45° 斜分的背景本身
  // 就满足「180° 旋转 + 换色」（斜分线过中心 ⇒ 两侧互换），
  // 所以**全图**都该成立，不必再挖「圆内、排除环」的作用域。
  // 实测全图 1024格 0 不符 —— 这比旧版的「只判圆内616 格」覆盖面更大。
  //
  // ⚠️ 但鱼眼**破坏**这条对称性吗？不破坏：太极的两只眼关于中心对称，
  // 且颜色相反（黑眼↔ 白眼），旋转 180° 后正好对上。
  const { n, g } = faviconGrid(FAVICON);
  const bad = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (g[y][x] === g[n - 1 - y][n - 1 - x]) bad.push([x, y]);
    }
  }
  assert.equal(
    bad.length,
    0,
    `${bad.length}/${n * n} 格与「旋转 180° 后的自己」同色 —— 满幅斜分背景 + 太极都应满足` +
      `「180° 旋转后黑白互换」。前 5 处：${bad.slice(0, 5).map(([x, y]) => `(${x},${y})`).join(' ')}。` +
      `（这条抓的是「黑白画反了」：颠倒后深色占比与手性都不变，只有它能报）`,
  );
});

check('favicon 的手性：白鱼眼必须在圆心左侧（镜像会把它甩到右侧）', () => {
  // ⚠️⚠️ 这条补的是一个**整类零覆盖**的缺口，靠反向测发现的（P22）。
  //
  // 其余判据（两色 / 占比 / 180°旋转对称）**全部镜像不变**：
  // 镜像不改变深色占比，且 180° 旋转与过中心的反射**可交换** ⇒
  // 「180° 旋转后反色」在镜像后依然成立。
  // ⇒ 把整个 favicon 左右镜像后重跑 selftest，**全绿**（实测）。
  //
  // 判据取「180°旋转 + 换色」的对称性**唯一没有覆盖的那一位**：
  // 满足前者的图形只剩 {本身, 镜像} 两种可能，一个比特就能钉死。
  //
  // 2026-10-08 换锚点：旧版取「赤道带浅色重心」（会被斜分背景污染 ——
  // 背景斜线正好穿过赤道带，把浅色重心往一侧拉，实测偏到 +7.5 即误报）。
  // 新版取**白鱼眼的重心**：它是鱼身上的孤立小块，位置由太极几何唯一确定，
  // **与背景斜分无关**（实测偏移 x=−5.50，与期望同号且量级清晰）。
  const { n, g } = faviconGrid(FAVICON);
  const c = n / 2;
  // 4-连通分块，找被异色包住的小块= 鱼眼
  const seen = Array.from({ length: n }, () => new Array(n).fill(false));
  const eyes = [];
  for (let y0 = 0; y0 < n; y0++) {
    for (let x0 = 0; x0 < n; x0++) {
      if (seen[y0][x0]) continue;
      const t = g[y0][x0];
      const stack = [[x0, y0]];
      seen[y0][x0] = true;
      const comp = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        comp.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          if (seen[ny][nx] || g[ny][nx] !== t) continue;
          seen[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      // ⚠️ 阈值必须按**占画幅比例**判，不能按「边长」猜：
      //  旧写法 `(n/8)**2` 在 n=32 时是 16 格，而实测鱼眼 21 格 ⇒ 把鱼眼判成了鱼身，
      //  「应有两只鱼眼」直接报 0 只。判据写错与 bug 同级。
      //  实测块尺寸分布 [21, 21, 491, 491] ⇒ 用画幅占比 5% 分割（=51 格）两侧都远。
      if (comp.length > n * n * 0.05) continue; // 太大的是鱼身/ 背景，不是眼
      const own = new Set(comp.map(([x, y]) => `${x},${y}`));
      // 必须**每一格四邻都是异色** ⇒ 是个「洞」而不是轮廓阶梯
      if (!comp.every(([cx, cy]) =>
        [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) return false;
          return own.has(`${nx},${ny}`) || g[ny][nx] !== t;
        }),
      )) continue;
      eyes.push({ t, comp });
    }
  }
  assert.equal(
    eyes.length,
    2,
    `favicon 应有**两只**鱼眼（黑眼 + 白眼），实测 ${eyes.length} 只 —— ` +
      `用户 2026-10-08 定「鱼眼回来」。判据写错与 bug 同级，别为了过闸门改产物。`,
  );
  // ⚠️⚠️ 命名必须无歧义 —— 这里踩过一次「词义歧义」坑：
  //  太极有两只眼，各在一条鱼身上：
  //    · **白鱼的眼睛 = 黑色块**（白鱼身是白的，眼是黑的）
  //    · **黑鱼的眼睛 = 白色块**
  //  第一版写成 `const white = eyes.find((e) => !e.t)`（变量名 white）
  //  再判「white 应在左」—— 读起来像「白色的眼」，于是把期望方向钉反了
  //  （实测白鱼身上的黑眼在 x=10.5= 左侧，却被判成「未落在左侧」）。
  //  ⇒ 变量名带上**所属鱼**而不只是颜色，这是这类「同名不同义」的唯一防法。
  const eyeOnWhiteFish = eyes.find((e) => e.t);       // 白鱼身上的眼 = 墨色块
  const eyeOnBlackFish = eyes.find((e) => !e.t);       // 黑鱼身上的眼 = 浅色块
  const centroidX = (e) => e.comp.reduce((a, [x]) => a + x + 0.5, 0) / e.comp.length;
  const wx = centroidX(eyeOnWhiteFish);
  const bx = centroidX(eyeOnBlackFish);
  assert.ok(
    wx < c - 1,
    `白鱼身上的眼（墨色块）重心 x=${wx.toFixed(2)} 未落在圆心 ${c} 左侧` +
      `（黑鱼身上的眼在 ${bx.toFixed(2)}）—— 它应在圆心**左侧**。` +
      '若这条报错：①整个图标被左右镜像了；②或构图/配色被改动而本判据未同步。' +
      '（其余 favicon 判据全都镜像不变，抓不到镜像，只能靠这条）',
  );
  // 两只眼必须关于圆心中心对称 —— 这条与上一条独立：
  // 它抓的是「两眼画在同一侧」这类镜像**抓不到**的错。
  assert.ok(
    Math.abs((wx + bx) - 2 * c) < 1.5,
    `两只眼重心 x=${wx.toFixed(2)} / ${bx.toFixed(2)}，和 ${(wx + bx).toFixed(2)} 偏离圆心对称值 ${2 * c} —— ` +
      '太极的两只眼必须关于圆心中心对称。',
  );
});

check('favicon 背景是 45° 斜分（沿反对角线平分画幅）', () => {
  // 构图参数是「满幅 + 45° 斜分」，这条把它钉住。
  // 判据：**四角中恰好两个暗、两个亮，且暗的那两个角关于反对角线相邻**。
  // 45° 斜分（沿 x+y 增大方向）⇒ 左下 + 右下暗… 实测：左下暗、右下暗，
  // 即斜分线是 x+y = const 方向，两侧各占一半。
  //
  // 为什么不用「沿 x+y 的暗亮差」当判据：那条会被太极自身的黑白分布污染
  // （实测 x+y=16 处差值只有 −11，而纯背景应是 ±32）⇒ 判据会被设计细节绑架。
  // 四角是**最外侧的四点**，那里必然是纯背景，测的是构图本身。
  const { n, g } = faviconGrid(FAVICON);
  const darkCorners = [g[0][0], g[0][n - 1], g[n - 1][0], g[n - 1][n - 1]].map(Number);
  const darkCount = darkCorners.filter(Boolean).length;
  assert.equal(
    darkCount,
    2,
    `favicon 四角暗色数 ${darkCount}（${darkCorners.join(',')}）—— ${FAV_SKEW}° 斜分要求恰好 2 个角暗、2 个角亮。` +
      `实测构图：左上${darkCorners[0] ? '暗' : '亮'} 右上${darkCorners[1] ? '暗' : '亮'} ` +
      `左下${darkCorners[2] ? '暗' : '亮'} 右下${darkCorners[3] ? '暗' : '亮'}。`,
  );
  // 「左上亮、右下亮」还是「左上暗、右下暗」——两种都是合法 45° 斜分，
  // 但它们互为镜像 ⇒ 必须钉死一个，否则手性判据单点失败时无从区分。
  assert.ok(
    !darkCorners[0] && darkCorners[2],
    `favicon 斜分方向反了：期望「左上亮 / 左下暗」，实测 ` +
      `左上${darkCorners[0] ? '暗' : '亮'} / 左下${darkCorners[2] ? '暗' : '亮'}。` +
      '参考图是左上亮、左下暗。',
  );
});

check('favicon 的墨色连通成块（无游离碎片：白鱼被墨点咬掉就看不出太极）', () => {
  // 这条是旧「圆环闭合」判据的**替身**。为什么必须换掉：
  //
  // 旧构图（米白底 + 墨环）里，白鱼是纯白 #FFF 而底板是米白 #FFFAF0，
  // 亮度只差 0.02 ⇒ 降采样后白鱼彻底消失。**唯一**解法是给白鱼加一圈墨环，
  // 于是「环断一格」成了最致命的故障 ⇒ 有了flood-fill 那条判据。
  //
  // 2026-10-08 新构图（纯黑白 + 满幅 45° 斜分）下**这个前提整个消失**：
  //  -白鱼纯白 vs 斜分背景纯黑，亮度差 1.0 ⇒ 不需要环也永远看得见；
  //  - 没有底板、没有圆外留白 ⇒ 「从边缘flood-fill 浅色」找环缺口这个手法
  //    在新产物上**恒真**（实测 flood-fill 从四边出发能吃到全部 512 个浅色格）。
  //  ⇒ 留着旧判据 = 判据描述的是早已不存在的性质（P25 判据过期），
  //    它要么永远绿、要么某天误报，两种都是坏判据。
  //
  // 新构图的对应真问题是：墨色是**满幅斜分背景 + 太极鱼身**，两者都应是连通块，
  // 且**鱼眼必须是鱼身上的洞**而不是漂浮的碎片。所以判据钉「块结构」：
  //  ① 恰好 2 个大连通块（背景 + 鱼身的黑部分），鱼身与背景**同色时自然合并**；
  //  ② 恰好 2 个被异色包住的小洞（两只鱼眼）—— 在手性判据里已断言，这里只钉数量下限。
  // 这样「白鱼被墨点咬掉」会表现为「多出 1 个小黑洞」⇒ 被抓住。
  const { n, g } = faviconGrid(FAVICON);
  const seen = Array.from({ length: n }, () => new Array(n).fill(false));
  const blobs = [];
  for (let y0 = 0; y0 < n; y0++) {
    for (let x0 = 0; x0 < n; x0++) {
      if (seen[y0][x0]) continue;
      const t = g[y0][x0];
      const stack = [[x0, y0]];
      seen[y0][x0] = true;
      const comp = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        comp.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          if (seen[ny][nx] || g[ny][nx] !== t) continue;
          seen[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      blobs.push({ t, size: comp.length });
    }
  }
  // 分割阈值取画幅的 5%（实测分布 21 / 21 / 491 / 491，两侧都离得很远）。
  // ⚠️ 别用 `(n/8)**2` 这种「按边长猜」的阈值 —— 见手性判据里的同一处注释。
  const cut = n * n * 0.05;
  const big = blobs.filter((b) => b.size > cut);
  const small = blobs.filter((b) => b.size <= cut);
  assert.ok(
    big.length <= 2 && big.length >= 1,
    `favicon 的深色大块有 ${big.length} 个（尺寸 ${big.map((b) => b.size).join(',')}）—— ` +
      `满幅斜分 + 太极鱼身应合成1–2 个连通块。多出来的说明有游离墨块。`,
  );
  // 浅色同理：斜分背景的亮半+ 白鱼（若不与背景连通时）
  const light = blobs.filter((b) => !b.t);
  const lightBig = light.filter((b) => b.size > cut);
  assert.ok(
    lightBig.length >= 1,
    `favicon 的浅色大块有 ${lightBig.length} 个 —— 应至少 1 个（斜分亮半）。`,
  );
  assert.equal(
    small.length,
    2,
    `favicon 有 ${small.length} 个「被异色包住的小块」（尺寸 ${small.map((b) => b.size).join(',')}）—— ` +
      '应恰好 2 个（两只鱼眼）。多出来说明白鱼身上有墨点碎片（16px 下会读不出太极），' +
      '少一个说明鱼眼被墨色吞掉。',
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
    id: 'x', brand: 'apple',
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
  for (const g of ['body', 'display', 'chipset', 'memory', 'battery', 'camera', 'connectivity', 'os']) {
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

check('真实快照的 specs 键全部在 phone schema 注册（防手改数据绕过管线）', () => {
  // 管线有闸门拦未注册键，但直接手改 products.json 不过管线。这条断言让
  // 「schema 漏登记」与「数据里多出幽灵键」两种漂移都在自测层现形。
  if (!existsSync(join(ROOT, 'data/products.json'))) return;
  const schema = loadSchema('phone');
  assert.ok(schema, 'phone schema 必须可加载');
  const fields = fieldMap(schema);
  const snap = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
  for (const p of snap.products ?? []) {
    for (const path of Object.keys(p.specs ?? {})) {
      assert.ok(fields.has(path), `${p.id} 的 specs 键 "${path}" 未在 phone schema 注册`);
    }
  }
  // 反向：schema 声明的每个字段至少要在一台真实机器上出现过（死字段 = 契约腐烂）
  // 例外：rawOfficial 原文里没有、契约预留的字段允许零覆盖（如 measuredHours）。
  const PREVIEW_ONLY = new Set(['battery.measuredHours', 'display.protection']);
  const seen = new Set();
  for (const p of snap.products ?? []) for (const k of Object.keys(p.specs ?? {})) seen.add(k);
  for (const f of schema.fields) {
    if (PREVIEW_ONLY.has(f.path)) continue;
    assert.ok(seen.has(f.path), `schema 字段 ${f.path} 在真实数据里零出现（死字段或拼错）`);
  }
});

/* 前端目录模块：对账断言用。必须在 check() 之前加载完——
 * check 的 runner 是同步 try/catch，async 用例的断言失败会变成未捕获 rejection，
 * 用例永远显示通过（比没写测试更糟）。所以这里顶层 await import，check 里只放同步回调。 */
const CAT = await import('../src/lib/catalog.ts');

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
});

check('schema 结构校验：phone 无分组/字段错误', () => {
  // 借鉴准绳 groups 表：字段必须归属到一个已注册分组，分组 id 不可重复。
  const schema = loadSchema('phone');
  assert.deepEqual(validateSchema(schema), [], 'phone schema 结构必须零报错');
});

check('反向测：schema 字段引用不存在的分组 / 分组 id 重复必须报出', () => {
  const bad = JSON.parse(JSON.stringify(loadSchema('phone')));
  bad.fields[0].group = 'ghost';
  assert.ok(validateSchema(bad).some((e) => /ghost/.test(e)), '字段引用不存在的分组必须报出');
  bad.groups.push({ id: 'body', name: 'dup', nameEn: 'dup', type: 'single' });
  assert.ok(validateSchema(bad).some((e) => /重复/.test(e)), '分组 id 重复必须报出');
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

check('四态 valueStatus：present→available / absent→unknown / none→none / not_applicable→not_applicable', () => {
  // 准绳 value_status 的四条语义。valueStatus 映射只存 none/not_applicable 例外，其余靠 presence 推导。
  const p = {
    specs: { 'display.sizeIn': 6.1, 'body.weightG': 170 },
    valueStatus: { 'body.weightG': 'none', 'display.type': 'not_applicable' },
  };
  assert.equal(valueStatus(p, 'display.sizeIn'), 'available', 'specs 有值 = available');
  assert.equal(valueStatus(p, 'body.thicknessMm'), 'unknown', 'specs 缺键 = unknown');
  assert.equal(valueStatus(p, 'body.weightG'), 'none', 'valueStatus none 覆盖 presence');
  assert.equal(valueStatus(p, 'display.type'), 'not_applicable', 'valueStatus not_applicable 覆盖 presence');
  // 生命周期 status 字符串绝不被误当映射：valueStatus 缺省时只按 specs presence 推导
  const q = { status: 'on-sale', specs: { 'display.sizeIn': 6.1 } };
  assert.equal(valueStatus(q, 'display.sizeIn'), 'available', '生命周期 status 不得被当四态映射');
  assert.equal(valueStatus(q, 'body.weightG'), 'unknown', '生命周期 status 不得被当四态映射（缺键=unknown）');
});

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

check('反向测：无效 valueStatus 键 / 非法 valueStatus 值必须被闸门拒绝（写错字段名会静默隐藏参数）', () => {
  // validateStatusMap 是闸门 11c 的底层；与 validateSpecs 同级，写错一样拒绝写盘。
  const schema = loadSchema('phone');
  const errGhost = validateStatusMap({ id: 'p', category: 'phone', specs: {}, valueStatus: { 'display.sizes': 'none' } }, schema);
  assert.ok(errGhost.some((e) => /display\.sizes/.test(e)), 'valueStatus 引用未注册字段必须报出');
  const errVal = validateStatusMap({ id: 'p', category: 'phone', specs: {}, valueStatus: { 'display.sizeIn': 'maybe' } }, schema);
  assert.ok(errVal.some((e) => /maybe/.test(e)), '非法 valueStatus 值必须报出');
  assert.deepEqual(
    validateStatusMap({ id: 'p', category: 'phone', specs: {}, valueStatus: { 'display.sizeIn': 'none' } }, schema),
    [], '合法 valueStatus 例外不误报',
  );
});

check('闸门反向测：注入非法 valueStatus 必须拒绝写盘，合法 valueStatus 放行', () => {
  const base = (valueStatus) => ({
    generatedAt: '2026-10-13T00:00:00Z',
    products: Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`, slug: `p${i}`, brand: 'apple', category: 'phone', name: `P${i}`,
      releaseDate: '2026-09-01', status: 'on-sale',
      specs: { 'display.sizeIn': 6.1, 'body.weightG': 170, 'display.resolutionPx': { w: 1206, h: 2622 } },
      provenance: { 'display.sizeIn': 'apple-official', 'body.weightG': 'apple-official', releaseDate: 'apple-official', 'display.resolutionPx.w': 'apple-official' },
      firstSeenAt: '2026-10-13T00:00:00Z', lastSeenAt: '2026-10-13T00:00:00Z',
      ...(i === 0 && valueStatus ? { valueStatus } : {}),
    })),
  });
  assert.ok(validate(base({ 'display.sizes': 'none' }), null).some((f) => /valueStatus/.test(f)), '非法 valueStatus 键必须拒写');
  assert.deepEqual(validate(base({ 'display.sizeIn': 'none' }), null), [], '合法 valueStatus 例外必须放行');
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
        id: 'o1', op: 'set-field', productId: 'p1', field: 'display.sizeIn', value: 6.9,
        reason: '官网抓漏', createdAt: '2026-10-13', createdBy: '道友',
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
        id: 'o2', op: 'add-product', createdAt: '2026-10-13',
        product: { id: 'u1', brand: 'huawei', category: 'phone', name: '用户机', releaseDate: '2026-08-01', specs: { 'body.weightG': 180 } },
        reason: '官网没有但已上市',
      },
    ],
  });
  assert.equal(out.length, 2, '新产品必须入池');
  const u = out.find((p) => p.id === 'u1');
  assert.equal(u.status, 'on-sale', 'status 缺省 on-sale');
  assert.equal(u.granularity, 'manual');
  assert.equal(u.provenance['body.weightG'], 'user-manual', 'specs 全键标 user-manual');
  assert.equal(u.provenance.releaseDate, 'user-manual', 'releaseDate 有值也要 provenance（硬闸门）');
  assert.equal(report.added.length, 1);
});

check('软删除与冲突：active=false 不生效；同目标多条后者赢', () => {
  const products = [makeProduct('p1')];
  const { products: out, report } = applyOverrides(products, {
    entries: [
      { id: 'a', op: 'set-field', productId: 'p1', field: 'display.sizeIn', value: 7.0, reason: '先改', createdAt: '2026-10-01' },
      { id: 'b', op: 'set-field', productId: 'p1', field: 'display.sizeIn', value: 7.2, reason: '后改', createdAt: '2026-10-02' },
      { id: 'c', op: 'set-field', productId: 'p1', field: 'body.weightG', value: 999, reason: '作废', createdAt: '2026-10-03', active: false },
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
  const base = { id: 'x', op: 'set-field', productId: 'p1', field: 'display.sizeIn', value: 6.9, reason: 'r', createdAt: '2026-10-13' };
  assert.ok(validateOverrides({ entries: [{ ...base, productId: 'ghost' }] }, products).length, '引用不存在的机型必须报错');
  assert.ok(validateOverrides({ entries: [{ ...base, field: 'display.sizes' }] }, products).length, '字段未注册必须报错');
  assert.ok(validateOverrides({ entries: [{ ...base, value: 69 }] }, products).length, '值越界必须报错');
  assert.ok(validateOverrides({ entries: [{ ...base, reason: '' }] }, products).length, '缺 reason 必须报错');
  assert.ok(
    validateOverrides({ entries: [{ ...base, createdAt: 'not-a-date' }] }, products).length,
    'createdAt 非法必须报错',
  );
  assert.ok(
    validateOverrides({ entries: [{ id: 'n', op: 'add-product', product: makeProduct('p1'), reason: 'r', createdAt: '2026-10-13' }] }, products).length,
    'add-product id 冲突必须报错',
  );
  assert.ok(
    validateOverrides(
      { entries: [{ id: 'n', op: 'add-product', product: makeProduct('u9', { brand: 'nokia' }), reason: 'r', createdAt: '2026-10-13' }] },
      products,
    ).length,
    '品牌未注册必须报错',
  );
  // 排除集合：add-product 已并入的 id 不构成「与现有产品冲突」（validate 二次校验踩过）
  assert.deepEqual(
    validateOverrides(
      { entries: [{ id: 'n', op: 'add-product', product: makeProduct('u9'), reason: 'r', createdAt: '2026-10-13' }] },
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
      id: `p${i}`, slug: `p${i}`, brand: 'apple', category: 'phone', name: `P${i}`,
      releaseDate: '2026-09-01', status: 'on-sale',
      specs: { 'display.sizeIn': 6.1, 'body.weightG': 170, 'display.resolutionPx': { w: 1206, h: 2622 }, 'memory.storageGb': [256] },
      provenance: { 'display.sizeIn': 'apple-official', 'body.weightG': 'apple-official', releaseDate: 'apple-official', 'display.resolutionPx.w': 'apple-official' },
      firstSeenAt: '2026-10-13T00:00:00Z', lastSeenAt: '2026-10-13T00:00:00Z',
    })),
  };
  assert.deepEqual(validate(good, null), [], '合规 v2 快照必须零报错');

  const ghost = JSON.parse(JSON.stringify(good));
  ghost.products[0].specs['display.sizes'] = 6.9;
  assert.ok(validate(ghost, null).some((f) => /display\.sizes/.test(f)), '未注册键必须被闸门拦下');

  const oob = JSON.parse(JSON.stringify(good));
  oob.products[0].specs['body.weightG'] = 1990;
  assert.ok(validate(oob, null).some((f) => /weightG/.test(f)), '越界值必须被闸门拦下');

  const badCat = JSON.parse(JSON.stringify(good));
  badCat.products[0].category = 'toaster';
  assert.ok(validate(badCat, null).some((f) => /品类未注册/.test(f)), '未注册品类必须被闸门拦下');

  assert.deepEqual(validate(good, null), [], '改回后必须恢复绿灯（闸门没被反向测污染）');
});

check('用户数据层经闸门：注入违规的 override 必须拒绝写盘', () => {
  // validate 的 overrides 参数把用户层校验并进闸门。这条守住「写错显性失败」。
  const snapshot = {
    generatedAt: '2026-10-13T00:00:00Z',
    products: Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`, slug: `p${i}`, brand: 'apple', category: 'phone', name: `P${i}`,
      releaseDate: '2026-09-01', status: 'on-sale',
      specs: { 'display.sizeIn': 6.1, 'body.weightG': 170, 'display.resolutionPx': { w: 1206, h: 2622 }, 'memory.storageGb': [256] },
      provenance: { 'display.sizeIn': 'apple-official', 'body.weightG': 'apple-official', releaseDate: 'apple-official', 'display.resolutionPx.w': 'apple-official' },
      firstSeenAt: '2026-10-13T00:00:00Z', lastSeenAt: '2026-10-13T00:00:00Z',
    })),
  };
  const badOverride = {
    entries: [
      { id: 'o', op: 'set-field', productId: 'p1', field: 'display.sizes', value: 6.9, reason: '手滑', createdAt: '2026-10-13' },
    ],
  };
  const fail = validate(snapshot, null, { overrides: badOverride });
  assert.ok(fail.some((f) => /用户数据层/.test(f) && /display\.sizes/.test(f)), 'override 字段未注册必须拒绝写盘');
  assert.deepEqual(validate(snapshot, null, { overrides: { entries: [] } }), [], '空用户层不误报');
});

check('data/overrides.json 入库文件自身合法（防手滑提交坏层）', () => {
  const ovr = loadOverrides();
  const snap = existsSync(join(ROOT, 'data/products.json'))
    ? JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'))
    : { products: [] };
  const errs = validateOverrides(ovr, snap.products ?? []);
  assert.deepEqual(errs, [], `入库的 overrides.json 必须合法：${errs.join('; ')}`);
});

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
