# 数据契约 v0.1（手机参数对比站）

> 范围：**手机品类 · 华为 + 苹果 · 近 3 年在售机型**（首版）
> 这份文件是全站唯一的字段定义源。管线写入、前端渲染、榜单计算都以此为准；
> 改任何字段语义必须同步改这里和 `src/lib/types.ts`。

---

## 一、六条不可违背的原则

这六条是从「AI 大模型世界」项目抄来的骨架，也是这类站点唯一的护城河——**别人抄得走页面，抄不走数据的可信度**。

1. **没有数据就写 `null`，显示「未公布」。** 绝不用 0、`-`、平均值、估算值填空缺。手机参数的空缺比模型站更多（苹果从不公布电池 mAh，华为部分机型不公布充电功率），这条会被反复考验。
2. **每个字段都要有来源（provenance）。** 记 `source`（huawei-official / apple-official / 第三方榜 / 人工录入）+ `fetchedAt`。
3. **每个数值都要有口径（caliber）。** 屏幕亮度分「典型 / 峰值(HDR) / 激发」，电池容量分「典型值 / 额定值」，充电分「峰值 / 持续」。**不同口径的数字永远不放在同一列比较**，同屏展示时必须带口径角标。
4. **跨来源、跨口径的分数永不混算。** Geekbench 单核、多核、AnTuTu、DXOMARK 各成一榜，分位池按 `指标::口径::测量方` 分组。同一份榜单换套测试方法就能差几十分，合并成一个「综合分」等于编造。
5. **档位用分位，不用绝对阈值。** 屏幕大小、重量、价格、性能档全部取「当前在售池里的分位」。三年后手机普遍更重更贵，绝对阈值会悄悄失效而不报错。
6. **文案由结构化字段套模板生成，不调用 LLM。** 「这个价位里屏幕最亮的手机」这类句子必须可离线复现、可追溯到数据。

---

## 二、三层结构

原项目是「厂商 → 模型」两层，手机这里必须多一层，否则会被存储版本淹没：

```
品牌 Brand（apple / huawei）
  └── 机型 Product（iPhone 17 Pro）        ← 参数挂在这一层
        └── SKU（256GB / 512GB / 1TB）      ← 价格挂在这一层
```

**成绩（BenchmarkScore）挂机型**，**价格挂 SKU**，**参数挂机型**。
同一机型的重量/尺寸在不同存储版本可能有差异时，按主版本（最低配）记录并在 `caliber` 里注明。

---

## 三、字段表（v0.1 草案，可得性待探针确认）

### 3.1 身份

**发布日期取「官网可核验的那一天」**（决策 2026-10-02）：苹果中国新闻稿的日期行是北京时间，比库比蒂诺发布会晚一天（如 iPhone 16 系列：CN 新闻稿 2024-09-10 / 美国发布会 2024-09-09）。本站**统一采用 apple.com.cn 新闻稿日期**，因为它能被 `sourceUrl` 直接验证；美国发布会日期记入 `note`，不覆盖主值。受此影响的 8 台机型（iPhone 16 全系、17 全系 + Air）界面显示的是 CN 日期。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `slug` | string | `apple-iphone-17-pro`，URL 与文件名共用 |
| `brand` | `'apple' \| 'huawei'` | |
| `line` | string | 产品线：`iPhone` / `Mate` / `Pura` / `nova` / `Mate X`（折叠） |
| `name` | string | `iPhone 17 Pro` |
| `nameZh` | string \| null | 中文名（华为有，苹果通常与英文同名） |
| `releaseDate` | string \| null | ISO 日期；只有年月时记 `YYYY-MM` |
| `releaseDatePrecision` | `'day'\|'month'\|'year'\|null` | **不许把年月补成 01 冒充精确** |
| `status` | `'upcoming'\|'on-sale'\|'discontinued'` | |
| `retiredAt` | string \| null | 官网产品线列表里消失的日期（与历史快照 diff 得出） |

### 3.2 机身

| 字段 | 单位 | 口径提醒 |
|---|---|---|
| `body.heightMm` / `widthMm` / `thicknessMm` | mm | 折叠机展开/折叠两态要用 `folded`/`unfolded` 子对象 |
| `body.weightG` | g | 官方标称；不同存储版本可能不同 → `caliber` |
| `body.ipRating` | string | `IP68` / `IP69` 等 |
| `body.material` | string \| null | 中框/背板材质 |
| `body.colors` | string[] | 官方配色名 |

### 3.3 屏幕

| 字段 | 单位 | 口径提醒 |
|---|---|---|
| `display.sizeIn` | 英寸 | 对角线，圆角矩形标注 |
| `display.type` | string | `OLED` / `LTPO OLED` / `LCD` |
| `display.resolutionPx` | `{w,h}` | |
| `display.ppi` | ppi | |
| `display.refreshHz` | Hz | 字符串。见下方「刷新率口径」 |
| `display.brightnessTypicalNits` | nits | **典型亮度** |
| `display.brightnessPeakNits` | nits | **峰值亮度（HDR）**，与上一条永远分列 |
| `display.protection` | string \| null | 玻璃型号 |

#### 刷新率口径（2026-10-02 修订）

`display.refreshHz` 是**字符串**，不是数字 —— 因为它有三种形态，混在一起会丢信息：

| 官网原文 | 契约取值 | 含义 |
|---|---|---|
| `支持 1-120 Hz LTPO 自适应刷新率` | `"1-120"` | 连续区间，下限本身是有信息量的（LTPO 能到 1 Hz） |
| `支持 60 Hz / 90 Hz 刷新率` | `"60/90"` | **离散档位**，不能写成 `60-90`（那等于谎称中间值也支持） |
| `最高支持 120 Hz 刷新率` | `"120"` | 单值 |

**必须排除的非刷新率 Hz**（官网同一段落里混着这些，最容易解析错）：

- `1440 Hz 高频 PWM 调光` / `2160 Hz 高频 PWM 调光` —— 这是**调光频率**，不是刷新率
- `300 Hz 触控采样率` / `240 Hz 触屏采样率` —— 这是**触控采样率**

**曾经踩过的坑**（保留在文档里，避免重构时再犯）：

旧实现取「整段文本里第一个 `Hz` 之前的全部数字的最大值」。官网一个段落里同时塞了
分辨率、像素密度、亮度和调光频率，于是：

```
iPhone 17  原文「2622 x 1206 像素分辨率，460 ppi | ProMotion…最高可达 120Hz」
           → 误得 "6.3-2622"   （把英寸数和横向像素当成了刷新率）
Mate 70 Air  原文「2160 Hz 高频 PWM 调光」→ 误得 "2160"
Mate XTS     原文「1440 Hz 高频 PWM 调光」→ 误得 "1440"
```

现在的规则（`scripts/normalize/parse.mjs` 的 `parseRefresh`）：
按分隔符切子句 → 排除含 PWM/调光/采样/闪烁的子句 → 只取紧邻 `Hz` 的数字。
仍然拿不到就返回 `null`。`scripts/sync/validate.mjs` 另有一道 `[48,240]` 闸门兜底。

### 3.4 性能与存储

| 字段 | 说明 |
|---|---|
| `chipset.name` | `A19 Pro` / `麒麟 9030` |
| `chipset.processNm` | 制程，官网常不公布 → 可为 null |
| `chipset.cpuCores` / `gpu` / `npu` | 描述性字段 |
| `memory.ramGb` | number[]，可选档位 |
| `memory.storageGb` | number[]，可选档位 |

### 3.5 电池与充电（口径重灾区）

| 字段 | 单位 | 口径提醒 |
|---|---|---|
| `battery.capacityMah` | mAh | **华为标「典型值」，苹果多数机型不公布 → null** |
| `battery.capacityCaliber` | `'typical'\|'rated'\|null` | |
| `battery.wiredChargeW` | W | 官方标称峰值 |
| `battery.wirelessChargeW` | W | |
| `battery.vendorClaimedVideoHours` | 小时 | **厂商自报续航**，标注为自报，与第三方实测分列 |
| `battery.measuredHours` | 小时 | 第三方实测（若接入），可为 null |

### 3.6 影像

| 字段 | 说明 |
|---|---|
| `camera.rear[]` | `{ role: 'main'\|'ultrawide'\|'tele'\|'periscope'\|'macro', mp, aperture, ois, sensorNote }` |
| `camera.front` | `{ mp, aperture? }` |
| `camera.videoMax` | `4K120` 这类描述 |

### 3.7 连接与系统

`connectivity.{fiveG, wifi, bluetooth, nfc, satellite, usb, sim, esim}`、`os.{launch, upgradableTo}`

### 3.8 价格（挂 SKU）

```ts
skus: Array<{
  storageGb: number;
  ramGb: number | null;
  priceCny: number | null;     // 官方指导价；null = 未公布/已停售
  priceNote: string | null;    // 「首发价」「现价」「促销价」必须区分
  listedAt: string;            // 这个价格是什么时候的价格 —— 缺了它价格不可比
}>
```

### 3.9 成绩（分榜，永不合并）

```ts
scores: Array<{
  league: string;        // 'geekbench6-single' | 'geekbench6-multi' | 'dxomark-camera' | ...
  score: number;
  unit: 'score' | 'pct' | 'hours' | 'watt' | 'nits';
  source: string;        // 'geekbench-browser' | 'dxomark' | 'vendor' ...
  sourceUrl: string | null;
  measuredAt: string | null;
  attribution: 'third-party' | 'vendor-self-reported';
  caliber: string | null;   // 测试条件：系统版本、室温、亮度设定
}>
```

### 3.10 溯源

```ts
provenance: Record<string, SourceId>;  // 键 = 字段路径，值 = 来源 id
```
例：`"battery.capacityMah": "huawei-official"`、`"display.brightnessPeakNits": "apple-official"`。

---

## 四、派生指标与分位池

**池（pool）= 当前在售机型**（`status === 'on-sale'`，可选含已停售开关）。所有分位在这个池里算。

| 派生物 | 输入 | 说明 |
|---|---|---|
| `perfScore` | Geekbench 多核（第三方）优先，缺失回落到单核 | 缺数据 → 空槽，不参与排名 |
| `priceScore` | SKU 最低价 | |
| `lightness` | 重量（越轻越高） | |
| `screenScore` | 峰值亮度 + 刷新率 + ppi 的组合分位 | 三个维度分开显示，合成分只用于排序 |
| `batteryScore` | 实测续航优先，缺失用电池容量分位（**并标注降级**） | 降级必须可见 |
| `chargeScore` | 有线充电功率 | |
| `valueScore` | `perfScore 分位 − priceScore 分位` | 抄原项目的性价比算法 |

**首页「今日格局」八个头衔**（每个头衔必须带上依据与数字）：
性能最强 / 屏幕最亮 / 续航最长 / 充电最快 / 影像最强 / 最轻 / 最划算 / 最新发布

---

## 五、校验闸门（写入前必须全过，任一不过就拒绝写盘、保留旧快照）

1. 机型总数骤降（比上一版跌 > 10%）；
2. `id`/`slug` 重复；
3. 必填字段覆盖率下滑（跌 > 5 个百分点）；
4. 出现负值或零：价格 ≤ 0、重量 ≤ 0、容量 ≤ 0、屏幕尺寸 ≤ 0；
5. 单位/量纲越界：ppi 在 200–1000、亮度在 100–10000 nits、厚度在 3–20 mm；
6. **口径缺失**：亮度/容量/充电这类字段有值但 `caliber` 为 null → 拒收；
7. 同一 `league` 出现多条不同量纲的成绩；
8. 跨来源冲突未裁决：同一字段两个来源值不一致且未记 provenance；
9. 品牌/产品线悬空（不在注册表里）；
10. 发布日期晚于今天，或早于首版范围下限。

---

## 六、完整示例（虚构占位，真实数据待探针回填）

```json
{
  "id": "apple-iphone-18-pro",
  "brand": "apple",
  "line": "iPhone",
  "name": "iPhone 18 Pro",
  "nameZh": null,
  "releaseDate": "2026-09-18",
  "releaseDatePrecision": "day",
  "status": "on-sale",
  "retiredAt": null,
  "body": { "thicknessMm": 8.1, "weightG": 199, "ipRating": "IP68", "colors": ["深空黑"] },
  "display": {
    "sizeIn": 6.3, "type": "LTPO OLED", "refreshHz": "1-120",
    "brightnessTypicalNits": 1000, "brightnessPeakNits": 2000
  },
  "battery": { "capacityMah": null, "capacityCaliber": null, "wiredChargeW": null },
  "skus": [{ "storageGb": 256, "ramGb": 8, "priceCny": 8999, "priceNote": "首发价", "listedAt": "2026-09-18" }],
  "scores": [
    {
      "league": "geekbench6-multi", "score": 9800, "unit": "score",
      "source": "geekbench-browser", "sourceUrl": null, "measuredAt": null,
      "attribution": "third-party", "caliber": null
    }
  ],
  "provenance": { "display.brightnessPeakNits": "apple-official" }
}
```

> 注意示例里苹果的电池容量是 `null` —— **这不是没做完，这是正确状态**。

## 7. 访客评价（预留字段，当前未启用）

产品侧决定：**暂不做访客评分**。但位置、字段、接入方式已完整预留，接入数据源时不需要改任何页面代码。

数据源文件：`data/visitor-ratings.json`（当前**不存在**，分析层读到空数组时页面显示「暂无访客评价」）。

```jsonc
[
  {
    "productId": "huawei-mate90-pro",  // 必填，机型 id
    "score": 4.5,                      // 必填，1–5
    "count": 128,                      // 必填，评价人数
    "updatedAt": "2026-10-01"          // 必填，ISO 日期
  }
]
```

**两种接入方式**（都不需要改页面）：

- **A. 离线快照** —— 人工或外部系统生成这个 JSON，提交进 `data/`，Actions 自动重跑建站。
- **B. 表单提交** —— 接一个 Serverless 函数接收评分写进数据库，
  再由 Actions 定时导出成同样的 JSON。保持纯静态站形态，前端仍无后端。

**不用做的事**：不要在契约里给「访客评价」写进 `products.json`。
它是**独立于官网事实的第二类数据**，混进主契约会污染 provenance 语义
（`provenance` 记录的是「这个字段来自哪个官网」）。

## 8. 站点分析层字段（不入契约）

`scripts/lib/analyze.mjs` 产出的 `_work/analytics.json` 里有一批**派生字段**，
它们不是官网事实，不进 `products.json`，也不参与 provenance：

| 字段 | 说明 |
|---|---|
| `detail.<id>.axes.<维度>.score` | 池内分位（1=最好），由该维度的多个已公布参数加权 |
| `detail.<id>.analogies[]` | 类比换算文案，每条带 `from`（原始值）与 `assume`（换算假设） |
| `detail.<id>.formFactor` | `foldable` / `bar`，由官网是否列出内外屏推导 |
| `detail.<id>.priceTier` | 价格档，由起售价落入哪个区间推导 |
| `leagues[]` | 客观参数榜，每条带 `pool`（参赛数）与 `partial`（样本是否有限） |
| `lineage.<产品线>.gen.<id>` | 代际链：同产品线内按发布时间的 `prev` / `next` |

**为什么单独一层**：这些东西会随「分位池」「维度权重」「换算假设」变化而变化，
而 `products.json` 应该只随官网变化而变化。混在一起会让 git 历史无法解读 ——
看到一个 commit 时说不清是官网改了还是我们改了权重。
