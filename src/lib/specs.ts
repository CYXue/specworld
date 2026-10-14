import { i18n } from '../i18n';
import type { Product } from '../types';

/** 展示文案助手（语言只从全局来，口径见 `src/i18n/index.ts`） */
const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {});

// 四条能力横条：借鉴参考项目「画归画、数归数」——房间负责「这是谁」，
// 横条负责「它强在哪」。取值全部来自官网实数，缺失即 null（显示「官方未公布」），
// 条的长度是它在**本数据集内的相对位置**（min→max 归一），不是虚构的绝对分。
export type AbilityKey = 'display' | 'light' | 'battery' | 'camera';

interface AbilityDef {
  key: AbilityKey;
  /** 展示名 → locale 键。**不存中文**（存了就没法双语，且闸门看不见） */
  labelKey: string;
  higherBetter: boolean;
  unit: string;
}

export const ABILITIES: AbilityDef[] = [
  { key: 'display', labelKey: 'ability.display', higherBetter: true, unit: 'PPI' },
  { key: 'light', labelKey: 'ability.light', higherBetter: false, unit: 'g' },
  { key: 'battery', labelKey: 'ability.battery', higherBetter: true, unit: 'mAh' },
  { key: 'camera', labelKey: 'ability.camera', higherBetter: true, unit: 'MP' },
];

/** 能力维度展示名（语言感知） */
export function abilityLabel(key: AbilityKey | string): string {
  return t(ABILITIES.find((d) => d.key === key)?.labelKey ?? 'ability.display');
}

export interface AbilityRow {
  key: AbilityKey;
  label: string;
  raw: number | null;
  display: string;
  ratio: number | null; // 0..1 相对位置，null=无数据
}

export function mainCameraMp(p: Product): number | null {
  const rear = p.camera?.rear ?? [];
  const main = rear.find((c) => c.role === 'main' && c.mp != null);
  if (main?.mp != null) return main.mp;
  const max = rear.reduce<number | null>(
    (acc, c) => (c.mp != null ? Math.max(acc ?? 0, c.mp) : acc),
    null,
  );
  return max;
}

function rawFor(p: Product, key: AbilityKey): number | null {
  switch (key) {
    case 'display':
      return p.display?.ppi ?? null;
    case 'light':
      return p.body?.weightG ?? null;
    case 'battery':
      return p.battery?.capacityMah ?? null;
    case 'camera':
      return mainCameraMp(p);
  }
}

function fmt(key: AbilityKey, raw: number): string {
  switch (key) {
    case 'display':
      return `${raw} PPI`;
    case 'light':
      return `${raw} g`;
    case 'battery':
      return `${raw} mAh`;
    case 'camera':
      return `${raw} MP`;
  }
}

export interface Bounds {
  min: number;
  max: number;
}

export function computeBounds(products: Product[]): Record<AbilityKey, Bounds | null> {
  const out = {} as Record<AbilityKey, Bounds | null>;
  for (const def of ABILITIES) {
    const vals = products.map((p) => rawFor(p, def.key)).filter((v): v is number => v != null);
    out[def.key] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }
  return out;
}

function abilityRow(p: Product, def: AbilityDef, b: Bounds | null): AbilityRow {
  const raw = rawFor(p, def.key);
  if (raw == null || !b || b.max === b.min) {
    return {
      key: def.key,
      label: abilityLabel(def.key),
      raw: null,
      display: t('common.unpublished'),
      ratio: null,
    };
  }
  // ⚠️ 这里原变量名是 `t`，与模块级的翻译助手 `t()` 同名会把它遮蔽
  // （TS 报「used before declaration」，运行时则是拿数字当函数调用）——改名 `norm`。
  const norm = (raw - b.min) / (b.max - b.min);
  const ratio = def.higherBetter ? norm : 1 - norm;
  return {
    key: def.key,
    label: abilityLabel(def.key),
    raw,
    display: fmt(def.key, raw),
    ratio: Math.max(0, Math.min(1, ratio)),
  };
}

export function abilityRows(p: Product, bounds: Record<AbilityKey, Bounds | null>): AbilityRow[] {
  return ABILITIES.map((def) => abilityRow(p, def, bounds[def.key]));
}

// 导出取原始值，供榜单页使用
export function abilityRaw(p: Product, key: AbilityKey): number | null {
  return rawFor(p, key);
}

export function fmtAbility(key: AbilityKey, raw: number): string {
  return fmt(key, raw);
}

// ── 榜单：每个维度取真实最优的一台 ──

export interface Champion {
  key: AbilityKey;
  label: string;
  product: Product;
  display: string;
}

export function champions(products: Product[]): Champion[] {
  const out: Champion[] = [];
  for (const def of ABILITIES) {
    let best: Product | null = null;
    let bestRaw: number | null = null;
    for (const p of products) {
      const raw = rawFor(p, def.key);
      if (raw == null) continue;
      if (bestRaw == null || (def.higherBetter ? raw > bestRaw : raw < bestRaw)) {
        best = p;
        bestRaw = raw;
      }
    }
    if (best && bestRaw != null)
      out.push({
        key: def.key,
        label: abilityLabel(def.key),
        product: best,
        display: fmt(def.key, bestRaw),
      });
  }
  // 「最新发布」也算一个榜单维度
  const latest = [...products].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0];
  if (latest)
    out.push({
      key: 'display',
      label: t('sort.release'),
      product: latest,
      display: latest.releaseDate,
    });
  return out;
}
