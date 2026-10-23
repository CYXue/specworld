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
  pick, setSpec, SPEC_GROUPS,
  mapAppleSpecs, mapAppleCompare, mapHuawei,
  stripInvisible, normalizeKey, firstNumber,
  allNumbers, parseMm, parseG,
  parseInch, parsePpi, parseWatt,
  parseNits, parseHz, parseCapacity,
  parseStorageList, parseResolution, parseRefresh,
  parseWeight, parseBrightness, sliceByVariants,
  slugify, parseOis, validate,
  LIMITS, REQUIRED_PATHS, FIELD_LIMITS,
  SCHEMA_RANGE_PATHS, ROOT, phone,
  fleet, refreshHzNumber, v2,
  v2Fleet, BRAND_FIXTURE_DIR, assertGolden,
  P2025, sdoc, DOCS,
  names, CJK_DOCS, cjkIds,
  REAL, REAL_P, REAL_LABELS,
  DIMS, pdoc, RAW_ARCHIVE_DIR,
  SRC_DIR, allVueSource, makeProduct,
} from './context.mjs';
import { check, section } from './runtime.mjs';





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
    id: 'x',
    brand: 'apple',
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
  for (const g of [
    'body',
    'display',
    'chipset',
    'memory',
    'battery',
    'camera',
    'connectivity',
    'os',
  ]) {
    assert.deepEqual(back[g], v1[g], `组 ${g} 往返后不一致`);
  }
});

check('pick 只读 specs：specs 是唯一真源，v1 嵌套残留一律读不到（双真源已拆除）', () => {
  // 2026-10-21 迁移完成：盘上快照已是 v2-only，v1 嵌套回退分支拆除。
  // 「specs 优先」的语义仍在——显式 specs 值就是唯一读取路径，没有第二真源可回退。
  const p = { id: 'a', specs: { 'display.sizeIn': 6.9 } };
  assert.equal(pick(p, 'display.sizeIn'), 6.9);
  assert.equal(pick(p, 'display.ppi'), undefined, 'specs 没有就是 undefined（不是 0）');
  // 反向测：哪怕对象上还挂着 v1 嵌套组，pick 也不得读它——
  // 否则「用户改了 specs、嵌套里还是官网旧值」的双真源 bug 会从这条缝里回来。
  const stale = { id: 'b', specs: { 'display.sizeIn': 6.9 }, display: { sizeIn: 6.1 } };
  assert.equal(pick(stale, 'display.sizeIn'), 6.9, '嵌套旧值不得被读到');
  const v1only = { id: 'c', display: { sizeIn: 6.1 } };
  assert.equal(pick(v1only, 'display.sizeIn'), undefined, 'v1 嵌套形状不再是合法数据源');
  const fresh = { id: 'd', specs: {} };
  setSpec(fresh, 'body.weightG', 199);
  assert.equal(pick(fresh, 'body.weightG'), 199);
});

check('盘上快照不得残留 v1 嵌套组（specs 是唯一真源，双真源回归闸门）', () => {
  // 拍平后必须删掉旧嵌套组——双真源比没有 specs 更危险：用户改了 specs、
  // 嵌套里还是官网旧值，任何直接读嵌套的下游都拿到旧值且零报错。
  // 本条守住「盘上数据 v2-only」这个不变量，防止将来某次改管线把它改回去。
  if (!existsSync(join(ROOT, 'data/products.json'))) return;
  const snap = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
  const bad = (snap.products ?? []).filter((p) => SPEC_GROUPS.some((g) => g in p));
  assert.deepEqual(
    bad.map((p) => p.id),
    [],
    '快照里出现了 v1 嵌套组——拍平后必须删除，双真源回归',
  );
  // 反向测：检测器必须能识破注入（P24：注入无效 ≠ 闸门有效）
  assert.ok(
    SPEC_GROUPS.some((g) => g in { id: 'x', body: { weightG: 1 } }),
    '嵌套组检测判据失效（body 注入未被识破）',
  );
});

check('真实快照的 specs 键全部在**其品类** schema 注册（防手改数据绕过管线）', () => {
  // 管线有闸门拦未注册键，但直接手改 products.json 不过管线。这条断言让
  // 「schema 漏登记」与「数据里多出幽灵键」两种漂移都在自测层现形。
  // 2026-10-15 六品类：按产品品类查各自 schema（battery.capacityWh 只在 tablet 注册）。
  if (!existsSync(join(ROOT, 'data/products.json'))) return;
  const snap = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
  for (const p of snap.products ?? []) {
    const schema = loadSchema(p.category ?? 'phone');
    assert.ok(schema, `${p.id} 的品类 ${p.category} 必须有 schema`);
    const fields = fieldMap(schema);
    for (const path of Object.keys(p.specs ?? {})) {
      assert.ok(
        fields.has(path),
        `${p.id} 的 specs 键 "${path}" 未在 ${p.category ?? 'phone'} schema 注册`,
      );
    }
  }
  // 反向：schema 声明的每个字段至少要在一台真实机器上出现过（死字段 = 契约腐烂）
  // 例外：rawOfficial 原文里没有、契约预留的字段允许零覆盖（如 measuredHours）。
  // 2026-10-13 新增 haptic.motor / audio.speakers（用户要求马达/扬声器进比较）：
  // 官网原文待解析器接入或人工补录（用户纠错链路），落数据前允许零覆盖。
  const PREVIEW_ONLY = new Set([
    'battery.measuredHours',
    'display.protection',
    'haptic.motor',
    'audio.speakers',
    // 2026-10-23 监管身份字段（进网许可/CMIIT ID/SAR）：官网规格页通常不列
    // （铭牌/系统关于页/工信部查询库才有），解析器接入前允许零覆盖。
    'device.ctaNo',
    'device.srrcId',
    'device.sarHeadWkg',
    'device.sarBodyWkg',
  ]);
  const seen = new Set();
  for (const p of snap.products ?? []) for (const k of Object.keys(p.specs ?? {})) seen.add(k);
  // 反向（死字段检测）仍按 phone schema：phone 是最完整、历史最长的字段表
  const phoneSchema = loadSchema('phone');
  assert.ok(phoneSchema, 'phone schema 必须可加载');
  for (const f of phoneSchema.fields) {
    if (PREVIEW_ONLY.has(f.path)) continue;
    assert.ok(seen.has(f.path), `schema 字段 ${f.path} 在真实数据里零出现（死字段或拼错）`);
  }
});


/* 渲染对账闸门（2026-10-13 首建，同日升级为视图字典版）：specGroups 已重构为
 * 「全声明式视图字典 + 泛化引擎」（data/views/phone.json），新字段默认自动出现。
 * 本闸门升级为**双向对账**，豁免从硬编码 EXEMPT 变成视图字典的 hidden 数据：
 * ① 正向：每个 schema 字段要么被视图引用、要么在 view.hidden（哨兵值实测、走与前端同一条链）；
 * ② 反向：视图字典引用的每个 path 必须已在 schema 注册（视图也是数据，拼错也要被拦）。 */
check('渲染对账（视图字典版）：schema↔视图双向对账（防页面静默丢字段/防视图拼错）', () => {
  const schema = loadSchema('phone');
  const fields = [...fieldMap(schema).values()];
  const view = JSON.parse(readFileSync(join(ROOT, 'data', 'views/phone.json'), 'utf8'));
  const referenced = new Set();
  for (const g of view.groups) {
    for (const r of g.rows) {
      for (const p of r.fields ?? []) referenced.add(p);
      if (r.field) referenced.add(r.field);
      if (r.expand) referenced.add(r.expand);
    }
  }
  const hidden = new Set(view.hidden ?? []);
  const byPath = new Map(schema.fields.map((f) => [f.path, f]));
  /*
   * 视图字典给某些行配了**专用格式化器**（resolution / bands / dimensions…），
   * 通用 object 哨兵 `{w,h}` 对它们不生效 —— bands 只认制式分组键，喂 `{w:1,h:2}`
   * 会渲染成「—」，闸门于是误报「字段没上页面」，而下意识的处理又是「塞进 hidden」。
   * 所以哨兵要按该行声明的 format 定制：格式化器认什么键，就往什么键里塞哨兵。
   */
  const fmtByPath = new Map();
  for (const g of view.groups) {
    for (const r of g.rows) {
      if (!r.format) continue;
      for (const p of r.fields ?? (r.field ? [r.field] : [])) fmtByPath.set(p, r.format);
    }
  }

  // ② 反向：视图引用必须已注册
  for (const p of referenced) {
    assert.ok(
      byPath.has(p),
      `视图字典 data/views/phone.json 引用了未注册字段 "${p}"——要么拼错了，要么先在 schema 注册`,
    );
  }

  // ① 正向：哨兵实测。每字段塞**全局唯一**哨兵值（number 走 i*10 步进，object 的 h 用 +1
  // 避让下一个字段），在引擎渲染输出文本里找哨兵——比按 label 找可靠（合并行）。
  const specs = {};
  const token = new Map();
  fields.forEach((f, i) => {
    const n = 100000 + i * 10;
    let v;
    let t;
    if (f.type === 'number') {
      v = n;
      t = String(n);
    } else if (f.type === 'array:number') {
      v = [n];
      t = String(n);
    } else if (f.type === 'string') {
      v = `ZQ${i}ZQ`;
      t = v;
    } else if (f.type === 'array:string') {
      v = [`ZQ${i}ZQ`];
      t = `ZQ${i}ZQ`;
    } else if (f.type === 'object') {
      v =
        fmtByPath.get(f.path) === 'bands'
          ? { nrFdd: [`n${n}`], nrTdd: [], lteFdd: [], lteTdd: [], umts: [], gsm: [] }
          : { w: n, h: n + 1 };
      t = String(n);
    } else if (f.type === 'array:object') {
      v = [{ role: 'main', mp: n, aperture: 'f/1.6', ois: true }];
      t = String(n);
    } else {
      // boolean 哨兵 'true' 无唯一性——当前 schema 的 boolean 字段全部在 view.hidden；
      // 新增非 hidden 的 boolean 字段时必须让它渲染成可唯一识别，否则闸门对它失明。
      v = true;
      t = 'true';
    }
    specs[f.path] = v;
    token.set(f.path, t);
  });
  const rendered = FIELDS_LIB.specGroups({ id: 'selftest-render-gate', category: 'phone', specs })
    .map((g) => g.rows.map((r) => r.value).join('\n'))
    .join('\n');
  const boolFields = [];
  for (const f of fields) {
    if (hidden.has(f.path)) continue;
    // boolean 走下面的专用判据（哨兵 'true' 对它不成立）
    if (f.type === 'boolean') {
      boolFields.push(f);
      continue;
    }
    assert.ok(
      rendered.includes(token.get(f.path)),
      `schema 字段 ${f.path}（${f.label}）既未被视图字典引用、也未列入 view.hidden` +
        `——详情页/对比台会静默不显示；请在 data/views/phone.json 加行（或加入 hidden 豁免）`,
    );
  }

  /*
   * ② boolean 专用判据（2026-10-14 补，原闸门对它失明）。
   * boolean 的哨兵 true 被渲染成「有」而不是字面 'true'，`rendered.includes('true')`
   * **恒为 false** —— 只要出现一个非 hidden 的 boolean 字段（本次新增的 irBlaster 就是），
   * 闸门立刻误报，而误报的下一步通常是「把它塞进 hidden 了事」，
   * 于是这个字段真的永远不上页面，闸门还显示绿灯。
   * 改成：只给这一个字段置 true（其余字段全部缺省），渲染结果里必须**有行不是「—」**。
   * 唯一性来自「全场只有一个字段有值」，与「有/无」的本地化文案无关。
   *
   * ⚠️ 诚实的边界：本条**抓不到**「视图字典没引用该字段」—— 自动补挂会把未引用的字段
   * 照样渲染出来（实测：摘掉 views/phone.json 里 irBlaster 那行，本条仍全绿）。
   * 它真正守的是「boolean 必须渲染成非「—」」这件事，即 defaultFormat 的 boolean 分支
   * 没被改坏：把那个分支改成恒返回「—」，本条立刻报红（反向测做过）。
   */
  for (const f of boolFields) {
    const rows = FIELDS_LIB.specGroups({
      id: 'selftest-render-gate',
      category: 'phone',
      specs: { [f.path]: true },
    }).flatMap((g) => g.rows.map((r) => r.value));
    const shown = rows.filter((v) => v && v !== '—');
    assert.ok(
      shown.length >= 1,
      `schema 字段 ${f.path}（${f.label}）置 true 后页面没有任何一行显示它` +
        `——请在 data/views/phone.json 加行（或加入 hidden 豁免）`,
    );
  }
});

/* ── 硬编码审计 A1 治理（2026-10-13）：榜单/能力字段表与 schema 对账 ──
 * 此前「能力/榜单字段」存在三份定义：schema(dir/quantifiable 权威)、derive.mjs METRICS(后端
 * 榜单)、specs.ts ABILITIES(前端能力条)，改 schema 时后两份静默漂移且无闸门。以下两条把
 * 同步要求变成机器闸门：path 必须已注册；schema.dir 非空时方向语义必须一致。 */

check('derive.mjs METRICS 与 phone schema 对账（path 已注册、dir 语义一致）', () => {
  const schema = loadSchema('phone');
  const byPath = new Map(schema.fields.map((f) => [f.path, f]));
  for (const [key, m] of Object.entries(DERIVE.METRICS)) {
    // 身份/SKU 派生指标不走 specs 字段表（skus/releaseDate 是顶层结构）
    if (m.path === 'skus' || m.path === 'releaseDate') continue;
    const f = byPath.get(m.path);
    assert.ok(
      f,
      `METRICS.${key} 的 path "${m.path}" 未在 schema 注册——榜单会静默使用旧字段（审计 A1）`,
    );
    if (f && f.dir != null) {
      assert.equal(
        m.dir,
        f.dir,
        `METRICS.${key}.dir(${m.dir}) 与 schema.dir(${f.dir}) 不一致——方向真源是 schema`,
      );
    }
    // schema.dir 为 null 的数组派生指标（如 storageMaxGb 取 max(storageGb)）允许指标层
    // 显式自declared 方向——豁免理由：数组字段本身不可排序，派生值才有方向。
  }
});

check('specs.ts ABILITIES 与 phone schema 对账（字段已注册、higherBetter ≡ dir）', () => {
  const schema = loadSchema('phone');
  const byPath = new Map(schema.fields.map((f) => [f.path, f]));
  // 能力条消费的字段映射——specs.ts rawFor 改字段时必须同步此表（显性化，测试即文档）
  const ABILITY_PATHS = {
    display: 'display.ppi',
    light: 'body.weightG',
    battery: 'battery.capacityMah',
    camera: 'camera.rear',
  };
  for (const a of SPECS_LIB.ABILITIES) {
    const path = ABILITY_PATHS[a.key];
    assert.ok(path, `ABILITIES 出现未知能力 key：${a.key}（需在 selftest 对账表登记）`);
    const f = byPath.get(path);
    assert.ok(f, `ABILITIES.${a.key} 的字段 ${path} 未在 schema 注册（审计 A1）`);
    if (f && f.dir != null) {
      assert.equal(
        a.higherBetter,
        f.dir === 'high',
        `ABILITIES.${a.key}.higherBetter(${a.higherBetter}) 与 schema.dir(${f.dir}) 不一致——方向真源是 schema`,
      );
    }
    // camera.rear 是数组（dir=null，主摄 MP 派生），与 METRICS.storageMaxGb 同一豁免逻辑
  }
});

check('后台录入页在 admin/ 而非 public/（Q1：不随 dist 发布到线上）', () => {
  // 2026-10-13 审计 Q1 裁决 B：overrides-editor.html 从 public/ 移至 admin/，
  // 由 editor-server 直读。public/ 会被 vite 原样拷进 dist —— 放回去等于把管理后台
  // 界面发布到 GitHub Pages / Toy 上（无后端写不进去，但界面与字段结构暴露）。
  // 本条守「源」：有人挪回 public/ 时在最快的一道闸门红掉；
  // verify-dist 的「dist 非入口 HTML」闸门守「产物」，两道互补。
  assert.ok(
    existsSync(join(ROOT, 'admin/overrides-editor.html')),
    'admin/overrides-editor.html 应存在（editor-server 从那里读）',
  );
  assert.ok(
    !existsSync(join(ROOT, 'public/overrides-editor.html')),
    'public/ 下不得有 overrides-editor.html——会被 vite 拷进 dist 发布到线上',
  );
});

check('editor.html 值校验类型集与 schema 弱对账（零构建拷贝的看守）', () => {
  // 硬编码审计 A3：editor.html 无法 import 共享校验模块（零构建），保留手工拷贝。
  // 本测试看守「类型集」不漂移：schema 出现新 type 而拷贝没跟 → default 分支静默放行 → 红。
  const html = readFileSync(join(ROOT, 'admin/overrides-editor.html'), 'utf8');
  const cases = new Set([...html.matchAll(/case '([a-z:]+)':/g)].map((m) => m[1]));
  const schema = loadSchema('phone');
  for (const f of schema.fields) {
    assert.ok(
      cases.has(f.type),
      `schema 类型 "${f.type}"（${f.path}）在 overrides-editor.html 的 validateValue 里没有 case 分支` +
        `——类型系统演进后该页会对它静默走 default，请同步手工拷贝`,
    );
  }
});

/* ── 硬编码审计 P2 治理（2026-10-13）：策展表外置对账 ──
 * 变体/系列/多芯/价格档已从 catalog.ts 搬进 data/curated/facets.json（数据化策展）。
 * 数据也要被闸门管：结构合法性 + 哨兵语义（「Pro Max 在 Pro 前」的长后缀优先即反向测）+
 * 真实数据冒烟。加变体/调价格档/接新品牌 = 改 JSON，闸门在此确保改不坏。 */

check('策展字典结构合法（id 唯一/正则可编译/长后缀优先/价格档升序衔接）', () => {
  const dict = JSON.parse(readFileSync(join(ROOT, 'data', 'curated', 'facets.json'), 'utf8'));
  const vIds = new Set();
  const vLabels = new Set();
  for (const v of dict.variants) {
    assert.ok(!vIds.has(v.id), `变体 id 重复：${v.id}`);
    assert.ok(!vLabels.has(v.label), `变体 label 重复：${v.label}`);
    vIds.add(v.id);
    vLabels.add(v.label);
    assert.doesNotThrow(
      () => new RegExp(v.match, v.flags ?? ''),
      `变体 ${v.id} 的 match 不是合法正则`,
    );
  }
  const idxPro = dict.variants.findIndex((v) => v.id === 'pro');
  const idxProMax = dict.variants.findIndex((v) => v.id === 'pro-max');
  assert.ok(
    idxPro >= 0 && idxProMax >= 0 && idxProMax < idxPro,
    'Pro Max 必须排在 Pro 之前（长后缀优先，否则分面计数少一台）',
  );
  for (const [brand, cfg] of Object.entries(dict.series.brands ?? {})) {
    assert.ok(cfg.series.length >= 1, `${brand} 系列表不能为空`);
    assert.ok(
      cfg.series.some((s) => s.fallback),
      `${brand} 系列表必须有 fallback 行（兜底「标准」）`,
    );
    for (const s of cfg.series) {
      if (s.fallback) continue;
      assert.doesNotThrow(
        () => new RegExp(s.match ?? '', s.flags ?? ''),
        `${brand} 系列规则「${s.label}」正则非法`,
      );
    }
  }
  const bIds = new Set();
  dict.priceBuckets.forEach((b, i) => {
    assert.ok(!bIds.has(b.id), `价格档 id 重复：${b.id}`);
    bIds.add(b.id);
    assert.ok(typeof b.min === 'number' && b.min >= 0, `价格档 ${b.id} 的 min 非法`);
    const last = i === dict.priceBuckets.length - 1;
    if (last) assert.ok(b.max === null, `最后一条价格档 ${b.id} 的 max 应为 null（无穷）`);
    else {
      assert.ok(typeof b.max === 'number' && b.max >= b.min, `价格档 ${b.id} 的 max 非法`);
      if (i > 0) {
        assert.ok(
          b.min === dict.priceBuckets[i - 1].max + 1,
          `价格档 ${b.id} 与上一档不衔接（会有价格静默落错档）`,
        );
      }
    }
  });
});

check('策展字典哨兵语义（变体长后缀优先/系列策略/多芯判据/价格档）', () => {
  const fake = (brand, name) => ({
    id: 't',
    brand,
    name,
    line: brand === 'apple' ? 'iPhone' : name.split(' ')[0],
    category: 'phone',
  });
  // 变体：长后缀优先——顺序被人调换时这些断言全红（反向测）
  assert.equal(CAT.variantOf(fake('apple', 'iPhone 18 Pro Max')), 'Pro Max');
  assert.equal(CAT.variantOf(fake('apple', 'iPhone 18 Pro')), 'Pro');
  assert.equal(CAT.variantOf(fake('apple', 'iPhone 18')), '标准');
  assert.equal(CAT.variantOf(fake('apple', 'iPhone 18 Plus')), 'Plus');
  assert.equal(CAT.variantOf(fake('huawei', 'Mate 80 RS')), 'RS');
  assert.equal(CAT.variantOf(fake('huawei', 'nova 14 Ultra')), 'Ultra');
  assert.equal(CAT.variantOf(fake('huawei', 'nova 14 优享版')), '优享版');
  assert.equal(CAT.variantOf(fake('huawei', '畅享 70 风驰版')), '风驰版');
  // 苹果系列（from:'name' 策略）
  assert.equal(CAT.seriesOf(fake('apple', 'iPhone Duo')), '折叠屏');
  assert.equal(CAT.seriesOf(fake('apple', 'iPhone Air')), 'Air');
  assert.equal(CAT.seriesOf(fake('apple', 'iPhone 17e')), 'SE');
  assert.equal(CAT.seriesOf(fake('apple', 'iPhone 18 Pro Max')), '标准'); // Pro Max 是变体不是系列
  assert.equal(CAT.seriesOf(fake('huawei', 'nova 14')), 'nova'); // 未配置品牌走 default:'line'
  // foldVariant：形态即变体
  assert.equal(CAT.variantOf(fake('apple', 'iPhone Duo')), '折叠双屏');
  // 多芯判据（前缀出现两次）
  assert.equal(CAT.isMultiChip('麒麟9020A麒麟9020B'), true);
  assert.equal(CAT.isMultiChip('麒麟9030Pro'), false);
  assert.equal(CAT.isMultiChip('A18A19'), true);
  assert.equal(CAT.isMultiChip('A18Pro'), false);
  assert.equal(CAT.isMultiChip('天玑9400天玑9300'), true);
  assert.equal(CAT.isMultiChip('A18'), false);
  // 价格档
  const withPrice = (v) => ({ skus: [{ priceCny: v }] });
  assert.equal(CAT.priceBucket(withPrice(599)), '0-1999');
  assert.equal(CAT.priceBucket(withPrice(1999)), '0-1999');
  assert.equal(CAT.priceBucket(withPrice(2000)), '2000-2999');
  assert.equal(CAT.priceBucket(withPrice(15000)), '8000+');
  assert.equal(CAT.priceBucket({ skus: [] }), CAT.UNKNOWN); // 缺价不编造
});

check('策展字典真实数据冒烟（62 台变体/系列解析 + 已知机型抽查）', () => {
  if (!Array.isArray(REAL_P) || !REAL_P.length) return;
  for (const p of REAL_P) {
    const v = CAT.variantOf(p);
    const s = CAT.seriesOf(p);
    assert.ok(v && s, `${p.id} 变体/系列解析为空`);
  }
  const proMax = REAL_P.find((p) => p.id === 'apple-iphone-17-pro-max');
  if (proMax) assert.equal(CAT.variantOf(proMax), 'Pro Max');
  const pro = REAL_P.find((p) => p.id === 'huawei-mate70-pro');
  if (pro) assert.equal(CAT.variantOf(pro), 'Pro');
});

check('多实例子字典深校验（camera.rear：mp 越界/role 拼错/多余键 → 拦）', () => {
  // 最优解「两处结构升级」②：array:object 不再是无底洞——每项按子字典逐键校验。
  const schema = loadSchema('phone');
  const rear = (items) => ({ id: 't', specs: { 'camera.rear': items } });
  // 正测：现有形态全合法（ois/sensorNote 等缺失 = null 语义）
  assert.deepEqual(
    validateSpecs(
      rear([{ role: 'main', mp: 48, aperture: 'f/1.6', ois: true, sensorNote: null }]),
      schema,
    ),
    [],
  );
  assert.deepEqual(validateSpecs(rear([{ role: 'main' }]), schema), []);
  // 反测 ×3：数值越界 / 枚举拼错 / 多余键
  const over = validateSpecs(rear([{ role: 'main', mp: 999 }]), schema);
  assert.ok(
    over.some((f) => f.includes('超出合理区间')),
    `mp=999 应被子字典区间拦：${over.join('|')}`,
  );
  const badRole = validateSpecs(rear([{ role: 'foo', mp: 48 }]), schema);
  assert.ok(
    badRole.some((f) => f.includes('不在枚举')),
    `role=foo 应被枚举拦：${badRole.join('|')}`,
  );
  const extra = validateSpecs(rear([{ role: 'main', mp: 48, zoom: '10x' }]), schema);
  assert.ok(
    extra.some((f) => f.includes('子字典注册')),
    `多余键 zoom 应被拦（静默落盘没人读）：${extra.join('|')}`,
  );
  // schema 自身结构：phone.json 的 subfields 声明必须过 validateSchema
  assert.deepEqual(validateSchema(schema), [], 'phone schema（含子字典声明）结构应合法');
});

check('参数级筛选（schema facet → 分面/相等类取值/URL 往返/非法值丢弃）', () => {
  // 最优解相等类泛化：schema facet:true 的字段自动成为筛选维度（键=字段路径）
  const mk = (id, specs) => ({
    id,
    category: 'phone',
    brand: 'apple',
    name: id,
    line: 'iPhone',
    releaseDate: '2026-01-01',
    skus: [],
    specs,
  });
  const products = [
    mk('a', {
      'connectivity.nfc': true,
      'display.refreshHz': '120',
      'haptic.motor': 'X 轴线性马达',
    }),
    mk('b', { 'connectivity.nfc': false, 'display.refreshHz': '60/90' }),
    mk('c', {}), // 全缺 → 未公布（UNKNOWN）
  ];
  // 分面：boolean 三值 + 是/否标签
  const nfc = FACETS_LIB.facetOf(products, 'connectivity.nfc', products);
  assert.deepEqual(nfc.map((f) => f.id).sort(), ['false', 'true', '未公布'].sort());
  assert.equal(nfc.find((f) => f.id === 'true')?.label, '是');
  assert.equal(nfc.find((f) => f.id === 'false')?.label, '否');
  // 相等类筛选生效
  const filter = { ...FACETS_LIB.emptyFilter(), 'connectivity.nfc': ['true'] };
  assert.deepEqual(
    FACETS_LIB.applyFilter(products, filter).map((p) => p.id),
    ['a'],
  );
  // URL 往返（参数维度键 = 字段路径）
  const q = FACETS_LIB.writeFilter(filter, []);
  assert.equal(q['connectivity.nfc'], 'true');
  const catalog = {
    filter: { ...FACETS_LIB.emptyFilter(), 'connectivity.nfc': ['true', 'false', '未公布'] },
    sorts: [],
  };
  const back = FACETS_LIB.readFilter(new URLSearchParams('connectivity.nfc=true'), catalog);
  assert.deepEqual(back.filter['connectivity.nfc'], ['true']);
  // 反测：非法值丢弃（不产生永远 0 台的死条件）
  const bad = FACETS_LIB.readFilter(new URLSearchParams('connectivity.nfc=maybe'), catalog);
  assert.deepEqual(bad.filter['connectivity.nfc'], []);
  // string 原文分面（刷新率官网原文形态）
  const hz = FACETS_LIB.facetOf(products, 'display.refreshHz', products)
    .map((f) => f.id)
    .sort();
  assert.deepEqual(hz, ['120', '60/90', '未公布'].sort());
});

check('orderDeriver 声明与注册表对账（序类适配器不游离）', () => {
  // 最优解「序类引擎显式声明制」最小闭环：schema 声明名字 → 引擎注册表给实现。
  const schema = loadSchema('phone');
  let declared = 0;
  for (const f of schema.fields) {
    if (!f.orderDeriver) continue;
    declared += 1;
    const impl = FIELDS_LIB.orderDeriverFor(f.path);
    assert.ok(
      impl,
      `${f.path} 声明了 orderDeriver "${f.orderDeriver}" 但 fields.ts 注册表没有该实现（拼错或漏注册）`,
    );
    // 反测：适配器对 null 返回 null（不产生 0 冒充「未公布」——类型漂移铁律）
    assert.equal(impl(null), null, `${f.path} 的序类适配器应把 null 映射为 null`);
    assert.equal(impl(undefined), null);
  }
  assert.ok(
    declared >= 1,
    'phone schema 应至少声明一个 orderDeriver（refreshHz），声明丢失说明被误删',
  );
});

check('对比差异判定纯函数（准绳口径：缺失不参与值比较，缺失/不等分两类）', () => {
  // 完整采用准绳方案（用户 2026-10-13 裁决）。对照准绳判据：
  // 「有值 vs 缺失→标缺失色；双方都缺→不标；相等→不标；不等→标不等色」。
  const S = CMP.compareRowState;
  // 关键 case：缺失混入不污染相等判断——120 / — / 120 是「缺失差异」，不是「值不等」
  assert.deepEqual(S(['120', '—', '120']), { different: false, missing: true });
  assert.deepEqual(S(['120', '—', '200']), { different: true, missing: true });
  assert.deepEqual(S(['120', '120', '120']), { different: false, missing: false });
  assert.deepEqual(S(['120', '200']), { different: true, missing: false });
  assert.deepEqual(S(['—', '—']), { different: false, missing: false }); // 全缺失不标
  assert.deepEqual(S(['X 轴线性马达', '转子马达', '—']), { different: true, missing: true });
  // 上浮入选条件就是内联判断 isDifferent || isMissing（准绳 sortDiffUp 口径）
  assert.equal(S(['120', '120']).different || S(['120', '120']).missing, false);
  assert.equal(S(['120', '—']).different || S(['120', '—']).missing, true);
  assert.equal(S(['120', '200']).different || S(['120', '200']).missing, true);
});

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

check('监管身份字段：进网许可/SRRC/SAR 必须注册且口径正确（工信部申报口径）', () => {
  // 工信部进网许可标志三行之一是许可证编号，SRRC 核准代码是 CMIIT ID，
  // SAR 是进网检测强制项。这三类是铭牌/查询库可取证的官方事实，不是估算。
  const schema = loadSchema('phone');
  const f = (path) => fieldMap(schema).get(path);
  const cta = f('device.ctaNo');
  const srrc = f('device.srrcId');
  const sarHead = f('device.sarHeadWkg');
  const sarBody = f('device.sarBodyWkg');
  assert.ok(cta, 'phone schema 必须注册 device.ctaNo（进网许可证编号）');
  assert.ok(srrc, 'phone schema 必须注册 device.srrcId（CMIIT ID）');
  assert.ok(sarHead, 'phone schema 必须注册 device.sarHeadWkg');
  assert.ok(sarBody, 'phone schema 必须注册 device.sarBodyWkg');
  assert.equal(cta.type, 'string', '进网许可编号是字符串（含横线与数字混合）');
  assert.equal(srrc.type, 'string', 'CMIIT ID 是字符串');
  assert.equal(sarHead.type, 'number');
  assert.equal(sarBody.type, 'number');
  assert.equal(cta.unit, null);
  assert.equal(sarHead.unit, 'W/kg');
  assert.equal(sarBody.unit, 'W/kg');
  assert.equal(sarHead.dir, 'low', 'SAR 越小越好');
  assert.equal(sarBody.dir, 'low');
  // 区间余量：欧盟限值 2.0 / 美国 1.6 W/kg，上限留 10 防极端机型闸门误报
  assert.deepEqual(sarHead.range, [0, 10]);
  assert.deepEqual(sarBody.range, [0, 10]);
  // 两个 SAR 是不同口径，永远分列不合并（典型/峰值亮度同款纪律）
  assert.notEqual(sarHead.path, sarBody.path);
});

check('监管字段值校验：合法值放行，类型漂移/越界必须报出，null 恒合法（未公布）', () => {
  const schema = loadSchema('phone');
  const f = (path) => fieldMap(schema).get(path);
  // 正向
  assert.equal(validateSpecValue(f('device.ctaNo'), '2023-CP12345', 't'), null);
  assert.equal(validateSpecValue(f('device.srrcId'), '26J44XA31643', 't'), null);
  assert.equal(validateSpecValue(f('device.sarHeadWkg'), 0.98, 't'), null);
  assert.equal(validateSpecValue(f('device.sarBodyWkg'), 1.19, 't'), null);
  // null = 官方未公布，恒合法（四态取 unknown，不是 none）
  assert.equal(validateSpecValue(f('device.ctaNo'), null, 't'), null);
  assert.equal(validateSpecValue(f('device.sarHeadWkg'), null, 't'), null);
  // 反向：数字漂成字符串、SAR 越界
  assert.ok(validateSpecValue(f('device.ctaNo'), 20231234, 't'), '编号漂成数字必须报错');
  assert.ok(validateSpecValue(f('device.sarHeadWkg'), '0.98', 't'), 'SAR 漂成字符串必须报错');
  assert.ok(validateSpecValue(f('device.sarHeadWkg'), 15, 't'), 'SAR 超区间必须报错');
  assert.ok(validateSpecValue(f('device.sarBodyWkg'), -0.1, 't'), 'SAR 负值必须报错');
});

check('监管字段矩阵：全品类必须有 CTA/SRRC/产地/环保使用期限（工信部+CCC+RoHS 口径）', () => {
  const reg = loadCategories();
  assert.ok(reg.categories.length >= 10, '品类注册表应至少 10 项');
  for (const c of reg.categories) {
    if (c.id === 'phone') continue; // phone 已有专项断言覆盖（上面两组）
    const schema = loadSchema(c.id);
    const f = (p) => fieldMap(schema).get(p);
    assert.ok(f('device.ctaNo'), `${c.id} 必须注册 device.ctaNo（进网许可证编号）`);
    assert.ok(f('device.srrcId'), `${c.id} 必须注册 device.srrcId（CMIIT ID）`);
    assert.ok(f('device.origin'), `${c.id} 必须注册 device.origin（产地，铭牌强制项）`);
    assert.ok(f('device.envUsePeriod'), `${c.id} 必须注册 device.envUsePeriod（环保使用期限）`);
    assert.equal(f('device.ctaNo').type, 'string', `${c.id} ctaNo 应为 string`);
    assert.equal(f('device.srrcId').type, 'string', `${c.id} srrcId 应为 string`);
    assert.equal(f('device.origin').type, 'string', `${c.id} origin 应为 string`);
    assert.equal(f('device.envUsePeriod').type, 'number', `${c.id} envUsePeriod 应为 number`);
    assert.deepEqual(
      f('device.envUsePeriod').range,
      [0, 30],
      `${c.id} envUsePeriod range 应为 [0,30]（常见 10-20 年，留余量）`,
    );
  }
});

check('监管字段矩阵：蜂窝品类 SAR + 带市电品类电源/防触电 + 能效目录品类', () => {
  // 蜂窝品类：进网检测含 SAR；平板（iPad Cellular）/笔记本/手表都有蜂窝变体
  for (const id of ['tablet', 'laptop', 'wearable']) {
    const f = (p) => fieldMap(loadSchema(id)).get(p);
    assert.ok(f('device.sarHeadWkg'), `${id} 必须注册 device.sarHeadWkg`);
    assert.ok(f('device.sarBodyWkg'), `${id} 必须注册 device.sarBodyWkg`);
    assert.equal(f('device.sarHeadWkg').unit, 'W/kg');
    assert.equal(f('device.sarHeadWkg').dir, 'low');
    assert.deepEqual(f('device.sarHeadWkg').range, [0, 10]);
    assert.deepEqual(f('device.sarBodyWkg').range, [0, 10]);
  }
  // 带市电品类：CCC 铭牌强制项（额定输入电压/功率）+ GB 4943.1 防触电类别
  // range 是闸门区间不是规格区间，按品类余量给宽
  const MAINS = {
    desktop: [1, 3000],
    display: [1, 1000],
    printer: [1, 2000],
    network: [1, 1000],
    home: [1, 500],
    storage: [1, 500],
    accessory: [1, 1000],
  };
  for (const [id, range] of Object.entries(MAINS)) {
    const f = (p) => fieldMap(loadSchema(id)).get(p);
    assert.ok(f('power.inputVoltage'), `${id} 必须注册 power.inputVoltage（额定输入电压）`);
    const pw = f('power.inputPower');
    assert.ok(pw, `${id} 必须注册 power.inputPower（额定输入功率）`);
    assert.equal(pw.unit, 'W');
    assert.deepEqual(pw.range, range, `${id} inputPower range 漂移`);
    const pc = f('power.protectionClass');
    assert.ok(pc, `${id} 必须注册 power.protectionClass（防触电类别）`);
    assert.deepEqual(pc.values, ['I', 'II', 'III'], `${id} 防触电类别枚举漂移`);
  }
  // 能效标识目录内品类：显示器 GB 21520 / 微机 GB 28380 / 打印机 GB 21521 / 机顶盒 GB 24850
  for (const id of ['desktop', 'display', 'printer', 'home']) {
    const f = (p) => fieldMap(loadSchema(id)).get(p);
    assert.ok(f('power.ratingLevel'), `${id} 必须注册 power.ratingLevel（能效等级）`);
    assert.ok(f('power.standbyPowerW'), `${id} 必须注册 power.standbyPowerW（睡眠功率）`);
    assert.ok(f('power.offPowerW'), `${id} 必须注册 power.offPowerW（关机功率）`);
    assert.equal(f('power.standbyPowerW').dir, 'low');
    assert.equal(f('power.offPowerW').dir, 'low');
    assert.deepEqual(f('power.standbyPowerW').range, [0, 50]);
  }
});

check('反向测：非 phone 品类监管字段同样过 validateSpecValue 正反测', () => {
  const schema = loadSchema('display');
  const f = (p) => fieldMap(schema).get(p);
  // 正向
  assert.equal(validateSpecValue(f('device.origin'), '中国上海', 't'), null);
  assert.equal(validateSpecValue(f('device.envUsePeriod'), 20, 't'), null);
  assert.equal(validateSpecValue(f('device.ctaNo'), null, 't'), null, 'null 恒合法（未公布）');
  assert.equal(validateSpecValue(f('power.inputVoltage'), '100-240V~, 50/60Hz', 't'), null);
  assert.equal(validateSpecValue(f('power.inputPower'), 180, 't'), null);
  assert.equal(validateSpecValue(f('power.ratingLevel'), '1级', 't'), null);
  // 反向：类型漂移 / 越界 / 枚举越界
  assert.ok(validateSpecValue(f('device.origin'), 42, 't'), '产地漂成数字必须报错');
  assert.ok(validateSpecValue(f('device.envUsePeriod'), -1, 't'), '负年数必须报错');
  assert.ok(validateSpecValue(f('device.envUsePeriod'), 99, 't'), '超区间必须报错');
  assert.ok(validateSpecValue(f('power.inputPower'), '180', 't'), '功率漂成字符串必须报错');
  assert.ok(validateSpecValue(f('power.protectionClass'), 'IV', 't'), '防触电类别枚举越界必须报错');
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

  // 展示名也要对账，而不只是顺序：**以前这里只比 id 顺序**，
  // 于是 catalog.ts 里那行注释「与 data/categories.json 的 label 同源」是句假话——
  // 把注册表的 label 改错自测依旧全绿。注释比代码更会骗人：人会照着注释相信
  // 「改一处就够」，然后两处悄悄分叉（症状：筛选条与详情页品类名不一致，且零报错）。
  // 2026-10-23 labelEn 对账随多语言退役：前端已不消费英文名，不再为它建闸门。
  for (const c of reg.categories) {
    const front = CAT.CATEGORY_ORDER.find((x) => x.id === c.id);
    assert.ok(front, `${c.id} 必须在前端 CATEGORY_ORDER 里`);
    assert.equal(front.label, c.label, `${c.id} 的中文名两处必须一致`);
  }
});

check('schema 结构校验：phone 无分组/字段错误', () => {
  // 借鉴准绳 groups 表：字段必须归属到一个已注册分组，分组 id 不可重复。
  const schema = loadSchema('phone');
  assert.deepEqual(validateSchema(schema), [], 'phone schema 结构必须零报错');
});

check('反向测：schema 字段引用不存在的分组 / 分组 id 重复必须报出', () => {
  const bad = JSON.parse(JSON.stringify(loadSchema('phone')));
  bad.fields[0].group = 'ghost';
  assert.ok(
    validateSchema(bad).some((e) => /ghost/.test(e)),
    '字段引用不存在的分组必须报出',
  );
  bad.groups.push({ id: 'body', name: 'dup', type: 'single' });
  assert.ok(
    validateSchema(bad).some((e) => /重复/.test(e)),
    '分组 id 重复必须报出',
  );
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

check(
  '四态 valueStatus：present→available / absent→unknown / none→none / not_applicable→not_applicable',
  () => {
    // 准绳 value_status 的四条语义。valueStatus 映射只存 none/not_applicable 例外，其余靠 presence 推导。
    const p = {
      specs: { 'display.sizeIn': 6.1, 'body.weightG': 170 },
      valueStatus: { 'body.weightG': 'none', 'display.type': 'not_applicable' },
    };
    assert.equal(valueStatus(p, 'display.sizeIn'), 'available', 'specs 有值 = available');
    assert.equal(valueStatus(p, 'body.thicknessMm'), 'unknown', 'specs 缺键 = unknown');
    assert.equal(valueStatus(p, 'body.weightG'), 'none', 'valueStatus none 覆盖 presence');
    assert.equal(
      valueStatus(p, 'display.type'),
      'not_applicable',
      'valueStatus not_applicable 覆盖 presence',
    );
    // 生命周期 status 字符串绝不被误当映射：valueStatus 缺省时只按 specs presence 推导
    const q = { status: 'on-sale', specs: { 'display.sizeIn': 6.1 } };
    assert.equal(valueStatus(q, 'display.sizeIn'), 'available', '生命周期 status 不得被当四态映射');
    assert.equal(
      valueStatus(q, 'body.weightG'),
      'unknown',
      '生命周期 status 不得被当四态映射（缺键=unknown）',
    );
  },
);

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

check(
  '反向测：无效 valueStatus 键 / 非法 valueStatus 值必须被闸门拒绝（写错字段名会静默隐藏参数）',
  () => {
    // validateStatusMap 是闸门 11c 的底层；与 validateSpecs 同级，写错一样拒绝写盘。
    const schema = loadSchema('phone');
    const errGhost = validateStatusMap(
      { id: 'p', category: 'phone', specs: {}, valueStatus: { 'display.sizes': 'none' } },
      schema,
    );
    assert.ok(
      errGhost.some((e) => /display\.sizes/.test(e)),
      'valueStatus 引用未注册字段必须报出',
    );
    const errVal = validateStatusMap(
      { id: 'p', category: 'phone', specs: {}, valueStatus: { 'display.sizeIn': 'maybe' } },
      schema,
    );
    assert.ok(
      errVal.some((e) => /maybe/.test(e)),
      '非法 valueStatus 值必须报出',
    );
    assert.deepEqual(
      validateStatusMap(
        { id: 'p', category: 'phone', specs: {}, valueStatus: { 'display.sizeIn': 'none' } },
        schema,
      ),
      [],
      '合法 valueStatus 例外不误报',
    );
  },
);

check('闸门反向测：注入非法 valueStatus 必须拒绝写盘，合法 valueStatus 放行', () => {
  const base = (valueStatus) => ({
    generatedAt: '2026-10-13T00:00:00Z',
    products: Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      slug: `p${i}`,
      brand: 'apple',
      category: 'phone',
      name: `P${i}`,
      releaseDate: '2026-09-01',
      status: 'on-sale',
      specs: {
        'display.sizeIn': 6.1,
        'body.weightG': 170,
        'display.resolutionPx': { w: 1206, h: 2622 },
      },
      provenance: {
        'display.sizeIn': 'apple-official',
        'body.weightG': 'apple-official',
        releaseDate: 'apple-official',
        'display.resolutionPx.w': 'apple-official',
      },
      firstSeenAt: '2026-10-13T00:00:00Z',
      lastSeenAt: '2026-10-13T00:00:00Z',
      ...(i === 0 && valueStatus ? { valueStatus } : {}),
    })),
  });
  assert.ok(
    validate(base({ 'display.sizes': 'none' }), null).some((f) => /valueStatus/.test(f)),
    '非法 valueStatus 键必须拒写',
  );
  assert.deepEqual(
    validate(base({ 'display.sizeIn': 'none' }), null),
    [],
    '合法 valueStatus 例外必须放行',
  );
});

section('v2 全品类目录：用户数据层');


check('set-field：值替换 + provenance 标 user-manual + 官网原值进 report', () => {
  const products = [makeProduct('p1')];
  const { products: out, report } = applyOverrides(products, {
    entries: [
      {
        id: 'o1',
        op: 'set-field',
        productId: 'p1',
        field: 'display.sizeIn',
        value: 6.9,
        reason: '官网抓漏',
        createdAt: '2026-10-13',
        createdBy: '道友',
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
        id: 'o2',
        op: 'add-product',
        createdAt: '2026-10-13',
        product: {
          id: 'u1',
          brand: 'huawei',
          category: 'phone',
          name: '用户机',
          releaseDate: '2026-08-01',
          specs: { 'body.weightG': 180 },
        },
        reason: '官网没有但已上市',
      },
    ],
  });
  assert.equal(out.length, 2, '新产品必须入池');
  const u = out.find((p) => p.id === 'u1');
  assert.equal(u.status, 'on-sale', 'status 缺省 on-sale');
  assert.equal(u.granularity, 'manual');
  assert.equal(u.provenance['body.weightG'], 'user-manual', 'specs 全键标 user-manual');
  assert.equal(
    u.provenance.releaseDate,
    'user-manual',
    'releaseDate 有值也要 provenance（硬闸门）',
  );
  assert.equal(report.added.length, 1);
});

check('软删除与冲突：active=false 不生效；同目标多条后者赢', () => {
  const products = [makeProduct('p1')];
  const { products: out, report } = applyOverrides(products, {
    entries: [
      {
        id: 'a',
        op: 'set-field',
        productId: 'p1',
        field: 'display.sizeIn',
        value: 7.0,
        reason: '先改',
        createdAt: '2026-10-01',
      },
      {
        id: 'b',
        op: 'set-field',
        productId: 'p1',
        field: 'display.sizeIn',
        value: 7.2,
        reason: '后改',
        createdAt: '2026-10-02',
      },
      {
        id: 'c',
        op: 'set-field',
        productId: 'p1',
        field: 'body.weightG',
        value: 999,
        reason: '作废',
        createdAt: '2026-10-03',
        active: false,
      },
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
  const base = {
    id: 'x',
    op: 'set-field',
    productId: 'p1',
    field: 'display.sizeIn',
    value: 6.9,
    reason: 'r',
    createdAt: '2026-10-13',
  };
  assert.ok(
    validateOverrides({ entries: [{ ...base, productId: 'ghost' }] }, products).length,
    '引用不存在的机型必须报错',
  );
  assert.ok(
    validateOverrides({ entries: [{ ...base, field: 'display.sizes' }] }, products).length,
    '字段未注册必须报错',
  );
  assert.ok(
    validateOverrides({ entries: [{ ...base, value: 69 }] }, products).length,
    '值越界必须报错',
  );
  assert.ok(
    validateOverrides({ entries: [{ ...base, reason: '' }] }, products).length,
    '缺 reason 必须报错',
  );
  assert.ok(
    validateOverrides({ entries: [{ ...base, createdAt: 'not-a-date' }] }, products).length,
    'createdAt 非法必须报错',
  );
  assert.ok(
    validateOverrides(
      {
        entries: [
          {
            id: 'n',
            op: 'add-product',
            product: makeProduct('p1'),
            reason: 'r',
            createdAt: '2026-10-13',
          },
        ],
      },
      products,
    ).length,
    'add-product id 冲突必须报错',
  );
  assert.ok(
    validateOverrides(
      {
        entries: [
          {
            id: 'n',
            op: 'add-product',
            product: makeProduct('u9', { brand: 'nokia' }),
            reason: 'r',
            createdAt: '2026-10-13',
          },
        ],
      },
      products,
    ).length,
    '品牌未注册必须报错',
  );
  // 排除集合：add-product 已并入的 id 不构成「与现有产品冲突」（validate 二次校验踩过）
  assert.deepEqual(
    validateOverrides(
      {
        entries: [
          {
            id: 'n',
            op: 'add-product',
            product: makeProduct('u9'),
            reason: 'r',
            createdAt: '2026-10-13',
          },
        ],
      },
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
      id: `p${i}`,
      slug: `p${i}`,
      brand: 'apple',
      category: 'phone',
      name: `P${i}`,
      releaseDate: '2026-09-01',
      status: 'on-sale',
      specs: {
        'display.sizeIn': 6.1,
        'body.weightG': 170,
        'display.resolutionPx': { w: 1206, h: 2622 },
        'memory.storageGb': [256],
      },
      provenance: {
        'display.sizeIn': 'apple-official',
        'body.weightG': 'apple-official',
        releaseDate: 'apple-official',
        'display.resolutionPx.w': 'apple-official',
      },
      firstSeenAt: '2026-10-13T00:00:00Z',
      lastSeenAt: '2026-10-13T00:00:00Z',
    })),
  };
  assert.deepEqual(validate(good, null), [], '合规 v2 快照必须零报错');

  const ghost = JSON.parse(JSON.stringify(good));
  ghost.products[0].specs['display.sizes'] = 6.9;
  assert.ok(
    validate(ghost, null).some((f) => /display\.sizes/.test(f)),
    '未注册键必须被闸门拦下',
  );

  const oob = JSON.parse(JSON.stringify(good));
  oob.products[0].specs['body.weightG'] = 1990;
  assert.ok(
    validate(oob, null).some((f) => /weightG/.test(f)),
    '越界值必须被闸门拦下',
  );

  const badCat = JSON.parse(JSON.stringify(good));
  badCat.products[0].category = 'toaster';
  assert.ok(
    validate(badCat, null).some((f) => /品类缺失或未注册/.test(f)),
    '未注册品类必须被闸门拦下',
  );

  assert.deepEqual(validate(good, null), [], '改回后必须恢复绿灯（闸门没被反向测污染）');
});

check('用户数据层经闸门：注入违规的 override 必须拒绝写盘', () => {
  // validate 的 overrides 参数把用户层校验并进闸门。这条守住「写错显性失败」。
  const snapshot = {
    generatedAt: '2026-10-13T00:00:00Z',
    products: Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      slug: `p${i}`,
      brand: 'apple',
      category: 'phone',
      name: `P${i}`,
      releaseDate: '2026-09-01',
      status: 'on-sale',
      specs: {
        'display.sizeIn': 6.1,
        'body.weightG': 170,
        'display.resolutionPx': { w: 1206, h: 2622 },
        'memory.storageGb': [256],
      },
      provenance: {
        'display.sizeIn': 'apple-official',
        'body.weightG': 'apple-official',
        releaseDate: 'apple-official',
        'display.resolutionPx.w': 'apple-official',
      },
      firstSeenAt: '2026-10-13T00:00:00Z',
      lastSeenAt: '2026-10-13T00:00:00Z',
    })),
  };
  const badOverride = {
    entries: [
      {
        id: 'o',
        op: 'set-field',
        productId: 'p1',
        field: 'display.sizes',
        value: 6.9,
        reason: '手滑',
        createdAt: '2026-10-13',
      },
    ],
  };
  const fail = validate(snapshot, null, { overrides: badOverride });
  assert.ok(
    fail.some((f) => /用户数据层/.test(f) && /display\.sizes/.test(f)),
    'override 字段未注册必须拒绝写盘',
  );
  assert.deepEqual(validate(snapshot, null, { overrides: { entries: [] } }), [], '空用户层不误报');
});

check('data/overrides.json 入库文件自身合法（防手滑提交坏层）', () => {
  const ovr = loadOverrides();
  const snap = existsSync(join(ROOT, 'data/products.json'))
    ? JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'))
    : { products: [] };
  // add-product 申报的 id 在管线 merge 后就在 products.json 里了——不排除会
  // 「自己冲突自己」（2026-10-15 iPhone 全代 add-product 后实测踩中）。
  // 与 sync/index.mjs 的 appliedIds 同一排除语义。
  const appliedIds = (ovr.entries ?? [])
    .filter((e) => e.op === 'add-product')
    .map((e) => e.product?.id)
    .filter(Boolean);
  const errs = validateOverrides(ovr, snap.products ?? [], { excludeIds: appliedIds });
  assert.deepEqual(errs, [], `入库的 overrides.json 必须合法：${errs.join('; ')}`);
});
