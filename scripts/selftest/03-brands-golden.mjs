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
  mapAppleCompare, mapHuawei, mapHuaweiTablet, mapHuaweiWearable, mapHuaweiMonitor, mapHuaweiLaptop, mapHuaweiAudio, mapHuaweiVision, mapHuaweiRouter,
  mapXiaomi, mapXiaomiTablet, mapXiaomiLaptop, mapXiaomiVision, mapXiaomiWearable, mapXiaomiAudio, mapXiaomiMonitor, mapXiaomiRouter, mapXiaomiAppliance, mapXiaomiHistory,
  stripInvisible,
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
check('华为规格页映射 ↔ golden', () => assertGolden(mapHuawei, 'huawei.json', '华为'));
check('华为平板映射 ↔ golden', () =>
  assertGolden(mapHuaweiTablet, 'huawei-tablets.json', '华为平板'),
);
check('华为穿戴映射 ↔ golden', () =>
  assertGolden(mapHuaweiWearable, 'huawei-wearables.json', '华为穿戴'),
);
check('华为显示器映射 ↔ golden', () =>
  assertGolden(mapHuaweiMonitor, 'huawei-monitors.json', '华为显示器'),
);
check('华为笔记本映射 ↔ golden', () =>
  assertGolden(mapHuaweiLaptop, 'huawei-laptops.json', '华为笔记本'),
);
check('华为音频映射 ↔ golden', () =>
  assertGolden(mapHuaweiAudio, 'huawei-audio.json', '华为音频'),
);
check('华为智慧屏映射 ↔ golden', () =>
  assertGolden(mapHuaweiVision, 'huawei-visions.json', '华为智慧屏'),
);
check('华为路由器映射 ↔ golden', () =>
  assertGolden(mapHuaweiRouter, 'huawei-routers.json', '华为路由器'),
);
check('小米关键参数映射 ↔ golden', () =>
  assertGolden(mapXiaomi, 'xiaomi.json', '小米'),
);
for (const [fx, fn, label] of [
  ['xiaomi-tablet', mapXiaomiTablet, '小米平板'],
  ['xiaomi-laptop', mapXiaomiLaptop, '小米笔记本'],
  ['xiaomi-tv', mapXiaomiVision, '小米电视'],
  ['xiaomi-wearable', mapXiaomiWearable, '小米穿戴'],
  ['xiaomi-headset', mapXiaomiAudio, '小米耳机'],
  ['xiaomi-speaker', mapXiaomiAudio, '小米音箱'],
  ['xiaomi-display', mapXiaomiMonitor, '小米显示器'],
  ['xiaomi-network', mapXiaomiRouter, '小米路由器'],
  ['xiaomi-appliance', mapXiaomiAppliance, '米家家电'],
  ['xiaomi-washer', mapXiaomiAppliance, '米家洗衣机'],
  ['xiaomi-aircon', mapXiaomiAppliance, '米家空调'],
  ['xiaomi-aircare', mapXiaomiAppliance, '米家空气净化'],
  ['xiaomi-cleaner', mapXiaomiAppliance, '米家清洁电器'],
  ['xiaomi-kitchen', mapXiaomiAppliance, '米家厨房电器'],
  ['xiaomi-waterpurifier', mapXiaomiAppliance, '米家净水器'],
  ['xiaomi-lock', mapXiaomiAppliance, '小米门锁'],
  ['xiaomi-history', mapXiaomiHistory, '小米历史机型'],
]) {
  check(`${label}映射 ↔ golden`, () => assertGolden(fn, `${fx}.json`, label));
}
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

/* 华为音频 / 路由：三类「看起来合理但取错字段」的静默故障，必须钉死。
 * 这几条都是 2026-10-27 审计出的真实错位，不是假想：
 *   · 路由按数值排序猜三维 → BE7 折叠态的 195.48 宽被记成高度；
 *   · `512 MB RAM + 128 MB ROM` 只认 `X MB +` → RAM 空、ROM 误得 0.13 GB；
 *   · 「通话降噪（不支持主动降噪）」含「主动降噪」子串 → 被发布成支持降噪。 */
const hwRouterOf = (raw, name = 'Test Router') =>
  mapHuaweiRouter({ id: 'test-router', name, raw, extractedAt: '2026-10-27T00:00:00.000Z' });

check('华为路由尺寸：长×宽×高 必须按标签落位（不按数值排序猜）', () => {
  const rec = hwRouterOf({
    '尺寸与重量.天线折叠': '288 mm（长）× 195.48 mm（宽）× 72.43 mm（高）',
    '尺寸与重量.天线直立': '288 mm（长）× 171.63 mm（宽）× 210.48 mm（高）',
  });
  assert.equal(rec.body.heightMm, 72.43);
  assert.equal(rec.body.widthMm, 288);
  assert.equal(rec.body.depthMm, 195.48);
});

check('华为路由尺寸：高/宽/厚 分轴键按立面口径落位', () => {
  const rec = hwRouterOf({
    '尺寸与重量.高度': '300 mm',
    '尺寸与重量.宽度': '175 mm',
    '尺寸与重量.厚度': '64 mm',
  });
  assert.equal(rec.body.heightMm, 300);
  assert.equal(rec.body.widthMm, 175);
  assert.equal(rec.body.depthMm, 64);
});

check('华为路由尺寸：圆柱机身直径同时落 width 与 depth', () => {
  const rec = hwRouterOf({
    '尺寸与重量.高度': '227.2 mm',
    '尺寸与重量.直径': '115.4 mm',
  });
  assert.equal(rec.body.heightMm, 227.2);
  assert.equal(rec.body.widthMm, 115.4);
  assert.equal(rec.body.depthMm, 115.4);
});

check('华为路由内存：`512 MB RAM + 128 MB ROM` 与「运行内存/机身内存」两种写法都要取到', () => {
  const a = hwRouterOf({ 存储: '512 MB RAM + 128 MB ROM' });
  assert.deepEqual(a.memory.ramGb, [0.5]);
  assert.deepEqual(a.memory.storageGb, [0.13]);
  const b = hwRouterOf({ 存储: '运行内存（RAM）：128 MB | 机身内存（ROM）：128 MB' });
  assert.deepEqual(b.memory.ramGb, [0.13]);
  assert.deepEqual(b.memory.storageGb, [0.13]);
});

check('华为路由网口：以太网口优先于「接口」（接口含按键与电源口）', () => {
  const rec = hwRouterOf({
    网口: '1 个 10/100/1000 M 自适应速率的以太网接口',
    接口: '电源口、网口、复位键（孔式）',
  });
  assert.deepEqual(rec.specs['connectivity.ports'], ['1 个 10/100/1000 M 自适应速率的以太网接口']);
});

check('华为音频降噪：明确写「不支持主动降噪」必须为 false；没提仍为 null', () => {
  const no = mapHuaweiAudio({
    id: 'test-anc-no',
    name: 'Test Glasses',
    raw: { 音频技术: '通话降噪（不支持主动降噪）' },
    extractedAt: '2026-10-27T00:00:00.000Z',
  });
  assert.equal(no.specs['audio.anc'], false);
  const yes = mapHuaweiAudio({
    id: 'test-anc-yes',
    name: 'Test Buds',
    raw: { 音频技术: '主动降噪/通话降噪' },
    extractedAt: '2026-10-27T00:00:00.000Z',
  });
  assert.equal(yes.specs['audio.anc'], true);
  const silence = mapHuaweiAudio({
    id: 'test-anc-null',
    name: 'Test Buds 2',
    raw: {},
    extractedAt: '2026-10-27T00:00:00.000Z',
  });
  assert.equal(silence.specs['audio.anc'], undefined);
});

check('小米音箱：扬声器→驱动单元、Wi-Fi 频段→WLAN，组合立体声不得折成空间音频', () => {
  // 真实静默故障：音箱版式的官网键是「扬声器 / Wi-Fi 频段」，而映射器只认耳机版的
  // 「发音单元」，于是 9 台音箱全部 0 字段（只有名字）。反向上，「组合立体声」是两台
  // 音箱配左右声道，不是空间音频 —— 不能为了凑字段硬塞进 audio.spatialAudio。
  const rec = mapXiaomiAudio({
    id: 'test-speaker',
    name: 'Xiaomi 智能音箱 Pro',
    raw: {
      红外控制: '支持',
      扬声器: '2.5英寸全频',
      出音方式: '前向出音',
      组合立体声: '支持',
      'Wi-Fi 频段': '2.4G/5GHz',
    },
    extractedAt: '2026-10-27T00:00:00.000Z',
  });
  assert.equal(rec.specs['audio.driverUnit'], '2.5英寸全频');
  assert.equal(rec.connectivity.wifi, '2.4G/5GHz');
  assert.equal(rec.specs['audio.spatialAudio'], undefined, '组合立体声不是空间音频');
  assert.equal(rec.rawOfficial['组合立体声'], '支持', '未落位的官网项必须进 rawOfficial');
});
