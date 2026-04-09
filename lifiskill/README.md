# lifiskill (Week 1-4)

This folder contains an implementation slice of the LI.FI workflow-skill runtime.
It is an original implementation inspired by agent skill architecture patterns, but not copied from external source code.

Implemented so far:

- Skill definition validation (JSON-based in `skills/`)
- LI.FI client wrappers for quote/status/execute-route calls
- Tool layer (`LiFiQuoteTool`, `LiFiStatusTool`, `LiFiExecuteTool`)
- Policy engine (`allow` / `require_confirm` / `deny`)
- Approval preflight (`allowance -> permit/approve`)
- Workflow runtime state machine (`planned -> awaiting_confirm -> executing -> polling -> completed/failed`)
- Core skills:
- `bridge-assets`
- `swap-then-bridge`
- `safe-large-transfer-review` (review only, no execution)
- Structured audit logs (`traceId`, `operationId`, transitions, error code/message)
- Feature flags:
- `quoteOnly` execution blocking
- `disabledSkills` per skill switch-off
- Requote guardrails (`TTL / gas drift / min-output drift`) with automatic `plan-only` downgrade
- Workflow input validation with standardized `INVALID_INPUT` errors
- Status poller with timeout and lifecycle mapping
- Status poller transient fetch-error tolerance (`maxFetchErrors`)
- Unified error classification (`ErrorCode`)
- Release gate evaluator for go/no-go checks
- Gray-release + rollout manager orchestration
- Shared idempotency registry support for production wiring
- Workflow runtime dispatcher (auto inject rollout flags + shared idempotency)
- HTTP runtime server for internal service integration
- Automated tests (`40 passed`)

## Run tests

```powershell
cd F:\src\lifiskill
npm.cmd run test
```

## Run quote demo

```powershell
cd F:\src\lifiskill
$env:LI_FI_API_KEY="your_api_key"
npm.cmd run demo:quote
```

## Run release gate demo

```powershell
cd F:\src\lifiskill
npm.cmd run demo:release-gate
```

## Run gray release demo (with pre-rollout gate check)

```powershell
cd F:\src\lifiskill
npm.cmd run demo:gray-release
```

This demo does:

- Evaluate release gate metrics first
- Promote `bridge-assets`, `swap-then-bridge`, `safe-large-transfer-review` by one phase if gate passes
- Derive actor-level `featureFlags.disabledSkills` for canary rollout
- Print enabled ratio per skill before and after promotion

## Run rollout manager demo (production-style orchestrator)

```powershell
cd F:\src\lifiskill
npm.cmd run demo:rollout-manager
```

This demo includes:

- Metric provider -> release gate evaluation
- Automatic promotion when gate passes
- Blocking behavior when gate fails (configurable strict/non-strict)
- Per-actor feature flag generation
- Persistent rollout state snapshot in `.runtime/rollout-state.json`

## Run workflow runtime demo (last-mile runtime wiring)

```powershell
cd F:\src\lifiskill
npm.cmd run demo:workflow-runtime
```

This demo shows:

- Rollout gate evaluation and traffic update
- Skill dispatch through a single runtime entry
- Automatic actor-level feature flags injection
- Shared idempotency registry reuse across workflow calls

## Run runtime server (HTTP)

```powershell
cd F:\src\lifiskill
$env:LIFISKILL_RUNTIME_TOKEN="replace_with_secure_token"
$env:IP_ALLOWLIST="10.0.0.0/8,192.168.0.0/16"
$env:RUNTIME_TRUSTED_PROXY="true"
$env:RUNTIME_LOG_ENABLED="true"
$env:RUNTIME_LOG_FORMAT="pretty"
npm.cmd run serve:runtime
```

Connect runtime server to real LI.FI API (quote/status):

```powershell
cd F:\src\lifiskill
$env:LIFISKILL_RUNTIME_TOKEN="replace_with_secure_token"
$env:LIFISKILL_USE_LIFI_API="true"
$env:LI_FI_API_KEY="your_lifi_api_key"
$env:LI_FI_INTEGRATOR="your_integrator_name"
$env:LI_FI_BASE_URL="https://li.quest/v1"
npm.cmd run serve:runtime
```

If you also want runtime to call LI.FI execute endpoint, set:

```powershell
$env:LIFISKILL_USE_LIFI_EXECUTE="true"
```

Notes:

- Default mode remains `mock` for safe local demos.
- `LIFISKILL_USE_LIFI_API=true` enables real LI.FI quote/status calls.
- Keep `LIFISKILL_USE_LIFI_EXECUTE=false` unless you have a production-ready
  signing/broadcasting path and understand execution implications.

Endpoints:

- `GET /healthz`
- `POST /evaluate-rollout`
- `POST /run-skill`

Auth:

- Send `Authorization: Bearer <token>` or `x-runtime-token: <token>`
- If `LIFISKILL_RUNTIME_TOKEN` is unset, auth is disabled

Production hardening:

- IP allowlist / CIDR supported (`IP_ALLOWLIST`, comma-separated)
- Proxy-aware client IP parsing (`RUNTIME_TRUSTED_PROXY=true`)
- Request ID propagation:
  - inbound: `x-request-id` (customizable by `requestIdHeader`)
  - outbound: response header `x-request-id` and JSON field `requestId`
- Structured access logs:
  - one JSON line per request (`event=runtime_http_access`)
  - includes `requestId`, `method`, `path`, `statusCode`, `durationMs`, `ip`, `errorCode`, `skillId`
  - toggle with `RUNTIME_LOG_ENABLED` (`true` by default)
  - format with `RUNTIME_LOG_FORMAT=json|pretty` (`json` default)

Example:

```powershell
$token="replace_with_secure_token"
$headers=@{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8787/healthz"

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/evaluate-rollout" -Headers $headers -Body "{}"

$body = @{
  skillId = "bridge-assets"
  input = @{
    fromChain = 1
    toChain = 10
    token = "USDC"
    amount = "1000000"
    fromAddress = "0x1111111111111111111111111111111111111111"
    receiver = "0x1111111111111111111111111111111111111111"
    autoConfirm = $true
    confirmed = $true
    operationId = "http_demo_1"
  }
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/run-skill" -Headers $headers -Body $body
```

## Production integration pattern

Use `createRolloutManager` with your own metrics source:

```js
import {
  createJsonFileRolloutStateStore,
  createRolloutManager,
} from './src/index.js'

const stateStore = createJsonFileRolloutStateStore({
  filePath: '/your/path/rollout-state.json',
})

const manager = createRolloutManager({
  stateStore,
  metricsProvider: async () => {
    // Pull from observability platform / DB / analytics service
    return {
      tests: { total: 120, failed: 0 },
      quality: {
        p0Count: 0,
        p1Count: 0,
        confirmationCoverage: 1,
        auditCoverage: 1,
        fallbackCoverage: 1,
      },
      skills: {
        bridgeAssetsE2E: true,
        swapThenBridgeE2E: true,
        safeLargeTransferReviewE2E: true,
      },
      slos: {
        successRate7d: 0.98,
        statusTimeoutRate7d: 0.005,
        p95CompletionMinutes7d: 6.3,
      },
    }
  },
  autoPromote: true,
  strictGate: true,
})

await manager.evaluateAndPromote()
const flags = await manager.getFlagsForActor('0xUserWallet')
```

For workflow execution, prefer `createWorkflowRuntime` so gray-release and
idempotency are wired by default:

```js
import { createWorkflowRuntime } from './src/index.js'

const runtime = createWorkflowRuntime({
  rolloutManager: manager,
  skills: [bridgeSkill, swapBridgeSkill, safeReviewSkill],
  quoteTool,
  executeTool,
  statusTool,
})

const result = await runtime.runSkill({
  skillId: 'bridge-assets',
  input,
  approvalProvider,
})
```

## Included modules

- `src/skill-schema.js`
- `src/lifi-client.js`
- `src/route-summary.js`
- `src/tools.js`
- `src/policy-engine.js`
- `src/approval.js`
- `src/workflow-bridge-assets.js`
- `src/workflow-swap-then-bridge.js`
- `src/workflow-safe-large-transfer-review.js`
- `src/audit.js`
- `src/feature-flags.js`
- `src/error-mapping.js`
- `src/status-poller.js`
- `src/release-gate.js`
- `src/index.js` (public exports)
- `src/gray-release.js`
- `src/idempotency.js`
- `src/rollout-manager.js`
- `src/workflow-runtime.js`
- `src/runtime-server.js`
- `skills/bridge-assets.json`
- `skills/swap-then-bridge.json`
- `skills/safe-large-transfer-review.json`
- `tests/run-tests.mjs`
- `examples/quote-preview.mjs`
- `examples/release-gate-check.mjs`
- `examples/gray-release-rollout.mjs`
- `examples/rollout-manager-run.mjs`
- `examples/workflow-runtime-run.mjs`
- `examples/runtime-server-start.mjs`
