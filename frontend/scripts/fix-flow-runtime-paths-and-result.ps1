param(
  [string]$FrontendDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$FrontendDir = (Resolve-Path $FrontendDir).Path
$ProjectRoot = (Resolve-Path (Join-Path $FrontendDir "..")).Path
$EnvPath = Join-Path $FrontendDir ".env.local"
$WorkerPath = Join-Path $FrontendDir "scripts\windows-flow-worker.mjs"

function Upsert-EnvLine([string]$Path, [string]$Key, [string]$Value) {
  $line = "$Key=$Value"
  if (!(Test-Path $Path)) {
    Set-Content -Path $Path -Value $line -Encoding UTF8
    return
  }
  $content = Get-Content -Path $Path -Raw
  if ($content -match "(?m)^$([regex]::Escape($Key))=") {
    $content = [regex]::Replace($content, "(?m)^$([regex]::Escape($Key))=.*$", [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $line })
  } else {
    if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $content += "`r`n" }
    $content += "$line`r`n"
  }
  Set-Content -Path $Path -Value $content -Encoding UTF8
}

Write-Host "[fix] FrontendDir=$FrontendDir"
Write-Host "[fix] ProjectRoot=$ProjectRoot"

# Đồng bộ store giữa web Next.js và worker theo đúng thư mục project đang chạy.
Upsert-EnvLine $EnvPath "FLOW_API_BASE_URL" "http://127.0.0.1:3000"
Upsert-EnvLine $EnvPath "FLOW_WORKER_MODE" "playwright"
Upsert-EnvLine $EnvPath "VPS_MOCK_MODE" "false"
Upsert-EnvLine $EnvPath "FLOW_JOB_STORE_DIR" (Join-Path $FrontendDir ".flow-jobs")
Upsert-EnvLine $EnvPath "FLOW_DOWNLOAD_DIR" (Join-Path $FrontendDir ".flow-downloads")
Upsert-EnvLine $EnvPath "CHROME_PROFILE_DIR" (Join-Path $FrontendDir ".chrome-flow-profile")
Upsert-EnvLine $EnvPath "FLOW_ACCOUNT_CONFIG_PATH" (Join-Path $FrontendDir ".flow-account-config.json")
Upsert-EnvLine $EnvPath "FLOW_IMAGE_DOWNLOAD_QUALITY" "2K"
Upsert-EnvLine $EnvPath "FLOW_AFTER_RESULT_HOVER_DELAY_MS" "1200"
Upsert-EnvLine $EnvPath "FLOW_AFTER_DOWNLOAD_MENU_DELAY_MS" "700"
Upsert-EnvLine $EnvPath "FLOW_AFTER_QUALITY_CLICK_DELAY_MS" "500"
Upsert-EnvLine $EnvPath "FLOW_KEEP_BROWSER_OPEN" "false"

if (!(Test-Path $WorkerPath)) {
  throw "Không tìm thấy worker: $WorkerPath"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $WorkerPath "$WorkerPath.bak_jobstore_result_$stamp"
$src = Get-Content -Path $WorkerPath -Raw

# 1) Nếu chưa có getJobOutputType thì thêm helper.
if ($src -notmatch "function\s+getJobOutputType\s*\(") {
  $helper = @'
function getJobOutputType(job = {}) {
  const explicit = String(job.outputType || job.resultType || job.mediaType || '').trim().toLowerCase();
  if (explicit === 'image' || explicit === 'photo' || explicit === 'picture') return 'image';
  if (explicit === 'video' || explicit === 'movie') return 'video';

  const tool = String(job.tool || job.type || '').trim().toLowerCase();
  if (tool.includes('image-to-video') || tool.includes('text-to-video') || tool.includes('video')) return 'video';
  if (tool.includes('image') || tool.includes('photo')) return 'image';

  return 'video';
}

'@
  $src = $src -replace "(function\s+isImageFilePath\s*\([^)]*\)\s*\{[\s\S]*?\n\})", "`$1`r`n$helper"
}

# 2) Không bao giờ dùng candidate banner/gstatic làm kết quả thật.
if ($src -notmatch "isBadFlowCandidateUrl") {
  $helper2 = @'
function isBadFlowCandidateUrl(urlValue = '') {
  const url = String(urlValue || '').toLowerCase();
  return (
    url.includes('/flow/banners/') ||
    url.includes('aitestkitchen/website/flow/banners') ||
    url.includes('/favicon/') ||
    url.includes('manifest.webmanifest') ||
    url.includes('getflowappconfig') ||
    url.includes('getusersettings') ||
    url.includes('lh3.googleusercontent.com/a/')
  );
}

'@
  $src = $src -replace "(async\s+function\s+downloadOrCaptureResult\s*\()", "$helper2`r`n`$1"
}

# 3) Thay optional chaining sai nếu còn.
$src = $src -replace "getJobOutputType\?\.\(job\) \|\| 'video'", "getJobOutputType(job)"

# 4) Trong safeCandidates, loại bỏ banner/mock/config resources.
$src = $src -replace "const url = String\(item\.url \|\| ''\)\.toLowerCase\(\);", "const url = String(item.url || '').toLowerCase();`r`n`r`n      if (typeof isBadFlowCandidateUrl === 'function' && isBadFlowCandidateUrl(url)) return false;"

# 5) Nếu là job ảnh, không fallback sang video candidate. Nếu không tải được bằng UI thì fail/debug thay vì upload banner mp4.
$src = $src -replace "if \(!savePath\) \{\s*const candidates = await collectVideoCandidates\(page\);", "if (!savePath && getJobOutputType(job) === 'video') {`r`n    const candidates = await collectVideoCandidates(page);"

Set-Content -Path $WorkerPath -Value $src -Encoding UTF8

Write-Host "[fix] Đã sửa .env.local và worker. Backup: $WorkerPath.bak_jobstore_result_$stamp"
Write-Host "[fix] Kiểm tra lại bằng:"
Write-Host "      Select-String -Path .\.env.local -Pattern 'FLOW_JOB_STORE_DIR|FLOW_DOWNLOAD_DIR|CHROME_PROFILE_DIR|FLOW_WORKER_MODE'"
Write-Host "      Select-String -Path .\scripts\windows-flow-worker.mjs -Pattern 'isBadFlowCandidateUrl|getJobOutputType'"
