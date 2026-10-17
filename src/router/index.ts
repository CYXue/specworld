import { createRouter, createWebHashHistory } from 'vue-router';
import { currentSelection } from '../lib/useCompare';
import HomeView from '../views/HomeView.vue';

// ⚠️ 必须用 hash 历史！Toy 挂在 /toy/<slug>/ 下，history.pushState 会破坏分享链接和刷新。
// toy-publish FAQ 明确推荐 hash 模式。
// 路由表单独导出：scripts/smoke/i18n-ssr.mjs 用它拼一个 memory history 的路由做
// 服务端渲染冒烟，避免测试里另抄一份路由表而漏测新增页面。
export const routes = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/brand/:brand', name: 'brand', component: () => import('../views/BrandView.vue') },
  { path: '/product/:id', name: 'product', component: () => import('../views/ProductView.vue') },
  { path: '/compare', name: 'compare', component: () => import('../views/CompareView.vue') },
  { path: '/vs', name: 'vs', component: () => import('../views/VsView.vue') },
  { path: '/rankings', name: 'rankings', component: () => import('../views/RankingsView.vue') },
  { path: '/timeline', name: 'timeline', component: () => import('../views/TimelineView.vue') },
  // /search 放在 '/:pathMatch(.*)*' 之前 —— 通配在 vue-router 里是按声明顺序
  // 匹配的，写晚了 '/search' 会被 404 吃掉。
  { path: '/search', name: 'search', component: () => import('../views/SearchView.vue') },
  { path: '/about', name: 'about', component: () => import('../views/AboutView.vue') },
  {
    path: '/:pathMatch(.*)*',
    name: 'notfound',
    component: () => import('../views/NotFoundView.vue'),
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

// 对比选择随导航保留（2026-10-16 修的真 bug 回归防护）：
// 已选 id 的真源是 URL 的 sel 参数，而 UI 里的跳转全是裸路径 —— 顶栏右上角入口、
// 底部对比栏「查看对比」、产品卡「详情」都不带 sel。跳转后 URL 一丢 sel，
// useCompare 的 watcher 就当场把已选清空（症状：广场页加入对比后点右上角入口，
// 进去对比台是空的）。这里在每次跳转前把当前选择带到目标 query：
//   - 目标自带 sel（分享链接）→ 不覆盖，由 watcher 按链接内容同步；
//   - 没有选择 → 不动，URL 保持干净。
// 注：scripts/smoke/i18n-ssr.mjs 用 routes 自建 memory history 路由做 SSR 冒烟，
// 那道链全新状态无选择，守卫有无都不影响它。
router.beforeEach((to) => {
  if (to.query.sel) return true;
  const sel = currentSelection();
  if (!sel.length) return true;
  return { path: to.path, params: to.params, query: { ...to.query, sel: sel.join(',') }, hash: to.hash };
});

export default router;
