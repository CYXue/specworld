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

interface SchemaFieldLite {
  type: string;
  range: number[] | null;
  values?: string[];
  unit?: string | null;
}

/** 提交前校验。返回错误文案；null = 合法。与 schema.mjs validateSpecValue 的规则对齐 */
export function validateSpecValueClient(field: SchemaFieldLite, raw: string): string | null {
  if (raw === '' || raw === null || raw === undefined) return '值不能为空';
  switch (field.type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return `应为数值，收到「${raw}」`;
      if (Array.isArray(field.range) && (n < field.range[0] || n > field.range[1]))
        return `${n} 超出合理区间 ${field.range.join('~')}${field.unit ? ' ' + field.unit : ''}`;
      return null;
    }
    case 'boolean':
      if (!['true', 'false'].includes(String(raw).toLowerCase())) return '应为 true / false';
      return null;
    case 'enum':
      if (!field.values?.includes(raw)) return `「${raw}」不在可选值 ${field.values?.join('/')} 内`;
      return null;
    case 'array:number': {
      const arr = String(raw)
        .split(/[，,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
      if (arr.some((n) => !Number.isFinite(n))) return '应为逗号分隔的数值，如 8, 12, 16';
      return null;
    }
    case 'array:string': {
      const arr = String(raw)
        .split(/[，,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!arr.length) return '至少一项';
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
