# LI.FI Runtime Quickstart (Workspace Copy)

This file is placed directly in the workspace so you can open and copy commands locally.

## 1) Start runtime server with real LI.FI quote/status

```powershell
cd F:\src\lifiskill
$env:LIFISKILL_RUNTIME_TOKEN="replace_with_secure_token"
$env:LIFISKILL_USE_LIFI_API="true"
$env:LIFISKILL_USE_LIFI_EXECUTE="false"
$env:LI_FI_API_KEY="your_lifi_api_key"
$env:LI_FI_INTEGRATOR="your_integrator_name"
$env:LI_FI_BASE_URL="https://li.quest/v1"
$env:IP_ALLOWLIST="127.0.0.1/32"
$env:RUNTIME_TRUSTED_PROXY="false"
$env:RUNTIME_LOG_ENABLED="true"
$env:RUNTIME_LOG_FORMAT="pretty"
npm.cmd run serve:runtime
```

Notes:
- `LIFISKILL_USE_LIFI_API=true`: use real LI.FI API for quote/status.
- `LIFISKILL_USE_LIFI_EXECUTE=false`: keep execution mocked (safer for integration testing).
- Set `LIFISKILL_USE_LIFI_EXECUTE=true` only when you are ready for real execute behavior.

## 2) Call health and run-skill endpoints

Open a second terminal:

```powershell
$token="replace_with_secure_token"
$headers=@{
  Authorization = "Bearer $token"
  "Content-Type" = "application/json"
  "x-request-id" = "quickstart-001"
}

Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8787/healthz"

$body = @{
  skillId = "bridge-assets"
  actorId = "0x1111111111111111111111111111111111111111"
  quotePolicy = @{
    maxRequoteCount = 0
  }
  input = @{
    fromChain = 1
    toChain = 10
    token = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    amount = "1000000"
    fromAddress = "0x1111111111111111111111111111111111111111"
    receiver = "0x1111111111111111111111111111111111111111"
    autoConfirm = $false
    confirmed = $false
    operationId = "quickstart-op-1"
  }
} | ConvertTo-Json -Depth 12

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/run-skill" -Headers $headers -Body $body
```

Then confirm with the same `operationId`:

```powershell
$body2 = @{
  skillId = "bridge-assets"
  actorId = "0x1111111111111111111111111111111111111111"
  quotePolicy = @{
    maxRequoteCount = 0
  }
  input = @{
    fromChain = 1
    toChain = 10
    token = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    amount = "1000000"
    fromAddress = "0x1111111111111111111111111111111111111111"
    receiver = "0x1111111111111111111111111111111111111111"
    autoConfirm = $false
    confirmed = $true
    operationId = "quickstart-op-1"
  }
} | ConvertTo-Json -Depth 12

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/run-skill" -Headers $headers -Body $body2
```

Expected flow:
- First call returns `state = "awaiting_confirm"`.
- Second call returns `state = "completed"` (or `polling` depending on status backend behavior).

## 3) Common Windows CMD fix

If `npm` says it cannot find `package.json`, your directory is likely still on `C:`. Use:

```bat
cd /d F:\src\lifiskill
npm.cmd run serve:runtime
```

