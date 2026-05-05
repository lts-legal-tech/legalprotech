# Reset Chrome/Node processes that may be holding the Playwright Chrome profile lock.
# Run this in PowerShell before restarting the worker if you see:
# "profile is already in use", "Chrome bị chiếm", or "user data dir is already in use".

Write-Host "Stopping chrome.exe..." -ForegroundColor Yellow
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Stopping node.exe..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Done. Start worker again from frontend:" -ForegroundColor Green
Write-Host "cd C:\legalprotech\frontend"
Write-Host "npm run worker"
