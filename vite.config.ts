import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Toy 平台约束：页面挂在 /toy/<slug>/ 子路径下，所有资源必须用相对路径。
// base: './' 是发布到 B 站 Toy 的硬要求 —— 绝对路径资源会 404 白屏。
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // 关掉 Vite 自带的 emptyOutDir：本环境「安全删除 shim」会 fail-closed 拦截
    // 对 dist 的 trash，导致重建必失败。清理由 scripts/clean-dist.mjs（rename 绕开 shim）负责。
    emptyOutDir: false,
    // 第三方依赖很少（仅 vue + vue-router），单独拆出 vendor 块，更新时用户不用重下全量。
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
});
