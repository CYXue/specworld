<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { t } from '../i18n';
import { REPO_URL, CODE_LICENSE, LICENSE_PATH } from '../lib/site';

// ── 深色模式开关（纸上数据库 · 夜间纸墨）──
// 真源 = documentElement.dataset.theme；localStorage 只做持久化。
// 默认浅色（数据密集场景的主形态），用户显式选择后记住。
const isDark = ref(false);

onMounted(() => {
  isDark.value = localStorage.getItem('theme') === 'dark';
  document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light';
});

function toggleTheme() {
  isDark.value = !isDark.value;
  document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light';
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
}
</script>

<template>
  <footer class="mt-16 border-t border-border">
    <div class="page-shell flex flex-col gap-3 py-8 text-sm text-dim sm:flex-row sm:items-center sm:justify-between">
      <p class="max-w-xl leading-relaxed">
        {{ t('footer.tagline') }}
      </p>
      <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
        <RouterLink to="/about" class="hover:text-fg">{{ t('footer.about') }}</RouterLink>
        <a :href="`${REPO_URL}/blob/main/${LICENSE_PATH}`" target="_blank" rel="noopener" class="hover:text-fg">
          {{ CODE_LICENSE }} {{ t('footer.sourceCode') }}
        </a>
        <button
          type="button"
          class="hover:text-fg"
          :aria-label="isDark ? t('footer.themeLight') : t('footer.themeDark')"
          @click="toggleTheme"
        >
          {{ isDark ? '☀' : '☾' }}
        </button>
      </div>
    </div>
  </footer>
</template>
