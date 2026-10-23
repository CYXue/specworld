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
