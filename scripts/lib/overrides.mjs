/**
 * 用户手动数据层：解析、校验、应用 data/overrides.json。
 *
 * 为什么单独一层，而不是直接改 products.json
 * ----------------------------------------
 * products.json 是管线每次同步**重新生成**的。用户直接改它，下一轮官网同步就被覆盖回去，
 * 而且「哪个值是官网的、哪个值是用户改的」在字节层面再也分不出来。
 * 独立成层后：官网数据照常刷新，用户数据每次同步时重新应用，两边互不覆盖，
 * provenance 里 'user-manual' 标明这个字段被用户修正过。
 *
 * 纪律（每条对应一个真实故障）
 * ---------------------------
 * 1. **管线只读不写本文件**。它是纯人工输入，任何运行时刻字段都不该进来——
 *    否则 CI 每 12 小时制造一次空提交（与 discovery-pending.json 同理）。
 * 2. **写错必须显性失败**。override 引用不存在的机型、字段路径没在 schema 注册、
 *    值类型/区间不合法——全部进闸门 failures，拒绝写盘。静默跳过的后果是
 *    用户以为改好了，页面上纹丝不动。
 * 3. **软删除不留坑**。active=false 的条目不应用但保留记录（审计留痕）；
 *    同目标多条生效时后者赢，并在 report 里显式记 conflict。
 * 4. **抹除操作要可见**。把有值字段改成 null（「官网根本没这个」）允许，但
 *    report 里以 erased 标记——删真实数据必须被看见。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidBrand } from '../brands.mjs';
import { fieldMap, isRegisteredCategory, loadSchema, validateSpecValue } from './schema.mjs';
import { pick, setSpec } from './specs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OVERRIDES_FILE = join(ROOT, 'data/overrides.json');

/** 读入用户数据层。文件不存在 = 没有用户数据，返回空层（不是错误） */
export function loadOverrides(file = OVERRIDES_FILE) {
  if (!existsSync(file)) return { version: 0, entries: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return { version: parsed.version ?? 0, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
}

/** 条目 id → 条目。重复 id 是文件级错误，调用方负责报 */
function indexById(entries) {
  const m = new Map();
  for (const e of entries) {
    if (m.has(e.id)) m.get(e.id).push(e);
    else m.set(e.id, [e]);
  }
  return m;
}

/**
 * 校验用户数据层。返回错误列表（空 = 合法）。
 * 与 applyOverrides 分开：validate 先跑，全过才允许应用——「先校验后应用」
 * 避免应用了一半才发现后面的条目是坏的。
 *
 * @param {{entries: object[]}} overrides
 * @param {Array<object>} products 参照集合（官网侧产品，或已合并用户层的全集）
 * @param {{excludeIds?: string[]}} [options]
 *   excludeIds：这些 id 是用户数据层**自己** add-product 加进来的（已并入 products），
 *   add-product 的冲突检查必须排除它们——否则「自己冲突自己」永远误报
 *   （validate.mjs 二次校验时 products 已含新增机型，踩过）。
 */
export function validateOverrides(overrides, products, options = {}) {
  const errors = [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const exclude = new Set(options.excludeIds ?? []);
  const seenIds = new Set();

  for (const e of overrides.entries ?? []) {
    if (!e.id || typeof e.id !== 'string') {
      errors.push(`override 条目缺 id：${JSON.stringify(e).slice(0, 80)}`);
      continue;
    }
    if (seenIds.has(e.id)) errors.push(`override id 重复：${e.id}`);
    seenIds.add(e.id);

    if (e.op !== 'set-field' && e.op !== 'add-product') {
      errors.push(`${e.id} 的 op 只能是 set-field / add-product，收到 ${JSON.stringify(e.op)}`);
      continue;
    }
    if (!e.reason || typeof e.reason !== 'string' || !e.reason.trim()) {
      errors.push(`${e.id} 缺 reason（为什么改这条数据，必填）`);
    }
    if (!e.createdAt || Number.isNaN(Date.parse(e.createdAt))) {
      errors.push(`${e.id} 的 createdAt 不是合法日期：${JSON.stringify(e.createdAt)}`);
    }
    if (e.active !== undefined && typeof e.active !== 'boolean') {
      errors.push(`${e.id} 的 active 应为布尔值`);
    }

    if (e.op === 'set-field') {
      const target = byId.get(e.productId);
      if (!target) {
        errors.push(`${e.id} 引用的机型不存在：${e.productId}（add-product 不受此限）`);
        continue;
      }
      const schema = loadSchema(target.category);
      const field = schema ? fieldMap(schema).get(e.field) : undefined;
      if (!schema) {
        errors.push(`${e.id} 的机型品类 "${target.category}" 没有 schema，无法校验字段`);
        continue;
      }
      if (!field) {
        errors.push(
          `${e.id} 的字段 "${e.field}" 未在品类 "${target.category}" 的 schema 注册` +
            `（疑似拼错；可用字段见 data/schemas/${target.category}.json）`,
        );
        continue;
      }
      const err = validateSpecValue(field, e.value, `${e.id}(${e.productId})`);
      if (err) errors.push(err);
    }

    if (e.op === 'add-product') {
      const p = e.product;
      if (!p || typeof p !== 'object') {
        errors.push(`${e.id} 的 add-product 缺 product 对象`);
        continue;
      }
      if (!p.id || typeof p.id !== 'string') errors.push(`${e.id} 的 product 缺 id`);
      else if (byId.has(p.id) && !exclude.has(p.id))
        errors.push(`${e.id} 新增的机型 id 与现有产品冲突：${p.id}`);
      if (!isValidBrand(p.brand)) errors.push(`${e.id} 的品牌不在注册表：${JSON.stringify(p.brand)}`);
      if (!isRegisteredCategory(p.category))
        errors.push(`${e.id} 的品类未注册：${JSON.stringify(p.category)}`);
      const schema = loadSchema(p.category);
      if (schema) {
        // specs 逐键过 schema：未注册键 / 类型 / 区间
        const fields = fieldMap(schema);
        for (const [path, value] of Object.entries(p.specs ?? {})) {
          const field = fields.get(path);
          if (!field) {
            errors.push(`${e.id} 的 specs 键 "${path}" 未在品类 "${p.category}" 的 schema 注册`);
            continue;
          }
          const err = validateSpecValue(field, value, `${e.id}(${p.id})`);
          if (err) errors.push(err);
        }
      }
      if (p.releaseDate && Number.isNaN(Date.parse(p.releaseDate))) {
        errors.push(`${e.id} 的 releaseDate 无法解析：${p.releaseDate}`);
      }
    }
  }
  return errors;
}

/**
 * 应用用户数据层。返回 { products, report }——products 是新数组（原数组不改）。
 *
 * report 形状（写进 _work/sync-report.json 供回查）：
 *   applied:  [{ id, op, productId, field, value }]        实际生效的条目
 *   replaced: [{ id, productId, field, from, to }]         被覆盖的官网原值
 *   erased:   [{ id, productId, field, from }]             有值被抹成 null 的操作
 *   added:    [{ id, productId }]                          整机新增
 *   skipped:  [{ id, reason }]                             未生效（软删除等）
 *   conflicts:[{ productId, field, winner, losers }]       同目标多条，后者赢
 */
export function applyOverrides(products, overrides) {
  const report = { applied: [], replaced: [], erased: [], added: [], skipped: [], conflicts: [] };
  const out = products.map((p) => ({ ...p, specs: { ...(p.specs ?? {}) }, provenance: { ...(p.provenance ?? {}) } }));
  const byId = new Map(out.map((p) => [p.id, p]));

  // 按 (createdAt, id) 升序：同目标多条时后应用的赢，结果确定可复现
  const entries = [...(overrides.entries ?? [])]
    .filter((e) => e && typeof e === 'object')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));

  // 同 (productId, field) 的多条 active 条目：记录冲突，最后一条赢
  const winners = new Map();
  for (const e of entries) {
    if (e.active === false) continue;
    if (e.op !== 'set-field') continue;
    winners.set(`${e.productId}::${e.field}`, e.id);
  }

  for (const e of entries) {
    if (e.active === false) {
      report.skipped.push({ id: e.id, reason: 'active=false（软删除，留痕不生效）' });
      continue;
    }
    if (e.op === 'set-field') {
      const target = byId.get(e.productId);
      if (!target) {
        report.skipped.push({ id: e.id, reason: `机型不存在：${e.productId}` });
        continue;
      }
      const before = pick(target, e.field);
      setSpec(target, e.field, e.value);
      target.provenance[e.field] = 'user-manual';
      report.applied.push({ id: e.id, op: 'set-field', productId: e.productId, field: e.field, value: e.value });
      if (before !== undefined && before !== null) {
        report.replaced.push({ id: e.id, productId: e.productId, field: e.field, from: before, to: e.value });
      }
      if (before !== undefined && before !== null && e.value === null) {
        report.erased.push({ id: e.id, productId: e.productId, field: e.field, from: before });
      }
      const winner = winners.get(`${e.productId}::${e.field}`);
      if (winner && winner !== e.id) {
        report.conflicts.push({
          productId: e.productId,
          field: e.field,
          winner,
          losers: [e.id],
          note: '同一字段多条覆盖，createdAt 在后者生效',
        });
      }
      continue;
    }
    if (e.op === 'add-product') {
      const p = e.product;
      // 身份字段兜底：用户新增的机型也必须是完整契约形状
      const added = {
        ...p,
        category: p.category,
        status: p.status ?? 'on-sale',
        releaseDatePrecision: p.releaseDatePrecision ?? 'day',
        granularity: p.granularity ?? 'manual',
        specs: { ...(p.specs ?? {}) },
        skus: Array.isArray(p.skus) ? p.skus : [],
        scores: Array.isArray(p.scores) ? p.scores : [],
        // provenance：specs 全键 + releaseDate 有值时都要标 user-manual。
        // 「有值但缺 provenance」是字段级硬闸门（validate 第 10 条），漏一个键就拒写。
        provenance: Object.fromEntries(
          Object.entries({
            ...(p.provenance ?? {}),
            ...Object.fromEntries(Object.keys(p.specs ?? {}).map((k) => [k, 'user-manual'])),
            ...(p.releaseDate ? { releaseDate: 'user-manual' } : {}),
          }),
        ),
      };
      out.push(added);
      byId.set(added.id, added);
      report.added.push({ id: e.id, productId: added.id });
      report.applied.push({ id: e.id, op: 'add-product', productId: added.id, field: null, value: null });
    }
  }

  return { products: out, report };
}
