/**
 * 窗口过滤的判据（纯函数，供 scripts/sync/index.mjs 与 selftest 共用）。
 *
 * 为什么单独抽一个文件
 * --------------------
 * 这段逻辑原先内联在 sync/index.mjs 的 main() 里，而 main() 会读文件、写文件、
 * process.exit —— 自测**碰不到它**。而这段判据恰好是「错了也不会报错」的那一类：
 *
 *   - 把「无发布日期」误判成「窗口外」，新机就静默消失，没有任何报错；
 *   - 把「窗口外」误判成「待收录」，队列会塞满正常的老机型，永远清不掉。
 *
 * 两个方向都不会抛异常，所以必须能被断言直接测到。抽出纯函数就是为了让
 * selftest 能构造「必然成立」与「必然不成立」的输入，验证量法本身有效。
 *
 * 三类丢弃的区别（为什么要分开）
 * ----------------------------
 *   missing-date  官网已收录但拿不到发布日期 → 补一条 release-dates.json 即可。
 *                 这是唯一「等人工补一句话就能上线」的一类，**也是本队列存在的全部意义**。
 *   window        发布早于窗口起点 → 产品侧的决定，不是故障。不入队。
 *   parse         规范化层抓不到关键字段（见 PITFALLS A1–A8）→ 官网改版，
 *                 归 PITFALLS 的排查决策树。不入队——入队会变成永远清不掉的垃圾。
 *
 * 队列曾经只写进 _work/sync-report.json，而 _work/ 在 .gitignore 里：
 * 后果是「苹果新机发布了但缺发布日期 → 被丢弃 → 12 小时后没人知道它存在过」。
 */

/** 待收录队列只收这一类 */
const PENDING_KIND = 'missing-date';

/**
 * @param {Array<{id:string, brand:string, name?:string|null, nameZh?:string|null,
 *                slug?:string|null, releaseDate?:string|null, releaseDatePrecision?:string}>} products
 * @param {{windowStart: string, windowFuzzDays?: number}} opts
 *        windowFuzzDays：日期精度不足但压在窗口边界上的缓冲天数（默认 45）
 * @returns {{kept: Array, dropped: Array, pending: Array}}
 *          `kept` 里的对象**可能被就地写入 windowNote**，调用方需知情。
 */
export function classifyByWindow(products, { windowStart, windowFuzzDays = 45 }) {
  const start = Date.parse(windowStart);
  if (Number.isNaN(start)) {
    throw new Error(`classifyByWindow: windowStart 不是合法日期 —— ${JSON.stringify(windowStart)}`);
  }

  const kept = [];
  const dropped = [];
  const pending = [];

  for (const p of products) {
    const t = p.releaseDate ? Date.parse(p.releaseDate) : Number.NaN;

    if (Number.isNaN(t)) {
      dropped.push({ id: p.id, kind: PENDING_KIND, reason: '无发布日期，无法判定是否在窗口内' });
      pending.push({
        id: p.id,
        kind: PENDING_KIND,
        brand: p.brand,
        name: p.name ?? null,
        nameZh: p.nameZh ?? null,
        slug: p.slug ?? null,
        /** 为什么需要人工介入、具体补什么。给人工照着做，不是「失败了」 */
        action:
          `补一条 data/release-dates.json 的取证：` +
          `{ "id": "${p.id}", "date": "YYYY-MM-DD", "precision": "day", ` +
          `"source": "manual", "sourceUrl": "…" }`,
      });
      continue;
    }

    if (t < start) {
      // 日期精度不足（只到月/季）且恰好压在窗口边界上：不能判它出局，
      // 标一个 windowNote 收进来，让人看见「这台到底在不在窗口内」存疑。
      const fuzz = p.releaseDatePrecision !== 'day' && start - t <= windowFuzzDays * 86400000;
      if (fuzz) {
        p.windowNote = `发布日期精度为 ${p.releaseDatePrecision}，恰好压在 ${windowStart} 边界上`;
        kept.push(p);
      } else {
        dropped.push({
          id: p.id,
          kind: 'window',
          reason: `发布于 ${p.releaseDate}，早于窗口起点 ${windowStart}`,
        });
      }
      continue;
    }

    kept.push(p);
  }

  return { kept, dropped, pending };
}

/**
 * 队列文件的内容必须是**纯数据的函数**：同一批待收录项，写出来的字节必须完全一致。
 *
 * 纪律来自项目里踩过的坑：任何 `generatedAt` 都会让文件每次都不一样，
 * 于是「队列没变」永远不成立，CI 每 12 小时制造一次空提交。
 * 所以这里不写任何时间戳，排序也固定（按 id 字典序）。
 *
 * @param {Array} pending classifyByWindow 的 pending
 * @param {{windowStart: string, generatedAt: string}} ctx
 *        generatedAt 只用于**运行时提示**，不写进文件
 */
export function buildQueueFile(pending, { windowStart }) {
  const items = [...pending].sort((a, b) => a.id.localeCompare(b.id));
  return {
    note:
      '待收录队列：官网已抓到这台机器，但它缺发布日期而被窗口过滤丢弃。' +
      '补一条 data/release-dates.json 的取证后它会自动出现在站内。' +
      '本文件不含时间戳——同一批待收录项写出的字节必须一致，否则会造成空提交。',
    windowStart,
    count: items.length,
    items,
  };
}