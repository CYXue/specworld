/**
 * 校验闸门。
 *
 * 设计原则抄自「AI 大模型世界」：**闸门只做一件事——在数据变坏的那一刻拒绝写盘，保留上一版。**
 * 上游改版、某个机型页面结构变了、某个字段突然全空，都会在这里被拦住并以非零退出码结束，
 * 而不是把一份残缺的数据静默发到线上。
 *
 * 每条闸门都必须能回答两个问题：
 *   1. 它防的是哪种真实故障？
 *   2. 误报（把好数据拦下来）的概率有多大？
 * 答不上来的闸门不要加。
 */

import { isValidBrand } from '../brands.mjs';
import { findDateShapeViolations } from '../lib/data-guards.mjs';
import { validateOverrides } from '../lib/overrides.mjs';
import {
  isRegisteredCategory,
  LIFECYCLE_STATUS_VALUES,
  loadCategories,
  loadSchema,
  validateSpecs,
  validateStatusMap,
} from '../lib/schema.mjs';
import { pick } from '../lib/specs.mjs';

export const LIMITS = {
  minProducts: 20, // 低于这个数说明抓取整体失败了
  maxDropRatio: 0.1, // 比上一版少 10% 就拦
  maxCoverageDrop: 0.05, // 必填字段覆盖率跌超 5 个百分点就拦
  /**
   * 刷新率：手机屏幕真实范围。取值 `120` / `1-120`（LTPO）/ `60/90`（离散档位）。
   * 上下界都取「字符串里最后一个数字」——`1-120` 的下限 1 是 LTPO 的真实语义，不是异常。
   * 闸门存在的理由（2026-10-02 实测）：旧解析器把 PWM 调光频率（1440 / 2160）
   * 和分辨率数字（2622）当成了刷新率，这种错值能一路畅通地发布出去，只能靠闸门兜。
   * ⚠️ refreshHz 在 schema 里是 string 型（无 range），所以本区间是**唯一**留在代码里的
   * 数值防线。上界 500：电视/电竞屏已有 288/300 Hz 实测真值；PWM 调光频率通常
   * ≥ 1920 Hz，仍稳稳拦得住（2026-10-24 智慧屏品类扩充时放宽）。
   * 字段区间——它是「字符串序类适配器」，不是双源（2026-10-13 硬编码审计 A2 治理）。
   */
  refreshHz: [48, 500],
};

/**
 * 字段数值区间：**单一真源 = schema 的 range**（2026-10-13 硬编码审计 A2 治理）。
 * 此前这里与 phone.json 的 range 双份维护同一批数字，改 schema 时这里会静默漂移。
 * 现在从 schema 派生；schema 删了某字段/range 会在此**显性报错**，而不是静默用旧值。
 */
const SCHEMA_RANGE_PATHS = [
  'display.ppi',
  'display.brightnessTypicalNits',
  'display.brightnessPeakNits',
  'body.thicknessMm',
  'body.weightG',
  'display.sizeIn',
  'battery.wiredChargeW',
  'battery.capacityMah',
];

function schemaFieldLimits() {
  const schema = loadSchema('phone');
  const out = {};
  for (const path of SCHEMA_RANGE_PATHS) {
    const f = (schema?.fields ?? []).find((x) => x.path === path);
    if (!f || !Array.isArray(f.range)) {
      throw new Error(
        `[闸门] 区间派生失败：phone schema 缺少 ${path} 的 range。` +
          `schema 改动后请同步 validate.mjs 的 SCHEMA_RANGE_PATHS（或把该字段从清单移除）。`,
      );
    }
    out[path] = f.range;
  }
  return out;
}
/**
 * 六品类前的区间真源快照（phone schema）。仍导出供 selftest 的覆盖断言引用；
 * **闸门第 4 条已不再使用它**——同一 schema path（body.weightG / display.ppi…）在
 * phone/tablet/wearable 各有不同 range，按产品品类查各自 schema 才是单一真源
 * （2026-10-15 实测：iPad 用 phone 的 [80,400]g 区间被误拦 46 项）。
 */
const FIELD_LIMITS = schemaFieldLimits();

/** path → 注册该字段的品类 id 列表（带缓存；品类感知的必填覆盖率用） */
const registeredCache = new Map();
function registeredIn(path) {
  if (registeredCache.has(path)) return registeredCache.get(path);
  const cats = [];
  for (const c of loadCategories()?.categories ?? []) {
    const s = loadSchema(c.id);
    if ((s?.fields ?? []).some((f) => f.path === path)) cats.push(c.id);
  }
  registeredCache.set(path, cats);
  return cats;
}
export { FIELD_LIMITS, SCHEMA_RANGE_PATHS };

/** 必填字段：这些字段的覆盖率是数据质量的体温计 */
export const REQUIRED_PATHS = [
  'releaseDate',
  'body.weightG',
  'body.thicknessMm',
  'display.sizeIn',
  'display.resolutionPx',
  'memory.storageGb',
];

const has = (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);

/**
 * 取值一律走 specs-first 的 pick（scripts/lib/specs.mjs）：
 * v2 快照读 specs 容器，v1 历史快照回退嵌套结构。
 * 只读 specs 会让迁移后第一轮同步的覆盖率对比瞬间跌到 0，触发拒写——
 * 双兼容是迁移平滑的必要条件，不是兼容负担。
 */
const get = pick;

function inRange(v, [lo, hi]) {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

/**
 * @param {import('../src/lib/types.ts').Snapshot} snapshot
 * @param {import('../src/lib/types.ts').Snapshot|null} previous
 * @param {{overrides?: {entries: object[]}, appliedIds?: string[]}} [options]
 *   overrides 用户数据层（合并后传入，闸门代为校验）；appliedIds 是本层 add-product
 *   已并入 snapshot 的 id（冲突检查要排除，否则自己冲突自己）
 * @returns {string[]} 失败原因列表，空数组表示通过
 */
export function validate(snapshot, previous, options = {}) {
  const fail = [];
  const ps = snapshot.products;

  // 1. 总量
  if (ps.length < LIMITS.minProducts)
    fail.push(`机型总数只有 ${ps.length}，低于下限 ${LIMITS.minProducts}`);

  // 2. 唯一性
  const ids = new Set();
  for (const p of ps) {
    if (ids.has(p.id)) fail.push(`id 重复：${p.id}`);
    ids.add(p.id);
  }

  // 3. 必填覆盖率（品类感知：字段注册在哪些品类，就只在那些品类的池内算——
  //    body.weightG 对 laptop/desktop 不存在（kg 口径），混进全池会把覆盖率稀释成假警报。
  //    顶层身份字段（releaseDate 等）不在任何 schema fields 里 → 回退全池必填）
  const coverage = {};
  for (const path of REQUIRED_PATHS) {
    const cats = registeredIn(path);
    const pool = cats.length ? ps.filter((p) => cats.includes(p.category ?? 'phone')) : ps;
    coverage[path] = pool.length
      ? pool.filter((p) => has(get(p, path))).length / pool.length
      : 0;
  }

  // 4. 数值合理性（区间真源 = **产品自身品类** schema 的 range——同一 path 在不同品类
  //    有不同区间，phone/tablet/wearable 的 body.weightG 口径各异）
  for (const p of ps) {
    const catSchema = loadSchema(p.category ?? 'phone');
    for (const path of SCHEMA_RANGE_PATHS) {
      const f = (catSchema?.fields ?? []).find((x) => x.path === path);
      const range = f && Array.isArray(f.range) ? f.range : null;
      if (!range) continue;
      const v = get(p, path);
      if (v === null || v === undefined) continue;
      if (!inRange(v, range))
        fail.push(`${p.id} 的 ${path} = ${v}，超出合理区间 ${range.join('–')}`);
    }
    // 5b. 刷新率是字符串（要保留 `1-120` 的区间语义），单独校验上界
    const refreshHz = get(p, 'display.refreshHz');
    if (refreshHz) {
      const parts = String(refreshHz)
        .split(/[-–~/]/)
        .map(Number)
        .filter(Number.isFinite);
      if (!parts.length) {
        fail.push(`${p.id} 的 display.refreshHz = "${refreshHz}" 里没有可解析的数字`);
      } else {
        const top = Math.max(...parts);
        if (!inRange(top, LIMITS.refreshHz)) {
          fail.push(
            `${p.id} 的 display.refreshHz = "${refreshHz}" 上界 ${top} Hz 超出合理区间 ` +
              `${LIMITS.refreshHz.join('–')}（疑似把 PWM 调光频率或分辨率当成刷新率）`,
          );
        }
      }
    }
    // （原闸门 5「负值/零值」已删除：它判的 weightG/thicknessMm/sizeIn 三条路径
    // 的 schema range 下界均 > 0，非正值必先被闸门 4 以「超出合理区间」抓到 ——
    // 双写同一判据不是深度防御，是**死闸门**：永远独立不触发，只会让人误以为
    // 「零值有专门防线」。2026-10-14 审计 P2-1。真要防回归，锁的是
    // 「这三条路径必须在 SCHEMA_RANGE_PATHS 里」（见 selftest 的接线自洽用例），
    // 而不是在下面再抄一遍判据。）
    // 6. 价格非正
    for (const sku of p.skus ?? []) {
      if (sku.priceCny !== null && sku.priceCny <= 0)
        fail.push(`${p.id} 的 SKU 价格非正：${sku.priceCny}`);
    }
    // 7. 口径缺失：有值但没口径 = 不可比，直接拦
    const capacityMah = get(p, 'battery.capacityMah');
    const capacityCaliber = get(p, 'battery.capacityCaliber');
    if (has(capacityMah) && !has(capacityCaliber)) {
      fail.push(`${p.id} 有电池容量但缺 capacityCaliber（口径不可缺失）`);
    }
    const peakNits = get(p, 'display.brightnessPeakNits');
    const typicalNits = get(p, 'display.brightnessTypicalNits');
    if (
      has(peakNits) &&
      has(typicalNits) &&
      peakNits < typicalNits
    ) {
      fail.push(`${p.id} 峰值亮度小于典型亮度，解析可能串行`);
    }
    // 8. 成绩单量纲
    const leagueUnit = new Map();
    for (const s of p.scores ?? []) {
      if (leagueUnit.has(s.league) && leagueUnit.get(s.league) !== s.unit) {
        fail.push(`${p.id} 的 ${s.league} 出现两种量纲：${leagueUnit.get(s.league)} / ${s.unit}`);
      }
      leagueUnit.set(s.league, s.unit);
    }
    // 9. 发布日期不能来自未来，也不能早于范围下限太多
    if (p.releaseDate) {
      const t = Date.parse(p.releaseDate);
      if (Number.isNaN(t)) fail.push(`${p.id} 的 releaseDate 无法解析：${p.releaseDate}`);
      else if (t > Date.now() + 86400000)
        fail.push(`${p.id} 的 releaseDate 在未来：${p.releaseDate}`);
    }
    // 10. provenance 必须覆盖所有非空的核心字段
    for (const path of ['body.weightG', 'display.sizeIn', 'battery.capacityMah', 'releaseDate']) {
      if (has(get(p, path)) && !p.provenance?.[path]) {
        fail.push(`${p.id} 的 ${path} 有值但缺 provenance`);
      }
    }
    // 10b. 子对象型必填字段的 provenance 登记在子路径上，不是父路径。
    //
    // 修复记录（2026-10-03，由 scripts/qa/coverage.mjs 抓到）：
    // display.resolutionPx 是 {w,h} 对象，规范化层登记的是 `display.resolutionPx.w`，
    // 而这条闸门查的是父路径 `display.resolutionPx` —— 于是 **60 台全部**报
    // 「有值但缺 provenance」。规范化层 scripts/normalize/index.mjs 早已特判过
    // 子路径（见其1705 行），闸门这边漏了，于是每台机器都挂一条假警报。
    //
    // 为什么它没被发现：闸门失败会让管线非零退出，可这条是**跟着必填字段一起**
    // 触发的，看起来像「数据本来就缺 provenance」，被当成结构性缺口忽略了。
    // 教训：**闸门自己也会误报**，所以它需要被测试（见 scripts/selftest.mjs）。
    for (const path of ['display.resolutionPx']) {
      if (has(get(p, path)) && !p.provenance?.[`${path}.w`]) {
        fail.push(`${p.id} 的 ${path} 有值但缺 provenance（应登记在 ${path}.w 上）`);
      }
    }
    // 11. 品牌必须在注册表里（注册表单一真源见 scripts/brands.mjs，新增品牌只改那一个文件）
    if (!isValidBrand(p.brand)) fail.push(`${p.id} 的品牌不在注册表：${p.brand}`);
    // 11a. 生命周期 status 必须在权威枚举内（2026-10-17 审计 A1 补的闸门）。
    // 补闸门前：契约与两份 types.ts 定 'upcoming'|'on-sale'|'retired'（'discontinued'
    // 2026-10-13 已废），但生成脚本硬编码 'discontinued'，812 台带病写盘、零报错——
    // 「闸门太静」的标准形态（PITFALLS P3/P7）。枚举真源 = schema.mjs 的
    // LIFECYCLE_STATUS_VALUES（与 DATA-CONTRACT.md §3.1、两份 TS 镜像对齐）。
    // 缺 status 同样拒：它是顶层身份字段，与 category 缺失同级处理（见 11b）。
    if (!LIFECYCLE_STATUS_VALUES.includes(p.status)) {
      fail.push(
        `${p.id} 的 status = ${JSON.stringify(p.status)} 不在权威枚举 ` +
          `${LIFECYCLE_STATUS_VALUES.join(' / ')} 内（'discontinued' 已于 2026-10-13 废弃，用 'retired'）`,
      );
    }
    // 11b. 品类必须注册，且 specs 逐键过该品类的 schema（v2 全品类结构）。
    // 防的故障：① category 缺失或指向不存在的品类 → 没有字段表，参数表渲染直接崩；
    //   （categoryOf() 对缺失静默回落 'phone'，闸门若只拦「未注册值」，
    //   这个回落永远见不到光——2026-10-13 审计 H1 起缺失同样拒绝。
    //   真实数据 62 台全部带 category，用户层 add-product 也已校验，
    //   缺失只可能是解析器/合并层写漏，那正是要显性失败的形态）；
    // ② specs 里出现未注册键（拍平漏组 / 用户层字段名拼错）→ 值安静地躺进去没人读。
    if (!isRegisteredCategory(p.category)) {
      fail.push(
        `${p.id} 的品类缺失或未注册：${JSON.stringify(p.category)}（见 data/categories.json）`,
      );
    }
    if (p.specs) {
      const schema = loadSchema(p.category);
      // 11b-ii. 品类注册了但 schema 文件不存在 → **显性失败**。
      // 曾经的写法是 validateSpecs / validateStatusMap 内部 `if (!schema) return []`
      // （注释：「无 schema 的品类不阻塞写入」）——那意味着字段校验、status 映射、
      // 孤儿键检测对该品类**全部空转且静默**：数据脏着写盘，页面按缺失的字段表
      // 渲染或直接崩，而每一次同步都是绿的。
      // 现在：没有字段表的品类不许写入。接新品类（平板/笔记本/音频）的正确顺序是
      // 先建 data/schemas/<id>.json，再让数据流进来——闸门替所有人记住这个顺序。
      if (!schema) {
        fail.push(
          `${p.id} 的品类 "${p.category}" 已注册但没有 schema 文件` +
            `（data/schemas/${p.category}.json）——没有字段表，字段校验/status 映射/孤儿键` +
            `检测会全部空转。请先建 schema，或从 data/categories.json 移除该品类注册。`,
        );
      } else {
        for (const e of validateSpecs(p, schema)) fail.push(e);
        // 11c. status 例外映射（四态 none/not_applicable）必须引用已注册字段、取值合法。
        // 防的故障：用户层把 not_applicable 写错字段名，导致该字段被静默隐藏或从不隐藏。
        for (const e of validateStatusMap(p, schema)) fail.push(e);
      }
    }
  }

  // 14. 身份标识串号检测（2026-10-16 事故：iMac 全系 25 台共用 "iMac,1"/M4984、
  //     iPad mini 7 台共用 iPad1,1、AirPods Max 2 沿用 1 代 A3454——都是批量补录时
  //     把同一套身份字段复制到了整条产品线上。用户一对比就会看到
  //     「2019 iMac 用 ATI Rage IIc 显卡」，一次就够把整站可信度清零）。
  //     口径：同 brand+line 内 device.identifier / device.modelCodes 必须唯一；
  //     identifier 还必须长得像 Apple 内部标识（`iMac,1` / `iPad14,6`），
  //     纯数字、'-'、把型号代码（M3076）填进 identifier 的都算畸形。
  const identRe = /^[A-Za-z][A-Za-z0-9]*,\d+$/; // Apple 内部标识：Name,N
  const codeRe = /^[A-Z]\d{3,6}$/; // A1219 / M4984
  const seenIdent = new Map(); // `${brand}|${line}|${identifier}` → 首见机型 id
  const seenCode = new Map(); // `${brand}|${line}|${code}` → 首见机型 id
  for (const p of ps) {
    const group = `${p.brand ?? ''}|${p.line ?? ''}`;
    const ident = get(p, 'device.identifier');
    if (ident !== null && ident !== undefined && ident !== '') {
      const s = String(ident);
      if (!identRe.test(s)) {
        fail.push(`${p.id} 的 device.identifier = "${s}" 不是合法的 Apple 内部标识（应为 Name,N 形态）`);
      } else {
        const key = `${group}|${s}`;
        if (seenIdent.has(key)) fail.push(`${p.id} 的 device.identifier "${s}" 与 ${seenIdent.get(key)} 串号（同 line 内必须唯一）`);
        else seenIdent.set(key, p.id);
      }
    }
    for (const code of get(p, 'device.modelCodes') ?? []) {
      if (code === null || code === undefined || code === '') continue;
      const s = String(code);
      if (!codeRe.test(s)) {
        fail.push(`${p.id} 的 device.modelCodes 含非法值 "${s}"（应为 A#### / M#### 形态）`);
      } else {
        const key = `${group}|${s}`;
        if (seenCode.has(key)) fail.push(`${p.id} 的 modelCode "${s}" 与 ${seenCode.get(key)} 串号（同 line 内必须唯一）`);
        else seenCode.set(key, p.id);
      }
    }
  }

  // 15. 时间线自相矛盾：停售不得早于发布（airport-express-2012 曾发布 2012-06、
  //     停售 2008-03——生命周期时间轴上线后线会往回走，可视化是最好的校验器）
  // 16. 假精度：releaseDatePrecision 必须在枚举内；天级精度不得压在 01-01——
  //     一大批 1993-01-01 / 1986-01-01 实为年份推测，渲染成「1993 年 1 月 1 日发布」
  //     就是编造事实，与「不做估算」原则直接冲突（取值应降为 year）。
  // 17. 相机阵列与官网原文交叉校验：rawOfficial 写「双摄/三摄系统」时，
  //     camera.rear 的镜头数必须吻合——iPhone 16 曾平白多出一条 tele（官网明明写
  //     双摄），「几颗镜头」是用户最不可能看错的两项之一，这里错一次信任归零。
  //     只在原文含中文数字「N摄」时触发（「二合一摄像头系统」不匹配，不算数）。
  const precisionOk = new Set(['day', 'month', 'year', 'unknown']);
  const CN_NUM = { 双: 2, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 };
  for (const p of ps) {
    if (p.releaseDate && p.retiredAt) {
      const r = Date.parse(p.releaseDate);
      const t = Date.parse(p.retiredAt);
      if (!Number.isNaN(r) && !Number.isNaN(t) && t < r)
        fail.push(`${p.id} 的 retiredAt（${p.retiredAt}）早于 releaseDate（${p.releaseDate}）——时间线倒挂，应清 null 取证后重录`);
    }
    if (p.releaseDatePrecision !== undefined && p.releaseDatePrecision !== null) {
      if (!precisionOk.has(p.releaseDatePrecision))
        fail.push(`${p.id} 的 releaseDatePrecision = "${p.releaseDatePrecision}" 不在枚举内（day/month/year/unknown）`);
      else if (p.releaseDatePrecision === 'day' && /^\d{4}-01-01$/.test(p.releaseDate ?? ''))
        fail.push(`${p.id} 的 releaseDate = ${p.releaseDate} 压在 01-01 却声明天级精度（年份推测应降为 year）`);
    }
    const raw = p.rawOfficial;
    const rawText = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join('\n') : '';
    const camMatch = rawText.match(/([双二两三四五六七])摄/);
    if (camMatch) {
      const rear = get(p, 'camera.rear');
      if (Array.isArray(rear)) {
        const expected = CN_NUM[camMatch[1]];
        if (rear.length !== expected)
          fail.push(
            `${p.id} 的官网原文写「${camMatch[1]}摄」但 camera.rear 有 ${rear.length} 条——` +
              `镜头阵列与原文不一致（多出的 role 或整条缺失）`,
          );
      }
    }
  }

  // 18. 日期精度形状（data-guards D，2026-10-17 审计 A3 接入写盘闸门）。
  // 曾经的缺口：data-guards.mjs 五条判据只在 selftest 里跑，写盘路径（本文件）没有
  // 形状校验——65 台「year 精度 + 'YYYY-01-01' 占位日期」一路绿灯写进 products.json，
  // 直到自测才炸。闸门存在但不在写盘路径上 = 闸门太静（PITFALLS P3/P7 的又一形态）。
  // 判据：day 必须 YYYY-MM-DD、month 必须 YYYY-MM、year 必须 YYYY——
  // 形状不符 = 用假精度冒充真日期（数据诚信红线）。
  for (const [id, d] of findDateShapeViolations(ps)) {
    fail.push(
      `${id} 的 releaseDate = ${d} 的形状与 releaseDatePrecision 不符` +
        `（day=YYYY-MM-DD / month=YYYY-MM / year=YYYY，假精度是数据诚信红线）`,
    );
  }

  // 13. 用户数据层合法性（set-field 引用悬空 / 字段未注册 / 值类型区间 / add-product 冲突）。
  // 与官网闸门同级：写错一样拒绝写盘——静默跳过的后果是用户以为改好了而页面纹丝不动。
  // appliedIds 排除本层自己新增的机型（snapshot 已含它们，不排除会「自己冲突自己」误报）。
  if (options.overrides) {
    for (const e of validateOverrides(options.overrides, ps, { excludeIds: options.appliedIds })) {
      fail.push(`用户数据层 ${e}`);
    }
  }

  // 12. 与上一版对比的退化检测
  if (previous) {
    const drop = 1 - ps.length / Math.max(previous.products.length, 1);
    if (drop > LIMITS.maxDropRatio) {
      fail.push(
        `机型数比上一版减少 ${(drop * 100).toFixed(1)}%（${previous.products.length} → ${ps.length}）`,
      );
    }
    for (const path of REQUIRED_PATHS) {
      // 退化检测改为**同机型对比**（2026-10-15 六品类后必改）：旧版按全池算，
      // 新增品类的「从无到有」（如 Watch 重量大面积未采集）会把池内覆盖率稀释成假退化。
      // 真正要防的是「已有数据被改坏」——所以只在两版**共有的机型**上对比覆盖率。
      const cats = registeredIn(path);
      const inCats = (p) => (cats.length ? cats.includes(p.category ?? 'phone') : true);
      const poolPrev = previous.products.filter(inCats);
      const prevIds = new Set(poolPrev.map((p) => p.id));
      const poolCurrSame = ps.filter((p) => prevIds.has(p.id) && inCats(p));
      const prev = poolPrev.length
        ? poolPrev.filter((p) => has(get(p, path))).length / poolPrev.length
        : 0;
      const curr = poolCurrSame.length
        ? poolCurrSame.filter((p) => has(get(p, path))).length / poolCurrSame.length
        : 0;
      if (prev - curr > LIMITS.maxCoverageDrop) {
        fail.push(
          `${path} 覆盖率从 ${(prev * 100).toFixed(1)}% 跌到 ${(curr * 100).toFixed(1)}%（同机型对比）`,
        );
      }
    }
  }

  return fail;
}

export function coverageReport(snapshot) {
  const ps = snapshot.products;
  const rows = [];
  for (const path of REQUIRED_PATHS) {
    const n = ps.filter((p) => has(get(p, path))).length;
    rows.push(`${path} ${((n / ps.length) * 100).toFixed(1)}%`);
  }
  return rows;
}
