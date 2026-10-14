<script setup lang="ts">
/**
 * 语言切换器。全站唯一入口落在 SiteNav（顶栏 + 首页 banner embedded 两种形态
 * 都经过它），不单独放——两处各放一个必然漂移。
 *
 * 自身文案刻意**不进语言包**：按业界惯例各语言写自己的名字
 * （中文按钮写「中文」、英文按钮写「English」）——切换器是给「看不懂当前语言」
 * 的人用的救命入口，译成另一种语言反而认不出来。
 */
import { useI18n } from 'vue-i18n';
import { setLocale, type Locale } from '../i18n';

const { locale } = useI18n();
function pick(l: Locale) {
  setLocale(l);
}
</script>

<template>
  <div class="flex items-center" role="group" aria-label="Language / 语言">
    <button
      type="button"
      class="pixel-button-flat px-1.5 py-0.5 text-[12px] leading-[1.5]"
      :class="locale === 'zh-CN' ? 'text-[var(--color-gold)]' : 'text-[var(--color-parchment-dim)]'"
      :aria-pressed="locale === 'zh-CN'"
      @click="pick('zh-CN')"
    >
      中文
    </button>
    <span class="mx-0.5 text-[var(--color-stone)]" aria-hidden="true">/</span>
    <button
      type="button"
      class="pixel-button-flat px-1.5 py-0.5 text-[12px] leading-[1.5]"
      :class="locale === 'en' ? 'text-[var(--color-gold)]' : 'text-[var(--color-parchment-dim)]'"
      :aria-pressed="locale === 'en'"
      @click="pick('en')"
    >
      English
    </button>
  </div>
</template>
