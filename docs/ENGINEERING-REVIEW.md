# 工程评估：参数世界 对照 ai-model-world

> ⚠️ **历史文档说明**：本文档写于 Vite 迁移前。文中出现的 `scripts/site/`、`scripts/preview/render.mjs`、`scripts/lib/analyze.mjs`、`scripts/publish/verify.mjs`、`scripts/site/lib/i18n.mjs` 均已在 **2026-10-04 死代码清理**中删除——站点生成改为 Vite 前端，发布校验改为 `scripts/publish/verify-dist.mjs`，分位/头衔派生改为 `scripts/lib/derive.mjs`。保留原文作为架构演化记录。

- 评估日期：2026-10-03
- 评估对象：参数世界（specworld）（手写 mjs 模板 + 全链路数据管线，线上 `cyxue.github.io/specworld/`）
- 参考项目：`liyupi/ai-model-world`（Next.js 16 静态导出）
- 方法：直接读源码 + CI 配置 + 既有文档（`BENCHMARK-VS-AMW.md` 等），对照成熟工程实践逐项核验。

---

## 0. 总判定（先给结论）

**当前项目在「同等规模」下，工程成熟度高于参考项目的一半维度，且踩过的坑都写进了代码注释。**
它真正的问题不是"脏"，而是"集中"与"几处架构债"：一个 1804 行的单体规范化文件、两份只做文档的 `.ts` 文件被误纳入构建指纹、品牌注册表在约 10 处硬编码、以及最高风险的品牌映射层零单测。

**项目现在没有"着火"的地方**——管线闭环、闸门、指纹、自测、QA、CI 都真实跑通且设计严谨。下面列的是"让它再撑 3 年 / 加第三品牌时不崩"的优化项。

优先级按 `影响程度 × 改动成本` 分为 **高 / 中 / 低**；并区分 **必须修复 / 建议改进 / 可选优化**。

---

## 1. 与参考项目的真实差异（更新 BENCHMARK 的过时结论）

`docs/BENCHMARK-VS-AMW.md`（同为 2026-10-03）说"QA 三件套未做、自测 66 项"——**这两条现在已经过时**：

| 维度 | BENCHMARK 旧结论 | 当前实际 |
|---|---|---|
| 单元自测 | 66 项（旧结论） | `scripts/selftest.mjs` 断言覆盖品牌映射层 golden 测试、闸门自身、渲染层纯函数（环面/球面几何数学已随画布/设备球页面于 2026-10-16 下线而退役），CI 第一个 job 强制跑（见 §6） |
| 只读 QA 脚本 | P1 未做 | `scripts/qa/` 已建 `why-champion` / `coverage` / `stale-lineup` 三件套，且直接复用 `buildChampions` 单一真源 |
| 精灵图 | 入库，规模增长爆点 | **已改为构建期生成、`data/sprites/` 写入 `.gitignore` 不再入库**（见 §6）——不再是退步点 |

其余差异仍然成立且合理：
- **指纹设计本地更强**（数据指纹 × 模板哈希，参考项目该抄本地）。
- **单源直连无仲裁层**：手机参数只有官网一个源，照搬参考项目的字段级仲裁只会造空壳——前提不同，不能照抄（BENCHMARK 已论证）。
- **未迁 Next.js**：1671 行已跑通，迁移收益不抵成本（BENCHMARK 已论证）。

---

## 2. 六维评估

### 维度一：代码结构与模块划分

| 位置 | 问题 | 建议 | 优先级·分类 |
|---|---|---|---|
| `scripts/normalize/index.mjs`（1804 行；`mapHuawei` 568–862 ≈294 行、`mapAppleSpecs` 928–1237 ≈309 行） | 单体文件过大，两个品牌映射函数是巨型函数。每次上游改版、每次加字段都在这一个文件里改，review 困难、单测困难、易引入耦合。 | 拆出 `scripts/normalize/brands/huawei.mjs` 与 `apple.mjs`，主文件只做编排与 `emptyRecord` / `put` / `putObject` 等共享基建。拆完用现有 `selftest.mjs` 兜底回归。 | **中**·建议改进 |
| `scripts/normalize/index.mjs:79,85` 的 `firstNum` / `nums` | 与 `scripts/normalize/parse.mjs` 的 `firstNumber` / `allNumbers` **逐字重复**（DRY 违反），两处可能漂移。 | 直接 `import { firstNumber as firstNum, allNumbers as nums } from '../normalize/parse.mjs'`，删掉本地副本。 | **中**·建议改进 |
| `src/lib/` 与 `scripts/` 割裂 | `src/lib/compare-spec.mjs` 是构建期领域定义（对比页行/阈值/判定），却被放在 `src/` 而非 `scripts/`；`build.mjs:1041` 用 `'../../src/lib/compare-spec.mjs'` 动态相对路径 import，位置一旦变动即断。 | 统一约定：构建期代码全部进 `scripts/`（`scripts/site/lib/compare-spec.mjs`），或显式定义 `src/` 的语义并改用稳定别名。 | **低**·可选优化 |
| `parse.mjs` 内联 `--selftest`（11 条）vs `scripts/selftest.mjs`（70+ 条，现已 79 条） | 双测试机制，内联那份未接入 CI，长期会漂移且与主自测口径不一致。 | 删掉 `parse.mjs` 的内联 selftest，全部归一到 `selftest.mjs`。 | **低**·可选优化 |

### 维度二：架构设计

| 位置 | 问题 | 建议 | 优先级·分类 |
|---|---|---|---|
| 派生层 `derive`（被 `sync/index.mjs` 内部调用写 `derived.json`，又于 `build.mjs` / `qa/*.mjs` 各自重算 `buildScales`/`buildChampions`） | 三层各自 import 同一函数，结果靠"共享函数"保证一致——目前一致，但 build 没读回 sync 已算好的 `derived.json`，有重复计算。 | 若担心漂移：build 直接读取 `_work/derived.json`；否则保持（当前 n=60，重算成本可忽略）。 | **低**·可选优化 |
| 品牌注册表硬编码于约 10 处 | `validate.mjs:162`（`['apple','huawei']`）、`sync/index.mjs:30` 的 `VENDORS`、`ui.mjs` 的 `BRANDS`、`derive.mjs:168`、`sprite/generate.mjs:78`、`build.mjs`、`verify.mjs`、`qa/why-champion.mjs`、`normalize/index.mjs`、`preview/render.mjs` 均有 `'apple'/'huawei'` 字面量分支。加第三品牌（小米/三星，BENCHMARK 已列为未来方向）需改 10 处，极易漏。 | 抽出单一 `scripts/brands.mjs`（或并入 `VENDORS`）导出 `BRAND_IDS` 与 `brandMeta()`，其余处改为查表而非硬编码字符串。 | **中**·建议改进 |
| 分层整体 | 取数→规范化→整合(闸门)→派生→分析→建站→发布校验，职责清晰、失败即停、产物可重建。架构是对的。 | 保持。 | — |

### 维度三：性能与资源占用

| 位置 | 问题 | 建议 | 优先级·分类 |
|---|---|---|---|
| 全局 | 当前 62 台，所有 O(n)/O(n²) 循环均可忽略；离线重建 ≈4s。**无真实瓶颈**。 | 不需要优化；仅记录为"规模增长后才需关注"。 | **低**·可选优化 |
| `scripts/publish/verify.mjs:61-93` | 对 76 个 HTML 做了 **3 次独立全量 `readFileSync`**（外链检查 / 失效链接 / 内容纪律各遍历一遍）。 | 合并为单次遍历（一次读入、三类检查同轮完成）。n 小无所谓，但顺手可省 2/3 I/O。 | **低**·可选优化 |

### 维度四：安全性

| 位置 | 问题 | 建议 | 优先级·分类 |
|---|---|---|---|
| `scripts/publish/fingerprint.mjs:139` 收集 `src/lib/*.ts` 进**模板指纹** | `src/lib/types.ts` 与 `scripts/sources/types.ts` 是**纯文档型 TypeScript 文件**（项目无 tsconfig、无 `tsc` 构建步骤，从不被类型检查）。但它们被并入站点模板哈希——**改一个注释就会让站点指纹变化，触发 CI 误判"站点变了"并白发一次 Pages**。这是正确性 bug，且类型文件永远不会影响产物。 | 模板指纹只哈希真正参与构建的 `.mjs`（`scripts/site/**` + `scripts/lib/**` + `scripts/normalize/**` 等），把 `.ts` 排除；或把两个 `.ts` 降级为 `.md` 文档。 | **高**·必须修复（1 行改动，高价值） |
| `.github/workflows/toy.yml:102` | `curl -fsSL` 下载 `toy` CLI（固定版本）后直接执行，**无 sha256 / 签名校验**。版本虽固定，但中间人/源被篡改无防护。 | 下载后比对官方发布 checksum（或在 release asset 旁维护已知哈希）。 | **低**·可选优化 |
| `scripts/site/lib/ui.mjs:17` `esc()` | ✅ 已正确转义 `& < > " '`；全站无 `eval` / `Function`；内联搜索脚本（`ui.mjs:422`）同样转义。静态站无服务端注入面。**这是良好实践，保持。** | 保持。 | — |

### 维度五：代码质量

| 位置 | 问题 | 建议 | 优先级·分类 |
|---|---|---|---|
| `scripts/normalize/parse.mjs` vs `index.mjs` | 见维度一"DRY 违反"。 | 合并到 `parse.mjs`，删副本。 | **中**·建议改进 |
| `scripts/selftest.mjs` 断言数 | ~~文档曾写"66 项"，与实际不一致~~ **已解决**：`selftest.mjs` 末尾本就会打印实际断言数（现为 107），文档措辞已统一为「引用旧数字处标注已过时」。 | 保持：新增断言时顺手更新引用了计数的文档。 | ~~低~~ 已闭环 |
| 注释质量（`parse.mjs`、`validate.mjs`、`normalize/index.mjs`、`fingerprint.mjs`） | ✅ **极佳**：每个解析函数写明"为什么这么写 / 踩过什么坑"，闸门每条标注"防哪种故障 + 误报概率"，`provenance` 子路径 bug 的修复记录完整。这是项目最值得保持的资产。 | 保持；新代码沿用此风格。 | — |
| 命名 / 常量 / 单一职责 | ✅ `parse.mjs` 纯函数、常量集中（`LIMITS` / `THRESHOLDS` / `VENDORS`）、函数粒度合理。 | 保持。 | — |

### 维度六：工程实践（测试 / 配置 / 可观测 / CI-CD / 文档）

| 位置 | 问题 | 建议 | 优先级·分类 |
|---|---|---|---|
| **测试覆盖倒置**：`scripts/normalize/index.mjs` 的品牌映射层（`mapHuawei` / `mapAppleSpecs` / `mapAppleCompare`，600+ 行） | 自测覆盖了叶子解析函数与闸门，但**最脆弱、上游改版最先崩的地方零单测**。闸门只查 `REQUIRED_PATHS` 等少量字段，一个字段被静默映射到错误路径不会触发闸门。 | 加 **golden-file / 快照测试**：对一份固定 raw 跑完整 `normalize/index.mjs`，断言产物契约字段稳定；或先把品牌映射抽成纯函数再单测。接入 CI 与 `selftest` 同级。 | **中–高**·建议改进 |
| `.github/workflows/sync.yml` | ✅ `selftest` 为首个 `needs` job、concurrency 防并发、HTTP 缓存、指纹驱动提交、失败开 issue 留痕、`toy.yml` 缺凭据安静跳过。**成熟，保持。** | 保持。 | — |
| 自测层 + QA 层 | ✅ 自测 CI 强制；QA 三件套已建且复用 `buildChampions` 单一真源（不会与页面结论分歧）。**保持。** | 保持。 | — |
| `data/products.json` 结构校验 | 仅依赖 `validate.mjs` 的数值区间闸门，无 JSON Schema 级别的"形状"校验（如字段类型、必填键存在）。目前够用，但加第三品牌 / 重构契约时容易漏配。 | 可选：引入一份轻量 `docs/DATA-CONTRACT` 对应的 `schema` 校验（纯 `node:assert` 即可，不必引依赖）。 | **低**·可选优化 |
| 文档时效性 | `BENCHMARK-VS-AMW.md` 对"QA 未做 / 自测 66" 的结论已过时（见第 1 节）；缺参考项目 `HANDOFF` 里那种"不可违背原则 + 踩坑清单"的总纲文档。 | 更新 BENCHMARK 的过时条目；补一份 `PRINCIPLES.md`（数据诚信 / 零 AI 依赖 / 跨口径不混算 / 闸门纪律）。 | **低**·可选优化 |

---

## 3. 优先级总览（按 影响 × 成本）

| 优先级 | 项 | 分类 |
|---|---|---|
| **高** | `.ts` 文档文件被误纳入构建指纹（指纹误触发重发） | 必须修复 |
| **中** | 品牌注册表硬编码 ~10 处（扩展风险） | 建议改进 |
| **中** | `normalize/index.mjs` 1804 行单体 + 品牌映射函数过大 | 建议改进 |
| **中** | `normalize` 重复实现 `parse.mjs` 的 `firstNum`/`nums` | 建议改进 |
| **中–高** | 品牌映射层（600+ 行）零单测，测试覆盖倒置 | 建议改进 |
| **低** | 精灵图入库（规模增长爆点） | 可选优化 |
| **低** | `verify.mjs` 三遍读 HTML 合并为单遍 | 可选优化 |
| **低** | `src/` 与 `scripts/` 割裂 + 动态相对 import | 可选优化 |
| **低** | 删 `parse.mjs` 内联 selftest，统一到主自测 | 可选优化 |
| **低** | toy CLI 下载缺 checksum 校验 | 可选优化 |
| **低** | 文档计数口径不一致 / BENCHMARK 过时 / 缺原则总纲 | 可选优化 |

---

## 4. 已验证的良好实践（务必保持）

1. **指纹设计**：数据指纹 × 模板哈希，剥运行时刻、归一化行尾——比参考项目更稳，且根治了"每次空提交"。
2. **闸门纪律**：每条闸门标注"防哪种真实故障 + 误报概率"，且**闸门自身被审计测试覆盖**（自测里专门测 `validate`）。
3. **抓取层健壮性**：`huawei.mjs` / `apple.mjs` 均有 串行节流、超时（`AbortSignal.timeout`）、指数退避重试、磁盘缓存、以及 `finalUrl` 重定向校验（防 301 跳回列表页静默产出空记录）。
4. **HTML 转义**：`esc()` 覆盖 `& < > " '`，无 `eval`，内联脚本同样转义。
5. **零依赖**：全链路只用 Node 内置模块，无 `node_modules`，CI 无装包失败点。
6. **QA 复用单一真源**：`why-champion.mjs` 直接 import `buildChampions`，保证"体检结论 == 页面结论"。
7. **代码注释即文档**：解析函数的坑、闸门的边界、bug 的修复记录都写进源码，是项目最值钱的部分。

---

## 5. 建议的动手顺序

1. **（高）** 修指纹：模板哈希排除 `.ts` 文档文件 —— 1 行，立刻消除误重发。
2. **（中）** 抽出 `scripts/brands.mjs` 统一品牌注册表，替换 ~10 处硬编码。
3. **（中）** 删 `normalize` 里重复的 `firstNum`/`nums`，改 import `parse.mjs`。
4. **（中–高）** 给品牌映射层加 golden-file 测试，接进 CI。
5. **（中）** 拆分 `normalize/index.mjs` 的品牌映射函数到 `brands/`。
6. **（低，按需）** 精灵图改为构建期生成、`.gitignore` 排除 `data/sprites/`；合并 `verify.mjs` 遍历；统一 `src/` 与 `scripts/`；更新文档。

---

## 6. 落实情况（2026-10-03 重构已全量落地）

> 用户要求「文档中的每一条建议都必须完整落地，改动范围不受限制，以达成最优实现为目标」。
> 本轮重构（demo 性质，无兼容性 / 迁移成本约束）已将第 3 节优先级总览的 11 项全部落地。
> 回归验证：`node scripts/selftest.mjs` 79 项全过；`node scripts/pipeline.mjs --offline` 跑通、
> 闸门放行、76 页自包含零外链；数据指纹相对重构前字节不变（`VENDORS` 等数据面改动均逐字段等价）。

| 优先级 | 建议项 | 落地方式 | 状态 |
|---|---|---|---|
| **高** | `.ts` 文档文件误纳入构建指纹 | `fingerprint.mjs` 模板哈希改为只扫 `scripts/**/*.mjs` | ✅ |
| **中** | 品牌注册表硬编码 ~10 处 | 新 `scripts/brands.mjs`（单一真源，`BRAND_IDS`/`VENDORS`/`brandMeta`/`brandShortLabel`/`brandZh`）；替换 validate / sync / ui / derive / qa / sprite / verify 共 7 处 | ✅ |
| **中** | `normalize/index.mjs` 1804 行单体 | 拆出 `brands/huawei.mjs`(308) + `brands/apple.mjs`(581) + `shared.mjs`(516)，主文件降到 407 行 | ✅ |
| **中** | `normalize` 重复 `firstNum`/`nums` | 删本地副本，改 `import { firstNumber as firstNum, allNumbers as nums } from './parse.mjs'`（经 `shared.mjs` 再导出） | ✅ |
| **中–高** | 品牌映射层零单测 | 新增 golden-file 测试（华为规格页 / 苹果规格页 / 苹果对比页），固定 raw→固定产物逐字段比对，接进 `selftest.mjs` 与 CI | ✅ |
| **低** | 精灵图入库 | `pipeline.mjs` 接入 `scripts/sprite/generate.mjs`；`data/sprites/` 写入 `.gitignore` 并 `git rm --cached` 解跟踪 | ✅ |
| **低** | `verify.mjs` 三遍读 HTML | 合并为单次遍历（外链 / 死链 / 内容纪律同轮完成），I/O 减 2/3 | ✅ |
| **低** | `src/` 与 `scripts/` 割裂 + 动态 import | `compare-spec.mjs` 迁入 `scripts/site/lib/`；`build.mjs` 动态 import 改为 `./lib/compare-spec.mjs`，`render.mjs` 改为 `../site/lib/compare-spec.mjs` | ✅ |
| **低** | `parse.mjs` 内联 selftest | 删除，覆盖由 `selftest.mjs` 承担（其已含全部解析函数的断言，含 PWM/刷新率历史事故用例） | ✅ |
| **低** | toy CLI 下载缺 checksum | `toy.yml` 加 sha256 校验，由仓库 Variables 的 `TOY_CLI_SHA256` 门控：配了强制比对，没配只告警不阻断 | ✅ |
| **低** | 文档过期 / 缺原则总纲 | 更新 `BENCHMARK-VS-AMW.md` 的 QA / 自测(66→79) / i18n / 精灵图过期条目；新增 `PRINCIPLES.md`（8 条不可违背原则） | ✅ |

**本轮新增 / 改动文件清单**（未提交，待推送前撤销旧 PAT）：
- 新增：`scripts/brands.mjs`、`scripts/normalize/brands/{huawei,apple}.mjs`、`scripts/normalize/shared.mjs`、
  `scripts/normalize/brands/__fixtures__/*.json`（golden 测试夹具）、`docs/PRINCIPLES.md`
- 改动：`scripts/publish/fingerprint.mjs`、`scripts/sync/{validate,index}.mjs`、`scripts/site/lib/{ui,compare-spec}.mjs`、
  `scripts/lib/derive.mjs`、`scripts/qa/lib.mjs`、`scripts/sprite/generate.mjs`、`scripts/publish/verify.mjs`、
  `scripts/normalize/parse.mjs`、`scripts/preview/render.mjs`、`scripts/site/build.mjs`、`scripts/pipeline.mjs`、
  `.github/workflows/{toy,sync}.yml`、`.gitignore`、`docs/{ENGINEERING-REVIEW,BENCHMARK-VS-AMW}.md`
- 删除（重命名/移动）：`src/lib/compare-spec.mjs` → `scripts/site/lib/compare-spec.mjs`

