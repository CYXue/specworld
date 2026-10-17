<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SpecRow, SpecRowState } from '../lib/fields';

defineProps<{ title: string; rows: SpecRow[] }>();

const { t } = useI18n();
/** 已展开采集说明的行（key = 标签） */
const expanded = ref(new Set<string>());
function toggleNote(r: SpecRow) {
  const next = new Set(expanded.value);
  if (next.has(r.label)) next.delete(r.label);
  else next.add(r.label);
  expanded.value = next;
}

/**
 * 三态徽章的视觉权重递减（评审 2026-10-16）：
 *   unpublished  浅灰实底胶囊「官网未公布」——官网真没有，可解释
 *   uncollected  虚线边框胶囊「本站未收录」——采集深度不足，不应据此得出「有 vs 无」
 *   none         纯文字「无」——官网明确写没有（'/'），不是缺失
 */
function badgeClass(state: SpecRowState): string {
  return state === 'uncollected'
    ? 'badge border border-dashed border-border bg-transparent text-faint'
    : 'badge border border-border bg-surface-2 text-faint';
}
function badgeText(state: SpecRowState): string {
  return state === 'unpublished' ? t('common.unpublished') : t('common.uncollected');
}
</script>

<template>
  <section class="card overflow-hidden">
    <h3 class="border-b border-border bg-surface-2 px-4 py-2 text-sm font-semibold text-fg">
      {{ title }}
    </h3>
    <dl class="divide-y divide-border">
      <div
        v-for="r in rows"
        :key="r.label"
        class="flex items-start justify-between gap-4 px-4 py-2.5 text-sm"
      >
        <dt class="shrink-0 text-dim">{{ r.label }}</dt>
        <dd class="text-right" :class="r.state === 'value' ? 'font-medium text-fg' : ''">
          <!-- 缺失三态：官网未公布（实底）/ 本站未收录（虚线）/ 无（纯文字） -->
          <button
            v-if="(r.state === 'unpublished' || r.state === 'uncollected')"
            type="button"
            :class="badgeClass(r.state)"
            class="cursor-help"
            :title="t('common.noteHint')"
            @click="r.note && toggleNote(r)"
          >{{ badgeText(r.state) }}</button>
          <span v-else-if="r.state === 'none'" class="text-faint">{{ t('common.none') }}</span>
          <template v-else>{{ r.value }}</template>
          <!-- 采集说明上浮：数据里「为什么是 null」的取证，点击胶囊展开 -->
          <p
            v-if="r.note && expanded.has(r.label)"
            class="mt-1 max-w-sm text-xs font-normal text-faint"
          >{{ r.note }}</p>
        </dd>
      </div>
    </dl>
  </section>
</template>
