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
import { installTsResolver } from './ts-resolver.mjs';
// 必须在任何 `await import('../src/lib/*.ts')` 之前装好：search.ts / canvasFilter.ts
// 内部用 Vite 约定写 `from './query'`（无扩展名），Node 默认解析不了，靠这个钩子补。
installTsResolver();
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
import { validate, LIMITS, REQUIRED_PATHS } from './sync/validate.mjs';

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

check('真实数据能跑通球面：60 台全部落在视口内且不重叠成堆', () => {
  const pj = join(ROOT, 'data/products.json');
  if (!existsSync(pj)) return;
  const snap = JSON.parse(readFileSync(pj, 'utf8'));
  const n = (snap.products ?? []).length;
  if (!n) return;
  const vp = { w: 1200, h: 700 };
  const pts = G.spherePoints(n, [47, 13]);
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
  const setEq = (a, b) =>
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

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
  const ids = (q) => S.search(mixed, q).map((d) => d.product.id).sort();

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
const cjkIds = (q) => S.search(CJK_DOCS, q).map((d) => d.product.id).sort();

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
  assert.deepEqual(Q.splitRuns('苹果手机'), ['苹果手机'], '纯汉字整词原样返回，不空拆（见 splitRuns 注释）');
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
  const ids = (q) => S.search(noisy, q).map((d) => d.product.id).sort();

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

  for (const q of ['mate80', 'nova14', '苹果16', '苹果 16', 'iphone16', 'nova 14 ultra', '苹果16promax']) {
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
