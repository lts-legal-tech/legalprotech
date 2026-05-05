$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectScripts = $ScriptDir
$Target = Join-Path $ProjectScripts "windows-flow-worker.mjs"
if (!(Test-Path $Target)) { throw "Không tìm thấy $Target" }
Write-Host "Đã có file windows-flow-worker.mjs đã sửa hover-download trong thư mục scripts." -ForegroundColor Green
Write-Host "Tiếp theo: taskkill /F /IM node.exe ; taskkill /F /IM chrome.exe ; cd .. ; npm run worker:slots" -ForegroundColor Yellow
