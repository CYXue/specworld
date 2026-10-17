<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { setLocale, currentLocale } from '../i18n';
import { REPO_URL, CODE_LICENSE, LICENSE_PATH } from '../lib/site';

const { t, locale } = useI18n();

function toggleLocale() {
  setLocale(locale.value === 'en' ? 'zh-CN' : 'en');
}
</script>

<template>
  <footer class="mt-16 border-t border-border bg-surface">
    <div class="page-shell flex flex-col gap-3 py-8 text-sm text-dim sm:flex-row sm:items-center sm:justify-between">
      <p class="max-w-xl leading-relaxed">
        {{ t('footer.tagline') }}
      </p>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <RouterLink to="/about" class="hover:text-fg">{{ t('footer.about') }}</RouterLink>
        <a :href="`${REPO_URL}/blob/main/${LICENSE_PATH}`" target="_blank" rel="noopener" class="hover:text-fg">
          {{ CODE_LICENSE }} {{ t('footer.sourceCode') }}
        </a>
        <button type="button" class="hover:text-fg" @click="toggleLocale">
          {{ currentLocale() === 'en' ? '中文' : 'English' }}
        </button>
      </div>
    </div>
  </footer>
</template>
