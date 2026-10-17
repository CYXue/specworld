import type { Product } from '../types';
import { categoryOf, formLabelOf, shortDateLabel } from './catalog';

/**
 * 设备卡摘要标签（2026-10-16 三轮收敛）：**关键字段按品类选择**，不再所有设备
 * 共用四个手机字段。规则：
 *
 * - 每个品类配一份「优先展示的 specs 键 + 格式」表，从**已有且有值**的字段里挑；
 * - **最多 4 项，缺失不补位**——字段不充分时少显示几项，不用空白撑；
 * - 取值一律读扁平 specs 容器（`specs['display.sizeIn']`）。此前读 v1 嵌套
 *   （`p.display?.sizeIn`）在全 v2 数据上恒为空，标签静默消失——这是「双真源」
 *   教训的活例，摘要取值只此一处定义。
 */

interface TagRule {
  key: string;
  /** 数值格式化：值 → 标签文本；返回 null 表示该值不可展示（跳过）。 */
  fmt: (v: unknown) => string | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}
function str(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  // 芯片名等长字符串截到 18 字符，标签内用 CSS truncate 兜底
  return v.trim().length > 18 ? `${v.trim().slice(0, 17)}…` : v.trim();
}
const thousand = (n: number) => n.toLocaleString('en-US');

/** 品类 → 摘要字段表（顺序即展示优先级）。 */
const TAG_RULES: Record<string, TagRule[]> = {
  // 手机：尺寸 / 刷新率 / 电池 / 重量
  phone: [
    { key: 'display.sizeIn', fmt: (v) => (num(v) != null ? `${num(v)}″` : null) },
    { key: 'display.refreshHz', fmt: (v) => (num(v) != null ? `${num(v)}Hz` : null) },
    { key: 'battery.capacityMah', fmt: (v) => (num(v) != null ? `${thousand(num(v)!)}mAh` : null) },
    { key: 'body.weightG', fmt: (v) => (num(v) != null ? `${num(v)}g` : null) },
  ],
  // 笔记本：处理器 / 屏幕 / 内存 / 重量
  laptop: [
    { key: 'chipset.name', fmt: str },
    { key: 'display.sizeIn', fmt: (v) => (num(v) != null ? `${num(v)}″` : null) },
    { key: 'memory.ramGb', fmt: (v) => (num(v) != null ? `${num(v)}GB` : null) },
    { key: 'body.weightKg', fmt: (v) => (num(v) != null ? `${num(v)}kg` : null) },
  ],
  // 显示器：尺寸 / 面板类型 / 像素密度 / 刷新率
  display: [
    { key: 'display.sizeIn', fmt: (v) => (num(v) != null ? `${num(v)}″` : null) },
    { key: 'display.type', fmt: str },
    { key: 'display.ppi', fmt: (v) => (num(v) != null ? `${num(v)}ppi` : null) },
    { key: 'display.refreshHz', fmt: (v) => (num(v) != null ? `${num(v)}Hz` : null) },
  ],
  // 音频：连接方式 / 单次续航 / 重量（驱动单元覆盖过低，不列）
  audio: [
    { key: 'connectivity.bluetooth', fmt: str },
    { key: 'battery.budHours', fmt: (v) => (num(v) != null ? `${num(v)}h` : null) },
    { key: 'body.weightG', fmt: (v) => (num(v) != null ? `${num(v)}g` : null) },
  ],
};

/** 兜底表：未列出的品类尽量给一点可识别信息，缺了就少显示。 */
const FALLBACK_RULES: TagRule[] = [
  { key: 'display.sizeIn', fmt: (v) => (num(v) != null ? `${num(v)}″` : null) },
  { key: 'body.weightG', fmt: (v) => (num(v) != null ? `${num(v)}g` : null) },
];

/**
 * 固定 3 槽版 keySpecs（评审 2026-10-17 共性问题：卡片无法横向扫读——
 * 各卡 chip 语义漂移，眼睛无法形成列）。
 *
 * 与 specTagsOf 的区别：**槽位固定、缺值占位**。每个品类配 3 个语义槽，
 * 值缺失的槽返回 null（调用方渲染灰色虚线空槽），后面的值不许往前挤——
 * 这样一列卡片自然形成三列对齐的数字。
 */
export interface SpecSlot {
  label: string;
  /** null = 该槽缺值（渲染占位，不渲染值） */
  value: string | null;
}

/**
 * 槽位规则：**标签长在规则上**（label/labelEn 与 key 同条目），不走全局索引。
 * 真实故障（2026-10-17 用户报告）：曾经值按品类表取、标签却是全局
 * ['屏幕','电池','快充'] 按列位硬贴 —— HomePod mini 2 的蓝牙值贴「电池」、
 * 重量值贴「快充」，Apple TV 4K 的 217g 贴「电池」。标签与值必须同源。
 */
interface SlotRule {
  label: string;
  labelEn: string;
  key: string;
  fmt: (v: unknown) => string | null;
}

/** 品类 → 固定 3 槽（顺序即列位，改顺序会移动整列语义，慎重） */
const SLOT_RULES: Record<string, SlotRule[]> = {
  phone: [
    { label: '屏幕', labelEn: 'Display', key: 'display.sizeIn', fmt: (v) => (num(v) != null ? `${num(v)}″` : null) },
    { label: '电池', labelEn: 'Battery', key: 'battery.capacityMah', fmt: (v) => (num(v) != null ? `${thousand(num(v)!)}mAh` : null) },
    { label: '快充', labelEn: 'Charge', key: 'battery.wiredChargeW', fmt: (v) => (num(v) != null ? `${num(v)}W` : null) },
  ],
  laptop: [
    { label: '处理器', labelEn: 'Chip', key: 'chipset.name', fmt: str },
    { label: '屏幕', labelEn: 'Display', key: 'display.sizeIn', fmt: (v) => (num(v) != null ? `${num(v)}″` : null) },
    { label: '内存', labelEn: 'Memory', key: 'memory.ramGb', fmt: (v) => (num(v) != null ? `${num(v)}GB` : null) },
  ],
  display: [
    { label: '屏幕', labelEn: 'Size', key: 'display.sizeIn', fmt: (v) => (num(v) != null ? `${num(v)}″` : null) },
    { label: '刷新率', labelEn: 'Refresh', key: 'display.refreshHz', fmt: (v) => (num(v) != null ? `${num(v)}Hz` : null) },
    { label: '像素密度', labelEn: 'PPI', key: 'display.ppi', fmt: (v) => (num(v) != null ? `${num(v)}ppi` : null) },
  ],
  // 音频：续航 / 蓝牙 / 重量。HomePod 一体音箱没有 budHours（那是耳机单元口径），
  // 该槽自然空占位，蓝牙与重量永远对得上自己的标签。
  audio: [
    { label: '续航', labelEn: 'Battery', key: 'battery.budHours', fmt: (v) => (num(v) != null ? `${num(v)}h` : null) },
    { label: '蓝牙', labelEn: 'Bluetooth', key: 'connectivity.bluetooth', fmt: str },
    { label: '重量', labelEn: 'Weight', key: 'body.weightG', fmt: (v) => (num(v) != null ? `${num(v)}g` : null) },
  ],
  // 机顶盒/媒体盒（Apple TV 等）：芯片 / 存储 / 重量——没有电池，永远不挂电池槽。
  media: [
    { label: '芯片', labelEn: 'Chip', key: 'chipset.name', fmt: str },
    { label: '存储', labelEn: 'Storage', key: 'memory.storageGb', fmt: (v) => (Array.isArray(v) && v.length ? `${v[v.length - 1]}GB` : null) },
    { label: '重量', labelEn: 'Weight', key: 'body.weightG', fmt: (v) => (num(v) != null ? `${num(v)}g` : null) },
  ],
  // 平板：屏幕 / 芯片 / 重量。
  tablet: [
    { label: '屏幕', labelEn: 'Display', key: 'display.sizeIn', fmt: (v) => (num(v) != null ? `${num(v)}″` : null) },
    { label: '芯片', labelEn: 'Chip', key: 'chipset.name', fmt: str },
    { label: '重量', labelEn: 'Weight', key: 'body.weightG', fmt: (v) => (num(v) != null ? `${num(v)}g` : null) },
  ],
  // 穿戴：表壳 / 续航 / 重量。
  wearable: [
    { label: '表壳', labelEn: 'Case', key: 'body.caseSizeMm', fmt: (v) => (num(v) != null ? `${num(v)}mm` : null) },
    { label: '续航', labelEn: 'Battery', key: 'battery.vendorClaimedHours', fmt: (v) => (num(v) != null ? `${num(v)}h` : null) },
    { label: '重量', labelEn: 'Weight', key: 'body.weightG', fmt: (v) => (num(v) != null ? `${num(v)}g` : null) },
  ],
};

/** 档案要点槽（全部模式，评审 2026-10-17 §二：在售机和 1986 年配件用同一套
 * 「屏幕/电池/重量」是「电池 —」到处出现的根因）。档案槽不读 specs 数值，
 * 读身份字段（发布/芯片/形态）——历史机型永远有值，占位噪音自然消失。
 */
const ARCHIVE_SLOTS: Array<{ label: string; labelEn: string; get: (p: Product) => string | null }> = [
  { label: '发布', labelEn: 'Released', get: (p) => shortDateLabel(p) || null },
  { label: '芯片', labelEn: 'Chip', get: (p) => {
      const v = (p.specs ?? {})['chipset.name'];
      return typeof v === 'string' && v.trim() ? v : null;
    } },
  { label: '形态', labelEn: 'Form', get: (p) => formLabelOf(p) || null },
];

/** 兜底 3 槽：未登记品类给「尺寸 / 重量」两槽 + 空槽——没有电池，不猜语义。 */
const FALLBACK_SLOTS: SlotRule[] = [
  { label: '尺寸', labelEn: 'Size', key: 'display.sizeIn', fmt: (v) => (num(v) != null ? `${num(v)}″` : null) },
  { label: '重量', labelEn: 'Weight', key: 'body.weightG', fmt: (v) => (num(v) != null ? `${num(v)}g` : null) },
];

/** 固定 3 槽：永远返回 3 项，值缺失的槽 value = null。axis 决定读「买点」还是「档案要点」。 */
export function specSlotsOf(
  p: Product,
  locale?: string,
  axis: 'buy' | 'archive' = 'buy',
): SpecSlot[] {
  if (axis === 'archive') {
    const en = locale === 'en';
    return ARCHIVE_SLOTS.map((s) => ({ label: en ? s.labelEn : s.label, value: s.get(p) }));
  }
  const specs = p.specs ?? {};
  const rules = SLOT_RULES[categoryOf(p)] ?? FALLBACK_SLOTS;
  const en = locale === 'en';
  const out: SpecSlot[] = [];
  for (let i = 0; i < 3; i++) {
    const rule = rules[i];
    const v = rule ? (rule.key in specs ? rule.fmt(specs[rule.key]) : null) : null;
    out.push({ label: rule ? (en ? rule.labelEn : rule.label) : '', value: v });
  }
  return out;
}

/** 品类摘要标签：按品类字段表顺序取值，缺失不补位，最多 4 项。 */
export function specTagsOf(p: Product): string[] {
  const specs = p.specs ?? {};
  const rules = TAG_RULES[categoryOf(p)] ?? FALLBACK_RULES;
  const tags: string[] = [];
  for (const r of rules) {
    if (tags.length >= 4) break;
    const v = r.key in specs ? r.fmt(specs[r.key]) : null;
    if (v) tags.push(v);
  }
  return tags;
}
