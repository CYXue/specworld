/**
 * 自测聚合入口（2026-10-21 由 4672 行单文件拆分而来，纯搬运、断言零改动）。
 * 分域文件在 scripts/selftest/ 下，按原文件分节顺序加载；harness 在 runtime.mjs，
 * 共享声明在 context.mjs。npm run selftest 的行为与项数与拆分前一致。
 */
import { finish } from './selftest/runtime.mjs';

await import('./selftest/01-parse.mjs');
await import('./selftest/02-validate-gates.mjs');
await import('./selftest/03-brands-golden.mjs');
await import('./selftest/04-queue-fingerprint.mjs');
await import('./selftest/05-search.mjs');
await import('./selftest/06-catalog-facets.mjs');
await import('./selftest/07-archive-routes.mjs');
await import('./selftest/08-v2-catalog.mjs');
await import('./selftest/10-misc.mjs');

finish();
