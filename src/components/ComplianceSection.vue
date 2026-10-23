<script setup lang="ts">
import { computed } from 'vue';
import type { Product } from '../types';
import { categoryOf } from '../lib/catalog';
import { schemaForCategory } from '../lib/fields';

/**
 * 合规认证展示区（详情页专属节，不进通用 specGroups）：
 * 工信部进网许可 / SRRC 型号核准 / 产地 / 环保使用期限 / SAR / 能效等级——
 * 这些是监管申报口径的「铭牌信息」，与普通参数分开陈列，并给官方验真入口。
 *
 * 渲染纪律：
 * - 字段清单从当前品类 schema 过滤（schema 有才显示，新加监管字段自动进区）；
 * - 官网没公布 = null = 「—」（unknown 四态，绝不显示 0/空串冒充）；
 * - 验真链接只给官方渠道（jwxk.miit.gov.cn / energylabel.com.cn），
 *   不给第三方查询站——来源可信度与 PRINCIPLES 的「官方单源」一致。
 */
const props = defineProps<{ product: Product }>();

/** 监管字段固定顺序（展示顺序，与 schema 注册无关的策展序） */
const REG_PATHS = [
  'device.ctaNo',
  'device.srrcId',
  'device.origin',
  'device.envUsePeriod',
  'device.sarHeadWkg',
  'device.sarBodyWkg',
] as const;

const rows = computed(() => {
  const schema = schemaForCategory(categoryOf(props.product));
  const fieldByPath = new Map(schema.fields.map((f) => [f.path, f]));
  const specs = props.product.specs ?? {};
  const out: { label: string; value: string | null; unit: string | null }[] = [];
  for (const path of REG_PATHS) {
    const f = fieldByPath.get(path);
    if (!f) continue; // 品类 schema 没注册就不显示（老快照安全）
    const v = specs[path];
    out.push({
      label: f.label,
      value: v == null ? null : String(v),
      unit: f.unit ?? null,
    });
  }
  // 能效等级：仅目录内品类 schema 注册了 power.ratingLevel 才显示
  const energy = fieldByPath.get('power.ratingLevel');
  if (energy) {
    const v = specs['power.ratingLevel'];
    out.push({ label: energy.label, value: v == null ? null : String(v), unit: null });
  }
  return out;
});

/** 苹果 RF 暴露页直链（有 identifier 才给——官方 SAR 报告的验真入口） */
const rfExposureUrl = computed(() => {
  const p = props.product;
  if (p.brand !== 'apple') return undefined;
  const id = (p.specs ?? {})['device.identifier'];
  return typeof id === 'string' && id ? `https://regulatoryinfo.apple.com/rfexposure/${encodeURIComponent(id)}/en` : undefined;
});

const verifyLinks = computed(() => [
  { label: '进网许可验真（工信部）', href: 'https://jwxk.miit.gov.cn/licenseNoQuery' },
  { label: '能效标识备案（能效标识网）', href: 'https://www.energylabel.com.cn' },
  ...(rfExposureUrl.value ? [{ label: 'RF 暴露报告（Apple）', href: rfExposureUrl.value }] : []),
]);
</script>

<template>
  <section class="card overflow-hidden">
    <h3
      class="border-b border-border bg-surface-2 px-4 py-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-dim"
    >合规认证</h3>
    <dl class="divide-y divide-border">
      <div
        v-for="r in rows"
        :key="r.label"
        class="flex items-start justify-between gap-4 px-4 py-2.5 text-sm"
      >
        <dt class="shrink-0 text-dim">{{ r.label }}</dt>
        <dd class="text-right" :class="r.value != null ? 'num font-medium text-fg' : 'text-faint'">
          <template v-if="r.value != null">{{ r.value }}<span v-if="r.unit" class="ml-0.5 text-faint">{{ r.unit }}</span></template>
          <template v-else>—</template>
        </dd>
      </div>
    </dl>
    <div class="flex flex-wrap gap-2 border-t border-border bg-surface-2 px-4 py-2.5">
      <a
        v-for="l in verifyLinks"
        :key="l.href"
        :href="l.href"
        target="_blank"
        rel="noopener noreferrer"
        class="badge border border-border bg-surface text-faint transition-colors hover:border-border-strong hover:text-fg"
      >{{ l.label }} ↗</a>
    </div>
  </section>
</template>
