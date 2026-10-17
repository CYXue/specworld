/**
 * 数据事故防线（纯函数，评审 2026-10-17 十/§十二-3）：
 * 「2019 年 iMac 用 CD-ROM」这类串号数据一旦写进库，任何 UI 优化都会被一条错数据抵消。
 * 这五条判据在**构建期/自测期**拦截同类事故；当前实测（2026-10-17，913 台）全部为零违规，
 * 闸门防的是回归——未来 AI 批量生成/合并数据时再犯，会在 selftest 当场炸掉而不是上屏。
 *
 * ⚠️ 全文件必须保持纯 JS（selftest 直接 import），不许写 TS 注解。
 *
 * 判据全部落在**语义最小单位**（P10 纪律），并用真实数据反向校准过：
 * - 「麒麟9050 Pro 麒麟9050」是官网原文照录（rawOfficial 可查证）→ 有原文豁免；
 * - 「Apple M2 芯片 | Apple R1 芯片」是两颗芯片并列 → 只查含数字的 token 重复，
 *   不查英文前缀重复（Apple 出现两次是合法并列）。
 */

/** 同产品线内两台的「身份签名」：modelCode + 芯片 + GPU + 分辨率 + 重量 */
function identitySignature(p) {
  const s = p.specs ?? {};
  return JSON.stringify({
    modelCode: p.modelCode ?? null,
    chip: s['chipset.name'] ?? null,
    gpu: s['chipset.gpu'] ?? null,
    res: JSON.stringify(s['display.resolutionPx'] ?? null),
    weight: s['body.weightG'] ?? s['body.weightKg'] ?? null,
  });
}

/**
 * A. 族内串号：同 line 下 ≥2 台签名完全相同且 modelCode 非空。
 * （modelCode 为空的配件类不算——键盘/适配器共用「无型号代码」是常态不是串号。）
 * 返回违规的 line 名数组。
 */
export function findDuplicateIdentities(products) {
  const byLine = new Map();
  for (const p of products) {
    if (!p.line) continue;
    const sig = identitySignature(p);
    const parsed = JSON.parse(sig);
    if (!parsed.modelCode) continue; // 无型号代码的配件类不判串号
    if (!byLine.has(p.line)) byLine.set(p.line, new Map());
    const m = byLine.get(p.line);
    m.set(sig, (m.get(sig) ?? 0) + 1);
  }
  const bad = [];
  for (const [line, m] of byLine) {
    for (const n of m.values()) {
      if (n > 1) {
        bad.push(line);
        break;
      }
    }
  }
  return bad;
}

/** 年月比较：只比到双方共有的精度（YYYY 或 YYYY-MM），不许拿完整 ISO 字典序骗过月精度 */
function yearMonthOf(iso) {
  if (!iso) return null;
  const parts = iso.split('-');
  return parts.slice(0, Math.min(parts.length, 2)).join('-');
}

/**
 * B. 时间倒挂：retiredAt（停售）早于 releaseDate（发布）——按可比精度比较。
 * 返回违规产品 id 数组。
 */
export function findInvertedLifetimes(products) {
  const bad = [];
  for (const p of products) {
    const rel = yearMonthOf(p.releaseDate);
    const ret = yearMonthOf(p.retiredAt);
    if (rel && ret && ret < rel) bad.push(p.id);
  }
  return bad;
}

/**
 * C. 芯片名 token 自嵌套：含数字的 token（型号本身）在同值内出现 ≥2 次
 * （「麒麟9050 Pro 麒麟9050」），且该值**不是** rawOfficial 原文（原文照录豁免——
 * 官网自己写串了我们如实照录，那是官网的事故不是我们的；但脱离原文的合成值是我们的）。
 * 返回违规产品 id 数组。
 */
export function findChipTokenDuplicates(products) {
  const bad = [];
  for (const p of products) {
    const v = (p.specs ?? {})['chipset.name'];
    if (typeof v !== 'string' || v.length < 4) continue;
    const rawAll = JSON.stringify(p.rawOfficial ?? '');
    const counts = new Map();
    for (const tok of v.split(/[\s|、,，]+/)) {
      if (!/\d/.test(tok)) continue; // 只查型号 token（含数字），「Apple」「Pro」不查
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
    const dup = [...counts.values()].some((n) => n > 1);
    if (dup && !rawAll.includes(v)) bad.push(p.id);
  }
  return bad;
}

/**
 * D. 日期精度形状：day 必须 YYYY-MM-DD、month 必须 YYYY-MM、year 必须 YYYY。
 * 形状不符 = 用假精度冒充真日期（数据诚信红线）。
 * 返回违规 [id, releaseDate] 数组。
 */
export function findDateShapeViolations(products) {
  const shape = { day: 3, month: 2, year: 1 };
  const bad = [];
  for (const p of products) {
    const d = p.releaseDate;
    if (!d || !p.releaseDatePrecision) continue;
    const want = shape[p.releaseDatePrecision];
    if (!want) continue;
    const got = d.split('-').length;
    if (got !== want) bad.push([p.id, d]);
  }
  return bad;
}

/**
 * E. 重量单位双轨：同一产品同时有 body.weightG 与 body.weightKg。
 * 双轨必有一假——下游永远不知道该信哪个（评审：UI 只读 display 字段的前提是单位唯一）。
 * 返回违规产品 id 数组。
 */
export function findDualWeightUnits(products) {
  const bad = [];
  for (const p of products) {
    const s = p.specs ?? {};
    if ('body.weightG' in s && 'body.weightKg' in s) bad.push(p.id);
  }
  return bad;
}
