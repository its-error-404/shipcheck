<#
.SYNOPSIS
  One-command local LLM setup for the release agent (Windows):
  installs Ollama, configures its context window for agent conversations,
  pulls the model, and points .env at it (previous LLM lines are kept, commented).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/setup-ollama.ps1
  powershell -ExecutionPolicy Bypass -File scripts/setup-ollama.ps1 -Model qwen3:8b -ContextLength 24576
#>
param(
  [string]$Model = "qwen3:8b",
  [int]$ContextLength = 24576,
  [switch]$SkipEnvUpdate
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

function Step($n, $text) { Write-Host "`n[$n/6] $text" -ForegroundColor Cyan }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

Step 1 "Installing Ollama (skipped if already installed)"
Refresh-Path
if (Get-Command ollama -ErrorAction SilentlyContinue) {
  Write-Host "Ollama already installed: $(ollama --version)"
} else {
  winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    $candidate = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
    if (Test-Path (Join-Path $candidate "ollama.exe")) { $env:Path += ";$candidate" }
    else { throw "Ollama installed but not found on PATH. Close this terminal, open a new one and rerun the script." }
  }
}

Step 2 "Configuring Ollama for agent conversations (user environment variables)"
# Default context is ~4k tokens; an investigation needs ~15-20k. Flash attention + q8_0 KV cache keep it inside 8 GB VRAM.
$settings = @{ OLLAMA_CONTEXT_LENGTH = "$ContextLength"; OLLAMA_FLASH_ATTENTION = "1"; OLLAMA_KV_CACHE_TYPE = "q8_0" }
foreach ($k in $settings.Keys) {
  [Environment]::SetEnvironmentVariable($k, $settings[$k], "User")
  Set-Item -Path "Env:$k" -Value $settings[$k]
  Write-Host "  $k=$($settings[$k])"
}

Step 3 "Restarting Ollama so the settings take effect"
Get-Process | Where-Object { $_.ProcessName -like "ollama*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$ollamaExe = (Get-Command ollama).Source
$log = Join-Path $env:TEMP "ollama-serve.log"
$errLog = Join-Path $env:TEMP "ollama-serve.err.log"
Write-Host "  Starting: $ollamaExe serve  (logs: $errLog)"
# Start the server directly (deterministic); it inherits the OLLAMA_* settings set above.
Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errLog
$ready = $false
for ($i = 0; $i -lt 90 -and -not $ready; $i++) {
  try { Invoke-RestMethod -Uri "http://localhost:11434/api/version" -TimeoutSec 2 | Out-Null; $ready = $true } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) {
  Write-Host "  Server log (last 40 lines):" -ForegroundColor Yellow
  if (Test-Path $errLog) { Get-Content $errLog -Tail 40 }
  throw "Ollama server did not start on http://localhost:11434 within 90 s (see log above)"
}
Write-Host "  Ollama server is up"

Step 4 "Pulling model $Model (several GB on first run)"
ollama pull $Model
if ($LASTEXITCODE -ne 0) { throw "ollama pull $Model failed" }

Step 5 "GPU check"
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv
} else { Write-Host "  nvidia-smi not found (Ollama will fall back to CPU, which is much slower)" }

Step 6 "Pointing .env at Ollama"
$envFile = Join-Path $repo ".env"
if ($SkipEnvUpdate) {
  Write-Host "  Skipped (-SkipEnvUpdate)."
} elseif (-not (Test-Path $envFile)) {
  Write-Host "  No .env found; copy .env.example to .env first, then rerun." -ForegroundColor Yellow
} else {
  Copy-Item $envFile "$envFile.bak" -Force
  $new = [ordered]@{
    LLM_BASE_URL = "http://localhost:11434/v1"; LLM_API_KEY = "ollama"; LLM_MODEL = $Model; LLM_PROVIDER = "ollama"
    LLM_RPM = "0"; LLM_TIMEOUT_MS = "300000"; LLM_REASONING_EFFORT = ""; AGENT_ELIDE_ABOVE_CHARS = "40000"
  }
  # Keep previous values as comments (e.g. the Gemini key) so switching back is easy.
  $lines = Get-Content $envFile | ForEach-Object {
    $line = $_
    foreach ($k in $new.Keys) { if ($line -match "^\s*$k\s*=") { $line = "# (before ollama) $line"; break } }
    $line
  }
  $lines += ""
  $lines += "# --- Local LLM via Ollama (written by scripts/setup-ollama.ps1) ---"
  foreach ($k in $new.Keys) { $lines += "$k=$($new[$k])" }
  Set-Content -Path $envFile -Value $lines -Encoding utf8
  Write-Host "  Updated .env (backup: .env.bak). Previous LLM lines are kept as comments."
}

Write-Host "`nDone. Next:" -ForegroundColor Green
Write-Host "  npm run verify-llm -- --models $Model"
Write-Host "  npm run assess"
