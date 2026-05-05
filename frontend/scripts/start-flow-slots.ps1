param(
  [int]$Slots = 3,
  [string]$ProjectRoot = "",
  [switch]$KeepChromeOpen
)

$ErrorActionPreference = "Stop"

# Resolve project from this script location by default:
# <project>\frontend\scripts\start-flow-slots.ps1
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

Set-Location $frontend

for ($i = 1; $i -le $Slots; $i++) {
  $argsList = @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $frontend "scripts\start-flow-slot.ps1"),
    "-Slot", "$i",
    "-ProjectRoot", $ProjectRoot
  )
  if ($KeepChromeOpen) { $argsList += "-KeepChromeOpen" }

  Start-Process powershell -ArgumentList $argsList -WindowStyle Normal
  Start-Sleep -Seconds 3
}

Write-Host "Đã mở $Slots Flow worker slot. Mỗi slot dùng Chrome profile riêng."
Write-Host "Project root: $ProjectRoot"
Write-Host "Frontend: $frontend"
