# 自动化发布配方（可迁移到其他项目）

这份文档记录的是 `specworld` 真实跑通的一套「提交即自动同步、变化才发布」的流水线：
GitHub Actions 定时抓取 → 合理性闸门 → 内容指纹去重 → 提交回仓库 → 内容变了才发 GitHub Pages。

**所有内容都是可迁移的**：不依赖本仓的机型数据、不依赖任何密钥、不依赖任何外部服务。
换到别的项目时，按 [§8 迁移检查单](#8-迁移到新项目的检查单) 走一遍即可。

> 配套真实文件（想看完整版直接读）：
> `.github/workflows/sync.yml`、`scripts/publish/fingerprint.mjs`、
> `scripts/publish/should-publish.mjs`、`scripts/pipeline.mjs`、`docs/DATA-CONTRACT.md`

---

## 1. 架构：两台发动机 + 一份判据

```
                    ┌──────────── 定时（每 12h）/ 手动 / push 改代码 ─────────┐
                    ↓                                                        │
            ┌───────────────────────┐                                       │
            │  job: sync            │  1. 抓上游（境外 runner 直连得通）    │
            │  （唯一副作用 = 提交） │  2. 归一化 + 合理性闸门（不过就停）    │
            │                       │  3. 算内容指纹 → 判断变没变            │
            └───────────┬───────────┘                                       │
                        │ dist/ 作为 artifact 同 run 内传递（不重复抓取）    │
                        ↓                                                   │
            ┌───────────────────────┐                                       │
            │  job: deploy          │  if: 站点指纹变了 or 手动强制         │
            │  （零凭据发 Pages）    │  upload-pages-artifact → deploy-pages│
            └───────────────────────┘                                       │
                        ↑                                                   │
              data/.fingerprint ────────────────────────────────────────────┘
                    （上次状态的指针，唯一的真相来源）
```

设计上的三条硬规矩，后面所有细节都是它们的推论：

1. **数据在 `data/`，产物在 `dist/`，中间物在 `_work/`。** 只有 `data/` 入库。
   产物任何人本地跑一条命令就能重建，不进 git 历史。
2. **判据是内容指纹，不是 `git diff`。** 见 [§4](#4-内容指纹为什么不许用-git-diff)。
3. **发不发版看「用户看得见的东西变了没有」。** 数据变或模板变才发；
   两者都没变，哪怕时间戳刷新过，也不发。

---

## 2. GitHub 网页侧的一次性配置

| # | 位置 | 设置成 | 不这么做会怎样 |
|---|---|---|---|
| 1 | 仓库 **Settings → Pages → Build and deployment → Source** | **GitHub Actions** | `cyxue.github.io/xxx/` 直接 404 |
| 2 | 同页 **Custom domain** | **留空** | 填 `用户名.github.io` 必报 `Domain is not a valid public domain` |
| 3 | 同页 **Enforce HTTPS** | 勾选（默认） | — |
| 4 | **Settings → Actions → General → Workflow permissions** | **Read and write** | bot 没权限 `git push`，同步静默失败 |
| 5 | **Settings → Actions → General** | 保持允许 Actions 创建 issue | 同步失败没有留痕痕迹 |
| 6 | 仓库可见性 | **Public** | 免费账号的私有仓库**不支持** Pages，Source 下拉里根本没有 GitHub Actions 这一项 |

### 三个最容易走错的地方

**① Pages 有两套入口，只有一套有用。**
`https://github.com/settings/pages` 是**账号级**的，管 `用户名.github.io` 个人主页站；
`https://github.com/仓库/设置/pages` 才是**仓库级**的，管 `用户名.github.io/仓库名/`。
两者完全独立。在账号级页面里翻遍都找不到 Build and deployment。

**② 别点页面上的两张 Configure 卡片。**
Source 选成 GitHub Actions 后，页面会显示「GitHub Pages Jekyll」和「Static HTML」两个建议模板。
点它们会生成官方的 `.github/workflows/static.yml`，后果有两个：

- 它和你的发布 job 抢同一个 `github-pages` environment，谁后跑谁覆盖，行为取决于时序；
- 官方 Static HTML 工作流**从仓库根目录**发布。如果你的产物在 `dist/` 且被 gitignore，
  它会发布一个空站，**把你的正常站盖掉**。

自己是 `upload-pages-artifact` + `deploy-pages` 发版的话，这两张卡片一律不碰。

**③ 首次发版必须手动强制一次。**
配好 Source 之后站点不会自己出现 —— 因为指纹去重判定「和上次一样，不发」。
去 Actions 页 → 选中工作流 → **Run workflow** → 勾上强制发布的那个输入项。

---

## 3. 仓库布局：什么必须入库，什么必须忽略

```
data/                 ← 唯一入库的数据源
  products.json         归一化后的快照（含运行时刻字段，无妨，指纹会剥）
  release-dates.json    ★ 人工取证的 curated 数据，必须入库
  .fingerprint          ★ 上次同步/发布的状态指针
dist/                 ← 站点产物，gitignore
_work/                ← 中间物 + HTTP 缓存，gitignore
.github/workflows/    ← sync.yml / toy.yml，入库
scripts/              ← 全部代码，入库
```

### 这一条坑值一整天的排查时间

`release-dates.json` 是人工核对官网整理出来的上市日期，**curated 数据**。它最初被放在 `_work/` 下，
而 `_work/` 是 gitignore 的。于是：

> CI 全新 checkout 拿不到这张表 → 60 台机型全部因「无发布日期」被窗口过滤丢掉 →
> 闸门判定「机型总数骤降」拒绝写盘 → **每 12 小时的自动同步必然失败**。

而日志里只有一行「注意：未找到发布日期表」，看起来像无害提示。

**规律：凡是人产出的、机器补不回来的数据，必须放进入库目录。**
机器能重新抓的东西放 `_work/`，人抓不到的东西放 `data/`。

再加一道保险：提交时用显式 pathspec 拦一道，别让中间物混进历史。

```bash
git add -A -- data/
if git diff --cached --name-only | grep -Ev '^data/'; then
  echo "::error::暂存区出现了 data/ 以外的文件，拒绝提交"
  exit 1
fi
```

---

## 4. 内容指纹：为什么不许用 `git diff`

### 问题

`data/products.json` 里带着一串运行时刻字段：

```json
{ "generatedAt": "...", "firstSeenAt": "...", "lastSeenAt": "...",
  "listedAt": "...", "fetchedAt": "..." }
```

这些字段每跑一次就变一次。于是：

- `git diff --quiet -- data/` 永远判定「有变化」→ **每 12 小时一次空提交**；
- 下游「内容没变就不发版」跟着失效 → 每 12 小时重复发布同一个站点；
- 而且 `generatedAt` 会渗进 HTML 页面，站点指纹也跟着每轮变。

实测过：连跑两次、一台机器的数据都没动，哈希从 `3c0a68e2` 变成 `e637e240`。

### 解法

写一个指纹脚本（`scripts/publish/fingerprint.mjs`），三步：

```js
// 1. 剥掉所有"这次跑的时刻"字段（键名白名单，递归）
const VOLATILE = new Set(['generatedAt','lastSeenAt','firstSeenAt',
                         'listedAt','fetchedAt','fetchedDate','crawledAt']);

// 2. 稳定序列化：键名排序 → 算数据指纹
const dataFingerprint = hash(stripVolatile(data));

// 3. 站点指纹 = 数据指纹 × 模板代码哈希
const siteFingerprint = hash(dataFingerprint + templateHash);
```

### 三个必须注意的实现细节

**① 模板哈希前先归一化行尾。** 模板代码哈希按文件字节算的话，
Windows 的 CRLF 和 Linux runner 的 LF 会算出两个值 → 本地推一次、CI 判一次变、
CI 提交后本地又判一次变，**来回空转**。第一次真实 CI 跑完就暴露了：
bot 提交的站点指纹 `f1d13bb3`，本地算出来 `2635c3d0`，而数据指纹两边完全一致。

```js
const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
```

**② 站点指纹用「数据指纹 × 模板哈希」，不要在 HTML 里剥时间文本。**
在产物里用正则去匹配时间戳会误伤业务日期（比如「2026 年 3 月上市」也是时间）。
乘起来算既准确又零维护。

**③ 只改模板时，指纹指针也必须推进。**
这是最容易漏的一条。触发提交/发布的判据里包含了「站点指纹变了」，
所以只改模板时数据没变、快照也不该动（它的唯一变化就是那串时间戳）——
但**指针必须推进**，否则之后每一轮都会被判成「站点有变化」，每 12 小时重复发布一次。

```bash
if [ "${{ steps.fp.outputs.data_changed }}" = "true" ]; then
  git add -A -- data/
else
  git add -- data/.fingerprint     # 只推进指针，不动快照
fi
```

### 判据怎么写

```yaml
- name: 判断内容是否变化
  id: fp
  run: |
    node -e "
      const fs = require('fs');
      const out = process.env.GITHUB_OUTPUT;
      const fp = JSON.parse(fs.readFileSync('_work/fingerprint.json', 'utf8'));
      fs.appendFileSync(out, [
        'data_changed=' + fp.changed.data,
        'site_changed=' + fp.changed.site,
        'summary=' + (fp.stats?.products ?? 0),
      ].join('\n') + '\n');
    "
```

`_work/fingerprint.json` 里有详细数据（分品牌台数、覆盖率等），可以直接当 run summary 用。

---

## 5. sync.yml 骨架

完整版见 `.github/workflows/sync.yml`，这里是可迁移的骨架：

```yaml
name: 数据自动同步

on:
  schedule:
    # GitHub 的 cron 走 UTC。40 1,13 * * * = 北京 09:40 与 21:40。
    # 刻意错开整点：整点是全网提交高峰，排队能等到几小时。
    - cron: '40 1,13 * * *'
  workflow_dispatch:
    inputs:
      offline:            # 上游抓取失败时的重跑方式
        type: boolean
        default: false
      force_publish:      # 内容没变也重新发布
        type: boolean
        default: false
  # 改代码时立即验证，不等 12 小时。
  # bot 自己提交的是 data/，不匹配这里，因此不会自己触发自己。
  push:
    paths: ['scripts/**', 'src/**', 'data/release-dates.json',
            '.github/workflows/sync.yml']

permissions:
  contents: write     # 提交快照
  issues: write       # 失败时开 issue 留痕

concurrency:
  group: my-pipeline
  cancel-in-progress: false    # 定时任务不要互相取消，宁可排队

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    outputs:
      data_changed: ${{ steps.fp.outputs.data_changed }}
      site_changed: ${{ steps.fp.outputs.site_changed }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }

      # 不装依赖：全链路只用 Node 内置模块。
      # 少一个装包失败点，「无人值守」就少一件能坏的东西。

      # 条件请求缓存。中间目录不入库，CI 每次 checkout 都是空的，全靠这里恢复。
      - uses: actions/cache@v4
        with:
          path: _work/x.cache
          key: sync-http-cache-${{ github.run_id }}   # 每次新写
          restore-keys: sync-http-cache-                # 但优先复用旧的

      - name: 跑全链路
        run: |
          if [ "${{ inputs.offline }}" = "true" ]; then
            node scripts/pipeline.mjs --offline
          else
            node scripts/pipeline.mjs
          fi

      - name: 判断内容是否变化
        id: fp
        run: node -e "..."        # 见 §4

      - name: 提交变化
        if: steps.fp.outputs.data_changed == 'true' || steps.fp.outputs.site_changed == 'true'
        run: |
          git config user.name  'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          node scripts/publish/fingerprint.mjs --write-pointer
          # ... 提交（见 §4③）
          git push

      # 产物交给下一个 job，同一次运行内传递，不重复抓上游
      - uses: actions/upload-artifact@v4
        with: { name: site, path: dist, retention-days: 7 }

      # 闸门拦截时留下证据
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: sync-report, path: _work/sync-report.json,
                retention-days: 30, if-no-files-found: ignore }

      - name: 同步失败时开 issue
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            // 找标题相同且仍 open 的 issue：有就追加评论，没有就新建。
            // 连续失败不会刷出一堆 issue，修好后手动关掉那一条即可。

  deploy:
    needs: sync
    # 定时任务没有 inputs，github.event.inputs 为空串，整体等价于只看 site_changed
    if: ${{ needs.sync.outputs.site_changed == 'true' || github.event.inputs.force_publish == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/download-artifact@v4
        with: { name: site, path: dist }
      - run: touch dist/.nojekyll      # 保险：Pages 默认走 Jekyll，会吃掉下划线开头的文件
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 关键点逐条说明

| 写法 | 为什么 |
|---|---|
| cron 写 `40 1,13 * * *` | UTC 时区 + 错开整点。GitHub 的定时任务在高峰期能排队 2 小时以上 |
| `permissions` 只给需要的 | `contents: write` + `issues: write`，不要图省事写 `write-all` |
| `cancel-in-progress: false` | 定时任务之间宁可排队也不要互相取消 —— 取消会让「数据已提交但版没发」 |
| `cache` key 用 `run_id` + restore-keys | 每次写新 key（保证真的写回），但优先恢复旧 key（命中 ETag 零流量） |
| 不装 npm 依赖 | 少一个装包失败点。`setup-node` 只用来选 Node 版本 |
| 产物用 artifact 跨 job 传 | 两个 job 独立 runner，同 run 内传 artifact 比重跑一遍便宜且确定 |
| `if: always()` 上传报告 | 闸门拦截时旧快照原封不动，但也得有东西留下来查 |
| `upload-pages-artifact` 用 v3 | v2 已弃用；`deploy-pages` 配 `pages: write` + `id-token: write` |
| `.nojekyll` | 零成本保险 |

---

## 6. 合理性闸门：宁可不动，别写坏数据

抓回来的数据必须先过闸门，不合理就**以非零退出码结束**，旧快照原封不动。
没有闸门的定时任务 = 半夜把好数据换成空数据。

至少这几条（阈值按项目定）：

| 闸门 | 示例阈值 | 挡的是什么 |
|---|---|---|
| 总量骤降 | 少于上次的 85% | 上游改版、解析规则失效 |
| 必填字段覆盖率下滑 | 低于上次的 90% | 部分页面结构变了 |
| 数值超出物理区间 | `refreshHz ∈ [48, 240]` | 解析串到了别的数字 |
| 关键表非空 | 取证表必须有记录 | curated 数据丢失（见 §3） |

闸门触发时把「为什么」写进报告文件，再由 workflow 开一条 issue 留痕。
**报告要能回答「是哪一次上游出了问题」**，只写「校验失败」等于没写。

---

## 6.5 自测层：闸门挡不住的那一类错误

**这一节是本配方与参考项目最大的差异，也是最值得抄的一条。**

闸门拦的是**数值越界**。但取数解析器的错误绝大多数**落在合理区间内**：

| 官网原文 | 取错的结果 | 闸门拦得住吗 |
|---|---|---|
| `2160 Hz 高频 PWM 调光` | 刷新率 2160 | 拦得住（`refreshHz ∈ [48,240]`） |
| `2622 x 1206 像素分辨率` | 刷新率 2622 | 拦得住 |
| `60 Hz / 90 Hz 屏幕` | 只取到 60（漏 90） | ❌ **拦不住** |
| `7.44 盎司` | 重量 7.44 g | 拦得住 |
| `12 GB RAM`混在 ROM 字段 | 存储档位多出 12 | ❌ **拦不住** |

**凡是「少取了一个值」「取到了相邻字段的值」，闸门一律放行。**
因为这些结果都在物理上说得通，闸门没有理由拦。

本项目真实踩过的两次（都已修、已固化成断言）：

1. 旧 `parseRefresh` 取「整段文本里第一个 Hz 之前的全部数字的最大值」，
   于是 iPhone 17 的分辨率 2622、Mate XTS 的 PWM 频率 1440 全成了刷新率。
   **当时是靠肉眼发现、再补一条闸门兜住的。**
2. 补了自测之后第一次跑就抓到第三个：`60 Hz / 90 Hz 屏幕` 里 `/` 被当子句分隔符，
   90Hz 整段被丢掉，刷新率上限从 90 掉到 60。

**共同点：两次都是靠肉眼发现的，而肉眼只会发现最明显的那一个。**

### 怎么补

新建 `scripts/selftest.mjs`，用 `node:assert`，不联网、不引测试框架。清单：

- [ ] **每个历史事故一条断言**，注释写明「防的是哪种真实故障」
- [ ] **解析器的每条纪律一条断言**（本项目：解析不出就null、口径必须一起出来、只取第一个合理数字）
- [ ] **闸门自己也要被测**：健康数据必须通过、每条闸门的触发条件必须被拦下
- [ ] **边界样本**：`null` / 空串 / 全符号 / 千位分隔 / 中英单位混排
- [ ] **不变量检查**：解析结果永远落在闸门区间内（否则闸门会白跑一趟，数据白抓）

### 接进 workflow

放在**第一个 job**，不联网、1 秒跑完，失败则整条管线不启动：

```yaml
jobs:
  selftest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: node scripts/selftest.mjs
  sync:
    needs: selftest     # ← 护栏在最前面
```

### 写自测时踩到的三个坑

1. **测试样本必须覆盖全部必填字段**。漏一个 `resolutionPx`，闸门就永远报「必填缺失」，
   真正想测的那条闸门根本跑不到。
2. **样本要能整段替换**。测「有值但缺口径」这类闸门，必须能把`battery` 整段清空；
   只做字段级深合并反而护住了本该缺的字段。
3. **样本的唯一 id 必须最后覆盖**。`{...apply(base), id}` 而非 `{id, ...apply(base)}`，
   否则 base 自带的 id 会把每台机器盖成同一个值，闸门报 24 条「id 重复」，
   失败原因完全指不到真正想测的地方。

> 这三条不是理论，是本项目写第一版自测时真踩的——
> 66 项里前四版跑不过，全是测试自己的问题，不是代码的问题。

---

## 7. 故障速查表

| 现象 | 根因 | 处置 |
|---|---|---|
| CI 每次都失败，机型数量掉到 0 | curated 数据放在 gitignore 的目录里 | 移进 `data/` 入库（见 §3） |
| 每 12h 一次空提交 | 指纹含运行时刻字段 | 剥字段后再算（见 §4） |
| 本地推一次 CI 发一次，来回空转 | CRLF vs LF 算出两个模板哈希 | 读文件后归一化行尾 |
| 只改模板时每 12h 重复发布 | 指针没推进 | 只改模板也提交 `data/.fingerprint` |
| `cyxue.github.io/xxx/` 404 | Pages 没启用 | Source 选 GitHub Actions |
| Source 下拉里没有 GitHub Actions | 仓库是 Private | 改成 Public |
| `Domain is not a valid public domain` | 往自定义域名框里填了 `用户名.github.io` | 清空，那框是给自有域名用的 |
| Pages 设置页里找不到 Build and deployment | 进的是**账号级** Pages | 用 `github.com/仓库/设置/pages` |
| `Failed to queue workflow run. Please try again.` | GitHub 瞬时故障 | 硬刷新重试；API 查了没有排队中的 run 就是它；仍不行用 REST API 触发 |
| 站点 404 / 空白，但 Actions 全绿 | 官方 `static.yml` 在抢发 | 删掉它，Source 改回 GitHub Actions |
| bot 提交成功但站点没更新 | 指纹判定「没变」 | 正常行为；想强发就手动勾 force |
| 定时任务排队 2 小时才跑 | 整点高峰 | cron 错开整点 |

排查小技巧：不确定是「真没变」还是「没发」时，直接读 API，不要靠 UI 猜。

```bash
curl -s "https://api.github.com/repos/OWNER/REPO/actions/runs?per_page=5" \
  | python -c "import json,sys;[print(r['run_number'],r['event'],r['status'],r['conclusion']) for r in json.load(sys.stdin)['workflow_runs']]"
```

---

## 8. 迁移到新项目的检查单

把这套搬到别的项目，逐条打勾。

### 第一天就该有的（顺序很重要）

**第0 天就位，不要裸奔三轮再补**——本项目就是先跑通自动化、出了两次静默数据事故才回头补的，
而事故只有最明显的那一个被肉眼抓到。

- [ ] **`scripts/selftest.mjs` 就位**，且接进 workflow 的第一个 job（见 §6.5）
- [ ] 每个已知事故一条断言，注释写明「防的是哪种真实故障」
- [ ] 闸门自己也被测：健康数据通过 + 每条闸门的触发条件被拦下
- [ ] 解析器的每条纪律一条断言

### 配置类

- [ ] 仓库是 **Public**（否则 Pages 下拉里没有 GitHub Actions）
- [ ] `Settings → Pages → Source` = **GitHub Actions**，Custom domain **留空**
- [ ] `Settings → Actions → Workflow permissions` = **Read and write**
- [ ] `.gitignore` 忽略产物目录和中间目录，但**人产出的数据在入库目录里**
- [ ] 指纹脚本就位：剥运行时刻字段 → 数据指纹；模板哈希**归一化行尾**
- [ ] 状态指针文件入库（`data/.fingerprint`）
- [ ] 提交时有显式 pathspec 白名单
- [ ] 合理性闸门就位，失败以非零退出码结束
- [ ] deploy job 的 `if` 用「站点指纹变了 or 手动强制」
- [ ] 只改模板时也会推进指针

### 首发与验证

- [ ] **手动 force 跑一次**完成首发
- [ ] cron 避开整点，注意 UTC 换算
- [ ] 验证失败路径：临时把闸门阈值改到必过不了，确认会开 issue、且旧数据没被写坏
- [ ] 跑完后核对线上：不止首页，深层页和页面内相对链接都要能打开

### 值得从参考项目再抄的（本地欠缺的）

- [ ] **只读体检脚本**（参考项目 17 个，0.2 s/个）。回答「为什么页面是这个结果」，
      替代手翻HTML。至少先做 3 个：`why-<冠军>.mjs`、`coverage.mjs`、`stale-<阵容>.mjs`
- [ ] **字段级 `provenance`**：每个字段记住自己来自哪个上游。补第三个数据源时立刻需要
- [ ] **i18n 架子**：字典 + `lang` 参数贯穿生成函数。第二期只要加路由层，
      晚了就得回头改每一个生成函数
- [ ] `docs/PITFALLS.md`：踩过的坑带原因。**这类文档不能自动生成，必须人写**，
      所以要随开发增量补，而不是等踩完再回头补

### 最后一条别省

站点根路径能打开 ≠ 站点是对的。至少抽查：深层页状态码、页面内相对引用
（子路径部署时 `../` 前缀漏了会导致大面积 404）、关键数据页非空。

**再补一条：自测全绿 ≠ 数据是对的。** 自测只锁住纯函数的行为，
解析器对页面结构的假设是否仍成立，只有真跑一次取数才知道。
所以 `PROBE-FINDINGS.md` 那种「页面结构假设清单」要随解析器一起更新，
并在取数失败时按它的顺序排查。

---

## 9. 可选扩展

### 送审类流水线（参考项目的第二台发动机）

如果有「内容变了要提交到某个平台审核」的需求，照抄这个结构：

- 独立工作流 + 独立 cron（每天一次足够）
- **缺凭据时安静跳过**（`exit 0` + 一行 warning），不要天天报红让人麻木
- 同样用内容指纹去重，另存一份 `data/.release-state.json`
- **只有平台真的收下了才推进「已发布」记录** —— 否则一次失败会让后续正确的版本
  永远被判成「没变化」，再也送不出去
- 不要写死外部 CLI 的命令矩阵：那种 CLI 是自描述的，字段名会漂移。
  没有真实输出样本时硬写解析 = 看起来聪明，实际对不上。
  把这一层明确标为「未实现」，好过假装实现了

### 抓取节点的选择

把抓取放在 GitHub 的境外 runner 上，很多原本连不上的上游就通了
（本次华为 / 苹果官网直连没问题，但换个上游就不一定）。
反过来，**从中国大陆跑 GitHub Actions 是反方向，别搞混**。
