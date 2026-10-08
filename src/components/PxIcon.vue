<script lang="ts">
/**
 * 像素图标集（16×16 网格，`shape-rendering: crispEdges` + 整数坐标 = 硬边不糊）。
 *
 * 为什么用 SVG 而不是字符
 * ──────────────────────
 * 站点字体 `pixel-zh.woff2`（Fusion Pixel 子集）**没有** √ ≤ ≥ ⚠ ✓ ✗ 这几个字形。
 * 用字符写就会静默回退到系统字体 —— 恰好在「图标」这种最显眼的地方破功。
 * 所以图标一律走本组件的方块路径，一个像素都不交给字体渲染。
 *
 * 每个图标 = 一串 `M<x> <y>h<w>v<h>h-<w>z` 的实心方块（16×16 网格，原点左上），
 * 用 `<path>` 一次画完；坐标全是整数 → 任何缩放下都不出现半透明边缘。
 */
const PATHS = {
  /** 勾：官网数据抓取成功 */
  check: 'M3 8h2v2H3z M5 10h2v2H5z M7 12h2v2H7z M9 10h2v2H9z M11 8h2v2h-2z',
  /** 叉：抓取失败 */
  cross:
    'M4 4h2v2H4z M6 6h2v2H6z M8 8h2v2H8z M10 6h2v2h-2z M12 4h2v2h-2z ' +
    'M4 10h2v2H4z M6 12h2v2H6z M8 10h2v2H8z M10 12h2v2h-2z M12 10h2v2h-2z',
  /** 右箭头：进入 / 跳转 */
  arrow: 'M3 7h5V5h5v2h-1v2h1v2H8v-2H3z',
  /** 下箭头：展开 */
  arrowDown: 'M5 4h2v5h4V7h2v3h-1v1h-1v1h-1v1H9v-1H8v-1H7V9H5z',
  /** 回车键帽：搜索框提交 */
  enter: 'M2 5h12v1h1v4h-1v1H9v-1h1V9H5v1H4v1H2z',
  /** 放大镜：搜索入口 */
  search:
    'M2 2h7v1h1v1h1v4h-1v1h-1v1H8v1H7v1H2v-1H1v-1H0V3h1V2z M3 4v5h4V4z ' +
    'M9 9h1v1h1v1h1v1h1v1h1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-1H9z',
  /** 警告三角 */
  warn:
    'M7 1h2v2h1v2h1v2h1v2h1v2h1v1h1v1H0v-1h1v-1h1v-2h1V8h1V6h1V4h1V2h1z ' +
    'M6 7h4v1H6z M6 9h4v1H6z M6 11h3v1H6z',
  /** 方块：状态指示（替代 rounded-full 圆点） */
  dot: 'M5 5h6v6H5z',
  /** 关闭 × */
  close:
    'M3 3h2v2H3z M5 5h2v2H5z M7 7h2v2H7z M9 5h2v2H9z M11 3h2v2h-2z ' +
    'M3 11h2v2H3z M5 9h2v2H5z M9 9h2v2H9z M11 11h2v2h-2z',
  /** 齿轮：重置视图 */
  gear: 'M6 1h4v2h2v2h2v4h-2v2h-2v2H6v-2H4v-2H2V5h2V3h2z M6 6v4h4V6z',
  /** 图片：导出 PNG */
  image: 'M1 2h14v12H1z M2 3v8l3-3 2 2 3-4 4 5V3z M10 4h3v2h-3z',
  /** 排序：上下箭头 */
  sort: 'M3 2h2v8H3z M3 12h2v2H3z M6 5h6v2H6z M6 9h6v2H6z M12 2h2v8h-2z M12 12h2v2h-2z',
  /** 地球经纬：设备球 */
  globe: 'M4 1h8v1h2v2h1v8h-1v2h-2v1H4v-1H2v-2H1V4h1V2h2z ' + 'M3 6h10v4H3z M6 2v12h4V2z',
  /** 网格：无限画布 */
  grid: 'M1 1h6v6H1z M9 1h6v6H9z M1 9h6v6H1z M9 9h6v6H9z',
  /** 时钟：时间线 */
  clock:
    'M6 1h4v1h2v2h1v2h1v4h-1v2h-1v2h-2v1H6v-1H4v-2H3v-2H2V6h1V4h1V2h2z ' + 'M7 4v5h2V7h1v1H8v2H7z',
  /** 奖杯：榜单 */
  trophy:
    'M4 1h8v1h1v5h-1v1h-2v2h2v1h1v1h1v3H2v-3h1v-1h1v-1H2V2h2z ' +
    'M4 3v3h3V3z M9 3v3h3V3z M7 10h2v3H7z',
  /** 对比：双列 */
  compare: 'M1 2h6v12H1z M9 2h6v12H9z',
  /** 房子：广场 / 首页 */
  home:
    'M0 7h1V6h1V5h1V4h1V3h1V2h1V1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h-3V9h-1V8h-2v1H8V8H6v1H5V8H3v1H2v1H0z ' +
    'M3 10h10v5H3z M6 11h4v4H6z',
  /** 信息「i」：关于页 / 项目说明入口 */
  info: 'M7 2h2v2H7z M7 6h2v8H7z',
} as const;

export type IconName = keyof typeof PATHS;
</script>

<script setup lang="ts">
withDefaults(defineProps<{ name: IconName; size?: number | string }>(), { size: 12 });
</script>

<template>
  <svg
    class="px-icon"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    shape-rendering="crispEdges"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>

<style scoped>
.px-icon {
  display: inline-block;
  flex: none;
  vertical-align: -0.125em;
  /* 硬边：抗锯齿会让 1px 斜边发灰，像素风最忌讳这个 */
  shape-rendering: crispEdges;
}
</style>
