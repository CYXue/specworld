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
    <!-- 字号必须显式：父级链上没有 text-[Npx] 时会一路继承到 body 的 14px，
         而像素风纪律是「只认 12 的整数倍」—— 漏一个类就静默破坏点阵
         （2026-10-14 审计 P2-5：这个 span 曾因漏写 fontSize 让 13 个页面
         各报一处 14px，而闸门只打印不计数，谁都没看见）。 -->
    <span class="mx-0.5 text-[12px] leading-[1.5] text-[var(--color-stone)]" aria-hidden="true"
      >/</span
    >
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
