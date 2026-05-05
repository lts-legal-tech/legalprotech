$ErrorActionPreference = 'Stop'

$workerPath = Join-Path $PSScriptRoot 'windows-flow-worker.mjs'
if (!(Test-Path $workerPath)) {
  $workerPath = Join-Path (Get-Location) 'scripts\windows-flow-worker.mjs'
}
if (!(Test-Path $workerPath)) {
  throw "Không tìm thấy scripts\windows-flow-worker.mjs. Hãy chạy script này trong thư mục frontend, hoặc đặt script trong frontend\scripts."
}

$raw = Get-Content -LiteralPath $workerPath -Raw
$backup = "$workerPath.bak_outputtype_final_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $workerPath -Destination $backup -Force

# 1) Chèn helper nếu chưa có. Đặt ngay sau isImageFilePath để chắc chắn cùng top-level scope.
if ($raw -notmatch 'function\s+getJobOutputType\s*\(') {
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
  $anchor = @'
function isImageFilePath(filePath) {
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(String(filePath || '')).toLowerCase());
}
'@
  if ($raw.Contains($anchor)) {
    $raw = $raw.Replace($anchor, $anchor + $helper)
  } else {
    $raw = $helper + "`r`n" + $raw
  }
}

# 2) Sửa lỗi gốc: optional chaining trên biến chưa khai báo vẫn ReferenceError.
# Đổi getJobOutputType?.(job) thành getJobOutputType(job).
$raw = $raw -replace 'getJobOutputType\?\.\(job\)\s*\|\|\s*''video''', 'getJobOutputType(job)'
$raw = $raw -replace 'getJobOutputType\?\.\(job\)\s*\|\|\s*"video"', 'getJobOutputType(job)'

Set-Content -LiteralPath $workerPath -Value $raw -Encoding UTF8

Write-Host "Đã vá: $workerPath"
Write-Host "Backup: $backup"
Select-String -Path $workerPath -Pattern 'function getJobOutputType|getJobOutputType\(' | ForEach-Object { Write-Host ("{0}: {1}" -f $_.LineNumber, $_.Line.Trim()) }
