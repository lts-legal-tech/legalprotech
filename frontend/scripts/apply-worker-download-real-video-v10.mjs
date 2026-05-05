
import fs from 'fs';
import path from 'path';

const workerPath = path.join(process.cwd(), 'scripts', 'windows-flow-worker.mjs');
if (!fs.existsSync(workerPath)) {
  console.error(`Không tìm thấy ${workerPath}. Hãy chạy script này trong thư mục frontend.`);
  process.exit(1);
}

let source = fs.readFileSync(workerPath, 'utf8');

function findFunctionRange(text, name) {
  const start = text.indexOf(`async function ${name}`);
  if (start < 0) return null;
  const brace = text.indexOf('{', start);
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return [start, i + 1];
    }
  }
  return null;
}

function findNormalFunctionRange(text, name) {
  const start = text.indexOf(`function ${name}`);
  if (start < 0) return null;
  const brace = text.indexOf('{', start);
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return [start, i + 1];
    }
  }
  return null;
}

function replaceFunction(name, body, asyncFn = true) {
  const range = asyncFn ? findFunctionRange(source, name) : findNormalFunctionRange(source, name);
  if (!range) {
    console.warn(`Không tìm thấy function ${name}, bỏ qua.`);
    return false;
  }
  source = source.slice(0, range[0]) + body.trim() + source.slice(range[1]);
  console.log(`Đã vá function ${name}`);
  return true;
}

const extractFirstMediaFromZipBytesNew = `
function extractFirstMediaFromZipBytes(zipBuffer, preferredOutputType = 'video') {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const signature = zipBuffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      const next = zipBuffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset + 1);
      if (next === -1) break;
      offset = next;
      continue;
    }

    const generalPurposeFlag = zipBuffer.readUInt16LE(offset + 6);
    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
    const extraLength = zipBuffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (nameEnd > zipBuffer.length || dataStart > zipBuffer.length || dataEnd > zipBuffer.length) break;

    const rawName = zipBuffer.slice(nameStart, nameEnd).toString('utf8');
    const safeName = path.basename(rawName || 'result').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(safeName).toLowerCase();
    if (!rawName.endsWith('/') && RESULT_MEDIA_TYPES[ext]) {
      let data = zipBuffer.slice(dataStart, dataEnd);
      if (compressionMethod === 8) data = zlib.inflateRawSync(data);
      if (compressionMethod !== 0 && compressionMethod !== 8) throw new Error(\`ZIP media compression chưa hỗ trợ: \${compressionMethod}\`);
      if (data.length) entries.push({ fileName: safeName, bytes: data, ext });
    }

    if ((generalPurposeFlag & 0x08) && compressedSize === 0) break;
    offset = dataEnd;
  }

  const videos = entries.filter((x) => ['.mp4', '.webm', '.mov'].includes(x.ext));
  const images = entries.filter((x) => ['.png', '.jpg', '.jpeg', '.webp'].includes(x.ext));
  const picked = preferredOutputType === 'image'
    ? (images[0] || videos[0] || entries[0])
    : (videos[0] || images[0] || entries[0]);

  return picked || null;
}`;

// Patch normalizeDownloadedMediaPath so ZIP extraction prefers video.
// It keeps compatibility if current function calls extractFirstMediaFromZipBytes(bytes) with one arg.
replaceFunction('extractFirstMediaFromZipBytes', extractFirstMediaFromZipBytesNew, false);

source = source.replace(
  /const extracted = extractFirstMediaFromZipBytes\(bytes\);/g,
  "const extracted = extractFirstMediaFromZipBytes(bytes, savePathPrefix.includes('image') ? 'image' : 'video');"
);

const tryDownloadFromVideoMoreDropdownNew = `
async function tryDownloadFromVideoMoreDropdown(page, savePathPrefix, jobId, outputType = 'video') {
  // Chỉ click More nằm trong card/khu vực video kết quả, tuyệt đối bỏ qua More ở thanh header/top bar.
  const attempts = Number(env.FLOW_VIDEO_MORE_MAX_ATTEMPTS || 10);
  const minY = Number(env.FLOW_VIDEO_RESULT_MIN_Y || 140);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidates = await page.evaluate(({ minY }) => {
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return r.width > 8 && r.height > 8 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const textOf = (el) => [
        el.innerText,
        el.textContent,
        el.getAttribute('aria-label'),
        el.getAttribute('title')
      ].filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim();

      const results = [];
      const videos = Array.from(document.querySelectorAll('video')).filter(visible);
      for (const video of videos) {
        const vr = video.getBoundingClientRect();
        if (vr.top < minY || vr.width < 80 || vr.height < 60) continue;

        let container = video;
        for (let i = 0; i < 7; i += 1) {
          if (!container.parentElement) break;
          const pr = container.parentElement.getBoundingClientRect();
          if (pr.width >= vr.width && pr.height >= vr.height && pr.top <= vr.top && pr.bottom >= vr.bottom) {
            container = container.parentElement;
          }
        }

        const buttons = Array.from(container.querySelectorAll('button,[role="button"],a'));
        for (const btn of buttons) {
          if (!visible(btn)) continue;
          const br = btn.getBoundingClientRect();
          if (br.top < minY) continue;
          const label = textOf(btn);
          if (!/more|more_vert|download|export|save|tải/i.test(label)) continue;
          results.push({
            x: Math.round(br.left + br.width / 2),
            y: Math.round(br.top + br.height / 2),
            label: label.slice(0, 100),
            videoTop: Math.round(vr.top),
            score: (/download|export|save|tải/i.test(label) ? 100 : 50) + Math.max(0, 1000 - Math.abs(br.top - vr.top))
          });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return results;
    }, { minY }).catch(() => []);

    console.log(\`[\${jobId}] Safe video-result More candidates:\`, candidates.slice(0, 8));

    for (const candidate of candidates) {
      const savePath = await waitForDownloadAfterAction(
        page,
        async () => {
          await page.mouse.click(candidate.x, candidate.y);
          await page.waitForTimeout(Number(env.FLOW_AFTER_MORE_CLICK_DELAY_MS || 700));

          if (/download|export|save|tải/i.test(candidate.label || '')) return;

          await clickTextLike(page, ['Download', 'Tải xuống', 'Export', 'Save'], { required: false, timeout: 2500 }).catch(() => null);
        },
        savePathPrefix,
        jobId,
        \`safe video result More \${candidate.x},\${candidate.y} \${candidate.label}\`
      );

      if (!savePath) continue;

      const ext = path.extname(savePath).toLowerCase();
      if (outputType === 'video' && ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        console.warn(\`[\${jobId}] Bỏ qua download ảnh từ More result: \${savePath}\`);
        continue;
      }

      return savePath;
    }

    await page.waitForTimeout(1000);
  }

  return null;
}`;

replaceFunction('tryDownloadFromVideoMoreDropdown', tryDownloadFromVideoMoreDropdownNew);

// Patch collectVideoCandidates guard if missing.
source = source.replace(
  /async function collectVideoCandidates\(page\) \{\n(?!\s*if \(!page)/,
  "async function collectVideoCandidates(page) {\n  if (!page || page.isClosed?.()) return [];\n"
);

// Patch the common call to pass outputType if the current file supports outputType variable.
// This remains safe even if outputType is undefined in older scope? We only patch inside downloadOrCaptureResult where it usually exists in v9.
source = source.replace(
  /tryDownloadFromVideoMoreDropdown\(page, savePathPrefix, job\.jobId\)/g,
  "tryDownloadFromVideoMoreDropdown(page, savePathPrefix, job.jobId, getJobOutputType?.(job) || 'video')"
);
source = source.replace(
  /tryDownloadFromVideoMoreDropdown\(page, savePathPrefix, job\.jobId, outputType\)/g,
  "tryDownloadFromVideoMoreDropdown(page, savePathPrefix, job.jobId, outputType)"
);

// Add a direct skip note near the error if it exists.
source = source.replace(
  /Image-to-video phải trả về video, nhưng Worker vừa tải được file không phải video:/g,
  "Image-to-video phải trả về video. Worker đã bỏ qua header/topbar More nhưng vẫn tải được file không phải video:"
);

fs.writeFileSync(workerPath, source);
console.log('DONE: đã vá worker để không tải nhầm ảnh input/header More. Hãy chạy: node --check scripts/windows-flow-worker.mjs');
