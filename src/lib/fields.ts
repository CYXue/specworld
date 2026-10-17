import audioSchemaJson from '../../data/schemas/audio.json' with { type: 'json' };
import desktopSchemaJson from '../../data/schemas/desktop.json' with { type: 'json' };
import laptopSchemaJson from '../../data/schemas/laptop.json' with { type: 'json' };
import phoneSchemaJson from '../../data/schemas/phone.json' with { type: 'json' };
import tabletSchemaJson from '../../data/schemas/tablet.json' with { type: 'json' };
import wearableSchemaJson from '../../data/schemas/wearable.json' with { type: 'json' };
import phoneViewJson from '../../data/view-phone.json' with { type: 'json' };
import { classifyMissing, isNonePlaceholder, toSpecRowState } from '../../scripts/lib/missing-state.mjs';
import { i18n, currentLocale, pickLocale } from '../i18n';
import type { Product } from '../types';
import { categoryOf } from './catalog';
import { localizeSpecValue } from './glossary';

/** 展示文案助手：语言只从全局来（口径见 `src/i18n/index.ts` 的 `currentLocale`） */
const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {});

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
  /** 英文标签。**与 label 成对存在**（selftest 的 i18n 对账闸门强制，缺一即红灯） */
  labelEn?: string;
  unit?: string | null;
  unitEn?: string | null;
  type: string;
  group: string;
  /** 参数级筛选声明：true = 该字段自动成为一个筛选维度（相等类引擎，任意类型） */
  facet?: boolean;
  /** 序类适配器声明：string 型字段参与排序时的「取代表值」实现名（注册表见本文件底部） */
  orderDeriver?: string;
}
interface SchemaJson {
  groups?: Array<{ id: string; name: string; nameEn?: string }>;
  fields: SchemaFieldJson[];
}
interface ViewRow {
  label?: string;
  labelEn?: string;
  field?: string;
  fields?: string[];
  expand?: string;
  format?: string;
}
interface ViewGroup {
  id: string;
  title: string;
  titleEn?: string;
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

/**
 * 品类 → schema 字段表（2026-10-15 苹果全产品线扩充，六品类齐备）。
 *
 * 与 data/categories.json 注册表同源（selftest 对账）。specGroups 按
 * `categoryOf(p)` 选表——非手机品类没有 view 字典（phone 专属的
 * 展示语义），传空 view 走引擎的「自动补挂」路径：schema 的 groups
 * 直接成为参数表分组，字段按 schema 顺序展示。这正是引擎
 * 「schema 加一行，页面自动出现」设计对新品类的默认工作方式。
 */
const SCHEMAS: Record<string, SchemaJson> = {
  phone: PHONE_SCHEMA,
  tablet: tabletSchemaJson as unknown as SchemaJson,
  laptop: laptopSchemaJson as unknown as SchemaJson,
  desktop: desktopSchemaJson as unknown as SchemaJson,
  wearable: wearableSchemaJson as unknown as SchemaJson,
  audio: audioSchemaJson as unknown as SchemaJson,
};

const EMPTY_VIEW: ViewDict = { groups: [], hidden: [] };

/** 品类 → schema 字段表（未知品类回退手机表，保证渲染不炸） */
export function schemaForCategory(category: string): SchemaJson {
  return SCHEMAS[category] ?? PHONE_SCHEMA;
}

/**
 * 缺失值三态（评审 2026-10-16：缺失是一等公民）：
 *   value        specs 有值 → 正常显示
 *   none         数据用 '/' 表达「官网明确无此物」→ 显示「无」
 *   unpublished  null 且 granularity=specs-page（官网完整规格页都没有 → 官网真没有）
 *   uncollected  null 且 granularity=compare-matrix/manual（对比页/手册采集深度不足 → 本站未收录）
 * 「—」不再一律渲染成「官网未公布」——用户分不清「官网没有」和「这站没抓」，
 * 后者基于「缺失」会得出「有 vs 无」的假结论（iPhone 16 的蜂窝频段 vs 16 Plus 即真实案例）。
 */
export type SpecRowState = 'value' | 'none' | 'unpublished' | 'uncollected';

export interface SpecRow {
  label: string;
  value: string;
  state: SpecRowState;
  /** 与该字段相关的采集说明（来自产品 notes，按字段路径/标签匹配），点击灰胶囊展开 */
  note?: string;
}
interface SpecGroup {
  title: string;
  rows: SpecRow[];
}


const dash = (x: unknown): string => (x == null || x === '' ? '—' : String(x));

/**
 * 行级缺失态判定：任一 path 有非空值 → value；值为 '/' / '—' → none；
 * 全空则按产品 granularity 区分「官网未公布」与「本站未收录」。
 */
function rowState(values: unknown[], granularity: string | undefined): SpecRowState {
  return toSpecRowState(classifyMissing(values, granularity));
}

/** 从产品 notes 里找与该字段相关的采集说明（notes 是中文串数组，按路径或标签匹配） */
function noteFor(paths: string[], labels: string[], notes: string[] | undefined): string | undefined {
  if (!notes?.length) return undefined;
  return notes.find((n) =>
    paths.some((p) => n.includes(p)) || labels.some((l) => l && n.includes(l)),
  );
}

/** 语言感知的标签/单位解析（数据侧 label/labelEn、unit/unitEn 双字段） */
const labelOf = (f: { label: string; labelEn?: string }): string => pickLocale(f.label, f.labelEn);
const unitOf = (f: SchemaFieldJson | undefined): string => {
  const u = pickLocale(f?.unit ?? '', f?.unitEn);
  return u ? ` ${u}` : '';
};

/** 缺省格式化：按 schema 的 type + unit 通用渲染（新字段的默认展示形态） */
function defaultFormat(field: SchemaFieldJson | undefined, v: unknown): string {
  if (v == null || v === '') return '—';
  const unit = unitOf(field);
  switch (field?.type) {
    case 'number':
      return typeof v === 'number' ? `${v}${unit}` : dash(v);
    case 'boolean':
      return v === true ? t('common.yes') : v === false ? t('common.no') : dash(v);
    case 'array:number':
      return Array.isArray(v) && v.length ? `${v.join(' / ')}${unit}` : '—';
    case 'array:string':
      // 枚举顿号「、」是中文特有；英文用逗号 + 空格（不是「顺手留着」的半吊子）
      return Array.isArray(v) && v.length ? v.join(currentLocale() === 'en' ? ', ' : '、') : '—';
    case 'object':
      return objectSummary(v, unit);
    case 'array:object':
      return Array.isArray(v) && v.length
        ? v.map((x) => objectSummary(x, unit)).join(' · ')
        : '—';
    default:
      return dash(v); // string / enum：官网原文，不加工
  }
}

/**
 * 对象/对象数组的**形状驱动**缺省渲染（2026-10-15 新品类自动补挂路径用）。
 *
 * 不认具体字段名（引擎纪律），只认数据形状：
 *   - `{ w, h }` → `2388×1668`（分辨率通用形状）
 *   - `{ mp, aperture?, ois? }` → `48 MP · ƒ/1.78 · OIS`（相机镜头通用形状）
 *   - 其余 → JSON 兜底（保证不炸，比静默返回「—」更诚实）
 */
function objectSummary(v: unknown, unit: string): string {
  if (v == null || typeof v !== 'object') return dash(v);
  const o = v as Record<string, unknown>;
  if (typeof o.w === 'number' && typeof o.h === 'number') return `${o.w}×${o.h}${unit}`;
  const bits: string[] = [];
  if (typeof o.mp === 'number') bits.push(`${o.mp}${unit || ' MP'}`);
  if (typeof o.aperture === 'string') bits.push(o.aperture);
  if (o.ois === true) bits.push('OIS');
  if (typeof o.note === 'string' && o.note) bits.push(o.note);
  if (bits.length) return bits.join(' · ');
  if (Object.keys(o).length === 0) return '—';
  return JSON.stringify(o);
}

/**
 * 单值 + 单位（string 型字段要带 schema 单位时用，如刷新率 `1-120 Hz`）。
 *
 * ⚠️ 形参必须与 `FORMATTERS` 的调用形态一致（**解构对象**，不是位置参数）：
 * 2026-10-13 修 — 原写法是 `(values, fields)` 两个位置参数，而注册表统一按
 * `fmt({ values, fields })` 调用，真被引用时 `values[0]` 恒为 undefined、静默返回「—」。
 * 目前视图字典没有行用到 `unit`，所以这个错误一直没显形 —— 正是 A 层静默失效的形状。
 */
function unitFormat({ values, fields }: { values: unknown[]; fields: SchemaFieldJson[] }): string {
  const v = values[0];
  if (v == null || v === '') return '—';
  return `${String(v)}${unitOf(fields[0])}`;
}

/**
 * 展示格式化器注册表：**封闭可加**——视图字典用名字引用，新格式化器只在引擎里加实现。
 * 每个都是「展示语义」的落点（合并行/特殊口径），普通字段不需要。
 */
const FORMATTERS: Record<
  string,
  (args: { values: unknown[]; fields: SchemaFieldJson[] }) => string
> = {
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
    const [typ, peak] = values;
    // 「典型/峰值」是**文案**不是数据：抽到 locale 包，否则英文页会中英混排
    if (typeof peak === 'number') return t('spec.brightnessBoth', { typical: dash(typ), peak });
    if (typeof typ === 'number') return t('spec.brightnessTypical', { typical: typ });
    return '—';
  },
  videoHours: ({ values }) =>
    typeof values[0] === 'number' ? t('spec.videoHours', { hours: values[0] }) : '—',
  /**
   * 蜂窝频段：按制式分组展示（`NR FDD n1/n3/… · NR TDD n38/…`），只列有值的组。
   *
   * ⚠️ 不能走 object 的缺省渲染（`JSON.stringify`）—— 那会把 6 组几十个频段号
   * 挤成一团 JSON：读不出制式归属，也没法跟别的机型逐项比。
   * 组名用 3GPP 通用缩写（NR/LTE/UMTS/GSM + FDD/TDD），中英同形，无需翻译。
   */
  bands: ({ values }) => {
    const v = values[0] as Record<string, unknown> | null | undefined;
    if (!v || typeof v !== 'object') return '—';
    const groups: Array<[string, unknown]> = [
      ['NR FDD', v.nrFdd],
      ['NR TDD', v.nrTdd],
      ['LTE FDD', v.lteFdd],
      ['LTE TDD', v.lteTdd],
      ['UMTS', v.umts],
      ['GSM', v.gsm],
    ];
    const parts = groups
      .filter(([, list]) => Array.isArray(list) && list.length > 0)
      .map(([name, list]) => `${name} ${(list as unknown[]).join('/')}`);
    return parts.length ? parts.join(' · ') : '—';
  },
};

/** 后置相机展开：每颗镜头一行（官网按角色分列的忠实呈现）。角色名走 locale 键。 */
const CAMERA_ROLES: Array<{ role: string; labelKey: string }> = [
  { role: 'main', labelKey: 'spec.cameraRole.main' },
  { role: 'ultrawide', labelKey: 'spec.cameraRole.ultrawide' },
  { role: 'tele', labelKey: 'spec.cameraRole.tele' },
  { role: 'periscope', labelKey: 'spec.cameraRole.periscope' },
];

function cameraRoleRows(
  path: string,
  specs: Record<string, unknown> | null | undefined,
  granularity?: string,
): SpecRow[] {
  const rear = (specs?.[path] ?? []) as Array<{
    role?: string;
    mp?: number | null;
    aperture?: string | null;
    ois?: boolean | null;
  }>;
  return CAMERA_ROLES.map(({ role, labelKey }) => {
    const c = rear.find((x) => x?.role === role);
    const bits = c
      ? [c.mp != null ? `${c.mp} MP` : null, c.aperture, c.ois ? 'OIS' : null].filter(Boolean)
      : [];
    const value = bits.length ? bits.join(' · ') : '—';
    return {
      label: t(labelKey),
      value,
      state: bits.length ? ('value' as const) : rowState([specs?.[path]], granularity),
    };
  });
}

/**
 * 泛化引擎：schema + 视图字典 + 扁平 specs → 分组参数行。
 * 通用到与品类无关（新品类换字典复用）；不认识任何具体字段。
 */
function buildSpecGroups(
  schema: SchemaJson,
  view: ViewDict,
  p: Product,
): SpecGroup[] {
  const specs = p.specs;
  const granularity = p.granularity;
  const fieldByPath = new Map(schema.fields.map((f) => [f.path, f]));
  const referenced = new Set<string>();
  const out: Array<SpecGroup & { id: string }> = [];

  for (const g of view.groups) {
    const rows: SpecRow[] = [];
    for (const r of g.rows) {
      if (r.expand) {
        referenced.add(r.expand);
        if (r.format === 'cameraRole') {
          rows.push(...cameraRoleRows(r.expand, specs, granularity));
        } else {
          const values = [specs?.[r.expand]];
          rows.push({
            label: r.label ?? r.expand,
            value: dash(values[0]),
            state: rowState(values, granularity),
            note: noteFor([r.expand], [], p.notes),
          });
        }
        continue;
      }
      const paths = r.fields ?? (r.field ? [r.field] : []);
      for (const p2 of paths) referenced.add(p2);
      const fields = paths.map((p3) => fieldByPath.get(p3)).filter(Boolean) as SchemaFieldJson[];
      const values = paths.map((p4) => specs?.[p4]);
      const fmt = r.format ? FORMATTERS[r.format] : undefined;
      const value = fmt
        ? fmt({ values, fields })
        : paths.length === 1
          ? defaultFormat(fields[0], values[0])
          : values.map((v, i) => defaultFormat(fields[i], v)).join(' / ');
      rows.push({
        label: pickLocale(r.label ?? paths.join('+'), r.labelEn),
        value,
        state: rowState(values, granularity),
        note: noteFor(paths, [pickLocale(r.label ?? '', r.labelEn)], p.notes),
      });
    }
    out.push({ id: g.id, title: pickLocale(g.title, g.titleEn), rows });
  }

  // ── 自动补挂（最优解核心）：schema 有、视图没引用、也没 hidden 的字段 → 自动出现在页面上。
  // 定位：字段的 schema.group → 视图组（matchGroups 支持吞并组）；无匹配视图组 → 按 schema
  // 分组名新建组放最后。这就是「发现新可量化参数 → schema 加一行 → 页面自动出现」。
  const hidden = new Set(view.hidden ?? []);
  const bySchemaGroup = new Map<string, ViewGroup>();
  for (const g of view.groups) for (const gid of g.matchGroups ?? [g.id]) bySchemaGroup.set(gid, g);
  const extra = new Map<string, SpecRow[]>();
  /** 补挂组的展示名（语言感知）：命中视图组 → 视图标题；否则 → schema 分组名 */
  const targetId = new Map<string, string>();
  for (const f of schema.fields) {
    if (referenced.has(f.path) || hidden.has(f.path)) continue;
    const target = bySchemaGroup.get(f.group);
    const sg = schema.groups?.find((x) => x.id === f.group);
    const key = target
      ? pickLocale(target.title, target.titleEn)
      : sg
        ? pickLocale(sg.name, sg.nameEn)
        : f.group;
    if (target) targetId.set(key, target.id);
    const row: SpecRow = {
      label: labelOf(f),
      value: defaultFormat(f, specs?.[f.path]),
      state: rowState([specs?.[f.path]], granularity),
      note: noteFor([f.path], [labelOf(f)], p.notes),
    };
    if (!extra.has(key)) extra.set(key, []);
    extra.get(key)!.push(row);
  }
  for (const [key, rows] of extra) {
    // 先按视图组 id 归位，再按展示名兜底（id 是稳定键，展示名随语言变，不能当主键）
    const id = targetId.get(key);
    const g = (id ? out.find((x) => x.id === id) : undefined) ?? out.find((x) => x.title === key);
    if (g) g.rows.push(...rows);
    else out.push({ id: key, title: key, rows });
  }

  return out.map(({ title, rows }) => ({ title, rows })); // 内部 id 不外泄
}

/**
 * 详情页/对比表共用入口（签名不变，消费方零改动）。
 *
 * 出口处统一过一遍术语本地化：specs 值是中文官网原文，英文界面下要把其中的
 * 术语换成厂商官方英文（见 `./glossary`）。放在出口而不是每个 formatter 里，
 * 是为了**只有一个接入口** —— 将来新增展示点不会漏挂。
 */
export function specGroups(p: Product): SpecGroup[] {
  const category = categoryOf(p);
  const schema = schemaForCategory(category);
  const view = category === 'phone' ? PHONE_VIEW : EMPTY_VIEW;
  const groups = buildSpecGroups(schema, view, p);
  if (currentLocale() !== 'en') return groups;
  return groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => ({ ...r, value: localizeSpecValue(r.value) })),
  }));
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
