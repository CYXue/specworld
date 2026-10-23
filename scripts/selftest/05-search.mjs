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
  const setEq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

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
  const ids = (q) =>
    S.search(mixed, q)
      .map((d) => d.product.id)
      .sort();

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

// 下面两条钉的是 2026-10-14 审计 P0-1 的故障原型：
// 「要不要弹容错提示」曾复用检索用的 matchExact（内部含 compact 回落），
// 于是「靠抹掉空格才命中」也被算作精确命中 ⇒ usedLooseMatch 恒 false
// ⇒ 提示条永不显示；而承载这条需求的 _smoke-search.cjs 既没进 CI 也没注册
// npm script，连着 14 项红灯没有任何一次自动运行看得见。
// 教训：判据一旦合并，某一方向必然静默失效 —— 这里两个方向同时钉死。

check('容错提示判据：字面通道必须严格（紧凑写法判为「写法不同」）', () => {
  const d = { haystack: 'huawei nova 14 ultra', compact: 'huaweinova14ultra' };
  // 走真实调用路径（与 SearchView 一致：tokenize → matchLiteral）
  assert.equal(
    Q.matchLiteral(d, Q.tokenize('nova 14 ultra')),
    true,
    '与官方写法一致（含空格）⇒ 字面命中',
  );
  assert.equal(
    Q.matchLiteral(d, Q.tokenize('nova14ultra')),
    false,
    '紧凑写法缺空格 ⇒ 字面必须判否，否则提示条永不显示（P0-1 故障原型）',
  );
  assert.equal(
    Q.matchLiteral(d, Q.tokenize('nova   14   ultra')),
    true,
    '空白数量差异不算写法不同（分词时已折叠）',
  );
});

check('容错提示判据：检索通道必须宽松（与字面通道不许合并）', () => {
  const d = { haystack: 'huawei nova 14 ultra', compact: 'huaweinova14ultra' };
  assert.equal(
    Q.matchExact(d, ['nova14ultra']),
    true,
    '检索必须容错：用户打紧凑写法也要能搜到',
  );
  // 反向测：两条通道若被「顺手合并」成同一份实现，上面两条用例必有一条变红。
  assert.notEqual(
    Q.matchLiteral(d, ['nova14ultra']),
    Q.matchExact(d, ['nova14ultra']),
    '字面与检索必须是两个判据 —— 合并其一，必有一方向静默失效',
  );
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
  assert.deepEqual(
    Q.splitRuns('苹果手机'),
    ['苹果手机'],
    '纯汉字整词原样返回，不空拆（见 splitRuns 注释）',
  );
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
  const ids = (q) =>
    S.search(noisy, q)
      .map((d) => d.product.id)
      .sort();

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

/*
 * 历史记载（2026-10-16）：原「搜索与画布筛选口径一致」检查对照画布的 tokenize 通道，
 * 防止「同一个词两个答案」。画布页面移除后，搜索是唯一入口，对照对象已不存在，整条退役。
 * 若未来新增第二个搜索入口，必须恢复「同一批查询，两个入口集合相同」的对照。
 */

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
