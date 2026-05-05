param(
  [string]$WorkerPath = ".\scripts\windows-flow-worker.mjs"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $WorkerPath)) {
  Write-Error "Không tìm thấy file worker: $WorkerPath. Hãy chạy script trong thư mục frontend hoặc truyền -WorkerPath đúng đường dẫn."
}

$content = Get-Content -Raw -LiteralPath $WorkerPath

if ($content -match "function\s+getJobOutputType\s*\(") {
  Write-Host "OK: getJobOutputType đã tồn tại, không cần vá."
  exit 0
}

$helper = @'

// AUTO PATCH: helper fallback for output type detection.
// Fixes: ReferenceError: getJobOutputType is not defined
function getJobOutputType(job = {}) {
  const candidates = [
    job?.outputType,
    job?.output_type,
    job?.resultType,
    job?.result_type,
    job?.mediaType,
    job?.media_type,
    job?.kind,
    job?.type,
    job?.mode,
    process.env.FLOW_OUTPUT_TYPE,
    process.env.FLOW_JOB_OUTPUT_TYPE,
    process.env.NEXT_PUBLIC_FLOW_OUTPUT_TYPE,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  const joined = candidates.join(" ");

  if (joined.includes("image") || joined.includes("img") || joined.includes("photo") || joined.includes("ảnh")) {
    return "image";
  }

  if (joined.includes("video") || joined.includes("veo") || joined.includes("flow") || joined.includes("clip")) {
    return "video";
  }

  const promptText = [
    job?.prompt,
    job?.input,
    job?.description,
    job?.title,
    job?.request,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (promptText.includes("image") || promptText.includes("photo") || promptText.includes("ảnh")) {
    return "image";
  }

  // Project này đang dùng AutoFlow tạo video, nên mặc định an toàn là video.
  return "video";
}
'@

# Prefer inserting right before downloadOrCaptureResult, because that is where the missing function is used.
$pattern = "(?m)^\s*async\s+function\s+downloadOrCaptureResult\s*\("
$match = [regex]::Match($content, $pattern)

if ($match.Success) {
  $insertAt = $match.Index
  $newContent = $content.Insert($insertAt, $helper + "`r`n")
} else {
  # Fallback: insert after imports/shebang area near top.
  $newContent = $helper + "`r`n" + $content
}

$backupPath = "$WorkerPath.bak_getJobOutputType_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $WorkerPath -Destination $backupPath -Force
Set-Content -LiteralPath $WorkerPath -Value $newContent -Encoding UTF8

Write-Host "Đã vá xong: $WorkerPath"
Write-Host "Backup: $backupPath"
Write-Host "Bây giờ chạy lại: npm run worker:slots"
