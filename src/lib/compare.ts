/**
 * 对比差异判定纯函数（2026-10-13 完整采用准绳/Baseline 方案，硬编码审计 A1 的「可测性」纪律：
 * 准绳把差异计算写成纯函数便于单测——CompareService.checkMissing/hasDifference 的移植）。
 *
 * 判据（对照准绳《参比-项目开发规范与定位》§差异对比规则）：
 *   有值 vs 缺失 → 标「缺失差异」；双方都缺 → 不标；相等 → 不标；不等 → 标「值不等」。
 *
 * 为什么要把「缺失」和「不等」拆成**两种标记**：
 *   「这几台真的配置不同」和「这几台里有的官网没公布」是两种完全不同的信息，
 *   混成一种颜色会让用户把「官方未公布」误读成「配置不同」——本数据集 40% 格子是未公布，
 *   这个区分的价值很大（用户 2026-10-13 认可准绳此点做得更好，并要求完整采用）。
 */

/** 缺失占位符（与 fields.ts / CompareView 的「—」一致） */
const MISSING = '—';

interface CompareRowState {
  /** 值不等：**非缺失值**之间不完全相同（缺失不参与值比较——准绳口径） */
  different: boolean;
  /** 缺失差异：同行内既有有值又有缺失（「有值 vs 缺失→标底色」） */
  missing: boolean;
}

/**
 * 判定一行对比的标记状态。values 是该行各机型的**展示字符串**（缺失已表示为 MISSING）。
 * - 全缺失 → neither（调用方在「只看差异」模式下会隐藏该行；全 not_applicable 同理）
 * - 全相等（含全同值）→ neither
 */
export function compareRowState(values: string[]): CompareRowState {
  let hasValue = false;
  let hasMissing = false;
  const real = new Set<string>();
  for (const v of values) {
    if (v === MISSING) {
      hasMissing = true;
    } else {
      hasValue = true;
      real.add(v);
    }
  }
  const missing = hasValue && hasMissing; // 只有缺失没有值 → 全缺失，不算缺失差异
  const different = real.size > 1; // 只在有值之间比较：缺失混入会污染相等判断
  return { different, missing };
}

