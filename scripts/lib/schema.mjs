/**
 * 品类 schema 加载与校验（全品类目录的字段定义源）。
 *
 * 定位
 * ----
 * data/categories.json 是品类注册表（id → schema 文件）；
 * data/schemas/<category>.json 是该品类的字段表（path/label/unit/type/range/dir/quantifiable）。
 * 本文件是这两份数据的**唯一读取入口**，管线（sync/validate）、派生（derive）、
 * 用户数据层（overrides）都从这里拿字段定义，不允许任何地方再手写一份字段清单。
 *
 * 它防的三种真实故障
 * ----------------
 * 1. **字段拼写漂移**：用户数据层写 `display.sizes`（不存在）→ 没有 schema 校验的话
 *    这个值会安静地写进 specs，前端永远不显示，用户以为改过了。
 * 2. **类型漂移**：TS 声明说 number，运行时进来字符串 "120" → 一排序就 NaN。
 *    schema 的 type 在这里当场拦。
 * 3. **品类悬空**：产品 category 指向不存在的品类 → 没有字段表可校验，
 *    参数表渲染直接崩。注册表闸门拦在写盘前。
 *
 * 全部纯函数 + 只读 IO，selftest 直接 import。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 模块级缓存：一次管线运行里 schema 只读一次盘 */
const categoryCache = new Map();
const schemaCache = new Map();

/** 品类注册表。缺文件时返回 null（调用方决定是报错还是走空目录） */
export function loadCategories() {
  if (categoryCache.has('__root__')) return categoryCache.get('__root__');
  const p = join(ROOT, 'data/categories.json');
  const value = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  categoryCache.set('__root__', value);
  return value;
}

/** 全部品类 id（注册表顺序）。无注册表时返回空数组 */
function categoryIds() {
  return (loadCategories()?.categories ?? []).map((c) => c.id);
}

/** 品类是否已注册 */
export function isRegisteredCategory(id) {
  return categoryIds().includes(id);
}

/** 取品类定义（id/label/schema）。未注册返回 undefined */
function categoryDef(id) {
  return (loadCategories()?.categories ?? []).find((c) => c.id === id);
}

/**
 * 加载某品类的字段 schema。未注册/文件缺失返回 null。
 * @param {string} categoryId 品类 id（如 'phone'）
 */
export function loadSchema(categoryId) {
  if (schemaCache.has(categoryId)) return schemaCache.get(categoryId);
  const def = categoryDef(categoryId);
  if (!def?.schema) {
    schemaCache.set(categoryId, null);
    return null;
  }
  const p = join(ROOT, 'data/schemas', `${def.schema}.json`);
  const value = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  schemaCache.set(categoryId, value);
  return value;
}

/** schema 的 path → 字段定义 映射 */
export function fieldMap(schema) {
  const m = new Map();
  for (const f of schema?.fields ?? []) m.set(f.path, f);
  return m;
}

/** 可量化字段（参与对比/排序/分位的数值字段），按 schema 声明顺序 */
export function quantifiableFields(schema) {
  return (schema?.fields ?? []).filter((f) => f.quantifiable === true);
}

/** 显式分组（借鉴准绳 groups 表：type=single|multi、guide）。按 schema 声明顺序 */
export function groupsOf(schema) {
  return schema?.groups ?? [];
}

/** 分组 id → 字段数组（按 schema 字段顺序）。未分组字段进 '__orphan__' */
export function fieldsByGroup(schema) {
  const byGroup = new Map();
  for (const g of groupsOf(schema)) byGroup.set(g.id, []);
  byGroup.set('__orphan__', []);
  for (const f of schema?.fields ?? []) {
    byGroup.get(f.group ?? '__orphan__')?.push(f);
  }
  return byGroup;
}

/**
 * 取值状态四态（借鉴准绳 value_status）：
 *   available       specs 有值            → 正常显示
 *   unknown         specs 缺该键          → 显示"—"（官方未公布）
 *   none            valueStatus[path]='none'   → 显示"无"（该机型确实没有此参数）
 *   not_applicable  valueStatus[path]=该值      → 显示"不适用"，跨品类时整行隐藏
 *
 * 注意键名：产品顶层的 `status`（'on-sale'/'discontinued'）是**生命周期状态**，
 * 与四态例外映射**完全不同**，所以四态例外映射单独用 `valueStatus` 这个键，
 * 避免和生命周期 status 撞名（撞名会导致闸门把生命周期字符串当映射遍历而误报）。
 * 设计：valueStatus 只存 none / not_applicable 两种例外，其余靠 specs 是否存在推导，
 * 避免给 62 台现有手机各塞 42 个 'available' 键。
 * @returns {'available'|'unknown'|'none'|'not_applicable'}
 */
/**
 * 某个 (产品, 字段) 是否有「真实可用值」。
 * specs 键存在但值为 null / undefined / 空数组，视为**没有**，因为本项目把
 * 「官方未公布」存成 specs 里的 null（如 iPhone 的 display.refreshHz=null、
 * memory.ramGb=[]）。若按「有键就算 available」，这些官方未公布的字段会
 * 被误判为已填，质量报告填充率虚高、前端把 null 渲染成空白而非「—」。
 * @returns {boolean}
 */
export function hasValue(product, path) {
  if (!product?.specs) return false;
  if (!Object.prototype.hasOwnProperty.call(product.specs, path)) return false;
  const v = product.specs[path];
  if (v === null || v === undefined) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

export function valueStatus(product, path) {
  const explicit = product?.valueStatus?.[path];
  if (explicit === 'not_applicable') return 'not_applicable';
  if (explicit === 'none') return 'none';
  if (hasValue(product, path)) return 'available';
  return 'unknown';
}

/** 合法 status 取值（产品侧只显式存这两个例外） */
export const STATUS_VALUES = Object.freeze(['none', 'not_applicable']);

/** 子字段表（多实例子字典，2026-10-13 最优解「两处结构升级」②）。field.cardinality==='list' 时存在 */
function subfieldsOf(field) {
  return field?.cardinality === 'list' ? (field.subfields ?? []) : null;
}

/** 子字段项的键 → 子字段定义映射（子 path 形如 'camera.rear.mp'，键 = 去父前缀的 'mp'） */
function subfieldMap(field) {
  const subs = subfieldsOf(field);
  const m = new Map();
  if (!subs || !field?.path) return m;
  const prefix = `${field.path}.`;
  for (const s of subs) {
    const key = s.path.startsWith(prefix) ? s.path.slice(prefix.length) : s.path;
    m.set(key, s);
  }
  return m;
}

/**
 * 校验 schema 自身结构（字段定义源不能错）。返回错误列表，空 = 合法。
 * 防的故障：分组 id 重复 / 字段引用了不存在的分组 / 字段缺 group /
 * 多实例子字典结构错误（cardinality=list 必须有 subfields、子 path 必须挂父 path 下、
 * 不允许嵌套子字典）。
 */
export function validateSchema(schema) {
  const errors = [];
  if (!schema) return ['schema 为空'];
  const ids = new Set();
  for (const g of schema.groups ?? []) {
    if (!g.id) errors.push(`分组缺 id`);
    else if (ids.has(g.id)) errors.push(`分组 id 重复：${g.id}`);
    else ids.add(g.id);
    if (g.type && !['single', 'multi'].includes(g.type)) errors.push(`分组 ${g.id} 的 type 非法：${g.type}`);
  }
  const KNOWN_TYPES = new Set([
    'number', 'string', 'boolean', 'enum', 'array:number', 'array:string', 'object', 'array:object',
  ]);
  const checkFieldShape = (f, at) => {
    if (f.type && !KNOWN_TYPES.has(f.type)) errors.push(`${at} 的 type 非法：${f.type}`);
    if (f.type === 'enum' && !Array.isArray(f.values)) errors.push(`${at} 是 enum 但缺 values`);
    if (f.cardinality && f.cardinality !== 'list') errors.push(`${at} 的 cardinality 只支持 'list'：${f.cardinality}`);
    if (f.cardinality === 'list') {
      if (f.type !== 'array:object') errors.push(`${at} 的 cardinality=list 只用于 array:object`);
      if (!Array.isArray(f.subfields) || f.subfields.length === 0)
        errors.push(`${at} 声明了 cardinality=list 但没有 subfields`);
      for (const s of f.subfields ?? []) {
        if (!s.path?.startsWith(`${f.path}.`))
          errors.push(`${at} 的子字段 "${s.path ?? '?'}" 未挂在父 path 下（应为 "${f.path}." 前缀）`);
        checkFieldShape(s, at);
        if (s.cardinality || s.subfields) errors.push(`${at} 的子字段不允许再嵌套子字典（一层深度）`);
        if (s.group) errors.push(`${at} 的子字段不应声明 group（归属随父字段）`);
      }
    } else if (f.subfields) {
      errors.push(`${at} 有 subfields 但未声明 cardinality:'list'`);
    }
  };
  for (const f of schema.fields ?? []) {
    if (!f.group) errors.push(`字段 ${f.path} 缺 group 归属`);
    else if (!ids.has(f.group)) errors.push(`字段 ${f.path} 的 group "${f.group}" 未在 groups 注册`);
    checkFieldShape(f, `字段 ${f.path}`);
  }
  return errors;
}

/**
 * 校验单个产品的 status 例外映射：
 *   1. 键必须是该品类 schema 已注册的字段（拼写漂移拦截）；
 *   2. 值必须是 STATUS_VALUES 之一（'none' / 'not_applicable'）。
 * 返回错误列表，空 = 合法。注意本函数读的是产品的 `valueStatus` 映射
 * （四态例外），不是顶层的生命周期 `status` 字段。
 */
export function validateStatusMap(product, schema) {
  const errors = [];
  if (!schema) return errors;
  const fields = fieldMap(schema);
  const status = product?.valueStatus ?? {};
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    errors.push(`${product?.id ?? '?'} 的 valueStatus 必须是对象映射`);
    return errors;
  }
  for (const [path, val] of Object.entries(status)) {
    if (!fields.has(path)) {
      errors.push(`${product?.id ?? '?'} 的 valueStatus 键 "${path}" 未在品类 "${schema.id}" 注册`);
      continue;
    }
    if (!STATUS_VALUES.includes(val)) {
      errors.push(`${product?.id ?? '?'} 的 valueStatus["${path}"]=${JSON.stringify(val)} 非法，只能是 ${STATUS_VALUES.join(' / ')}`);
    }
  }
  return errors;
}

/**
 * 校验单个 spec 值。返回 null 表示合法，否则返回人话错误原因。
 *
 * null/undefined 恒合法——「官方未公布」是本项目的正确状态，不是缺失。
 * @param {object} field schema 字段定义
 * @param {unknown} value specs 里的值
 * @param {string} where 出错时前缀（产品 id 或 override id）
 */
export function validateSpecValue(field, value, where) {
  if (value === null || value === undefined) return null;
  const at = `${where} 的 ${field.path}`;
  switch (field.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value))
        return `${at} 应为数值，收到 ${JSON.stringify(value)}`;
      if (Array.isArray(field.range) && (value < field.range[0] || value > field.range[1]))
        return `${at} = ${value} 超出合理区间 ${field.range[0]}–${field.range[1]}${field.unit ? ` ${field.unit}` : ''}`;
      return null;
    case 'string':
      if (typeof value !== 'string') return `${at} 应为字符串，收到 ${JSON.stringify(value)}`;
      return null;
    case 'boolean':
      if (typeof value !== 'boolean') return `${at} 应为布尔值，收到 ${JSON.stringify(value)}`;
      return null;
    case 'enum':
      if (!field.values?.includes(value))
        return `${at} = ${JSON.stringify(value)} 不在枚举 ${JSON.stringify(field.values ?? [])} 内`;
      return null;
    case 'array:number':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'number' || !Number.isFinite(v)))
        return `${at} 应为数值数组，收到 ${JSON.stringify(value)}`;
      return null;
    case 'array:string':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
        return `${at} 应为字符串数组，收到 ${JSON.stringify(value)}`;
      return null;
    case 'array:object':
      if (!Array.isArray(value) || value.some((v) => !v || typeof v !== 'object' || Array.isArray(v)))
        return `${at} 应为对象数组，收到 ${JSON.stringify(value)}`;
      // 多实例子字典：cardinality=list 的字段对**每一项**做子字段深校验（2026-10-13 最优解②）。
      // 此前 array:object 不做深校验——镜头 mp 填 999 / role 拼错 / 多余键都能静默落盘。
      if (subfieldsOf(field)) {
        const errs = [];
        value.forEach((item, i) => {
          errs.push(...validateListField(field, item, `${at}#${i + 1}`));
        });
        return errs.length ? errs.join('；') : null;
      }
      return null;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return `${at} 应为对象，收到 ${JSON.stringify(value)}`;
      return null;
    default:
      return `${at} 的 schema type "${field.type}" 未实现校验（schema 自身写错了）`;
  }
}

/**
 * 校验多实例列表的**单条项**（cardinality=list 的子字典深校验）。
 * 规则：项内键必须在子字段注册（多余键拦——防「静默落盘没人读」）；
 * 已注册子键逐个走 validateSpecValue（子项缺键 = null 语义，合法——官网常只公布部分）。
 */
function validateListField(field, item, at) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return [`${at} 应为对象，收到 ${JSON.stringify(item)}`];
  }
  const errors = [];
  const subs = subfieldMap(field);
  for (const [key, val] of Object.entries(item)) {
    const sub = subs.get(key);
    if (!sub) {
      errors.push(`${at} 的键 "${key}" 未在 ${field.path} 的子字典注册（多余键会静默落盘没人读）`);
      continue;
    }
    const err = validateSpecValue(sub, val, at);
    if (err) errors.push(err);
  }
  return errors;
}

/**
 * 校验整机 specs。两类错误：
 *   1. specs 里出现 schema 未注册的键（拍平漏组 / 用户层拼错字段名）；
 *   2. 已注册字段的值类型/区间/enum 不合法（cardinality=list 的字段对每项做子字典深校验）。
 * @returns {string[]} 错误列表，空数组表示合法
 */
export function validateSpecs(product, schema) {
  const errors = [];
  if (!schema) return errors; // 无 schema 的品类（未建设的音频等）不阻塞写入
  const fields = fieldMap(schema);
  const specs = product?.specs ?? {};
  for (const [path, value] of Object.entries(specs)) {
    const field = fields.get(path);
    if (!field) {
      errors.push(
        `${product?.id ?? '?'} 的 specs 键 "${path}" 未在品类 "${schema.id}" 的 schema 注册` +
          `（疑似拍平漏组或字段名拼错）`,
      );
      continue;
    }
    const err = validateSpecValue(field, value, product?.id ?? '?');
    if (err) errors.push(err);
  }
  return errors;
}
