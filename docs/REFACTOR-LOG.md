# 重构落地记录（2026-10-03）

> 依据 `docs/ENGINEERING-REVIEW.md` 第 3 节优先级总览的 **11 项建议**，对 `phone-spec-world`
> 执行全量重构（demo 性质，无兼容性 / 迁移成本约束，大刀阔斧改）。
> 本文件是可版本化的落地记录；逐条明细见 `ENGINEERING-REVIEW.md` §6。

## 落地清单

| 优先级 | 建议 | 落地方式 |
|---|---|---|
| 高 | `.ts` 文档文件误纳入构建指纹 | `fingerprint.mjs` 模板哈希改为只扫 `scripts/**/*.mjs` |
| 中 | 品牌注册表硬编码 ~10 处 | 新 `scripts/brands.mjs`（单一真源），替换 validate / sync / ui / derive / qa / sprite / verify 共 7 处 |
| 中 | `normalize/index.mjs` 1804 行单体 | 拆出 `brands/{huawei,apple}.mjs` + `shared.mjs`，主文件降到 407 行 |
| 中 | `normalize` 重复 `firstNum`/`nums` | 改 `import { firstNumber as firstNum, allNumbers as nums } from './parse.mjs'`（经 `shared.mjs` 再导出） |
| 中–高 | 品牌映射层零单测 | 新增 golden-file 测试（华为规格页 / 苹果规格页 / 苹果对比页），接进 `selftest.mjs` 与 CI |
| 低 | 精灵图入库 | `pipeline.mjs` 接入 `scripts/sprite/generate.mjs`；`data/sprites/` 进 `.gitignore` 并 `git rm --cached` |
| 低 | `verify.mjs` 三遍读 HTML | 合并为单次遍历（外链 / 死链 / 内容纪律同轮完成），I/O 减 2/3 |
| 低 | `src/` 与 `scripts/` 割裂 | `compare-spec.mjs` 迁入 `scripts/site/lib/` 并修正两处动态 import |
| 低 | `parse.mjs` 内联 selftest | 删除，覆盖由 `selftest.mjs` 承担（已含全部解析函数 + PWM / 刷新率历史事故用例） |
| 低 | toy CLI 下载缺 checksum | `toy.yml` 加 sha256 校验，由 `TOY_CLI_SHA256` 变量门控（配则强制、不配仅告警） |
| 低 | 文档过期 / 缺原则总纲 | 更新 `BENCHMARK-VS-AMW.md`；新增 `PRINCIPLES.md`（8 条不可违背原则） |

## 提交

| SHA | 说明 | 规模 |
|---|---|---|
| `6f13c87` | `refactor: 品牌注册表单一真源 + 规范化拆分 + 闸门/指纹/校验修复` | 95 文件（含 60 个精灵图删除 + `compare-spec.mjs` 重命名 `src → scripts/site`） |
| `6b6d353` | `docs: 工程评审落地表 + 原则总纲 + 规范文档体系` | 9 文件（`docs/*` × 8 + `README.md`） |

## 验证证据

- **自测**：`node scripts/selftest.mjs` → **79 项全过**（含品牌映射层 golden 测试）。
- **数据零回退**：`data/products.json` 经语义级比对——剥除
  `generatedAt` / `fetchedAt` / `firstSeenAt` / `lastSeenAt` / `skus.listedAt` / `provenance`
  后两份 JSON **逐字段全等**；324 行 diff 仅易变时间戳 + 本次 `display.resolutionPx` provenance 修复
  （补登记父路径与 `.h` 子路径，修掉了 60 台全报"缺 provenance"的漏报）。价格 / 规格 / 尺寸全部未变。
- **全链路**：`node scripts/pipeline.mjs --offline` 跑通，60 台、闸门放行、76 页自包含零外链；
  线上重抓同样通过发布校验（0 外链 / 0 死链 / 0 内容问题）。

## 遗留

- **未推送**：旧 PAT 已明文泄露，推送前必须先撤销；新 PAT 只需 `contents: write`。
- i18n 英文内容仍刻意留空（无真实英文页之前不硬填，避免造无人校对的翻译）。
