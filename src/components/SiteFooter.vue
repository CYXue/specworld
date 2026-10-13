<script setup lang="ts">
// 页脚：品牌语一行 + 次要导航 + 许可与出处的三个短链。
//
// 分层的理由：「关于」原本占着主导航一个按钮位，但它是全站访问频率最低的一页
// （内容是项目说明与数据原则，来查参数的人基本不会点它）。
// 把它降到这里之后，主导航从 7 项降到 4 项，宽度 810px → 560px。
//
// ⚠️ **它必须在这里有入口，不能只是「移走」**：
// 孤儿页（本仓库里存在路由、能打开、但没有任何导航能到达）是最难发现的一类缺失——
// 搜索引擎能进来，用户走不进来。页脚这行就是它的唯一常驻入口。
//
// 许可信息为什么也在这：OFL-1.1 要求随字体附带许可、改名版还要披露修改，
// 仓库是 MIT 也不该只在 LICENSE 文件里说。**三行以内说完，完整版在关于页。**
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import PxIcon from './PxIcon.vue';
import { asset } from '../lib/assets';
import { CODE_LICENSE, FONT_NAME, REPO_URL } from '../lib/site';

const route = useRoute();
const { t } = useI18n();
// computed：setup 里直接 t() 抓到的是当次语言的值，切语言不会重算
const links = computed(() => [
  { name: 'about', label: t('footer.about'), to: '/about' },
  { name: 'search', label: t('footer.search'), to: '/search' },
]);
</script>

<template>
  <footer class="pixel-footer mt-10">
    <div class="page-shell flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-4">
      <!-- 次要导航：当前页高亮，否则用户进到「关于」看不出自己在哪 -->
      <nav :aria-label="$t('footer.label')" class="flex items-center gap-3">
        <RouterLink
          v-for="l in links"
          :key="l.name"
          :to="l.to"
          class="flex items-center gap-1 text-[12px] leading-[1.5] text-[var(--color-ink-soft)] hover:text-[var(--color-parchment-dim)]"
          :aria-current="route.name === l.name ? 'page' : undefined"
          :class="route.name === l.name ? 'text-[var(--color-gold)]' : ''"
        >
          <PxIcon :name="l.name === 'about' ? 'info' : 'search'" :size="12" />
          {{ l.label }}
        </RouterLink>
      </nav>
      <p
        class="w-full text-center text-[12px] leading-[1.5] text-[var(--color-ink-soft)] sm:w-auto"
      >
        {{ $t('footer.tagline') }}
      </p>
      <!--
        许可与出处。只给入口不给全文：全文（字体改名说明、商标指称、数据来源）
        在关于页的「许可与署名」里，这里再铺一遍就是每页重复。
        分隔符用「·」字符而非 CSS ::before —— 项目里没有 ::before content 生成正文的先例。
      -->
      <p
        class="flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12px] leading-[1.5]"
      >
        <a class="pixel-link" :href="REPO_URL" target="_blank" rel="noopener noreferrer">
          {{ CODE_LICENSE }} {{ $t('footer.sourceCode') }}
        </a>
        <span class="text-[var(--color-stone)]" aria-hidden="true">·</span>
        <a
          class="pixel-link"
          :href="asset('fonts/OFL.txt')"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ $t('footer.fontLicense') }}
        </a>
        <span class="text-[var(--color-stone)]" aria-hidden="true">·</span>
        <span class="text-[var(--color-ink-soft)]">{{ FONT_NAME }} {{ $t('footer.pixelFont') }}</span>
      </p>
    </div>
  </footer>
</template>
