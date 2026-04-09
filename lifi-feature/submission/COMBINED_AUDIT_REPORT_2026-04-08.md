# DeFi Mullet Hackathon 合并项目审计报告

- 审计日期: 2026-04-08
- 审计口径: `lifi-feature + lifiskill` 合并为一个提交
- 审计基线: <https://raw.githubusercontent.com/brucexu-eth/defi-mullet-hackathon/refs/heads/main/guide.md>
- 审计输出: 条款对照 + 整改清单（`符合 / 部分符合 / 不符合 / 证据不足`）

## 1) 总结结论

### 1.1 提交可行性（最低闭环）
- 结论: `部分符合`（当前建议 **No-Go**，先修复 P0）
- 原因:
  - 技术上已具备 Earn + Composer 的可运行闭环，且有运行证据。
  - 但提交材料模板中存在硬性项缺失风险（推文 mandatory tag 不完整），且“真实执行”证据在仓库内不可证。

### 1.2 竞争力成熟度
- 结论: `中高`
- 亮点:
  - `lifi-feature` 覆盖了 Earn 数据面 + Composer 报价面 + CLI 工具面。
  - `lifiskill` 提供 workflow/runtime/风控/灰度/幂等能力，测试覆盖较强（41 passed）。
- 短板:
  - 合并提交叙事未在单一入口文档中明确“主项目 + 附录模块”关系。

## 2) 条款对照审计（Guide 基线）

| 条款 | 判定 | 风险 | 证据 | 说明 |
|---|---|---:|---|---|
| 两层架构: Earn Data API + Composer 分离 | 符合 | P1 | `lifi-feature/src/earn-client.js`, `lifi-feature/src/lifi-client.js`, `lifi-feature/README.md` | 已明确 `earn.li.fi` 与 `li.quest` 区分。 |
| Earn Data API 覆盖（vaults/chains/protocols/portfolio） | 符合 | P1 | `lifi-feature/src/earn-client.js` | 端点均实现。 |
| Composer `GET /v1/quote`（非 POST） | 符合 | P1 | `lifi-feature/src/lifi-client.js:getQuote`, `lifiskill/src/lifi-client.js:getQuote` | 两项目均以 GET 调 quote。 |
| Composer `GET /v1/status` | 符合 | P2 | `lifi-feature/src/lifi-client.js:getStatus`, `lifiskill/src/lifi-client.js:getStatus` | 状态接口覆盖。 |
| `toToken = vault.address` 语义 | 部分符合 | P1 | `lifi-feature/examples/lifi-earn-cli.mjs`（正确），`lifi-feature/examples/preview-route.mjs`（非 vault 演示） | 主 CLI 正确；但旧 demo 路线不是 vault 语义。 |
| 分页 `nextCursor` 处理 | 符合 | P1 | `lifi-feature/src/earn-client.js:getAllPages` | 已做分页循环和游标推进。 |
| APY null / TVL string 容错 | 符合 | P1 | `lifi-feature/examples/lifi-earn-cli.mjs` | 已做 null 与字符串解析回退。 |
| `isTransactional` / `isRedeemable` 处理 | 符合 | P1 | `lifi-feature/examples/lifi-earn-cli.mjs: filterVaults` | 已作为筛选条件。 |
| 最小闭环: 选 vault -> quote -> 预览 -> portfolio | 符合 | P1 | `lifi-feature` CLI 子命令 + 运行证据 | 闭环可运行。 |
| 工作项目（可运行，最好真实执行） | 部分符合 | P0 | 本地命令可跑；仓库无“真实链上执行演示证据” | 代码支持演示，但仓库内无法证明“真实执行”已录制。 |
| X 推文模板包含必须元素 | 部分符合 | P0 | `lifi-feature/submission/tweet-draft.md` | 缺少 guide 要求的 mandatory tag: `@lifiprotocol` + `@kenny_io`/`@brucexu_eth`。 |
| Write-up 模板覆盖 required points | 符合 | P1 | `lifi-feature/submission/writeup-template.md` | 已覆盖项目说明、Earn 双层使用、下一步、反馈。 |
| Google Form 提交 | 证据不足 | P0 | `lifi-feature/submission/checklist.md` | 仅有 checklist，无提交完成证据。 |
| 提交时间窗字段 | 符合 | P0 | `submission/checklist.md`, `submission/tweet-draft.md` | 已写 APAC 窗口 `2026-04-14 09:00-12:00 (UTC+8)`。 |
| 合并叙事完整性（两个项目不割裂） | 部分符合 | P1 | 两项目 README 独立，无统一“合并提交说明” | 评审可能难以理解模块关系与边界。 |

## 3) 运行证据（可复现）

### 3.1 `lifi-feature`
- `npm run lifi:cli -- --help` 通过
- `npm run lifi:cli -- vaults list --chain 1 --top-n 3` 通过（实网）
- `npm run lifi:cli -- quote preview --from-chain 1 --from-token USDC --from-amount 1000000` 通过（实网）
- `npm run lifi:cli -- portfolio summary --address 0x111...111 --json --quiet` 通过（空仓位场景）
- `npm run lifi:cli -- portfolio to-quote --address 0x111...111 --json --quiet` 通过（返回 `status: no_source_position`）
- `npm run preview:status` 在未设置 `LI_FI_TX_HASH` 时按预期失败（参数守卫生效）

### 3.2 `lifiskill`
- `npm run test` 通过（`41 passed, 0 failed`）
- `npm run demo:workflow-runtime` 通过
- `npm run demo:quote` 通过（实网）

## 4) 整改清单（按优先级）

### P0（阻断提交，必须先改）

1. 推文模板缺 mandatory tag
- 问题: 当前草稿使用 `@lifi`，未覆盖 guide 强制项。
- 影响: 可能被判无效提交或扣分。
- 改法:
  - 强制包含 `@lifiprotocol`
  - 英文内容加 `@kenny_io`；中文内容加 `@brucexu_eth`
- 修改位置建议: `lifi-feature/submission/tweet-draft.md`
- 验收:
  - 手动审阅草稿含上述 tag
  - 发布前 checklist 勾选 `tweet required tags verified`

2. “真实执行”证据未在仓库内固化
- 问题: guide 要求 working project 且强调真实执行，仓库仅有运行脚本与示例。
- 影响: 评审可能认为 demo 仅停留在 quote/preview。
- 改法:
  - 在提交材料中补“真实执行”视频证据（含钱包签名与结果）
  - 在 write-up 显式写出执行路径与链上结果引用
- 修改位置建议: `submission/writeup-template.md` 的实例化版本 + demo 链接
- 验收:
  - 有公开视频或可访问录像
  - 视频中出现真实交易执行步骤/结果

3. Google Form 完成状态不可证
- 问题: 仓库仅有待办项，无“已提交”记录。
- 影响: 形式要件不全会导致无效参赛。
- 改法: 提交后在本地 checklist 标记并保留提交确认截图。
- 修改位置建议: `submission/checklist.md`（提交当日更新）
- 验收: `Google Form submitted` 勾选且有外部确认记录

### P1（高风险，建议提交前完成）

1. 合并提交叙事不够集中
- 问题: `lifi-feature` 与 `lifiskill` 分别成文，缺统一入口说明。
- 影响: 评审难理解“主产品 + 工程补强”关系，影响完整度评分。
- 改法:
  - 新增一页 `COMBINED_SUBMISSION.md`：
    - 主演示: `lifi-feature`
    - 附录能力: `lifiskill`（风控、灰度、幂等、runtime）
    - 一张流程图串联
- 验收: 单页可在 2 分钟内讲清双项目关系

2. 主演示路径与“vault 语义”存在旧示例混淆
- 问题: `preview-route.mjs` 是通用 route demo，非 vault deposit 语义。
- 影响: 演示时可能偏离 Earn 主题。
- 改法: 提交演示只走 `lifi:cli quote preview`（vault 选择路径）或标注旧脚本仅调试用途。
- 验收: demo 脚本命令明确使用 vault 选取链路

3. API key 依赖未显式“失败即中断”
- 问题: 客户端允许未传 key 发请求。
- 影响: 现场网络或策略变化时可能临场失败。
- 改法: 在 demo 命令入口增加 “缺 key 警告/强校验”。
- 验收: 未设置 key 时输出明确错误提示

### P2（优化项）

1. `lifi-feature` 自动化测试不足（当前以命令演示为主）
- 改法: 增加最小 smoke test（参数验证、no_source_position 分支、输出 schema）。
- 验收: `npm test` 至少覆盖 CLI 关键路径。

2. `lifiskill` README 测试计数与实际不一致（文档写 40，实测 41）
- 改法: 更新 README。
- 验收: 文档与实际一致。

## 5) 推荐提交策略（合并口径）

### 主副赛道建议
- 主赛道: `Developer Tooling`
- 副叙事: `AI × Earn`（以 runtime/策略自动化潜力作为延展）

### 3-5 分钟 Demo 路线
1. 用 `vaults list` 展示 Earn 发现能力（含分页与筛选）
2. 用 `quote preview` 展示 vault -> Composer 报价（强调 `toToken=vault.address`）
3. 用 `portfolio summary` 展示投后查询
4. 用 `lifiskill` runtime 演示工程化保障（灰度、幂等、风控）

### 失败兜底话术
- 若钱包侧执行临时不可用:
  - 展示已录制真实执行视频片段
  - 现场演示 quote + portfolio 查询 + runtime 审计链路

## 6) 提交前 Gate（Go / No-Go）

仅当以下全部满足才建议 Go:

- [ ] P0 全部关闭
- [ ] 推文草稿含 mandatory tags（`@lifiprotocol` + `@kenny_io`/`@brucexu_eth`）
- [ ] 演示视频包含真实执行证据
- [ ] Google Form 已提交
- [ ] APAC 时间窗确认：`2026-04-14 09:00-12:00 (UTC+8)`

当前判定: **No-Go（待 P0 修复）**
