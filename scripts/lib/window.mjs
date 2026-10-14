import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 收录窗口起点 —— 全站唯一真源。
 *
 * 两处消费方必须都从这里引，禁止再写字面量副本：
 * - scripts/sync/index.mjs   窗口过滤闸门（权威判定，可被 env WINDOW_START 覆盖）
 * - scripts/normalize/index.mjs 苹果对比矩阵通道的预剪枝（在进 sync 前先丢老机型）
 *
 * 历史教训：两处各写一份 '2024-09-01' 字面量，改窗口时漏一处会导致
 * 「normalize 说在窗口内、sync 闸门又丢掉」的静默分叉。
 */
export const WINDOW_START = '2024-09-01';

/** 精度不足的日期落在这个缓冲区内时，标记为「窗口边界不确定」而不是悄悄收录 */
export const WINDOW_FUZZ_DAYS = 45;

/** sync 闸门用的可覆盖取值：env WINDOW_START 优先，否则用真源默认值 */
export const windowStartEffective = () => process.env.WINDOW_START ?? WINDOW_START;

/** 项目根目录（scripts/lib 的上一级再上一级） */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
