# LI.FI Cross-chain Workflow Skills 执行方案（当前实现版）

## 1. 目标与原则

目标：构建一个可灰度、可门禁、可审计的 LI.FI 工作流技能运行时，让系统从“交易路由能力”升级为“意图执行能力”。

原则：

- 借鉴成熟架构思路，但保持独立实现
- 先打通闭环，再做能力扩展
- 每个 skill 都必须可解释、可控制、可追踪、可审计

首期核心 skill：

- `bridge-assets`
- `swap-then-bridge`
- `safe-large-transfer-review`

## 2. 当前已实现（代码状态）

### 2.1 Skill / Tool / Workflow 主链路

- Skill 定义校验（`skills/*.json`）
- LI.FI 客户端与工具封装：
  - `LiFiQuoteTool`
  - `LiFiExecuteTool`
  - `LiFiStatusTool`
- 工作流状态机：
  - `planned -> awaiting_confirm -> executing -> polling -> completed/failed`

### 2.2 风控、授权、审计

- 策略引擎 `allow / require_confirm / deny`
- 约束配置支持 `snake_case` 与 `camelCase` 双格式映射
- 价格缺失时强制人工确认（避免金额风控绕过）
- 授权前置（`allowance -> permit/approve`）
- 统一审计日志（`traceId / operationId / decision / transitions / errorCode`）

### 2.3 可靠性增强

- quote 重报价保护（requote）：
  - TTL 校验
  - gas 漂移阈值
  - 最小到帐量漂移阈值
  - 超过重报价预算后自动降级 `plan-only`
- 输入参数校验（地址/金额/token 必填等）并统一 `INVALID_INPUT`
- 状态轮询支持瞬时网络抖动容错（`maxFetchErrors`）
- 幂等防重（`operation_id + wallet + skill + route_fingerprint`）

### 2.4 发布控制与灰度

- `release-gate`：发布门禁评估与断言
- `gray-release`：按比例分流与阶段晋级
- `rollout-manager`：读取指标 -> gate -> 晋级 -> 产出 actor flags
- 支持内存与 JSON 文件状态存储

## 3. 当前测试状态

最近回归结果：

- `37 passed, 0 failed`

覆盖包括：

- 三个 skill 的主流程与回放
- 风控决策与约束映射
- 授权与执行
- 轮询超时与网络抖动容错
- requote 降级
- 灰度分桶、门禁阻断、rollout-manager 严格/非严格模式

## 4. 生产接入建议（下一阶段）

以下属于“可进一步加强”，不是当前阻塞项：

- 对接真实观测源（Prometheus/Datadog/仓内指标表）替换 mock metrics provider
- 增加 E2E 测试网用例（真实钱包签名与链上回执）
- 加入告警通道（gate blocked / timeout rate 异常）
- 为 rollout 状态加版本号与变更人元数据（便于审计）

## 5. 关键文件索引

- 入口导出：`src/index.js`
- 工作流：
  - `src/workflow-bridge-assets.js`
  - `src/workflow-swap-then-bridge.js`
  - `src/workflow-safe-large-transfer-review.js`
- 风控与可靠性：
  - `src/policy-engine.js`
  - `src/workflow-helpers.js`
  - `src/status-poller.js`
  - `src/error-mapping.js`
  - `src/idempotency.js`
- 发布控制：
  - `src/release-gate.js`
  - `src/gray-release.js`
  - `src/rollout-manager.js`

