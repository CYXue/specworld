<script setup lang="ts">
import { computed, ref } from 'vue';
import { spriteUrl } from '../lib/assets';

// 精灵图：像素风禁止插值缩放（全局已设 image-rendering: pixelated），
// 待机呼吸 2px，各机错开相位。
const props = defineProps<{ id: string; delay?: number }>();
const src = computed(() => spriteUrl(props.id));

// 立绘只画手机品类（2026-10-15 六品类扩充，见 scripts/sprite/generate.mjs）。
// 平板/笔记本/台式/手表/耳机没有 sprites/<id>.svg —— <img> 加载失败会显示
// 破图图标，那是「浏览器在报错」而不是「本品类无立绘」的语义表达。
// 加载失败即隐藏：布局靠 w-auto/h-* 自然收缩，列表不会出现空洞的 img 框。
const ok = ref(true);
function onError() {
  ok.value = false;
}
</script>

<template>
  <img
    v-if="ok"
    :src="src"
    :alt="id"
    class="anim-idle"
    :style="{ '--bob-delay': `${delay ?? 0}s` }"
    loading="lazy"
    @error="onError"
  />
</template>
