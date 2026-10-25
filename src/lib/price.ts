/**
 * 「官方起售价」的唯一真身。
 *
 * 为什么单独拆一个文件：这段三行逻辑曾经被抄了三份（catalog.basePriceCny、
 * facets 里的私有 priceMin、exportSummary.deviceStartPriceCny），而三份的判据**并不一致**
 * —— 前两份要求 `v > 0`，exportSummary 那份只判 `Number.isFinite`，于是
 * 「priceCny 为 0」的档位在导出合计里会被当成真价格算进去，在详情页却是「未公布」。
 * 这正是最难发现的一类故障：两份代码各自都能通过自己的测试，只有交叉对账才暴露。
 *
 * 拆在 `src/lib/price.ts`（而不是让 exportSummary 去 import catalog）是为了保住
 * exportSummary 的「零运行时依赖」——它要能被 scripts/selftest.mjs 直接
 * `await import()` 钉住数字；catalog 拖着 i18n 字典与整张策展表，会把纯计算层拖下水。
 *
 * 口径（改这里等于改全站，selftest「起售价单一真身」用例会看着）：
 *   - 多容量档取**最小值**当起售价；
 *   - 只认有限且为正的价格，`null`（官方未公布中国区售价）返回 `null`；
 *   - **不返回 0**：0 会被「最便宜」榜当成真价格，把没公布的机器排到榜首。
 */
import type { Product } from '../types';

export function basePriceCny(p: Product): number | null {
  const vals = (p.skus ?? [])
    .map((s) => s.priceCny)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return vals.length ? Math.min(...vals) : null;
}
