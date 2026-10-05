/**
 * 查询归一化与匹配 —— **零 import 的纯函数**。
 *
 * 为什么要单独抽一个文件：`lib/search.ts`（搜索页）与 `lib/canvasFilter.ts`
 * （无限画布筛选）各有一份 tokenize，两份口径**已经漂移**了 ——
 * 搜索页做了归一化容错，画布没有，于是用户在画布里搜 `mate80` 得到 0 台，
 * 在搜索页搜同一个词却有几台。同一个功能两个答案，比少一个功能更糟。
 *
 * 抽出共享层是唯一能长期锁住口径的办法（两份各自改，下个月必然又漂）。
 * 零依赖是为了让 `scripts/selftest.mjs` 能直接 import 它做护栏，
 * 理由同 board.ts / globe.ts。
 *
 * 口径六条
 * ------------------------------------------------------------
 * 1. **分词后 AND**。输入按空白切分成多个词，每个词都要命中（可在不同字段命中）。
 *    不用 OR：搜「华为 mate」时 OR 会把全部华为机拉出来，等于没筛。
 *    不用编辑距离模糊：站里机型名是官方写法，改一两个字母就给出另一台机
 *    比零结果更糟（用户会以为「这台就是」）。
 *
 * 2. **分隔符容错**：抹平大小写、全角/半角、`空格 - _ · ・ + （）`。
 *    官方写法是 `nova 14 Ultra`，用户会打 `nova14ultra` —— 凭什么要求照抄空格？
 *    数据本身也不一致：`麒麟9020` 与 `麒麟 9020` 在同一数据集里并存。
 *
 * 3. **汉字与非汉字连写要在边界处拆开**。用户打的是「苹果16」「华为mate80」，
 *    不是「苹果 16」「华为 mate 80」。只按空白切分时，「苹果16」是一个整词，
 *    而苹果那一批的机型名是 iPhone、中文只出现在厂商名里，
 *    于是「苹果16」在检索串里找不到 —— 实测 0 台。
 *    修法是把整词按「汉字段 / 非汉字段」拆开，各自都要命中（可命中不同字段）。
 *
 * 4. **纯数字词要守数字边界**。子串匹配让 `mate 1` 命中
 *    `HUAWEI Mate 80 Pro`（芯片名 `麒麟9030 Pro（16 GB RAM 版本）` 里的 "1"）。
 *
 * 5. **精确优先，无果才放宽到整串归一化**。并集会让 `iPhone 1` 命中
 *    `iPhone 16e`（归一化后 `iphone1` 是 `iphone16e` 的子串）。
 *
 * 6. **缺失字段不参与匹配**。官网没公布的芯片名如果当成空串去 `includes`，
 *    空串会被任何查询命中 —— 搜索里最典型的「越搜越多」故障。
 */

/** 一段连续的汉字（基本区 + 扩展 A + 兼容区，够用且不误吃日文假名） */
const HAN_CLASS = '\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff';
/** 需带 `g`：`split` 用它做带捕获组的分隔；单独 `test` 时必须重置 lastIndex */
const HAN_RUN = new RegExp(`([${HAN_CLASS}]+)`, 'g');
/** 无 `g`：整段判断「是否全是汉字」，可安全反复 `test` */
const HAN_RUN_FULL = new RegExp(`^[${HAN_CLASS}]+$`);

/** 常见分隔符（含全角空格 U+3000，NFKC 后变普通空格，由 `\s` 覆盖） */
const SEPARATORS = /[\s\-_·・+（）()［］[\]]/g;

/** 纯 ASCII 数字 */
const PURE_DIGITS = /^\d+$/;

/**
 * 归一化：抹平**分隔符**与**大小写/全角**，但**保留分隔符位置信息**。
 *
 * 为什么不直接 `toLowerCase()`：中文输入法下全角字母数字极常见
 * （`ＮＯＶＡ１４`），而 `toLowerCase` 不管全角，`NFKC` 才管。
 *
 * ⚠️ 只抹**分隔符**，不抹数字与字母本身：`mate70` 命中 `Mate 70 Pro` 是想要的；
 *   若把数字也抹掉，`mate7` 会命中 `mate70`，那是另一个错误。
 */
export function compact(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(SEPARATORS, '');
}

/** NFKC + 小写，但**保留分隔符** —— 数字边界的判据依赖它 */
export function loose(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

/**
 * 把一个「混写词」按汉字边界拆成若干段：`苹果16` → `苹果`、`16`。
 * 不含汉字、或整词就是纯汉字时原样返回。
 *
 * ⚠️ **必须返回全部段，不能只返回汉字段**。
 *   曾经的实现返回 `token.match(HAN_RUN)`（只有汉字段），于是
 *   `苹果16` 被悄悄改成只搜「苹果」→ 13 台、`畅享90` → 6 台（把畅享 80、70X
 *   也拉进来）、`麒麟9020` → 28 台。**一个正则的偷懒换来一批假结果**，
 *   而这类故障零报错。所以这里用 `split`（保留分隔符）而不是 `match`，
 *   并在自测里钉死「段数 + 每段内容」。
 *
 * ⚠️ **拆开是纯粹的放宽，绝不收紧**：拆出的每一段都是原词的子串，
 *   原词若能在检索串里命中，各段必然也都命中。
 *   所以「已能搜到的东西不会因为这个改动搜不到了」这条不变量成立。
 *   selftest 有一条用例专门钉它。
 *
 * ⚠️ 代价是**丢掉了词内顺序**：`华为16` 与 `16华为` 等价。
 *   这是可接受的 —— 反过来保留顺序就必须跨字段拼接（苹果在厂商名里、
 *   16 在机型名里），那是另一套更重的机制，而站内 60 台机的收益不抵它的复杂度。
 */
export function splitRuns(token: string): string[] {
  const flat = loose(token);
  if (!HAN_RUN.test(flat)) return [token];
  // split 带捕获组：分隔符（汉字段）也会出现在结果里，所以要按索引挑
  HAN_RUN.lastIndex = 0;
  const parts = flat.split(HAN_RUN).filter(Boolean);
  // 全是汉字（没有非汉段）→ 原样返回，避免凭空多出重复段
  if (parts.every((p) => HAN_RUN_FULL.test(p))) return [token];
  return parts;
}

/** 空白切分 */
export function tokenize(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** 分词 + 混写词按汉字边界拆分，搜索页与画布的公共入口 */
export function queryTokens(q: string): string[] {
  return tokenize(q).flatMap(splitRuns);
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/**
 * 纯数字词的命中判定（守数字边界）。
 *
 * 判据只问一件事：**紧邻的字符是不是数字**。是就算「命中的是某个更长数字的
 * 一部分」，判否。**字母不算** —— 否则 `麒麟9030` 会被自己前面的 `麟` 否掉。
 *
 *   hay `iPhone 16`，词 `1`  → 紧邻 `6` 是数字 → 拒
 *   hay `iPhone 16`，词 `16` → 紧邻是空格 → 收
 *   hay `麒麟9030 Pro`，词 `9030` → 紧邻 `n` 与空格 → 收
 *   hay `麒麟 8000A`，词 `80` → 紧邻 `0` 是数字 → 拒
 *
 * 多处匹配要往后找 —— 第一次落在数字内部，不等于没有合法落点。
 *
 * ⚠️ 纯数字词**只走这一条通道，不许再回落去 compact 串**。
 *   compact 串已经抹掉分隔符，边界信息全部丢失，回落等于把刚立起来的
 *   守卫从后门放进来（`mate 1` 会重新命中 Mate 80 Pro）。这是本文件最容易
 *   被「顺手加个兜底」破坏的不变量，selftest 有反向用例。
 */
function hitDigits(hay: string, t: string): boolean {
  for (let from = 0; ; from += 1) {
    const at = hay.indexOf(t, from);
    if (at < 0) return false;
    if (!isDigit(hay[at - 1]) && !isDigit(hay[at + t.length])) return true;
  }
}

export interface Matchable {
  /** NFKC + 小写、保留分隔符的检索串 */
  haystack: string;
  /** 抹平分隔符后的检索串 */
  compact: string;
}

/**
 * 精确通道：每个词都要命中。
 *
 * ⚠️ 必须**同时试词的归一化形态** —— 不是多余的保险，是必需的。
 * 真实数据里芯片名两种写法并存：
 *   HUAWEI Mate 80   芯片 = `麒麟9020`
 *   HUAWEI Mate XTs  芯片 = `麒麟 9020`
 * 用户搜「麒麟9020」时若只做字面量匹配，只会命中一台；另外两台被漏掉，
 * 而用户不可能知道官网有三种写法。反过来搜「麒麟 9020」能命中三台 ——
 * **两个本该等价的查询给出不同结果**。实测正是如此（1 台 vs 3 台）。
 */
export function matchExact(d: Matchable, tokens: string[]): boolean {
  return tokens.every((t) => {
    if (!t) return true; // 空词（如纯输入空格）不参与，也不许靠它恒命中
    // 纯数字词守边界，且**不回落**（见 hitDigits 注释）
    if (PURE_DIGITS.test(t)) return hitDigits(d.haystack, t);
    if (d.haystack.includes(t)) return true;
    const c = compact(t);
    return c.length > 0 && d.compact.includes(c);
  });
}

/**
 * 归一化通道：整个查询抹平成一串，在归一化检索串里找。
 *
 * 为什么是「整串」而不是「分词后每词各自归一化」：用户不加分词时
 * （`nova14ultra`）本来就是一个词，逐词归一化等于什么都不做。
 * 而若把带空格的查询也逐词拆开分别归一化，`iphone 1` 就会命中
 * `iPhone 16e` —— 那是精确通道已经挡掉的错，不能在这里放进来。
 */
export function matchCompact(d: Matchable, q: string): boolean {
  const c = compact(q);
  return c.length > 0 && d.compact.includes(c);
}
