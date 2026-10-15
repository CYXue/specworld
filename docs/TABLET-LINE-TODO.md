# 平板线（Tablet Line）待实现文档

> 状态：**规划中，未开工**。创建于 2026-10-15。
> 背景：用户要求把「平板是否支持 SIM 卡」作为可对比维度。当前 `data/products.json`
> 共 62 台，**全为手机**，一个平板都没有；平板品类已在 `categories.json` 注册
> （`builtin:false`）但缺 schema 字段表与数据源。
> 衔接：2026-10-14/15 已落地的 4 个通信字段（`nfcDetail` / `irBlaster` /
> `cellularBands` / `wlanBands`）对平板**直接复用，无需重做**。

---

## 0. 一句话目标

让 specworld 能收录平板（首期 **iPad + MatePad**），并把「蜂窝版 / WiFi 版（SIM 支持）」
作为与手机同构的可对比维度——复用现有 `connectivity` 组与四态，WiFi-only 平板标 `none`
（界面「无」），与「官方未公布」(`unknown`) 严格区分。

---

## 1. 现状盘点

| 项 | 状态 | 说明 |
|---|---|---|
| `categories.json` 注册 `tablet` | ✅ 已具备 | `builtin:false`，`schema:"tablet"`（入口已就位） |
| `phone.json` 的 `connectivity.{sim,esim,wifi,bluetooth,nfc,nfcDetail,wlanBands,cellularBands}` | ✅ 已具备 | SIM 对比所需字段全在，**平板直接复用** |
| `phone.json` 其余分组（display/body/battery/camera/chipset） | ✅ 参考 | 平板多数字段同构，schema 可继承式复用 |
| `data/schemas/tablet.json` | ❌ **缺失** | **核心阻塞项** |
| 平板数据源（`scripts/sources/` 取数适配器） | ❌ 缺失 | 现有 `apple.mjs` / `huawei.mjs` 只爬手机 |
| 平板 normalize 通道 | ❌ 缺失 | `scripts/normalize/brands/` 只按手机结构产出 |
| `src/lib/catalog.ts` 的 `CATEGORY_ORDER` | ⚠️ 需同步 | 加 tablet 必须同步，selftest 有对账断言 |
| 立绘 / 地球可视化（sprite / globe） | ⚠️ 范围待定 | 平板是否进可视化待 §6 确认 |

---

## 2. 设计决策

### 2.1 SIM 对比用四态，不退化成布尔「无」
- **蜂窝版平板**：`connectivity.sim = true`（或 `esim=true`）→ 界面正常值。
- **WiFi-only 平板**：`connectivity.sim` 值存在但 `valueStatus[path] = 'none'`
  → 界面显示「**无**」（真实事实，可参与对比与筛选）。
- 区分 `none`（确实无卡槽）vs `unknown`（官网未公布）——这正是用户点的
  「有些平板支持 SIM、有些不支持」的可比价值。把 WiFi-only 误设成 `sim=false`（布尔）
  会丢失「确实无」语义，对比时和 `unknown` 混为一谈（见 §4-C 坑）。

### 2.2 平板 schema 复用手机 connectivity 组，电子专属分组按 `not_applicable` 收敛
- 平板**通常无**：卫星通信、红外遥控、潜望式长焦等 → 在 `tablet.json` 里标
  `not_applicable`，跨品类对比时整行隐藏，不影响可比字段。
- 沿用 `docs/UNIVERSAL-CATALOG.md` 的**零代码 recipe**：加 `categories` 行（已做）
  + 加 `schemas/tablet.json`。管线、闸门、前端分面自动识别。

### 2.3 机型建模（待确认，见 §6）
每型号一台（`sim` 标 `available`/`none`）vs 蜂窝版 / WiFi 版拆两台独立产品——
两种都能表达，但影响去重与对比台数量，开工前定。

### 2.4 数据源组织
- **iPad**：扩展 apple 品牌源（`scripts/sources/apple.mjs` 套路），但其 specs 页
  DOM 结构与 iPhone 不同，需新建 iPad 取数适配器或分支。
- **MatePad**：扩展 huawei 品牌源（`huawei.mjs` 套路）同理。
- normalize 通道按 `category="tablet"` 产出记录、套 `tablet.json`，复用现有
  `apple.mjs` / `huawei.mjs` 品牌解析函数。

---

## 3. 实施步骤（每步带验证闸门）

### 步骤 1 — 建 `data/schemas/tablet.json`
- 以 `phone.json` 为基底，删除平板不适用字段，电子专属分组标 `not_applicable`。
- 至少含：
  - 顶层身份字段（`brand` / `line` / `name` / `modelCode` / `releaseDate` / `status`）；
  - `connectivity.{sim, esim, wifi, bluetooth, nfc, nfcDetail, wlanBands, cellularBands}`；
  - `display` / `body` / `battery` / `camera` / `chipset` 子集。
- **验证闸门**：`npm run selftest`（`validateSchema` 拦字段缺 `group` / 引用未注册组 /
  组 id 重复）；`npm run quality`。

### 步骤 2 — 接数据源
- 新建 `scripts/sources/{ipad,huaweipad}.mjs`（或扩展现有 apple/huawei 源）产出
  `章节.字段 → 页面原文` 扁平键值对（与手机源同契约，见 `scripts/sources/types.ts`）。
- 新建 / 扩展 normalize：产出 `category="tablet"` 记录，套 `tablet.json`；
  WiFi-only 机型显式标 `valueStatus['connectivity.sim']='none'`。
- **验证闸门**：`node scripts/pipeline.mjs --data-only`（看真实数据过不过 schema）；
  核对覆盖率（四态：available / unknown / none / not_applicable）。

### 步骤 3 — 前端 `CATEGORY_ORDER` 同步 + SIM 对比展示
- `src/lib/catalog.ts` 的 `CATEGORY_ORDER` 加 `tablet`（与 `categories.json` 一致，
  selftest 对账断言会拦不一致）。
- 详情页 `connectivity` 组自动出现（自动补挂机制）；SIM 行用 `none` 状态显示「无」，
  `valueStatus` / `fieldStatus` 同源（`scripts/lib/schema.mjs` 与 `src/lib/adapt.ts`）。
- **验证闸门**：`npm run selftest`；`npm run build`；**真机拖一遍**（平板详情页必须能进、
  能点进对比台——交互组件必须真机验证，smoke 脚本不许省）。

### 步骤 4 — 可视化范围确认
- 平板是否进 sprite 立绘与 globe（立绘每根线由数据算出，需 tablet 判据）——见 §6 待确认。
- 若进：立绘判据只能有一个真源（参照 `scripts/lib/foldable.mjs` 之于折叠屏），
  加完必须开 `_work/sprite-review/index.html` 人眼核对「同组机器长得非常像」。

### 步骤 5 — 交付前固定顺序（来自 `AGENTS.md`）
```bash
npm run lint:fix
npm run selftest       # 格式化会碰代码，改完必须重跑
npm run build          # prebuild 同步 data/ → public/，postbuild 跑产物闸门
npm run conventions:check
npm run quality
```

---

## 4. 已知坑（手机线前车之鉴，平板会重演）

- **A. 数据源覆盖陷阱**：苹果官网只保留少数 `/specs/` 页（手机线已踩：对比页列 42 款
  但仅 6 个 specs 页，其余 301 跳回 `/iphone/` 静默产出空记录）。iPad 同理——
  **先探明哪些型号有独立 specs 页**，用 `sitemap.xml` 校准，落点非 200 必须判失败，
  否则静默空记录进站。
- **B. 字段范围闸门**：`tablet.json` 的 `range` 必须覆盖全量真实平板数据 + 合理余量
  （折叠机展开宽度 164.6mm 曾把按直板机猜的 `[50,100]` 闸门打挂）。
- **C. 四态误用**：WiFi-only 平板若被 parser 设成 `sim=false`（布尔）而非 `none`（四态），
  会丢失「确实无」语义，对比时与 `unknown` 混为一谈。判据：`sim` 有值但明确无卡槽 → `none`。
- **D. `CATEGORY_ORDER` 漏同步**：加 `tablet` 忘改 `catalog.ts` → selftest 对账断言报红
  （已防，但别忘）。
- **E. 自动补挂盲区**：schema 有、视图没引用、也没 `hidden` 的字段会「自动出现在页面」。
  平板新字段若**不想**上对比台，需主动加进 `data/view-*.json` 的 `hidden`。

---

## 5. 验收标准

- [ ] `tablet.json` 建好，`npm run selftest` 全过（含新增 tablet 字段校验，项数 279 → 279+N）。
- [ ] 至少录入 N 台平板（iPad + MatePad 各若干），`category="tablet"`。
- [ ] 蜂窝版 `sim=available`、WiFi-only `sim=none`（界面「无」），跨品牌可对比、可筛选。
- [ ] `npm run quality` 报告「品类计数」含 tablet，无孤儿 specs 键 / 孤儿四态键。
- [ ] `npm run build` 通过，平板详情页可真机进入并加入对比台。

---

## 6. 待确认 / 依赖（开工前定）

1. **首期品牌范围**：仅 iPad + MatePad？还是加小米平板 / 三星 Tab？
2. **机型建模**：每型号一台（`sim` 标 `available`/`none`）还是蜂窝 / WiFi 拆两台独立产品？
3. **可视化范围**：平板是否进 sprite 立绘与 globe？
4. **增值维度**（可后续）：手写笔支持（Apple Pencil / M-Pencil）、键盘配件——
   属可选对比维度，不阻塞首期。

---

## 7. 与既有任务的衔接

- 2026-10-14/15 已落地的 4 个通信字段（`nfcDetail` / `irBlaster` / `cellularBands` /
  `wlanBands`）对平板**直接复用**，本任务不重做。
- `docs/UNIVERSAL-CATALOG.md`（全品类零代码 recipe）、`docs/DATA-CONTRACT.md`
  （四态 / 字段定义真源）、`docs/PRINCIPLES.md`（数据诚信三原则）为本文档的约束来源。
