/**
 * 一次性清洗（2026-10-16）：批量补录层（data/overrides.json）的身份串号事故。
 *
 * 事故形态：2026-10-15 的多批 add-product 把同一套身份/硬件字段复制到了整条
 * 产品线 —— iMac 25 台共用 "iMac,1"/M4984/ATI Rage IIc/CD-ROM/3.6V 电池、
 * iPad mini 7 台共用 iPad1,1、AirPods Max 2 整条沿用 1 代。
 *
 * 清洗口径（宁可空，不可错）：
 *   1. 对可疑键集 K，同一个值在同 brand+line 内出现 ≥2 次时，只在**最旧**的一台
 *      上保留（presumptive true owner，如 imac-g3-1998 的 ATI Rage IIc/Pro 是真数据），
 *      其余全部清空并回退 provenance。
 *   2. identifier 不符合 Apple 内部标识形态（Name,N）的一律清空；
 *      modelCodes 里的非 A####/M#### 项一律剔除。
 *   3. retiredAt 早于 releaseDate → 清 null（时间线倒挂，取证后重录）。
 *   4. 天级精度压在 01-01 → 降级为 year（年份推测不得声明天级精度）。
 *   5. AirPods Max 2 的 line 修正为 AirPods Max。
 *
 * 只动 op === 'add-product' 的用户补录层；解析层产品的同类问题走原始数据修复。
 * 脚本可重复执行（幂等）：清过的值不再满足重复/畸形条件。
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const FILE = new URL('../../data/overrides.json', import.meta.url);
const backup = new URL('../../_work/overrides.pre-identity-cleanup.json', import.meta.url);
const o = JSON.parse(readFileSync(FILE, 'utf8'));

const SUSPECT_KEYS = [
  'device.identifier',
  'device.modelCodes',
  'device.modelVariants',
  'chipset.gpu',
  'memory.opticalDrive',
  'battery.backup',
  'power.adapterW',
];
const IDENT_RE = /^[A-Za-z][A-Za-z0-9]*,\d+$/;
const CODE_RE = /^[A-Z]\d{3,6}$/;

const addProducts = o.entries.filter((e) => e.op === 'add-product' && e.product);
const stats = { cleared: 0, provDropped: 0, lineFixed: 0, retiredNulled: 0, precisionDowngraded: 0 };

// —— 规则 1：同 group 内重复值 → 只保留最旧一台（显式三重循环，定位到具体字段） ——
const groups = new Map(); // `${brand}|${line}` → entries
for (const e of addProducts) {
  const k = `${e.product.brand ?? ''}|${e.product.line ?? ''}`;
  (groups.get(k) ?? groups.set(k, []).get(k)).push(e);
}

function clearField(e, key) {
  const specs = e.product.specs ?? {};
  const prov = e.product.provenance ?? {};
  if (key in specs && specs[key] !== null) {
    specs[key] = null;
    stats.cleared++;
  }
  if (key in prov && prov[key]) {
    delete prov[key];
    stats.provDropped++;
  }
}

for (const [group, es] of groups) {
  for (const key of SUSPECT_KEYS) {
    const byValue = new Map();
    for (const e of es) {
      const v = e.product.specs?.[key];
      if (v === null || v === undefined || v === '') continue;
      const vk = JSON.stringify(v);
      (byValue.get(vk) ?? byValue.set(vk, []).get(vk)).push(e);
    }
    for (const [, dup] of byValue) {
      if (dup.length < 2) continue;
      const sorted = [...dup].sort((a, b) => {
        const da = a.product.releaseDate ?? '';
        const db = b.product.releaseDate ?? '';
        return da < db ? -1 : da > db ? 1 : a.product.id < b.product.id ? -1 : 1;
      });
      for (const e of sorted.slice(1)) clearField(e, key);
    }
  }
}

// —— 规则 1b：modelCodes 数组**元素级**去重（同一 code 出现在同 group 多台机上，
//    整值比对查不出：AirPods 2 的 A1602 混在 ["A1602","A1938",…] 里与 1 代重复）。
//    元素只保留最旧一台，从其余机的数组里剔除；剔空则整键清空。
for (const [, es] of groups) {
  const key = 'device.modelCodes';
  const byCode = new Map(); // code → [{e, date, id}]
  for (const e of es) {
    const codes = e.product.specs?.[key];
    if (!Array.isArray(codes)) continue;
    for (const c of codes) {
      if (typeof c !== 'string' || c === '') continue;
      const list = byCode.get(c) ?? [];
      list.push({ e, date: e.product.releaseDate ?? '', id: e.product.id });
      byCode.set(c, list);
    }
  }
  for (const [code, list] of byCode) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
    );
    for (const { e } of sorted.slice(1)) {
      const specs = e.product.specs ?? {};
      const prov = e.product.provenance ?? {};
      specs[key] = (specs[key] ?? []).filter((c) => c !== code);
      if (specs[key].length === 0) {
        specs[key] = null;
        delete prov[key];
        stats.provDropped++;
      }
      stats.cleared++;
    }
  }
}

// —— 规则 2：畸形 identifier / modelCodes ——
for (const e of addProducts) {
  const specs = e.product.specs ?? {};
  const prov = e.product.provenance ?? {};
  const ident = specs['device.identifier'];
  if (ident !== null && ident !== undefined && ident !== '' && !IDENT_RE.test(String(ident))) {
    clearField(e, 'device.identifier');
  }
  const codes = specs['device.modelCodes'];
  if (Array.isArray(codes)) {
    const ok = codes.filter((c) => typeof c === 'string' && CODE_RE.test(c));
    if (ok.length !== codes.length) {
      if (ok.length === 0) clearField(e, 'device.modelCodes');
      else {
        specs['device.modelCodes'] = ok;
        if (!String(prov['device.modelCodes'] ?? '').includes('已剔除')) {
          prov['device.modelCodes'] = (prov['device.modelCodes'] ?? 'user-manual') + '（已剔除非法型号代码）';
        }
      }
    }
  }
  // modelVariants 是 modelCodes/identifier 的派生副本：身份键被清过就一并清空
  const variants = specs['device.modelVariants'];
  if (variants !== undefined && (specs['device.identifier'] === null || specs['device.modelCodes'] === null)) {
    clearField(e, 'device.modelVariants');
  }
}

// —— 规则 3：时间线倒挂 ——
for (const e of addProducts) {
  const p = e.product;
  if (p.releaseDate && p.retiredAt) {
    const r = Date.parse(p.releaseDate);
    const t = Date.parse(p.retiredAt);
    if (!Number.isNaN(r) && !Number.isNaN(t) && t < r) {
      p.retiredAt = null;
      stats.retiredNulled++;
    }
  }
}

// —— 规则 4：假精度降级 ——
for (const e of addProducts) {
  const p = e.product;
  if (p.releaseDatePrecision === 'day' && /^\d{4}-01-01$/.test(p.releaseDate ?? '')) {
    p.releaseDatePrecision = 'year';
    if (p.provenance?.releaseDate) {
      p.provenance.releaseDate = `${p.provenance.releaseDate}（仅知年份，日期为占位）`;
    }
    stats.precisionDowngraded++;
  }
}

// —— 规则 5：AirPods Max 2 的 line ——
for (const e of addProducts) {
  if (e.product.id === 'apple-airpods-max-2' && e.product.line !== 'AirPods Max') {
    e.product.line = 'AirPods Max';
    stats.lineFixed++;
  }
}

import { mkdirSync } from 'node:fs';
mkdirSync(new URL('../../_work/', import.meta.url), { recursive: true });
copyFileSync(FILE, backup);
writeFileSync(FILE, JSON.stringify(o, null, 2) + '\n');
console.log('清洗完成：', JSON.stringify(stats));
console.log('备份：_work/overrides.pre-identity-cleanup.json');
