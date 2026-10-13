# 全品类目录：数据格式设计（v2）

> 2026-10-13 `feature/universal-catalog` 分支落地的数据格式改造。
> 本文是 v2 格式的设计说明；字段级定义仍以 `docs/DATA-CONTRACT.md` +
> `data/schemas/phone.json` 为准（两边必须同步改）。

---

## 一、这次改造要解决的两个问题

> **「全品类」的范围定义**
> - **第一阶（当前重点）**：所有**用电的 / 与电相关的电子产品**——手机、笔记本、平板、耳机、电视、显示器、冰箱、洗衣机、空调……这些天然可量化、有具体参数。
> - **第二阶（后续扩展）**：**非电但同样可量化**的实物——例如行李箱（具体尺寸 / 规格 / 重量 / 材质），小米也确实有行李箱品类。
> - 无论电或非电，统一用同一套「品类注册表 + 字段表 + 四态」表达；非电品类只是把电池 / 屏幕 / 摄像头等电子专属分组标为 `not_applicable`（跨品类对比时整行隐藏），不影响可比字段。非电品类落地示例见 `docs/UNIVERSAL-FIELD-BLUEPRINT.md`「附录 A」。

1. **全品类全品牌**：旧 `ProductRecord` 把手机专属结构（body/display/chipset/…）
   写死在类型上。加一个品类（笔记本的 CPU/GPU/屏幕/电池、耳机的驱动单元/续航/编码、
   乃至行李箱的尺寸/重量/材质）就要改一遍契约类型、闸门、派生层、前端——「全品类」永远停在上一个品类。
2. **用户手动数据**：旧管线只有官网自动抓取 + `release-dates.json` 一类 curated 补充。
   用户发现官网抓漏/抓错时没有入口；直接改 `products.json` 会被下一轮同步覆盖，
   且「哪个值是官网的、哪个值是用户改的」在字节层面分不出来。

## 二、数据源三层

| 层 | 文件 | 谁写 | 频率 |
|---|---|---|---|
| 官网自动 | `data/products.json`（管线生成） | 管线 | 每 12h CI |
| 用户手动 | `data/overrides.json`（人工编辑） | 用户 | 随时 |
| 人工取证 | `data/release-dates.json`（curated） | 人工 | 低频 |

合并优先级：**用户手动 > 官网自动**。用户层是独立文件，管线**只读不写**它，
每次同步重新应用——官网刷新不会冲掉用户数据，这是「不直接改 products.json」的全部理由。

## 三、文件布局

```
data/
  categories.json        品类注册表：id → schema 文件（新增品类的入口）
  schemas/
    phone.json           手机字段表：42 个字段（path/label/unit/type/range/dir/quantifiable）
    tablet.json …        其他品类预留（builtin: false，尚未建设）
  products.json          唯一数据契约，v2 形状（见下）
  overrides.json         用户手动数据层（set-field / add-product）
  release-dates.json     发布日期取证表（既有，未变）
  raw/                   官网原文归档（既有，未变）
```

## 四、v2 产品记录形状

```jsonc
{
  "id": "apple-iphone-17-pro",
  "category": "phone",              // 品类 id（注册表见 categories.json）
  "brand": "apple", "line": "iPhone",
  "name": "iPhone 17 Pro", "nameZh": null,
  "releaseDate": "2026-09-18", "releaseDatePrecision": "day",
  "status": "on-sale", "retiredAt": null,
  "specs": {                        // 品类参数容器：键 = 字段路径
    "body.weightG": 199,
    "display.sizeIn": 6.3,
    "display.refreshHz": "1-120",   // 字符串：区间/多档/单值都是官网原文形态
    "camera.rear": [ { "role": "main", "mp": 48 } ]
  },
  "skus": [ /* 价格挂 SKU，形状未变 */ ],
  "scores": [ /* 分榜成绩，形状未变 */ ],
  "granularity": "specs-page",
  "provenance": { "display.sizeIn": "apple-official" },  // 被用户改过的键值是 "user-manual"
  "rawOfficial": { /* 官网原文（折叠判据的输入，保留顶层） */ },
  "notes": [],
  "firstSeenAt": "…", "lastSeenAt": "…",
  "releaseDateSourceUrl": null
}
```

**身份字段在顶层，品类参数全进 specs。** 拍平由 `scripts/lib/specs.mjs` 的
`flattenSpecs` 在 sync 层完成（normalize 一千七百行不动），写盘前删除旧嵌套组——
双真源比没有 specs 更危险（用户改了 specs、嵌套里还是官网旧值，且零报错）。

## 五、schema（每个品类的字段表）

```jsonc
{ "path": "display.sizeIn", "label": "屏幕尺寸", "unit": "英寸",
  "type": "number", "range": [3, 12], "dir": "high", "quantifiable": true }
```

- `type`：`number / string / boolean / enum / object / array:number / array:string / array:object`
- `range`：闸门合理性区间（不是规格区间）。**必须覆盖全量真实数据 + 合理余量**——
  折叠机展开宽度 164.6mm 曾把按直板机猜的 [50,100] 闸门打挂（误报一次，已修）。
- `dir`：排序方向（`high` 越大越好 / `low` 越小越好）。只对 `quantifiable: true` 有意义。
- `quantifiable`：是否参与对比/分位/头衔。厂商自报续航这类跨口径字段恒为 false。
- `group`：字段归属的显式分组 id（见下方「显式分组」）。不再从 `path` 前缀隐式猜分组。

**新增一个品类** = `categories.json` 加一行 + `schemas/<id>.json` 加一份字段表。
管线、闸门、前端分面自动识别，零代码。

### schema 顶层还有 `groups`（显式参数分组，借鉴准绳/Baseline 的 groups 表）

```jsonc
"groups": [
  { "id": "body", "name": "外观与机身", "nameEn": "Appearance & Build",
    "type": "single", "guide": "尺寸/重量/材质/防护/配色" },
  { "id": "camera", "name": "摄像头", "type": "multi", "guide": "前置+后置多摄" }
]
```

- `type`：`single`（单值）/ `multi`（多实例，如摄像头多摄）。前端分面与详情页分组直接吃。
- `guide`：分组说明，页面可展示。
- 每个 field 必须有 `group` 且引用已注册的组；`validateSchema` 在自测里拦「字段缺 group /
  引用未注册组 / 组 id 重复」。前端不再从 `body.` / `display.` 前缀猜分组（`adapt.ts` 同理）。

### 四态 value_status（借鉴准绳：available / unknown / none / not_applicable）

每个 `(产品, 字段)` 的取值状态不是二元的「有/无」，而是四态：

| 状态 | 含义 | 前端呈现 |
|---|---|---|
| `available` | `specs` 有**真实**值（非 null / 非空数组） | 正常值 |
| `unknown` | `specs` 缺该键，或键存在但值为 `null` / `[]` | 「—」（官方未公布，**不是缺失**） |
| `none` | `valueStatus[path]='none'`（人工判定该机型确实无此参数） | 「无」 |
| `not_applicable` | `valueStatus[path]='not_applicable'`（本品类不适用，跨品类时整行隐藏） | 「不适用」 |

- `products.valueStatus` **只**存 `none` / `not_applicable` 两种例外，其余靠 presence 推导——
  避免给 62 台手机各塞 42 个 `available` 键。
- ⚠️ 顶层 `products.status`（`'on-sale'` / `'discontinued'`）是**生命周期状态**，与四态映射
  `valueStatus` 是**不同字段**，不要混淆（撞名会让闸门把生命周期字符串当映射遍历误报）。
- 取值一律走 `valueStatus(product, path)`（`scripts/lib/schema.mjs`）/ `fieldStatus(p, path)`
  （`src/lib/adapt.ts`），二者同源。计算时把 `null` / `[]` 视为 `unknown`——本项目把
  「官方未公布」存成 specs 里的 `null`（如 `display.refreshHz=null`、`memory.ramGb=[]`），
  值不存在却按 available 算会让填充率虚高、前端把 null 渲染成空白而非「—」。

## 六、用户数据层（data/overrides.json）

```jsonc
{
  "id": "ovr-2026-10-13-001",
  "op": "set-field",                  // 或 add-product
  "productId": "apple-iphone-17-pro", // set-field：改哪台
  "field": "display.sizeIn",          // set-field：改哪个字段（必须 schema 已注册）
  "value": 6.9,
  "reason": "官网规格页实测 6.9 英寸（抓取漏了）",  // 必填：为什么改
  "source": "user-manual", "sourceUrl": null,
  "createdBy": "同志", "createdAt": "2026-10-13",
  "active": true                      // false = 软删除（留痕不生效）
}
```

`add-product` 整机新增：`product` 给完整 v2 记录（至少 id/brand/category/name/specs），
身份字段兜底（status→on-sale、granularity→manual、provenance 全键 user-manual）。

**合并规则**（`scripts/lib/overrides.mjs`）：

1. 按 `(createdAt, id)` 升序应用，同 `(productId, field)` 多条**后者赢**，conflicts 显式记录；
2. `set-field` 值替换 + `provenance[field] = 'user-manual'`，被覆盖的官网原值进
   `_work/sync-report.json` 的 `overrides.replaced`（可回查，不落盘 products.json）；
3. 有值抹成 null 是「抹除」操作，允许但 report 里以 `erased` 标记；
4. **写错显性失败**：引用悬空 / 字段未注册 / 值类型或区间错 / id 冲突 / 品牌未注册 /
   缺 reason —— 全部进闸门 failures，拒绝写盘、保留旧快照。静默跳过的后果是
   用户以为改好了而页面纹丝不动；
5. 管线只读不写本文件；`fingerprint.mjs` 单算它的指纹（与 discovery-pending 同理：
   要能被 CI 提交，但不该触发站点发布——应用后的值已进 products.json）。

## 七、闸门新增（validate.mjs）

| 闸门 | 防的故障 |
|---|---|
| category 必须在 categories.json 注册 | 品类悬空 → 没有字段表，参数表渲染直接崩 |
| specs 键必须在该品类 schema 注册 | 拍平漏组 / 用户层字段名拼错 → 值安静躺进没人读的键 |
| specs 值过 schema（类型/区间/enum） | 类型漂移（"120" 一排序就 NaN）、官网改版写进错字段 |
| overrides 合法性（引用/字段/值/冲突/品牌） | 用户层写错被静默跳过 |

以上全部有反向测（selftest「v2 全品类目录」节）：注入违规 → 必须报出 → 改回 → 恢复绿灯。

## 八、取值与前端适配

- **管线侧一律 `pick(product, path)`**（`scripts/lib/specs.mjs`）：specs-first，
  v1 嵌套回退。只读 specs 会让迁移后第一轮的覆盖率对比跌到 0 触发拒写；
  只读嵌套则用户修正永远不生效。双兼容是迁移平滑的必要条件。
- **前端 `src/lib/adapt.ts` 的 `toPhoneViews`**：数据加载时把 specs 展开回
  body/display 嵌套视图，33 个现有组件零改动。新品类页面直接消费 specs + schema。
- 自测的 `REAL_P` 与前端同路（也过 adapt），保证断言的就是前端真实形状。

## 九、已知边界（有意留下，不是没做完）

1. **其他三品类（tablet/laptop/audio）只有注册位，没有 schema 字段表**。
   数据诚信：不因为「苹果肯定有 iPad」就凭空建字段。接数据源时补 schema 即可。
2. **normalize 层仍按手机结构产出**，拍平发生在 sync 层。这是刻意的迁移顺序：
   先让 v2 格式与用户层跑通，再把 normalize 各通道改成直出 specs（未来工作）。
3. **用户层已有 Web 编辑原型**：`public/overrides-editor.html`（零构建、纯前端，
   对齐准绳计划的 F009）。它拉取 `/data/schemas/phone.json` + `categories.json` +
   `products.json`，按分组选字段，支持 set-field / add-product 两种模式，客户端按 schema
   复用 `validateValue` 校验类型/区间/enum，生成合法 `overrides.json` 条目。
   **当前是原型**：不写盘、产物需人工贴回 `data/overrides.json`；Serverless 直写是未来方向。
   完整字段蓝图见 `docs/UNIVERSAL-FIELD-BLUEPRINT.md`（16 分组 × 98 槽全品类蓝图，
   标注已落地/待补/他品类槽位）。
4. **`display.refreshHz` 仍是字符串**（`1-120` / `60/90` / `120` 三种官网原文形态）。
   schema type=string；排序/算术前用 `refreshHzNumber()` 取代表值（见 src/types.ts 注释）。

## 十、数据质量报告（借鉴准绳的「数据质量报告」格式）

`npm run quality` → 只读 `data/products.json` + `data/schemas/*.json`，确定性输出
（不含 `now()`，便于 diff）markdown 到 `_work/quality-report.md`（gitignore，分析产物）。

报告分九节，对齐准绳：

1. 概览（产品/品类/品牌/字段总数）
2. 品类计数（每个品类产品数 + schema 建设状态）
3. 品牌分布
4. **字段填充率（按四态）**：每个字段的 available / unknown / none / not_applicable 计数 + 填充率
5. **四态分布**：全品类四态总量
6. 分组覆盖率：每个分组的平均填充率
7. **完整性校验**：孤儿 specs 键 / 孤儿四态键 / 非法四态值 / 无 schema 品类 / 品类未注册
   （前三类是「会污染参数表」的错误，发现则退出码 1）
8. **低填充预警**：填充率 < 60% 的字段清单
9. **品类就绪状态**：填充率 ≥ 90% 的字段占比，给出就绪 / 部分就绪 / 待补充

报告把「结构性缺口（官网不公布）」与「解析性缺口（解析器失手）」用四态分开——
`unknown` 大量集中在某字段且跨品牌一致 = 官网结构性事实；同品牌内部分化 = 解析器 bug。
（逐品牌缺口分类的更细视图见 `scripts/qa/coverage.mjs --by-brand`。）

## 十一、借鉴准绳（Baseline）的总账

准绳是同源项目（只看参数不做判断、全品类、离线优先、零广告零权限），走鸿蒙原生路线。
本次 `feature/universal-catalog` 把它的可借鉴点吸收进 specworld：

| 准绳概念 | specworld 落地 | 状态 |
|---|---|---|
| `value_status` 四态 | `valueStatus` / `fieldStatus` + `products.valueStatus` 例外映射 | ✅ 已落地（含 null→unknown 修正） |
| 显式参数分组（groups 表） | schema 顶层 `groups` + field `group` 归属 | ✅ 已落地（phone 8 组） |
| 16 组 98 槽全品类模板 | `docs/UNIVERSAL-FIELD-BLUEPRINT.md` 蓝图 | ✅ 已落地（作为扩展参考） |
| 用户改/加数据入口（F009） | `public/overrides-editor.html` 编辑原型 | ✅ 原型（人工贴回） |
| 数据治理铁律（来源优先级/忠实限定词/不互换算） | `docs/DATA-CONTRACT.md` 已贯彻 + 闸门 | ✅ 既有 |
| 导入原子替换 + 校验纪律 | `scripts/sync/` 已贯彻（校验→备份→替换→清理） | ✅ 既有 |
| 数据质量报告 | `scripts/report/quality.mjs`（`npm run quality`） | ✅ 已落地 |
