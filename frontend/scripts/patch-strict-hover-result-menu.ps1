param(
  [string]$WorkerPath = (Join-Path $PSScriptRoot 'windows-flow-worker.mjs')
)

if (!(Test-Path $WorkerPath)) {
  Write-Error "Không tìm thấy file worker: $WorkerPath"
  exit 1
}

$raw = Get-Content -Path $WorkerPath -Raw -Encoding UTF8

$newFunction = @'
async function tryDownloadFromVideoMoreDropdown(page, savePathPrefix, jobId, outputType = 'video') {
  const attempts = Number(env.FLOW_VIDEO_MORE_MAX_ATTEMPTS || 10);
  const hoverDelay = Number(env.FLOW_AFTER_RESULT_HOVER_DELAY_MS || 1200);
  const menuDelay = Number(env.FLOW_AFTER_MORE_CLICK_DELAY_MS || 700);

  async function locateStrictResultControls() {
    return page.evaluate(({ outputType }) => {
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return r.width > 8 && r.height > 8 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
      };
      const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
      const center = (r) => ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
      const clampRect = (r) => ({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) });
      const inRect = (r, outer, pad = 6) => r.left >= outer.left - pad && r.top >= outer.top - pad && r.right <= outer.right + pad && r.bottom <= outer.bottom + pad;
      const badText = /rename|view archive|delete|history|help|settings|translate|search|filter|profile|account|workspace|new project|create project|view tile|grid settings|google translate/i;
      const directText = /download|tải|export|save/i;
      const moreText = /more|more options|actions|menu|options|overflow|kebab|ellipsis|︙|⋮/i;

      const selectors = outputType === 'image' ? 'img,canvas,video' : 'video,img,canvas';
      const mediaEls = Array.from(document.querySelectorAll(selectors))
        .filter(visible)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          const srcText = norm(el.currentSrc || el.src || el.getAttribute?.('src') || el.getAttribute?.('data-src') || '');
          return { el, r, area, srcText };
        })
        .filter((x) => {
          if (x.r.width < 220 || x.r.height < 140) return false;
          if (x.r.top < 70) return false;
          if (x.r.left < 80) return false;
          if (x.area > window.innerWidth * window.innerHeight * 0.9) return false;
          if (/avatar|profile|favicon|icon/i.test(x.srcText)) return false;
          return true;
        })
        .sort((a, b) => b.area - a.area);

      for (const media of mediaEls) {
        let root = media.el;
        let rootRect = media.r;
        let current = media.el;
        for (let i = 0; i < 8 && current?.parentElement; i += 1) {
          const p = current.parentElement;
          if (!visible(p)) { current = p; continue; }
          const pr = p.getBoundingClientRect();
          const area = pr.width * pr.height;
          if (pr.top < 55) break;
          if (pr.width < media.r.width || pr.height < media.r.height) { current = p; continue; }
          if (area > window.innerWidth * window.innerHeight * 0.72) break;
          root = p;
          rootRect = pr;
          current = p;
        }

        const card = clampRect(rootRect);
        const cardTopBand = Math.min(120, Math.max(48, rootRect.height * 0.28));
        const cardRightStart = rootRect.left + rootRect.width * 0.56;

        const buttonCandidates = [];
        const nodes = Array.from(root.querySelectorAll('button,[role="button"],a,[aria-label],[title]'));
        for (const node of nodes) {
          const clickable = node.closest('button,[role="button"],a') || node;
          if (!visible(clickable)) continue;
          const r = clickable.getBoundingClientRect();
          if (!inRect(r, rootRect, 12)) continue;
          const text = norm(clickable.innerText || clickable.textContent || clickable.getAttribute('aria-label') || clickable.getAttribute('title') || '');
          if (badText.test(text)) continue;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          if (cx < cardRightStart) continue;
          if (cy > rootRect.top + cardTopBand) continue;
          if (r.width > 90 || r.height > 90) continue;
          if (r.width < 18 || r.height < 18) continue;
          let score = 0;
          if (directText.test(text)) score += 120;
          if (moreText.test(text)) score += 90;
          if (cx > rootRect.left + rootRect.width * 0.78) score += 35;
          if (cy < rootRect.top + rootRect.height * 0.18) score += 35;
          if (r.width <= 56 && r.height <= 56) score += 12;
          if (!text) score += 3;
          buttonCandidates.push({
            kind: directText.test(text) ? 'download' : (moreText.test(text) ? 'more' : 'other'),
            text,
            score,
            x: Math.round(cx),
            y: Math.round(cy),
            rect: clampRect(r),
          });
        }

        buttonCandidates.sort((a, b) => b.score - a.score);
        const direct = buttonCandidates.find((x) => x.kind === 'download');
        const more = buttonCandidates.find((x) => x.kind === 'more');

        return {
          card,
          mediaPoint: center(media.r),
          directDownload: direct || null,
          moreButton: more || null,
          allButtons: buttonCandidates.slice(0, 10),
        };
      }
      return null;
    }, { outputType }).catch(() => null);
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let located = await locateStrictResultControls();
    if (!located?.card) {
      await page.waitForTimeout(800);
      continue;
    }

    await setStatus(jobId, 'FETCHING_RESULTS', `Đã nhận diện card kết quả attempt ${attempt + 1}: (${located.card.left},${located.card.top}) ${located.card.width}x${located.card.height}`);

    await page.mouse.move(located.mediaPoint.x, located.mediaPoint.y);
    await page.waitForTimeout(hoverDelay);

    located = await locateStrictResultControls() || located;
    console.log(`[${jobId}] Strict card controls:`, {
      card: located.card,
      directDownload: located.directDownload,
      moreButton: located.moreButton,
      allButtons: located.allButtons,
    });

    if (located.directDownload) {
      const savePath = await waitForDownloadAfterAction(
        page,
        async () => {
          await page.mouse.click(located.directDownload.x, located.directDownload.y);
          await page.waitForTimeout(menuDelay);
        },
        savePathPrefix,
        jobId,
        `strict-card-direct-download ${located.directDownload.x},${located.directDownload.y} ${located.directDownload.text || ''}`,
        { outputType }
      );
      if (savePath) return savePath;
    }

    if (located.moreButton) {
      const savePath = await waitForDownloadAfterAction(
        page,
        async () => {
          await page.mouse.click(located.moreButton.x, located.moreButton.y);
          await page.waitForTimeout(menuDelay);
          await clickTextLike(page, ['Download', 'Tải xuống', 'Export', 'Save'], { required: false, timeout: 3000 }).catch(() => null);
        },
        savePathPrefix,
        jobId,
        `strict-card-more ${located.moreButton.x},${located.moreButton.y} ${located.moreButton.text || ''}`,
        { outputType }
      );
      if (savePath) return savePath;
    }

    await page.waitForTimeout(900);
  }

  return null;
}
'@

$pattern = 'async function tryDownloadFromVideoMoreDropdown\(page, savePathPrefix, jobId, outputType = ''video''\) \{[\s\S]*?\n\}\n\nasync function collectVideoCandidates\(page\) \{'
if ($raw -notmatch $pattern) {
  Write-Error 'Không tìm thấy hàm tryDownloadFromVideoMoreDropdown để vá.'
  exit 1
}

$replacement = $newFunction + "`r`nasync function collectVideoCandidates(page) {"
$updated = [regex]::Replace($raw, $pattern, $replacement, [System.Text.RegularExpressions.RegexOptions]::Singleline)

$backup = "$WorkerPath.bak_strict_card_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item $WorkerPath $backup -Force
Set-Content -Path $WorkerPath -Value $updated -Encoding UTF8

Write-Host "Đã vá xong: $WorkerPath"
Write-Host "Backup: $backup"
