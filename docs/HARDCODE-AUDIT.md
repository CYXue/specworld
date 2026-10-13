# 全库硬编码审计报告

> **✅ 治理状态（2026-10-13 当日完成）**：用户裁决「全部按建议修、以最优解落地」。
> P0 五项 + P1 展示层泛化（视图字典 + 泛化引擎）**全部已实施并通过 selftest 249 项 / build /
> dry-run / quality / conventions 全绿**。各项结论标注见下；P2（策展表外置）按建议缓行。
> 实施记录：data/view-phone.json（视图字典）+ src/lib/fields.ts（泛化引擎）+
> src/lib/fieldValidate.ts（前端校验共享模块）+ selftest 新增 4 条对账闸门（接线钉死 /
> METRICS 对账 / ABILITIES 对账 / editor 类型集弱对账）+ 渲染对账升级双向。

> 2026-10-13 · 起因：连续抓到 `specGroups`（手写策展行）与 `facets.ts DIMENSIONS`（硬编码维度）
> 两处「schema 演化时页面不跟着走」的结构。用户要求全库彻查同类问题。
> 判定标准：**「schema/数据演化时，这里会不会悄悄不跟着走，且没有闸门拦截」**。
> 本报告只列发现与治理选项；改不改、改哪些，按协作铁律由用户选择。

---

## 一、🔴 A 级：多源漂移（同一语义多处定义、无对账闸门、静默失效）

### A1 能力/榜单字段表存在 **三份独立定义**（最重）
| 处 | 内容 | 消费者 |
|---|---|---|
| `data/schemas/phone.json` | `dir` / `quantifiable`（**权威**） | 闸门、质量报告 |
| `scripts/lib/derive.mjs` `METRICS` | 10 个指标 {label, unit, dir, path} | 后端榜单/头衔/分位（RankingsView 数据源） |
| `src/lib/specs.ts` `ABILITIES` | 4 条能力横条 {label, higherBetter, unit} + `rawFor` switch 字段访问 | 详情页/对比台 AbilityBars、champions |
| 另：`CompareView.vue` `SORTS_LITE` | 7 个轻量排序项 | 对比页排序条 |

**失效模式**：schema 改 label/dir、或新增可量化字段 → derive.mjs / specs.ts **静默不跟**——榜单用旧语义、
新字段永远进不了榜单与能力条。`higherBetter`（前端）与 `dir`（schema）是同一语义的两份拷贝。
**无任何对账闸门。**

### A2 数值区间双源（已数值级实证）
`scripts/sync/validate.mjs` `LIMITS` 的 8 组区间（ppi[150,1000] / brightness[100,10000] /
thicknessMm[2,20] / weightG[80,400] / screenIn[3,12] / chargeW[0,300] / batteryMah[1000,12000] /
refreshHz[48,240]）与 `phone.json` 的 `range` **逐字相同但独立维护**。
失效：改 schema range → LIMITS 继续拦旧区间（误报）或放行新越界值（漏报）。

### A3 值校验逻辑三份
`scripts/lib/schema.mjs validateSpecValue`（权威）/ `public/overrides-editor.html validateValue` /
`src/components/DataFeedback.vue validate+coerce`（后两者是手工复制，DataFeedback 注释自称
「同源」实为拷贝）。失效：类型系统演进 → 两份前端静默按旧规则提示（服务端权威仍能拦落盘，
但用户会被误导性提示先打一遍）。

### A4 品类/品牌清单：数据真源旁边还有代码副本
- 数据真源：`data/categories.json`、`scripts/brands.mjs`、`data/products.json vendors`；
- 代码副本①：`catalog.ts CATEGORY_ORDER`（phone/tablet/laptop/audio）；
- 代码副本②：`src/lib/types.ts BrandId = 'apple' | 'huawei'`；
- 代码副本③：`facets.ts` 分面排序 `Number(a === 'phone')` 字面量。

**失效模式（最危险的一处）**：`categoryOf()` 对未知品类**回落 'phone'**——新增品类数据一旦
先于代码到位，会被**静默计入手机**；`categoryCounts()` 固定四键，新品类计数直接丢失。
新品牌则被 `BrandId` 类型排除。

### A5 生命周期状态枚举已实际漂移（不是隐患，是现状）
- `src/types.ts`（活代码）：`'on-sale' | 'upcoming' | 'retired'`；
- `src/lib/types.ts`（见 A6）：`'on-sale' | 'discontinued'`；
- `ProductView.vue statusLabel`：三元链硬编码三个中文标签。
权威应是哪一个、数据里实际存的是哪个，需要一次裁决并统一。

### A6 死代码：`src/lib/types.ts` 零引用
全库无任何 import（v1 时代的完整契约镜像残留），且其 status 枚举已与活文件漂移（A5）。
危害：**误导源**——后来者（包括 AI）很容易改错文件改了个寂寞。

---

## 二、🟡 B 级：策展硬编码（有意策展；扩展需改代码；部分有闸门）

| # | 位置 | 内容 | 护栏 |
|---|---|---|---|
| B1 | `fields.ts specGroups`（29 处字段访问+组标题） | 详情页/对比表策展行 | ✅ 渲染对账闸门（selftest #246） |
| B2 | `facets.ts DIMENSIONS`(9 维) + `valueOf` switch + order 内 `'phone'` | 筛选维度（身份/派生维度） | ❌ 无 |
| B3 | `catalog.ts` 策展表：`VARIANTS`(11 正则)、`APPLE_SERIES`(4)、`CHIP_BRAND='麒麟'`（isMultiChip 只认麒麟前缀，注释自述苹果不覆盖）、`seriesOf` 品牌分支 | 系列/变体/芯片解析 | ❌ 无——**新品牌/新系列/新变体全要人工改代码** |
| B4 | `CanvasView.vue`（5 处字段访问：ppi/芯片/尺寸/刷新率/电池） | 画布标签策展 | ❌（策展性质，低危） |
| B5 | `sync/validate.mjs` REQUIRED_PATHS + provenance 核心清单（weightG/sizeIn/capacityMah） | 手机偏置（已文档化，行李箱需扩） | 部分（schema 校验会查未注册键） |
| B6 | `scripts/normalize/*.mjs` 大量字段路径 | 解析器产出层（v1 嵌套，迁移阶段已文档化） | 合理硬编码 |
| B7 | `exportSummary.ts` / `renderExportImage.ts` / `search.ts` 字段访问 | 导出图/摘要/搜索策展 | ❌（同 B4 性质） |
| B8 | `RankingsView` 榜单定义 | 榜单本质策展 | ❌ |

## 三、🟢 C 级：合理硬编码（设计如此，已文档化/已闸门化）

- C1 类型封闭集 + string 忠实原文兜底（扩展点已文档化于 SCHEMA-EXTENSIBILITY.md）；
- C2 selftest `PREVIEW_ONLY` / 渲染对账 `EXEMPT`——显性化决策清单；
- C3 `derive.mjs` TITLE_COVERAGE / TITLE_MIN_POOL——业务阈值（分位制已防写死阈值失效）；
- C4 `PRICE_BUCKETS` 固定价格档——URL 稳定性设计决策（注释已说明）；
- C5 `vendors`/`brands` 注册表消费——本来就是数据；
- C6 编辑器/纠错表单字段下拉动态读 schema——**正面案例**（本次审计中唯一完全达标的消费端）。

---

## 四、治理路线选项（按协作铁律并列，选型权在用户）

### P0：消多源（推荐先做——改动小、每项独立、收益直接）
1. **A2**：`LIMITS` 区间改由 schema `range` 派生（validate.mjs 已 loadSchema），删 8 组重复数字；
2. **A1**：先加**对账闸门**（selftest：METRICS/ABILITIES 的 path/label/dir 必须与 schema 一致）；
   可选进阶：两表改为从 schema 的 `dir`/`quantifiable` 派生生成；
3. **A4**：品类/品牌统一消费注册表——`CATEGORY_ORDER` 加 selftest 对账（categories.json ⊆ CATEGORY_ORDER），
   `categoryOf` 的回落 'phone' 改为显性报错或「未知品类」独立桶；`BrandId` 改 string；
4. **A5+A6**：裁决 status 权威枚举并统一三处；删除或归档 `lib/types.ts`；
5. **A3**：前端两份校验的最小治理 = 注释标明「复制自 schema.mjs，改类型必须三处同步」+ selftest
   弱对账（类型集合字符串比对）；彻底治理需把校验下沉为共享模块（零构建 html 受限，见文档）。

### P1：展示层泛化（= SCHEMA-EXTENSIBILITY.md 方案二/最优解落地，独立大任务）
B1/B2 及「新字段自动出现在详情/对比/筛选」在此一并解决。

### P2：策展表外置（✅ 2026-10-13 当日已落地）
B3 的 VARIANTS/APPLE_SERIES/PRICE_BUCKETS/chipMultiPrefixes 搬进 `data/curated/facets.json`
（数据化策展 + selftest「策展表外置对账」三条闸门：结构合法性 / 哨兵语义含长后缀优先反向测 /
真实数据冒烟），`catalog.ts` 只留读字典的通用引擎（seriesOf 支持按品牌配置命名解析策略、
foldVariant、多芯前缀泛化到麒麟/A/天玑/骁龙/玄戒/Exynos/Tensor）。新品牌/新变体/调价格档 = 改 JSON。
B4/B7/B8 属 ART 导向的策展，保留在代码。

### 推荐排序
**P0 全做**（预计一次小迭代，全部有 selftest 护航）→ P1 择机 → P2 视品牌扩张节奏。
（✅ 2026-10-13 用户裁决后 P0+P1+P2 全部当日落地，验证全绿：selftest 252 / build / dry-run / quality / conventions。）
