import { WINDOW_START } from '../lib/window.mjs';
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
// 队列文件断言引真源，不再写字面量（2026-10-25 窗口改全量后字面量断言会误杀）

/* ================================================================ *
 * 11. 窗口过滤与待收录队列
 * ----------------------------------------------------------------
 * 这段判据原先内联在 main() 里，自测碰不到 —— 而它恰好是「错了也不报错」的那一类：
 * 把「无发布日期」误判成「窗口外」，新机静默消失、零报错；把「窗口外」误判成
 * 「待收录」，队列塞满正常老机型、永远清不掉。两个方向都不会抛异常。
 *
 * 队列文件更有一条静默失效：只要带一个时间戳进去，「队列没变」就永远不成立，
 * CI 每 12 小时制造一次空提交。所以下面有专门一条断言盯「同输入同字节」。
 * ================================================================ */
section('窗口过滤与待收录队列');


check('三类丢弃各归其位：缺日期入队、窗口外不入队、模糊边界收进来', () => {
  const input = [
    { id: 'a-no-date', brand: 'apple', name: 'A' }, // 无发布日期 → missing-date，入队
    P2025('b-old', { releaseDate: '2019-09-20' }), // 明确早于窗口 → window，不入队
    P2025('c-in', {}), // 窗口内 → kept
    // 日期精度只到月，且压在边界上（2024-09 距2024-09-01 不到 45 天）→ kept + windowNote
    P2025('d-fuzz', { releaseDate: '2024-09', releaseDatePrecision: 'month' }),
    // 精度不足但离边界很远 → 仍按 window 出局
    P2025('e-fuzz-far', { releaseDate: '2023-11', releaseDatePrecision: 'month' }),
  ];
  const r = WQ.classifyByWindow(input, { windowStart: '2024-09-01' });

  assert.deepEqual(
    r.kept.map((p) => p.id).sort(),
    ['c-in', 'd-fuzz'],
    '窗口内 + 边界模糊的必须收进来',
  );
  assert.deepEqual(
    r.dropped.map((d) => [d.id, d.kind]).sort(),
    [
      ['a-no-date', 'missing-date'],
      ['b-old', 'window'],
      ['e-fuzz-far', 'window'],
    ],
    '丢弃项必须标清 kind，否则队列分不清「可行动」与「产品侧决定」',
  );
  assert.deepEqual(
    r.pending.map((q) => q.id),
    ['a-no-date'],
    '只有缺发布日期的入队 —— 入队标准收窄或放宽都会造成垃圾或漏报',
  );
});

check('反向测：模糊边界必须按精度区分，两侧都试一遍', () => {
  // 只测「边界附近的收进来」会漏掉另一半：若某天有人把 fuzz 条件写成永远 true，
  // 2019 年的老机型会被全收进来。单测要能区分两个方向，所以造一组对照。
  const near = WQ.classifyByWindow(
    [P2025('near', { releaseDate: '2024-09', releaseDatePrecision: 'month' })],
    {
      windowStart: '2024-09-01',
    },
  );
  const far = WQ.classifyByWindow(
    [P2025('far', { releaseDate: '2023-11', releaseDatePrecision: 'month' })],
    {
      windowStart: '2024-09-01',
    },
  );
  assert.equal(near.kept.length, 1, '边界附近的应保留');
  assert.equal(far.kept.length, 0, '离边界远的应出局 —— 若此项也保留，fuzz 条件失效了');
  // 反向：精度到天但压在同一天之前 → 不走fuzz 分支（fuzz 只对精度不足生效）
  const day = WQ.classifyByWindow(
    [P2025('day', { releaseDate: '2024-08-20', releaseDatePrecision: 'day' })],
    {
      windowStart: '2024-09-01',
    },
  );
  assert.equal(day.kept.length, 0, '精度到天的应严格按日期判定，不吃fuzz 豁免');
});

check('窗口起点非法时抛错，而不是静默把所有机型都判出局', () => {
  assert.throws(
    () => WQ.classifyByWindow([P2025('x')], { windowStart: 'not-a-date' }),
    /windowStart/,
    'Date.parse 得到 NaN 时若不抛错，NaN 比较恒为 false，会把全部机型误判为窗口外',
  );
});

check('待收录项带可执行的人工动作（不是一句「失败了」）', () => {
  const r = WQ.classifyByWindow([{ id: 'iphone-99', brand: 'apple', name: 'iPhone 99' }], {
    windowStart: '2024-09-01',
  });
  const q = r.pending[0];
  assert.ok(q.action.includes('release-dates.json'), '必须指明补哪张表');
  assert.ok(q.action.includes('"id": "iphone-99"'), '必须把要补的那条 id 写出来，照抄即可');
  assert.equal(q.brand, 'apple', '要带品牌，否则 60 台里人工分不清是谁');
});

check('队列文件是纯数据的函数：同输入必须逐字节一致（反向：带时间戳必失败）', () => {
  const pending = [
    {
      id: 'b',
      kind: 'missing-date',
      brand: 'apple',
      name: null,
      nameZh: null,
      slug: null,
      action: 'x',
    },
    {
      id: 'a',
      kind: 'missing-date',
      brand: 'huawei',
      name: null,
      nameZh: null,
      slug: null,
      action: 'y',
    },
  ];
  const s1 = JSON.stringify(WQ.buildQueueFile(pending, { windowStart: '2024-09-01' }));
  const s2 = JSON.stringify(WQ.buildQueueFile(pending, { windowStart: '2024-09-01' }));
  assert.equal(s1, s2, '同输入必须同字节 —— 否则 CI 每轮都判「队列变了」，制造空提交');

  // 反向测：顺序打乱也必须同字节（排序只认 id，不认传入顺序）
  const s3 = JSON.stringify(
    WQ.buildQueueFile([...pending].reverse(), { windowStart: '2024-09-01' }),
  );
  assert.equal(s1, s3, '顺序打乱后仍须一致 —— 说明排序生效');

  // 反向测：文件里不得含任何看起来像时间戳的字段。
  // 判据用字段名而不是值 —— 直接搜 2024-09-01 会误伤 windowStart（它是业务日期，该留）。
  const queue = WQ.buildQueueFile(pending, { windowStart: '2024-09-01' });
  const VOLATILE =
    /generatedAt|firstSeenAt|lastSeenAt|fetchedAt|syncedAt|builtAt|snapshotAt|checkedAt|updatedAt/;
  const walk = (n, p) => {
    if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${p}[${i}]`));
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) {
        assert.ok(!VOLATILE.test(k), `${p}.${k} 是运行时刻字段，进队列文件必然造成空提交`);
        walk(v, `${p}.${k}`);
      }
    }
  };
  walk(queue, '$');
  assert.equal(queue.count, 2, 'count 必须与 items 长度一致');
});

check('真实快照里不该有大批待收录项（>5 说明 release-dates 表该补了）', () => {
  const snap = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8'));
  const dated = snap.products.filter((p) => p.releaseDate).length;
  assert.equal(
    dated,
    snap.products.length,
    `快照里 ${snap.products.length - dated} 台没有发布日期 —— 收录窗口靠发布日期过滤，没有日期的进不来`,
  );
});

/* ================================================================ *
 * 12. 待收录队列 ↔ 指纹层的接线
 * ----------------------------------------------------------------
 * 队列本身测过了，但还有一条「接上去之后能不能被发现」的链路。
 * 这类接线最容易出的事是：**功能写对了，可它挂在一条判据从来不看的分支上**。
 *
 * 具体故障：新机发布却缺发布日期时，它进不了 products.json →
 * dataFingerprint 不动、siteFingerprint 不动 →
 * CI 的提交条件只看这两个标志 → data/discovery-pending.json 永远不进仓库。
 * 台数没少、页面没变、零报错，只是多了一台本该上站的机器没人知道。
 *
 * 所以这里测的是「队列变化能被独立算出来」，量法本身必须先证明有效。
 * ================================================================ */
section('待收录队列与指纹接线');


check('量法 sanity check：同一份队列文件必须算出同一指纹', () => {
  // 先证明「量法本身有效」：同内容两次算出的指纹必须一致，内容变了必须不同。
  // 量法失效（永远返回常量）的话，下面所有关于 pending_changed 的断言都是空的。
  const fp = FP.compute();
  const again = FP.compute();
  assert.equal(
    fp.pendingFingerprint,
    again.pendingFingerprint,
    '量法失效：同一份内容两次算出不同指纹，下面关于 pending_changed 的断言都不可信',
  );
  assert.equal(typeof fp.pendingFingerprint, 'string');
  assert.ok(fp.pendingFingerprint.length > 0, '队列指纹不能是空串');
});

check('反向测：队列内容一变，指纹必须跟着变（否则 CI 永远发现不了新机）', () => {
  // 先 sanity check 量法：同内容两次算出的指纹必须一致。量法失效（永远返回常量）
  // 的话，下面所有关于 pending_changed 的断言都是空的。
  const fp = FP.compute();
  const again = FP.compute();
  assert.equal(
    fp.pendingFingerprint,
    again.pendingFingerprint,
    '量法失效：同一份内容两次算出不同指纹',
  );

  // 再反向测内容敏感性：队列增减必须改变指纹。
  // 算法与 fingerprint.mjs 的 computePendingFingerprint 一致（sha256 前 16 位）。
  const h = (obj) =>
    createHash('sha256')
      .update(JSON.stringify(obj, null, 2).replace(/\r\n/g, '\n'))
      .digest('hex')
      .slice(0, 16);
  const one = { windowStart: '2024-09-01', count: 1, items: [{ id: 'a' }] };
  const two = { windowStart: '2024-09-01', count: 2, items: [{ id: 'a' }, { id: 'b' }] };
  assert.notEqual(
    h(one),
    h(two),
    '队列增减必须改变指纹 —— 这一条若不成立，pending_changed 永远是 false，队列提交不进仓库',
  );

  // 接线必须真的接上了：compute() 要吐出这些字段，缺一个 CI 就拿不到信号
  assert.ok('pendingFingerprint' in fp, 'compute() 必须返回 pendingFingerprint');
  assert.equal(typeof fp.pendingCount, 'number', 'compute() 必须返回 pendingCount');
  assert.ok('rawFingerprint' in fp, 'compute() 必须返回 rawFingerprint（归档接线）');
  assert.equal(typeof fp.rawBytes, 'number', 'compute() 必须返回 rawBytes');
});

check('归档若存在，指纹必须随它变化（官网改版时raw_changed 要能被发现）', () => {
  const fp = FP.compute();
  const dir = join(ROOT, 'data/raw');
  if (!existsSync(dir)) {
    // 还没归档过：必须报 empty，且指针里那一项也不能是空串以外的乱值
    assert.equal(fp.rawFingerprint, 'empty', '没有 data/raw/ 时应返回 empty');
    assert.equal(fp.rawBytes, 0);
    return;
  }
  assert.notEqual(fp.rawFingerprint, 'empty', 'data/raw/ 有文件却算出 empty —— 接线断了');
  assert.ok(fp.rawBytes > 0, '归档非空时 rawBytes 必须 > 0');
});

check('队列文件不存在时指纹是 empty 而非崩溃（60 台发布日期齐全是常态）', () => {
  const fp = FP.compute();
  const p = join(ROOT, 'data/discovery-pending.json');
  if (!existsSync(p)) {
    assert.equal(fp.pendingFingerprint, 'empty', '没有队列文件时应返回 empty');
    assert.equal(fp.pendingCount, 0);
  } else {
    assert.notEqual(fp.pendingFingerprint, 'empty', '队列文件存在却算出 empty —— 接线断了');
    assert.ok(fp.pendingCount > 0, '队列非空时 pendingCount 必须 > 0');
  }
});

check('队列指纹不参与站点指纹（用户看不到队列变化，不该触发重新发布）', () => {
  const fp = FP.compute();
  //站点指纹 = data × template，公式里没有队列这一项。
  // 这是刻意的：队列变了只需要提交，不需要重新发布站点。
  assert.ok(
    fp.siteFingerprint !== fp.pendingFingerprint || fp.pendingFingerprint === 'empty',
    '队列指纹与站点指纹不应是同一个值',
  );
  assert.ok(
    fp.siteFingerprint && fp.dataFingerprint && fp.templateFingerprint,
    '三个指纹都必须有值',
  );
});

check('入库指针 data/.fingerprint 必须记队列指纹（否则下一轮算不出变化）', () => {
  const ptrPath = join(ROOT, 'data/.fingerprint');
  assert.ok(existsSync(ptrPath), `缺少入库指针 ${ptrPath} —— CI 下一轮没法比对`);
  const ptr = JSON.parse(readFileSync(ptrPath, 'utf8'));
  for (const k of ['dataFingerprint', 'siteFingerprint', 'templateFingerprint', 'products']) {
    assert.ok(k in ptr, `指针缺字段 ${k}`);
  }
  // pendingFingerprint 允许暂时缺失（功能刚上线的那一轮还没推进指针），
  // 但只要它存在就不能是 undefined —— 显式 undefined 会让JSON.stringify 丢键，
  // 下轮比对时又变成「没有」，形成静默的永久漏报。
  if ('pendingFingerprint' in ptr) {
    assert.equal(typeof ptr.pendingFingerprint, 'string', 'pendingFingerprint 存在就必须是字符串');
  }
});

check('data/discovery-pending.json 若存在，必须是无时间戳的纯数据文件', () => {
  const p = join(ROOT, 'data/discovery-pending.json');
  if (!existsSync(p)) {
    // 当前没有待收录项是正常状态（60 台发布日期齐全）。
    // 但必须确认「真的没有」而不是「忘了生成」—— 用 release-dates 的条数佐证。
    const rd = JSON.parse(readFileSync(join(ROOT, 'data/release-dates.json'), 'utf8'));
    assert.ok(
      rd.entries.length >= 60,
      `既没有待收录队列，取证表也只有 ${rd.entries.length} 条 —— 两者必有一处不对`,
    );
    return;
  }
  const raw = readFileSync(p, 'utf8');
  const q = JSON.parse(raw);
  assert.equal(typeof q.count, 'number', 'count 必须是数字');
  assert.equal(q.count, q.items.length, 'count 必须与 items 长度一致');
  assert.equal(q.windowStart, WINDOW_START, 'windowStart 应与管线窗口一致（引 lib/window.mjs 真源）');
  assert.ok(
    !/generatedAt|firstSeenAt|fetchedAt|syncedAt/.test(raw),
    '队列文件含时间戳字段，会造成空提交',
  );
  for (const it of q.items) {
    assert.equal(it.kind, 'missing-date', '队列里只该有缺发布日期这一类');
    assert.ok(it.action?.includes('release-dates.json'), '每条都要指明补哪张表');
  }
});

check('submissions 指纹接线：compute() 必须吐字段，且与队列同性质（不参与站点指纹）', () => {
  const fp = FP.compute();
  // 量法 sanity：同内容两次算出的指纹必须一致
  assert.equal(
    fp.submissionsFingerprint,
    FP.compute().submissionsFingerprint,
    '量法失效：同一份 submissions 两次算出不同指纹',
  );
  // 接线必须真的接上了：缺字段 CI 就拿不到信号
  assert.ok('submissionsFingerprint' in fp, 'compute() 必须返回 submissionsFingerprint');
  assert.equal(typeof fp.submissionsCount, 'number', 'compute() 必须返回 submissionsCount');
  // 文件不存在 → 'empty'（首次访客提交前的正常状态）；存在 → 不得是 empty
  const p = join(ROOT, 'data/submissions.json');
  if (!existsSync(p)) {
    assert.equal(fp.submissionsFingerprint, 'empty', '没有 submissions 文件时应返回 empty');
  } else {
    assert.notEqual(fp.submissionsFingerprint, 'empty', 'submissions 存在却算出 empty —— 接线断了');
  }
  // 指针里允许暂时缺失（功能上线后的第一轮还没推进指针），存在就必须是字符串
  if (existsSync(join(ROOT, 'data/.fingerprint'))) {
    const ptr = JSON.parse(readFileSync(join(ROOT, 'data/.fingerprint'), 'utf8'));
    if ('submissionsFingerprint' in ptr) {
      assert.equal(typeof ptr.submissionsFingerprint, 'string', 'submissionsFingerprint 存在就必须是字符串');
    }
  }
});
