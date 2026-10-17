<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'lg';
    autofocus?: boolean;
    placeholder?: string;
  }>(),
  { size: 'sm', autofocus: false },
);

const { t } = useI18n();
const router = useRouter();
const q = ref('');

function submit() {
  const term = q.value.trim();
  if (!term) {
    router.push('/search');
    return;
  }
  router.push({ path: '/search', query: { q: term } });
}
</script>

<template>
  <form class="relative w-full" role="search" @submit.prevent="submit">
    <span
      class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
      aria-hidden="true"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" stroke-linecap="round" />
      </svg>
    </span>
    <input
      v-model="q"
      type="search"
      :aria-label="t('nav.searchLabel')"
      :placeholder="placeholder ?? t('nav.searchPlaceholder')"
      :autofocus="autofocus"
      :class="size === 'lg' ? 'h-12 pl-11 pr-4 text-base' : 'h-10 pl-9 pr-3 text-sm'"
      class="input"
    />
  </form>
</template>
