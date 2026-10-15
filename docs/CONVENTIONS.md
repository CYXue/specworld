# 工程规范（CONVENTIONS）

> 这份文档回答「代码该怎么摆、该怎么命名、依赖与脚本怎么管、文档与日志怎么写」。
> 原则同 `PRINCIPLES.md`：**每一条都必须能说出「违反它会出什么真实故障」**，说不出就不要写。
>
> 维护规则：改代码时如果发现本文与代码不一致，**先改代码对齐规范，或改规范对齐现实**，
> 绝不允许两者长期不一致——不一致的规范等于没有规范。

---

## 0. 与其他文档的关系（先看这张表，别找错文件）

| 你要查 | 去哪 |
|---|---|
| **代码怎么摆、怎么命名、依赖/脚本/日志怎么写** | **本文（CONVENTIONS）** |
| 不可违背的技术原则（数据诚信、闸门、指纹、依赖源） | `PRINCIPLES.md` |
| 这个项目是怎么从参考项目学来的、能迁移什么 | `MIGRATION-HANDBOOK.md` |
| 怎么配 GitHub 让它无人值守 | `AUTOMATION-RECIPE.md` |
| 字段定义与口径（数据字典） | `DATA-CONTRACT.md` |
| 页面结构假设清单 + 排查决策树 | `PITFALLS.md` |
| 怎么用这个站（用户视角） | `../README.md` |

---

## 1. 目录结构与模块职责

### 1.1 全景

```
specworld/
├── data/                  # ★ 唯一入库的数据源（products.json / release-dates.json / .fingerprint）
├── docs/                  # 规范与文档（本文件所在）
├── public/                # 构建期从 data/ 同步的拷贝 + 字体。不入库（见 .gitignore）
├── scripts/               # 数据管线 + 闸门 + 自测（Node，零运行时依赖）
│   ├── brands.mjs         #   品牌注册表单一真源
│   ├── sources/           #   适配器：官网 HTML → 原始键值对（不判断单位/口径）
│   ├── normalize/         #   规范化层：原始值 → ProductRecord（解析单位、判口径、记 provenance）
│   ├── sync/              #   整合 + 校验闸门（拒绝写盘）
│   ├── sprite/            #   精灵图生成
│   ├── publish/           #   产物闸门（verify-dist）、指纹、lock 规范化
│   ├── qa/                #   体检脚本（回答「为什么是这个结果」）
│   ├── pipeline.mjs       # 编排入口（--data-only 是 CI 与日常唯一用到的模式）
│   ├── selftest.mjs       # 自测入口（纯函数、不联网、CI 第一个 job）
│   ├── lib/i18n-keys.mjs  #   语言包双向对账闸门（键集/引用/插值/数据侧双语，见 §2.6.4）
│   ├── smoke/             #   真机/SSR 级冒烟（i18n-ssr.mjs：全站双语渲染）
│   └── sync-public.mjs    # 构建期 data/ → public/ 逐文件对账
├── src/                   # 前端（Vite + Vue3 + TS）
│   ├── views/             #   路由级页面，一路由一文件，后缀 View
│   ├── components/        #   可复用展示/交互组件
│   ├── lib/               #   纯逻辑层（无 DOM 依赖，可被 selftest 直接 import）
│   │   ├── catalog.ts     #     品类/系列/价格派生（折叠屏判据、三榜取样）
│   │   ├── price.ts       #     ★ 官方起售价的**唯一真身**（曾被抄三份且口径不一致，见文件头）
│   │   ├── facets.ts      #     品牌页筛选（系列×品类×排序 + URL 序列化）
│   │   ├── fields.ts      #     规格字段分组渲染
│   │   ├── specs.ts       #     四条能力横条（min–max 归一）
│   │   ├── query.ts       #     搜索/画布共用的归一化与匹配层
│   │   ├── board.ts       #     环面几何
│   │   ├── globe.ts       #     球面几何（与 board 是两套实现，别互相套用）
│   │   ├── assets.ts      #     资源路径（跟着 BASE_URL 走，Toy 挂子路径用）
│   │   └── site.ts        #     站点标识单一真源（仓库/许可证/字体名，见 §2.5.2）
│   ├── router/            #   路由表（hash 模式，见 §1.4；表单独 export 供 SSR 冒烟复用）
│   ├── i18n/              #   vue-i18n 装配（缺键抛错、locale 存取、currentLocale）
│   ├── locales/           #   语言包 zh.json / en.json（键必须一一对应，见 §2.6）
│   ├── types.ts           #   前端视图模型类型（见 §1.3 命名争议）
│   ├── env.d.ts           #   Vite 环境类型声明
│   ├── App.vue            #   根组件（页头/页脚/筛选条）
│   ├── main.ts            #   应用入口
│   └── style.css          #   全局样式（Tailwind 入口 + 设计令牌）
└── dist/                  # 构建产物（gitignore，可确定性重建）
```

### 1.2 三层职责边界（越界就是设计错误）

前端分三层，**依赖方向单向向下，不得反向**：

```
views/  →  components/  →  lib/
（页面）    （展示交互）    （纯逻辑，无 DOM）
```

| 层 | 能做 | 不能做 |
|---|---|---|
| `views/` | 调 `lib/`、组合 `components/`、读 URL 参数 | 写业务计算（应下沉到 `lib/`） |
| `components/` | 收 props、发事件 | 直接改 `lib/` 内部状态、读全局路由 |
| `lib/` | 纯函数 + 类型 | **碰 DOM / `window` / 生命周期**（除 `renderExportImage.ts` 这类浏览器合成器，见下） |

> **为什么**：`lib/` 纯函数能被 `selftest.mjs` 直接 `import` 并断言。
> 一旦 `lib/` 依赖 DOM，自测层就够不着了——这正是本项目自测能覆盖 103 项的前提。

**`lib/` 的两类例外**（必须写明理由，否则会被人"顺手统一"掉）：
- `renderExportImage.ts` — 在浏览器里合成导出 PNG，无法脱离 DOM；
- `useDataset.ts` — 组合式 API，天然绑定组件生命周期。

### 1.2b 派生事实一律下沉 `lib/`，且必须配自测 🔴

「最新/最贵/最便宜」「苹果折叠屏系列 vs 标准系列」「官方起售价」这些都不是
`products.json` 里的字段，而是**派生事实**。写在组件里就会散成 N 份各写各的判定，
改一处要改多处，且没人能测 —— 而且这类东西的典型失败形态是**静默选错**
（页面照常渲染，只是「最贵那台」选错了），闸门和构建都不会报。

| 派生层 | 文件 | 谁在用 |
|---|---|---|
| 品类（手机/折叠屏/平板/笔记本/音频） | `catalog.ts` | 广场三榜、品牌页品类分面 |
| 系列（苹果标准/Plus/Pro/Pro Max/Air/e/Duo；华为直接用官网 `line`） | `catalog.ts` | 品牌页系列分面 |
| 官方起售价（多容量档取最低档） | `catalog.ts` | 三榜价格、品牌页价格排序、对比页标价 |
| 筛选与排序 + URL 往返 | `facets.ts` | 品牌页 |

**三条配套纪律**（每条都对应真实故障）：

1. **判据要落在语义不可再分的最小单位**，不能抄某一家官网的句式 ——
   抄 Mate XT 的「折叠态」会漏判写「折叠：」的 Mate X6/X7（`PITFALLS.md` P10）。
   写完判据必须拿「同一语义、多种措辞」的样例验一遍，只验一个样本等于没验。
2. **没有数据就说没有**：平板/笔记本/音频在本数据集里台数为 0，
   页面显示「暂无数据」，**绝不**因为「苹果肯定有 iPad」就凭空造一台。
   品类位先留着，将来接了数据源自动填上，页面不用改。
3. **缺价不是 0**：官方未公布中国区售价的机型不进价格榜；
   价格排序时缺价的**排末尾**，而不是当 0 元顶到「最便宜」榜首
   （`selftest.mjs` 对这条有反向测）。

> **URL 即状态**：筛选/选择条件全部编码进 query，刷新与分享都保得住。
> hash 路由下**必须从 `route.query` 取，不能读 `location.search`** ——
> query 段在 hash 里面，`location.search` 永远是空串，症状是
> 「筛选点得动但 URL 拼不对、刷新必丢」（`PITFALLS.md` P12）。
> 手改 query 的非法值回落默认值，不抛错。

### 1.2c 系列分两层：系列 / 变体 🔴

**`Pro` / `Pro Max` / `Plus` 是「标准系列」的后缀，不是与它平级的独立系列。**
把它们平级会让人误以为那是两条并行产品线（第一版就是这么错的，用户 2026-10-05 指出）。

| 层 | 苹果 | 华为 |
|---|---|---|
| **系列**（一行，筛选条第二档） | 标准 / Air / SE / 折叠屏 | Mate / Pura / nova / 畅享 / Pocket |
| **变体**（次级，筛选条第三档） | 标准 / Pro / Pro Max / Plus / 折叠双屏 | 标准 / Pro / Pro+ / Pro Max / Ultra / RS / 优享版 / 风驰版 |

实现都在 `catalog.ts` 的 `seriesOf()` / `variantOf()`：
- 华为系列**直接用 `line`**（官网自己的划分），不自己判 —— 自己判只会更差；
- 苹果 `line` 全是 `"iPhone"` 一个值，只能从机型名派生；
- 变体表**长后缀必须排在短后缀之前**（`Pro Max` 先于 `Pro`），否则 Pro Max 机型
  会落进 Pro 档，分面计数莫名少一台。

### 1.2d 筛选条维度顺序：品类第一 🔴

维度集合早已不是手写数组，而是**两段拼接**（`facets.ts`）：

```
IDENTITY_KEYS（身份维度，顺序即展示顺序）
  品类 → 形态 → 品牌 → 系列 → 变体 → 芯片 → 内存 → 年份 → 价格
DIMENSION_KEYS = IDENTITY_KEYS + schema 里 facet:true 的参数维度
  （phone.json 现有 6 个：refreshHz / motor / fiveG / nfc / irBlaster / esim）
```

**品类排第一**是用户 2026-10-05 明确要求的：先说「要看手机还是平板」，
再说品牌与系列。这个顺序由 `selftest.mjs` 的
`品类是筛选条的第一个维度` 钉死 —— 改顺序会报红。

> 参数维度不写死在代码里：schema 某字段标了 `facet:true` 就自动成为筛选维度，
> 展示名取 schema 的 `label/labelEn`（数据侧双语）。加维度 = 改 schema，不改 facets.ts。

> 品牌页与机型库对比页**必须共用同一个 `FilterBar` 与 `facets.ts`**，
> 否则「苹果折叠屏」在两页会给出不同答案（同一个问题两个答案就是 bug）。
> 品牌页只是把 `brand` 维度去掉（它已由路由确定）。

### 1.3 ⚠️ 两份 `types.ts` 的命名争议（已知问题，别再"顺手统一"）

项目里有**两个都叫 `types.ts`** 的文件，职责不同：

| 文件 | 侧 | 导出 | 谁用 |
|---|---|---|---|
| `src/lib/types.ts` | **管线侧数据契约**（Node 侧） | `ProductRecord` / `Snapshot` / `BrandId` / `Sku` | `scripts/sources/*`、`sync/validate.mjs` |
| `src/types.ts` | **前端视图模型**（浏览器侧） | `Product` / `Dataset` / `Vendor` / `Continent` | `src/` 全部 14 处 |

**为什么必须分开**：管线侧要 `provenance`（溯源）与 `Caliber`（口径），前端侧不需要——渲染时口径已经定死。
合并会让前端类型背上几十个它不关心的字段，且改管线契约就要动前端。

**注意**：`Camera` 类型在两处各自定义，**这是有意重复**，不是漏抽公共类型——
两者的字段集合本来就不同（管线侧带 `provenance`，前端侧要 `role`/`mp` 给渲染用）。
强行合并会造出一个谁都不匹配的联合类型。

> **未来若要重命名**（例如 `src/types.ts` → `src/lib/view-models.ts`），
> 必须是独立一次提交、只改名字不改内容，且同步更新本文表格。禁止顺手改。

### 1.4 路由与部署（Toy 平台硬约束）

| 项 | 值 | 为什么 |
|---|---|---|
| 路由模式 | **`createWebHashHistory()`** | 页面挂在 `/toy/<slug>/` 子路径下，history 模式刷新即 404 |
| `base` | **`'./'`** | 同上，绝对路径资源会 404 白屏 |
| 产物目录 | `dist/` | 送审只传 `dist/`，**不传 `src/`** |

> 这三条是**平台约束，不是风格偏好**。改任何一项都会让发布到 B 站 Toy 后白屏。
> `scripts/publish/verify-dist.mjs` 会在构建后拦截绝对路径与失效引用。

---

## 2. 代码风格与命名约定

### 2.1 风格基线（已工具化，不靠自觉）

| 项 | 规则 | 工具 |
|---|---|---|
| 缩进 / 换行 | 2 空格 / LF / UTF-8 / 去尾空白 | `.editorconfig` |
| 引号 | 单引号 | ESLint `quotes` |
| import 顺序 | 内置 → 外部 → 兄弟/父，`import` 句法统一 | ESLint `import/order` + Prettier |
| 格式化 | Prettier 全权负责 | `npm run format` |

```bash
npm run format      # Prettier --write
npm run lint:fix    # ESLint --fix（只动风格规则）
npm run lint        # 只报告，CI 用
```

> **ESLint 故意不开 `js.configs.recommended` 与 `no-unused-vars`**：
> 前者会把解析器里刻意使用的模式（`no-irregular-whitespace`/`no-control-regex`/`no-sparse-arrays`）判成错误；
> 后者会让 `--fix` 自动删 import，从而**改变行为**——违反「只规范风格，不改逻辑」。
> ESLint 在本项目里**只管** `import/order` 与 `quotes`。

### 2.2 文件与目录命名

| 对象 | 约定 | 例 |
|---|---|---|
| 组件文件 | `PascalCase.vue` | `BoardCanvas.vue` |
| 视图文件 | `PascalCase` + `View` 后缀 | `GlobeView.vue` |
| 逻辑模块 | `camelCase.ts` | `canvasFilter.ts` |
| 管线脚本 | `kebab-case.mjs` | `verify-dist.mjs` |
| 文档 | `UPPER-CASE.md` | `DATA-CONTRACT.md` |
| 类型/接口 | `PascalCase`（`Product`） | |
| 常量 / 纯函数 | `camelCase`（`continentOf`） | |
| 布尔量 | `is` / `has` / `can` 前缀 | `isConsistent`、`hasPointer` |

### 2.3 组件命名：领域前缀优先

`components/` 下的组件分两类，命名规则不同：

| 类别 | 规则 | 例 |
|---|---|---|
| **领域组件** | 必须带**领域前缀**，全项目唯一 | `Board*`（画布域）、`Globe*`（球面域） |
| **通用展示组件** | 无前缀，但**必须是纯展示**（只收 props） | `SpecTable` / `ChampionRow` / `SectionFrame` |

**为什么要前缀**：`BoardCanvas` 与 `GlobeCanvas` 是两套**完全不同的几何实现**，
名字相近极易让人以为可以互相套用（历史上真的套用过，见 `PITFALLS.md`）。
前缀是最便宜的隔离标记。

> **新增组件前先自问**：
> 它服务于哪个域？属该域就用该域前缀（`Board`/`Globe`/新域），
> 否则必须能证明它是纯展示、无任何域逻辑。

### 2.4 事件与 props 命名

| 类型 | 约定 | 例 |
|---|---|---|
| 自定义事件 | `kebab-case` | `@drag-start` |
| 组件 prop | `camelCase` | `:viewportWidth` |
| DOM 事件 | 原生名，不加 `on` | `@click`（**不是** `@onClick`） |
| 布尔 prop | `is`/`has`/`can` 前缀 | `isLoading` |

> 记忆里的真 bug 值得重述：命令式 DOM 注入 + scoped 样式不命中、指针捕获劫持 click，
> 都是**事件与样式约定没落实**导致的，详见 `PITFALLS.md`。

### 2.5 CSS 与样式

- Tailwind 为主，`src/style.css` 里定义设计令牌（颜色/间距/字体）；
- 组件样式用 `<style scoped>`；
- **命令式注入的 DOM 拿不到 scoped 样式**——必须 `:deep()` 或写全局样式。
  这是本项目踩过的真 bug（`BoardCanvas` 瓦片竖直堆叠，只有真机拖拽才暴露）。

#### 2.5.1 像素视觉纪律（改样式前必读）

基调是 Terraria / Minecraft 式像素美学。**四条硬规矩**，违反即风格破功：

| 规矩 | 具体 | 为什么 |
|---|---|---|
| **零圆角** | 除球体 `.globe-body`（几何必需，正球轮廓必须是圆） | 像素画里没有曲线边缘 |
| **零模糊** | 禁 `backdrop-filter` / `filter:blur()` / 带 blur 半径的 box-shadow | 高斯连续 ≠ 像素 |
| **零渐变** | 天空/地面用**离散色带**（`Sky.vue` 的 flex 堆叠纯色块）；进度条用 `repeating-linear-gradient` 打方格 | 连续过渡是插值，像素是枚举 |
| **字号取 12 的整数倍** | 12 / 24 / 36px，不要 13 / 14 / 18 | 12px 点阵被非整数倍缩放就糊 |

配套约定：

- **阴影一律「硬投影」**：不带 blur 的偏移实心色块（`box-shadow: 3px 3px 0 0 …`）；
- **hover 是「按下一格」**：`transform: translate(3px,3px)` + 收起的 box-shadow，
 配 `transition: … 90ms steps(2,end)`；不用 `translateY(-2px)` 的悬浮感；
- **装饰的视觉重量必须与容器匹配** 🔴（2026-10-06 顶栏实测）：
  `pixel-button` 的 `3px 3px` 硬投影读作「厚度」，那是**页面里大按钮**的加分项；
  但顶栏按钮只有 12px 字高，投影让它比文字高 6px，七个排一排就是一条厚带子
  （实测顶栏 76px，装饰占 38px）。所以顶栏用 `.pixel-button-flat`（纯平面，
  当前页用金色底 + `aria-current`，**不用位移** —— 位移会把整条导航顶歪）。
  同理**描边宽度跟着字号走**：24px 字配 2px 描边是对的，12px 字配 2px 会把笔画缝隙填满。
  这条不是「越素越好」，而是**尺度匹配**：加装饰前先问「它相对容器有多大」。
- **图标走 SVG 不走字符**：字体子集里没有 `✓ ✗ ⚠ √ ≤ ≥`，用字符会静默回退成非像素字形。
  统一用 `src/components/PxIcon.vue`（16×16 整数坐标路径 + `crispEdges`）；
- **不要写行内 `box-shadow`**：一律用 `.pixel-*` 组件类（style.css 的 `@layer components`）。
  行内样式散落各处正是「同一元素在不同页面圆角不一致」的成因。
- **链接走 `.pixel-link`**：常态金色无下划线，hover 才出**虚线**下划线。
  不用浏览器默认的连续实线下划线（12px 点阵下必落非整数像素，且跨字符长度不均匀）。
  站外链接一律 `target="_blank" rel="noopener noreferrer"`；
  站内相对资源（字体许可证等）走 `lib/assets.ts` 的 `asset()`，**不许硬写 `./`**。

自动检查：`_smoke-pixel.cjs`（puppeteer，逐页扫模糊/圆角/字号/字体），
三条检测项**都已反向测过**（注入违规确认报红，见 `PITFALLS.md` P8 的同源纪律）。
⚠️ **它的 `PAGES` 清单是白名单，新页面不在清单里就等于没被扫**
（`#/about` 曾因此带着两处违规字号长期隐身，加进清单后当场报出）。
**加页面必须同时加进这个清单**，否则「零违规」只覆盖清单内那几页。

许可与署名：

- 站点标识（仓库地址、许可证名、字体名、上游地址）集中在 **`src/lib/site.ts`**，
  **唯一真源**。页脚与关于页都从它取 —— 同一个值写两份、改名漏一处就是静默指向旧地址；
- 许可信息**只写在关于页**（`AboutView.vue` 的「许可与署名」小节），
  页脚只留三词短链入口。**别在每个页面底部铺开**（用户已明确否掉那种做法）；
- 字体是 OFL-1.1 的**修改版**（子集化），OFL 要求改名 + 披露修改，
  故 `SpecPixel` 这个名字与「Fusion Pixel 子集」这句话**必须出现在站内**，
  只放在 `public/fonts/OFL.txt` 里等于没披露。

字体相关：

- 像素字体是 `SpecPixel`（Fusion Pixel 子集，OFL-1.1，因修改已改名），
  `public/fonts/OFL.txt` 是许可证全文；
- 换字体/加文案后跑 `npm run font:check`。缺字形**不会**让构建失败，
  只会让那些字悄悄变回系统圆滑字体，所以单独设闸门拦（详见 `PITFALLS.md` P8）；
- 重新生成子集：`python scripts/font/build-subset.py`（需 fontTools + brotli）。

---

## 2.6 文案与多语言（i18n）纪律 🔴

> 背景：本项目原来是**诚实单语**（界面全中文、无 i18n 机制，约 150 处硬编码）。
> 2026-10-13 全量改造为 vue-i18n（`zh-CN` / `en`）。做这套纪律的唯一理由是
> **DevEco Code 那种反面教材**：机制给了承诺、内容没兑现（i18n 骨架搭好，
> 实际覆盖 3%），于是「支持多语言」这句话本身变成了假话。
> 下面每一条都是为了堵死「机制在、内容不在」。

### 2.6.1 三条硬红线

| # | 规则 | 违反会出什么真实故障 |
|---|---|---|
| 1 | **缺键抛错，不回退** —— `src/i18n/index.ts` 配 `missing: throw`，且**不许配 `fallbackLocale`** | 配了回退就成了「英文缺键 → 静默掉回中文」，页面半中半英且零报错，正是 DevEco 那种假话 |
| 2 | **语言走 `localStorage`，首屏即生效** | 存了 `en` 却刷新后先渲染一帧中文再跳英文（闪烁 + 分享卡片抓取到中文标题） |
| 3 | **`<html lang>` / `<title>` / meta description 跟随语言**（`App.vue` 的 `watch(locale, …, { immediate: true })`） | 屏幕阅读器用中文发音念英文页；分享卡片标题与正文语言不一致 |

### 2.6.2 键的写法

- **键必须是字面量**：`t('about.principleOne.title')`。
  `t('about.principle' + n + '.title')` **禁止** —— 拼出来的键对账闸门看不见，
  于是「删了某个键」的绿灯是假的；
- **lib 层一律读 `currentLocale()`，不接受 `locale` 参数**。
  参数会成为第二真源，与 lib 内部自己的 `t()` 打架，产出中英混排且无闸门可报
  （`catalog.ts` / `facets.ts` / `fields.ts` / `specs.ts` 已全部去掉该参数）；
- **id 不翻译、只翻译展示**：系列 / 变体 / 价格档的 id 进 URL，保持原文，
  展示层过 `seriesLabel()` / `variantLabel()` / `priceLabel()`。
  翻译 id 会让分享链接失效；
- **切换器自身文案不进包**：`LocaleSwitch.vue` 各语言写自己的自称（中文 / English）。
  切换器是给「看不懂当前语言」的人用的救命入口，译成另一种语言反而认不出来；
- **查表键要和调用方传进来的一致**：`seriesOf` / `variantOf` 返回的是 **label**，
  `seriesLabel` / `variantLabel` 就必须按 `label` 查表。
  `variantLabel` 曾经写成 `v.id === id`，于是中文变体（优享版 / 风驰版）永远查不到
  `labelEn`、英文页直接吐中文 —— 而拉丁变体（Pro / Ultra）因为 label 与 labelEn
  恰好相同而「看起来是对的」，故障藏了整整一轮。
  **「看起来对」的那部分，正是最会掩护故障的部分。**

### 2.6.3 数据侧双语成对

`label` 与 `labelEn` 必须成对出现（`unit`/`unitEn`、`name`/`nameEn` 同理）：

| 文件 | 双语字段 |
|---|---|
| `data/schemas/phone.json` | 48 个字段的 `labelEn`，中英不同形的单位补 `unitEn`（英寸→in、核→cores、小时→h） |
| `data/view-phone.json` | 每个 `groups[].titleEn`、每个有 `label` 的行的 `labelEn` |
| `data/curated/facets.json` | `variants[].labelEn`、品牌 `series[].labelEn`、`priceBuckets[].labelEn`、`fallbackLabelEn`、`lineEn`、`chipPrefixEn` |

**管线写进数据的文案也要键化**，不能让管线拼中文串：
`scripts/sync/index.mjs` 给 `snapshot.sources[].note` 写的是中文
（「64 条取证，0 条未解决」），前端直接展示就会在英文页吐中文。
现在同时写 `noteKey` + `noteParams`，前端按语言渲染，**数字走插值参数**而不是拼进句子。
改了这里必须重跑 `node scripts/pipeline.mjs --data-only` 再生一次产物。

### 2.6.4 两道闸门（都必须能报红，已反向测过）

| 闸门 | 命令 | 拦什么 |
|---|---|---|
| 语言包双向对账 | `npm run selftest`（`i18n 覆盖` 段） | 中英键集双向一致、引用↔定义双向、插值占位符中英一致、数据侧 `labelEn` 齐全、切英文后参数表/维度名/能力名/排序名/状态名不得残留 CJK |
| 全站 SSR 双语冒烟 | `npm run smoke:i18n` | 13 条路由 × 2 语言渲染一遍：缺键抛错、英文页界面残留中文、中文页一个汉字都没有（防假绿） |

`scripts/lib/i18n-keys.mjs` 的扫描器**必须先剥注释**（`<!-- -->` / `/* */` / `//`）
再匹配，开引号前不能是 `=` / `.` / 标识符 —— 否则 `product.id`、`filter.q`
这类 Vue 模板属性与注释里的假键会淹出几百条假警（2026-10-13 实测：332 条）。

扫描范围**含 `scripts/`**：管线会把键名写进数据（`noteKey: 'about.sourceAppleOfficial'`），
只扫 `src/` 会把它们当成僵尸键误报。同时排除两处噪声源（写明理由，见脚本内注释）：
`scripts/selftest.mjs` 自己（它断言的是数据字段路径，不是界面键）与
`scripts/sources/**`（取数适配器只碰官网 HTML 与文件名，如 `compare.html`）。

SSR 冒烟同理必须剥 `<!-- -->`：模板里大段中文「为什么这么写」的设计说明会被
SSR 原样输出，不剥的话几百条假警会淹没真泄漏。

**数据白名单要窄，越宽越像装饰品**（2026-10-14 实测教训）：
第一版图省事把 `public/data/*.json` **全文**扫进去，于是官网原文（`rawOfficial`）
里的常用字「全部 / 与 / 麒麟」全成了白名单词——三处真的硬编码
（画布分面、搜索提示、芯片名）在英文页上堂而皇之地显示，冒烟一直绿。
现在只认两级：① 产品标识字段（`name` / `nameZh` / `line` / `modelCode` / 品牌名）；
② specs 官网原文值**过完术语表之后仍然残留的中文**（见 §2.6.5）。
**但 `chipset.name` 整条不进白名单** —— 芯片型号有厂商公布的官方英文名
（麒麟 = Kirin、A18 芯片 = A18 chip），它是标识不是描述，必须翻译。把标识与描述分开，
是这条白名单不沦为「什么都放过」的关键。

⚠️ 第二级白名单必须**调用 `localizeSpecValue()` 真算一遍**，不能把 specs 原文整段扫进来：
整段扫等于把「铝金属设计」这类已经能翻译的词也洗白，术语表哪天失效冒烟照样绿
—— 同一个洞会以同样的形状再犯一次（P32 的翻版）。喂函数再收残留，
白名单才会跟着词表一起收窄：补一条词，白名单瘦一圈，闸门紧一分。

**已知局限**（别把绿灯当成全覆盖）：SSR 只渲染首屏，交互后才出现的 DOM
（下拉面板、浮层、错误提示）不在扫描范围内。画布分面那次就是这么漏的——
它压根没渲染，所以「修没修好」都得靠人眼或补一条针对性断言。

### 2.6.5 参数值：官方术语表（`data/curated/glossary.json`）

specs 里的值是**中文官网原文**（数据诚信：不改写、不换算）。数值（`6.1 英寸`、`120 Hz`）
本来就语言中立，英文页混排的只有**术语**。术语表把能查到官方英文的词换掉：
`超视网膜 XDR 显示屏` → `Super Retina XDR display`、`昆仑玻璃` → `Kunlun Glass`、
`A18 芯片` → `A18 chip`、`内屏：` → `Main Screen:`。

**为什么不做「抓一份英文官网」（这条路被证伪了，别再试）**：

| 理由 | 证据 |
|---|---|
| 数据根本不存在 | 华为国际站没有国内站这批机型：`consumer.huawei.com/en/phones/mate90-pro-max/specs/` 实测 **404**（Mate 90 系列是中国线） |
| 代价是复制一整套真源 | 规范化层 **2700+ 行**（index+parse+shared+brands，实测 2767 行）深度依赖中文正则**（`/芯片$/`、`/超瓷晶\|昆仑/`、`/英寸/`）。做英文版就是再造一份规范性真源，两边的「6.1 英寸」出自两套正则却互不对账 —— 比中英混排危险得多 |
| 术语级对照就够 | 中英两版是同一份规格的逐条对应（已核对：中文「超瓷晶面板 (正面)」↔ 英文 `Ceramic Shield front`） |

**纪律**（与已删掉的 `chipPrefixEn` 一致）：**只登记能在厂商官方英文页面找到出处的词**，
每条带 `ev` 指向官方页面 URL。查不到的一律不登记，英文页保留原文——
本站卖点是「可核验」，编造译名比中英混排严重得多。

两个覆盖率，别混为一谈（2026-10-14 审计纠偏，此前这里张冠李戴）：

| 指标 | 现值 | 闸门判据 | 在哪 |
|---|---|---|---|
| **术语表覆盖率**（含中文的 specs 值里有多少有官方英文译名） | 约 64% | **绝对底线 60%**，跌破即红 | `selftest.mjs` 术语表用例 |
| **整值字段覆盖率**（schema 48 字段 × 62 台有多少格有值） | 约 59%（2026-10-15 实测 1747/2976） | 必填 6 字段（releaseDate/重量/厚度/尺寸/分辨率/存储）各 100%；闸门只拦**比上一版跌超 5 个百分点**，没有绝对下限 | `sync/validate.mjs` 的 `maxCoverageDrop` |

整值覆盖率的缺口不是失败：中国特有功能（北斗/天通卫星消息、nano-SIM 双卡）与
查不到官方英文的术语（第三代昆仑玻璃、铝硅玻璃、可折叠柔性 OLED）**诚实保留
「未公布」是正确降级**——用 0、空串或估算值填满格子才是数据诚信红线
（见 `docs/PRINCIPLES.md` 原则一）。

三段分工：`exact` = 整片段固定词；`patterns` = 「N 核 X」「N Hz Y」这类模式化短语
（锚定整片段，只替换一次）；`prefixes` = 品牌名，可在一行出现多次
（`麒麟 9020A 麒麟 9020B`），仅在前两段没把中文清干净时**全局兜底**。
匹配顺序：整值 exact → 逐片段 exact → 逐片段 pattern → prefix 兜底 → 保留原文。
「逐片段」是因为官网原文本身就用 `|` / `,` / `、` 分隔并列短语，
整句替换会因一两个词没登记而整句失效。

**接入口只有一个**：`src/lib/fields.ts` 的 `specGroups()` 出口统一过一遍，
芯片名走 `catalog.chipNameLabel()`（它内部也调同一个函数）。
新增展示点务必走这两个出口，不要自己读 `p.chipset?.name` ——
2026-10-14 就是搜索建议与画布短规格两处直读原值，冒烟才把它们抓出来。

---

## 3. 技能（Skill）与插件的目录/注册/启用约定

> 本节规范**本机 WorkBuddy 环境**下的技能与插件。它们的注册位置在
> `~/.workbuddy/`，**不在项目仓库内**——所以「入库的是代码与数据，工具链在用户目录」
> 是本项目的边界，不要把 `~/.workbuddy/` 内容拷进仓库。

### 3.1 目录结构

```
~/.workbuddy/
├── skills/<skill-name>/
│   ├── SKILL.md            # 必需：YAML frontmatter（name/description/license）
│   ├── scripts/            # 可选：自包含脚本（Python/Node）
│   └── references/         # 可选：参考资料
└── user-<id>/
    ├── MEMORY.md           # 跨项目长期记忆（人工维护的硬规矩）
    ├── SOUL.md / IDENTITY.md / USER.md
```

### 3.2 注册 / 启用机制（三层，分工不同）

| 层 | 位置 | 作用 | 是否进仓库 |
|---|---|---|---|
| 技能 | `~/.workbuddy/skills/` | 放哪就能被发现（`SKILL.md` 存在即注册） | ❌ |
| 插件/连接器 | WorkBuddy 连接器面板 | 授权 + 开关，`bound` / `enabled` 状态 | ❌ |
| 引用 | `package.json` / CI / 文档 | **把外部技能当依赖声明**，让缺它的人早失败 | ✅ |

**关键认知**：技能**没有"注册表"**，靠文件系统路径 + `SKILL.md` 的 frontmatter 自注册。
所以「装了没生效」的排查顺序是：路径对否 → `SKILL.md` frontmatter 有 `name`/`description` 否 → 触发词是否匹配任务。

### 3.3 启用与禁用

| 动作 | 做法 | 注意 |
|---|---|---|
| 启用 | 技能：放进 `~/.workbuddy/skills/` | 不需重启会话 |
| 禁用 | 从目录移出，或 `skill_management` 关闭 | **不要**改 SKILL.md 内容来"禁用" |
| 插件开关 | 连接器面板切换 `bound` / `enabled` | 未授权的插件 `bound:false` 仍需首次连接 |

> **纪律**：工具链的启停**不进项目仓库**。仓库里只写「本项目依赖哪个工具、缺了会怎样」。

### 3.4 对外暴露接口的约定（CI 契约）

本项目把脚本当**对外接口**用，契约如下——CI 与他人机器都依赖它：

| 接口 | 契约 | 破坏后果 |
|---|---|---|
| `node scripts/pipeline.mjs --data-only` | 写 `data/`，**失败必须非零退出**且保留旧快照 | 静默写坏数据 = 全站口径错 |
| `node scripts/selftest.mjs` | 全绿退出 0，有失败非零 | 红灯不阻断等于没有闸门 |
| `npm run build` | 后接 `verify-dist.mjs`，不过则非零 | 白屏产物被发布 |
| `npm run lock:check` | 发现非官方源非零退出 | 境外 CI 装包失败 |
| `npm run lock:fix` | 原地改写，**改完仍须 `lock:check` 通过** | 写坏 lock |

> **改名 = 破坏契约**。任何脚本/脚本名的重命名都必须同步改 `.github/workflows/*.yml`、
> `package.json`、本文档与 `README`，并在提交信息里显式说明。

---

## 4. 依赖管理、脚本命令与环境变量

### 4.1 依赖纪律

| 项 | 规则 |
|---|---|
| 管线侧（`scripts/**`） | **只用 Node 内置模块**（`node:*`），零第三方依赖 |
| 前端侧（`src/**`） | 依赖保持在个位数，当前为 `vue` + `vue-router` + `vue-i18n`（i18n 见 §2.6） |
| 提交的 `package-lock.json` | `resolved` **只允许** `registry.npmjs.org`（见 `PRINCIPLES.md` §9） |
| 新增依赖 | 先问「能不能用内置能力写」；必须加时说清替代方案与成本 |

> **为什么管线零依赖**：CI 少一个装包失败点，十年后还能跑。
> 若管线需要 `cheerio` 之类，就等于把「上游改版能否当天修完」绑到第三方包的维护节奏上。

### 4.2 脚本命令（`package.json`）

| 命令 | 作用 | 何时必须跑 |
|---|---|---|
| `npm run data` | 跑数据管线（`--data-only`） | 改了解析器/闸门 |
| `npm run selftest` | 纯函数自测（不联网、~1s，含 i18n 对账闸门） | **改解析器/闸门/几何/语言包前必跑** |
| `npm run smoke:i18n` | 全站 SSR 双语冒烟（13 路由 × 2 语言） | **改了界面文案 / 加删语言包键必跑**（见 §2.6.4） |
| `npm run build` | 构建（含 prebuild 同步 + postbuild 闸门） | 交付前 |
| `npm run lint` / `lint:fix` | 风格检查 / 自动修 | 交付前 |
| `npm run format` | Prettier 格式化 | 交付前 |
| `npm run lock:check` / `lock:fix` | 依赖源检查 / 规范化 | 装过新依赖后、推送前 |
| `npm run font:check` | 字形覆盖检查（字体缺字形是静默失效） | 换字体、改界面文案后 |
| `npm run conventions:check` | 规范自检（Toy 约束/零日志/命令式 DOM 样式） | 交付前 |
| `npm run dev` | 本地开发服务器 | 交互验证 |

**固定顺序**：`lint:fix` → `selftest` → `build`。
**理由**：格式化会碰代码，改完必须重跑自测确认没改坏逻辑（格式化本身不该改行为，但**要验证**）。

### 4.3 环境变量

本项目**几乎没有环境变量**——这是刻意的（零 AI 依赖、零密钥、可离线重建）：

| 变量 | 用途 | 现状 |
|---|---|---|
| `import.meta.env.BASE_URL` | Vite 注入，`lib/assets.ts` 取资源基址 | **唯一**一个 |
| `TOY_CLI_SESSION_TOKEN` | CI 送审 B 站 Toy | 仅 `.github/workflows/toy.yml` 用 Secret |
| `TOY_ID` | 目标 Toy id | 仅 CI，**未配则安静跳过** |

**约定**：
- **不使用** `VITE_*` 传密钥——前端产物里的一切都是公开的；
- 敏感值**只**走 CI Secrets（`secrets.*`），**永远不硬编码、不进日志**；
- 缺可选 Secret 时**安静跳过并 warning**，不要天天报红让人麻木；
- 新增环境变量必须登记进本表，并说明「本地默认值 / 生产是否必需」。

---

## 5. 文档、注释与调试日志

### 5.1 文档体系

| 文档 | 面向 | 维护触发 |
|---|---|---|
| `../README.md` | **用户 + 上手** | 功能/脚本/部署方式变化 |
| 本文 |  contributor | 目录/命名/依赖/日志约定变化 |
| `PRINCIPLES.md` | contributor | 技术原则增删 |
| `AUTOMATION-RECIPE.md` | 跨项目迁移 | GitHub 侧配置变化 |
| `DATA-CONTRACT.md` | 数据 | 字段增删或口径变化 |
| `PITFALLS.md` | 排查 | **每踩一个新坑就加** |

**README 必须包含**（缺一即为不合格）：一条命令跑通、目录说明、怎么改数据、
怎么本地验证、部署注意事项。

### 5.2 注释纪律

注释解释**为什么**，不解释**是什么**。

```ts
// ✅ 解释原因与约束
// 判定用「某品牌接近 0、另一品牌接近 1」，不是「缺失最多的品牌」。
// 因为覆盖率高不代表没有系统性缺口。
const structural = byBrand.rate('huawei') < 0.2 && byBrand.rate('apple') > 0.8;

// ❌ 复述代码
// 计算 structural
const structural = ...;
```

**必须写注释的地方**：
1. 踩过坑的地方（写明**什么故障** + 为什么加这个判断）——防止被后人"清理"掉；
2. 平台/环境约束（Toy 子路径、CI 境外节点）——这类约束从代码里看不出来；
3. 反直觉的实现（"这里不能合并 X 和 Y"）——并注明**不合并的原因**。

**禁止**：注释掉的死代码（删掉，git 有历史）、逐行翻译代码、说谎的注释（比没注释更糟）。

### 5.3 调试日志

| 环境 | 策略 |
|---|---|
| `src/**`（前端运行时） | **零 `console.*`** —— 用户看得到，污染且可能泄露内部路径。调试走 `npm run dev` 的 Vue Devtools |
| `scripts/**`（管线） | 用 `console.log` 输出**阶段进度**（`▶ 数据层：…`），这是**功能**不是调试；可加 `--verbose` 才输出详情 |
| 临时排查 | 用后即删。**禁止**提交 `console.log` / `debugger` / `TODO` 到仓库 |
| 敏感信息 | **一律不打印**：token、会话、用户身份、完整个人路径 |

> `scripts/selftest.mjs` 的 `console.log` 是**自报结果**（"103 项全通过"），属功能输出，保留。

**纪律**：`grep -rn "console\.\|debugger" src/` 应**零命中**——
这可以作为交付前的自检项。

---

## 6. 规范自检（规范不是纸）

```bash
npm run conventions:check    # = node scripts/publish/check-conventions.mjs
```

已挂进 CI 第一个 job，紧随管线自测。它只检查**能机器判定**的条款：

| 条款 | 判据 | 防的是 |
|---|---|---|
| §1.4 | `vite.config.ts` 的 `base` 必须是 `'./'` | Toy 子路径下绝对路径资源 404 白屏 |
| §1.4 | 路由必须用 `createWebHashHistory()` | history 模式刷新即 404 |
| §4.1 | `package-lock.json` 的 `resolved` 纯官方源 | 境外 CI `npm ci` 失败 |
| §5.3 | `src/` 零 `console.*` / `debugger` | 污染用户视图、可能泄露内部路径 |
| §2.5 | `innerHTML` 注入含标签结构时告警 | 命令式 DOM 拿不到 scoped 样式（真 bug） |

另一道独立闸门 `npm run font:check`（= `node scripts/publish/check-font-coverage.mjs`）
守 §2.5.1 的字体纪律：字形缺失时浏览器静默回退系统字体，零报错。

**主观条款不查**（注释写得好不好、命名贴不贴切、目录分得对不对）——
闸门一旦开始报「审美问题」，就会被整体忽略。**只管能判的**。

> **闸门自身也要被测**。这个脚本开发时被自己的注释骗过一次：
> `// base: './' 是发布到 B 站 Toy 的硬要求` 这行注释里含 `./`，
> 导致正则命中、**真的把 `base` 改成 `'/'` 也检不出来**。
> 修法是匹配前先剥行注释（`stripLineComments`）。
> 这与 `PRINCIPLES.md` §4「闸门自身也会误报」是同一条纪律。
>
> 像素风的两道闸门（`font:check` 与 `_smoke-pixel.cjs`）也都反向测过，
> 且 `font:check` 测了**两条不同的失败路径**（真实缺口 / 清单与字体不同源）。
> 详见 `PITFALLS.md` P8。

---

## 7. 交付前自检单

改动代码后，逐条勾：

- [ ] `npm run lint:fix && npm run format` 已跑
- [ ] `npm run conventions:check` 通过（改了 base/路由/依赖/日志更要跑）
- [ ] `npm run selftest` 全绿（改了解析器/闸门/几何时**必跑**）
- [ ] `npm run font:check` 通过（改了界面文案/字体**必跑**，缺字形是静默失效）
- [ ] 改了界面文案 / 加删语言包键 → `npm run smoke:i18n` 通过（见 §2.6）
- [ ] `npm run build` 通过（含 `verify-dist` 闸门）
- [ ] 改了样式 → `_smoke-pixel.cjs` 零模糊/零圆角/字号整数（需 `npm run preview` 起服务）
- [ ] 装过新依赖 → `npm run lock:check` 通过
- [ ] `grep -rn "console\.\|debugger" src/` 零命中
- [ ] 改了目录/命名/脚本 → **本文已同步更新**
- [ ] 改了字段/口径 → `DATA-CONTRACT.md` 已同步
- [ ] 踩了新坑 → `PITFALLS.md` 已加条目
- [ ] 交互组件改动 → **真机拖一遍**（smoke 脚本不许省）
- [ ] 改了脚本名/路径 → `.github/workflows/*.yml` 与 `package.json` 已同步
