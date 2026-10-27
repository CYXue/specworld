# 新增品牌 / 品类接入 Checklist

> 2026-10-24 华为 8 品类（手机 → 平板/穿戴/显示器/笔记本/音频/智慧屏/路由器）扩接全过程
> 的经验沉淀。接第四个品牌（小米/三星）或给华为补第 9 个品类时，按本清单走，
> 不要再靠记忆重来。工程顺序即依赖顺序：采集器 → 夹具 → 映射器 → 通道 → schema → 闸门 → 取证。

## 0. 前置调研（半天）

- [ ] **官网目录页探测**：`curl` 各品类目录页（200/301/404），找含 `allProducts` 的
  `data-config` 隐藏 input（华为全品类同构；其他品牌另测）。
  注意官网会把同一品类分散到多个 URL 段（音频 = `audio`+`headphones`+`speakers`；
  智慧屏还有嵌套段 `visions/huawei-vision/`），全记进 `EXTRA_SEGMENTS`。
- [ ] **规格页结构核实**：抽 2–3 台详情页确认是否同构（华为各品类都是 `large-accordion`
  手风琴；平板规格在独立 `/specs/` 子页，手机是同页）。
- [ ] **品类映射决策**：新产物落在现有 18 品类中的哪一个（智慧屏 → media，与 Apple TV
  同品类；洗衣机 → washer）。没有合适品类才新建（`categories.json` + `schemas/<id>.json` 零代码 recipe）。
- [ ] **护栏阈值**：各品类页面的章节数差异大（显示器页只有 5 章节），必要时在
  `MIN_SECTIONS_BY_CATEGORY` 按品类放宽；「机型规格少」不是「解析结果不可信」。

## 1. 采集器（scripts/sources/）

- [ ] 目录注册（`CATEGORIES` 表 + 必要的 `EXTRA_SEGMENTS`）；
- [ ] URL 构造按**条目实际命中的段**（跨段 slug 可能重名），下线护栏
  `finalUrlIsTargetSpecs` 同步用条目段；
- [ ] 重跑 `--category <id> --out _work/<brand>-<id>.raw.json`，必须 **✅守恒**
  （抓到 + 跳过 = 目录机型数）；SKIP 明细逐条研判：真下线 / 护栏误拦 / 结构变化。

## 2. 映射器（scripts/normalize/brands/<brand>.mjs）

- [ ] 先看该品类 raw 键并集与 schema 字段表，再动手；每个键都要有明确去向或
  「官网真没有 → null」的结论。
- [ ] **golden 夹具先行**：从真实 raw 里挑一台字段最全的做 fixture（不进指纹），
  `assertGolden` 进 `scripts/selftest/03-brands-golden.mjs` + `context.mjs` 导入链。
  上游改版或映射逻辑变动都会让 golden 失配，逼人工 review。
- [ ] 逐字段核对试跑产物（`console.log` 抽查），**特别是**：
  - 官网标签错位（笔记本把 13.5mm 标「长度」；平板把长边标「宽度」）→ 键位不可信时
    用结构性判定（厚度 = 三维最小）并在 note 说明；
  - 官网给的 PPI 是横向口径，与对角线公式不同 → 官网有值必须用官网的；
  - 一页多变体（手表 42/46mm、电视 65/75/85 英寸）→ 前缀匹配取最短变体 + note，
    切不开就不切；
  - 单位换算（kg↔g、MB→GB、天→小时）合法；**口径换算（mAh↔Wh、V×A→W）红线禁止**；
  - 场景分档值（续航/充电）取哪一档必须显式 + 全档进 rawOfficial。
- [ ] V×A 形式的充电原文 → `wiredChargeW` 记 null + note（不推算）。

## 3. 规范化层（scripts/normalize/index.mjs）

- [ ] 新通道：可选读取 `_work/<brand>-<id>.raw.json`（不存在则「未就绪」跳过）；
- [ ] **品类显式声明**：每个通道映射后立即 `rec.category = '...'`；normalize 出口只做
  「声明齐全」断言（漏声明当场炸），禁止兜底；
- [ ] 并入 `byId` 合并清单 + 状态打印。

## 4. schema（data/schemas/<category>.json）

- [ ] 按官网真实数据扩展字段（recipe：fields 加一项 + groups 归组）；
- [ ] **range 必须覆盖全量真实数据 + 合理余量**——首轮闸门拦截是预期工作流：
  拦下 → 研判是坏值还是区间过窄 → 修映射器或放宽 range（带 note 记录依据）；
  折叠机 164.6mm、平板 262.6mm「宽度」、手表 108h 续航、电视 612.8mm 都是这么放行的；
- [ ] 品类没有的字段不要造（随行 WiFi 电池、穿戴充电盒尺寸 → 留 null，原文进 rawOfficial）。

## 5. 拍平与闸门（scripts/sync/）

- [ ] 非手机前缀（audio/features/device…）不在 `SPEC_GROUPS` 里 → 映射器直接写
  `rec.specs`（flattenSpecs 保留已有键）；
- [ ] emptyRecord 骨架带出的 null 会变成「未注册键」被闸门拦 → sync 拍平后清理
  「schema 未注册的空键」（已注册键的 null 保留形状契约）；
- [ ] 类型要与同名字段的其他品类对齐（`wlanBands` 是 `array:string` 不是 string）。

## 6. 发布日期取证（data/release-dates.json）

- [ ] 缺日期的机型**不阻塞管线**——sync 会把它们写进 `data/discovery-pending.json`
  待收录队列（这就是设计去向）；
- [ ] 逐台补双源取证（带 `sourceUrl`，发布日口径，开售日进 note），重跑管线自动进站；
- [ ] 窗口外老机型（首发 < WINDOW_START）如实记录，窗口过滤会正确排除；
- [ ] 批量取证技巧：发布会通稿常一次覆盖多台（MatePad Edge 发布会同场 =
  Edge + Ultimate 2 + 紫金款），先搜发布会再查单品，省一半检索量。

## 7. 交付前固定顺序

```bash
npm run selftest                 # golden + 全部断言
node scripts/pipeline.mjs --data-only   # 闸门 + 队列 + 指纹
npm run quality                  # 四态 + 完整性（孤儿键必须 0）
```

## 已知坑速查（华为扩接实战记录）

| 坑 | 症状 | 处置 |
|---|---|---|
| 品类跨 URL 段 | 18/20 台 SKIP「not-a-page」 | `EXTRA_SEGMENTS` + 按条目段构造 URL |
| 嵌套目录段 | 3 台 SKIP（`visions/huawei-vision/5-pro`） | 同上 |
| 护栏按手机口径 | 显示器 2 台「章节不足」误拦 | `MIN_SECTIONS_BY_CATEGORY` |
| 官网尺寸标签错位 | 厚度=222mm 闸门拦 | 结构性判定 + note，range 覆盖真实数据 |
| 复合形态尺寸 | 路由器天线折叠/直立 | 取折叠态（收纳尺寸）+ note |
| 一页多尺寸变体 | 电视 65/75/85/98 英寸 | 取最短变体名（最小档）+ note |
| schema 缺电视字段 | 未注册键被闸门拦 | recipe 补字段，不造数 |
| golden 含时间戳 | 夹具 `extractedAt` 是固定值 | golden 保留时间戳，重生成即可 |
| 华为系列面断言 | 多品类进站后 facet 集合变化 | 断言圈定 phone 品类，line 正确性归 golden |
