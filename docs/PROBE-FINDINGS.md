# 官网取数探针结论（2026-10-02 实测）

> 两个探针脚本与原始证据：
> - 苹果：`_research/probe/apple/`（`FINDINGS.md`、`fetch-specs.mjs`、`json/*.json`、`raw/*.html`）
> - 华为：`_research/probe/huawei/`（`FINDINGS.md`、`fetch-specs.mjs`、`*.json`、`*.specs.html`）
>
> 两个脚本都是 **Node ≥18、零第三方依赖、纯 HTTP**，串行请求间隔 ≥1 秒。

---

## 一、结论：两家都能稳定取到结构化规格

| | 苹果 | 华为 |
|---|---|---|
| 取数入口 | `https://www.apple.com.cn/{slug}/specs/` | `https://consumer.huawei.com/cn/phones/{model}/specs/` |
| 页面形态 | 服务端渲染 HTML，`role="table"` 的 div 网格（**所以没有 `<table>`**） | 服务端渲染 HTML，`li.large-accordion__item` 手风琴结构 |
| 稳定锚点 | 35 个 `section-*` class（`section-capacity`、`section-chip`…） | 章节名 `.large-accordion__title` + 字段名 `.large-accordion-subtitle` |
| 鉴权 | 不需要 UA / Referer / Cookie（无 UA 也 200，字节数一致） | 同左 |
| 隐藏 JSON API | **无**（`specs/main.built.js` 里 `fetch(`/`.json` 命中为 0） | **无**（`.model.json` 只有 450 B 骨架；深度选择器、`/api/`、`/bin/` 全 404/400/403） |
| 枚举方式 | `/iphone/compare/` 一次给出 **42 款机型**的全量矩阵 | `/cn/phones/` 隐藏 input 的 `data-config` 里含**完整在售目录**（50 个产品 / 5 系列，带 slug + 价格 + productId） |
| 实测覆盖 | `iphone-18-pro`/`17`/`16`/`air` 均 `sections=35` | `mate90`/`mate90-pro`/`mate90-pro-max` 均 19 章节 / 44 字段 |

**一个必须记住的教训**：我最初判断「苹果 HTML 里没有中文规格」是**编码假象**——PowerShell `Get-Content` 默认按 GBK 解码 UTF-8 页面，`容量` 变成 `瀹归噺`，grep 自然全不中。**凡是判读中文页面，一律显式 UTF-8。**

---

## 二、字段能力（决定这个站能做什么、不能做什么）

| 字段组 | 苹果官网 | 华为官网 |
|---|---|---|
| 机身尺寸 / 重量 / IP 等级 / 配色 | ✅ | ✅ |
| 屏幕：尺寸 / 分辨率 / ppi / 刷新率 / 玻璃 | ✅ | ✅ |
| 屏幕亮度（典型 / 峰值） | ⚠️ 只给部分口径 | ⚠️ 需从「屏幕」章节文本提取 |
| 芯片名 / CPU 核数 / GPU | ✅（A20 Pro、6 核 CPU、7 核 GPU） | ✅（处理器章节） |
| **RAM / 存储** | ❌ **官网从不公布 RAM** | ✅ RAM + ROM 并列合集 |
| **电池 mAh** | ❌ **从不公布**，只给「视频播放最长 N 小时」 | ✅ **典型值 + 额定值都给** |
| 充电功率 W | ⚠️ 只给 MagSafe 无线瓦数 | ✅ 有线 + 无线 |
| 摄像头 | ✅ 万像素 / 光圈 / 视频 fps | ✅ 前后摄 7+4 子字段 |
| 连接（WLAN / 蓝牙 / NFC / SIM / eSIM） | ✅ | ✅（另有星闪、卫星通信） |
| 蜂窝频段 | ✅ | ❌ |
| 上市日期 | ⚠️ 需另取 | ❌ |
| **跑分 / DXOMARK** | ❌ | ❌ |
| **价格** | ❌ 对比页是模板占位符，需另接定价接口 | ✅ 目录里带 price |
| 分存储版本价格 | ❌ | ❌（只有一个 tab，存储是并列合集） |

**由此推出两条产品决策**：

1. **首版做不了「性能排行」**。两家官网都不给跑分，如果硬做「谁更强」，要么接第三方跑分源（涉及条款与工作量评估），要么就会出现「用参数拼一个综合分」这种编造。**建议首版定位为「参数对比 + 客观规格榜」**（最轻 / 屏幕最亮 / 电池最大 / 充电最快 / 最贵 / 最新），把「性能」留白并明确说明原因——这正好符合原项目「没有数据就说没有数据」的第一原则。
2. **两家的字段必须做「不对称契约」**：苹果的 `battery.capacityMah` 恒为 `null`，界面上不是空着，而是显示「苹果官方不公布此参数」——这本身就是有用的信息，也是这个站相对电商参数页的差异点。

---

## 三、覆盖范围：一个必须让用户拍板的不对称

**华为侧**：官网对**已停售机型一律 301 跳回手机列表页**（且跳转后仍返回 HTTP 200，不校验 `finalUrl` 就会静默产出空记录）。
- 仍在售：`mate90/80/70`、`pura90/80`、`mate-x7`、`mate-xt(s)-2`、`pocket-2`、`nova14/15/16`、`changxiang 70/80/90` → **共 49 款手机**（目录 50 个产品）
- 已下线、取不到：`mate60` 全系、`pura70` 全系、`nova12/13`、`nova-flip`、`p60`、`mate50` 及更早
- 边界不是机龄而是「是否仍在售」：nova13（2024-10）已死，mate-xt（2024-09）还活着
- **便宜预检**：`https://consumer.huawei.com/cn/phones/{model}/specs.model.json`（约 460 B），`title` 以 `"301"` 开头即已下线（实测 13 款 100% 准）

**苹果侧**：对比页给出 42 款（从 iPhone 7 到 iPhone 18 Pro Max），历史深度充足；近 3 年（2023-09 起）约 **17 款**。

**苹果侧：也保留了 301 下线机制（后发现的，推翻了「历史深度充足」的初判）。**
- `apple.com.cn/sitemap.xml` 里 `/iphone-*/specs/` **只有 6 条**：`iphone-duo`、`iphone-18-pro`、`iphone-air`、`iphone-17`、`iphone-17e`、`iphone-16`。
- 对比页列出的 42 款里，其余 36 款的 `/{slug}/specs/` 要么 **301 跳回 `/iphone/`（跳转后仍返回 200）**，要么直接 404。`iphone-17-pro`、`iphone-16-pro`、`iphone-16e`、`iphone-15` 全部如此，中国站与美国站一致。
- 因此**苹果侧规格页只能拿到 7 台**（6 个页面 + `iphone-18-pro` 页第二列的 18 Pro Max）。
- 补齐方案（产品侧已决策）：用**对比页内联矩阵**补 2024-09 之后规格页已下线的 6 台（16 Plus / 16 Pro / 16 Pro Max / 16e / 17 Pro / 17 Pro Max），provenance 标 `apple-compare`、`granularity` 标 `compare-matrix`，界面标注粒度差异。
- 适配器内建**保真度自检**：抽样 1348 个值片段，1330 个可在源 HTML 逐字命中（98.66%），低于 98% 会在 notes 里告警。
- 复用价值最高的一条经验：**对比页正文里没挂链接的机型，其 specs 页一定是 301/404** —— 用这个预判可以省掉 30+ 次注定失败的请求（冷跑从 48s 降到 6.8s）。

---

## 四、苹果官方价格通道（2026-10-02 打通）

规格页不给价格，对比页里价格是模板占位符 `{IPHONE18PROMAX}$price.display.smart 起`。占位符反过来指出了真正的通道：

**A. 机型级起价（对比页占位符的后端）**
```
GET https://www.apple.com.cn/shop/mcm/product-price?parts=<ID1>,<ID2>,...
```
- endpoint **不硬编码在 JS 里**，写在页面 `<head>`：`<link rel="ac:pricing-endpoint" href="/shop/mcm/product-price">`，`autopricing.built.js` 运行时读它；
- **必须用逗号批量**——实测 `?parts=A&parts=B` 只返回 A（会静默少数据）；
- 返回 `{"items":{"IPHONE18PROMAX":{"type":"WUIP","name":"iPhone 18 Pro","price":{"value":10999,"display":{"smart":"RMB 10,999","from":"RMB 10,999 起"}}}}}`；
- 注意 `name` 字段内部命名不准（`IPHONE18PROMAX` 写成「iPhone 18 Pro」），**机型名一律取购买页商品名**；
- 只有机型级起价，**没有存储档价格**。

**B. SKU 级价格阶梯（取数主通道）**：`GET https://www.apple.com.cn/shop/buy-iphone/{slug}`，HTML 内联两段 JSON（`products[].price.fullPrice` 与 `displayValues.prices[...].amountBeforeTradeIn`），两处逐 SKU 一致。

**实测覆盖 7 台**：18 Pro ¥9,999、18 Pro Max ¥10,999、17 ¥6,799、17e ¥5,299、Air ¥8,799、Duo ¥15,999、16 ¥5,999（每台 3 重验证：两处内联一致 + A 通道一致 + 容量档与对比页交集）。

**6 台拿不到（未编造，进 `missing[]`）**：16 Plus / 16 Pro Max / 17 Pro Max 直接 404；16 Pro / 16e → 302 到 `/iphone/`；17 Pro → 302 到购买页列表。A 通道对这批标识符回 `{"type":"UNKNOWN"}`（无 price 字段），双通道互证「官网已停售」。

> **离线复现的正确用法**：`--cache-only` 必须显式带 `--cache <dir>`，否则没有缓存目录、必然 cache-miss（此时脚本以退出码 1 结束并写明原因，不会静默产出空数据）。

---

**归档兜底不可用**：本机网络无法访问 `archive.org`（curl 连接重置、web_fetch 也失败），所以「拿 Wayback 的历史快照补华为 mate60/pura70」这条路当前走不通，除非换网络环境。

→ 于是有三种覆盖口径，需要产品侧决策（见对话）。
