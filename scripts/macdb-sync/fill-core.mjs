// fill.mjs 的纯逻辑层：可被 selftest 以 fixture 直接测试，不碰文件系统。
// 数据纪律与口径见 ./README.md。

/**
 * 串号防线：identifier 同 brand+line 内唯一，presumptive owner = 最早发布
 * （同日取 id 排序第一）。沿用 2026-10-16 清洗口径：宁空勿错。
 * 就地修改 entries（add-product 形状：{ op, product: { id, brand, line, releaseDate, specs, provenance } }），
 * 返回清空数量。
 */
export function dedupeIdentifierSerial(entries) {
  const IDENT = 'device.identifier';
  const groups = new Map();
  for (const e of entries) {
    if (e.op !== 'add-product') continue;
    const v = e.product?.specs?.[IDENT];
    if (typeof v !== 'string' || !v) continue;
    const key = e.product.brand + '||' + e.product.line + '||' + v;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(e);
  }
  let removed = 0;
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (a.product.releaseDate || '9999').localeCompare(b.product.releaseDate || '9999')
      || a.product.id.localeCompare(b.product.id));
    for (const e of arr.slice(1)) {
      delete e.product.specs[IDENT];
      if (e.product.provenance) delete e.product.provenance[IDENT];
      removed++;
    }
  }
  return removed;
}

/**
 * modelCode 串号防线：同 brand+line 内每个型号代码只能归属一台（owner = 最早发布）。
 * 返回移除次数（按 条目×冲突码 计）。
 */
export function dedupeModelCodeSerial(entries) {
  const FIELD = 'device.modelCodes';
  const groups = new Map();
  for (const e of entries) {
    if (e.op !== 'add-product') continue;
    const codes = e.product?.specs?.[FIELD];
    if (!Array.isArray(codes)) continue;
    for (const c of codes) {
      const key = e.product.brand + '||' + e.product.line + '||' + c;
      (groups.get(key) ?? groups.set(key, []).get(key)).push(e);
    }
  }
  let removed = 0;
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (a.product.releaseDate || '9999').localeCompare(b.product.releaseDate || '9999')
      || a.product.id.localeCompare(b.product.id));
    for (const e of arr.slice(1)) {
      const s = e.product.specs;
      if (!Array.isArray(s[FIELD])) continue; // 可能已被前一组删除
      s[FIELD] = s[FIELD].filter((c) => !arr[0].product.specs[FIELD]?.includes(c));
      if (!s[FIELD].length) {
        delete s[FIELD];
        if (e.product.provenance) delete e.product.provenance[FIELD];
      }
      removed++;
    }
  }
  return removed;
}

/**
 * 单位自愈：数值超出 schema range 且 ×10 落入 range → 按「cm 误标 mm」换算接受，
 * 否则返回 null（调用方丢弃该值）。macDB 老机型页有系统性 cm/mm 标注错误。
 */
export function rangeHeal(v, lo, hi) {
  if (v >= lo && v <= hi) return v;
  const fixed = v * 10;
  return fixed >= lo && fixed <= hi ? fixed : null;
}
