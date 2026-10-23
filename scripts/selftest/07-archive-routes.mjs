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
 * 13. 原始响应归档（data/raw/）
 * ----------------------------------------------------------------
 * 归档件存在的唯一理由：解析器改坏之后能喂同一份官网原文离线复现。
 * 所以它的形状纪律与 products.json 不同 —— **不要往里塞运行时刻字段**。
 *
 * 最危险的坑：fetchedAt / extractedAt 一进归档，每轮归档都不同 →
 * CI 每 12 小时一次空提交（本项目已因此踩过两次，见 fingerprint.mjs 的注释）。
 * ================================================================ */
section('原始响应归档');


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
