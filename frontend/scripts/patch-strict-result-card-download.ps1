$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Resolve-Path (Join-Path $scriptDir '..')
$workerPath = Join-Path $scriptDir 'windows-flow-worker.mjs'

if (!(Test-Path $workerPath)) {
  # when script is run from frontend\scripts after copying only patch file
  $workerPath = Join-Path (Get-Location) 'windows-flow-worker.mjs'
}
if (!(Test-Path $workerPath)) {
  throw "Không tìm thấy windows-flow-worker.mjs. Hãy chạy script trong thư mục frontend\scripts hoặc copy script vào frontend\scripts."
}

$backup = "$workerPath.bak_strict_card_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item $workerPath $backup -Force
Write-Host "Backup: $backup"

$content = Get-Content $workerPath -Raw -Encoding UTF8

$newFunction = @'
async function tryDownloadFromVideoMoreDropdown(page, savePathPrefix, jobId, outputType = 'video') {
  // STRICT MODE: chỉ thao tác trên card kết quả lớn nhất đang hiển thị.
  // Lỗi trước đây: worker quét toàn trang nên bấm nhầm nút 3 chấm/header/menu khác.
  // Logic mới:
  //   - tìm media lớn nhất: img/video/canvas
  //   - hover vào chính media/card đó để overlay hiện ra
  //   - với ảnh: ưu tiên click nút Download trên toolbar/card, không bấm 3 chấm trước
  //   - với video: ưu tiên Download nếu có, nếu không mới bấm More trong vùng card
  const attempts = Number(env.FLOW_VIDEO_MORE_MAX_ATTEMPTS || 12);
  const minY = Number(env.FLOW_VIDEO_RESULT_MIN_Y || 80);
  const hoverDelayMs = Number(env.FLOW_AFTER_RESULT_HOVER_DELAY_MS || 1000);

  const normalizedOutputType = String(outputType || 'video').toLowerCase();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const media = await page.evaluate(({ minY, normalizedOutputType }) => {
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 80 && r.height > 60 && r.bottom > 0 && r.right > 0 &&
          r.top < window.innerHeight && r.left < window.innerWidth &&
          s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0;
      };

      const mediaSelector = normalizedOutputType === 'image'
        ? 'img,canvas,video'
        : 'video,canvas,img';

      const items = Array.from(document.querySelectorAll(mediaSelector))
        .filter(visible)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          const src = el.currentSrc || el.src || el.getAttribute('src') || '';
          let score = area;

          // Bỏ thumbnail nhỏ bên phải/dưới, logo, avatar, icon.
          if (r.top < minY) score -= 1000000;
          if (area < 50000) score -= 800000;
          if (r.width < 250 || r.height < 180) score -= 500000;

          // Ảnh/video kết quả lớn thường nằm giữa/trái, không phải thumbnail rất nhỏ cạnh phải.
          if (r.left > window.innerWidth * 0.80 && area < 200000) score -= 600000;
          if (/avatar|icon|logo|profile/i.test(src)) score -= 600000;

          if (el.tagName === 'VIDEO' && normalizedOutputType === 'video') score += 50000;
          if ((el.tagName === 'IMG' || el.tagName === 'CANVAS') && normalizedOutputType === 'image') score += 50000;

          return {
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
            left: Math.round(r.left),
            top: Math.round(r.top),
            right: Math.round(r.right),
            bottom: Math.round(r.bottom),
            width: Math.round(r.width),
            height: Math.round(r.height),
            area: Math.round(area),
            tag: el.tagName,
            score,
          };
        })
        .sort((a, b) => b.score - a.score);

      return items[0] || null;
    }, { minY, normalizedOutputType }).catch(() => null);

    if (!media) {
      console.warn(`[${jobId}] Không tìm thấy media card lớn để hover, attempt=${attempt + 1}`);
      await page.waitForTimeout(1000);
      continue;
    }

    await setStatus(jobId, 'FETCHING_RESULTS', `Hover vào card kết quả ${media.tag} ${media.width}x${media.height} tại ${media.x},${media.y} để hiện nút tải.`).catch(() => null);
    await page.mouse.move(media.x, media.y);
    await page.waitForTimeout(hoverDelayMs);

    const candidates = await page.evaluate(({ media, normalizedOutputType }) => {
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 8 && r.height > 8 && r.bottom > 0 && r.right > 0 &&
          r.top < window.innerHeight && r.left < window.innerWidth &&
          s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0;
      };
      const textOf = (el) => [
        el.innerText,
        el.textContent,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-testid')
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

      const expand = 140;
      const topBand = media.top - 80;
      const bottomBand = media.top + Math.max(120, media.height * 0.22);
      const leftBand = media.left - 40;
      const rightBand = media.right + expand;

      const nodes = Array.from(document.querySelectorAll('button,[role="button"],a'))
        .filter(visible)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const label = textOf(el);
          const labelLower = label.toLowerCase();
          const inTopRightOfMedia = cx >= media.right - 180 && cx <= media.right + 140 && cy >= media.top - 90 && cy <= media.top + 130;
          const inMediaToolbar = cx >= leftBand && cx <= rightBand && cy >= topBand && cy <= bottomBand;
          const insideMedia = cx >= media.left - 10 && cx <= media.right + 10 && cy >= media.top - 10 && cy <= media.bottom + 10;

          let kind = '';
          if (/download|tải|save|export|arrow_downward|file_download/i.test(label)) kind = 'download';
          else if (/more|menu|action|option|thêm|more_vert|⋮|︙|ellipsis/i.test(label)) kind = 'more';
          else if (!label && inTopRightOfMedia && r.width <= 70 && r.height <= 70) kind = 'maybe-more';

          let score = 0;
          if (kind === 'download') score += normalizedOutputType === 'image' ? 1000 : 850;
          if (kind === 'more') score += normalizedOutputType === 'image' ? 550 : 800;
          if (kind === 'maybe-more') score += 420;
          if (inTopRightOfMedia) score += 300;
          if (inMediaToolbar) score += 220;
          if (insideMedia) score += 80;
          if (r.top < 90) score -= 1000; // tránh header/browser/topbar
          if (cx < media.left - 80 || cx > media.right + 160) score -= 600;
          if (cy > media.bottom + 80) score -= 500; // tránh thumbnail/history bên dưới

          return {
            x: Math.round(cx),
            y: Math.round(cy),
            w: Math.round(r.width),
            h: Math.round(r.height),
            label: label.slice(0, 120),
            kind,
            score,
            inTopRightOfMedia,
            inMediaToolbar,
          };
        })
        .filter((x) => x.kind && x.score > 0)
        .sort((a, b) => b.score - a.score);

      return nodes.slice(0, 10);
    }, { media, normalizedOutputType }).catch(() => []);

    console.log(`[${jobId}] STRICT result-card download candidates:`, candidates);

    for (const candidate of candidates) {
      const savePath = await waitForDownloadAfterAction(
        page,
        async () => {
          await setStatus(jobId, 'FETCHING_RESULTS', `Click nút ${candidate.kind} trên card kết quả tại ${candidate.x},${candidate.y}: ${candidate.label || '(không label)'}`).catch(() => null);
          await page.mouse.move(media.x, media.y);
          await page.waitForTimeout(250);
          await page.mouse.click(candidate.x, candidate.y);
          await page.waitForTimeout(Number(env.FLOW_AFTER_MORE_CLICK_DELAY_MS || 800));

          // Nếu đã click trực tiếp Download thì không cần chọn menu Download nữa.
          // Với ảnh, waitForDownloadAfterAction sẽ tự chọn 2K nếu menu 1K/2K/4K hiện ra.
          if (candidate.kind === 'download') return;

          await clickTextLike(page, ['Download', 'Tải xuống', 'Export', 'Save'], { required: false, timeout: 2500 }).catch(() => null);
        },
        savePathPrefix,
        jobId,
        `strict result-card ${candidate.kind} ${candidate.x},${candidate.y}`,
        { outputType: normalizedOutputType }
      );

      if (!savePath) continue;

      const ext = path.extname(savePath).toLowerCase();
      if (normalizedOutputType === 'video' && ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        console.warn(`[${jobId}] Bỏ qua download ảnh vì job cần video: ${savePath}`);
        continue;
      }
      if (normalizedOutputType === 'image' && ['.mp4', '.webm', '.mov'].includes(ext)) {
        console.warn(`[${jobId}] Bỏ qua download video vì job cần ảnh: ${savePath}`);
        continue;
      }

      return savePath;
    }

    await page.waitForTimeout(1000);
  }

  return null;
}
'@

$pattern = '(?s)async function tryDownloadFromVideoMoreDropdown\s*\([^)]*\)\s*\{.*?\n\}\s*\n\s*async function collectVideoCandidates'
if ($content -notmatch $pattern) {
  throw "Không tìm thấy hàm tryDownloadFromVideoMoreDropdown để thay. Có thể file worker đã khác cấu trúc."
}
$content = [regex]::Replace($content, $pattern, $newFunction + "`r`n`r`nasync function collectVideoCandidates", 1)

# Ensure FLOW_IMAGE_DOWNLOAD_QUALITY exists if not already present.
if ($content -notmatch 'FLOW_IMAGE_DOWNLOAD_QUALITY') {
  $needle = "const FLOW_STRICT_MODEL = String(env.FLOW_STRICT_MODEL || 'true').toLowerCase() !== 'false';"
  $insert = $needle + "`r`nconst FLOW_IMAGE_DOWNLOAD_QUALITY = String(env.FLOW_IMAGE_DOWNLOAD_QUALITY || '2K').trim().toUpperCase();"
  $content = $content.Replace($needle, $insert)
}

Set-Content -Path $workerPath -Value $content -Encoding UTF8
Write-Host "Đã patch strict hover/download theo card kết quả: $workerPath"
Write-Host "Khuyến nghị .env.local:"
Write-Host "FLOW_AFTER_RESULT_HOVER_DELAY_MS=1200"
Write-Host "FLOW_IMAGE_DOWNLOAD_QUALITY=2K"
