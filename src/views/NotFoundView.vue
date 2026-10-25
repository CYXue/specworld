<script setup lang="ts">
import { t } from '../i18n';
import { RouterLink } from 'vue-router';
</script>

<template>
  <div class="page-shell flex min-h-[50vh] flex-col items-center justify-center gap-4 py-16 text-center">
    <h1 class="text-4xl font-bold tracking-tight text-fg">404</h1>
    <p class="text-lg text-dim">{{ t('notFound.title') }}</p>
    <RouterLink to="/" class="btn btn-primary">{{ t('brand.backToPlaza') }}</RouterLink>
  </div>
</template>
