import phoneSchemaJson from '../../data/schemas/phone.json' with { type: 'json' };
import phoneViewJson from '../../data/view-phone.json' with { type: 'json' };
import type { Product } from '../types';

/**
 * 参数表渲染引擎（2026-10-13 硬编码审计 A1/B1 治理 + SCHEMA-EXTENSIBILITY 最优解落地）。
 *
 * 此前本文件是「手写策展行」：详情页 SpecTable 与对比矩阵的每一行都硬编码在这里，
 * schema 加字段不会自动出现在页面上（靠渲染对账闸门大声拦截，但仍要手工同步）。
 * 现在改为「**全声明式字典 + 泛化引擎**」：
 *   - 数据语义在 `data/schemas/phone.json`（有什么参数/类型/区间/单位）；
 *   - 展示语义在 `data/view-phone.json`（组标题/行序/合并/格式化器/hidden 豁免）；
 *   - 引擎只认识字典，不认识任何具体字段——**schema 加一行，页面自动出现**
 *     （未引用且未 hidden 的字段自动按其 schema 分组追加，新分组自动建组）；
 *   - selftest「渲染对账」双向看守：schema 字段要么被视图引用要么在 hidden；
 *     视图引用的 path 必须已在 schema 注册（防拼错）。
 *
 * 取值走**扁平 specs 容器**（path 直读），与品类无关——未来新品类的参数表直接换字典复用引擎。
 * 保留 `refreshHzNumber()`（string 型刷新率的序类适配器，榜单/排序用）。
 */

// ── 字典类型（宽松结构，真身是 JSON）──

interface SchemaFieldJson {
  path: string;
  label: string;
  unit?: string | null;
  type: string;
  group: string;
  /** 参数级筛选声明：true = 该字段自动成为一个筛选维度（相等类引擎，任意类型） */
  facet?: boolean;
  /** 序类适配器声明：string 型字段参与排序时的「取代表值」实现名（注册表见本文件底部） */
  orderDeriver?: string;
}
interface SchemaJson {
  groups?: Array<{ id: string; name: string }>;
  fields: SchemaFieldJson[];
}
interface ViewRow {
  label?: string;
  field?: string;
  fields?: string[];
  expand?: string;
  format?: string;
}
interface ViewGroup {
  id: string;
  title: string;
  /** 一个视图组可吞并多个 schema 分组（如「芯片与存储」= chipset + memory） */
  matchGroups?: string[];
  rows: ViewRow[];
}
interface ViewDict {
  groups: ViewGroup[];
  /** 有意不进详情页/对比表的字段（显性化豁免；删掉即自动显示） */
  hidden?: string[];
}

/** 手机 schema 导出（供筛选分面等相等类引擎消费；数据语义真源仍是 data/schemas/phone.json） */
export const PHONE_SCHEMA = phoneSchemaJson as unknown as SchemaJson;
const PHONE_VIEW = phoneViewJson as unknown as ViewDict;

export interface SpecRow {
  label: string;
  value: string;
}
export interface SpecGroup {
  title: string;
  rows: SpecRow[];
}

const dash = (x: unknown): string => (x == null || x === '' ? '—' : String(x));

/** 缺省格式化：按 schema 的 type + unit 通用渲染（新字段的默认展示形态） */
function defaultFormat(field: SchemaFieldJson | undefined, v: unknown): string {
  if (v == null || v === '') return '—';
  const unit = field?.unit ? ` ${field.unit}` : '';
  switch (field?.type) {
    case 'number':
      return typeof v === 'number' ? `${v}${unit}` : dash(v);
    case 'boolean':
      return v === true ? '是' : v === false ? '否' : dash(v);
    case 'array:number':
      return Array.isArray(v) && v.length ? `${v.join(' / ')}${unit}` : '—';
    case 'array:string':
      return Array.isArray(v) && v.length ? v.join('、') : '—';
    case 'object':
    case 'array:object':
      return typeof v === 'object' ? JSON.stringify(v) : dash(v);
    default:
      return dash(v); // string / enum：官网原文，不加工
  }
}

/** 单值 + 单位（string 型字段要带 schema 单位时用，如刷新率 `1-120 Hz`） */
function unitFormat(values: unknown[], fields: SchemaFieldJson[]): string {
  const v = values[0];
  if (v == null || v === '') return '—';
  return `${String(v)}${fields[0]?.unit ? ` ${fields[0].unit}` : ''}`;
}

/**
 * 展示格式化器注册表：**封闭可加**——视图字典用名字引用，新格式化器只在引擎里加实现。
 * 每个都是「展示语义」的落点（合并行/特殊口径），普通字段不需要。
 */
const FORMATTERS: Record<string, (args: { values: unknown[]; fields: SchemaFieldJson[] }) => string> = {
  plain: ({ values }) => dash(values[0]),
  unit: unitFormat,
  dimensions: ({ values }) => {
    const nums = values.filter((v): v is number => typeof v === 'number');
    return nums.length ? `${nums.join('×')} mm` : '—';
  },
  resolution: ({ values }) => {
    const v = values[0] as { w?: number; h?: number } | null | undefined;
    return v && typeof v.w === 'number' && typeof v.h === 'number' ? `${v.w}×${v.h}` : '—';
  },
  brightness: ({ values }) => {
    const [t, p] = values;
    if (typeof p === 'number') return `典型 ${dash(t)} / 峰值 ${p} nits`;
    if (typeof t === 'number') return `典型 ${t} nits`;
    return '—';
  },
  videoHours: ({ values }) => (typeof values[0] === 'number' ? `${values[0]} 小时（视频）` : '—'),
};

/** 后置相机展开：每颗镜头一行（官网按角色分列的忠实呈现） */
const CAMERA_ROLES: Array<{ role: string; label: string }> = [
  { role: 'main', label: '主摄' },
  { role: 'ultrawide', label: '超广角' },
  { role: 'tele', label: '长焦' },
  { role: 'periscope', label: '潜望长焦' },
];

function cameraRoleRows(path: string, specs: Record<string, unknown> | null | undefined): SpecRow[] {
  const rear = (specs?.[path] ?? []) as Array<{
    role?: string;
    mp?: number | null;
    aperture?: string | null;
    ois?: boolean | null;
  }>;
  return CAMERA_ROLES.map(({ role, label }) => {
    const c = rear.find((x) => x?.role === role);
    const bits = c
      ? [c.mp != null ? `${c.mp} MP` : null, c.aperture, c.ois ? 'OIS' : null].filter(Boolean)
      : [];
    return { label, value: bits.length ? bits.join(' · ') : '—' };
  });
}

/**
 * 泛化引擎：schema + 视图字典 + 扁平 specs → 分组参数行。
 * 通用到与品类无关（新品类换字典复用）；不认识任何具体字段。
 */
export function buildSpecGroups(
  schema: SchemaJson,
  view: ViewDict,
  specs: Record<string, unknown> | null | undefined,
): SpecGroup[] {
  const fieldByPath = new Map(schema.fields.map((f) => [f.path, f]));
  const referenced = new Set<string>();
  const out: Array<SpecGroup & { id: string }> = [];

  for (const g of view.groups) {
    const rows: SpecRow[] = [];
    for (const r of g.rows) {
      if (r.expand) {
        referenced.add(r.expand);
        if (r.format === 'cameraRole') rows.push(...cameraRoleRows(r.expand, specs));
        else rows.push({ label: r.label ?? r.expand, value: dash(specs?.[r.expand]) });
        continue;
      }
      const paths = r.fields ?? (r.field ? [r.field] : []);
      for (const p of paths) referenced.add(p);
      const fields = paths.map((p) => fieldByPath.get(p)).filter(Boolean) as SchemaFieldJson[];
      const values = paths.map((p) => specs?.[p]);
      const fmt = r.format ? FORMATTERS[r.format] : undefined;
      const value = fmt
        ? fmt({ values, fields })
        : paths.length === 1
          ? defaultFormat(fields[0], values[0])
          : values.map((v, i) => defaultFormat(fields[i], v)).join(' / ');
      rows.push({ label: r.label ?? paths.join('+'), value });
    }
    out.push({ id: g.id, title: g.title, rows });
  }

  // ── 自动补挂（最优解核心）：schema 有、视图没引用、也没 hidden 的字段 → 自动出现在页面上。
  // 定位：字段的 schema.group → 视图组（matchGroups 支持吞并组）；无匹配视图组 → 按 schema
  // 分组名新建组放最后。这就是「发现新可量化参数 → schema 加一行 → 页面自动出现」。
  const hidden = new Set(view.hidden ?? []);
  const bySchemaGroup = new Map<string, ViewGroup>();
  for (const g of view.groups) for (const gid of g.matchGroups ?? [g.id]) bySchemaGroup.set(gid, g);
  const extra = new Map<string, SpecRow[]>();
  for (const f of schema.fields) {
    if (referenced.has(f.path) || hidden.has(f.path)) continue;
    const row: SpecRow = { label: f.label, value: defaultFormat(f, specs?.[f.path]) };
    const target = bySchemaGroup.get(f.group);
    const key = target ? target.id : (schema.groups?.find((sg) => sg.id === f.group)?.name ?? f.group);
    if (!extra.has(key)) extra.set(key, []);
    extra.get(key)!.push(row);
  }
  for (const [key, rows] of extra) {
    const g = out.find((x) => x.id === key) ?? out.find((x) => x.title === key);
    if (g) g.rows.push(...rows);
    else out.push({ id: key, title: key, rows });
  }

  return out.map(({ title, rows }) => ({ title, rows })); // 内部 id 不外泄
}

/** 详情页/对比表共用入口（签名不变，消费方零改动） */
export function specGroups(p: Product): SpecGroup[] {
  return buildSpecGroups(PHONE_SCHEMA, PHONE_VIEW, p.specs);
}

/**
 * 参数级筛选声明（最优解「两处结构升级」之外的相等类泛化）：
 * schema 里 `facet:true` 的字段自动成为一个筛选维度——筛 NFC、筛刷新率档不再需要改代码。
 * 分值 = 结构相等判断（boolean→'true'/'false'，string 原文），与对比引擎同一纪律。
 */
export function facetFields(schema: SchemaJson = PHONE_SCHEMA): SchemaFieldJson[] {
  return schema.fields.filter((f) => f.facet === true);
}

/**
 * 序类适配器注册表（最优解「序类引擎显式声明制」的最小闭环）：
 * schema 用 `orderDeriver: <名字>` 声明 string 型字段的「取代表值」实现，
 * 实现集中在这里（封闭可加）。selftest 对账：声明了的名字必须在注册表里，防拼错游离。
 * 消费端（榜单/SORTS 泛化）接线留待序类引擎下次迭代——声明已就位。
 */
const ORDER_DERIVERS: Record<string, (v: unknown) => number | null> = {
  refreshHzNumber: (v) => refreshHzNumber(v as string | number | null | undefined),
};

export function orderDeriverFor(path: string): ((v: unknown) => number | null) | null {
  const f = PHONE_SCHEMA.fields.find((x) => x.path === path);
  const name = f?.orderDeriver;
  return name ? (ORDER_DERIVERS[name] ?? null) : null;
}

/**
 * 把 `display.refreshHz` 归一为**单个数值代表值**，供排序 / 比较 / 归一化横条使用。
 *
 * 为什么要这个：`refreshHz` 真实数据是 `1-120`（可变量程）、`120`、`60/90`（多档）这类
 * **字符串**（见 schema 的 refreshHz note）。直接把它当 number 做算术会字符串拼接成
 * `"1201"`、求平均得 `NaN`——这是本项目踩过的类型漂移坑。
 *
 * 口径（**这是展示/排序用的代表值，不是「真实刷新率」**，页面上仍显示官网原文）：
 * - `120` → 120；`1-120` → 120（取上界，可变量程的峰值）；`60/90` → 90（取多档最高档）。
 * - 纯数字字符串同样解析。
 * - 无法解析出数字时返回 `null`（**不返回 0**：0 与「未公布」在语义上完全不同）。
 */
export function refreshHzNumber(hz: string | number | null | undefined): number | null {
  if (hz == null) return null;
  if (typeof hz === 'number') return Number.isFinite(hz) ? hz : null;
  // 抓字符串里的所有数字，取最大者：`1-120`→120、`60/90`→90、`120`→120
  const nums = hz.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const max = Math.max(...nums.map(Number));
  return Number.isFinite(max) ? max : null;
}
