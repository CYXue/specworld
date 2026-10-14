/**
 * favicon 闸门的**反向测**：故意注入故障 → 必须报出 → 改回 → 必须恢复绿灯。
 *
 * 「当前合规态通过」只证明闸门**不误报**，证明不了它**能拦住**。
 * 这条纪律来自用户级 MEMORY；本脚本把 favicon 的判据逐条打一遍。
 *
 * ## 为什么值得单独一个脚本
 * 上一轮就是靠它抓出**两个真缺口**（不是猜出来的）：
 *   1. 已有 5 条判据**全部镜像不变** ⇒ 整个图标左右镜像后 selftest 全绿；
 *   2. 颜色判据只查「有没有 theme 之外的颜色」，**没查谁拿哪个颜色**
 *      ⇒ ink 与 parchment 对调（图标成负片）也全绿。
 * 修完后本脚本 8/8 命中具名判据。
 *
 * ## ⚠️2026-10-08 换构图后本脚本同步重写
 * 用户裁决「完全照参考图」⇒ 产物从「米白底 + 墨环 + 无鱼眼 + 圆占 80%」
 * 换成「纯黑白 + 满幅 45° 斜分 + 两只鱼眼」。
 * **注入必须跟着换** —— 旧注入（挖环、删鱼眼、改底板色）在新产物上
 * 要么文本不变（注入静默失效），要么命中错对象。
 * 这本身就是一条纪律：**判据换了，注入必须同步换，否则反向测是自欺**。
 *
 * ## 三条让反向测本身可信的纪律
 *   1. **断言具名判据**，不是断言「有失败」—— 否则 A 判据误报能让 B 判据看起来通过；
 *   2. **注入有效性自查**：注入后文本没变 ⇒ 报「注入失效」而不是「闸门失效」
 *      （历史上三条注入就是这么废掉的：一条命中了注释里的字面量，
 *        一条选中了圆环上的格子，一条按坐标replace 命中同行的第一个 rect）；
 *   3. **崩溃安全**：先写 `_work/favicon/favicon.bak`，启动时若发现备份就先还原。
 *      进程被 kill 也不会把 `public/favicon.svg` 留在损坏状态。
 *
 * 用法：node scripts/verify-favicon-gates.mjs   （会临时改public/favicon.svg）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tryLock, releaseLock } from './lib/gates-lock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAV = path.join(ROOT, 'public/favicon.svg');
const BAK = path.join(ROOT, '_work/favicon/favicon.bak');

const CASES = [
  {
    name: '墨段与纸两色写反（图标成负片）',
    must: 'favicon 墨段必须是暗色',
    inject: (s) => s.replace(/#000000/g, '#__A__').replace(/#__A__/g, '#ffff00'),
  },
  {
    name: '整体左右镜像',
    must: '白鱼身上的眼', // 其余判据全都镜像不变，只有手性能抓
    inject: (s) => withCells(s, (g) => {
      for (let y = 0; y < g.length; y++) {
        const row = g[y].slice();
        for (let x = 0; x < g.length; x++) g[y][x] = row[g.length - 1 - x];
      }
    }),
  },
  {
    name: '把一只鱼眼填成鱼身色（少一只眼）',
    must: ['favicon 墨色连通成块', '旋转对称', '白鱼身上的眼'],
    inject: (s) => withCells(s, (g) => {
      const n = g.length;
      const c = n / 2;
      // 白鱼身上的眼 = 墨色块，重心在圆心左侧 ⇒ 填掉它
      const x0 = Math.round(c - n * 0.17) - 2;
      const y0 = Math.round(c - n * 0.17) - 2;
      for (let dy = 0; dy < 5; dy++) {
        for (let dx = 0; dx < 5; dx++) {
          if (g[y0 + dy]) g[y0 + dy][x0 + dx] = true;
        }
      }
    }),
  },
  {
    name: '在白鱼身上挖一个墨点（多一个游离碎片）',
    must: ['favicon 墨色连通成块', '旋转对称'],
    inject: (s) => withCells(s, (g) => {
      const n = g.length;
      const c = n / 2;
      // 白鱼身内部 ⇒ 离圆心近、且那一带是浅色
      for (let y = Math.round(c - 2); y <= Math.round(c + 2); y++) {
        for (let x = Math.round(c - n * 0.22); x <= Math.round(c - n * 0.22); x++) {
          if (g[y] && !g[y][x]) g[y][x] = true;
        }
      }
    }),
  },
  {
    name: '斜分背景角度改错（上下对半 ⇒ 四角暗色数变0 或 4）',
    must: 'favicon 背景是 45° 斜分',
    inject: (s) => withCells(s, (g) => {
      const n = g.length;
      // 把「斜分」改成「上下对半」：对角线一侧全涂黑
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (x + y < n - 1) g[y][x] = true;
        }
      }
    }),
  },
  {
    name: '深色占比偏移（把顶部两行涂满）',
    must: 'favicon 深色占比',
    inject: (s) => withCells(s, (g) => {
      for (let x = 0; x < g.length; x++) {
        g[0][x] = true;
        g[1][x] = true;
      }
    }),
  },
  {
    name: '去掉 crispEdges',
    must: 'favicon 必须声明 crispEdges',
    // ⚠️ 必须**只改 <svg> 标签**：产物顶部的说明注释里也写了
    //    `shape-rendering="crispEdges"` 字面量，裸 replace 会先命中注释，
    //    而注释又被判据剥掉 ⇒ 注入「看起来生效了」而产物实际没变。
    //    这是「剥注释」纪律的另一个侧面：**注入也要剥**。
    inject: (s) => s.replace(/(<svg[^>]*?)\s*shape-rendering="crispEdges"/, '$1'),
  },
  {
    name: '去掉 width/height（只剩 viewBox）',
    must: 'favicon 必须有 width/height',
    inject: (s) => s.replace(/(<svg[^>]*?)\s*width="32"\s*height="32"/, '$1'),
  },
  {
    name: '注释里写入连续两个连字符（XML 非法 ⇒ 浏览器整个拒绝渲染）',
    must: 'favicon 必须是合法 XML',
    // ⚠️ 这条注入模拟的是**真实事故**：注释里写了 Markdown 表格分隔线
    // `|---|` 和命令行 `--flag`，而 **XML 注释体内禁止任何 `--`**。
    // 后果不是「某个格子错」，而是**整个图标变破图** —— 最严重的一类。
    //
    // 它之所以能长期逃过所有闸门：本仓对 favicon 的校验全部在**正则层**做
    // （grid / 颜色 / crispEdges / 逐格对拍），正则不关心 XML 合法性。
    //
    // ⚠️⚠️ 锚点**不许硬编码**：本条历史上废过两次 ——
    //  ① 写 `## 一、`，那是米白构图时期的头部注释锚点，换构图后已退役；
    //  ② 改成 `构图：满幅`，而产物里实际写的是 `favicon：满幅`（我又凭记忆改的）。
    // 两次都是同一个病：**注入锚点与产物文案靠人工同步**，
    // 任何一次改注释都会让它静默失效，而脚本报「注入无效」，
    // 读起来完全像闸门的锅。
    //
    // 修法：锚点从产物里**现取**（取第一段注释的第一行），
    // 于是改注释永远不会让这条注入失效。
    //
    // ⚠️⚠️ 注入内容必须是**真正非法**的：
    // 第一版我图省事写了 `|  =  |`（正是产物注释里推荐的安全写法）⇒ 文本变了但
    // XML 仍合法 ⇒ selftest 正确地全绿 ⇒ 报「无闸门覆盖」。
    // **注入必须制造真故障，不能制造「看起来像故障的东西」** ——
    // 否则你测的是「闸门会不会误报」，不是「闸门能不能拦住」。
    inject: (s) => {
      const anchor = s.match(/<!--\n([^\n]*)/)?.[1];
      if (!anchor) throw new Error('产物没有头部注释，锚点无从取用');
      return s.replace(anchor, `  |------|\n  --flag=x\n\n  ${anchor}`);
    },
  },
];

/** 通用注入 helper：解析网格 → 让调用方改 → 重排 run 写回（保留注释与 svg 标签）。
 *
 *  ⚠️ 新构图**没有底板 rect**（满幅斜分 ⇒ 每格都属于图形本身）。
 *  这里**不要**顺手补一条底板 —— 补了会让「缺底板」这类注入变得测不出来，
 *  而底板恰恰是旧构图的关键部件（P25：判据与产物要同步退役，不是留个空壳）。
 */
function withCells(s, mutate) {
  const body = s.replace(/<!--[\s\S]*?-->/g, '');
  const n = Number(body.match(/viewBox="0 0 (\d+)/)?.[1]);
  const g = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const m of body.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1"/g)) {
    for (let i = 0; i < Number(m[3]); i++) g[Number(m[2])][Number(m[1]) + i] = true;
  }
  mutate(g);
  const runs = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!g[y][x]) { x++; continue; }
      let w = 1;
      while (x + w < n && g[y][x + w]) w++;
      runs.push(`  <rect x="${x}" y="${y}" width="${w}" height="1" fill="#000000"/>`);
      x += w;
    }
  }
  const cut = s.indexOf('-->');
  const head = cut >= 0 ? s.slice(0, cut + 3) : '';
  const tag = s.slice(cut + 3).match(/<svg[^>]*>/)?.[0]
    ?? `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">`;
  return `${head}\n${tag}\n${runs.join('\n')}\n</svg>\n`;
}

function runSelftest() {
  try {
    const out = execFileSync(process.execPath, ['scripts/selftest.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // 本进程正持有锁（产物就是它改坏的）⇒ 子进程必须走旁路，
      // 否则 selftest 会因「读到中间态」而退出 2，全部注入被误判成闸门失效。
      env: { ...process.env, FAV_GATES_CHILD: '1' },
    });
    return { failed: false, out };
  } catch (e) {
    return { failed: true, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

fs.mkdirSync(path.dirname(BAK), { recursive: true });

// ── 第 0 步：互斥（必须**先于**备份残留检查，顺序反了就有新 bug）─────────────
// 反向测期间磁盘上的产物是**坏的**，任何并发读者都会得出错误结论。
// 真实事故：与 `verify-favicon.mjs` 并行跑时，对拍报「抓到 0 格」（单跑两条都对）。
//
// ⚠️ 顺序纪律：**先拿锁，再看备份残留**。
// 若先查备份、并发的第二个 gates 会把「第一个 gates 正在写的备份」
// 当成「上次崩溃的残留」还原掉 —— 那是**正在进行的注入**，不是垃圾，
// 还原它等于把对方的实验搅黄，且两边都还报绿灯。
if (!tryLock()) {
  console.error('❌ 已有反向测在跑（或上次崩溃留下锁），本次不启动。');
  console.error('   两个反向测并发会互相还原对方的注入 ⇒ 结论全是假的。');
  console.error('   若确认没有进程在跑，删掉：rm _work/favicon/gates.lock');
  process.exit(2);
}

// ── 第 1 步：崩溃安全。走到这里说明锁是**自己刚拿的** ⇒ 备份只可能是残留 ──
// 否则进程被 Ctrl-C / kill 时，public/favicon.svg 会**停在损坏状态**，
// 而它是被 git 跟踪的文件 ⇒ 下次提交就把负片图标提交进去了。
if (fs.existsSync(BAK)) {
  fs.copyFileSync(BAK, FAV);
  fs.rmSync(BAK);
  console.log('⚠️ 发现上次遗留的备份，已先还原 public/favicon.svg\n');
}

const ORIG = fs.readFileSync(FAV, 'utf8');
fs.writeFileSync(BAK, ORIG);

let bad = 0;
let baselineFailed = false;
// `catch` 只是为了让「基线失败」那个 throw 有个落点：
// finally 已经把产物、备份、锁都清干净了，所以这里不能再报别的错。
try {
  // 基线：必须全绿，否则后面的「报出」无从判断
  const base = runSelftest();
  if (base.failed) {
    console.log('❌ 基线就失败 —— 先修好现状再谈反向测');
    console.log(base.out.split('\n').slice(-20).join('\n'));
    // ⚠️ 这里**不能**写 process.exit(1)：那会跳过 `finally`，
    // 锁文件与备份双双残留 ⇒ 之后所有读者都被自己的锁挡住、也再不能反向测。
    throw new Error('基线失败');
  }
  console.log(`✅ 基线全绿\n`);

  for (const c of CASES) {
    const mutated = c.inject(ORIG);
    if (mutated === ORIG) {
      console.log(`  ❌ ${c.name}：注入无效（文本没变）—— 注入本身失效，不能算闸门的锅`);
      bad++;
      continue;
    }
    fs.writeFileSync(FAV, mutated);
    const r = runSelftest();
    fs.writeFileSync(FAV, ORIG);
    if (!r.failed) {
      bad++;
      console.log(`  ❌ ${c.name}：selftest 仍全绿 ⇒ 这类故障无闸门覆盖`);
      continue;
    }
    // ⚠️ `must` 允许是数组：改构图类注入常引发**连锁失败**
    //（填掉一只眼会同时破坏旋转对称与手性，这是**正确**行为，
    //  但若只认一条具名判据，就会把「闸门抓到了」误判成「闸门抓错了」）。
    // 纪律：「必须报出」成立即可；「报的是不是最贴切的那条」是次要目标。
    const wants = c.must == null ? [] : [].concat(c.must);
    const hit = wants.length === 0 ? true : wants.some((m) => r.out.includes(m));
    if (!hit) bad++;
    console.log(`  ${hit ? '✅' : '❌'} ${c.name}：selftest 失败` + (wants.length ? `，命中「${wants.join('」或「')}」` : ''));
    if (!hit) {
      const names = [...r.out.matchAll(/❌ \[([^\]]+)\] (.+)/g)].map((m) => m[2]);
      console.log(`     实际报的是：${names.join(' / ') || '(无)'}`);
    }
  }
} catch (e) {
  // ⚠️ `catch` 比 `finally` **先**执行 ⇒ 在这里 process.exit() 同样会跳过清理。
  // 所以只置标志，退出码留到块外给。
  if (e?.message !== '基线失败') throw e;
  baselineFailed = true;
} finally {
  fs.writeFileSync(FAV, ORIG);
  fs.rmSync(BAK, { force: true });
  releaseLock();
}

// 到这里 finally 一定跑过了：产物已复原、备份已删、锁已释放。
if (baselineFailed) process.exit(1);

// 还原自查：不能只相信 finally 跑过了，要**核对文件真的回到原样**
const now = fs.readFileSync(FAV, 'utf8');
if (now !== ORIG) {
  console.log('\n❌ public/favicon.svg 未还原 —— 请 `git checkout public/favicon.svg`');
  process.exit(1);
}
const after = runSelftest();
if (after.failed) {
  console.log('\n❌ 还原后 selftest 仍失败 —— 产物已被改坏');
  process.exit(1);
}

console.log(bad ? `\n❌ 反向测失败 ${bad} 条` : '\n✅ 全部反向测通过，产物已还原且自测仍全绿');
process.exit(bad ? 1 : 0);
