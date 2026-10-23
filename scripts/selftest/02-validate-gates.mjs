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
    // 取值必须走 pick（2026-10-21 v2-only 后 specs 是唯一真源，直读嵌套永远 undefined）。
    if (!p.includes('.')) {
      assert.ok(p in phone(), `REQUIRED_PATH「${p}」是顶层字段，应确实存在于机型上`);
    } else {
      assert.notEqual(pick(phone(), p), undefined, `REQUIRED_PATH「${p}」指向的字段不存在于机型上`);
    }
  }
});
