/**
 * 让 Node 解析「无扩展名」的相对 import —— 补上 Vite 已有、Node 没有的那部分。
 *
 * 为什么要这个文件
 * --------------
 * 源码按 Vite 约定写 `from './query'`（不带 `.ts`），而 `scripts/selftest.mjs`
 * 靠 Node 22 的 type-stripping 直接 import `.ts`。Node 的 ESM 解析器**要求**
 * 完整扩展名，于是 selftest 一碰到跨文件 import 就报 ERR_MODULE_NOT_FOUND。
 *
 * 在此之前 `src/lib/*` 恰好都是零 import 的单文件，所以这个坑一直没露头。
 * 抽出 `lib/query.ts` 共享层后，`search.ts` / `canvasFilter.ts` 立刻互相 import ——
 * 坑就露出来了。两种选择：
 *   A. 源码里写 `from './query.ts'`。Vite 支持，但 `tsconfig` 的
 *      `allowImportingTsExtensions: false` 与之冲突（noEmit 下才允许），
 *      等于为了测试改生产代码的写法。
 *   B. 给 Node 挂解析钩子（这里）。源码保持 Vite 约定，测试环境补齐能力。
 * 选 B：**不让测试设施的需求倒灌进生产代码风格**。
 *
 * 用法（必须在任何 import 目标文件**之前**执行）：
 *   import { installTsResolver } from './ts-resolver.mjs';
 *   installTsResolver();
 *   const m = await import('../src/lib/search.ts');
 *
 * ⚠️ 这个钩子只做一件事：把 `./query` 补成 `./query.ts`。
 *   它**不**做类型检查、不做转译（转译交给 Node 的 type-stripping），
 *   也**不**兜 `.js` → `.ts` 之类的其它映射 —— 那样就成了「什么都能解析」，
 *   写错路径也会被静默兜住，正好是本项目最讨厌的那类闸门失效。
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

let installed = false;

export function installTsResolver() {
  if (installed) return;
  installed = true;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      // 只处理相对路径的裸说明符（`'./x'`、`'../x'`），包名一律走原解析
      if (!specifier.startsWith('.') || specifier.endsWith('.ts')) {
        return nextResolve(specifier, context);
      }
      // 已有扩展名（.js / .mjs / .json）也交回原解析，别插手
      if (/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier, context);

      const parentURL = context.parentURL;
      if (!parentURL || !parentURL.startsWith('file:')) {
        return nextResolve(specifier, context);
      }
      const base = new URL(specifier, parentURL);
      const asTs = new URL(base.href + '.ts');
      if (existsSync(fileURLToPath(asTs))) {
        return { url: asTs.href, format: 'module-typescript', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}
