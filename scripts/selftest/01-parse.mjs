import {
  assert, createHash, existsSync,
  readFileSync, readdirSync, statSync,
  writeFileSync, mkdirSync, rmSync,
  tmpdir, join, resolve,
  dirname, fileURLToPath, DERIVE,
  WQ, FP, S,
  Q, C, F,
  ADAPT, DV, SUMMARY,
  CAT, FIELDS_LIB, SPECS_LIB,
  FACETS_LIB, CMP, ARCHIVE_TOP_FIELDS,
  ARCHIVE_VOLATILE_FIELDS, productFields, shapeOfArchive,
  assertUnlocked, applyOverrides, loadOverrides,
  validateOverrides, __clearSchemaOverridesForTest, __overrideSchemaForTest,
  fieldMap, isRegisteredCategory, LIFECYCLE_STATUS_VALUES,
  loadCategories, loadSchema, quantifiableFields,
  validateSchema, validateSpecs, validateSpecValue,
  groupsOf, fieldsByGroup, valueStatus,
  validateStatusMap, expandSpecs, flattenSpecs,
  pick, setSpec, mapAppleSpecs,
  mapAppleCompare, mapHuawei, stripInvisible,
  normalizeKey, firstNumber, allNumbers,
  parseMm, parseG, parseInch,
  parsePpi, parseWatt, parseNits,
  parseHz, parseCapacity, parseStorageList,
  parseResolution, parseRefresh, parseWeight,
  parseBrightness, sliceByVariants, slugify,
  parseOis, validate, LIMITS,
  REQUIRED_PATHS, FIELD_LIMITS, SCHEMA_RANGE_PATHS,
  ROOT, phone, fleet,
  refreshHzNumber, v2, v2Fleet,
  BRAND_FIXTURE_DIR, assertGolden, P2025,
  sdoc, DOCS, names,
  CJK_DOCS, cjkIds, REAL,
  REAL_P, REAL_LABELS, DIMS,
  pdoc, RAW_ARCHIVE_DIR, SRC_DIR,
  allVueSource, makeProduct,
} from './context.mjs';
import { check, section } from './runtime.mjs';

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
