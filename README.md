# 参数世界（specworld）

> 选择更清楚 · Choose with Clarity

把产品参数做成一个**一眼看懂、可核查、不编造**的静态站点。当前范围：

| 项 | 决定 |
|---|---|
| 品类 | **全品类 17 类**（v2 目录，新增品类零代码，见 `docs/UNIVERSAL-CATALOG.md`）：phone / tablet / laptop / desktop / display / wearable / headset / home / audio / media / tracker / network / pda / input / printer / storage / accessory |
| 品牌 | **苹果 + 华为 + 小米** |
| 机型 | **全量收录**（2026-10-25 起，`WINDOW_START = 2000-01-01` 等效全量，机制保留可回退）。两条收录通道：① 官网抓取，官网在售目录全部进站；② 用户数据层 `add-product` **显式收录**——状态（在售/未发售/已停售）区分生命周期。官网已下架的历史机型不在采集范围，见 `docs/HISTORICAL-CATALOG-PLAN.md`（立项中） |
| 形态 | 纯静态站（零后端），已送审 B 站 Toy（slug=specworld） |
| 数据 | 厂商官网规格页为主源，**不做跑分/成绩分**（无可公开核查的第三方成绩源），缺数据一律 `null` |

## 为什么是这个形态

参考项目「AI 大模型世界」已经验证过的三件事，这里照搬：

1. **静态快照 + git 历史**：数据变更频率低（手机一年几场发布会），快照 + 版本历史足够，前端零密钥、零运行时依赖。
2. **档位用分位、不用绝对阈值**：屏幕大小/重量/价格/性能全部取「当前在售池」的分位，三年后不会悄悄失效。
3. **文案由数据套模板生成，不调用 LLM**：「这个价位里屏幕最亮的手机」必须可复现、可追溯到数据。

## 目录

```
docs/DATA-CONTRACT.md   数据契约（唯一字段定义源，先读这份）
docs/CONVENTIONS.md     工程规范（目录职责 / 命名 / 依赖脚本环境变量 / 文档日志 + 交付自检单）
docs/PRINCIPLES.md      不可违背原则（数据诚信 / 闸门 / 指纹 / 依赖源，改动前先读）
docs/COMPARE-DESIGN.md  对比页信息设计定稿（主表/折叠/高亮阈值）
docs/PROBE-FINDINGS.md  官网取数通道探针（华为/苹果可解析性证据）
docs/AUTOMATION-RECIPE.md 自动化发布配方（Actions + Pages + 指纹去重，可迁移到其他项目）
docs/PITFALLS.md 踩过的坑与页面结构假设（取不到时怎么查：8 条结构假设 + 34 条坑（P1–P34）+ 排查决策树）
docs/BENCHMARK-VS-AMW.md 与 ai-model-world 的架构对标（差距在哪、缺什么、为什么不迁 Next.js）
docs/UNIVERSAL-CATALOG.md v2 全品类目录设计（四态 value_status / 显式分组 / 零代码扩品类 recipe）
docs/HARDCODE-AUDIT.md 第一轮全库审计（硬编码/散落字面量）
docs/AUDIT-REPORT-2026-10-13.md 第二轮全库审计（死代码/构建副产品生命周期/导出卫生，修复已入库）
docs/ENGINEERING-REVIEW.md 工程评估（Vite 迁移前历史存档，所提建议已由 REFACTOR-LOG 落地）
docs/REFACTOR-LOG.md 重构落地记录（2026-10-03，11 项建议的迁移过程存档）
docs/SCHEMA-EXTENSIBILITY.md schema 可扩展性分析（品类字段表演进约束）
docs/UNIVERSAL-FIELD-BLUEPRINT.md 全品类字段蓝图（跨品类字段抽象草案）

# 规范化文档体系（三份，按需查阅）
docs/SPEC-AI-MODEL-WORLD.md 参考项目规范提炼（ai-model-world：5 条不可违背原则 + 护栏三层）
docs/SPEC-PARAMETER-WORLD.md 本项目规范提炼（架构三硬规矩 + 指纹组合式 + 各文件纪律）
docs/MIGRATION-HANDBOOK.md **迁移手册**（两项目交集：七条骨架 + 领域无关判据 + 10 条实施踩坑 + 可复制骨架代码）
src/types.ts            前端视图模型（与 data/products.json 对齐）
src/lib/types.ts        管线侧数据契约（Node 侧；与上面同名不同职责，见 CONVENTIONS §1.3）
src/locales/            zh 界面文案字典（中文单语；2026-10-21 移除多语言，en 包已退役）
src/lib/                渲染层逻辑：数据装载、规格分组、能力横条、搜索
src/components/         17 个现代风组件（AppTopNav/ProductCard/FilterBar/CompareTable/…）
src/views/              9 个页面（广场/机型详情/品牌/对比/榜单/时间线/搜索/关于 + 404）
src/router/index.ts     hash 路由（Toy 挂在子路径下，history 模式会失效）
scripts/pipeline.mjs    数据层编排（取数→规范化→闸门→指纹）
scripts/sources/        四个官网取数适配器
scripts/normalize/      官网字段 → 契约字段（含纯函数解析层）
scripts/sync/           窗口过滤 + 校验闸门 + 原子写
scripts/editor-server.mjs 后台录入服务（npm run editor；页面在 admin/，不随站点发布）
scripts/lib/foldable.mjs 折叠屏判据**全站唯一真源**（前端 catalog.ts 转出消费）
scripts/archive.mjs     官网原始响应归档（→ data/raw/，供解析器离线回放）
scripts/sync/queue.mjs  窗口过滤 + 待收录队列（纯函数，自测直接 import）
scripts/sync-public.mjs 构建期把 data/ 同步进 public/（prebuild 自动跑）
scripts/publish/        内容指纹、产物闸门 verify-dist、依赖源规范化 normalize-lock
.github/workflows/      每 12 小时自动同步 + 每日 Toy 送审
admin/                  后台编辑器（overrides 录入/审核；刻意不放 public/，dist 不携带）
data/categories.json    品类注册表（全品类目录入口：id → schemas/<id>.json）
data/schemas/           各品类字段表（当前仅 phone.json；新增品类 = 加一行 + 加一份字段表）
data/curated/           人工策展数据（facets 分面档位；glossary 术语表已随多语言退役删除）
data/products.json      唯一数据契约产物（提交入库）
data/release-dates.json 发布日期取证表（**curated 数据**，人工核对，必须入库）
data/discovery-pending.json 待收录队列（**curated 数据**，缺发布日期的机型，只在非空时存在）
data/raw/               官网原始响应归档（解析器改坏后离线回放用，入库）
data/.fingerprint       上一次发布的内容指纹指针（入库，CI 靠它判断有无变化）
```

## 一条命令跑通

数据与渲染分两步，因为它们的所有权不同：数据层只用 Node 内置模块（HTML 解析是
手写正则与状态机），渲染层才需要 npm 依赖。

```bash
npm run data                      # = node scripts/pipeline.mjs --data-only
npm ci && npm run build           # = prebuild(sync-public) + vite build + postbuild(产物闸门)
```

`npm run build` 的两头各挂一个钩子，都不是装饰：
`prebuild` 把 `data/` 同步进 `public/`（真源只有 `data/`，`public/` 是构建期拷贝），
`postbuild` 跑 `scripts/publish/verify-dist.mjs` 核对产物能不能真挂上去 ——
入口存在、引用全相对（挂在 `/toy/<slug>/` 下，绝对路径必 404）、零外链、包体 < 50 MB、
数据与精灵确实在里面。任何一条不过就非零退出，坏产物不会流到发布环节。

产物在 `dist/`，零外链、零密钥、零外部脚本。

## 改解析器之前先跑这个

```bash
node scripts/selftest.mjs           # 249 项断言，不联网，1 秒
node scripts/selftest.mjs --verbose # 逐项打印
```

`scripts/normalize/parse.mjs` 里的解析器是纯函数，出错时**不会抛异常**——
它只会安静地把 PWM 调光频率当刷新率、把分辨率当屏幕尺寸，然后一路畅通地发布出去。
校验闸门能挡住数值越界的，挡不住「看起来很合理但取错字段」的。

所以历史事故全部固化成断言了，两次刷新率事故各有一条：

| 事故 | 断言 |
|---|---|
| iPhone 17 的 `2622 x 1206` 被当刷新率 2622 | `事故一：分辨率数字不得被当成刷新率` |
| Mate 70 Air 的 `2160 Hz 高频 PWM 调光` 被当刷新率 2160 | `事故二：PWM 调光频率不得被当成刷新率` |

闸门本身也在被测范围内——它是「拒绝写盘」的唯一防线，它自己写错了防线就漏了。
自测已接进 `.github/workflows/sync.yml` 的第一个 job，不通过则整条管线不启动。

渲染层与管线的纯函数也在被测范围内（`src/lib` 下的零依赖模块）。
它们刻意**不从 `../types` import 类型**，就是为了让 `.mjs` 自测能直接 `await import` 源文件
（node 22 原生 type-stripping）——这类纯函数一旦算错往往静默不报错、只悄悄给错结果，
所以不变量 + 暴力对拍比 golden 快照更硬。

## 真机交互验证：构建成功 ≠ 交互能用

单元测试和产物闸门都抓不到的一类故障：**容器高度塌成 0**。
容器高度若写成固定比例、不随上方内容变化，品类/机型变多后筛选面板换行变高，会把下方整块顶出首屏 ——
指针事件全打在屏幕外，拖不动、点不进，而且零运行时错误。

还有一类只有真机能抓到的：**指针捕获会劫持 click 的 target**。
在 `pointerdown` 里就 `setPointerCapture`，浏览器会把兼容性鼠标事件（`mouseup`）一起重定向到
捕获元素，于是 click 的 target 从设备 `<a>` 变成容器 `<div>` ——
症状是「能拖能缩，但设备**永远点不进去**」，而且不报任何错。
修法是**拖过阈值（6px）才捕获**，纯点击保持不捕获 —— 这条不是建议，交互组件必须真的去拖一遍。


## 体检脚本：回答「为什么是这个结果」

```bash
node scripts/qa/index.mjs              # 一次跑完三个体检 + 摘要
node scripts/qa/why-champion.mjs --detail# 为什么这台是榜首（列出全部竞争者）
node scripts/qa/coverage.mjs --by-brand  # 哪些字段大面积缺数据
node scripts/qa/stale-lineup.mjs         # 池子里有没有过时机型
```

全部**只读、离线、确定性**（同一输入产出同一输出）——「体检」和「修复」必须是两件事，
体检顺手改了数据，就没人信它的结论了。

`coverage.mjs` 会把缺口分成三类，因为这三类的**处置方式完全不同**：

| 类别 | 判据 | 处置 |
|---|---|---|
| ① 结构性 | 一个品牌全有、另一个全无 | 官网不公布。覆盖率门槛已生效，不发奖杯 |
| ② 全站皆零 | 谁都没有 | 去`rawOfficial` 确认官网到底有没有 |
| ③ 同品牌内部分化 | 同一品牌内有的有、有的没有 | **最可疑**，通常是某几种页面写法漏了解析 |

第三类是解析器失手的信号，第一类是官网事实——混在一起看会误判成「大面积数据缺失」。

## 新机没出现？先看待收录队列

新机发布了、官网也抓到了，但站上没有——**不是取数失败，是它缺发布日期**。
发布日期是进站硬条件（排序与生命周期都依赖它），拿不到日期就进不了 `data/products.json`。
2026-10-25 起收录已取消滚动窗口（`WINDOW_START = 2000-01-01` 等效全量，见 `scripts/lib/window.mjs`），
官网在售目录全量进站；用户数据层 `add-product` 是显式收录。

以前这类机器被丢进 `_work/sync-report.json` 就没了，而 `_work/` 在 `.gitignore` 里——
**12 小时后没人知道它存在过**。现在它们进 `data/discovery-pending.json`（入库）：

```json
{
  "count": 1,
  "items": [
    {
      "id": "apple-iphone-99",
      "kind": "missing-date",
      "brand": "apple",
      "nameZh": "iPhone 99",
      "action": "补一条 data/release-dates.json 的取证：{ \"id\": \"apple-iphone-99\", \"date\": \"YYYY-MM-DD\", ... }"
    }
  ]
}
```

`action` 字段把要补的那条取证直接写出来了，照抄即可。补完下次同步这台机器自动进站。

**只有「缺发布日期」这一类入队。** 发布早于窗口起点的是产品侧的决定，不是待办；
官网改版导致抓不到字段的归 `docs/PITFALLS.md` 的排查决策树——
否则队列会变成一个永远清不掉的垃圾场，人就不看了。

> 队列文件里**没有任何时间戳**。同一批待收录项写出的字节必须完全一致，
> 否则「队列没变」永远不成立，CI 每 12 小时制造一次空提交（本项目已因此踩过两次）。

## 解析器改坏了？用归档离线复现

`data/raw/` 存的是**官网原文键值对**（不是 HTML）：

```
data/raw/huawei-official.json     每台一个 slug 的全部原始字段
data/raw/apple-official.json      苹果规格页
data/raw/apple-compare-official.json  苹果对比页
data/raw/apple-prices-official.json   苹果价格通道
```

**为什么不归档 HTML**：全量 HTML 是几十 MB，版本库会被撑爆且不可逆。
参考项目 `ai-model-world` 的 `.gitignore` 第 39 行写着 `/data/raw/` ——它也不入库。
而解析器吃的是 `RawProduct.raw`（章节名 → 页面原文值），归档这个就够，
体积在几百 KB 量级（闸门 4 MB，超了直接拒绝写入）。

```bash
npm run archive          # 从 _work/*.raw.json 归档到 data/raw/
npm run archive:check    # 只比对：归档件与当前 raw 不一致 → 非零退出（CI 可用）
```

`archive:check` 是「官网是不是改版了」的探针：CI 跑同步时如果它报不一致，
说明官网在我们没察觉的时候改了结构。

## 顶栏：一组连续元素，不是两端对齐

顶栏经过一次精简（2026-10-06）。原来它是 **7 个带图标的按钮 + 一个「搜索」按钮**，
在 1080px 下就占满整个宽度，1024px 以下 `flex-wrap` 折成两行，把顶栏撑到两倍高。

四处冗余，每一处都不是「少一个按钮」的问题：

| 原来 | 问题 | 现在 |
|---|---|---|
| 「搜索」按钮 + 搜索框 | 两个入口做同一件事，各占一个按钮位 | 只留搜索框（空回车也能进搜索页） |
| 7 个 12px 图标 | 16×16 网格缩到 12px后多数糊成一团，占约 128px 却读不出信息 | 全删|
| 「对比」 | 名不副实——那页是「机型库 + 对比台」，用户主要为了**筛选**（京东式筛选条 + 价格段） | 正名「机型库」 |
| 「关于」 | 全站访问频率最低的一页，占着主导航的视觉预算 | 移到页脚 |

导航只保留「查数据」一组（使用节奏一致，不必再分组）：

- **查数据**（按钮形态）：广场 / 机型库 / 榜单 / 时间线

**布局上顶栏是居中一整组连续元素，不是「logo 靠左 + 控件靠右」的两端对齐。**
试过 `justify-between` 与 `form` 上 `ml-auto`，宽屏下都会把搜索框甩到容器最右、
与导航之间空出一大段——顶栏元素本来就不多，两端对齐只会让它更散。

### 首页 banner：结构照参考项目重做（208px → 104px）

不只是压高度，**结构也改了**。参照参考项目（ai-model-world）的 `page.tsx`：
标题**压**在天空带上、导航在同一行右侧，而不是把标题排在天空下面。

参考项目自己的注释说明了为什么：

> 早先这里是半屏高的标题海报，进站第一眼看到的是一张封面而不是一个世界，那是错的。

我第一版正是这个错：天空 112px 之上再排 40px 的标题区，
于是**天空变成纯装饰、标题区变成正文**，两段在争同一块地方。

| | 原来 | 现在 |
|---|---|---|
| 顶栏 | 40px（含 logo + 导航） | **首页整条不显示** |
| 天空带 | `clamp(112px,17vh,160px)` | `clamp(76px,11vh,96px)` |
| 标题位置 | 天空**下面**（`pt-4`） | 天空**上面**（压着，作为底板） |
| 导航位置 | 顶栏 | banner 右侧同行（`justify-between`） |
| 天际线剪影 | 与天空等高 | `skylineRatio=0.5` |
| 状态行 | `.pixel-chip`（2px 实心边框） | 「仪器读数」：细边框 + 半透底 + 呼吸灯 |
| 首卡位置 | 248px | **120px** |

四处值得记的：

1. **站名 + 导航本来就该是一组 HUD**。拆成上下两条既多占一行，
   又让它们看起来是两个模块。首页现在 `SiteNav embedded`（`w-full sm:w-auto`，
   窄屏自动换行占满），其余七页仍在顶栏。
2. **首页顶栏要整条隐藏**，不只是藏导航。第一版只藏了导航留着 logo，
   结果 logo 与 banner 里的 h1 **重复**同一句「参数世界」，两行上下挨着。
3. **对齐规则按容器定，不统一**：
   - 顶栏（元素多、搜索框压右）→ 居中一整组连续元素
   - banner（左右各一组）→ `justify-between` 两端对齐
   两者都试过对方的做法，都难看。
4. **状态行必须加半透底**。它压在天空上，而天空底部是暖橙色带（`#e0904a`），
   不加底色那行字在亮色带上读不清。这是抄参考项目「仪器读数」的真实理由，好看是附带的。

### 天空与地面：黑白太极（8段离散色带）

整条 banner 只有**明度**一条轴在说话：从近黑 → 亮灰 → 再暗，
峰值偏上（第 5/8 段），呼应太极两鱼沿斜对角交错的 S 形。

```
#19191c  #38383c  #515258  #63646b▸#73747b  #686970  #56575d  #3b3c40
 L1.0%    L4.0%    L8.5%   L12.8%  L17.5%  L14.2%   L9.6%   L4.5%
```

四个关键点，都是实测踩出来的：

1. **必须在 WCAG 线性亮度空间等差，不能在 sRGB 通道值上等差**。
   第一版按 sRGB 灰阶排（8%→20%→36%…），结果 `#080809` 与 `#141416`
   通道值差 12、**线性亮度却只差 0.5%** —— 肉眼看不出那一档，等于白占一行。
   **sRGB 低亮度端被严重压缩，视觉上的等差在那里不成立。**
   自测里「相邻档线性亮度差 ≥ 2.5%」当场报出。
2. **峰值不能太亮**。标题「参数世界」就压在这档上：线性 L 0.185 时对纯白只有
   4.45:1（AA 差 0.05），压到 0.175 得 4.65:1。
3. **峰值偏上而不是正中**。纯对称只是一条灰带，偏上才有太极的 S 形意味。
4. **地面三层也转灰阶**。原来草层是 `--color-grass: #4a8c3a`（饱和绿），
   在黑白天空下**扎眼得像荧光棒** —— 整条 banner 里唯一的彩色。
   三段层次改靠「顶亮/侧暗」+ 锯齿边区分，不靠色相
   （这本来就是像素风该有的做法：形状与明度说话，颜色只是标识）。

自测守着五条不变量（211项）：离散色带非渐变 / 相邻档线性亮度差 ≥ 2.5% /
先升后降的太极结构 / 每档对白字 ≥ 4.5:1 / banner 内无高饱和色（通道差 ≤ 24）。
最后一条的阈值 24 来自实测——冷调灰带最大差 18，而原草绿差 82，差一个数量级。

> **为什么从彩虹弧换掉**：七条弧在 88px 高的横幅里**每条只有 1~2px**，
> 挤成一道彩色细线，还要靠七种高饱和色与暗底对抗 —— 噪声大于信息量。
> 黑白只靠明度说话，在像素风里最稳。`src/lib/arc.ts`（彩虹几何）已删除，
> 相关断言整组换成上面五条。

### 首屏：首页 hero 208px → 104px（中间态，已被上面那次重构取代）

用户进站第一眼要看到的是内容，不是横幅。原来滚 248px 才见第一张卡片。

|部件 | 原来 | 现在 |
|---|---|---|
| h1「参数世界」 | 36px 字 × 1.4 行高 = 50px | 24px × 1 = 24px |
| 副标题「选择更清楚」 | 24px 字，独立一行 = 36px | 12px，与 chip **并排** |
| 状态 chip | 30px，独立一行 | 24px，顶对齐并排 |
| 纵向 padding | 24px + 16px | 16px + 12px |
| 天空带 | `clamp(160px, 26vh, 260px)` | `clamp(112px, 17vh, 160px)` |
| 地面三层 | 52px | 40px |

h1 降级的理由不是「36px 太大」，而是**它与顶栏 logo 是同一句话**（都是「参数世界」）。
36px 是品牌标识的尺寸，页面内再用一次就是重复强调。像素风字号取 12 整数倍，
24px 是下一个合法档，也正好是页面标题的正确层级。

地面层的压缩保留了三段层次（草/土/石各层内部亮面暗面比例未动）——
地层剖面的表达力来自**层次**而不是厚度。

⚠️ 踩了一次坑：副标题与 chip 并排时用了 `items-center`，而 chip 有 2px 边框、
比 12px 的纯文字高 4px，居中后**顶到副标题上方**（实测 gap = −4px），贴住了 h1。
**高度不同的一行不该用居中对齐**，该用 `items-start`。

首卡位置：248px → **170px**（1080p）。

### 顶栏高度：76px → 40px

原来是**纵向**占空间。实测拆开来，76px 里**一半是装饰**：

| 部件 | 原来 | 现在 |
|---|---|---|
| 底边 + 投影 | 4px + 4px = 8px | 2px + 2px = 4px |
| 纵向 padding | 8px（外层）+ 8px（nav 自己又加一层） | 6px|
| logo 行高 | 24px 字 × `leading-[1.5]` = 36px | `leading-none` = 24px |
| 导航按钮 | `pixel-button` 带 `3px 3px` 投影 → 内容 30px | `.pixel-button-flat` 纯平面 → 26px |

核心那条纪律：**装饰的视觉重量必须与它所在的容器匹配。**
`pixel-button` 的 3px 立体投影读作「厚度」，那是页面里大按钮的加分项；
但顶栏按钮只有 12px 字高，投影让它比文字高 6px，七个排一排就是一条厚带子。
参考项目（大模型世界）的顶栏按钮就是纯平面的——这不是偷懒，是尺度问题。

logo 字号**不能跟着降到 12px**：像素风字号取 12 的整数倍，18px 会被扫描判违规，
而 12px 会让 logo 与导航同字号、品牌标识直接消失（实测截图确认）。
所以保持 24px，只把描边从 2px 收到 1px、外投影从 4px 收到 2px
——**描边也是跟着字号与容器走的**，2px 描边配 24px 字在紧凑顶栏里会让四字连成一片。

实测：**1080px 及以上 40px 单行**，390px 折两行 64px（原来分别 76px / 152px）。
自测里钉住了这个预算（底边/投影各 ≤2px、nav 不得用立体按钮、logo 行高必须是 1），
反向测过：把底边改回 4px 会报出。

> 「关于」移到页脚后，自测里加了一组**路由可达性**断言（防孤儿页）：
> 孤儿页 = 有路由、能打开，但没有任何导航链接能到达。搜索引擎能进来，用户走不进来，
> 而且零报错，冒烟脚本也抓不到（它们只测「已知入口还能用」）。

## 站点结构

渲染层是 hash 路由的 SPA（`#/search` 而不是 `/search`）——因为 Toy 挂在 `/toy/<slug>/` 下，
`history.pushState` 会让分享链接和刷新直接失效。所有路由必须声明在 `/:pathMatch(.*)*` 之前，
通配在 vue-router 里按声明顺序匹配，写晚了会被 404 吃掉。

| 路由 | 组件 | 内容 |
|---|---|---|
| `#/` | `HomeView` | 广场：最新/最贵/最便宜（按品类各取一台）+ 各品牌最新几台 + 各维度第一 |
| `#/brand/:brand` | `BrandView` | 品牌页：按**品类 → 形态 → 系列 → 变体 → 芯片 → 内存 → 年份 → 价格段**筛选（品类置顶、形态第二——折叠屏不是品类是形态，与机型库同一套 `facets.ts` 口径）。苹果系列只分 标准/Air/SE/折叠屏，Pro/Pro Max/Plus 归入变体层；结果区顶部同样有轻量排序条 |
| `#/product/:id` | `ProductView` | 详情页：完整规格 + 能力横条 |
| `#/compare` | `CompareView` | **机型库 + 对比台合一（筛选 = AND 组合，可减员到一排）**：默认列全部 913 台，按 品类/品牌/系列/变体/芯片/内存/年份/**价格段（京东式 ¥0-1999…¥8000+）** AND 组合筛选；顶部有「已选条件」汇总条（可逐个删/一键清空）、京东「高级筛选」式下拉选择器（选定即收起）、计数为 0 的档灰显；勾选加入对比台，勾 1 台看详情、≥2 台并排对比不限台数；结果区顶部另有**轻量单级排序条**（最新/价格/续航/屏幕/轻薄/影像，辅助非主打）。条件/已选/排序全在 URL |
| `#/rankings` | `RankingsView` | **榜单 = 多级排序器（与筛选是两件事）**：对全部 913 台按**优先级链**排序（如「优先大电池 → 再加相机二级排」），永远不减员；四个能力维度一键加为排序级，可增删 / 调优先级 / 切升降序；排序链写进 URL `o` |
| `#/timeline` | `TimelineView` | 全部机型按发布月份铺开的发布史 |
| `#/search` | `SearchView` | 顶栏搜索：分词 AND，只搜机型名/中文名/产品线/芯片/厂商 |
| `#/about` | `AboutView` | **关于页**：项目说明 + 数据与原则（含动态数据快照时间与数据源状态）；原每页底部的「数据与原则」面板已收敛到此页，footer 只留品牌署名 |
| `#/*` | `NotFoundView` | 非法路径不白屏，给出回首页的出口 |

> 注：原「设备球 / 无限画布」两个可视化探索页（球面几何 `globe.ts`、环面几何 `board.ts`、共用筛选 `canvasFilter.ts`、画布导出 PNG、对应 `_smoke-canvas.cjs` / `_smoke-globe.cjs`）已于 2026-10-16 下线，相关源码与脚本已删除。当前站点的交互页仅剩广场 / 机型详情 / 品牌 / 对比 / 榜单 / 时间线 / 搜索。



## 自动化

三条工作流，构成一个「发布后不用人管」的闭环：

| 工作流 | 频率 | 干什么 |
|---|---|---|
| `.github/workflows/sync.yml` → job `sync` | 每 12 小时（UTC 01:40 / 13:40，即北京 09:40 / 21:40） | 抓官网 → 过闸门 → 内容有变化才提交 `data/` |
| 同上 → job `deploy` | 跟在 sync 后面 | 站点内容有变化才发布到 GitHub Pages |
| `.github/workflows/toy.yml` | 每天 UTC 02:30（北京 10:30） | 内容有变化才打包送审 B 站 Toy |

改了取数/建站代码会在 push 时立即验证，不等 12 小时。
两条发布链都是**零凭据优先**：Pages 完全不需要配 Secret；Toy 缺凭据时安静跳过，不制造失败告警。

### 判据是内容指纹，不是 `git diff`

`data/products.json` 里带着 `generatedAt` / `lastSeenAt` / `listedAt` / `fetchedAt`
一串运行时刻字段，每次跑都在变。用它做判据，等于每 12 小时制造一次空提交，
下游的「内容没变就不发布」也一并失效。

`scripts/publish/fingerprint.mjs` 先剥掉这些字段再算：

- **数据指纹** —— 剥掉运行时刻后的快照内容，决定要不要提交
- **站点指纹** —— 数据指纹 × 模板代码哈希，决定要不要发布

所以改模板会发布但不提交快照；改数据两者都会触发；什么都不改则什么都不做。
上次的状态存在入库的 `data/.fingerprint` 里，下次 checkout 时读它做比对。

### 上线前需要你做两件事

1. **GitHub Pages**：仓库 Settings → Pages → **Build and deployment** 区块 → Source 选 **GitHub Actions**。
   零 Secret，配完第一个 12 小时周期就会自动发布，地址是 `https://cyxue.github.io/specworld/`。

   注意：同页面上方那个 **Add a verified domain / Custom domain 输入框不用填**。
   它是给自有域名（比如你自己买的 `specworld.com`）用的可选功能，留空照样能用上面那个 `github.io` 地址。
   把 `cyxue.github.io` 填进去一定会报 `Domain is not a valid public domain` —— 那不是你的域名，
   而且默认地址本来就是白送的，不需要验证。

   另一处易错点：**个人设置（`github.com/settings`）里也有一个 `Pages`，那是账号级的**，
   管的是 `cyxue.github.io` 个人主页站，跟仓库站不是同一套设置。
   要开的是仓库级页面：`github.com/CYXue/specworld/settings/pages`（或仓库页顶部 `Settings` 标签）。
2. **B 站 Toy**（可选）：配 `secrets.TOY_CLI_SESSION_TOKEN` 与 `vars.TOY_ID`，
   方法写在 `toy.yml` 顶部注释里。没配的话这条链会安静跳过，不影响其他两条。

### 失败不会静默

同步或发布失败时，工作流会在同名 issue 下追加评论（不重复开新 issue），
带上失败项、告警与字段覆盖率；`sync-report` 与站点清单会挂到 artifact 上保留 30 天。

## 管线

```
官方取数（scripts/sources）   四路通道：华为规格页 / 苹果规格页 / 苹果对比页矩阵 / 苹果价格
        ↓
规范化（scripts/normalize）  官网字段 → 契约字段，口径判定 + 逐字段 provenance
        ↓
整合（scripts/sync）        窗口过滤（只管官网抓取通道）+ 发布日期回填 + 校验闸门 + 原子写
        ↓
用户数据层（data/overrides.json） 851 条 add-product 显式收录（不过窗口）+ 字段修正
        ↓
发布日期取证（data/release-dates.json） 66 条人工核对（apple 15 / huawei 51），100% 日精度，**入库**
        ↓
data/products.json          913 台（苹果 864 / 华为 49；官网抓取 62 + 用户层显式收录 851）
        ↓
同步（scripts/sync-public）  构建期拷进 public/（真源只有 data/，拷贝不入库）
        ↓
渲染（Vite + Vue3 + TS）    9 个页面 + 17 个现代风组件，Tailwind v4 设计令牌
        ↓
产物闸门（verify-dist）     入口存在 · 引用全相对 · 零外链 · < 50 MB
        ↓
发布封装（scripts/publish）  内容指纹 + Toy 打包
```

## 当前进度

- [x] 数据契约 v0.1（`docs/DATA-CONTRACT.md`）
- [x] 对比页信息设计定稿（`docs/COMPARE-DESIGN.md`）+ 可执行行定义（`src/lib/fields.ts`）
- [x] 官网取数通道探针（`docs/PROBE-FINDINGS.md`）：两家都通，纯 HTTP、无鉴权、无隐藏 JSON API
- [x] 覆盖口径决策：**窗口 2024-09 之后**（两家官网都只保留在售机型规格页，归档站不可达）——窗口只管官网抓取通道；用户数据层 add-product 显式收录不过窗口（苹果老产品线由此进站）
- [x] 范围决策：**不做跑分评分**（手机圈无可公开核查的第三方成绩源），只做客观参数
- [x] 四个适配器（首批口径）：华为规格页 50 台（0 跳过）、苹果规格页 7 台、苹果对比页矩阵 42 列 × 25 组、苹果价格 7 台
- [x] 发布日期取证：`data/release-dates.json` 现 66 条（apple 15 / huawei 51），100% 日精度（curated 数据入库）
- [x] 规范化层：官网字段 → 契约字段，含机型拆分、口径判定、逐字段 provenance
- [x] 跑通管线产出真实 `data/products.json`（首批 62 台，现 913 台）并通过全部校验闸门
- [x] 修复 `refreshHz` 解析污染：旧实现把 PWM 调光频率（1440/2160）与分辨率（2622）当成刷新率，
      已改为子句级解析 + 排除调光/采样 + 区分区间/离散/单值，并在 `sync/validate.mjs` 加了 `[48,240]` 闸门
- [x] 派生层：分位标尺、首页头衔、一句话定位（`scripts/lib/derive.mjs`）
- [x] **渲染层重构为 Vite 6 + Vue 3 + TS + Tailwind v4**（原 mjs 手写模板已退役）：
      遵循 Bilibili Toy 官方推荐栈，`base:'./'` + hash 路由，产物 0.79 MB
- [x] **全站去像素化重构**（2026-10-15/16）：像素风设计语言（渐变天空/像素天际线/像素字体/立绘）
      整体退役，改为现代深色产品数据库风（参考 Linear / Vercel / Arc）：`src/style.css` 重建设计令牌，
      23 个像素组件收敛为 17 个现代组件，9 个页面全部重写，像素字体与立绘管线（`scripts/sprite/`）删除
- [x] 17 个组件 / 9 个页面：广场、机型详情、品牌、对比、榜单、时间线、搜索、关于（关于页承载原 footer 的「数据与原则」）
- [x] （已移除）原「无限画布 / 设备球」可视化探索页、环面/球面几何模块（`board.ts` / `globe.ts` / `canvasFilter.ts`）、画布导出 PNG、对应 smoke 脚本，均已于 2026-10-16 下线。
- [x] **全站搜索**（`src/lib/search.ts` + `SearchView.vue`）：空格分词 AND 匹配，
      查机型名/中文名/产品线/芯片 + 品牌过滤，查询词进 URL query（刷新与分享可还原）
- [x] 全部旧多页 HTML 产物下线：`pipeline.mjs --data-only` 跳过建站层，
      `sync.yml` / `toy.yml` 改为「跑数据管线 → npm ci → npm run build」
- [x] 产物闸门 `scripts/publish/verify-dist.mjs` 取代旧多页校验（8 个固定页路径、
      跨页死链在 SPA 里已不存在，硬套会天天误报）：改查入口、相对路径、外链、体积、数据齐备
- [x] 内容指纹的模板层从 `scripts/**/*.mjs` 换成 `src/**` + 构建配置，
      前端改一个字会正确触发 Pages 重发（2026-10-16：原 `scripts/sprite/**` 随立绘退役移除）
- [x] `package-lock.json` 的 125 条 `resolved` 全部从 npmmirror 换回 registry.npmjs.org
      （GitHub runner 不在国内镜像后面；integrity 是 tarball 哈希，两镜像字节相同故不变）
- [x] 249 项自测 `scripts/selftest.mjs`：解析器、闸门自身、渲染层纯函数都在被测范围内，
      两次刷新率事故各固化成一条断言，CI 第一个 job
      （项数史：285 → 246 系 2026-10-15 去像素化时像素美术用例整节退役；246 → 249 系
      2026-10-17 补 status 枚举闸门与日期形状闸门——数字以 `npm run selftest` 末尾自报为准）
- [x] 全链路编排 `scripts/pipeline.mjs`：一条命令跑通，失败即停不写盘
- [x] 内容指纹 `scripts/publish/fingerprint.mjs`：剥掉运行时刻字段后再算，
      解决「每次跑指纹都变 → 每 12 小时空提交一次」的去重失效问题
- [x] 自动同步 `sync.yml`：每 12 小时 + HTTP 缓存复用 + npm 缓存 + 失败自动开 issue
- [x] 自动发布 GitHub Pages：零凭据，站点内容有变化才发（`sync.yml` 的 `deploy` job）
- [x] 自动送审 B 站 Toy `toy.yml`：每天一次 + 指纹去重 + 缺凭据安静跳过 + 失败开 issue
- [x] 体检脚本 `scripts/qa/`：只读、离线、确定性，回答「为什么是这个结果」
- [x]（已退役）像素立绘：62 张 SVG 由数据几何生成，经 `SpriteImg.vue` 接入多页 —— 2026-10-15 全站去像素化时**整体移除**（源码/脚本/产物全删），此行保留是为让「曾有过」可查，不再是当前能力
- [ ] 扩品牌（小米/OPPO/vivo/荣耀/三星/Google）—— 需要各写一个官网取数适配器
- [x] 首次送审 B 站 Toy（slug=specworld，2026-10-12 打包送审，审核中）；后续由 toy.yml 每日指纹去重自动送审

## 数据侧的两个结构性缺口（不是 bug，是官网决定的）

1. **苹果不公布电池 mAh、RAM、有线充电 W** —— 这些字段在苹果侧全部为 `null`，界面显示「官方未公布」，不做跨品牌比较。
2. **华为 20 台机型没有处理器章节** —— 这些机型 `chipset.name = null`，不从型号名猜芯片。

这两类 `null` 是**官网真没有**，不是解析漏。规范化的 null 计数表里逐台列出了这些机型。
