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
import { check, section, failures } from './runtime.mjs';

section('缺失三态判定');
{
  const { classifyMissing, isNonePlaceholder } = await import('../lib/missing-state.mjs');
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
  const g = await import('../lib/data-guards.mjs');
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
  const gd = await import('../lib/generation-delta.mjs');
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
    if (gd.deltaBadgeText({ battery: 500 }) !== '+500 mAh') throw new Error('battery 文案');
    if (gd.deltaBadgeText({ weight: -12 }) !== '-12 g') throw new Error('weight 文案');
    if (gd.deltaBadgeText({}) !== null) throw new Error('空差异不渲染');
  });
}

/* ================================================================ *
 * macDB 匹配表健康度（scripts/macdb-sync/match-table.json）
 * 2026-10-20 批次三轮纠错发现的三类错配，此处固化为防线：
 * 悬空引用 / slug 重复 / 品类不一致 / era 限定词冲突 / 年份偏差
 * ================================================================ */
section('macDB 匹配表健康度');
try {
  const mtPath = new URL('../macdb-sync/match-table.json', import.meta.url);
  const mt = JSON.parse(readFileSync(mtPath, 'utf8'));
  const siteNow = JSON.parse(readFileSync(new URL('../../data/products.json', import.meta.url), 'utf8'));
  const siteById = new Map((siteNow.products || siteNow).map(p => [p.id, p]));

  check('悬空引用：每个 productId 都在本站目录中', () => {
    const bad = mt.filter(m => !siteById.has(m.productId));
    if (bad.length) throw new Error(bad.map(m => `${m.slug}→${m.productId}`).slice(0, 5).join(', '));
  });

  check('slug 唯一：同一 macDB 页不得出现两条映射', () => {
    const seen = new Set();
    const dup = [];
    for (const m of mt) {
      if (seen.has(m.slug)) dup.push(m.slug);
      seen.add(m.slug);
    }
    if (dup.length) throw new Error(`重复 slug: ${dup.slice(0, 5).join(', ')}`);
  });

  check('cat 与目标品类一致：条目 cat 必须等于目标产品 category', () => {
    const bad = mt.filter(m => !m.cat || siteById.get(m.productId)?.category !== m.cat);
    if (bad.length) throw new Error(bad.map(m => `${m.slug}(cat=${m.cat})`).slice(0, 5).join(', '));
  });

  check('era 限定词不冲突：年初/年末/年中 不得跨配（merge 标记的变体合并豁免）', () => {
    const era = (s) => {
      if (/年初|early/i.test(s)) return 'early';
      if (/年末|late/i.test(s)) return 'late';
      if (/年中|mid/i.test(s)) return 'mid';
      return null;
    };
    const bad = mt.filter((m) => {
      if (m.merge) return false;
      const a = era(m.name || ''), b = era(m.ourName || '');
      return a && b && a !== b;
    });
    if (bad.length) throw new Error(bad.map(m => `${m.slug}(${era(m.name)})→${m.productId}(${era(m.ourName)})`).slice(0, 5).join(', '));
  });

  check('年份偏差：桌面/笔电/手机/平板类 macDB 页面年份与本站 releaseDate 年份差 ≤1', () => {
    // 配件/外设/媒体类两边的日期本就是占位或停产日，不做强校验（见 macdb-sync/README）
    const STRICT = new Set(['desktop', 'laptop', 'phone', 'tablet']);
    const dated = mt.filter(m => m.pageDate && !m.dateQuirk && !m.merge
      && STRICT.has(m.cat) && siteById.get(m.productId)?.releaseDate);
    const bad = dated.filter((m) => {
      const py = +m.pageDate.slice(0, 4);
      const ry = +siteById.get(m.productId).releaseDate.slice(0, 4);
      return Math.abs(py - ry) > 1;
    });
    if (bad.length) {
      throw new Error(bad.map(m => `${m.slug}(${m.pageDate})→${m.productId}(${siteById.get(m.productId).releaseDate})`).slice(0, 5).join(', '));
    }
    if (dated.length < 150) throw new Error(`pageDate 覆盖异常减少（${dated.length}），检查 match-table 是否被覆盖`);
  });

  check('跨机型类别：slug 机型类别与目标品类一致（merge 豁免）', () => {
    const catOf = (slug) => {
      if (/display$|monitor|portrait-display|monochrome|-rgb$|inch-color$/.test(slug)) return 'display';
      if (/drive$|floppy|hard-disk|raid|hi-fi$/.test(slug)) return 'storage|audio';
      if (/earphones|headset/.test(slug)) return 'audio';
      if (/^ipad(?!-keyboard)/.test(slug)) return 'tablet';
      if (/^ipod-touch/.test(slug)) return 'phone|media';
      if (/^ipod/.test(slug)) return 'media|audio';
      if (/^iphone(?!-bluetooth|-stereo)/.test(slug)) return 'phone';
      if (/^airpods|^earpods|headphone/.test(slug)) return 'audio';
      if (/keyboard|mouse|trackpad|keypad|tablet$|pencil|remote|adapter|dock|folio/.test(slug)) return 'input|accessory';
      if (/watch/.test(slug)) return 'wearable';
      if (/^xserve/.test(slug)) return 'desktop|laptop|network|storage';
      if (/^imac|^mac-|^macintosh|^power-|^powerbook|^ibook|^emac|^workgroup|^lisa|^apple-i/.test(slug)) return 'desktop|laptop';
      return null;
    };
    const bad = mt.filter((m) => {
      if (m.merge) return false;
      const expect = catOf(m.slug);
      return expect && !expect.split('|').includes(m.cat);
    });
    if (bad.length) throw new Error(bad.map(m => `${m.slug}(expect=${catOf(m.slug)}, cat=${m.cat})`).slice(0, 5).join(', '));
  });

  check('映射规模守恒：条目数在合理区间（防误清空）', () => {
    if (mt.length < 800 || mt.length > 950) throw new Error(`条目数 ${mt.length} 超出 [800,950]`);
  });
} catch (e) {
  failures.push({ group: 'macDB 匹配表健康度', name: '装载失败', message: e.message });
}

section('派生层：CPU 核心数（deriveCpuCores）');
{
  const D = await import('../lib/derive.mjs');
  const cases = [
    ['Performance Core × 2+Efficiency Core × 4+GPU × 4', 6], // GPU 段不计
    ['Core × 2+GPU × 6', 2],
    ['Core × 1+GPU × 1', 1],
    ['Performance Core × 4+Efficiency Core × 4+GPU × 7', 8],
    ['6 核 CPU + 4 核 GPU', 6],
    ['  ', null],
    ['', null],
    [null, null],
  ];
  for (const [input, want] of cases) {
    check(`deriveCpuCores(${JSON.stringify(input)}) = ${want}`, () => {
      assert.equal(D.deriveCpuCores(input), want);
    });
  }
  check('反向测：GPU 段绝不能计入 CPU 核心数', () => {
    // 若实现错把 GPU 计入，性能核+能效核+GPU 会得出 10 而非 6 —— 故注入反例
    assert.notEqual(D.deriveCpuCores('Performance Core × 2+Efficiency Core × 4+GPU × 4'), 10);
  });
}

section('macdb-sync fill-core：串号防线与单位自愈（fixture）');
{
  const FC = await import('../macdb-sync/fill-core.mjs');
  const mk = (id, releaseDate, specs) => ({
    op: 'add-product',
    product: { id, brand: 'apple', line: 'L', releaseDate, specs, provenance: {} },
  });

  check('identifier 串号：owner = 最早发布，其余清空', () => {
    const entries = [
      mk('b', '2009-09', { 'device.identifier': 'iMac,1' }),
      mk('a', '2006-01', { 'device.identifier': 'iMac,1' }),
      mk('c', '2010-01', {}),
    ];
    const removed = FC.dedupeIdentifierSerial(entries);
    assert.equal(removed, 1);
    assert.equal(entries[0].product.specs['device.identifier'], undefined); // b（晚）被清空
    assert.equal(entries[1].product.specs['device.identifier'], 'iMac,1'); // a（早）保留
  });

  check('identifier 无冲突时零改动', () => {
    const entries = [mk('a', '2006-01', { 'device.identifier': 'iMac,1' }), mk('c', '2010-01', {})];
    assert.equal(FC.dedupeIdentifierSerial(entries), 0);
    assert.equal(entries[0].product.specs['device.identifier'], 'iMac,1');
  });

  check('modelCode 串号：冲突码从非 owner 移除，无冲突码保留', () => {
    const entries = [
      mk('late', '2012-06', { 'device.modelCodes': ['A1255', 'A9999'] }),
      mk('early', '2007-04', { 'device.modelCodes': ['A1255'] }),
    ];
    const removed = FC.dedupeModelCodeSerial(entries);
    assert.equal(removed, 1);
    // late 与 early 都持有 A1255 → late 里 A1255 被移除，A9999 保留；early（owner）不动
    assert.deepEqual(entries[0].product.specs['device.modelCodes'], ['A9999']);
    assert.deepEqual(entries[1].product.specs['device.modelCodes'], ['A1255']);
  });

  check('modelCode 去重健壮性：前一组删空后另一组不再炸（历史回归）', () => {
    const entries = [
      mk('late', '2012-06', { 'device.modelCodes': ['A1009'] }),
      mk('mid', '2008-02', { 'device.modelCodes': ['A1009'] }),
      mk('early', '2004-01', { 'device.modelCodes': ['A1009'] }),
    ];
    // 三台同码：owner=early，mid/late 依次移除；mid 删空后 late 必须不炸
    assert.doesNotThrow(() => FC.dedupeModelCodeSerial(entries));
    assert.deepEqual(entries[2].product.specs['device.modelCodes'], ['A1009']); // early（owner）不动
    assert.equal(entries[1].product.specs['device.modelCodes'], undefined); // mid 删空后整字段删除
    assert.equal(entries[0].product.specs['device.modelCodes'], undefined); // late 同样删空
  });

  check('rangeHeal：range 内原样、越界 ×10 落入则自愈、否则 null', () => {
    assert.equal(FC.rangeHeal(100, 40, 1500), 100);
    assert.equal(FC.rangeHeal(30.5, 80, 650), 305); // macDB 老机型 cm 误标 mm
    assert.equal(FC.rangeHeal(1, 80, 650), null); // ×10 仍越界 → 拒
    assert.equal(FC.rangeHeal(99999, 40, 1500), null);
  });
}

section('商城 listing 名清洗（cleanListingName）');
{
  const N = await import('../lib/names.mjs');
  check('配置+配色后缀剥离（每型号一条口径）', () => {
    if (N.cleanListingName('REDMI Note 17 Pro 焕新版 8GB+256GB 流沙橙') !== 'REDMI Note 17 Pro 焕新版')
      throw new Error('配置与配色应剥离');
    if (N.cleanListingName('Xiaomi 18 Fold 16GB+1TB 暖金白') !== 'Xiaomi 18 Fold')
      throw new Error('TB 配置同样剥离');
    if (N.cleanListingName('REDMI Pad 2 6GB+128GB 灰色') !== 'REDMI Pad 2')
      throw new Error('低端位配置同样剥离');
  });
  check('尾部纯配色后缀剥离（配色在 body.colors 合并）', () => {
    if (N.cleanListingName('REDMI手环 4 锖色') !== 'REDMI手环 4') throw new Error('锖色应剥离');
    if (N.cleanListingName('小米手环11 银色') !== '小米手环11') throw new Error('银色应剥离');
    if (N.cleanListingName('米家冰箱Pro 微冰鲜双系统 十字平嵌560L 冰晶白') !== '米家冰箱Pro 微冰鲜双系统 十字平嵌560L')
      throw new Error('冰晶白应剥离');
    if (N.cleanListingName('REDMI K100 Max 12GB+256GB 暗影黑') !== 'REDMI K100 Max')
      throw new Error('配置+配色后缀同样剥离');
  });
  check('连字配色剥色留版本词/复合 token 不误剥/版本词保留', () => {
    if (N.cleanListingName('REDMI Buds 6 活力版-白色') !== 'REDMI Buds 6 活力版')
      throw new Error('连字配色应剥、版本词保留');
    if (N.cleanListingName('Xiaomi Watch S5 46mm 黑色氟胶表带款') !== 'Xiaomi Watch S5 46mm 黑色氟胶表带款')
      throw new Error('表带款复合 token 是变体区分信息，保留');
    if (N.cleanListingName('白色（1主3子）套装') !== '白色（1主3子）套装')
      throw new Error('套装组合 token 保留');
    if (N.cleanListingName('小米手环10 标准版') !== '小米手环10 标准版') throw new Error('版本词保留');
  });
  check('粘连与斜杠形态的尾部配色剥离', () => {
    if (N.cleanListingName('米家洗衣机 洗烘12kg灰色') !== '米家洗衣机 洗烘12kg')
      throw new Error('kg 后粘连配色应剥离');
    if (N.cleanListingName('Xiaomi Book Pro 14 Ultra5-325/24G/1T/雅灰') !== 'Xiaomi Book Pro 14 Ultra5-325/24G/1T')
      throw new Error('斜杠后配色应剥离');
  });
  check('无配置后缀/非字符串原样通过', () => {
    if (N.cleanListingName('小米 MIX FOLD') !== '小米 MIX FOLD') throw new Error('无后缀应原样');
    if (N.cleanListingName('小米电视S Pro 65 Mini LED 2026') !== '小米电视S Pro 65 Mini LED 2026')
      throw new Error('尺寸词不误剥');
    if (N.cleanListingName(null) !== null) throw new Error('非字符串透传');
  });
}
