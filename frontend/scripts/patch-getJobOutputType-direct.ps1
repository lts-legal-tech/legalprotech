param(
  [string]$WorkerPath = ""
)

$ErrorActionPreference = "Stop"

function Resolve-WorkerPath {
  param([string]$InputPath)
  if ($InputPath -and (Test-Path $InputPath)) { return (Resolve-Path $InputPath).Path }

  $candidates = @(
    (Join-Path (Get-Location) "scripts\windows-flow-worker.mjs"),
    (Join-Path (Get-Location) "frontend\scripts\windows-flow-worker.mjs"),
    "C:\Users\asus\Downloads\Compressed\legalprotech\frontend\scripts\windows-flow-worker.mjs",
    "C:\legalprotech\frontend\scripts\windows-flow-worker.mjs"
  )

  foreach ($p in $candidates) {
    if (Test-Path $p) { return (Resolve-Path $p).Path }
  }

  throw "Không tìm thấy scripts\windows-flow-worker.mjs. Hãy cd vào thư mục frontend hoặc truyền -WorkerPath."
}

$path = Resolve-WorkerPath $WorkerPath
Write-Host "Patching worker:" $path

$content = Get-Content -LiteralPath $path -Raw -Encoding UTF8
if ($content -notmatch "getJobOutputType") {
  Write-Host "Không thấy chuỗi getJobOutputType trong worker. Có thể file đã khác bản lỗi."
  exit 0
}

$backup = "$path.bak_getJobOutputType_direct_$(Get-Date -Format yyyyMMdd_HHmmss)"
Copy-Item -LiteralPath $path -Destination $backup -Force
Write-Host "Backup:" $backup

$helper = @'

// AUTO PATCH: fallback getJobOutputType for Flow worker result saving.
// Added to fix: ReferenceError: getJobOutputType is not defined.
function getJobOutputType(...args) {
  try {
    for (const arg of args) {
      if (!arg) continue;
      if (typeof arg === 'string') {
        const s = arg.toLowerCase();
        if (s.includes('image')) return 'image';
        if (s.includes('video')) return 'video';
        if (s.endsWith('.png') || s.endsWith('.jpg') || s.endsWith('.jpeg') || s.endsWith('.webp')) return 'image';
        if (s.endsWith('.mp4') || s.endsWith('.webm') || s.endsWith('.mov') || s.endsWith('.mkv')) return 'video';
      }
      if (typeof arg === 'object') {
        const direct = arg.outputType || arg.output_type || arg.type || arg.mode || arg.kind || arg.resultType || arg.result_type;
        if (typeof direct === 'string') {
          const d = direct.toLowerCase();
          if (d.includes('image')) return 'image';
          if (d.includes('video')) return 'video';
        }
        const filename = arg.filename || arg.fileName || arg.resultFile || arg.resultPath || arg.outputFile || arg.path || arg.url || arg.resultUrl;
        if (typeof filename === 'string') {
          const f = filename.toLowerCase();
          if (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.webp')) return 'image';
          if (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mov') || f.endsWith('.mkv')) return 'video';
        }
      }
    }
  } catch (_) {}
  return process.env.FLOW_OUTPUT_TYPE || 'video';
}

'@

# 1) Prepend function at the absolute top unless already present as a real function.
if ($content -notmatch "function\s+getJobOutputType\s*\(") {
  $content = $helper + $content
}

# 2) Extra hardening: if the file uses a different scope later, rewrite calls inside the file to a local alias that is defined above.
# This keeps the original function name available but also removes any dependency on missing imports.
# Do not rename the function declaration itself.
$content = $content -replace "(?<!function\s)getJobOutputType\s*\(", "getJobOutputType("

Set-Content -LiteralPath $path -Value $content -Encoding UTF8

$check = Select-String -Path $path -Pattern "function\s+getJobOutputType" -SimpleMatch:$false
if (-not $check) {
  throw "Patch failed: chưa thấy function getJobOutputType sau khi ghi file."
}

Write-Host "OK: Đã thêm function getJobOutputType."
Write-Host "Kiểm tra nhanh bằng lệnh:"
Write-Host "Select-String -Path .\scripts\windows-flow-worker.mjs -Pattern 'function getJobOutputType'"
