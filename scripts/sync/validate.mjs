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

export const LIMITS = {
  minProducts: 20, // 低于这个数说明抓取整体失败了
  maxDropRatio: 0.1, // 比上一版少 10% 就拦
  maxCoverageDrop: 0.05, // 必填字段覆盖率跌超 5 个百分点就拦
  ppi: [150, 1000],
  brightnessNits: [100, 10000],
  thicknessMm: [2, 20],
  weightG: [80, 400],
  screenIn: [3, 12],
  chargeW: [0, 300],
  batteryMah: [1000, 12000],
  /**
   * 刷新率：手机屏幕真实范围。取值 `120` / `1-120`（LTPO）/ `60/90`（离散档位）。
   * 上下界都取「字符串里最后一个数字」——`1-120` 的下限 1 是 LTPO 的真实语义，不是异常。
   * 闸门存在的理由（2026-10-02 实测）：旧解析器把 PWM 调光频率（1440 / 2160）
   * 和分辨率数字（2622）当成了刷新率，这种错值能一路畅通地发布出去，只能靠闸门兜。
   */
  refreshHz: [48, 240],
};

/** 必填字段：这些字段的覆盖率是数据质量的体温计 */
export const REQUIRED_PATHS = [
  'releaseDate',
  'body.weightG',
  'body.thicknessMm',
  'display.sizeIn',
  'display.resolutionPx',
  'memory.storageGb',
];

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const has = (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);

function inRange(v, [lo, hi]) {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

/**
 * @param {import('../src/lib/types.ts').Snapshot} snapshot
 * @param {import('../src/lib/types.ts').Snapshot|null} previous
 * @returns {string[]} 失败原因列表，空数组表示通过
 */
export function validate(snapshot, previous) {
  const fail = [];
  const ps = snapshot.products;

  // 1. 总量
  if (ps.length < LIMITS.minProducts) fail.push(`机型总数只有 ${ps.length}，低于下限 ${LIMITS.minProducts}`);

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

  // 4. 数值合理性
  for (const p of ps) {
    const checks = [
      ['display.ppi', LIMITS.ppi],
      ['display.brightnessTypicalNits', LIMITS.brightnessNits],
      ['display.brightnessPeakNits', LIMITS.brightnessNits],
      ['body.thicknessMm', LIMITS.thicknessMm],
      ['body.weightG', LIMITS.weightG],
      ['display.sizeIn', LIMITS.screenIn],
      ['battery.wiredChargeW', LIMITS.chargeW],
      ['battery.capacityMah', LIMITS.batteryMah],
    ];
    for (const [path, range] of checks) {
      const v = get(p, path);
      if (v === null || v === undefined) continue;
      if (!inRange(v, range)) fail.push(`${p.id} 的 ${path} = ${v}，超出合理区间 ${range.join('–')}`);
    }
    // 5b. 刷新率是字符串（要保留 `1-120` 的区间语义），单独校验上界
    if (p.display?.refreshHz) {
      const parts = String(p.display.refreshHz).split(/[-–~/]/).map(Number).filter(Number.isFinite);
      if (!parts.length) {
        fail.push(`${p.id} 的 display.refreshHz = "${p.display.refreshHz}" 里没有可解析的数字`);
      } else {
        const top = Math.max(...parts);
        if (!inRange(top, LIMITS.refreshHz)) {
          fail.push(
            `${p.id} 的 display.refreshHz = "${p.display.refreshHz}" 上界 ${top} Hz 超出合理区间 ` +
              `${LIMITS.refreshHz.join('–')}（疑似把 PWM 调光频率或分辨率当成刷新率）`
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
      if (sku.priceCny !== null && sku.priceCny <= 0) fail.push(`${p.id} 的 SKU 价格非正：${sku.priceCny}`);
    }
    // 7. 口径缺失：有值但没口径 = 不可比，直接拦
    if (has(p.battery?.capacityMah) && !p.battery.capacityCaliber) {
      fail.push(`${p.id} 有电池容量但缺 capacityCaliber（口径不可缺失）`);
    }
    if (has(p.display?.brightnessPeakNits) && has(p.display?.brightnessTypicalNits) &&
        p.display.brightnessPeakNits < p.display.brightnessTypicalNits) {
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
      else if (t > Date.now() + 86400000) fail.push(`${p.id} 的 releaseDate 在未来：${p.releaseDate}`);
    }
    // 10. provenance 必须覆盖所有非空的核心字段
    for (const path of ['body.weightG', 'display.sizeIn', 'battery.capacityMah', 'releaseDate']) {
      if (has(get(p, path)) && !p.provenance?.[path]) {
        fail.push(`${p.id} 的 ${path} 有值但缺 provenance`);
      }
    }
    // 11. 品牌必须在注册表里
    if (!['apple', 'huawei'].includes(p.brand)) fail.push(`${p.id} 的品牌不在注册表：${p.brand}`);
  }

  // 12. 与上一版对比的退化检测
  if (previous) {
    const drop = 1 - ps.length / Math.max(previous.products.length, 1);
    if (drop > LIMITS.maxDropRatio) {
      fail.push(`机型数比上一版减少 ${(drop * 100).toFixed(1)}%（${previous.products.length} → ${ps.length}）`);
    }
    for (const path of REQUIRED_PATHS) {
      const prev = previous.products.length
        ? previous.products.filter((p) => has(get(p, path))).length / previous.products.length
        : 0;
      if (prev - coverage[path] > LIMITS.maxCoverageDrop) {
        fail.push(`${path} 覆盖率从 ${(prev * 100).toFixed(1)}% 跌到 ${(coverage[path] * 100).toFixed(1)}%`);
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
