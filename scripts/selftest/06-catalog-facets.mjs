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
 * 广场三榜 / 品类 / 系列+变体 / 芯片归一 / 全量筛选
 *
 * 这一批锁的是「派生口径」。它们最危险的形态是**静默错**：
 * 页面照常渲染、机型照常列出，只是最贵那台选错了、折叠屏全被判成直板、
 * 或者筛了某芯片后 19 台「人间蒸发」，全程零报错。
 * 每条断言都对着一个具体故障写。
 * ================================================================ */
section('广场三榜 / 品类 / 系列+变体 / 芯片归一 / 全量筛选');


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

// ── 固定 3 槽摘要（specSlotsOf：标签必须随品类规则走）──
// 真实故障（2026-10-17 用户报告）：specSlotsOf 的**值**按品类表取（audio = 蓝牙/重量），
// **标签**却是全局写死的 ['屏幕','电池','快充'] 按列位硬贴 —— HomePod mini 2 的蓝牙值
// 贴「电池」、重量值贴「快充」；Apple TV 4K（media 走兜底表）的 217g 贴「电池」。
// 标签与值语义错位是零报错静默故障，只能靠断言守。
check('槽位标签随品类规则走：audio 的蓝牙/重量不得贴「电池/快充」标签', () => {
  const homepod = pdoc({
    id: 'homepod-mini',
    category: 'audio',
    specs: { 'connectivity.bluetooth': '蓝牙 5.3', 'body.weightG': 335 },
  });
  const slots = SUMMARY.specSlotsOf(homepod, 'zh', 'buy');
  const byValue = new Map(slots.map((s) => [s.value, s.label]));
  assert.equal(byValue.get('蓝牙 5.3'), '蓝牙', '蓝牙值必须贴「蓝牙」标签');
  assert.equal(byValue.get('335g'), '重量', '重量值必须贴「重量」标签');
  assert.notEqual(byValue.get('蓝牙 5.3'), '电池', '蓝牙值不得贴「电池」标签（用户报告的原故障）');
  assert.notEqual(byValue.get('335g'), '快充', '重量值不得贴「快充」标签（用户报告的原故障）');
});

check('槽位标签随品类规则走：media（Apple TV）不得出现「电池」标签挂在重量上', () => {
  const appletv = pdoc({
    id: 'appletv-4k',
    category: 'media',
    specs: { 'chipset.name': 'A15 Bionic', 'body.weightG': 217 },
  });
  const slots = SUMMARY.specSlotsOf(appletv, 'zh', 'buy');
  const byValue = new Map(slots.map((s) => [s.value, s.label]));
  assert.equal(byValue.get('217g'), '重量', '重量值必须贴「重量」标签');
  for (const s of slots) {
    assert.notEqual(s.label, '电池', `media 品类不该有电池槽（实际：${s.label} = ${s.value}）`);
  }
});

check('手机 3 槽语义保持：屏幕/电池/快充，缺值占位不前挤', () => {
  const p = pdoc({
    id: 'phone-slot',
    category: 'phone',
    specs: { 'display.sizeIn': 6.9, 'battery.capacityMah': 5000 },
  });
  const slots = SUMMARY.specSlotsOf(p, 'zh', 'buy');
  assert.deepEqual(
    slots.map((s) => s.label),
    ['屏幕', '电池', '快充'],
    '手机列位语义固定，改顺序会移动整列语义',
  );
  assert.equal(slots[0].value, '6.9″');
  assert.equal(slots[1].value, '5,000mAh');
  assert.equal(slots[2].value, null, '快充无值 → 占位 null，不许把后面的值往前挤');
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
