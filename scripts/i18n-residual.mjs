/**
 * 全站 EN 界面「用户可见规格值」残留中文聚合器（单一真源）。
 *
 * 用途
 * ----
 * 1. `node scripts/i18n-residual.mjs` 直接跑 —— 打印当前全站 EN 残留 CJK 片段清单
 *    （作为人工核对与「基线」生成依据）。
 * 2. 被 `scripts/selftest.mjs` import，作为「EN 残留词表不新增」闸门的采集函数，
 *    与 `scripts/i18n-residual-baseline.json` 比对，出现基线外的新词即判失败。
 *
 * 覆盖三个 localizeSpecValue 出口（与 src/lib/glossary.ts 的接入口一致）
 * ----------------------------------------------------------------
 * - specGroups（详情页/对比页参数表）          → fields.ts
 * - chipNameLabel（芯片名：CanvasView / search 建议词） → catalog.ts
 * - facets（筛选条 string 型分面 + 芯片分面）   → facets.ts
 *
 * 不覆盖
 * - DataFeedback 当前值：那是**用户输入**，不是数据派生值，不应进基线。
 * - 品牌名（vendors.nameZh）：走 vendors 数据，不在术语表职责内；扫描刻意不传
 *   brandLabels，使品牌分面回落为拉丁 id（huawei/apple…），避免把「品牌名未本地化」
 *   这种独立问题混进术语表回归闸门。
 *
 * ⚠️ 中文界面（zh-CN）一律原样返回，本脚本恒在 `setLocale('en')` 下采集，
 *   所以只反映英文界面该译未译的残留。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installTsResolver } from './ts-resolver.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 匹配一段连续汉字（含扩展 A / 兼容区）。用 unicode 属性转义，Node 22 原生支持。 */
const HAN_RUN = /[\p{Script=Han}]+/gu;

/** 把字符串里的所有汉字片段收进 set（set 自动去重）。 */
export function collectCJK(str, set) {
  if (typeof str !== 'string' || !str) return;
  HAN_RUN.lastIndex = 0;
  let m;
  while ((m = HAN_RUN.exec(str))) set.add(m[0]);
}

/**
 * 采集全站 EN 界面残留汉字片段（去重后的排序数组）。
 * 设为 async 以便复用 installTsResolver + 动态 import 同一套机制（与 selftest 一致）。
 */
export async function collectResidualTokens() {
  installTsResolver();

  const products = JSON.parse(
    readFileSync(join(ROOT, 'data/products.json'), 'utf8'),
  ).products;

  const I18N = await import(pathToFileURL(join(ROOT, 'src/i18n/index.ts')).href);
  const FIELDS = await import(pathToFileURL(join(ROOT, 'src/lib/fields.ts')).href);
  const CAT = await import(pathToFileURL(join(ROOT, 'src/lib/catalog.ts')).href);
  const FACETS = await import(pathToFileURL(join(ROOT, 'src/lib/facets.ts')).href);

  I18N.setLocale('en');

  const found = new Set();
  for (const p of products) {
    // 1) 参数表
    for (const g of FIELDS.specGroups(p)) {
      for (const r of g.rows) collectCJK(r.value, found);
    }
    // 2) 芯片名（CanvasView 短规格 / search 建议词）
    collectCJK(CAT.chipNameLabel(p.chipset?.name ?? ''), found);
    // 3) 筛选条（各维度分面 label；不传 brandLabels，见文件头说明）
    for (const dim of FACETS.DIMENSION_KEYS) {
      for (const it of FACETS.facetOf(products, dim, products)) {
        collectCJK(it.label, found);
      }
    }
  }

  I18N.setLocale('zh-CN'); // 复位，避免影响调用方后续逻辑
  return [...found].sort();
}

/** CLI：打印残留清单，或 `--write-baseline` 把当前残留写成基线文件。 */
// 用 resolve 比对而不是 import.meta.url 严格相等：Windows 大小写/符号链接
// 会让 pathToFileURL 逐字比较判不中，CLI 分支静默不执行。
const IS_CLI =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (IS_CLI) {
  const tokens = await collectResidualTokens();
  const now = new Date().toISOString();
  const baselinePath = join(ROOT, 'scripts/i18n-residual-baseline.json');
  if (process.argv.includes('--write-baseline')) {
    writeFileSync(
      baselinePath,
      JSON.stringify({ generatedAt: now, count: tokens.length, tokens }, null, 2) + '\n',
    );
    console.log(`已写入基线：${tokens.length} 个残留词 → ${baselinePath}`);
  } else {
    console.log(`全站 EN 残留汉字片段：${tokens.length} 个`);
    console.log(JSON.stringify({ generatedAt: now, count: tokens.length, tokens }, null, 2));
  }
}
