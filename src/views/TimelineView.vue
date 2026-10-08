<script setup lang="ts">
import { computed } from 'vue';
import { useDataset, useDerived } from '../lib/useDataset';
import SectionFrame from '../components/SectionFrame.vue';
import SpriteImg from '../components/SpriteImg.vue';

const { ds } = useDataset();
const derived = useDerived();

function label(p: { releaseDate: string; releaseDatePrecision: string }) {
  const d = p.releaseDate || '';
  if (p.releaseDatePrecision === 'year') return d.slice(0, 4);
  if (p.releaseDatePrecision === 'month') return d.slice(0, 7);
  return d;
}

const byYear = computed(() => {
  const list = derived.value?.byRelease ?? [];
  const map = new Map<string, typeof list>();
  for (const p of list) {
    const y = (p.releaseDate || '').slice(0, 4) || '未知';
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(p);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
});
</script>

<template>
  <div class="page-shell space-y-6 py-6">
    <SectionFrame title="发布时间线" hud="var(--color-dawn)" icon="clock">
      <p
        class="pixel-note mb-4 px-3 py-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)]"
      >
        日期取自厂商官方发布；精度不足时按年/月展示。
      </p>

      <!-- 年份轴：左侧一条竖直的像素轨道 + 年份方块，替代原来的纯文字小标题 -->
      <div v-for="[year, list] in byYear" :key="year" class="mb-5 last:mb-0">
        <h3 class="mb-2 flex items-center gap-2">
          <span
            class="pixel-chip px-2 py-0.5 text-[24px] leading-[1.5]"
            style="color: var(--color-dawn)"
          >
            {{ year }}
          </span>
          <span class="text-[12px] leading-[1.5] text-[var(--color-ink-soft)]">
            {{ list.length }} 款
          </span>
          <span class="pixel-rule flex-1" />
        </h3>
        <div class="space-y-2">
          <RouterLink
            v-for="p in list"
            :key="p.id"
            :to="`/product/${p.id}`"
            class="pixel-row grid grid-cols-[auto_auto_1fr] items-center gap-3 px-2.5 py-1.5"
          >
            <span
              class="pixel-chip w-20 px-1.5 py-0.5 text-center text-[12px] leading-[1.5] text-[var(--color-parchment-dim)]"
              >{{ label(p) }}</span
            >
            <SpriteImg :id="p.id" class="h-8 w-auto" />
            <span class="flex items-center gap-2">
              <span class="truncate text-[12px] leading-[1.5] text-[var(--color-parchment-lit)]">
                {{ p.name }}
              </span>
              <span
                class="text-[12px] leading-[1.5]"
                :style="{ color: derived?.vendors.get(p.brand)?.accentColor }"
              >
                {{ derived?.vendors.get(p.brand)?.nameZh }}
              </span>
            </span>
          </RouterLink>
        </div>
      </div>
    </SectionFrame>
  </div>
</template>
