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
import { validateOverrides } from '../lib/overrides.mjs';
import {
  isRegisteredCategory,
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
   * 字段区间——它是「字符串序类适配器」，不是双源（2026-10-13 硬编码审计 A2 治理）。
   */
  refreshHz: [48, 240],
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
const FIELD_LIMITS = schemaFieldLimits();
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

  // 3. 必填覆盖率
  const coverage = {};
  for (const path of REQUIRED_PATHS) {
    coverage[path] = ps.length ? ps.filter((p) => has(get(p, path))).length / ps.length : 0;
  }

  // 4. 数值合理性（区间真源 = schema 的 range，见 FIELD_LIMITS）
  for (const p of ps) {
    const checks = SCHEMA_RANGE_PATHS.map((path) => [path, FIELD_LIMITS[path]]);
    for (const [path, range] of checks) {
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
    // 5. 负值/零值
    for (const path of ['body.weightG', 'body.thicknessMm', 'display.sizeIn']) {
      const v = get(p, path);
      if (typeof v === 'number' && v <= 0) fail.push(`${p.id} 的 ${path} 非正数：${v}`);
    }
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
    // 11b. 品类必须注册，且 specs 逐键过该品类的 schema（v2 全品类结构）。
    // 防的故障：① category 指向不存在的品类 → 没有字段表，参数表渲染直接崩；
    // ② specs 里出现未注册键（拍平漏组 / 用户层字段名拼错）→ 值安静地躺进去没人读。
    if (p.category !== undefined && !isRegisteredCategory(p.category)) {
      fail.push(`${p.id} 的品类未注册：${p.category}（见 data/categories.json）`);
    }
    if (p.specs) {
      const schema = loadSchema(p.category);
      for (const e of validateSpecs(p, schema)) fail.push(e);
      // 11c. status 例外映射（四态 none/not_applicable）必须引用已注册字段、取值合法。
      // 防的故障：用户层把 not_applicable 写错字段名，导致该字段被静默隐藏或从不隐藏。
      for (const e of validateStatusMap(p, schema)) fail.push(e);
    }
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
      const prev = previous.products.length
        ? previous.products.filter((p) => has(get(p, path))).length / previous.products.length
        : 0;
      if (prev - coverage[path] > LIMITS.maxCoverageDrop) {
        fail.push(
          `${path} 覆盖率从 ${(prev * 100).toFixed(1)}% 跌到 ${(coverage[path] * 100).toFixed(1)}%`,
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
