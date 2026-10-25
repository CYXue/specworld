/**
 * 较上代变化（纯函数，评审 2026-10-17 §十一-1）：
 * 913 款 + 完整谱系数据 = 「每台机型 vs 同产品线上一代」的差异摘要是竞品抄不走的能力。
 *
 * 判据纪律：
 * - 「上一代」= 同 brand 同 line 内、发布时间严格早于本机、且距离最近的一台
 *   （releaseDate 缺失的机器不参与链）；同日发布的互为备选时取 id 排序稳定者。
 * - 差异只报**官网有值可算**的字段：双方都缺的字段不出现，绝不用 0 或估算补位（原则一）。
 * - 只列差异、不判好坏（用户 2026-10-13 定的对比纪律）：weight -12g 不标「更好」，
 *   方向语义由用户自己读。
 *
 * ⚠️ 纯 JS（selftest 直接 import），不许写 TS 注解。
 */

/** 从扁平 specs 取数值；weight 兼容 G/Kg 双字段（ Kg×1000 归一到 g） */
function numAt(specs, key) {
  const v = specs[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function weightG(specs) {
  const g = numAt(specs, 'body.weightG');
  if (g != null) return g;
  const kg = numAt(specs, 'body.weightKg');
  return kg != null ? kg * 1000 : null;
}

/** 同 (brand,line) 内的代际链：id → 同线上一代产品（发布严格更早、最近的一个） */
export function buildGenerationChains(products) {
  const byLine = new Map();
  for (const p of products) {
    if (!p.line || !p.brand || !p.releaseDate) continue;
    if (!byLine.has(p.brand + '|' + p.line)) byLine.set(p.brand + '|' + p.line, []);
    byLine.get(p.brand + '|' + p.line).push(p);
  }
  const prev = new Map();
  for (const group of byLine.values()) {
    group.sort((a, b) =>
      a.releaseDate.localeCompare(b.releaseDate) || String(a.id).localeCompare(String(b.id)),
    );
    for (let i = 1; i < group.length; i++) prev.set(group[i].id, group[i - 1]);
  }
  return prev;
}

/**
 * 本机 vs 上一代的差异摘要。返回项（仅双方都有值时才出现）：
 *   battery: Δ mAh（带符号整数）
 *   weight:  Δ g（带符号，一位小数）
 *   size:    Δ 英寸（带符号，两位小数）
 *   chip:    '旧芯片 → 新芯片'（文本变化）
 * 无上一代 → null；有上一代但全部字段无法比较 → 空对象（调用方同样不渲染）。
 */
export function generationDelta(p, prevProduct) {
  if (!prevProduct) return null;
  const cur = p.specs ?? {};
  const old = prevProduct.specs ?? {};
  const out = {};

  const cb = numAt(cur, 'battery.capacityMah');
  const ob = numAt(old, 'battery.capacityMah');
  if (cb != null && ob != null && cb !== ob) out.battery = Math.round(cb - ob);

  const cw = weightG(cur);
  const ow = weightG(old);
  if (cw != null && ow != null && cw !== ow) out.weight = Math.round((cw - ow) * 10) / 10;

  const cs = numAt(cur, 'display.sizeIn');
  const os = numAt(old, 'display.sizeIn');
  if (cs != null && os != null && cs !== os) out.size = Math.round((cs - os) * 100) / 100;

  const cc = typeof cur['chipset.name'] === 'string' ? cur['chipset.name'] : null;
  const oc = typeof old['chipset.name'] === 'string' ? old['chipset.name'] : null;
  if (cc && oc && cc !== oc) out.chip = `${oc} → ${cc}`;

  return out;
}

/** 卡片展示用的紧凑文本：挑**第一个**可算差异，格式 '+500 mAh' / '-12 g' / '+0.15″' / 芯片 'A18 → A19' */
export function deltaBadgeText(delta) {
  if (!delta) return null;
  if (delta.battery != null) return `${delta.battery > 0 ? '+' : ''}${delta.battery} mAh`;
  if (delta.weight != null) return `${delta.weight > 0 ? '+' : ''}${delta.weight} g`;
  if (delta.size != null) return `${delta.size > 0 ? '+' : ''}${delta.size}″`;
  if (delta.chip) return delta.chip;
  return null;
}
