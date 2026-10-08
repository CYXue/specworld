/**
 * 反向测**互斥锁**：反向测会原地改写 `public/favicon.svg`，任何同时读它的脚本
 * 都会读到**中间态**，从而得出**错误结论**（不是崩溃，是谎报）。
 *
 * ##真实事故（本项目踩过）
 * 一次把两条命令并行跑：
 *   - `npm run favicon:gates`  —— 正在原地改写 `public/favicon.svg`
 *   - `node scripts/verify-favicon.mjs` —— 同时读它做逐格对拍
 * 结果对拍报「源去掉 `<g transform>` ⇒ 抓到 **0 格**」。
 *单跑任何一条都是对的（gates 7/7、diff 5/5）。假 failure 的成因很清楚：
 * 七条注入里正好有一条是「整体左右镜像」，于是那一刻磁盘上的产物**就是镜像版**，
 * 而注入文本是「源去矩阵」（= 未镜像）⇒ 未镜像 vs 镜像，本该 212 格不符，却读到
 * 一个已经是镜像的产物 ⇒ 0 格。
 *
 * ## 为什么不能用「读者自己注意点」解决
 * 因为失败是**静默**的：读者不会报错，只会自信地报一个错的数字。
 * 这正是本项目最在意的那类失效（见 `docs/PITFALLS.md` P20/P21/P26）。
 *
 * ## 纪律
 *   - **判据只能有一个真源**：读者脚本一律调`assertUnlocked()`，不要各自实现一遍。
 *   - 拿不到锁就**退出码 2 响亮失败**，绝不降级成 warning 继续跑 ——
 *     「拿不到锁但继续跑」就是「读到中间态还装作没事」。
 *
 * ## 子进程旁路（必须有，否则反向测自己把自己锁死）
 * `verify-favicon-gates.mjs` 持有锁期间要**反复 spawn selftest**。
 * 若selftest 也无条件查锁 ⇒ 7 条注入全部被自己的锁挡住、全部误判为
 * 「闸门失效」—— 一个自锁式死循环，比原来的并发谎报更糟。
 * 所以：持锁方spawn 时显式传 `FAV_GATES_CHILD=1`，selftest 据此跳过查锁。
 * 这个旁路**只认环境变量**（子进程拿不到父进程内存），且必须由持锁方设置。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 锁文件放在 `_work/` 下 —— 它是运行产物，不该进git。 */
export const LOCK = path.join(ROOT, '_work/favicon/gates.lock');

/**
 * 尝试独占。若已被占用返回 false（调用方应据此中止，而不是继续）。
 * 用 `wx` 标志 =「文件已存在就失败」，天然原子，不用自己写锁协议。
 */
export function tryLock() {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  try {
    // 写入 pid + 时间戳：锁残留时能一眼看出是谁留下的、停了多久。
    fs.writeFileSync(LOCK, `pid=${process.pid} at=${new Date().toISOString()}\n`, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

export function releaseLock() {
  fs.rmSync(LOCK, { force: true });
}

/** 读侧闸门：锁存在 ⇒ 磁盘上的产物不可信 ⇒ 退出码 2 响亮失败。 */
export function assertUnlocked(who) {
  // 持锁方主动派生的子进程：它看到的坏产物**正是自己写进去的**，不是竞态。
  if (process.env.FAV_GATES_CHILD === '1') return;
  if (!fs.existsSync(LOCK)) return;
  let owner = '';
  try {
    owner = fs.readFileSync(LOCK, 'utf8').trim();
  } catch {
    /* 读不到就当有锁 */
  }
  console.error(`❌ 反向测正在改写 public/favicon.svg，${who} 读到的会是中间态。`);
  if (owner) console.error(`   持锁：${owner}`);
  console.error('   等它跑完再执行本命令；若确认没有进程在跑，删掉锁文件：');
  console.error(`     rm ${LOCK}`);
  process.exit(2);
}