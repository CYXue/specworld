<script setup lang="ts">
import { computed } from 'vue';
import { spriteUrl } from '../lib/assets';

// 精灵图：像素风禁止插值缩放（全局已设 image-rendering: pixelated），
// 待机呼吸 2px，各机错开相位。
const props = defineProps<{ id: string; delay?: number }>();
const src = computed(() => spriteUrl(props.id));
</script>

<template>
  <img
    :src="src"
    :alt="id"
    class="anim-idle"
    :style="{ '--bob-delay': `${delay ?? 0}s` }"
    loading="lazy"
  />
</template>
