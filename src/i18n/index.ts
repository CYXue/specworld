/**
 * 站内文案字典（中文单语）。
 *
 * 2026-10-21 按用户裁决移除多语言：vue-i18n、en 语言包、语言切换与全部
 * i18n 闸门（i18n:residual / smoke:i18n / i18n-keys 对账）整体退役。
 * 本模块只剩一个「文案字典 + 取词函数」：键 → 中文文案，支持 {x} 插值。
 * 键名与原 zh.json 一致，调用方（组件 t(...) / lib i18n.global.t(...)）零改动。
 *
 * 缺键 = 抛错，不静默回退——这条纪律从双语时代保留（打错键名必须当场炸）。
 */
import zh from '../locales/zh.json' with { type: 'json' };

type Dict = Record<string, unknown>;

function lookup(dict: Dict, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Dict)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** 取中文文案。params 的每个键替换文案里的 {键} 占位符 */
export function t(key: string, params?: Record<string, unknown>): string {
  const text = lookup(zh as Dict, key);
  if (text === undefined) {
    throw new Error(`[i18n] 缺少文案键：${key}（请补 src/locales/zh.json，别静默）`);
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

/** lib 层沿用的调用面（原 vue-i18n 全局实例形态），只剩 t 一个出口 */
export const i18n = { global: { t } };
