param(
  [string]$ProjectRoot = "C:\legalprotech",
  [switch]$KillNode
)

Write-Host "Đóng Chrome đang treo để gỡ lock profile..."
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

if ($KillNode) {
  Write-Host "Đóng Node worker..."
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

$frontend = Join-Path $ProjectRoot "frontend"
$store = if ($env:FLOW_JOB_STORE_DIR) { $env:FLOW_JOB_STORE_DIR } else { Join-Path $frontend ".flow-jobs" }
$lock = Join-Path $store "claim.lock"
if (Test-Path $lock) {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
  Write-Host "Đã xóa claim.lock"
}

Write-Host "Xong. Có thể chạy lại: npm run worker:slots"
