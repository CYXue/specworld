<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import { statusLabelOf } from '../lib/catalog';

const props = defineProps<{ status: string }>();

const cls = computed(() => {
  switch (props.status) {
    case 'on-sale':
      return 'bg-success-soft text-success border-success/30';
    case 'upcoming':
      return 'bg-warn-soft text-warn border-warn/30';
    default:
      return 'bg-surface-2 text-faint border-border';
  }
});
</script>

<template>
  <span class="badge border" :class="cls">{{ statusLabelOf(props.status) }}</span>
</template>
