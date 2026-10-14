<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import PxIcon from '../components/PxIcon.vue';

const { t } = useI18n();
</script>

<template>
  <div
    class="page-shell flex min-h-[50vh] flex-col items-center justify-center gap-4 py-16 text-center"
  >
    <h1 class="pixel-outline font-pixel text-[36px] leading-[1.4]">404</h1>
    <p class="text-[24px] leading-[1.5]" style="color: var(--color-parchment-dim)">
      {{ t('notFound.title') }}
    </p>
    <RouterLink
      to="/"
      class="pixel-button flex items-center gap-2 px-4 py-2 text-[12px] leading-[1.5]"
    >
      <PxIcon name="home" :size="12" />
      {{ t('brand.backToPlaza') }}
    </RouterLink>
  </div>
</template>
