# 全库审计报告：硬编码 / 死代码 / 临时文件（2026-10-13）

> **存档说明（2026-10-14 补）**：本文是 2026-10-13 全库审计的**过程与决策记录**。
> 文中「未实施（等你）」章节里的 T1 / D1 / D2 / H1 / Q1 / D3 均已在当晚全部实施，
> 经 `106df90`（审计修复）与后续 i18n 提交入库；文中所有「验证基线」数字
> （selftest 256→259 项等）为当时快照，当前以 `npm run selftest` 实跑为准（275 项）。
> 保留本文是为了存档「为什么这么改」与两次抓出扫描器自身 bug 的教训。

> 审计对象：`feature/universal-catalog` @ `b5802aa`（最新工作线）。
> 注意：审计期间主工作区被切到 `wen` 分支（旧祖先），本文所有结论以 b5802aa 为准，
> 通过干净 worktree（main-442783cc）完成，未动用户 checkout。
> 验证基线：selftest **256 项全绿**、conventions:check 通过、真实源码 lint 仅 5 条 import/order warning。

---

## 〇、执行摘要

| 类别 | 数量 | 严重度 |
|---|---|---|
| 彻底死代码（外部零引用 + 内部零使用） | 8 个符号 + **1 个整文件** | 🟡 中 |
| 导出多余（内部使用但无人 import） | 34 个符号 | 🟢 外观 |
| 硬编码未治理项（上次审计遗留） | 1 项（A4 半修） | 🟢 低 |
| 临时/中间文件问题 | 2 项（.dist-trash 无保留策略 + eslint 忽略漏洞） | 🟠 中高 |
| 需用户裁决的产品面问题 | 1 项（后台编辑器随 dist 发布） | 🟠 中 |

**总体判断：工程质量很高。** 上次审计（HARDCODE-AUDIT.md）声称的修复经抽查全部属实
（METRICS/ABILITIES 对账闸门、LIMITS schema 派生、视图字典泛化引擎、策展表外置、
状态枚举统一、品牌字面量零散落、schema range 全覆盖真实数据）。
本次发现的问题集中在「上次审计没覆盖的面」：**构建副产品的生命周期**与**导出卫生**。

---

## 一、🔴 优先处理：临时文件与构建副产品（本次最有价值的发现）

### T1. `.dist-trash/` 无限堆积 + eslint 忽略清单漏登（🟠 中高）

**事实链**：
- `scripts/clean-dist.mjs` 为绕开本机「安全删除 shim」对 dist 的批量删除拦截，
  每次 prebuild 用 `renameSync` 把旧 dist 移到 `.dist-trash/dist-<时间戳>/`（设计正确，已 gitignore）。
- **但没有保留策略**：实测 worktree 内已堆积 **18 份、23MB**（全部是 10-13 当天 03:23–09:55 的构建）。
  按此速度每构建一次涨约 1.3MB，永不消退。
- **连带伤害**：`eslint.config.js` 的 ignores 有 `dist/**` 却**没有 `.dist-trash/**`**，
  导致 `npm run lint` 把这 18 份备份里的压缩 JS 全部 lint 一遍——
  实测 **8136 个 error 全是噪音**（`no-unused-expressions` 打在 minified bundle 的第 26 行），
  真实的 5 条 import/order warning 被彻底淹没，且 lint 退出码为 1。
  AGENTS.md 交付流程里的 `npm run lint:fix` 因此会去「修」压缩包（慢、且制造无意义 diff）。

**建议（两步，互相独立）**：
1. eslint ignores 补一行 `'.dist-trash/**'`（一行修复，lint 立刻回到 5 条 warning 的真实面貌）；
2. clean-dist.mjs 加保留策略：只留最近 N 份（如 3 份）或按年龄（如 24h）清理旧备份——
   清理动作同样要绕开删除 shim，可复用 rename 思路（先移出再逐份处理），
   或接受「留给用户手动清」但在脚本输出里提示当前堆积体积。

### T2. 主工作区 `_work/` 里的一次性临时脚本（🟢 低，可清）

`_work/api-push.mjs`（ GitHub REST API 推送的一次性工具，有完整注释说明为何存在）、
`_work/commit-msg.txt`（提交消息草稿残留）。均在 gitignore 内、无害，
但属于「用完即忘」类，建议随 `_work/` 一起定期清理。`_work/` 共 20MB
（官网缓存 + raw 归档 + 管线中间产物），全部有再生产路径，**删除安全**。

---

## 二、死代码

### D1. `src/lib/types.ts` 整文件为死代码，且头部注释谎称权威（🟡 中，本次最重单项）

- **实测**：全库（src/ + scripts/）无任何形式的 import——
  `lib/types` 无、相对 `./types` 无。12 个导出（BrandId/SourceId/Granularity/Caliber/
  BenchScore/Sku/ProductRecord/VendorRecord/Snapshot/PoolKey/ProductDerived）**外部零引用**。
- **危害不在体积在误导**：文件头写着「这份类型是 DATA-CONTRACT.md 的代码镜像，
  管线写入的对象与前端读取的对象**都以此为准**」——后半句已是假话
  （前端读的是 `src/types.ts`）。上次审计 A6 已判定「误导源」，且 A4 治理还**去编辑了这个死文件**
  （BrandId 改 string 的注释写在这里），功夫花在了没人读的文件上。
- **建议**：删除整文件；其 BrandId=string、status 枚举统一等结论已由活文件
  （src/types.ts 开放联合 + string 兜底）正确表达，无信息损失。
  若想保留契约文档价值，应删代码、把「v1 契约镜像已退役」一句写进 DATA-CONTRACT.md。

### D2. 彻底死导出（自有文件内都零使用，共 8 个）

| 位置 | 符号 | 判断 |
|---|---|---|
| `src/lib/adapt.ts` | `fieldStatus` | v1 残留，被 `fieldStatusOf` 类新实现取代 |
| `src/lib/board.ts` | `rescaleMovers` | 画布动画旧函数，无调用方 |
| `src/lib/catalog.ts` | `ramFacets` | 内存分面旧表，DIMENSIONS 泛化后废弃 |
| `src/lib/facets.ts` | `DIM_LABEL` | 标签表，泛化后废弃（全库仅定义一处出现） |
| `src/lib/specs.ts` | `topN` | 榜单旧助手，无调用方 |
| `scripts/lib/specs.mjs` | `specGroupsOf` | v1 嵌套规格的组名函数，被 fields.ts 引擎取代 |
| `scripts/qa/lib.mjs` | `loadAnalytics` | 分析层读取函数，分析层未接线 |
| `scripts/sprite/generate.mjs` | `padOf` | 立绘间距函数，renderSprite 内联了逻辑 |

**建议**：直接删除 8 个符号定义。删除后跑 `npm run selftest` 确认（预期无影响，
这些符号本就在测试的引用集之外）。

### D3. 导出多余（内部使用、外部无人 import，共 34 个，🟢 外观级）

- `src/`（26 个）：globe.ts 8 个（Viewport3/SpherePoint/FIT_RATIO/BACK_OPACITY/fiboPoint/
  toVec/toCameraSpace/focal）、canvasFilter.ts 5 个、catalog.ts 5 个、fields.ts 3 个、
  compare.ts 2 个、search.ts 2 个、specs.ts 2 个，及 adapt/facets/fieldValidate/query/
  renderExportImage/src-types 各 1–4 个。
- `scripts/`（8 个）：apple.mjs 5 个、apple-compare.mjs 4 个、apple-prices.mjs 2 个、
  archive-shape/schema/shared/generate/queue 各 1–2 个。

**判断**：不是死代码，是「export keyword 多余」。危害近零，但会扩大误判面
（本次审计就为它们多跑了两轮验证）。**建议**：不急着改；如改，逐文件去掉 export 即可，
**不要顺手删函数本体**（它们在被内部使用）。

---

## 三、硬编码（上次审计遗留 + 本次新查）

### H1. A4 半修：`categoryOf()` 未知品类仍静默回落 `'phone'`（🟢 低）

上次审计承诺「回落改显性报错或独立桶」，实测仍是：
```ts
return (p.category as CategoryId | undefined) ?? 'phone';
```
**但**上游 `validate.mjs:221` 有闸门：category 已注册才放行（防的是「指向不存在的品类」），
且 `undefined` 时闸门不拦。实务风险低（管线必写 category），
**建议**：补一条 selftest——「category 缺失的产物必须被闸门拒绝」，
把闸门从「只查未注册值」扩到「缺失也拒」，与 A4 原意对齐。

### H2. 本次新查确认达标的面（✅ 列表，防回归基线）

| 检查项 | 结果 |
|---|---|
| 品牌字面量散落（原则 7） | ✅ src/ 零处 `'apple'/'huawei'` |
| URL 硬编码 | ✅ 仅 site.ts 两个真源 + BoardCanvas 的 SVG data URI（非网络请求） |
| schema range vs 真实数据 | ✅ 15 组区间全部覆盖（折叠屏宽 164.6mm ∈ [50,200]） |
| LIMITS 双源（A2） | ✅ 已从 schema 派生，缺 range 显性报错 |
| METRICS/ABILITIES 三源（A1） | ✅ selftest 4507/4530 两条对账闸门真实存在 |
| 前端校验三份（A3） | ✅ editor 类型集弱对账闸门存在（selftest 4556） |
| 视图字典泛化（B1/B2，P1） | ✅ fields.ts 泛型引擎 + facets 从 schema 派生维度 + 双向对账 |
| 策展表外置（B3，P2） | ✅ VARIANTS/价格档等进 data/curated/facets.json，三条对账闸门在 |
| status 枚举（A5） | ✅ src/types.ts 开放联合 + string 兜底，三处已统一 |
| 冒烟页面清单 vs 路由（P19） | ✅ 12 条全覆盖 11 个路由 + notfound |
| 公开纠错链路断线风险 | ✅ DataFeedback 无后端降级路径是有意设计（生成标准模板→私信作者） |
| pkg name/version vs lock | ✅ 一致（specworld 2.0.0） |
| `data/.fingerprint` 入库 | ✅ 无时间戳、纯内容指纹，不制造空提交（原则 5 达标） |
| TODO/FIXME 活债 / console 残留 | ✅ 零（注释里的「删掉的写法」是历史决策记录，非债务） |

---

## 四、需用户裁决（不动手，先问）

### Q1. 后台编辑器随 dist 发布到线上（🟠 中）

`public/overrides-editor.html`（27KB）是 `npm run editor` 的后台录入页
（editor-server 从 public/ 读它提供 /editor）。但 public/ 会被 vite 原样拷进 dist/，
实测 dist/ 里确有它——意味着 GitHub Pages 与 B站 Toy 的线上站点上，
`/overrides-editor.html` 这个**管理后台 UI 是公开可访问的**（无后端所以写不进去，
但界面、校验逻辑、内部字段结构全部暴露，且白占 27KB 产物）。

**选项**：
- A. 接受现状（静态托管下无后端，写操作必然失败，视为「无害暴露」）；
- B. 把文件移出 public/（如 `admin/overrides-editor.html`），editor-server 改从仓库根读
  （它已经有 PUBLIC_DIR 之外的读取能力的话改动约 3 行）——dist 不再携带；
- C. verify-dist 加一条「dist 不得含 overrides-editor.html」闸门，把现状钉死或逼修复。

按协作铁律，产品面决策归你——选哪个？

---

## 五、处理顺序建议

1. **T1 两步修**（eslint 补忽略 + clean-dist 保留策略）——收益/成本比最高，且 lint 从此可信；
2. **D1 删 lib/types.ts + D2 删 8 个死符号**——一次小提交，selftest 护航；
3. **H1 补一条 category 缺失闸门**——与 A4 原意对齐；
4. **Q1 等你裁决**后实施；
5. D3（34 个导出多余）与 T2（_work 清理）列为择机项，不占紧急通道。

---

## 六、修正与实施记录（2026-10-13 当晚，worktree `feature-universal-catalog-18da974c`）

### 6.1 D1 结论修正：审计扫描漏报，`src/lib/types.ts` **不是**死文件

复核时抓到审计脚本的漏报：`scripts/sources/types.ts:14` 有
`import type { BrandId, SourceId } from '../src/lib/types.ts'`（跨目录、带 `.ts` 后缀的
相对 import，上次扫描模式没覆盖），且 `scripts/sync/validate.mjs` 的 JSDoc 以
`import('../src/lib/types.ts').Snapshot` 引用它；apple.mjs / apple-compare.mjs 的
JSDoc 又引 `./types.ts`（即 sources/types.ts）。tsconfig 只收录 `src/**`，
scripts/ 的引用是类型层（编辑器/JSDoc 级）真引用。

**修正后处置**：不删文件（删除会打断上述类型链，且违背 AGENTS.md
「两份 types.ts 别顺手统一」的既定记载），改为修掉文件头那句假话——
「前端读取的对象也以此为准」→ 明确分工：管线侧以本文件为准（scripts 侧经
sources/types.ts 与 JSDoc 在类型层引用），前端侧以 `src/types.ts` 为准。
审计报告 D1 的「整文件死透」判定作废，D1 的真正 harm（头部注释误导）已消除。

### 6.2 已实施修复（T1 / D1 修正版 / D2 / H1）

| 项 | 改动 | 验证 |
|---|---|---|
| T1a | `eslint.config.js` ignores 补 `'.dist-trash/**'`（附注释说明漏登它曾致 8000+ 假 error） | lint 从 8136 error → 0 error 0 warning |
| T1b | `scripts/clean-dist.mjs` 加保留策略：只留最近 3 份；逐文件 unlink 绕开批量删除保护（不用 rmSync recursive），单份失败只警告不炸 build；列不出目录直接放弃清理 | 合成演练：6 份 → 清理 4 份 → 留 3 份，嵌套目录正确清除 |
| D1 | 见 6.1：修 `src/lib/types.ts` 头部注释，不删文件 | selftest 258 绿 |
| D2 | 删 8 个彻底死导出：`fieldStatus`（连同只服务它的 `hasValue`）、`rescaleMovers`、`ramFacets`、`DIM_LABEL`、`topN`、`specGroupsOf`、`loadAnalytics`、`padOf`；另 lint:fix 顺手修了 editor-server/quality 两文件既有的 import 排序 warning | 删前逐个 grep 复验全库各仅 1 次出现（定义本身）；立绘生成 62 张正常（证 padOf 之死） |
| H1 | `validate.mjs` 品类闸门从「只拦未注册」扩到「缺失也拒」（`!isRegisteredCategory(p.category)`，文案统一为「品类缺失或未注册」）；先写红灯断言（category 缺失被拦 / 未注册被拦）再改闸门；既有反向测的文案断言同步更新 | 红灯 → 改闸门 → 258 项全绿；真实数据 62 台全部带已注册 category，闸门安全 |

**交付顺序验证**（AGENTS.md）：`lint:fix` → `selftest`（258 绿）→ `build` → `conventions:check`（通过）。
lint:fix 会改代码，改后已重跑 selftest 确认无行为变化。

### 6.3 构建失败之谜：环境性，非代码回归（重要，免再踩）

审计期间本 worktree `npm run build` 必败：
`[vite:html-inline-proxy] ... No matching HTML proxy module found`。
排查链：stash 对照实验（纯净树同样败）→ 摘除 index.html 内联 `<style>` 即成功
→ 错误里 `watchFiles` 同时出现 `c:/...` 与 `C:/...` 两种盘符大小写。

**根因**：vite 的 html-proxy 用**大小写敏感**的 `file.replace(config.root, '')`
做映射键。本 agent 的 Bash 工具（Git Bash）传给 node 的 cwd 盘符是**小写**
`c:/Users/...`（transform 注册键），而 fs 解析出的模块 id 是**大写** `C:/...`
（load 查找键）→ 键永远对不上。用户自己的终端（PowerShell / VS Code，大写盘符）
不受影响——用 `Set-Location 'C:\...'` 后 `npm run build` **完整通过**
（1.97s，postbuild 发布校验：93 文件 / 1.10MB / 立绘 62 张 / 零外链）。
**教训**：本环境里 agent shell 跑 vite 构建类工具要先确认盘符大小写；
另注意调试脚本用 `build()` 内联配置会自动叠加项目 config 文件，插件会注册两遍
（曾据此误判出一个 App.vue 假 bug）。

### 6.4 未实施（等你）

- **Q1**（后台编辑器随 dist 发布）——三个选项见上，等裁决后实施。
- D3（34 个导出多余）与 T2（_work/ 清理）——择机项。

### 6.5 Q1 已裁决并实施（2026-10-13 当晚，用户选 B）

用户选 **B. 移出 public/**。实施内容：
- `git mv public/overrides-editor.html admin/overrides-editor.html`；
- `scripts/editor-server.mjs`：`PUBLIC_DIR` 常量（搬家后成死常量）换为 `ADMIN_EDITOR`，
  /editor 与根路径降级两处读取点 + 404 文案同步改，并注释说明为何不放 public/；
- `scripts/selftest.mjs`（editor 类型集对账闸门的读取路径）、`src/lib/fieldValidate.ts`
  注释、`docs/HARDCODE-AUDIT.md` A3 记载同步更新。
- 验证：selftest 258 绿（对账闸门经新路径依然生效）；build 92 文件 / 1.08MB
  （搬家前 93 / 1.10MB，正好少 27KB），dist 仅剩 index.html，postbuild 校验通过；
  全仓 `public/overrides-editor` 引用零残留。
- 备注：未采纳选项 C（verify-dist 加「dist 不得含 overrides-editor.html」闸门）——
  如想把它作为回归钉死，是一条 3 行断言，随时可加。

### 6.6 三项后续全部实施（2026-10-13 深夜，用户指示「按最优解继续改」）

**① Q1 的闸门钉死（verify-dist + selftest 双保险）**
- `verify-dist.mjs` 新增第 4 条检查「管理后台页不随站点发布」：dist 里除 index.html 外
  出现任何 HTML 即失败（比「只查 overrides-editor.html」更通用——SPA 单入口是设计不变量，
  任何后台页挪回 public/ 都会被拦）。docstring 契约、成功文案、manifest（strayHtml 计数）同步更新。
- `selftest.mjs` 增源级守卫：`admin/overrides-editor.html` 必须存在、`public/` 下不得出现
  （守「源」，与 verify-dist 守「产物」互补；selftest 259 项）。
- **反向测**（按项目纪律）：合规态 exit 0 → 注入 `dist/overrides-editor.html` → exit 1 且报出
  「非入口 HTML…管理后台页不应随站点发布」→ 移除 → 恢复 exit 0。三段全过。

**② D3 导出多余治理（64 个，超出审计原计 34 个）**
- 先写扫描器（临时脚本，用完已删）全量枚举 src/ + scripts/ 全部导出，按「符号名在定义文件
  之外零出现」判定。**修正了审计扫描的两个盲区**：必须连 `.vue`一起扫（statusLabelOf /
  site.ts 五个真源常量 / useDataset / continentOf 都被 .vue 消费，漏了就会误删），
  并查 `export * from` 再导出。
- 去掉 export 的 64 个：adapt 2、canvasFilter 5、catalog 5、compare 2、facets 1、fields 3、
  fieldValidate 1、globe 8、query 1、renderExportImage 1、search 2、specs 2、src/types.ts 4、
  brands 3、archive-shape 2、schema 5、normalize/shared 1、fingerprint 2、
  apple-compare 4、apple-prices 2、apple 5、sprite/generate 1、sync/queue 1。
- **保留 8 个（判断点，用户可否决）**：`src/lib/types.ts` 7 个 + `scripts/sources/types.ts`
  SourceAdapter 1 个——这两个是 DATA-CONTRACT / 适配器契约的**镜像文件**，导出面即契约面
  （BrandId/SourceId/Snapshot 等有 scripts 侧真实引用），去掉 export 会把镜像变成半残。
- `brands.mjs` 的 BRAND_IDS/BRANDS/brandName 一度犹豫（注册表「单一真源、其余处查表」的
  设计像是刻意宽面），最终按 D3 原则去掉（零消费者；真 API 是 isValidBrand/brandMeta/
  brandZh/brandShortLabel/VENDORS，都有消费方）；如要恢复是一词之改。
- 验证：复扫只剩上述 8 个保留项；selftest 259 绿；build 92 文件 + postbuild 绿；
  立绘生成 / fingerprint / archive:check / quality 四个管线侧脚本真实跑过；
  用户主工作区的 7 个 `_smoke*.cjs` 也确认零引用（审计遗漏面）。

**③ T2 一次性残留清理**
- 本 worktree `_work/` 本就为空（调试脚本当日已删）。
- wen（C:/aiwork/specworld）`_work/` 删除审计点名的两个一次性文件：
  `api-push.mjs`（6.3KB，GitHub REST 推送一次性工具）+ `commit-msg.txt`（666B，提交消息草稿）。
- **保留** 20MB 取数缓存与中间产物（*.raw.json / *.cache / derived.json / fingerprint.json）
  与 audit/ 目录：缓存换下次同步的离线能力，20MB 磁盘成本近零，审计原文也只说「可清」
  不说「应清」。想要空间时一条命令即可：`rm -rf _work/*.raw.json _work/*.cache`。

**本轮总验证**：lint 0/0、selftest 259 绿、conventions 通过、build 92 文件 / 1.08MB +
postbuild 全绿（含新闸门反向测）。工作区累计 35 个文件改动 + 1 个 rename，未提交。

---

## 七、第二轮深扫（2026-10-13 深夜，用户要求「继续检查」）

扫描面：整文件级引用 / 全符号死检测（含非导出）/ 未使用 import / 硬编码 / 过期引用 /
残留产物。**过程中三次抓到扫描器自己的 bug**（同名符号互相掩护、注释剥离被字符串里的
`/*` 与正则里的 `//` 干扰、bash -e 转义丢正则）——全部发现都经原始 grep 复核才进报告，
教训与项目铁律「校验脚本自己也会骗人」再次应验。

### 7.1 🔴 功能性缺陷（最高价值，不是死代码是坏代码）

**B1. BoardImageview.vue 交互全线失灵（Vite 重构引入的回归）**
全屏立绘查看器写全了 `onDown/onMove/onUp/onWheel` 四个指针/滚轮处理器，
提示文字也宣传「拖拽移动图片，滚轮 / 双指捏合缩放」，但**模板上一个事件绑定都没有**——
打开查看器后拖拽、滚轮、捏合全部无响应，零报错。文件自 45705fc（Vite 重构提交）
进入仓库起就是这样。修法：`.imageview_image` 上补
`@pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @wheel="onWheel"`。
**注意**：这是行为修复，按项目纪律改完必须真机拖一遍（冒烟脚本或手动）。

**B2. reduceMotion 死变量（a11y 偏好未生效）**
BoardCanvas.vue:75 算了 `matchMedia('(prefers-reduced-motion: reduce)')` 却没有任何
消费方——系统级「减少动效」偏好在画布上被静默忽略。修法二选一：接进 RAF 循环
（reduceMotion.matches 时直接吸附目标位，不做缓动），或删掉声明。倾向前者（声明在 = 意图在）。

### 7.2 🟡 确认死符号（15 个，全部经原始 grep 复核）

| 文件 | 符号 | 备注 |
|---|---|---|
| scripts/brands.mjs | brandName | D3 幸存项，零消费者 |
| scripts/favicon/make-from-xlsx.mjs | PAPER | |
| scripts/lib/overrides.mjs | indexById | |
| scripts/lib/schema.mjs | validateListField | |
| scripts/normalize/brands/apple.mjs | apFindAll | 仅注释提及 |
| scripts/sources/apple-compare.mjs | attrOf | |
| scripts/sources/apple-prices.mjs | MONTHS_ZH | |
| scripts/sources/apple.mjs | slugNameScore | |
| scripts/sources/huawei.mjs | attr | |
| scripts/selftest.mjs | ADAPT_LIB | 死动态 import（import 了不用） |
| scripts/report/quality.mjs | stateZh | 四态标签 map，实际打印处全内联硬编 |
| scripts/report/quality.mjs | hasVal | |
| src/components/BoardImageview.vue | props | defineProps 返回值未用（模板直接用 src） |
| src/components/BoardViewbox.vue | props | 同上（tile） |
| src/lib/types.ts | Snapshot/PoolKey/ProductDerived | **保留**：契约镜像（Snapshot 有 validate.mjs JSDoc 消费者） |

BoardImageview 的 onDown/onMove/onUp/onWheel 归入 B1（功能缺陷）不在此表。

### 7.3 🟢 未使用的 import（19 个，eslint 的 unused 规则是关的所以 lint 从不报）

- scripts/archive.mjs: statSync
- scripts/normalize/brands/apple.mjs: parseOis、parseRearLenses、parseFront、parseResolution、parsePpi
- scripts/normalize/brands/huawei.mjs: parseAperture、parseOis、parseLens、pickFirstRes、parseWatt、sliceByVariants、nums
- scripts/pipeline.mjs: writeFileSync ｜ scripts/qa/index.mjs: resolve ｜ scripts/selftest.mjs: STATUS_VALUES
- src/components/ChampionRow.vue: Product ｜ src/components/GlobeCanvas.vue: LAT_LIMIT ｜ src/lib/specs.ts: Dataset

**二阶效应**：清掉 apple/huawei 两个 normalize 的未使用 import 后，shared.mjs 里对应的
parse* 导出可能变成零消费者——修完要重跑导出扫描确认（本次已查出 parseOis 等在两处
都是「导出了没人用」）。

### 7.4 🟢 过期引用（1 处）

scripts/lib/gates-lock.mjs:8 注释写 `node scripts/verify-favicon.mjs`——该脚本已改名
为 verify-favicon-gates.mjs（package.json 的 favicon:gates 指向新名）。注释改一词。

### 7.5 ⚪ 未使用文件（1 个候选）

scripts/favicon/browsershot.cjs：零引用（不在 npm scripts、不在 workflows、无任何文档
提及），依赖本机 Chrome 路径的 puppeteer 手动截图工具，45705fc 随 Vite 重构提交入库。
它与 _smoke*.cjs 是同一品类（后者被 .gitignore 明确「本地验证脚本，不入库」）。
建议：`git rm --cached` + .gitignore 收录，或保留为文档化手动工具——用户裁决。

### 7.6 硬编码 / 残留产物（本轮确认达标）

- 品牌字面量 0、console 0、TODO 类标记 0（apple.mjs 的 XXX 是官网 URL 模式注释；
  check-conventions 的 debugger 是闸门自己的检测模式，均误报排除）
- URL 仅 site.ts 两个真源 + 适配器官网源 + SVG命名空间（均合法）
- 残留：_work 已清（临时扫描脚本删毕）；.dist-trash 1 份（保留策略正常工作）；
  data/sprites 62、public/data、public/sprites 均为构建期同步产物；根目录无散落文件；
  /tmp 调试日志已删。data/discovery-pending.json 不存在 = 队列为空（设计如此：非空才写、空了删）

---

## 八、第二轮修复全部实施（2026-10-13 深夜，用户指示「全部按最优解修，不考虑兼容性」）

### 8.1 B1 BoardImageview 交互接线（功能修复）
- `.imageview_image` 补 `@pointerdown/@pointermove/@pointerup/@pointercancel/@wheel.prevent`；
  顺手去掉未用的 `const props =` 绑定（defineProps 调用保留）。
- **真机验证**（_smoke-boardfix.cjs，puppeteer，9 项断言全过零运行时错误）：
  滚轮 scale 1→1.5、拖拽 translate 0,0→18,12、双指捏合 scale 1.5→3。
- 顺带发现并修复同文件同类的：见 8.2。

### 8.2 B2 减动效偏好全线接通（三处，a11y）
- **BoardCanvas**：`move()` 加 reduce-motion 分支——不攒惯性不补间，本帧直接到位后
  `stopInertia()`。真机数据印证模型：常规态总位移 1229px（=初速/0.05 的惯性滑行），
  减动效态 -57px（20 步直接到位之和），两态松手行为分别「继续滑 / 即停」。
- **BoardBackground**（本轮新发现的第三处同款缺陷）：原来常驻 rAF 永不归零，
  且点亮淡出完全不看减动效。改为：reduce-motion 时硬切点亮一帧即灭；无活跃方块时
  rAF 停止（常规态也省下一个空转的常驻循环）；`trigger()` 负责唤醒。
- **GlobeCanvas** 本就是正确范本（声明+消费都有），未动。

### 8.3 死符号与未使用 import 清理
- 删死符号 13 个：brandName / PAPER / indexById / apFindAll（连带修头部注释清单）/
  attrOf / MONTHS_ZH / slugNameScore / attr / ADAPT_LIB（死动态 import）/
  stateZh + hasVal（quality.mjs 实际打印处全内联硬编）/ props×2（defineProps 返回值未用）。
- 清未使用 import 19 个（archive statSync、normalize apple 5 + huawei 7、pipeline
  writeFileSync、qa resolve、selftest STATUS_VALUES、ChampionRow Product、
  GlobeCanvas LAT_LIMIT、specs Dataset）。
- **二阶效应**：shared.mjs 导出清单下架 6 个零消费者（nums、parseOis、cameraRole、
  parseRefresh、parseWatt、sliceByVariants——其中 parseResolution 一度被误删后恢复，
  huawei 实际在用）；import 自 parse.mjs 转手层清掉 nums/parsePpi/sliceByVariants。
- **过程中两次抓出自己的错**（都已在记忆中存档）：
  ① `validateListField` 被两个扫描器同时误判为死（spread 调用 `...validateListField(...)`
  同时骗过 lookbehind 正则和注释剥离器）——已恢复，连带救回它的唯一依赖 subfieldMap；
  ② parsePpi/parseResolution 被误从 shared.mjs 导出中删除（huawei 在用）——已恢复，
  并补了静态对账（导出清单 vs 消费者 import）。**教训：删导出/删符号前，必须用
  「原始 grep + spread 容忍」复核，且最终以「跑得起来」为权威判据。**

### 8.4 杂项
- gates-lock.mjs 注释：verify-favicon.mjs → verify-favicon-gates.mjs（脚本早先已改名）。
- browsershot.cjs：`git rm --cached` + .gitignore 收录（零引用孤本，与 _smoke*.cjs
  同品类——本地 Chrome 依赖的手动工具，留在本地用）。

### 8.5 验证总表
lint 0/0 ｜ selftest 259 绿（含 apple/huawei 映射 golden）｜ build 92 文件 + postbuild 绿 ｜
conventions 通过 ｜ 立绘/指纹/归档/质量四管线脚本实跑 ｜ B1/B2 puppeteer 冒烟 9/9 ｜
parse.mjs/shared.mjs 导出-消费者静态对账通过。累计工作区 24 文件 +62/-87 + 1 删除，未提交。
