import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';

// ⚠️ 必须用 hash 历史！Toy 挂在 /toy/<slug>/ 下，history.pushState 会破坏分享链接和刷新。
// toy-publish FAQ 明确推荐 hash 模式。
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/brand/:brand', name: 'brand', component: () => import('../views/BrandView.vue') },
    { path: '/product/:id', name: 'product', component: () => import('../views/ProductView.vue') },
    { path: '/compare', name: 'compare', component: () => import('../views/CompareView.vue') },
    { path: '/rankings', name: 'rankings', component: () => import('../views/RankingsView.vue') },
    { path: '/timeline', name: 'timeline', component: () => import('../views/TimelineView.vue') },
    // /canvas 同样必须排在 '/:pathMatch(.*)*' 之前，理由见下。
    { path: '/canvas', name: 'canvas', component: () => import('../views/CanvasView.vue') },
    // /globe 是球面版：设备贴在球壳上，拖动转球，绕一圈回到原位。
    { path: '/globe', name: 'globe', component: () => import('../views/GlobeView.vue') },
    // /search 放在 '/:pathMatch(.*)*' 之前 —— 通配在 vue-router 里是按声明顺序
    // 匹配的，写晚了 '/search' 会被 404 吃掉。
    { path: '/search', name: 'search', component: () => import('../views/SearchView.vue') },
    { path: '/about', name: 'about', component: () => import('../views/AboutView.vue') },
    {
      path: '/:pathMatch(.*)*',
      name: 'notfound',
      component: () => import('../views/NotFoundView.vue'),
    },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

export default router;
