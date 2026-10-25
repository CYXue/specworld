<script setup lang="ts">
import { ref } from 'vue';
import { t } from '../i18n';

/**
 * 官网原文抽屉（评审 2026-10-16：可核查的落点）。
 * rawOfficial 的键 = 官网页面分段标题，值 = 该段原文。用户拿任何解析值
 * 都能对回官网原话 —— 这一步做完，参数站之间才拉开差距。
 */
defineProps<{ sections: Record<string, string>; specUrl?: string }>();
const open = ref(false);
</script>

<template>
  <div>
    <button type="button" class="btn btn-ghost" @click="open = !open">
      {{ open ? t('product.rawHide') : t('product.rawShow') }}
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex justify-end bg-black/40"
        @click.self="open = false"
      >
        <aside
          class="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-surface p-5 shadow-xl"
          role="dialog"
          :aria-label="t('product.rawTitle')"
        >
          <div class="mb-4 flex items-start justify-between gap-3">
            <h2 class="text-base font-semibold text-fg">{{ t('product.rawTitle') }}</h2>
            <button type="button" class="tag-remove shrink-0" :aria-label="t('common.close')" @click="open = false">×</button>
          </div>

          <a
            v-if="specUrl"
            :href="specUrl"
            target="_blank"
            rel="noopener"
            class="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"
          >{{ t('product.rawSourceLink') }}<span aria-hidden="true">↗</span></a>

          <dl class="space-y-4">
            <div v-for="(text, title) in sections" :key="title" class="card p-3">
              <dt class="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">{{ title }}</dt>
              <dd class="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{{ text }}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </Teleport>
  </div>
</template>
