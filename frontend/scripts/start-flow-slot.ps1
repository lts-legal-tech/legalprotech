param(
  [int]$Slot = 1,
  [string]$ProjectRoot = "",
  [switch]$KeepChromeOpen
)

$ErrorActionPreference = "Stop"

# Resolve project from this script location by default:
# <project>\frontend\scripts\start-flow-slot.ps1
$scriptDir = $PSScriptRoot
$frontend = Split-Path -Parent $scriptDir
$autoProjectRoot = Split-Path -Parent $frontend

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = $autoProjectRoot
}

$frontend = Join-Path $ProjectRoot "frontend"
if (!(Test-Path $frontend)) {
  throw "Không tìm thấy thư mục frontend: $frontend. Hãy chạy từ đúng project hoặc truyền -ProjectRoot đúng đường dẫn."
}

$profile = Join-Path $ProjectRoot ("chrome-flow-profile-{0}" -f $Slot)
$downloads = Join-Path $ProjectRoot ("flow-downloads\slot-{0}" -f $Slot)
$jobs = if ($env:FLOW_JOB_STORE_DIR) { $env:FLOW_JOB_STORE_DIR } else { Join-Path $frontend ".flow-jobs" }

New-Item -ItemType Directory -Force -Path $profile | Out-Null
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
New-Item -ItemType Directory -Force -Path $jobs | Out-Null

# Slot identity
$env:FLOW_WORKER_SLOT = "slot_$Slot"
$env:FLOW_WORKER_ID = "windows-vps-flow-slot-$Slot"
$env:CHROME_PROFILE_DIR = $profile
$env:FLOW_DOWNLOAD_DIR = $downloads
$env:FLOW_JOB_STORE_DIR = $jobs

# IMPORTANT: never let the slot worker silently fall back to dry-run/mock placeholder.
$env:FLOW_WORKER_MODE = "playwright"
if (-not $env:FLOW_API_BASE_URL) { $env:FLOW_API_BASE_URL = "http://127.0.0.1:3000" }

# Each slot has its own profile. Default closes Chrome after job to avoid profile lock.
if ($KeepChromeOpen) {
  $env:FLOW_KEEP_BROWSER_OPEN = "true"
} elseif (-not $env:FLOW_KEEP_BROWSER_OPEN) {
  # Giữ profile Chrome mở trong từng slot để không phải setup lại cho mỗi job.
  $env:FLOW_KEEP_BROWSER_OPEN = "true"
}

# Reduce aggressive polling in multi-slot mode.
if (-not $env:FLOW_WORKER_POLL_INTERVAL_MS) { $env:FLOW_WORKER_POLL_INTERVAL_MS = "3000" }
if (-not $env:FLOW_RESULT_READY_POLL_MS) { $env:FLOW_RESULT_READY_POLL_MS = "2500" }
if (-not $env:FLOW_DOWNLOAD_TIMEOUT_MS) { $env:FLOW_DOWNLOAD_TIMEOUT_MS = "120000" }
if (-not $env:FLOW_RECLAIM_STALLED_JOBS) { $env:FLOW_RECLAIM_STALLED_JOBS = "false" }
if (-not $env:FLOW_MAX_CLAIM_ATTEMPTS) { $env:FLOW_MAX_CLAIM_ATTEMPTS = "1" }

Write-Host "Starting Flow slot $Slot"
Write-Host "Project root: $ProjectRoot"
Write-Host "Frontend: $frontend"
Write-Host "Worker ID: $env:FLOW_WORKER_ID"
Write-Host "Mode: $env:FLOW_WORKER_MODE"
Write-Host "API base: $env:FLOW_API_BASE_URL"
Write-Host "Chrome profile: $env:CHROME_PROFILE_DIR"
Write-Host "Download dir: $env:FLOW_DOWNLOAD_DIR"
Write-Host "Job store: $env:FLOW_JOB_STORE_DIR"

Set-Location $frontend
node scripts/windows-flow-worker.mjs
