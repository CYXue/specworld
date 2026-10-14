/**
 * 前端值校验/类型转换的**单一共享模块**（硬编码审计 A3 治理，2026-10-13）。
 *
 * 权威规则在 `scripts/lib/schema.mjs` 的 `validateSpecValue`（服务端落盘闸门）。
 * 浏览器侧需要同一套规则做「提交前即时提示」，此前 DataFeedback.vue 里手抄了一份——
 * 类型系统演进时会静默漂移（本机提示与落盘规则打架）。现在：浏览器侧一律 import 本模块；
 * `admin/overrides-editor.html` 因零构建约束无法 import，保留拷贝但受 selftest
 * 「类型集弱对账」看守（schema 出现新 type 而 editor 没跟 → selftest 红）。
 *
 * 与权威的分工：本模块**只做体验优化**（提前提示），不是安全边界——
 * 服务端 `validateOverrides` 才是落盘前最后一道闸门。
 */

import { i18n } from '../i18n';

/** 校验提示是**给用户看的**：语言跟着界面走（否则英文页弹中文提示，等于没翻译） */
const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {});

interface SchemaFieldLite {
  type: string;
  range: number[] | null;
  values?: string[];
  unit?: string | null;
}

/** 提交前校验。返回错误文案；null = 合法。与 schema.mjs validateSpecValue 的规则对齐 */
export function validateSpecValueClient(field: SchemaFieldLite, raw: string): string | null {
  if (raw === '' || raw === null || raw === undefined) return t('validate.empty');
  switch (field.type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return t('validate.notNumber', { raw });
      if (Array.isArray(field.range) && (n < field.range[0] || n > field.range[1]))
        return t('validate.outOfRange', {
          value: n,
          range: field.range.join('~'),
          unit: field.unit ? ' ' + field.unit : '',
        });
      return null;
    }
    case 'boolean':
      if (!['true', 'false'].includes(String(raw).toLowerCase())) return t('validate.notBool');
      return null;
    case 'enum':
      if (!field.values?.includes(raw))
        return t('validate.notInEnum', { raw, values: field.values?.join('/') });
      return null;
    case 'array:number': {
      const arr = String(raw)
        .split(/[，,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
      if (arr.some((n) => !Number.isFinite(n))) return t('validate.badNumberArray');
      return null;
    }
    case 'array:string': {
      const arr = String(raw)
        .split(/[，,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!arr.length) return t('validate.needOneItem');
      return null;
    }
    default:
      // string / object / array:object 等自由形态：浏览器侧不做内容判断（服务端权威）
      return null;
  }
}

/** 按 schema 类型把输入串转成落盘值（number→Number、boolean→bool、数组→数组…） */
export function coerceSpecValueClient(field: SchemaFieldLite, raw: string): unknown {
  switch (field.type) {
    case 'number':
      return Number(raw);
    case 'boolean':
      return String(raw).toLowerCase() === 'true';
    case 'array:number':
      return String(raw)
        .split(/[，,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
    case 'array:string':
      return String(raw)
        .split(/[，,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    default:
      return raw;
  }
}
