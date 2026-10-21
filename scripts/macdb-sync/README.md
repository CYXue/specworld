# macDB 同步通道（scripts/macdb-sync/）

macDB（https://macdb.cn，Apple 设备编年史社区站）是本项目的**第二票数据源**：
官网（support.apple.com.cn）是唯一真源，macDB 用于补官网早已下架的历史机型、
以及给已有条目填空缺字段（仅填空、绝不覆盖）。

## 组成

| 文件 | 职责 |
|---|---|
| `match-table.json` | macDB slug ↔ 本站产品 id 的映射表（**入库**，871 台，含人工研判与纠错标记） |
| `reconcile.mjs` | 对账：拉 macDB sitemap/详情页 → 与本站目录 diff → 产出缺失/未匹配报告 |
| `fill.mjs` | 折叠：按 match-table 把 macDB 结构化参数折进 `data/overrides.json`（只填空缺字段） |

## 映射表字段

- `slug` / `name`：macDB 设备页 slug 与名称
- `productId` / `ourName` / `cat`：本站目标（cat 必须与目标品类一致）
- `j`：名称 token 相似度；`manual: true` 人工研判；`fixed: true` 纠错后重定向
- 修正历史见 git log 与 `_work/fix-match.mjs`（2026-10-20 批次）

## 纠错规则（三轮沉淀，勿删）

1. **高置信匹配**：名称 token（Jaccard ≥0.8）直接采信。
2. **基底唯一匹配**：去括号限定词后 token 完全相等且本站唯一候选才收；
   多候选（如 iBook G4 2004 初/末）宁缺毋滥。
3. **人工研判**：年份+发布日期就近、限定词（主动降噪→anc、铝合金→alu）、
   iMac 24 年份→芯片型号、裸名=初代。
4. **跨品类检测**：slug 机型类别必须与目标品类一致
   （电脑类→desktop/laptop、ipad→tablet、airpods→audio、键鼠→input……）。
5. **日期就近重配**：同 token 集合的平级候选（early/late 盲配）按
   macDB 页面发布时间与本站 releaseDate 的距离（>200 天且第二名差距 >200 天）重定。
6. **串号防线**：同 brand+line 内 `device.identifier` 必须唯一，
   presumptive true owner = 最早发布那台（沿用 2026-10-16 清洗口径）。

## 数据诚信红线

- macDB 是第二票，provenance 一律 `user-manual`、source `macdb-cn`，reason 带 slug 可回溯；
- 只填空缺字段，绝不覆盖官网/用户已有值；
- 页面没有的值留空显示「—」，不估算、不外推；
- 单位自愈（cm 误标 mm ×10）仅当 ×10 落入 schema range 才接受，且逐条记录。

## 用法

```bash
node scripts/macdb-sync/reconcile.mjs            # 对账报告（默认读缓存 _work/macdb-*）
node scripts/macdb-sync/reconcile.mjs --fetch    # 重新抓取 sitemap + 882 页详情页
node scripts/macdb-sync/fill.mjs                 # 折叠预演（只打印将要写入的内容）
node scripts/macdb-sync/fill.mjs --apply         # 实际写入 data/overrides.json
```

折叠后必须跑：`npm run selftest` → `node scripts/pipeline.mjs --data-only`。
