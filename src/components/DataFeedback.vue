<script setup lang="ts">
/**
 * DataFeedback —— 展示页「纠错 / 补充数据」公开入口。
 *
 * 用户在机型详情页发现数据缺失或错误，点开表单：选字段（按品类 schema 分组、
 * 自动带出当前值）→ 填新值 + 数据来源 → 提交到 /api/submit，进入
 * data/submissions.json 待审队列；管理员在 /editor 审核区「采用」后转为
 * 正式 override。用户全程不需要碰 JSON，管理员只需审核一遍。
 *
 * 纪律（与 overrides 层一致）：
 * - 公开提交只收 set-field（新增整机走联系渠道）；
 * - 客户端校验与 scripts/lib/schema.mjs validateSpecValue 同源（类型/区间/枚举），
 *   服务端还会再全量校验一遍——客户端校验只是体验优化，不是安全边界；
 * - 复杂结构字段（object / array:object）不开放公开提交，提示走联系渠道；
 * - 无后端环境（纯静态托管）优雅降级：生成标准模板 JSON 供用户复制发给管理员。
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { asset } from '../lib/assets';
import { coerceSpecValueClient as coerce, validateSpecValueClient as validate } from '../lib/fieldValidate';
import type { Product } from '../types';

interface SchemaField {
  path: string;
  label: string;
  labelEn?: string;
  unit: string | null;
  type: string;
  range: number[] | null;
  values?: string[];
  group: string;
}

/** 公开提交只开放简单标量类型；object/array:object 结构太复杂，走联系渠道 */
const SCALAR_TYPES = new Set(['number', 'string', 'boolean', 'enum', 'array:number', 'array:string']);

const { t } = useI18n();
const props = defineProps<{ product: Product | undefined }>();

const open = ref(false);
const loading = ref(false);
const loadErr = ref('');
const groups = ref<{ id: string; name: string; fields: SchemaField[] }[]>([]);
const fieldPath = ref('');
const rawValue = ref('');
const reason = ref('');
const nick = ref('');
const submitting = ref(false);
const msg = ref<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null);
const fallbackJson = ref('');

const allFields = computed(() => groups.value.flatMap((g) => g.fields));
const currentField = computed(() => allFields.value.find((f) => f.path === fieldPath.value));

/** 当前值：specs 是扁平 Record<path, value> 容器，直接按 path 取 */
const currentValueText = computed(() => {
  const v = props.product?.specs?.[fieldPath.value];
  if (v === undefined || v === null) return t('common.unpublished');
  return typeof v === 'string' ? v : JSON.stringify(v);
});

const typeHint = computed(() => {
  const f = currentField.value;
  if (!f) return '';
  const parts = [f.type];
  if (f.unit) parts.push(f.unit);
  if (f.range) parts.push(t('feedback.rangeHint', { min: f.range[0], max: f.range[1] }));
  if (f.values) parts.push(f.values.join(' / '));
  return parts.join(' · ');
});

async function openModal() {
  open.value = true;
  msg.value = null;
  fallbackJson.value = '';
  if (groups.value.length || loading.value || !props.product) return;
  loading.value = true;
  loadErr.value = '';
  try {
    const r = await fetch(asset(`data/schemas/${props.product.category}.json`));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const schema = (await r.json()) as { fields?: SchemaField[]; groups?: { id: string; name: string }[] };
    const fields = (schema.fields ?? []).filter((f) => SCALAR_TYPES.has(f.type));
    const gs = (schema.groups ?? [{ id: '_', name: t('feedback.groupOther') }]).map((g) => ({
      id: g.id,
      name: g.name,
      fields: fields.filter((f) => f.group === g.id),
    }));
    // 兜底：schema 校验保证 groups 覆盖全部字段，但万一有 orphan 不丢字段
    const grouped = new Set(gs.flatMap((g) => g.fields.map((f) => f.path)));
    const rest = fields.filter((f) => !grouped.has(f.path));
    if (rest.length) gs.push({ id: '_', name: t('feedback.groupOther'), fields: rest });
    groups.value = gs.filter((g) => g.fields.length);
    fieldPath.value = groups.value[0]?.fields[0]?.path ?? '';
    rawValue.value = '';
  } catch (e) {
    loadErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function close() {
  open.value = false;
}

/** 值校验/类型转换已抽到 src/lib/fieldValidate.ts（硬编码审计 A3 治理：浏览器侧单一共享模块，
 *  与 scripts/lib/schema.mjs 权威规则对齐；此前本组件内手抄一份会随类型系统演进静默漂移）。 */

async function submit() {
  msg.value = null;
  fallbackJson.value = '';
  const field = currentField.value;
  if (!props.product || !field) return;
  if (!reason.value.trim()) {
    msg.value = { kind: 'err', text: t('feedback.needReason') };
    return;
  }
  const verr = validate(field, rawValue.value);
  if (verr) {
    msg.value = { kind: 'err', text: t('feedback.validateFail', { err: verr }) };
    return;
  }
  const payload = {
    op: 'set-field',
    productId: props.product.id,
    field: field.path,
    value: coerce(field, rawValue.value),
    reason: reason.value.trim(),
    submittedBy: nick.value.trim(),
  };
  submitting.value = true;
  try {
    const r = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // 无后端环境（Toy 等纯静态托管）：静态服务器对 POST 返回 404/405，或网关 5xx——
    // 这不是「提交被拒」，是「没有提交服务」，走降级；400/409/429 才是服务端真实拒绝。
    const noBackend = r.status === 404 || r.status === 405 || r.status >= 500;
    if (noBackend) throw new Error('no-backend');
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; message?: string; errors?: string[] };
    if (r.ok && j.ok) {
      msg.value = {
        kind: 'ok',
        text: t('feedback.submitted', { message: j.message ?? t('feedback.submittedOk'), id: j.id }),
      };
      rawValue.value = '';
      reason.value = '';
    } else {
      msg.value = { kind: 'err', text: (j.errors ?? [j.message ?? `HTTP ${r.status}`]).join('\n') };
    }
  } catch {
    // 无后端 → 降级：生成标准模板供复制发给作者（B 站私信/评论区），作者导入待审队列
    fallbackJson.value = JSON.stringify(
      {
        ...payload,
        submittedBy: payload.submittedBy || t('feedback.anonymous'),
        createdAt: new Date().toISOString().slice(0, 10),
        source: 'user-submission',
        status: 'pending',
      },
      null,
      2,
    );
    msg.value = {
      kind: 'warn',
      text: t('feedback.noBackend'),
    };
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <button
    class="pixel-button flex items-center justify-center gap-2 px-3 py-2 text-[12px] leading-[1.5]"
    style="color: var(--color-parchment-dim)"
    @click="openModal"
  >
    ✎ {{ t('feedback.openButton') }}
  </button>

  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    style="background: rgba(11, 16, 32, 0.72)"
    @click.self="close"
  >
    <div
      class="w-full max-w-lg rounded-lg p-5"
      style="
        background: var(--color-panel);
        border: 2px solid var(--color-ink);
        box-shadow: 0 0 0 2px var(--color-panel-lit);
        max-height: 85vh;
        overflow-y: auto;
      "
    >
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 class="font-pixel text-[16px] leading-[1.4]" style="color: var(--color-parchment-lit)">
            {{ t('feedback.title') }}
          </h2>
          <p class="mt-1 text-[12px] leading-[1.5]" style="color: var(--color-parchment-dim)">
            {{ props.product?.name }}（{{ props.product?.id }}）
          </p>
        </div>
        <button
          class="pixel-button px-2 py-1 text-[12px]"
          style="color: var(--color-parchment-dim)"
          :aria-label="t('feedback.close')"
          @click="close"
        >
          ✕
        </button>
      </div>

      <div v-if="loadErr" class="text-[12px] leading-[1.6]" style="color: var(--color-east)">
        {{ t('feedback.loadFailed', { err: loadErr }) }}
      </div>

      <template v-else>
        <label class="mb-1 block text-[12px]" style="color: var(--color-parchment-dim)">{{
          t('feedback.fieldLabel')
        }}</label>
        <select
          v-model="fieldPath"
          class="mb-1 w-full rounded px-2 py-2 text-[12px]"
          style="background: var(--color-void); color: var(--color-parchment); border: 1px solid var(--color-ink)"
        >
          <optgroup v-for="g in groups" :key="g.id" :label="g.name">
            <option v-for="f in g.fields" :key="f.path" :value="f.path">{{ f.label }}（{{ f.path }}）</option>
          </optgroup>
        </select>
        <p class="mb-3 text-[11px] leading-[1.5]" style="color: var(--color-parchment-dim)">
          {{ t('feedback.currentValue', { value: currentValueText, hint: typeHint }) }}
        </p>

        <label class="mb-1 block text-[12px]" style="color: var(--color-parchment-dim)">
          {{ t('feedback.correctValue')
          }}<template v-if="currentField && currentField.type === 'boolean'">（true / false）</template>
        </label>
        <select
          v-if="currentField && (currentField.type === 'boolean' || currentField.type === 'enum')"
          v-model="rawValue"
          class="mb-3 w-full rounded px-2 py-2 text-[12px]"
          style="background: var(--color-void); color: var(--color-parchment); border: 1px solid var(--color-ink)"
        >
          <option value="" disabled>{{ t('feedback.pleaseSelect') }}</option>
          <option v-if="currentField.type === 'boolean'" value="true">true（{{ t('common.yes') }}）</option>
          <option v-if="currentField.type === 'boolean'" value="false">false（{{ t('common.no') }}）</option>
          <template v-else>
            <option v-for="v in currentField.values" :key="v" :value="v">{{ v }}</option>
          </template>
        </select>
        <input
          v-else
          v-model="rawValue"
          class="mb-3 w-full rounded px-2 py-2 text-[12px]"
          style="background: var(--color-void); color: var(--color-parchment); border: 1px solid var(--color-ink)"
          :placeholder="
            currentField?.type === 'array:number'
              ? t('feedback.placeholderArray')
              : t('feedback.placeholderScalar')
          ""
        />

        <label class="mb-1 block text-[12px]" style="color: var(--color-parchment-dim)">{{
          t('feedback.reasonLabel')
        }}</label>
        <input
          v-model="reason"
          class="mb-3 w-full rounded px-2 py-2 text-[12px]"
          style="background: var(--color-void); color: var(--color-parchment); border: 1px solid var(--color-ink)"
          :placeholder="t('feedback.reasonPlaceholder')"
        />

        <label class="mb-1 block text-[12px]" style="color: var(--color-parchment-dim)">{{
          t('feedback.nickLabel')
        }}</label>
        <input
          v-model="nick"
          maxlength="40"
          class="mb-3 w-full rounded px-2 py-2 text-[12px]"
          style="background: var(--color-void); color: var(--color-parchment); border: 1px solid var(--color-ink)"
          :placeholder="t('feedback.nickPlaceholder')"
        />

        <p v-if="msg" class="mb-3 whitespace-pre-wrap text-[12px] leading-[1.6]" :style="{ color: msg.kind === 'ok' ? 'var(--color-emerald)' : msg.kind === 'warn' ? 'var(--color-gold)' : 'var(--color-east)' }">
          {{ msg.text }}
        </p>
        <pre
          v-if="fallbackJson"
          class="mb-3 max-h-40 overflow-auto rounded p-2 text-[11px]"
          style="background: var(--color-void); color: var(--color-parchment)"
          >{{ fallbackJson }}</pre
        >

        <button
          class="pixel-button w-full px-3 py-2 text-[12px] leading-[1.5]"
          style="color: var(--color-gold)"
          :disabled="submitting"
          @click="submit"
        >
          {{ submitting ? t('feedback.submitting') : t('feedback.submit') }}
        </button>
        <p class="mt-2 text-[11px] leading-[1.5]" style="color: var(--color-parchment-dim)">
          {{ t('feedback.noteQueue') }}
          {{ t('feedback.noteComplex') }}
        </p>
      </template>
    </div>
  </div>
</template>
