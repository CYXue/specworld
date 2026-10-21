# 参数世界（specworld）— 给接手的 AI

动手之前先读 **`docs/PITFALLS.md`**，它回答「这个项目的故障长什么样」：
34 条坑（P1–P34，多为零报错的静默故障）+ 8 条页面结构假设（A1–A8）+ 一棵排查决策树。
再读 `docs/DATA-CONTRACT.md`（唯一字段定义源）与 `docs/PRINCIPLES.md`（不可违背原则）。
另有两轮全库审计存档备查：`docs/HARDCODE-AUDIT.md`、`docs/AUDIT-REPORT-2026-10-13.md`。

本项目已经重构过一轮（手写多页 HTML → Vite + Vue3 + TS + Tailwind v4），
文档里凡是提到 `scripts/site/`、`scripts/preview/`、`ui.mjs`、`build.mjs` 的段落均为历史记载，
**当前形态以 `README.md` 与本文件为准**。

全程用中文与用户交流。

---

## 一、最常见的三件事

| 用户说 | 怎么做 |
|---|---|
| 「更新数据」 | `node scripts/pipeline.mjs --data-only` → 核对 `data/products.json` 的台数与覆盖率 → `npm run build` |
| 「改解析器 / 闸门」 | **先写断言再改代码**。改完 `npm run selftest`，不通过不许往下走 |
| 「改界面」 | `npm run build` → 起 dev → **真机拖一遍**（滚动/点按/筛选必须真试，必须点进详情页） |
| 「加/改一台机器的参数」 | 编辑 `data/overrides.json`（条目格式见文件内 `_doc`）→ 跑一次 `--data-only`。用户层每次同步重新应用，**官网刷新不会冲掉用户数据**；写错会被闸门拒绝写盘（这是设计） |
| 「macDB 又更新了 / 再对一次账」 | `node scripts/macdb-sync/reconcile.mjs --fetch`（拉 sitemap+详情页并对账）→ 人工研判新机器补 `match-table.json` → `node scripts/macdb-sync/fill.mjs --apply`（只填空缺字段）→ `selftest` + `--data-only`。纪律见 `scripts/macdb-sync/README.md`；macDB 来源条目 source=`macdb-cn` |

---

## 二、改不同东西之前必须先跑什么

**这一节是本文件存在的理由。** 每条都是「不先跑就可能把脏数据发出去」或
「测试全绿但页面是坏的」。

### 改了 `data/schemas/*.json`（品类字段表）或 `data/overrides.json`（用户数据层）
```bash
npm run selftest          # schema 校验 / overrides 合并 / 闸门反向测全在这一层
npm run quality           # 四态填充率 + 完整性校验（确定性，写 _work/quality-report.md）
node scripts/pipeline.mjs --data-only   # 看真实数据过不过新 schema
```
v2 全品类目录（category + specs 扁平容器）的设计见 `docs/UNIVERSAL-CATALOG.md`，
借鉴准绳（Baseline）的四态 `value_status` 与显式分组也在那篇文档里。
「全品类」= 任何可量化产品（第一阶：用电/与电相关的电子产品；第二阶：行李箱等非电但可量化的实物，小米也有此品类）。
新增非电品类与新增电子品类走**同一套零代码 recipe**（`categories.json` 加一行 + `schemas/<id>.json` 加字段表），
电子专属分组（屏幕/电池/摄像头…）对非电品类标 `not_applicable` 即可，闸门/质量报告/编辑原型零差别。
**身份字段对所有品类通用**（顶层、不进 specs）：`brand`（slug，显示名由 vendors 注册表派生）/ `line`（产品线）/ `name`（型号名称）/ `modelCode`（型号代码，如 `MRT-AL10`/`A3292`，官方来源填充禁编造）/ `releaseDate` / `status`。
三条硬纪律：
- **schema 的 range 必须覆盖全量真实数据 + 合理余量**。折叠机展开宽度 164.6mm
  曾把按直板机猜的 `[50,100]` 闸门打挂——闸门误报一次，全链停摆。
- **override 写错必须显性失败**。字段未注册 / 引用悬空 / 值越界 / id 冲突
  全部拒绝写盘。静默跳过的后果是用户以为改好了而页面纹丝不动。
- **「官方未公布」存成 specs 里的 `null`（或空数组）**，四态取值把它当 `unknown`（"—"），
  不是 `available`。给字段填 `0` / 空串去「补覆盖」是数据诚信红线（见原则一）。
  `unknown` 跨品牌一致集中在某字段 = 官网结构性事实；同品牌内部分化 = 解析器 bug。

### 改了 `scripts/normalize/parse.mjs`（解析器）
```bash
npm run selftest          # 249 项，不联网，1 秒（项数以运行末尾自报为准）
node scripts/pipeline.mjs --data-only   # 再看真实数据有没有变
```
解析器出错**不会抛异常**，它会安静地把 PWM 调光频率当刷新率、把分辨率当屏幕尺寸，
一路畅通发布出去。闸门能挡数值越界，挡不住「看起来很合理但取错字段」。
**「少取一个值」是闸门唯一完全挡不住的错误类型** —— 只能靠断言。

### 改了 `scripts/sync/validate.mjs`（闸门）
闸门是「拒绝写盘」的唯一防线，它自己写错一个边界值防线就漏了。
所以闸门本身在自测范围内，且**新闸门必须反向测**：
故意注入违规 → 必须报出 → 改回 → 必须恢复绿灯。
只跑「当前合规态通过」不算验证过。

### 改了 `scripts/lib/derive.mjs` / `src/lib/facets.ts` / 任何标尺与排序
```bash
npm run selftest
node scripts/qa/index.mjs          # 回答「为什么这台是榜首」「影响面多大」
```
改排序/派生前先跑 qa 看影响面。派生事实一律下沉 `lib/` 且必须配自测。

### 官网抓到了但站上没有这台机器
它大概率在 `data/discovery-pending.json`（待收录队列）里，原因是**缺发布日期**。
补一条 `data/release-dates.json` 的取证后下次同步自动进站 —— `action` 字段把要补的那条写出来了，照抄即可。
队列只有「缺发布日期」这一类；窗口外的老机型与解析失败不入队（详见 `queue.mjs` 的注释）。

### 改了 `scripts/normalize/parse.mjs` 之后想复现官网改版
```bash
npm run archive:check   # 归档件与当前 raw 不一致 = 官网在我们没察觉时改了结构
node scripts/archive.mjs# 更新 data/raw/
```
`data/raw/` 存的是官网原文键值对（不是 HTML），解析器改坏时喂它离线复现，不需联网。

### 顶部导航 / 首页（去像素化后的形态）
自 2026-10-15 起，全站改为现代深色产品数据库风格（参考 Linear / Vercel / Arc Search）：
无像素 banner、无立绘、无自定义字体，顶栏是 `AppTopNav.vue`、页脚是 `AppFooter.vue`，
机型卡片/列表走 `LibraryInner.vue` + `ProductCard.vue` / `ProductListItem.vue`。
改视觉时优先复用 `src/style.css` 里的设计令牌（`--color-surface*`、`--color-border*`、
`--color-fg/dim/faint`、`--color-accent`、`.btn*`、`.card`、`.badge`、`.input`、`.chip`），
不要手写像素式硬色值或 `border-image` 像素描边。

⚠️ **根目录的 `_smoke*.cjs`（如 `_smoke.cjs` / `_smoke-search.cjs`）依赖 `puppeteer-core`，它已在 `devDependencies` 中**
（CI 不需要浏览器，本地用本机已装的系统 Chrome）。无需手动 `npm i puppeteer`。
早期版本曾依赖未入库的 `puppeteer`（`npm i puppeteer --no-save`），`npm ci` 会静默删掉它、
导致 7 个脚本全部 MODULE_NOT_FOUND——2026-10-14 就这么发生过一次。现已迁到 `puppeteer-core`，
`npm ci` 会按 lock 正常装回，不再有「装了又被删」的回归。
端口口径已统一收在 `vite.config.ts`（dev 5183 / preview 4173），脚本默认值引用它；
preview 只监听 localhost（127.0.0.1 不通，实测过）。

### 改了界面文案 / 视觉
```bash
npm run type-check        # vue-tsc：模板与脚本的类型闸，改契约后先跑
npm run smoke             # puppeteer 冒烟：加载 SPA、查控制台错误、验证路由
npm run smoke:search      # 搜索三态（空 / 命中 / 无结果）与 query 进 URL
```
自 2026-10-15 去像素化后，全站改用系统字体栈（CSS `--font-sans`），
**不再有自定义像素字体**，故 `font:check` 与 `_smoke-pixel.cjs` 已退役。
新增页面记得在 `router/index.ts` 登记，并让某个导航链接可达（孤儿页由
`selftest` 的「路由可达性」一节拦截）。

### 改了许可 / 版权 / 署名
站点标识（仓库地址、许可证名、字体名、上游地址）**只有一个真源**：`src/lib/site.ts`。
页脚与关于页都从它取 —— 同一个值写两份，改名时漏一处就是**静默指向旧地址**。

许可信息**只写在关于页**，页脚留三词短链入口。
**别在每个页面底部铺开** —— 用户已明确否掉那种做法。

### 交付前（固定顺序）
```bash
npm run lint:fix
npm run selftest       # 格式化会碰代码，改完必须重跑确认没改坏
npm run build          # prebuild 同步 data/ → public/，postbuild 跑产物闸门
npm run conventions:check
```
理由：`format` / `lint:fix` 会改代码，改完必须重跑自测确认没改坏行为
（格式化本身不该改行为，但**要验证**）。

---

## 三、三条不可违背的原则（展开看 `docs/PRINCIPLES.md`）

1. **数据诚信**：官网没公布就是空，写 `—` / `官方未公布`。
   **不估算、不外推、不用同系列其它机型的值填补。**
   「补全覆盖率」的诱惑是本项目最大的回归风险。
2. **闸门拒绝写盘时必须非零退出**，旧快照原封不动保留。
   「部分成功」比「整体失败」危险得多。
3. **判据是内容指纹，不是 `git diff`**。
   `data/products.json` 里带着 `generatedAt` / `lastSeenAt` 每次跑都在变，
   用它做判据等于每 12 小时制造一次空提交。

---

## 四、目录与数据边界（越界就是设计错误）

```
data/          唯一入库的数据源。顶层 *.json 与 schemas/*.json 进版本库
               （categories.json 品类注册表 / schemas/<品类>.json 字段表 /
                 overrides.json 用户手动数据层 / release-dates.json 取证表）
_work/         中间产物与原始响应缓存 —— 不入库，CI 靠 actions/cache 恢复
dist/          构建产物 —— 不入库
public/data/   data/ 的构建期拷贝 —— 不入库（入库两份必然版本漂移）
```

**入库的只有 `data/` 顶层 JSON。** 这条 CI 里还有一道显式 pathspec 兜底：
`git diff --cached --name-only | grep -Ev '^data/'` 命中即拒绝提交。

**两份 `types.ts` 同名不同职责，别「顺手统一」**：
`src/lib/types.ts` = 管线契约（`ProductRecord` / `Snapshot` / `BrandId`），
`src/types.ts` = 前端视图模型（`Product` / `Dataset`）。

**派生事实一律下沉 `lib/`，不许在组件里现算。**

---

## 五、几个反复踩到的实现细节

- **`setPointerCapture` 拖过阈值（6px）才调**。在 `pointerdown` 里就调会劫持 click 的 target，
  症状是「能拖能缩但设备永远点不进去」，零报错。拖拽类交互组件各中招过一次。
- **取值一律 `pick(product, path)`（specs-first，`scripts/lib/specs.mjs`）**。
  v2 起品类参数在扁平 specs 容器里（`specs['display.sizeIn']`），v1 嵌套回退。
  只读 specs 会让迁移后第一轮的覆盖率对比跌到 0 触发拒写；只读嵌套则用户修正永远不生效。
  拍平（sync 层 flattenSpecs）后**必须删掉旧嵌套组**——双真源比没有 specs 更危险：
  用户改了 specs、嵌套里还是官网旧值，任何直接读嵌套的下游都拿到旧值且零报错。
- **命令式注入的 DOM 拿不到 Vue scoped 样式** → 必须 `:deep()` 或全局样式。
  真 bug 症状：瓦片竖直堆叠。
- **`vite preview` 只监听 `localhost`**（127.0.0.1 不通），smoke 的 `SMOKE_BASE` 写
  `http://localhost:PORT/`。**preview 会缓存旧产物**：改完要 `build` 再重启 preview。
- **hash 路由下 `location.search` 永远是空串** → 状态写 URL 一律走 hash。
- **hash 路由 + Toy 平台**：`base:'./'` + `createWebHashHistory()` 是平台硬约束，不是风格偏好，
  `conventions:check` 守着这条。
- **`.npmrc` 不要锁官方源**。本机 registry 是 `registry.npmmirror.com`，
  但提交的 lock 必须干净（`resolved` 只允许 `registry.npmjs.org`）。
  用 `npm run lock:fix`，**别用 `--package-lock-only --registry=` 重生成**。
- **`rmSync(dir,{recursive})` 会触发 IDE 批量删除保护**，表现为 build 莫名失败 → 改逐文件对账。
- **同步 runner 收 async 用例 = 用例永远绿**：`check()` 是同步 `try/catch` 结构，
  写 `async` 用例会让断言变成未捕获 rejection，**测试永远显示通过，比没写更糟**。
  修法：顶层 `await import()` 预加载，再传同步回调。

---

## 六、生产构建与部署注意

- **先撤销旧的 GitHub PAT**。它曾明文泄露过，新 PAT 只需 `contents: write`。
- **提交 `package.json` 的 `name` / `version` 必须同步 `package-lock.json`**，
  否则 `npm ci` 报锁不一致。
- **推送 GitHub 直连即可**（2026-10-20 实测直连成功；旧结论「必须走 gh-proxy 前缀」已过时——
  代理改写会导致凭据管理器按代理主机找凭据而匿名失败）。仓库 git 根在子目录。
  另有 atomgit 远端镜像（`git push atomgit main` 直连）。
- **B 站 Toy 需 `secrets.TOY_CLI_SESSION_TOKEN` + `vars.TOY_ID`**，未配则安静跳过。
- **页面挂 `/toy/<slug>/`**：dist 里不能有任何写死的路径前缀。
- **首次发布 Toy 走人工两段式**：`node scripts/publish/toy-create.mjs`（预览，不带 `--yes`）
  → 用户看过预览 → `--commit`。slug 发布后不可改，`scripts/publish/toy-meta.json` 的
  `slugConfirmed` 不为 true 时脚本拒绝执行。元信息与资产（icon/poster）真源都在
  `scripts/publish/` 下，详见 `docs/AUTOMATION-RECIPE.md` §9「B 站 Toy：本项目实作」。

---

## 七、别再重复调研的结论

- **不迁 Next.js / React**。Vite + Vue3 已是当前形态，迁移收益不抵重写成本。
- **不建字段级仲裁层**。手机参数只有官网单源，没有第二票可投，
  照搬参考项目只会造出一个永远只走第一票的空壳。
- **i18n 已建成，不要回滚**。zh/en 双语（`src/i18n/` + `src/locales/`）+ 参数值官方术语表
  （`data/curated/glossary.json`）是既有事实；英文残留用 `npm run i18n:residual` 守，
  SSR 双语冒烟走 `npm run smoke:i18n`。
- **闸门挡不住「少取一个值」**。历史两次刷新率事故都是肉眼发现的。
  解析层改动**没有断言就是没测**。
- 参考项目 `ai-model-world` 的**指纹层比我们弱**（它做数据×模板的组合式指纹，
  我们也是，且额外处理了 CRLF/LF 行尾归一）。不要改回去。