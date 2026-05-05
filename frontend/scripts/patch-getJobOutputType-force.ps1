param(
  [string]$WorkerPath = "$PSScriptRoot\windows-flow-worker.mjs"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $WorkerPath)) {
  Write-Host "Khong tim thay worker o: $WorkerPath" -ForegroundColor Red
  Write-Host "Hay chay lenh nay tu thu muc frontend hoac truyen -WorkerPath dung duong dan."
  exit 1
}

$src = Get-Content -LiteralPath $WorkerPath -Raw -Encoding UTF8

# Remove old broken/partial helper blocks created by earlier attempts, if any.
$src = [regex]::Replace($src, "(?s)\n?// AUTO PATCH: getJobOutputType fallback START.*?// AUTO PATCH: getJobOutputType fallback END\r?\n?", "`r`n")

$helper = @'

// AUTO PATCH: getJobOutputType fallback START
// Fix ReferenceError: getJobOutputType is not defined.
// The worker calls this while saving/downloading Flow results. Keep it global in this module.
function getJobOutputType(...args) {
  const normalize = (value) => {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return null;
    if (text.includes("image") || text.includes("photo") || text.includes("picture") || text.includes("banana")) return "image";
    if (text.includes("video") || text.includes("veo") || text.includes("flow")) return "video";
    if (["image", "video"].includes(text)) return text;
    return null;
  };

  const envType = normalize(process.env.FLOW_OUTPUT_TYPE || process.env.AUTOFLOW_OUTPUT_TYPE || process.env.FLOW_JOB_OUTPUT_TYPE);
  if (envType) return envType;

  const seen = new Set();
  const scan = (value) => {
    if (value == null) return null;
    const direct = normalize(value);
    if (direct) return direct;
    if (typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);

    const keys = [
      "outputType", "output_type", "resultType", "result_type", "type", "mode", "tool", "provider",
      "kind", "category", "model", "flowType", "flow_type", "jobType", "job_type"
    ];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const found = scan(value[key]);
        if (found) return found;
      }
    }

    // Prompt/title/name fallback. Avoid scanning huge arbitrary objects too deeply.
    for (const key of ["prompt", "title", "name", "description"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const found = normalize(value[key]);
        if (found) return found;
      }
    }

    return null;
  };

  for (const arg of args) {
    const found = scan(arg);
    if (found) return found;
  }

  // Your current AutoFlow is video generation, so default to video.
  return "video";
}
// AUTO PATCH: getJobOutputType fallback END

'@

# Insert before the first function that uses it if possible; otherwise insert after imports/shebang.
if ($src -match "(?m)^\s*(async\s+)?function\s+downloadOrCaptureResult\s*\(") {
  $src = [regex]::Replace($src, "(?m)^\s*(async\s+)?function\s+downloadOrCaptureResult\s*\(", $helper + '$0', 1)
} else {
  $src = $helper + $src
}

$backup = "$WorkerPath.bak_getJobOutputType_force_$(Get-Date -Format yyyyMMdd_HHmmss)"
Copy-Item -LiteralPath $WorkerPath -Destination $backup -Force
Set-Content -LiteralPath $WorkerPath -Value $src -Encoding UTF8

Write-Host "Da backup: $backup" -ForegroundColor Cyan
Write-Host "Da chen getJobOutputType vao: $WorkerPath" -ForegroundColor Green
Write-Host "Kiem tra:" -ForegroundColor Yellow
Select-String -LiteralPath $WorkerPath -Pattern "function getJobOutputType|downloadOrCaptureResult" | Select-Object -First 8
