<script setup lang="ts">
import { t } from '../i18n';
withDefaults(
  defineProps<{
    href?: string;
    label?: string;
    /** 当没有来源链接时，渲染为「官方未公布」灰色状态标签 */
    unpublished?: boolean;
  }>(),
  { unpublished: false },
);
</script>

<template>
  <a
    v-if="href && !unpublished"
    :href="href"
    target="_blank"
    rel="noopener"
    class="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"
  >
    {{ label ?? t('product.sourceLabel') }}
    <span aria-hidden="true">↗</span>
  </a>
  <span
    v-else
    class="badge border border-border bg-surface-2 text-faint"
    :title="t('common.unpublished')"
  >
    {{ t('common.unpublished') }}
  </span>
</template>
