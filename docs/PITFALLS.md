# 踩过的坑与页面结构假设

> 这份文档的用途只有一个：**上游改版时，能在3 分钟内定位到是哪一条假设失效了。**
>
> 取数可行性证据在 `PROBE-FINDINGS.md`（为什么能取到）；
> 本文是反过来——**取不到 / 取错了时怎么查**。
>
> 规则：**每条假设都要能回答「它失效时页面会长什么样」**。
> 答不上来的，说明它还不是假设，只是运气好。

---

## 一、页面结构假设清单（按失效概率排序）

### A1. 苹果规格页用 `role="table"` 的 div 网格，**没有 `<table>`** 🔴高

**现状**：取数侧在 `scripts/sources/apple.mjs`。
页面把规格表渲染成 `<div role="rowgroup">` / `<div role="row">` /
`<div role="cell">` —— **没有 `<table>` 标签**。
段落锚点是 class 里的 `techspecs-section section-{key}`。

**失效症状**：解析出0 行，或所有字段为null（页面能打开，但一个值都读不到）。

**为什么容易踩**：任何针对 `<table>` 或通用表格选择器的写法都会静默返回空——
**不会报错**，只会产出一份全是 null 的快照。

**排查顺序**：
```bash
# 1. 单台重跑，看能不能解析出来
node scripts/sources/apple.mjs --limit 1 --out _work/apple.raw.json --cache _work/apple.cache

# 2. 直接看缓存里的 HTML（缓存按 <slug>.html 命名；_work/ 不入库，
#    本地跑过一次取数才有，CI 上由 actions/cache 恢复）
ls _work/apple.cache/                    # 看到底存了哪几台
grep -oE '\bsection-[a-z0-9][a-z0-9-]*' _work/apple.cache/iphone-17.html | sort -u | wc -l
grep -o 'role="cell"' _work/apple.cache/iphone-17.html | head -1
```

**判断依据**：`section-*` 段落数量**实测三台一致（iphone-16/17/18-pro 均为 54 个）**，
比华为稳定得多。关键 key 样例：`section-capacity`、`section-chip`、`section-display`、`section-size`。

⚠️ **别把 54 当契约记住**。真正要盯的是**相对变化**：
明显少于上次实测值、或 `section-capacity` 这类关键 key 消失了，就是结构变了。
两个脚本的注释里写的「35 个段落」是探针阶段的旧计数，已过时。

---

### A2. 苹果对比页给出42 款机型的全量矩阵，其中大部分 specs 页已 301 🔴 高

**现状**：`/iphone/compare/` 的内联矩阵是苹果侧唯一的深度来源。
对比页列出 42 款，但 `/{slug}/specs/` 只有 6 条在 sitemap 里，
其余要么 301 跳回 `/iphone/`，要么 404——**且跳转后仍返回 HTTP 200**。

**失效症状**：某台机型突然变成空记录（不是「字段少」，是整台消失）。

**致命细节**：**301 跳回来也是 200。** 不校验 `finalUrl` 就会把手机列表页当成规格页解析，
然后产出一堆 null——但记录本身"成功"了。

**排查顺序**：
```bash
# 便宜预检：看是否 301
curl -sI "https://www.apple.com.cn/iphone/iphone-15/specs/" | grep -i "^HTTP\|^location"
# 便宜预检：对比页正文里没挂链接的机型，specs 页一定是 301/404
```
这条经验复用价值最高：**用对比页正文里有没有链接来预判，省掉 30+ 次注定失败的请求**（冷跑 48s → 6.8s）。

---

### A3. 苹果价格走 `/shop/mcm/product-price`，endpoint 写在页面 `<head>` 里 🔴 高

**现状**：规格页不给价格。endpoint **不硬编码在 JS 里**，而是：
```html
<link rel="ac:pricing-endpoint" href="/shop/mcm/product-price">
```
`autopricing.built.js` 运行时读它。

**失效症状**：全部 7 台价格变null，或 `missing[]` 变长。

**两个必须记住的细节**：
1. **必须用逗号批量**：`?parts=A&parts=B` 只返回 A —— **静默少数据，不报错**。
2. SKU 级价格要走 `https://www.apple.com.cn/shop/buy-iphone/{slug}`，
   HTML 内联两段 JSON（`products[].price.fullPrice` 与
   `displayValues.prices[...].amountBeforeTradeIn`），两处逐 SKU 一致才算可信。

**排查顺序**（先离线看缓存，不必联网）：
```bash
# endpoint 还在不在（实测缓存里能找到）
grep -o 'ac:pricing-endpoint[^>]*' _work/apple.cache/_compare.html
# 价格通道返回结构是否还对
grep -o '"items":{[^}]\{0,200\}' _work/apple-prices.cache/*.html | head -1
```
endpoint 消失、或 `items` 结构变了，就换通道。

---

### A4. 华为已停售机型一律 301 跳回列表页，**跳转后仍返回 200** 🔴 高

**现状**：`https://consumer.huawei.com/cn/phones/{model}/specs/`。

**失效症状**：和 A2 一样——整机空记录，而非字段缺失。

**便宜预检（约 460 B）**：
```
GET https://consumer.huawei.com/cn/phones/{model}/specs.model.json
```
`title` 以 `"301"` 开头即已下线。实测 13 款 100% 准。

**边界不是机龄而是「是否仍在售」**：nova13（2024-10）已死，mate-xt（2024-09）还活着。
**别用「发布超过 N 年」推断下架**，这条规则已经不成立。

---

### A5. 华为目录页 `data-config` 里含完整在售目录 🔴 高

**现状**：`/cn/phones/` 的隐藏 input 带 `data-config`，含 slug + 价格 + productId。

**失效症状**：取数入口拿不到任何机型（整个 pipeline 的华为侧为空）。

**排查**（离线即可）：
```bash
grep -o 'data-config="[^"]\{0,200\}' _work/huawei.cache/*.html | head -1
```
**注意 `data-config` 是 HTML 实体转义的**（`&#34;` = `"`），
直接看会以为是 JSON 坏了——实际上它一直是转义状态。

---

### A6. 华为用 `li.large-accordion__item` 手风琴结构 🔴 中

**现状**：章节名 `.large-accordion__title` + 字段名 `.large-accordion-subtitle`。
⚠️ **缓存文件按 sha1 命名**（不是 slug），要用 `index.json` 反查：
```bash
node -e "
const i=require('./_work/huawei.cache/index.json');
const e=i.entries.find(x=>x.url.includes('mate70/specs/'));
console.log(e.file, e.status, e.bytes);"
```

**失效症状**：某章节（如「电池」）整体解析不到，其他章节正常。

**排查顺序**：用上面的方法定位文件后数锚点
```bash
grep -c 'large-accordion__title' _work/huawei.cache/<file>.html      # 章节
grep -c 'large-accordion-subtitle' _work/huawei.cache/<file>.html    # 字段
```
**实测参考值**（2026-10-03 实测，注意**不同机型差异很大**）：

| 页面 | 章节 | 字段 |
|---|---|---|
| `mate70/specs/` | 16 | 33 |
| `mate90-pro/specs/` | 19 | 33 |
| `mate-x7/specs/`（折叠屏） | 18 | **8** |

⚠️ **`mate-x7` 只有 8 个字段** —— 所以「字段数少于 N 就是结构变了」这条判据**不成立**，
不同机型本来就在 8–33 之间浮动。判据只能是**关键章节名还在不在**
（`电池` / `屏幕` / `尺寸与重量` 这几个）。

**注意**：折叠屏页面字段构成完全不同（内外屏并存），
`sliceByVariants` 与多形态标注逻辑（`折叠态：6.5 英寸；三屏态：10.2 英寸`）都跟这个假设绑定。

---

### A7. 字段名靠归一化匹配，不是精确匹配 🟡 中

**现状**：`normalizeKey()` 去掉空格/全角括号/下划线/分隔符，用于「运行内存（RAM）」≈「运行内存」。

**失效症状**：某个字段**静默变成 null**——官网改了字段名，归一化匹配不上。

**排查**：把该机型的 `rawOfficial` 整个打出来看官网用的原始字段名：
```bash
node -e "const d=require('./data/products.json');
const p=d.products.find(x=>x.id==='目标id');
console.log(JSON.stringify(p.rawOfficial,null,1))"
```

**这是「缺数据」类问题最快的排查入口**——`rawOfficial` 里有一切官网原文。

---

### A8. 电池容量必须带口径（典型值 / 额定值）🟡 中

**现状**：华为写「6800 mAh（典型值）」，额定值常在章节脚注里。

**失效症状**：闸门报「有电池容量但缺 capacityCaliber」。

**为什么这条是硬要求**：口径不可缺失。苹果不公布 mAh（恒为 null），
但华为公布就必须标明是典型还是额定——否则跨机型比较毫无意义。

---

## 二、解析层的坑（与页面无关，改代码也会踩）

### P1. `\b` 对非 ASCII 无效 🔴

```js
/\b/.test('克')      // false —— 克不是 \w，后面的空格也不是
/g\b|克|gram/        // ✅ 非 ASCII 单位必须单独一支，不加 \b
```
**症状**：中文单位解析全部返回 null（英文单位正常）。

---

### P2. 零宽字符污染机型名 🟡

华为页面把「非凡大师」写成 `非<U+2008>凡<U+2008>大<U+2008>师`，
还有 `&#8203;` 实体形式。**不清掉就没法和别处的机型名对齐**，id 对不上 → 整机数据挂到错误的 key 上。

```js
stripInvisible  // Unicode 区间 + HTML 实体两路都清
```

---

### P3. 「少取一个值」闸门一律放行 🔴 **最危险**

这是本项目最重要的一条认知，两次真实事故都栽在这里：

| 官网原文 | 取错的结果 | 闸门拦得住吗 |
|---|---|---|
| `2160 Hz 高频 PWM 调光` | 刷新率 2160 | ✅ 拦得住（超出 `[48,240]`） |
| `2622 x 1206 像素分辨率` | 刷新率 2622 | ✅ 拦得住 |
| `60 Hz / 90 Hz 屏幕` | **只取到 60**，90Hz 整段丢失 | ❌ **拦不住** |
| `7.44 盎司` | 重量 7.44 g | ❌ 拦不住 |
| `12 GB RAM` 混在 ROM 字段 | 存储档位多出 12 | ❌ 拦不住 |

**凡是「少取了一个值」「取到了相邻字段的值」，结果都落在合理区间内，闸门没有理由拦。**

所以改解析器之前必须跑：
```bash
node scripts/selftest.mjs
```
每个历史事故都有对应断言。这不是形式主义——`60 Hz / 90 Hz` 那个 bug
**是在自测写完当天被抓到的**，靠肉眼不可能发现（它看起来完全合理）。

---

### P4. 判读中文页面必须显式 UTF-8 🟡

```
PowerShell Get-Content 默认按 GBK 解码 → 「容量」变成「瀹归噺」→ grep 全不中
```
第一版探针因此误判「苹果 HTML 里没有中文规格」。**这是编码假象，不是数据缺失。**

---

### P5. 并列值不取平均 🟡

官网写「标准版 234g / 典藏版 235g」。取234（第一个）并在 note 里说明；
**平均 234.5 是编造**——官网从来没这么说过。

---

### P6. 对象型字段的 provenance 要同时登记父路径与子路径 🟡

`display.resolutionPx` 是 `{w,h}` 对象。曾经规范化层登记子路径 `.w`、
而校验层查父路径 —— 于是 **60 台全部**报「缺 provenance」假警。

**教训：闸门自己也会误报，所以它需要被测**（见 `selftest.mjs` 的对应断言）。
如果闸门失败看起来像「数据本来就缺」，很容易被当成结构性缺口忽略掉。

---

## 三、排查决策树

```
管线失败
├── 闸门拦住（非零退出）
│   ├── 报错「机型总数骤降」→ 看 windowStart 与两个源的目录解析（A2/A4/A5）
│   ├── 报错「必填覆盖率下滑」→ node scripts/qa/coverage.mjs --gaps-only
│   │     └── 看① 结构性 / ② 全站皆零 / ③ 同品牌内部分化
│   │           ③ 最可疑 = 解析器失手，看rawOfficial 对比
│   └── 报错「数值越界」→ 多半是 P3，查对应解析器
└── 解析器异常（0 台 / 空记录）
    ├── 单台空 → A2/A4（301跳转型）
    ├── 某章节空 → A6（华为手风琴结构变了）
    ├── 全字段null 但页面能打开 → A1（苹果 role=table 结构变了）
    └── 值都变了但没报错 → A3（苹果价格接口）/ A5（华为目录）

数据看着对但可疑
├── 某个字段全站 null → A7（字段名变了，看 rawOfficial）
├── 某字段静默少一个值 → P3（自测抓）
└── 机型名对不上 → P2（零宽字符）
```

---

## 四、新增字段 / 改解析器的检查单

改任何解析逻辑之前：

- [ ] `node scripts/selftest.mjs` 全绿（改之前先跑一次，确认基线）
- [ ] 新逻辑在`parse.mjs` 里有没有对应断言？**没有就补一条**
- [ ] 补的断言能不能说出「防的是哪种真实故障」？说不出就别加
- [ ] 数值类解析：结果是否**永远**落在 `validate.mjs` 的 `LIMITS` 区间内？
      否则闸门会以「疑似把 PWM 当刷新率」拦下，数据白跑一趟

改完之后：

- [ ] `node scripts/selftest.mjs` 再跑一次
- [ ] `node scripts/pipeline.mjs --offline` 看指纹：**只应改你要改的那个字段**
      （数据指纹变了但改动超出预期 → 解析器有副作用）
- [ ] `node scripts/qa/index.mjs` 看三个体检有没有新出现的 ⚠️
- [ ] 若改了页面结构假设 → **同步更新本文第一节与 `PROBE-FINDINGS.md`**