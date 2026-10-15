# 全库审计 · 2026-10-14（第三轮）

> 范围：`docs/` 18 篇 · `scripts/` 50 个 mjs · `src/` 26 ts + 35 vue + locales · `data/` 13 json ·
> 根目录 7 个 `_smoke*.cjs` · 配置与 CI。合计约 **6.2 万行**。
> 方法：先跑客观基线 → 四路并行深审 → **逐条交叉验证**（子代理结论一律不直接采信）。
> 本轮**未修改任何代码**，只出结论。
>
> **📦 修复状态（2026-10-15 更新）**：本报告 P0–P3 全部 15 项 + B1–B15 边界兜底
> **已全部落地并验证**，明细见文末《修复总账》。最终基线：
> type-check（vue-tsc，本轮新增）0 错误 · lint 0 · selftest **285 项全过** ·
> build 92 文件 · conventions / font:check / lock:check / archive:check 全过 ·
> **`npm run smoke:all` 一键退出码 0**（7 个浏览器脚本 + i18n SSR 全绿）。

---

## 零、结论速览

| 层级 | 状态 |
|---|---|
| 工具链自测 | ✅ selftest **277 项全绿** · lint **0 problems** · build **92 文件 / 1.19 MB** · conventions 过 · font:check 过 · lock 干净（355 包全 npmjs） |
| 真机冒烟 | ⚠️ `smoke:i18n` ✅ 26 渲染 · `_smoke.cjs` ✅ 零运行时错误 · `_smoke-pixel.cjs` ✅ · **`_smoke-search.cjs` ❌ 14 项失败** · **`_smoke-canvas/globe` ❌ 台数期望过期** |
| 数据诚信 | 🔴 3 条确证（立绘估算兜底 / 苹果对比页 NFC 否定式 / 品类回落先于闸门） |
| 文档 | 🔴 全库数字大面积过期（台数 60→62、自测 275→277、字段 42/49→44、维度 7→9…） |

**一句话**：机器能查的闸门全是绿的，但**没人接进 CI 的那一半脚本已经红了**，而文档数字过期了整整一代。

---

## 🔧 修复进度（同日落地）

### ✅ 已完成

| # | 项 | 改动 | 验证 |
|---|---|---|---|
| P0-1 | 搜索容错提示永不显示 | `query.ts` 新增 `matchLiteral`（字面通道）；判据下沉 `lib/search.ts` 的 `searchWithMeta()`，顺带补上原先漏掉的品牌过滤；selftest 加 2 条断言（含一条反向测：两条通道不得同一判据） | 冒烟 **14 红 → 23/23 全绿** |
| P0-2 | 搜索页品牌色失效 | `SearchView.vue` `accent:` → `accentColor` | 构建通过 |
| P0-3 | 冒烟脚本失联 | 删重复 `fail++`（报告数字恒 ×2）；截图改走 `ensureShotsDir()`；`networkidle0` → `domcontentloaded`（消除地球随机 30s 超时）；硬编码 60/47 台 → `expectedCounts()` 数据推导；`.gitignore` 移出 `_smoke*.cjs` 使其入库；新增 6 个 npm smoke 脚本；puppeteer 进 devDependencies | 画布 **25/25**、地球 **25/25**、构建通过、lock 382 包全 npmjs |
| P1-1 | 立绘对缺值估算 | `sprite/generate.mjs` `?? 6.5/?? 8/?? 200` → `UNKNOWN` 占位几何 + caption 标「?」+ 构建打印缺值台数 | 构建通过 |
| P1-2 | 苹果对比页 NFC 丢否定式 | `apple.mjs:665` 对齐规格页 `:397` 的否定式判据 | 构建通过 |

> 注：`BoardCanvas.vue:44` 的 `accent` 是画布内部 props 名，与 P0-2 无关，**不要顺手改名**。

### ⏳ 未完成

`P1-3` 品类回落下沉 · `P1-4` 无 schema 品类显性失败 · `P2-1` 死闸门第 5 条 · `P2-2` 折叠池判据同源 · `P2-3` BoardImageview 拖拽阈值 · `P2-4` 派生下沉（subline / Canvas-Globe 重复段 / ABILITY_OF_DIM）· `P2-5` 字号闸门消除告警疲劳 · `P3-1` 文档数字刷新 · `P3-2` DATA-CONTRACT 闸门清单重写 · `P3-3` 边界兜底 B1–B15 · **CI 里加 smoke job**。

---

## 一、🔴 最严重：一个长期红灯、无人知晓的闸门

### 1.1 `_smoke-search.cjs` 14 项失败，退出码 1，但没人跑它

```
❌ "nova14ultra"    台数 1(期望 1)  容错提示 无(期望 有)
❌ "NOVA14ULTRA"    台数 1(期望 1)  容错提示 无(期望 有)
❌ "ＮＯＶＡ　１４　ＵＬＴＲＡ"  台数 1(期望 1)  容错提示 无(期望 有)
❌ "mate-70-pro"    台数 3(期望 3)  容错提示 无(期望 有)
❌ "mate_70_pro"    台数 3(期望 3)  容错提示 无(期望 有)
❌ "华为畅享90"      台数 4(期望 3)  容错提示 无(期望 有)
❌ "华为畅享 90"     台数 4(期望 3)  容错提示 无(期望 无)
...
搜索容错验证：16 项通过，14 项失败     真实退出码 = 1
```

**根因（已实证定位）**：`src/lib/query.ts` 的 `matchExact` 内部有 compact 回落——

```js
if (d.haystack.includes(t)) return true;
const c = compact(t);
return c.length > 0 && d.compact.includes(c);   // ← 分隔符容错在这里
```

于是「忽略空格」被算进了**精确通道**，而 `SearchView.vue:67-73` 的 `usedLooseMatch` 又用 `matchExact` 判「是否精确命中」：

```js
const byExact = docs.value.filter((d) => matchExact(d, tokens));
return byExact.length === 0 && results.value.length > 0;   // 恒为 false
```

**结果：容错提示条永远不显示。** 用户搜 `nova14ultra` 能得到结果，但不会被告知「你打的和官方写法不同」——而这恰恰是 `_smoke-search.cjs` 文件头白纸黑字记下的需求原文。

⚠️ **放大因素**：该脚本不在 `package.json`，不在任何 CI（`.gitignore:53` 还把 `_smoke*.cjs` 排除入库）。它连着 14 项红灯，但**从来没有任何一次自动运行会看见它**。这是「闸门注册 ≠ 闸门调用」的教科书案例——而且这个项目自己在 `sync.yml:168-170` 写下了这条纪律。

### 1.2 附带：脚本自身的两个计数/路径缺陷

| 位置 | 问题 |
|---|---|
| `_smoke-search.cjs:93` + `:102` | `ok ? pass++ : fail++` 与 `if (!ok) fail++` **重复计数** → 打印的失败数恒为实际 2 倍。退出码用 `fail===0` 故红绿不受影响，但报告数字不可信 |
| `_smoke-search.cjs:104` | 截图写死相对路径 `_shots-pixel/search-loose.png`，未走 `_smoke-paths.cjs` 的 `ensureShotsDir()`（该脚本 `:13` 却 import 了 `chromePath`），未先跑 `_smoke-pixel` 就 ENOENT |

---

## 二、🔴 数据诚信（违反原则一）— 3 条确证

### 2.1 立绘对「官方未公布」做硬编码估算
`scripts/sprite/generate.mjs:51-53`
```js
const sizeIn      = pick(product, 'display.sizeIn')   ?? 6.5;
const thicknessMm = pick(product, 'body.thicknessMm') ?? 8;
const weightG     = pick(product, 'body.weightG')     ?? 200;
```
缺失即套默认值，**无 warn、无计数、无标记**。与 `scripts/normalize/index.mjs:11` 自订的纪律「不写 0、不写平均值、不写估算值」直接冲突。用户看到的是一张看起来尺寸精确的立绘，实则数据是编的。
（另 `:58` 的 `Math.max(sizeIn, 6.9)` 是第二处隐性钳位。）

### 2.2 苹果对比页 NFC 丢了否定式 —— 会把「官网明确否认」编造成「确认有」
`scripts/normalize/brands/apple.mjs`
```js
:395  规格页：nfcLine ? (!/不支持/.test(nfcLine) && /NFC/.test(nfcLine)) : null   ✅ 正确
:638  对比页：rec.connectivity.nfc = /NFC/.test(cell) ? true : null;              ❌ 含「不支持 NFC」也判 true
```
同一份纪律、两个通道，一个守了一个没守。
**交叉验证结论**：查 `data/raw/apple-compare-official.json`，含 NFC 的原文串当前只有 1 种——「支持读卡器模式的 NFC」，含「不支持」+NFC 的 **0 种**。
→ **当前数据未被污染，这是潜伏缺陷（P 级），不是现行数据错误。** 苹果一旦在对比页写出「不支持 NFC 的机型」，或接入新数据源，立刻产生「官网说没有、站上说有」的假数据，且闸门挡不住（值合法）。
→ 定级下调，但仍建议修：这是同类 bug 在这个项目里第二次出现（规格页那次是修过的）。

### 2.3 品类「静默回落 phone」发生在闸门之前
`scripts/sync/index.mjs:126`
```js
for (const p of kept) { if (!p.category) p.category = 'phone'; ... }
```
该回填**先于** `validate()` 执行，所以「品类缺失」在管线通道里根本到不了闸门。
而 `scripts/sync/validate.mjs:220-224` 的注释明确写着「…缺失也拒绝」，并在 `:222` 自陈「2026-10-13 审计 H1 起缺失同样拒绝」——**注释与实现已漂移**：闸门写得再严，也永远等不到那个缺失值。
前端还有第二份回落：`src/lib/catalog.ts:151` `?? 'phone'`。

---

## 三、🟠 闸门失效 / 覆盖盲区

### 3.1 死闸门：第 5 条「负值/零值」永不可能独立触发
`scripts/sync/validate.mjs:155-158` 检查 `['body.weightG','body.thicknessMm','display.sizeIn']` 的 `v <= 0`；
但这三条路径**同在** `:44` 的 `SCHEMA_RANGE_PATHS` 里，第 4 条已先落地，且 schema 区间下界均 > 0：

| 路径 | schema range | 下界 > 0？ |
|---|---|---|
| `body.weightG` | `[80,400]` | ✅ |
| `body.thicknessMm` | `[2,20]` | ✅ |
| `display.sizeIn` | `[3,12]` | ✅ |

任何 `v<=0` 必然也越界 → 第 5 条只能是重复报警。
此外 `inRange()`（`:101`）要求 `typeof v === 'number'`，字符串型脏值（如 `"0"`）两条闸门都不拦。
⚠️ 更值得警惕的是：`scripts/selftest.mjs:739-745` 那条名为「零值不被当作缺数据混过」的用例，保护的是第 5 条的**存在性**而非**有效性**——删掉它会红，写错边界它照样绿。

### 3.2 三个已注册品类无 schema → 写入时零字段校验（静默通过）
```
categories.json 注册：phone / tablet / laptop / audio
data/schemas/   实际：phone.json          ← 仅 1 个
```
`scripts/lib/schema.mjs:325` `if (!schema) return errors;`（注释：「无 schema 的品类（未建设的音频等）不阻塞写入」）、`:217` 同款。
→ `category: tablet|laptop|audio` 的产品写入时，**specs 逐键校验、status 映射校验、孤儿键检测全部空转**，且完全静默。
同一漏洞复现在 `scripts/report/quality.mjs:219-222`。
（注：当前 62 台全是 phone，故未暴露；但 `UNIVERSAL-CATALOG.md` 宣称的「新增品类零代码 recipe」在此处是断的。）

### 3.3 折叠屏判据：宣称「唯一真源」，实际有两份
- `scripts/lib/foldable.mjs:53`：`/折叠|展开/.test(text)`（**官网原文**）— 文件头 `:2` 自称「全站唯一真源」
- `scripts/lib/derive.mjs:211`：`/折叠|Mate X|Pocket|Flip/i.test(\`${p.line} ${p.name}\`)`（**机型名反推**）

后者恰好是 `foldable.mjs:31-36` 明文否定的做法（阈值/名称猜测）。
⚠️ 但要注意两者**用途不同**：`derive.mjs` 的是冠军池 filter，`catalog.formOf` 才是形态枚举。
`scripts/selftest.mjs:2645` 断言 `C.formOf(p)==='foldable' === C.isFoldable(p)`——守住了 **catalog 侧**同源，但**没有断言 derive.mjs 的池 filter 与 formOf 一致**。
→ 风险：可能出现「某台在『折叠机型里』冠军池里，但形态标签是直板」的自相矛盾，且 selftest 全绿。

### 3.4 像素风字号告警：持续报警但永不拦截（告警疲劳）
`_smoke-pixel.cjs:121-124`
```js
if (a.blur.length)  { ...; bad++; }
if (a.round.length) { ...; bad++; }
if (a.badSize.length) console.log('   字号:', ...);   // ← 只打印，不 bad++
```
结果：**13 个页面 × 每页 1 处 14px 违规**（`.mx-0.5.text-\[var\(--color-stone\)\]`），每次运行都打印 ⚠，但脚本永远输出「✅ 像素风自检通过」并 exit 0。
这不是「太静」，是「太吵到没人听」——同样等于闸门不设防。要么给这处 14px 加白名单并写明理由，要么让它 `bad++`。

### 3.5 6 个 npm 脚本注册 ≠ 调用（0 处 CI 引用）
`i18n:residual` / `quality` / `sprites:review` / `archive` / `archive:check` / `favicon:gates` / `lint`
—— CI 命中数全为 0。对照 `check-font-coverage` / `normalize-lock` 已接进 `sync.yml:94,100,110`。
即：体检类闸门常态无人跑，`quality` 报告只在人手跑时才更新。

### 3.6 指纹刻意排除字体与 favicon → 换字体不送审
`scripts/publish/fingerprint.mjs:251-253` 注释自陈排除 `public/fonts`、`public/favicon.svg`。
`should-publish.mjs:52` 判据只有 `siteFingerprint` 比对。
→ **用户看得见的字形/图标变了，闸门仍判「⏭ 跳过送审」**，与 `should-publish.mjs:5-9` 自述的「用户看得见的东西真变了才送」正面冲突。注释里说「手动 `--write-pointer` 兜底」，等于把这个判据交给了人的记性。

---

## 四、🟠 前端确证缺陷

### 4.1 搜索页品牌色永远不生效（一行 typo，视觉不一致）
`src/views/SearchView.vue`
```
:41   类型声明 { id; nameZh; count; accent: string }        ← 字段名 accent
:50   赋值      accent: doc.vendor?.accentColor ?? '...'    ← 写 accent
:138  模板读取  :style="{ color: b.accentColor }"           ← 读 accentColor → undefined
```
`accent` 字段**从未被任何地方读取**，而模板读的 `accentColor` 在该对象上不存在。
→ **搜索页 13 个品牌筛选按钮的品牌色全部失效**，而 `BrandView.vue:112` / `ChampionRow.vue:35` 等其它页面正常 → 跨页视觉不一致，零报错。

### 4.2 `BoardImageview` 在 pointerdown 里无条件 `setPointerCapture`
`src/components/BoardImageview.vue:38-42`，无拖拽阈值。
对照已确立的纪律：`BoardCanvas.vue:284-292`（`movedTotal > 6` 才捕获）、`GlobeCanvas.vue:234-241`（`moved > DRAG_SLOP`）+ `:162-165` 注释「不能在 pointerdown 里就捕获」。
本组件内暂无可劫持的点击目标故未爆，但纪律已破——一旦往浮层里加按钮就会复现「能拖能缩但永远点不进去」。

### 4.3 派生事实散落在组件里（3 处重复/分叉）
| 位置 | 问题 |
|---|---|
| `CompareView.vue:278-289` vs `RankingsView.vue:181-184` | 各写一份 `subline()`，一个取「系列·变体·形态·芯片」四项，一个只取「系列·芯片」两项 → **同一语义两个答案** |
| `CanvasView.vue:46-136` vs `GlobeView.vue:39-152` | 派生 + URL 同步近乎整段复制约 90 行，改一处必漏一处 |
| `RankingsView.vue:71-76` | 手写 `ABILITY_OF_DIM` 映射表，而 `src/lib/facets.ts:402-407` 已有同名字同内容的表 |

违反「派生事实一律下沉 `lib/`，不许在组件里现算」。

### 4.4 两份 `types.ts` 字段级漂移
| 语义 | `src/lib/types.ts`（管线） | `src/types.ts`（视图） |
|---|---|---|
| 前置摄像头 | `front: {mp,aperture} \| null` | `front?: Array<{…}>`（对象 vs 数组） |
| 发布日 | `releaseDate: string \| null` | `releaseDate: string`（non-null） |
| 刷新率 | `refreshHz: string \| null` | `string \| number \| null` |
| 折叠态 | `folded: {thicknessMm,heightMm} \| null` | `folded: unknown \| null` |

另 `src/types.ts:133` 的 `[key: string]: unknown` 索引签名会吃掉**全部**属性拼写检查（文件头 `:78-86` 自称已撤强转，但签名仍在）。

### 4.5 死代码（src 与 scripts 双向 grep 均无引用）
`glossary.ts:72-74`（3 个导出）、`fields.ts:289 orderDeriverFor` + `:307 refreshHzNumber`、`i18n/index.ts:27 LOCALE_STORAGE_KEY`、`lib/types.ts` 中 6 个类型（`Granularity/BenchScore/ProductRecord/VendorRecord/PoolKey/ProductDerived`）、`FilterBar.vue:70 displayLabel` 首参恒未用、`BoardCanvas.vue:89-96 webSvg()` 生成的 `<line>` 被 `:532 :deep(...){display:none}` 全隐藏（生成即死）。

---

## 五、🟡 边界与健壮性（风险点，非现行故障）

| ID | 位置 | 问题 |
|---|---|---|
| B1 | `src/lib/catalog.ts:490` | `PRICE_BUCKETS[len-1].id` — 字典为空时 `undefined.id` 抛错 |
| B2 | `src/lib/board.ts:128` | `n=0` 时返回 `NaN`；`BoardCanvas.vue:135/192` 用 `props.tiles[NaN]`（靠 `?? ''` 兜住，但 `mv.idx` 恒 NaN 会让 `step()` 每帧误判「索引变了」） |
| B3 | `DataFeedback.vue:71` | `f.range[1]` — range 只给 1 个元素时 `max` 为 `undefined` |
| B4 | 共 5 处 | 非空断言 `!`：`HomeView.vue:209`、`RankingsView.vue:115`、`SpotlightStrip.vue:72-91`、`lib/fields.ts:241`、`TimelineView.vue:25` |
| B5 | `BoardCanvas.vue:296-320` | 只在宿主元素收 `pointerup/cancel`，未像 `GlobeCanvas.vue:320-326` 挂 `document` 兜底 → 切后台/浏览器吞事件时 `ifMovable` 卡住 |
| B6 | `BoardImageview.vue:56-61` | 双指抬起一根后 `sx/sy` 未重置 → 单指续拖瞬移一个两指间距（`GlobeCanvas.vue:261-263` 已处理同款） |
| B7 | 3 个浮层 | `BoardImageview` / `BoardViewbox:22` / `DataFeedback:193-198` 均无 Esc 关闭、无 `role="dialog"`/`aria-modal`、无焦点陷阱 |
| B8 | `HomeView.vue:97-98` | `new Date(ts).getUTCMonth()+1`，`generatedAt` 非法时渲染「NaN 月 NaN 日」 |
| B11 | `SpecTable.vue:26` | `:key="r.label"` — 同组标签重复会触发 Vue 重复 key |
| B12 | 苹果预检 `sources/apple.mjs:906-925` | probe 落盘后只凭 `memo.reason` 永久 skip，无 TTL / 无 schema 版本 → 官网恢复后该 slug 永久跳过且不报错 |
| B13 | `normalize/index.mjs:427` vs `:497` | 先 `writeFileSync` 再自检 → 坏产出已落盘；且自检只覆盖 12 条路径，多数字段「有值无 provenance」无监控 |
| B14 | `archive-shape.mjs:113-115` | `?? ''` / `?? {}` / `?? null` 把「缺失」与「真实空值」抹平 → `specsUrl:''` 会让本该判废的规格件通过形状判据 |
| B15 | `qa/coverage.mjs:53-71` | `fieldsOf` 未排除 `rawOfficial`/`notes`/`valueStatus`，把官网章节名当字段计入基数 |

---

## 六、🔴 文档过期（全库数字大面积过时）

### 6.1 台数：60 → 实际 **62**（apple 13 / huawei 49）
```bash
node -e "const d=require('./data/products.json');console.log((d.products||d).length)"  # 62
```
命中位置（全库十余处）：
`SPEC-PARAMETER-WORLD.md:6/239/419` · `BENCHMARK-VS-AMW.md:30/169` · `MIGRATION-HANDBOOK.md:174/668/715` ·
`PRINCIPLES.md:58/61` · `REFACTOR-LOG.md:38-39` · `PITFALLS.md:256/354/499` · `AUTOMATION-RECIPE.md:99` ·
`ENGINEERING-REVIEW.md:63`

### 6.2 自测项数：275 → 实际 **277**
`README.md:98/591/606` · `AGENTS.md:55` · `AUDIT-REPORT-2026-10-13.md:6`

### 6.3 字段数三方打架，且都不对
| 出处 | 声称 | 实际 |
|---|---|---|
| `CONVENTIONS.md:361` | 49 | — |
| `UNIVERSAL-CATALOG.md:54` / `UNIVERSAL-FIELD-BLUEPRINT.md:235` | 42 | — |
| `data/schemas/phone.json` | — | **44 字段 / 10 分组** |

### 6.4 其它过期
- `CONVENTIONS.md:144-147`：维度清单名 `DIMENSIONS` 已改名 `DIMENSION_KEYS`（`src/lib/facets.ts:100`），且漏了 `form`/`price`，实际 9 个身份键；`HARDCODE-AUDIT.md:70` 又写 9 维 → 两份文档打架。
- `CONVENTIONS.md:421`：规范化层「1111 行」→ 实际 `index.mjs` 522 行 / 目录合计 2519 行。
- `PITFALLS.md:425`：「19 台没芯片名、30 台没内存」→ 实测 **20 / 32**（内存口径为空数组档位）。
- `SPEC-PARAMETER-WORLD.md:239`：「峰值亮度 13/60 公布（21.7%）」→ 实际 13/62 = **21.0%**。
- `PITFALLS.md:624`：脚本名 `scripts/verify-favicon.mjs` 不存在（应为 `verify-favicon-gates.mjs`），而同文 `:615` 用的是对的 → 同文自相矛盾。

### 6.5 文档声称的闸门，代码里其实没有（`DATA-CONTRACT.md:227-238` 声称 10 条）
| 文档声称 | 代码实际 |
|---|---|
| 「容量 ≤ 0」闸门 | ❌ `validate.mjs:155` 只遍历 3 条路径，无 `battery.capacityMah` |
| ppi 下界 200 / 厚度下界 3 | ❌ 单一真源是 schema：`ppi [150,1000]`、`thicknessMm [2,20]` |
| 「亮度/充电 caliber 缺失拒收」 | ❌ 只拦 `capacityMah` 的 `capacityCaliber`（`:164-169`） |
| 「跨来源冲突未裁决」 | ❌ 全文无任何跨来源比对 |
| 「产品线悬空」 | ❌ 只有 `isValidBrand(p.brand)`，无 `line` 注册表 |
| 「早于范围下限」 | ❌ `:187` 注释声称有，代码没有 |

同时**漏记 7 条实际存在且更严的闸门**：品类缺失/未注册、specs 逐键过 schema、statusMap 例外映射、provenance 缺失、`refreshHz` 48–240、峰值 < 典型亮度、overrides 合法性。

### 6.6 专项：文档误读闸门阈值
`CONVENTIONS.md:427`「整值覆盖率约 64%（跌破 60% 报红）」——
- 实际整值覆盖率 = 1635/2728 = **59.9%**
- 那个 60% 闸门是**术语表**覆盖率（`selftest.mjs:5826-5832`），不是必填字段覆盖率
- 必填字段覆盖率**只有**「相对跌幅 > 5pp」（`validate.mjs:27`、`:260`），**没有**绝对 60% 底线
- 冷启动（`previous` 为空）时完全没有填充率门槛

---

## 七、✅ 交叉验证后判为「非缺陷」的几条（子代理误报纠正）

审计过程中有 5 条初看像缺陷、经交叉验证后**不是**，特此记录以免误修：

| 初判 | 验证结论 |
|---|---|
| 苹果对比页 NFC 否定式（`:638`）**污染了数据** | ❌ 查 raw 归档：含 NFC 原文仅 1 种「支持读卡器模式的 NFC」，**0 种否定式** → 未触发，属潜伏风险 |
| Compare 页 `imgsOk:32/62` 图片加载失败 | ❌ `SpriteImg.vue:17` 是 `loading="lazy"`，视口外不加载，正常 |
| `_smoke-canvas/globe` HUD 台数不符 = 功能退化 | ❌ 脚本里**硬编码**了 `60` / `47` 台期望值，实际 62 / 49；筛选功能本身 ✅（「筛选后瓦片都是华为机型」通过） |
| 缺 `memory.ramGb` 的数据有 30 台 | ⚠️ 我的第一版统计脚本直接读嵌套路径，得出 0 台——**我自己踩了「取值必须 pick specs-first」的坑**；改用 `pick()` 并计入空数组后为 **32 台** |
| i18n 键不对齐 | ❌ 实测 zh/en 各 337 键，双向差集**为空** |

---

## 八、按优先级排序的修复建议

| 优先级 | 项 | 位置 | 成本 |
|---|---|---|---|
| **P0** | 把 7 个 `_smoke*.cjs` 接进 CI（或至少 `npm run smoke:all`） | CI / package.json | 中 |
| **P0** | 修容错提示判据：`usedLooseMatch` 不能复用含 compact 回落的 `matchExact` | `SearchView.vue:67-73` + `query.ts` | 中 |
| **P0** | `accent` → `accentColor` 改名（一行） | `SearchView.vue:41/50` | 极小 |
| **P1** | 立绘缺值不估算：改为显式 `unknown` 分支 + 计数告警 | `sprite/generate.mjs:51-53` | 小 |
| **P1** | 苹果对比页 NFC 补否定式（对齐 `:395`） | `apple.mjs:638` | 极小 |
| **P1** | 品类回落移到 validate 之后，或让闸门看原始值 | `sync/index.mjs:126` | 小 |
| **P1** | 给 tablet/laptop/audio 建 schema，或让无 schema 品类**显性失败**而非静默放行 | `data/schemas/` + `schema.mjs:217/325` | 中 |
| **P1** | 修 `_smoke-search.cjs` 重复 `fail++` 与截图路径 | `_smoke-search.cjs:93/102/104` | 极小 |
| **P2** | 字号闸门要么白名单要么 `bad++`（消除告警疲劳） | `_smoke-pixel.cjs:124` | 小 |
| **P2** | 折叠池 filter 与 `formOf` 同源，并加断言 | `derive.mjs:211` | 小 |
| **P2** | 删除死闸门第 5 条，或改判字符串型脏值 | `validate.mjs:155` | 小 |
| **P2** | `BoardImageview` 补拖拽阈值（对齐另两个画布） | `BoardImageview.vue:38-42` | 小 |
| **P2** | 派生下沉：subline / Canvas-Globe 重复段 / ABILITY_OF_DIM | 4 处组件 | 中 |
| **P3** | 文档数字全量刷新（台数 62、自测 277、字段 44/组 10、维度 9） | 十余处 | 小 |
| **P3** | `DATA-CONTRACT.md` 闸门清单重写（删 6 条虚构、补 7 条实存） | `DATA-CONTRACT.md:227-238` | 小 |
| **P3** | 边界兜底 B1–B15 批量处理 | 15 处 | 中 |

---

## 九、给下一轮的提醒

1. **本项目最大的风险不是「有 bug」，是「红灯没人看」**。本轮最严重的三个发现（搜索容错 14 红、字号 13 处告警、6 个 npm 脚本 0 调用）全都属于这一类。
2. **别信静态 grep 的「0 引用」**。本轮多起假阳性：动态拼接（`assets.ts` 的 `sprites/${id}.svg`）、类型导入、跨 scripts/src 边界。
3. **统计覆盖率必须用 `pick()`（specs-first）**。我第一版脚本直接读嵌套，把「32 台缺内存」算成「0 台缺」——差一点就把一个真问题写成没问题。
4. `_smoke-globe.cjs` 存在随机 `networkidle2` 超时（两次分别挂在 :268 与 :348），核心功能 12 项全绿，判定为脚本稳定性问题，接 CI 前需先换成更稳的等待策略，否则会制造随机红。

---

## 十、修复总账（2026-10-15 全部落地）

用户指令「全部按建议改，不用考虑兼容，直接大改」。第八节分级清单 + B1–B15 共 30 项全部完成，最终 `npm run smoke:all` 一键退出码 0。

| # | 修复 | 落点 | 验证 |
|---|---|---|---|
| P0-1 | 容错提示判据：新增 `matchLiteral`（字面通道）替代含 compact 回落的 `matchExact`；判据下沉 `searchWithMeta()` | `src/lib/query.ts` / `search.ts` / `SearchView.vue` | 搜索冒烟 **14 红 → 23/23** |
| P0-2 | `accent` → `accentColor` 字段名统一 | `SearchView.vue` | tsc 0 |
| P0-3 | 冒烟脚本失联：入库 + 7 个 npm script + `smoke:all` 编排 + `.github/workflows/smoke.yml`（CI 用系统 Chrome）+ puppeteer-core + fail 双计 + domcontentloaded + 台数从数据推导 + BASE 端口统一 4173 | 7 脚本 + `package.json` + `smoke.yml` | 画布 25/25 · 地球 25/25 · lock 干净 |
| P1-1 | 立绘缺值不再估算（`?? 6.5/8/200` → UNKNOWN 占位 + 计数告警） | `sprite/generate.mjs` | selftest 285 |
| P1-2 | 苹果对比页 NFC 补否定式 | `brands/apple.mjs` | selftest 285 |
| P1-3 | 品类声明下沉数据源层；同步层删兜底 + 源码级守卫 | `normalize/index.mjs` / `sync/index.mjs` / `check-conventions.mjs` | 守卫正反两向验证（写回兜底 → exit 1 行号准确） |
| P1-4 | 无 schema 品类显性失败（validate 拦 + 库函数抛错 + overrides 同步） | `validate.mjs` / `schema.mjs` / `overrides.mjs` | 新增 2 条断言 |
| P2-1 | 删死闸门 5；用例改断真实拦截路径 + SCHEMA_RANGE_PATHS 覆盖断言 | `validate.mjs` / `selftest.mjs` | selftest 285 |
| P2-2 | 折叠池判据同源（isFoldableOfficial）；DOMAINS 导出供测 | `derive.mjs` | 逐台同源 + 反向测（名字带 Flip 官网没写 → 判否） |
| P2-3 | BoardImageview 补 DRAG_SLOP=6（含双指抬手基准重置 = B6） | `BoardImageview.vue` | 画布冒烟 25/25 |
| P2-4 | 派生下沉：`productSubline` / `ABILITY_OF_DIM` 导出 / `useCanvasFilter.ts` 收编两页 90 行 | `catalog.ts` / `facets.ts` / 新文件 / 4 组件 | tsc 0 · 两页冒烟全绿 |
| P2-5 | 字号违规 `bad++`；根因修复（LocaleSwitch 漏 `text-[12px]` 继承 body 14px） | `_smoke-pixel.cjs` / `LocaleSwitch.vue` | 像素风 12 页字号全合规 |
| P3-1 | 文档数字刷新（台数 62 / 自测 285 / 字段 48 / 维度 15 / 脚本名 / 行数 2767） | README · AGENTS · CONVENTIONS · 等 7 篇 | grep 清零 |
| P3-2 | DATA-CONTRACT 闸门清单按代码重写（17 条实存） | `DATA-CONTRACT.md` | 与 validate.mjs 逐条对应 |
| P3-3 | B1–B15 边界兜底（越界/NaN/断言/兜底/无障碍/TTL/写盘序/基数） | 11 个文件 | 见 memory 2026-10-15 |
| 新增 | **`npm run type-check`（vue-tsc）**：引入即抓 15 错（4 个重构引入 + 11 个既有，含 ComputedRef cast 成数组的类型谎言），修完全部 0 错误并接进 sync.yml | `package.json` / `sync.yml` | type-check 0 |

### 本轮新增的两条工程纪律（比修复本身更值钱）

1. **tsc 不看 .vue 模板**——重构时连踩两刀（删 import 删出 `ref`/`onMounted` 未定义、模板引用已删的 `err`）都是 tsc 全绿而页面白屏，全靠冒烟兜住。vue-tsc 已接管这一类。
2. **「永远红」的脚本等于不存在**——`qa/coverage.mjs` 因把「官网只公布部分机型」的数据观察判为失败（exit 1）而永远红、零调用。分化改为只打印（exit 0）后才注册 `npm run qa:coverage`。闸门的退出语义必须区分「缺陷」与「事实」。
