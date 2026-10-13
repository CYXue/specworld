<script setup lang="ts">
import { computed } from 'vue';
import { useDataset } from '../lib/useDataset';
import PxIcon from '../components/PxIcon.vue';
import SectionFrame from '../components/SectionFrame.vue';
import { asset } from '../lib/assets';
import { CODE_LICENSE, FONT_NAME, FONT_UPSTREAM_URL, LICENSE_PATH, REPO_URL } from '../lib/site';

// 关于页 = 项目说明 + 数据与原则 + 许可与署名。
// 「数据与原则」原先挂在每个页面底部的 SiteFooter，用户要求收敛到独立关于页，
// 避免在所有页面重复铺开。这里自己取数据源（与 App 同源单例），不再经 props 下钻。
const { ds } = useDataset();

const generatedAt = computed(() => {
  const t = ds.value?.generatedAt;
  if (!t) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
});

const sources = computed(() =>
  Object.entries(ds.value?.sources ?? {}).map(([key, v]) => ({ key, note: v.note, ok: v.ok })),
);

const principles = [
  {
    title: '数据来源：官网规格 + 人工核查',
    body: '主源是各厂商官方规格页；官网未公布的字段，凡能凭可独立核实的来源（监管进网许可、拆解报告、官方说明书）补录的，由人工核查补全并记入用户数据层。所有数据整体标注「来源于厂商官网与人工核查」，不逐条打标。',
  },
  {
    title: '缺失项如实标注「官方未公布」',
    body: '既无法从官网取得、也无可靠独立来源可核实的字段，一律记为缺失、界面显示「官方未公布」，不做估算、不靠机型名反推。榜单只取真实可比字段的极值，不引入第三方跑分。',
  },
  {
    title: '数据诚信是铁律',
    body: '任何标注都必须有出处。折叠屏等形态判定必须有官网原文依据，绝不编造屏幕曲率之类数据源未写的属性；人工补录的字段同样要求注明来源与原因。',
  },
  {
    title: '判据是内容指纹，不是 git diff',
    body: '数据带着一串运行时刻字段，每次跑都在变。先剥掉这些字段再算指纹，保证只有「数据或模板真变了」才触发提交与发布，而不是每 12 小时制造一次空提交。',
  },
  {
    title: '自动化闸门挡在写盘前',
    body: '解析器、校验闸门、几何纯函数全部进自测（196 项），CI 第一个 job 拦截。闸门自身也被反向测试——故意注入违规必须报红、改回必须恢复绿灯，否则绿灯不可信。',
  },
];

/**
 * 许可与署名。分四类，别混成一栏：
 *   代码/数据产物 = 本项目自己的，MIT；
 *   字体          = 第三方 OFL，**改了就得改名 + 披露**，这是 OFL 的硬要求；
 *   数据          = 厂商官网事实数据，没有「许可证」这回事，不能像 CC-BY 数据集那样标；
 *   商标          = 机型名是各厂商的商标，只能指称性使用。
 * 写成一行「数据来自 XX（CC-BY）」是错的 —— 事实数据不适用 CC-BY。
 */
const licenses = [
  {
    name: '源码与脚本',
    terms: `${CODE_LICENSE} 许可`,
    body: '站点代码、数据管线、校验闸门、自测全部开源。',
    links: [{ label: '查看许可证', href: `${REPO_URL}/blob/main/${LICENSE_PATH}` }],
  },
  {
    name: '站点字体',
    terms: 'SIL OFL 1.1',
    body: `本站像素字体 ${FONT_NAME}，是 Fusion Pixel Font 12px 的子集。子集化属上游定义的修改，故按 OFL 要求改名；许可证全文随字体一并分发。`,
    links: [
      { label: '许可证全文', href: asset('fonts/OFL.txt') },
      { label: '上游项目', href: FONT_UPSTREAM_URL },
    ],
  },
  {
    name: '机型数据',
    terms: '厂商官网事实数据 + 人工核查补录',
    body: '参数主源为各厂商官方规格页（属各自的事实性数据，本站不主张额外许可）；官网未公布但可由监管进网许可、拆解报告、官方说明书等独立来源核实的字段，由人工核查补全。无法核实的缺口标注「官方未公布」，不做推算。',
    links: [],
  },
  {
    name: '机型名称与商标',
    terms: '仅作指称性使用',
    body: '页面出现的机型名称与商标归各自所有者所有，此处仅用于标识被描述的对象，不表示关联或背书。',
    links: [],
  },
];
</script>

<template>
  <div class="page-shell space-y-6 py-6">
    <header>
      <h1
        class="pixel-outline font-pixel text-[24px] leading-[1.5] text-[var(--color-parchment-lit)]"
      >
        关于参数世界
      </h1>
      <p class="mt-1 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)]">
        选择更清楚 · Choose with Clarity
      </p>
    </header>

    <SectionFrame title="项目说明">
      <p class="mb-3 text-[12px] leading-[1.6] text-[var(--color-parchment-lit)]">
        参数世界（specworld）是一个把手机参数做成
        <b class="text-[var(--color-gold)]">一眼看懂、可核查、不编造</b>
        的静态站点。首版范围刻意收窄，先把一条数据链路跑通：
      </p>
      <ul class="grid gap-2 sm:grid-cols-2">
        <li
          v-for="row in [
            ['品类', '只做手机（链路跑通后再扩平板 / 手表 / 耳机）'],
            ['品牌', '华为 + 苹果'],
            ['机型', '近 3 年在售（含已停售但属该窗口的机型，用状态区分）'],
            ['形态', '纯静态站，零后端；可另发一份到 B 站 Toy'],
            ['数据', '厂商官网规格页为主源，可核实的缺口由人工核查补录'],
          ]"
          :key="row[0]"
          class="pixel-panel px-3 py-2"
        >
          <span class="pixel-heading text-[12px] leading-[1.5]">{{ row[0] }}</span>
          <span class="ml-2 text-[12px] leading-[1.5] text-[var(--color-parchment-dim)]">{{
            row[1]
          }}</span>
        </li>
      </ul>
      <p class="mt-3 text-[12px] leading-[1.6] text-[var(--color-ink-soft)]">
        为什么是这个形态：手机一年几场发布会、数据变更频率低， 静态快照 + git
        历史足够，前端零密钥、零运行时依赖；
        档位用「当前在售池」的分位而非绝对阈值，三年后也不会悄悄失效； 文案由数据套模板生成、不调用
        LLM，保证「这台是屏幕最亮的手机」之类结论可复现、可溯源。
      </p>
    </SectionFrame>

    <SectionFrame title="数据与原则">
      <ul class="space-y-2">
        <li v-for="p in principles" :key="p.title" class="flex gap-2">
          <PxIcon name="dot" :size="8" class="mt-1 flex-none text-[var(--color-gold)]" />
          <span class="text-[12px] leading-[1.6] text-[var(--color-parchment-lit)]">
            <b class="text-[var(--color-gold)]">{{ p.title }}：</b>{{ p.body }}
          </span>
        </li>
      </ul>

      <div class="mt-4 border-t-2 border-[var(--color-ink)] pt-3">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-[1.5]">
          <span class="pixel-heading">数据快照</span>
          <span v-if="generatedAt" class="text-[var(--color-parchment-lit)]">{{
            generatedAt
          }}</span>
          <span v-else class="text-[var(--color-ink-soft)]">加载中…</span>
        </div>

        <div v-if="sources.length" class="mt-2 flex flex-wrap gap-1.5">
          <span
            v-for="s in sources"
            :key="s.key"
            class="pixel-chip flex items-center gap-1 px-1.5 py-0.5 text-[12px] leading-[1.5]"
            :style="{ color: s.ok ? 'var(--color-newborn)' : 'var(--color-east)' }"
            :title="s.note"
          >
            <PxIcon :name="s.ok ? 'check' : 'cross'" :size="10" />
            {{ s.key }}
          </span>
        </div>
      </div>

      <p class="mt-3 text-[12px] leading-[1.6] text-[var(--color-ink-soft)]">
        参数世界 specworld · 视觉基调参考 Terraria / Minecraft 的方块美学 · 数据诚信优先
      </p>
    </SectionFrame>

    <SectionFrame title="许可与署名">
      <ul class="grid gap-2">
        <li v-for="l in licenses" :key="l.name" class="pixel-panel px-3 py-2">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <span class="pixel-heading text-[12px] leading-[1.5]">{{ l.name }}</span>
            <span class="text-[12px] leading-[1.5] text-[var(--color-parchment-lit)]">{{
              l.terms
            }}</span>
          </div>
          <p class="mt-1 text-[12px] leading-[1.6] text-[var(--color-parchment-dim)]">
            {{ l.body }}
          </p>
          <p
            v-if="l.links.length"
            class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-[1.5]"
          >
            <template v-for="(lk, i) in l.links" :key="lk.href">
              <span v-if="i > 0" class="text-[var(--color-stone)]" aria-hidden="true">·</span>
              <a class="pixel-link" :href="lk.href" target="_blank" rel="noopener noreferrer">{{
                lk.label
              }}</a>
            </template>
          </p>
        </li>
      </ul>
      <p class="mt-3 text-[12px] leading-[1.6] text-[var(--color-ink-soft)]">
        站内立绘由本仓库脚本在构建期生成，未使用第三方美术素材，因此无额外素材署名。
      </p>
    </SectionFrame>
  </div>
</template>
