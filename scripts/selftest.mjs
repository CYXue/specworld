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
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripInvisible, normalizeKey, firstNumber, allNumbers,
  parseMm, parseG, parseInch, parsePpi, parseWatt, parseNits, parseHz,
  parseCapacity, parseStorageList, parseResolution, parseRefresh,
  parseWeight, parseBrightness, sliceByVariants, slugify,
} from './normalize/parse.mjs';
import { validate, LIMITS, REQUIRED_PATHS } from './sync/validate.mjs';
import { DICT, t, pick, htmlLang, auditDict, LANGS, DEFAULT_LANG } from './site/lib/i18n.mjs';
import { mapHuawei } from './normalize/brands/huawei.mjs';
import { mapAppleSpecs, mapAppleCompare } from './normalize/brands/apple.mjs';

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
      out[k] = !REPLACE.has(k) && MERGE_INTO.has(k) && v && typeof v === 'object' && !Array.isArray(v)
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
    products: Array.from({ length: 25 }, (_, i) => phone({ ...apply(base), id: over.id ?? `x${i}` })),
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
  const t = '6.3 英寸全面屏，2622 x 1206 像素分辨率，460 ppi，ProMotion 自适应刷新率技术，最高可达 120Hz';
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
    const top = Math.max(...String(r.text).split(/[-–~/]/).map(Number).filter(Number.isFinite));
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
    'iPhone 18 Pro', 'iPhone 18 Pro Max',
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
  assert.ok(validate({ products: Array.from({ length: 25 }, () => phone()) }, null)
    .some((f) => f.includes('id 重复')));
});

check('空数组被拦（上游返回空是最常见的失败形态）', () => {
  assert.ok(validate({ products: [] }, null).length > 0);
});

check('PPI 越界被拦', () => {
  assert.ok(validate(fleet({ display: { sizeIn: 6.1, ppi: 2622 } }), null)
    .some((f) => f.includes('display.ppi')));
});

check('刷新率 2160 被拦（这就是补闸门那次拦住的）', () => {
  const f = validate(fleet({ display: { sizeIn: 6.1, refreshHz: '2160' } }), null);
  assert.ok(f.some((x) => x.includes('refreshHz') && x.includes('PWM')),
    '应给出「疑似把 PWM 调光频率当成刷新率」的提示');
});

check('刷新率区间上界合法则放过', () => {
  assert.ok(!validate(fleet({ display: { sizeIn: 6.1, refreshHz: '1-120' } }), null)
    .some((x) => x.includes('refreshHz')));
});

check('有容量无口径被拦（不可比）', () => {
  // 整段替换掉 battery，才能制造出「有容量、没口径」这个组合
  assert.ok(validate(fleet({ battery: { capacityMah: 4000 }, __replace: ['battery'] }), null)
    .some((f) => f.includes('capacityCaliber')));
});

check('峰值亮度小于典型亮度被拦', () => {
  assert.ok(validate(fleet({ display: { sizeIn: 6.1, brightnessPeakNits: 800, brightnessTypicalNits: 1000 } }), null)
    .some((f) => f.includes('峰值亮度小于典型亮度')));
});

check('有值但缺 provenance 被拦', () => {
  assert.ok(validate(fleet({ provenance: {}, __replace: ['provenance'] }), null)
    .some((f) => f.includes('provenance')));
});

check('对象型字段的 provenance 查子路径而不是父路径（回归）', () => {
  // 事故（2026-10-03 由 scripts/qa/coverage.mjs 抓到）：
  // display.resolutionPx 是 {w,h} 对象，规范化层登记的是 `display.resolutionPx.w`，
  // 闸门却查父路径 `display.resolutionPx` —— 结果 **60 台全部**报「缺 provenance」，
  // 每台一条假警。规范化层早已特判过子路径，闸门这边漏了。
  //
  // 这条断言的作用是锁住两端口径必须一致：登记侧写子路径，校验侧也得查子路径。
  const noSub = fleet({ provenance: { 'display.resolutionPx': 'apple' }, __replace: ['provenance'] });
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
      phone({ id: `x${i}`, ...(i % 2 ? { releaseDate: null } : {}) })),
  };
  assert.ok(validate(now, prev).some((f) => f.includes('覆盖率')));
});

check('同一赛制两种量纲被拦（跨赛制分数永不混算）', () => {
  assert.ok(validate(fleet({ scores: [
    { league: 'A', score: 100, unit: '分' },
    { league: 'A', score: 0.9, unit: 'pass@1' },
  ] }), null).some((f) => f.includes('两种量纲')));
});

check('零值不被当作缺数据混过（正数校验）', () => {
  assert.ok(validate(fleet({ body: { weightG: 0, thicknessMm: 8 } }), null)
    .some((f) => f.includes('非正数')));
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
 * 11. i18n 字典
 * ================================================================ */
section('i18n 字典');

check('每个键在每种语言下都齐备', () => {
  // 这条是**数据驱动**的：往字典里加键时若漏了某门语言，这里立刻报出来，
  // 不需要有人记得手动改断言。
  const problems = auditDict();
  assert.deepEqual(problems, [], `字典缺项${problems.length} 处：\n  ${problems.slice(0, 12).join('\n  ')}`);
});

check('取中文正常', () => {
  assert.equal(t(DICT.nav, 'home', 'zh'), '今日格局');
  assert.equal(t(DICT.site, 'name', 'zh'), '手机参数世界');
  assert.equal(t(DICT.common, 'unpublished', 'zh'), '官方未公布');
});

check('取英文正常（架子已填的部分）', () => {
  assert.equal(t(DICT.nav, 'home', 'en'), 'Today');
  assert.equal(t(DICT.site, 'name', 'en'), 'Phone Spec World');
  assert.equal(t(DICT.common, 'unpublished', 'en'), 'Not disclosed');
});

check('缺键抛错，绝不静默回退到中文', () => {
  // 这是本模块最重要的一条纪律。静默回退会让英文页里混进中文，
  // 而那种错误不抛异常、不影响构建、页面上也不显眼 —— 通常要等读者投诉才发现。
  assert.throws(() => t(DICT.nav, 'no-such-key', 'zh'), /字典缺键/);
  assert.throws(() => t(DICT, 'no.such.path', 'zh'), /字典缺键/);
});

check('html lang标签按语言给', () => {
  assert.equal(htmlLang('zh'), 'zh-CN');
  assert.equal(htmlLang('en'), 'en');
});

check('字典里没有裸英文占位（en 值必须是真英文）', () => {
  // 防的是：建英文页时先占位成 "TODO" 或直接留中文，
  // 然后忘记回填 —— 页面看起来是英文的，读者却读不懂
  const bad = [];
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.en === 'string') {
      if (!node.en.trim()) bad.push(`${path}: en 为空`);
      else if (/^[\u4e00-\u9fa5]+$/.test(node.en)) bad.push(`${path}: en 仍是纯中文「${node.en}」`);
      else if (/TODO|FIXME|Lorem/i.test(node.en)) bad.push(`${path}: en 是占位符「${node.en}」`);
    }
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(DICT, '');
  assert.deepEqual(bad, [], bad.join('; '));
});

check('pick 对单语言常量也能给出兜底', () => {
  // 数据派生文案（FORM_FACTORS / METRICS.label）目前是单语言的，
  // pick 不能因为缺 en 就崩掉 —— 它是翻译前的临时通道
  const single = { a: { zh: '甲', label: '甲' }, b: '乙' };
  const zh = pick(single, 'zh');
  assert.equal(zh.a, '甲');
  assert.equal(zh.b, '乙');
});

check('头条衔与指标名在字典里齐备（derive.mjs 的常量不能漏）', () => {
  // 字典与 derive.mjs 的 TITLES / METRICS 是一一对应关系。
  // 少一条 = 某个头衔在英文页上取不到文案。这个断言把两份清单绑在一起。
  const TITLES = ['lightest', 'thinnest', 'biggest-screen', 'sharpest', 'brightest',
    'longest-battery', 'fastest-charge', 'most-storage', 'newest'];
  for (const id of TITLES) {
    assert.ok(DICT.titles[id], `字典缺少头衔 ${id}`);
  }
  const METRICS = ['weightG', 'thicknessMm', 'screenIn', 'ppi', 'brightnessPeakNits',
    'batteryMah', 'wiredChargeW', 'storageMaxGb', 'priceCny', 'releaseDate'];
  for (const k of METRICS) {
    assert.ok(DICT.metrics[k], `字典缺少指标 ${k}`);
  }
});

check('来源名在字典里齐备（provenance 的取值必须都能显示）', () => {
  // provenance 的值是数据里的字符串，字典漏一条 = 某个来源在页面上显示成键名本身
  const sources = new Set();
  const pj = join(ROOT, 'data/products.json');
  if (existsSync(pj)) {
    const snap = JSON.parse(readFileSync(pj, 'utf8'));
    for (const p of snap.products ?? []) {
      for (const v of Object.values(p.provenance ?? {})) sources.add(v);
    }
  }
  for (const s of sources) {
    assert.ok(DICT.source[s], `字典缺少来源名 ${s}（出现在 provenance 里但页面无法显示）`);
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
check('苹果规格页映射 ↔ golden', () => assertGolden(mapAppleSpecs, 'apple-specs.json', '苹果规格页'));
check('苹果对比页映射 ↔ golden', () => assertGolden(mapAppleCompare, 'apple-compare.json', '苹果对比页'));

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