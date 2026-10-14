/**
 * i18n SSR 冒烟的**依赖桥**：把 vue-router 交到与组件同一个模块图里。
 *
 * 为什么需要它
 * ------------
 * vite SSR 管线下，`server.ssrLoadModule('vue-router')`（裸说明符**直调**）
 * 与项目文件内部 `import ... from 'vue-router'` **不是同一个模块实例**
 * （实测两者的 `routeLocationKey` Symbol 不相等——vite 给直调路径解析到了
 * 另一份构建，CJS/ESM 双构建各一份）。
 *
 * 而 vue-router 的注入键按 **Symbol identity** 比较：冒烟脚本若用直调实例
 * 造 router，装到 app 上 provide 的是直调那份 Symbol；App.vue 里 `useRoute()`
 * 注入的是项目图这份 → 注入失败、`route` 为 undefined、`route.name` 在渲染期
 * 抛错，全部路由红，且现场只剩一句「injection Symbol(route location) not found」，
 * 零线索指向真实原因。
 *
 * 处置：**凡要被组件 consume 的依赖，一律经项目文件转手加载**（本文件即转手层），
 * 与 App.vue 走同一条解析路径，Symbol 天然对齐。这是「两份 i18n 实例」
 * （见 i18n-ssr.mjs 头部）之后同一类坑的第三次复发，故固化成文件而不是注释。
 *
 * 冒烟脚本加载方式：`await server.ssrLoadModule('/scripts/smoke/ssr-deps.ts')`。
 */
export { createRouter, createMemoryHistory, routeLocationKey } from 'vue-router';
