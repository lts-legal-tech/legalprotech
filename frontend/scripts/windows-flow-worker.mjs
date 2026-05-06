import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import zlib from 'zlib';
import { chromium } from 'playwright';

function loadLocalEnv() {
  for (const fileName of ['.env.local', '.env']) {
    const envPath = path.join(process.cwd(), fileName);
    if (!fsSync.existsSync(envPath)) continue;

    const raw = fsSync.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadLocalEnv();

const env = process.env;

process.on('unhandledRejection', (error) => {
  console.warn('[worker] Đã chặn unhandledRejection:', error?.message || error);
});
const API_BASE = (env.FLOW_API_BASE_URL || env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const WORKER_API_KEY = env.WORKER_API_KEY || env.FLOW_WORKER_API_KEY || '';
const WORKER_ID = env.FLOW_WORKER_ID || `windows-vps-${os.hostname()}`;
const FLOW_URL = env.FLOW_URL || 'https://labs.google/fx/tools/flow';
const FLOW_WORKER_MODE = (env.FLOW_WORKER_MODE || 'playwright').toLowerCase(); // dry-run | playwright
const POLL_INTERVAL_MS = Number(env.FLOW_WORKER_POLL_INTERVAL_MS || 3000);
const HEARTBEAT_INTERVAL_MS = Number(env.FLOW_WORKER_HEARTBEAT_INTERVAL_MS || 10000);
const CHROME_PROFILE_DIR = env.CHROME_PROFILE_DIR || path.join(process.cwd(), '.chrome-flow-profile');
const CHROME_EXECUTABLE_PATH = env.CHROME_EXECUTABLE_PATH || undefined;
const DOWNLOAD_DIR = env.FLOW_DOWNLOAD_DIR || path.join(process.cwd(), '.flow-downloads');
const FLOW_LOGIN_WAIT_MS = Number(env.FLOW_LOGIN_WAIT_MS || 600000);
const FLOW_KEEP_BROWSER_OPEN = String(env.FLOW_KEEP_BROWSER_OPEN || 'true').toLowerCase() === 'true';
const FLOW_STRICT_MODEL = String(env.FLOW_STRICT_MODEL || 'true').toLowerCase() !== 'false';
const FLOW_IMAGE_DOWNLOAD_QUALITY = String(env.FLOW_IMAGE_DOWNLOAD_QUALITY || '2K').trim().toUpperCase();
const FLOW_AFTER_CREATE_DELAY_MS = Number(env.FLOW_AFTER_CREATE_DELAY_MS || 5000);
const FLOW_CHROME_WINDOW_WIDTH = Number(env.FLOW_CHROME_WINDOW_WIDTH || 1400);
const FLOW_CHROME_WINDOW_HEIGHT = Number(env.FLOW_CHROME_WINDOW_HEIGHT || 1000);
const FLOW_BROWSER_LAUNCH_RETRIES = Math.max(1, Number(env.FLOW_BROWSER_LAUNCH_RETRIES || 2));

const FLOW_FAST_SELECTOR_MODE = String(env.FLOW_FAST_SELECTOR_MODE || 'true').toLowerCase() !== 'false';
const FLOW_FORCE_COORDINATES = String(env.FLOW_FORCE_COORDINATES || 'false').toLowerCase() === 'true';
const FLOW_COORDINATE_HELPER = String(env.FLOW_COORDINATE_HELPER || 'false').toLowerCase() === 'true';

const CHROME_PROFILE_LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort', 'BrowserMetrics-spare.pma'];

async function cleanupChromeProfileLocks(userDataDir) {
  for (const fileName of CHROME_PROFILE_LOCK_FILES) {
    await fs.rm(path.join(userDataDir, fileName), { force: true, recursive: true }).catch(() => {});
  }
}

function chromeLaunchArgs() {
  return [
    `--window-size=${FLOW_CHROME_WINDOW_WIDTH},${FLOW_CHROME_WINDOW_HEIGHT}`,
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    '--disable-sync',
    ...String(env.FLOW_CHROME_EXTRA_ARGS || '').split(/\s+/).map((x) => x.trim()).filter(Boolean),
  ];
}

async function launchFlowBrowserContext(userDataDir, ownerLabel = 'windows-flow-worker') {
  await fs.mkdir(userDataDir, { recursive: true });
  await cleanupChromeProfileLocks(userDataDir);
  let currentDir = userDataDir;
  let lastError = null;
  for (let attempt = 1; attempt <= FLOW_BROWSER_LAUNCH_RETRIES; attempt += 1) {
    try {
      console.log(`[worker] launching Chrome`, { ownerLabel, userDataDir: currentDir, attempt });
      return await chromium.launchPersistentContext(currentDir, {
        headless: false,
        executablePath: CHROME_EXECUTABLE_PATH,
        acceptDownloads: true,
        viewport: { width: FLOW_CHROME_WINDOW_WIDTH, height: FLOW_CHROME_WINDOW_HEIGHT },
        screen: { width: FLOW_CHROME_WINDOW_WIDTH, height: FLOW_CHROME_WINDOW_HEIGHT },
        args: chromeLaunchArgs(),
      });
    } catch (error) {
      lastError = error;
      console.warn(`[worker] Chrome launch failed attempt ${attempt}/${FLOW_BROWSER_LAUNCH_RETRIES}:`, error?.message || error);
      await cleanupChromeProfileLocks(currentDir);
      if (attempt === 1 && /Browser\.getWindowForTarget|Browser window not found|ProcessSingleton|profile|Singleton|DevToolsActivePort|process did exit/i.test(String(error?.message || error || ''))) {
        currentDir = `${userDataDir}-recover-${Date.now()}`;
        await fs.mkdir(currentDir, { recursive: true });
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }
  throw new Error(`Không mở được Chrome Flow. Lỗi cuối: ${lastError?.message || lastError}`);
}

function envPoint(prefix) {
  const x = Number(env[`${prefix}_X`] || 0);
  const y = Number(env[`${prefix}_Y`] || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return null;
  return { x, y };
}

async function clickEnvPoint(page, prefix, jobId, label, options = {}) {
  const point = envPoint(prefix);
  if (!point) return null;
  await setStatus(jobId, options.status || 'FLOW_COORD_CLICK', `${label}: click tọa độ ${point.x},${point.y}`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(Number(options.delayMs || 700));
  return `${prefix}:${point.x},${point.y}`;
}

async function enableCoordinateLogger(page) {
  if (!FLOW_COORDINATE_HELPER) return;
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[FLOW_COORD]')) console.log(text);
  });
  await page.evaluate(() => {
    if (window.__flowCoordHelperInstalled) return;
    window.__flowCoordHelperInstalled = true;
    document.addEventListener('click', (event) => {
      const target = event.target;
      const label = [target?.tagName, target?.innerText, target?.getAttribute?.('aria-label'), target?.getAttribute?.('placeholder')]
        .filter(Boolean)
        .join(' | ')
        .replace(/\s+/g, ' ')
        .slice(0, 160);
      console.log(`[FLOW_COORD] x=${Math.round(event.clientX)} y=${Math.round(event.clientY)} target=${label}`);
    }, true);
  }).catch(() => null);
}
const FLOW_ACCOUNT_CONFIG_PATH = env.FLOW_ACCOUNT_CONFIG_PATH || path.join(process.cwd(), '.flow-account-config.json');
const CONFIG_ACCOUNT_SECRET = env.CONFIG_ACCOUNT_SECRET || env.WORKER_API_KEY || 'legalprotech-local-dev-secret-change-me';

const DEFAULT_SAMPLE_VIDEO = 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4';
const DEFAULT_SAMPLE_IMAGE = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=80';
const RUNNING_JOB_IDS = new Set();
const FINISHED_JOB_IDS = new Set();
let CACHED_BROWSER_CONTEXT = null;


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


const RESULT_MEDIA_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function resultMimeTypeFromName(fileName, fallback = 'application/octet-stream') {
  return RESULT_MEDIA_TYPES[path.extname(String(fileName || '')).toLowerCase()] || fallback;
}

function isVideoFilePath(filePath) {
  return ['.mp4', '.webm', '.mov'].includes(path.extname(String(filePath || '')).toLowerCase());
}

function isImageFilePath(filePath) {
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(String(filePath || '')).toLowerCase());
}
function getJobOutputType(job = {}) {
  const explicit = String(job.outputType || job.resultType || job.mediaType || '').trim().toLowerCase();

  if (explicit === 'image' || explicit === 'photo' || explicit === 'picture') return 'image';
  if (explicit === 'video' || explicit === 'movie') return 'video';

  const tool = String(job.tool || job.type || job.mode || '').trim().toLowerCase();

  // BUG FIX: Check video tools FIRST before image tools to prevent 'image-to-video'
  // matching the 'image' substring check below.
  if (tool === 'image-to-video' || tool.includes('image-to-video') || tool.includes('text-to-video') || tool.includes('video')) return 'video';
  // 'my-product' is an image tool.
  if (tool === 'text-to-image' || tool === 'my-product' || tool.includes('text-to-image') || tool.includes('image-generation') || tool.includes('image') || tool.includes('photo')) return 'image';

  const product = String(
    job.product ||
    job.output ||
    job.selectedOutput ||
    job.settings?.outputType ||
    job.generationSettings?.outputType ||
    ''
  ).trim().toLowerCase();

  if (product.includes('video')) return 'video';
  if (product.includes('image') || product.includes('photo') || product.includes('ảnh')) return 'image';

  // Không fallback theo model cũ, vì model Banana/Veo còn lưu trong Flow có thể làm sai loại job.
  return 'video';
}


function isZipBytes(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function readZipEntriesFromLocalHeaders(zipBuffer) {
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

    if (nameEnd > zipBuffer.length || dataStart > zipBuffer.length) break;

    const rawName = zipBuffer.slice(nameStart, nameEnd).toString('utf8');
    const safeName = path.basename(rawName || 'result').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(safeName).toLowerCase();
    const canReadPayload = compressedSize > 0 && dataEnd <= zipBuffer.length;

    if (!rawName.endsWith('/') && RESULT_MEDIA_TYPES[ext] && canReadPayload) {
      let data = zipBuffer.slice(dataStart, dataEnd);
      if (compressionMethod === 8) data = zlib.inflateRawSync(data);
      if (compressionMethod !== 0 && compressionMethod !== 8) throw new Error(`ZIP media compression chưa hỗ trợ: ${compressionMethod}`);
      if (data.length) entries.push({ fileName: safeName, bytes: data, ext });
    }

    // ZIP có data descriptor thường để size = 0 ở local header.
    // Khi gặp dạng này, chuyển sang đọc central directory thay vì kết luận lỗi.
    if ((generalPurposeFlag & 0x08) || compressedSize === 0) break;
    offset = dataEnd;
  }
  return entries;
}

function readZipEntriesFromCentralDirectory(zipBuffer) {
  const entries = [];
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const minSearch = Math.max(0, zipBuffer.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= minSearch; i -= 1) {
    if (zipBuffer[i] === eocdSignature[0] && zipBuffer.slice(i, i + 4).equals(eocdSignature)) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0 || eocdOffset + 22 > zipBuffer.length) return entries;

  const entryCount = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  let offset = centralOffset;

  for (let i = 0; i < entryCount && offset + 46 <= zipBuffer.length; i += 1) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) break;

    const compressionMethod = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;

    if (nameEnd > zipBuffer.length || localHeaderOffset + 30 > zipBuffer.length) break;

    const rawName = zipBuffer.slice(nameStart, nameEnd).toString('utf8');
    const safeName = path.basename(rawName || 'result').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(safeName).toLowerCase();

    if (!rawName.endsWith('/') && RESULT_MEDIA_TYPES[ext]) {
      const localNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd <= zipBuffer.length) {
        let data = zipBuffer.slice(dataStart, dataEnd);
        if (compressionMethod === 8) data = zlib.inflateRawSync(data);
        if (compressionMethod !== 0 && compressionMethod !== 8) throw new Error(`ZIP media compression chưa hỗ trợ: ${compressionMethod}`);
        if (data.length) entries.push({ fileName: safeName, bytes: data, ext });
      }
    }

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function extractFirstMediaFromZipBytes(zipBuffer, preferredOutputType = 'video') {
  const entries = [
    ...readZipEntriesFromLocalHeaders(zipBuffer),
    ...readZipEntriesFromCentralDirectory(zipBuffer),
  ];
  const uniqueEntries = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.fileName}:${entry.bytes.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueEntries.push(entry);
  }

  const videos = uniqueEntries.filter((x) => ['.mp4', '.webm', '.mov'].includes(x.ext));
  const images = uniqueEntries.filter((x) => ['.png', '.jpg', '.jpeg', '.webp'].includes(x.ext));
  const picked = preferredOutputType === 'image'
    ? (images[0] || videos[0] || uniqueEntries[0])
    : (videos[0] || images[0] || uniqueEntries[0]);

  return picked || null;
}

async function normalizeDownloadedMediaPath(filePath, jobId, savePathPrefix, preferredOutputType = 'video') {
  const bytes = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (isZipBytes(bytes) || ext === '.zip') {
    const extracted = extractFirstMediaFromZipBytes(bytes, preferredOutputType);
    if (!extracted) throw new Error(`Worker tải được ZIP nhưng không tìm thấy MP4/WebM/MOV/ảnh bên trong: ${filePath}`);
    const outputPath = path.join(DOWNLOAD_DIR, `${savePathPrefix}-extracted-${extracted.fileName}`);
    await fs.writeFile(outputPath, extracted.bytes);
    console.log(`[${jobId}] Download là ZIP, đã tách file media thật: ${outputPath}`);
    return outputPath;
  }

  if (!RESULT_MEDIA_TYPES[ext]) {
    throw new Error(`File tải về không phải media hợp lệ (${path.basename(filePath)}). Không upload lên web để tránh file lỗi.`);
  }

  return filePath;
}

function headers(extra = {}) {
  return {
    ...extra,
    ...(WORKER_API_KEY ? { 'x-worker-key': WORKER_API_KEY } : {}),
  };
}

async function apiJson(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: headers(options.headers || {}),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `API ${url} failed: ${response.status}`);
  }
  return data;
}

async function claimJob() {
  const data = await apiJson('/api/internal/worker/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId: WORKER_ID }),
  });
  return data.job || null;
}

async function heartbeat(jobId, message) {
  return apiJson(`/api/internal/worker/jobs/${encodeURIComponent(jobId)}/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId: WORKER_ID, message }),
  }).catch((error) => console.warn(`[heartbeat] ${error.message}`));
}

async function setStatus(jobId, status, message, extra = {}) {
  console.log(`[${jobId}] ${status} - ${message}`);
  return apiJson(`/api/internal/worker/jobs/${encodeURIComponent(jobId)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, message, workerId: WORKER_ID, extra }),
  });
}

async function failJob(jobId, error) {
  console.error(`[${jobId}] FAILED`, error);
  return apiJson(`/api/internal/worker/jobs/${encodeURIComponent(jobId)}/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId: WORKER_ID, error: error?.stack || error?.message || String(error) }),
  }).catch((apiError) => console.error(`[${jobId}] fail report error`, apiError));
}

async function appendExternalResults(job, results, complete = true) {
  return apiJson(`/api/internal/worker/jobs/${encodeURIComponent(job.jobId)}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      complete,
      message: complete ? 'Windows VPS Worker đã hoàn tất AutoFlow.' : 'Worker đã cập nhật kết quả.',
      results,
      jobSnapshot: job,
    }),
  });
}

async function uploadResultFile(job, filePath, { prompt = '', promptIndex = 0, complete = false } = {}) {
  const bytes = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const mimeType = resultMimeTypeFromName(fileName, 'video/mp4');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), fileName);
  form.append('prompt', prompt);
  form.append('promptIndex', String(promptIndex));
  form.append('duration', String(job.duration || 8));
  form.append('aspectRatio', job.aspectRatio || '16:9');
  form.append('complete', complete ? 'true' : 'false');
  form.append('jobSnapshot', JSON.stringify(job));

  const response = await fetch(`${API_BASE}/api/internal/worker/jobs/${encodeURIComponent(job.jobId)}/result`, {
    method: 'POST',
    headers: headers(),
    body: form,
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!response.ok) throw new Error(data?.error || `Upload result failed: ${response.status}`);
  return data;
}

function parseSelectorList(value, fallback = '') {
  return String(value || fallback)
    .split('||')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function clickFirst(page, selectors, options = {}) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: options.timeout || 4000 });
      await locator.click({ timeout: options.timeout || 4000 });
      return selector;
    } catch {
      // try next selector
    }
  }
  if (options.required !== false) throw new Error(`Không tìm thấy nút: ${selectors.join(' || ')}`);
  return null;
}

async function fillFirst(page, selectors, value, options = {}) {
  const timeout = options.timeout || 5000;
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });
      await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => null);
      await locator.click({ timeout }).catch(() => null);
      try {
        await locator.fill(value, { timeout });
      } catch {
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
        await page.keyboard.type(value, { delay: 5 });
      }
      return selector;
    } catch {
      // try next selector
    }
  }

  throw new Error(`Không tìm thấy ô nhập hợp lệ: ${selectors.join(' || ')}`);
}

async function findVisibleSelector(page, selectors, timeout = 1000) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });
      return selector;
    } catch {
      // try next
    }
  }
  return null;
}

async function findVisibleSelectorStrict(page, selectors, timeout = 1000) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });
      return selector;
    } catch {
      // try next selector
    }
  }
  return null;
}

async function hasVideoCandidateNow(page) {
  try {
    return await page.evaluate(() => {
      const urls = [];
      const push = (value) => {
        if (!value) return;
        const text = String(value);
        if (/^(blob:|https?:|data:video\/)/i.test(text) || /\.mp4(\?|$)/i.test(text)) urls.push(text);
      };
      for (const video of Array.from(document.querySelectorAll('video'))) {
        const rect = video.getBoundingClientRect();
        const style = window.getComputedStyle(video);
        const visible = rect.width > 20 && rect.height > 20 && style.display !== 'none' && style.visibility !== 'hidden';
        push(video.currentSrc || video.src);
        for (const source of Array.from(video.querySelectorAll('source'))) push(source.src);
        if (visible && (video.currentSrc || video.src || video.readyState >= 1)) return true;
      }
      for (const a of Array.from(document.querySelectorAll('a[href]'))) push(a.href);
      for (const source of Array.from(document.querySelectorAll('source[src]'))) push(source.src);
      return urls.some((url) => /^(blob:|https?:|data:video\/)/i.test(url) || /\.mp4(\?|$)/i.test(url));
    });
  } catch {
    return false;
  }
}



async function detectFlowComposer(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 8 && rect.height > 8;
    };
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), area: r.width * r.height };
    };
    const textOf = (el) => norm([
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('aria-placeholder'),
      el.getAttribute('data-placeholder'),
      el.getAttribute('title'),
      el.innerText,
      el.textContent,
    ].filter(Boolean).join(' '));
    const bodyText = norm(document.body?.innerText || '');
    const startOnly = /Start creating or drop media/i.test(bodyText) && !/What do you want to create\?/i.test(bodyText);

    const editableSelectors = 'textarea,[role="textbox"],[contenteditable="true"],input[type="text"],input:not([type]),[placeholder],[aria-placeholder],[data-placeholder]';
    const editables = Array.from(document.querySelectorAll(editableSelectors)).filter(isVisible).map((el) => {
      const rect = rectOf(el);
      const text = textOf(el);
      const tag = el.tagName;
      const role = el.getAttribute('role') || '';
      const type = el.getAttribute('type') || '';
      return { el, rect, text, tag, role, type };
    });

    const promptEditable = editables.find((x) => {
      const t = x.text.toLowerCase();
      if (/search|filter|sort|email|password|login|sign in|đăng nhập/i.test(t) || /email|password|search/i.test(x.type)) return false;
      if (x.rect.top < window.innerHeight * 0.45) return false;
      if (x.rect.area > window.innerWidth * window.innerHeight * 0.45) return false;
      return /what do you want to create\?|prompt|describe|description|mô tả|ý tưởng|nhập/i.test(t);
    });

    const labelNodes = Array.from(document.querySelectorAll('span,p,label,div')).filter(isVisible).map((el) => ({ el, rect: rectOf(el), text: textOf(el), tag: el.tagName }));
    const promptLabel = labelNodes.find((x) => {
      if (!/What do you want to create\?/i.test(x.text)) return false;
      // Không nhận parent container/toolbar quá lớn làm prompt.
      if (x.rect.top < window.innerHeight * 0.45) return false;
      if (x.text.length > 220) return false;
      if (x.rect.area > 900 * 180) return false;
      if (x.rect.w > Math.min(window.innerWidth * 0.85, 950)) return false;
      return true;
    });

    const ready = Boolean((promptEditable || promptLabel) && !startOnly);
    const chosen = promptEditable || promptLabel;
    return {
      ready,
      hasPromptQuestion: Boolean(promptLabel || /what do you want to create\?/i.test(promptEditable?.text || '')),
      hasTextboxNode: Boolean(promptEditable),
      onlyStartCreating: startOnly,
      bodyText: bodyText.slice(0, 500),
      promptText: (chosen?.text || '').slice(0, 180),
      promptRect: chosen?.rect || null,
    };
  }).catch(() => ({ ready: false }));
}

async function findFlowPromptPoint(page) {
  const fromEnv = envPoint('FLOW_PROMPT_CLICK');
  if (fromEnv && FLOW_FORCE_COORDINATES) return fromEnv;

  const found = await page.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 20 && rect.height > 10;
    };
    const textOf = (el) => norm([
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('aria-placeholder'),
      el.getAttribute('data-placeholder'),
      el.getAttribute('title'),
      el.innerText,
      el.textContent,
    ].filter(Boolean).join(' '));

    const editables = Array.from(document.querySelectorAll('textarea,[role="textbox"],[contenteditable="true"],input[type="text"],input:not([type]),[placeholder],[aria-placeholder],[data-placeholder]'))
      .filter(isVisible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, r, text: textOf(el), type: el.getAttribute('type') || '' };
      })
      .filter((x) => {
        if (/email|password|search/i.test(x.type)) return false;
        if (/search|filter|sort|email|password|login|sign in|đăng nhập/i.test(x.text)) return false;
        if (x.r.top < window.innerHeight * 0.45) return false;
        if (x.r.width * x.r.height > window.innerWidth * window.innerHeight * 0.45) return false;
        return /what do you want to create\?|prompt|describe|description|mô tả|ý tưởng|nhập/i.test(x.text);
      })
      .sort((a, b) => (b.r.width * b.r.height) - (a.r.width * a.r.height));

    if (editables[0]) {
      const { el, r, text } = editables[0];
      el.scrollIntoView({ block: 'center', inline: 'center' });
      return { x: Math.round(r.left + Math.min(Math.max(r.width * 0.20, 24), r.width / 2)), y: Math.round(r.top + r.height / 2), source: text.slice(0, 100) };
    }

    const labels = Array.from(document.querySelectorAll('span,p,label,div')).filter(isVisible).map((el) => ({ el, r: el.getBoundingClientRect(), text: textOf(el) }))
      .filter((x) => /What do you want to create\?/i.test(x.text) && x.r.top > window.innerHeight * 0.45 && x.text.length <= 220 && (x.r.width * x.r.height) < 900 * 180)
      .sort((a, b) => b.r.top - a.r.top);

    if (labels[0]) {
      const { el, r, text } = labels[0];
      const clickable = el.closest('[role="textbox"],[contenteditable="true"],textarea,input,button,[role="button"]') || el;
      const cr = clickable.getBoundingClientRect();
      return { x: Math.round(cr.left + Math.min(Math.max(cr.width * 0.20, 24), cr.width / 2)), y: Math.round(cr.top + cr.height / 2), source: text.slice(0, 100) };
    }

    return null;
  }).catch(() => null);
  if (found?.x && found?.y) return found;

  const viewport = page.viewportSize() || { width: 1365, height: 768 };
  return { x: Math.round(viewport.width * 0.39), y: Math.round(viewport.height * 0.92), source: 'fallback-bottom-prompt' };
}

async function clickAndTypeFlowPrompt(page, prompt, jobId) {
  const point = await findFlowPromptPoint(page);
  await setStatus(jobId, 'SUBMITTING_PROMPT', `Worker click ô prompt Flow tại ${point.x},${point.y}${point.source ? ` (${point.source})` : ''}.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(350);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
  await page.keyboard.type(prompt, { delay: 5 });
  await page.waitForTimeout(500);
  return `flow-composer-coordinate:${point.x},${point.y}`;
}

async function clickFlowGenerateArrow(page, jobId) {
  const fromEnv = envPoint('FLOW_GENERATE_CLICK');
  if (fromEnv) {
    await setStatus(jobId, 'GENERATING', `Worker bấm nút Generate theo tọa độ ${fromEnv.x},${fromEnv.y}.`);
    await page.mouse.click(fromEnv.x, fromEnv.y);
    return `coordinate:${fromEnv.x},${fromEnv.y}`;
  }

  const clicked = await page.evaluate(() => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 20 && rect.height > 20;
    };
    const candidates = Array.from(document.querySelectorAll('button,[role="button"]')).filter(isVisible);
    const scored = candidates.map((el) => {
      const rect = el.getBoundingClientRect();
      const text = String(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
      let score = 0;
      if (/Generate|Create|Run|Submit|Tạo/i.test(text)) score += 50;
      if (/Video\s*x\d/i.test(text)) score += 30;
      if (rect.left > window.innerWidth * 0.55 && rect.top > window.innerHeight * 0.65) score += 25;
      if (rect.width >= 35 && rect.width <= 90 && rect.height >= 35 && rect.height <= 90) score += 10;
      return { el, rect, text, score };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score >= 25) {
      best.el.click();
      return { x: Math.round(best.rect.left + best.rect.width / 2), y: Math.round(best.rect.top + best.rect.height / 2), text: best.text.slice(0, 80), score: best.score };
    }
    return null;
  }).catch(() => null);
  if (clicked) {
    await setStatus(jobId, 'GENERATING', `Worker bấm nút Generate trên Flow: ${clicked.text || ''} tại ${clicked.x},${clicked.y}.`);
    return `dom-generate:${clicked.x},${clicked.y}`;
  }

  const viewport = page.viewportSize() || { width: 1365, height: 768 };
  const point = { x: Math.round(viewport.width * 0.77), y: Math.round(viewport.height * 0.97) };
  await setStatus(jobId, 'GENERATING', `Không thấy nút Generate, Worker thử bấm mũi tên góc dưới phải tại ${point.x},${point.y}.`);
  await page.mouse.click(point.x, point.y);
  return `fallback-generate-arrow:${point.x},${point.y}`;
}

async function clickTextLike(page, labels, options = {}) {
  const items = Array.isArray(labels) ? labels.filter(Boolean) : [labels].filter(Boolean);
  const timeout = options.timeout || 2500;
  for (const label of items) {
    const attempts = [
      () => page.getByText(label, { exact: false }).first().click({ timeout }),
      () => page.locator(`text=/${String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/i`).first().click({ timeout }),
      () => page.locator(`button:has-text("${String(label).replace(/"/g, '\\"')}")`).first().click({ timeout }),
      () => page.locator(`[role="button"]:has-text("${String(label).replace(/"/g, '\\"')}")`).first().click({ timeout }),
      () => page.locator(`[role="option"]:has-text("${String(label).replace(/"/g, '\\"')}")`).first().click({ timeout }),
    ];
    for (const attempt of attempts) {
      try {
        await attempt();
        return `text-like:${label}`;
      } catch {
        // try next
      }
    }
  }

  const clicked = await page.evaluate(({ items }) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 3 && rect.height > 3;
    };
    const candidates = Array.from(document.querySelectorAll('button,a,[role="button"],[role="option"],[role="combobox"],li,div,span'));
    for (const label of items) {
      const needle = norm(label);
      if (!needle) continue;
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
        if (!text || !text.includes(needle)) continue;
        const clickable = el.closest('button,a,[role="button"],[role="option"],[role="combobox"]') || el;
        clickable.scrollIntoView({ block: 'center', inline: 'center' });
        clickable.click();
        return { label, text: text.slice(0, 120) };
      }
    }
    return null;
  }, { items }).catch(() => null);

  if (clicked) return `dom-text:${clicked.label}`;
  if (options.required !== false) throw new Error(`Không tìm thấy text để bấm: ${items.join(' | ')}`);
  return null;
}


async function clickFlowImageDownloadQuality(page, jobId, preferredQuality = FLOW_IMAGE_DOWNLOAD_QUALITY) {
  const preferred = String(preferredQuality || '2K').trim().toUpperCase();
  const qualityMap = {
    '1K': ['1K', '1K Original size', 'Original size'],
    '2K': ['2K', '2K Upscaled'],
    '4K': ['4K', '4K Upscaled'],
  };
  const order = preferred === '4K' ? ['4K', '2K', '1K'] : preferred === '1K' ? ['1K', '2K', '4K'] : ['2K', '1K', '4K'];

  for (const key of order) {
    const labels = qualityMap[key] || [key];
    const clickedText = await clickTextLike(page, labels, {
      required: false,
      timeout: Number(env.FLOW_IMAGE_DOWNLOAD_QUALITY_TIMEOUT_MS || 2500),
    }).catch(() => null);
    if (clickedText) {
      await setStatus(jobId, 'FETCHING_RESULTS', `Đã chọn chất lượng tải ảnh: ${key}.`);
      await page.waitForTimeout(Number(env.FLOW_AFTER_QUALITY_CLICK_DELAY_MS || 500));
      return key;
    }

    const clickedDom = await page.evaluate(({ labels }) => {
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 8 && r.height > 8 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const wanted = labels.map((label) => norm(label));
      const nodes = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"],li,div,span'));
      for (const el of nodes) {
        if (!visible(el)) continue;
        const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
        if (!text) continue;
        if (!wanted.some((needle) => text.includes(needle))) continue;
        const clickable = el.closest('button,[role="button"],[role="menuitem"],li') || el;
        const rect = clickable.getBoundingClientRect();
        clickable.click();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), text: text.slice(0, 120) };
      }
      return null;
    }, { labels }).catch(() => null);

    if (clickedDom) {
      await setStatus(jobId, 'FETCHING_RESULTS', `Đã chọn chất lượng tải ảnh: ${key} (${clickedDom.text}).`);
      await page.waitForTimeout(Number(env.FLOW_AFTER_QUALITY_CLICK_DELAY_MS || 500));
      return key;
    }
  }

  throw new Error(`Đã bấm tải ảnh nhưng không thấy menu chọn chất lượng ${preferred}/1K/2K/4K.`);
}

async function clickFirstRobust(page, selectors, labels = [], options = {}) {
  const clickedSelector = await clickFirst(page, selectors, { required: false, timeout: options.timeout || 3000 }).catch(() => null);
  if (clickedSelector) return clickedSelector;
  const clickedText = await clickTextLike(page, labels, { required: false, timeout: options.timeout || 2500 }).catch(() => null);
  if (clickedText) return clickedText;
  if (options.required !== false) throw new Error(`Không tìm thấy nút/selectors: ${selectors.join(' || ')} / labels: ${labels.join(', ')}`);
  return null;
}

async function fillPromptByDom(page, value) {
  return page.evaluate(({ value }) => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 20 && rect.height > 15;
    };
    const score = (el) => {
      const attrs = [
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        el.getAttribute('aria-placeholder'),
        el.getAttribute('data-placeholder'),
        el.getAttribute('title'),
        el.innerText,
        el.textContent,
      ].filter(Boolean).join(' ').toLowerCase();
      let s = 0;
      if (/search|filter|sort|email|password|login|sign in|đăng nhập/i.test(attrs)) return -9999;
      if (/prompt|describe|description|type|enter|idea|scene|video|image|mô tả|nhập|ý tưởng|what do you want to create/i.test(attrs)) s += 10;
      if (el.matches('textarea')) s += 8;
      if (el.matches('[role="textbox"]')) s += 8;
      if (el.matches('[contenteditable="true"]')) s += 7;
      if (el.matches('input[type="text"], input:not([type])')) s += 5;
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.45) return -9999;
      if (r.width > 250) s += 3;
      if (r.height > 50) s += 3;
      s += Math.min(10, (r.top / window.innerHeight) * 10);
      return s;
    };
    const candidates = Array.from(document.querySelectorAll('textarea,[role="textbox"],[contenteditable="true"],input[type="text"],input:not([type]),[data-placeholder],[aria-placeholder]'))
      .filter((el) => isVisible(el) && !/password|email|search/i.test(el.getAttribute('type') || '') && score(el) > 0)
      .sort((a, b) => score(b) - score(a));
    const el = candidates[0];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus();
    el.click();
    if (el.matches('textarea,input')) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { method: 'dom-value', tag: el.tagName, score: score(el) };
    }
    el.textContent = '';
    document.execCommand('insertText', false, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    return { method: 'dom-contenteditable', tag: el.tagName, score: score(el) };
  }, { value }).catch(() => null);
}

async function fillPromptRobust(page, selectors, prompt, jobId) {
  if (FLOW_FORCE_COORDINATES && envPoint('FLOW_PROMPT_CLICK')) {
    const clicked = await clickEnvPoint(page, 'FLOW_PROMPT_CLICK', jobId, 'Nhập prompt theo tọa độ', { status: 'SUBMITTING_PROMPT', delayMs: 350 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
    await page.keyboard.type(prompt, { delay: 5 });
    return clicked;
  }

  const direct = await fillFirst(page, selectors, prompt, { timeout: Number(env.FLOW_PROMPT_FILL_TIMEOUT_MS || 4500) }).catch(() => null);
  if (direct) return direct;

  const domFilled = await fillPromptByDom(page, prompt);
  if (domFilled) {
    await setStatus(jobId, 'SUBMITTING_PROMPT', `Đã nhập prompt bằng DOM fallback: ${domFilled.method}`);
    return domFilled.method;
  }

  const composer = await detectFlowComposer(page);
  if (composer?.ready) {
    return clickAndTypeFlowPrompt(page, prompt, jobId);
  }

  const viewport = page.viewportSize() || { width: 1365, height: 768 };
  const point = envPoint('FLOW_PROMPT_CLICK') || { x: Math.round(viewport.width * 0.39), y: Math.round(viewport.height * 0.92) };
  await setStatus(jobId, 'WAITING_PROMPT_FOCUS', `Chưa tìm được ô prompt bằng selector. Worker thử click vùng nhập tại ${point.x},${point.y}.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(400);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
  await page.keyboard.type(prompt, { delay: 5 });
  return `coordinate:${point.x},${point.y}`;
}

async function maybeSelectByLabels(page, jobId, title, openLabels, optionLabels) {
  if (!optionLabels?.length) return null;
  await clickTextLike(page, openLabels, { required: false, timeout: 1800 }).catch(() => null);
  await page.waitForTimeout(500);
  const clicked = await clickTextLike(page, optionLabels, { required: false, timeout: 2200 }).catch(() => null);
  if (clicked) {
    await setStatus(jobId, 'SETTING_FLOW', `Đã chọn ${title}: ${optionLabels[0]}`);
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(500);
    return clicked;
  }
  return null;
}

async function applyFlowSettingsRobust(page, jobId, job) {
  if (String(env.FLOW_SKIP_SETTINGS || 'false').toLowerCase() === 'true') {
    await setStatus(jobId, 'SETTING_FLOW', 'Bỏ qua setting Flow theo FLOW_SKIP_SETTINGS=true.');
    return;
  }

  // BUG FIX: Skip model selection if caller already did it (to avoid double-selection).
  const modelAlreadySelected = Boolean(job.__modelAlreadySelected);

  if (!modelAlreadySelected) {
    if (FLOW_FORCE_COORDINATES) {
      await clickEnvPoint(page, 'FLOW_MODEL_CLICK', jobId, 'Mở model theo tọa độ', { status: 'SETTING_MODEL' }).catch(() => null);
      await clickEnvPoint(page, 'FLOW_MODEL_OPTION_CLICK', jobId, 'Chọn model option theo tọa độ', { status: 'SETTING_MODEL' }).catch(() => null);
    }

    if (!FLOW_FORCE_COORDINATES) {
      if (FLOW_STRICT_MODEL) {
        await maybeSelectFlowModel(page, jobId, job);
      } else {
        await maybeSelectFlowModel(page, jobId, job).catch(() => null);
      }
    }
  }

  const aspect = String(job.aspectRatio || env.FLOW_DEFAULT_ASPECT_RATIO || '').trim();
  if (aspect) {
    if (FLOW_FORCE_COORDINATES) {
      await clickEnvPoint(page, 'FLOW_ASPECT_CLICK', jobId, 'Mở tỷ lệ khung hình theo tọa độ', { status: 'SETTING_FLOW' }).catch(() => null);
      await clickEnvPoint(page, 'FLOW_ASPECT_OPTION_CLICK', jobId, 'Chọn tỷ lệ khung hình theo tọa độ', { status: 'SETTING_FLOW' }).catch(() => null);
    }
    if (!FLOW_FORCE_COORDINATES) {
      await maybeSelectByLabels(page, jobId, 'tỷ lệ khung hình', ['Aspect', 'Ratio', 'Format', 'Landscape', 'Portrait', 'Square'], [aspect, aspect.replace(':', ' : ')]).catch(() => null);
    }
  }

  const duration = String(job.duration || env.FLOW_DEFAULT_DURATION || '').trim();
  if (duration) {
    if (FLOW_FORCE_COORDINATES) {
      await clickEnvPoint(page, 'FLOW_DURATION_CLICK', jobId, 'Mở thời lượng theo tọa độ', { status: 'SETTING_FLOW' }).catch(() => null);
      await clickEnvPoint(page, 'FLOW_DURATION_OPTION_CLICK', jobId, 'Chọn thời lượng theo tọa độ', { status: 'SETTING_FLOW' }).catch(() => null);
    }
    if (!FLOW_FORCE_COORDINATES) {
      const durationLabels = [`${duration}s`, `${duration} s`, `${duration} seconds`, `${duration} giây`];
      await maybeSelectByLabels(page, jobId, 'thời lượng', ['Duration', 'Length', 'Seconds', 'Time'], durationLabels).catch(() => null);
    }
  }

  const videosPerPrompt = Math.max(1, Math.min(Number(job.videosPerPrompt || env.FLOW_VIDEOS_PER_PROMPT || 1), 4));
  if (videosPerPrompt) {
    if (FLOW_FORCE_COORDINATES) {
      await clickEnvPoint(page, 'FLOW_COUNT_CLICK', jobId, 'Mở số lượng video/prompt theo tọa độ', { status: 'SETTING_FLOW' }).catch(() => null);
      await clickEnvPoint(page, 'FLOW_COUNT_OPTION_CLICK', jobId, 'Chọn số lượng video/prompt theo tọa độ', { status: 'SETTING_FLOW' }).catch(() => null);
    }
    if (!FLOW_FORCE_COORDINATES) {
      const countLabels = [`x${videosPerPrompt}`, `×${videosPerPrompt}`, `${videosPerPrompt} video`, `${videosPerPrompt}`];
      await maybeSelectByLabels(page, jobId, 'số video/prompt', ['Outputs', 'Output', 'Videos', 'Video', 'Count', 'x1', 'x2', 'x3', 'x4'], countLabels).catch(() => null);
    }
  }
}

async function clickGenerateRobust(page, generateSelectors, jobId) {
  if (FLOW_FORCE_COORDINATES && envPoint('FLOW_GENERATE_CLICK')) {
    return clickEnvPoint(page, 'FLOW_GENERATE_CLICK', jobId, 'Bấm Generate theo tọa độ', { status: 'GENERATING', delayMs: 500 });
  }

  const clicked = await clickFirstRobust(
    page,
    generateSelectors,
    ['Generate', 'Create', 'Submit', 'Run', 'Tạo', 'Tạo video', 'Generate video'],
    { required: false, timeout: 5000 }
  );
  if (clicked) return clicked;

  const composer = await detectFlowComposer(page);
  if (composer?.ready) {
    return clickFlowGenerateArrow(page, jobId);
  }

  const viewport = page.viewportSize() || { width: 1365, height: 768 };
  const point = envPoint('FLOW_GENERATE_CLICK') || { x: Math.round(viewport.width * 0.77), y: Math.round(viewport.height * 0.97) };
  await setStatus(jobId, 'GENERATING', `Không thấy nút Generate bằng selector, Worker thử click tọa độ ${point.x},${point.y}.`);
  await page.mouse.click(point.x, point.y);
  return `coordinate:${point.x},${point.y}`;
}

function flowAccountKeyBuffer() {
  return crypto.createHash('sha256').update(CONFIG_ACCOUNT_SECRET).digest();
}

function decryptFlowSecret(value) {
  if (!value) return '';
  const parts = String(value).split('.');
  if (parts.length !== 3) return '';
  const [ivBase64, tagBase64, encryptedBase64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', flowAccountKeyBuffer(), Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function loadFlowAccountConfig() {
  const emailFromEnv = env.GOOGLE_ULTRA_EMAIL || env.FLOW_GOOGLE_EMAIL || '';
  const passwordFromEnv = env.GOOGLE_ULTRA_PASSWORD || env.FLOW_GOOGLE_PASSWORD || '';
  if (emailFromEnv && passwordFromEnv) {
    return {
      email: emailFromEnv,
      password: passwordFromEnv,
      autoLoginEnabled: String(env.FLOW_AUTO_LOGIN_ENABLED || 'true').toLowerCase() !== 'false',
      source: 'env',
    };
  }

  try {
    const raw = await fs.readFile(FLOW_ACCOUNT_CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw);
    const password = decryptFlowSecret(config.passwordEncrypted || '');
    return {
      email: config.email || '',
      password,
      autoLoginEnabled: config.autoLoginEnabled !== false,
      source: FLOW_ACCOUNT_CONFIG_PATH,
    };
  } catch {
    return { email: '', password: '', autoLoginEnabled: false, source: 'none' };
  }
}

async function maybeClickGoogleSignIn(page) {
  const signInSelectors = parseSelectorList(
    env.FLOW_SIGN_IN_SELECTOR,
    'a:has-text("Sign in")||button:has-text("Sign in")||text=/Sign in|Đăng nhập/i'
  );
  return clickFirst(page, signInSelectors, { required: false, timeout: 2500 }).catch(() => null);
}

async function maybeAutoLoginGoogle(page, jobId) {
  if (String(env.FLOW_AUTO_LOGIN_ENABLED || 'true').toLowerCase() === 'false') return false;
  const account = await loadFlowAccountConfig();
  if (!account.autoLoginEnabled || !account.email || !account.password) return false;

  const emailSelectors = parseSelectorList(
    env.GOOGLE_EMAIL_SELECTOR,
    'input[type="email"]||input#identifierId||input[name="identifier"]'
  );
  const passwordSelectors = parseSelectorList(
    env.GOOGLE_PASSWORD_SELECTOR,
    'input[type="password"]||input[name="Passwd"]'
  );
  const nextSelectors = parseSelectorList(
    env.GOOGLE_NEXT_SELECTOR,
    '#identifierNext button||#passwordNext button||button:has-text("Next")||text=/Next|Tiếp theo/i'
  );

  let attempted = false;
  const emailSelector = await findVisibleSelectorStrict(page, emailSelectors, 2500);
  if (emailSelector) {
    attempted = true;
    await setStatus(jobId, 'AUTO_LOGIN_EMAIL', `Đã thấy màn hình Google Login. Worker đang điền email từ ${account.source}.`);
    await fillFirst(page, emailSelectors, account.email, { timeout: 8000 });
    await clickFirst(page, nextSelectors, { required: false, timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(Number(env.GOOGLE_AFTER_EMAIL_DELAY_MS || 4500));
  }

  const passwordSelector = await findVisibleSelectorStrict(page, passwordSelectors, 6000);
  if (passwordSelector) {
    attempted = true;
    await setStatus(jobId, 'AUTO_LOGIN_PASSWORD', 'Worker đang điền mật khẩu Google đã lưu.');
    await fillFirst(page, passwordSelectors, account.password, { timeout: 8000 });
    await clickFirst(page, nextSelectors, { required: false, timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(Number(env.GOOGLE_AFTER_PASSWORD_DELAY_MS || 8000));
  }

  if (attempted) {
    await setStatus(
      jobId,
      'WAITING_LOGIN_VERIFY',
      'Worker đã tự điền tài khoản Google. Nếu Google yêu cầu captcha, 2FA hoặc xác minh bất thường, vui lòng xử lý thủ công trong Chrome Worker.'
    );
  }

  return attempted;
}

async function waitForFlowPromptOrManualLogin(page, jobId, promptSelectors) {
  // Không dùng findVisibleSelector() ở đây nữa vì hàm đó có fallback role=textbox,
  // dễ nhận nhầm search box/toolbar là ô prompt thật.
  const composerNow = await detectFlowComposer(page);
  if (composerNow?.ready) {
    await setStatus(jobId, 'FLOW_READY', `Đã thấy composer Flow: ${composerNow.promptText || 'ready'}`);
    return 'flow-composer-detected';
  }

  await maybeClickGoogleSignIn(page);
  await maybeAutoLoginGoogle(page, jobId);

  const foundAfterAutoLogin = await detectFlowComposer(page);
  if (foundAfterAutoLogin?.ready) {
    await setStatus(jobId, 'FLOW_READY', `Đã thấy composer Flow sau login: ${foundAfterAutoLogin.promptText || 'ready'}`);
    return 'flow-composer-detected';
  }

  await setStatus(
    jobId,
    'WAITING_LOGIN',
    'Chrome Worker đã mở Flow nhưng chưa thấy ô prompt thật “What do you want to create?”. Nếu có captcha/2FA, xử lý thủ công trong Chrome Worker.'
  );

  const deadline = Date.now() + FLOW_LOGIN_WAIT_MS;
  let lastUrl = '';
  let lastAutoLoginAttemptAt = 0;
  while (Date.now() < deadline) {
    const composer = await detectFlowComposer(page);
    if (composer?.ready) {
      await setStatus(jobId, 'FLOW_READY', `Đã thấy ô prompt composer Flow: ${composer.promptText || 'ready'}`);
      return 'flow-composer-detected';
    }

    if (Date.now() - lastAutoLoginAttemptAt > 15000) {
      lastAutoLoginAttemptAt = Date.now();
      await maybeClickGoogleSignIn(page);
      await maybeAutoLoginGoogle(page, jobId);
    }

    const currentUrl = page.url();
    if (currentUrl !== lastUrl) {
      console.log(`[${jobId}] waiting Flow prompt, current URL: ${currentUrl}`);
      lastUrl = currentUrl;
    }
    await sleep(1500);
  }

  throw new Error(
    `Đã chờ ${Math.round(FLOW_LOGIN_WAIT_MS / 1000)} giây nhưng vẫn không thấy ô prompt thật. ` +
    `Hãy vào ${FLOW_URL}, bấm New project > Start creating tới màn có chữ “What do you want to create?”, rồi tạo lại job.`
  );
}

async function saveDebugArtifacts(page, jobId, reason = 'debug') {
  try {
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
    const safeReason = String(reason).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const pngPath = path.join(DOWNLOAD_DIR, `${jobId}-${safeReason}.png`);
    const htmlPath = path.join(DOWNLOAD_DIR, `${jobId}-${safeReason}.html`);
    await page.screenshot({ path: pngPath, fullPage: true }).catch(() => null);
    await fs.writeFile(htmlPath, await page.content()).catch(() => null);
    console.log(`[${jobId}] Đã lưu debug screenshot/html: ${pngPath} | ${htmlPath}`);
  } catch (error) {
    console.warn(`[${jobId}] Không lưu được debug artifact: ${error.message}`);
  }
}

async function downloadAssetByRef(jobId, asset, suffix = 'input') {
  if (!asset?.url) return null;
  const targetUrl = asset.url.startsWith('http') ? asset.url : `${API_BASE}${asset.url}`;
  const response = await fetch(targetUrl);
  if (!response.ok) throw new Error(`Không tải được asset ${suffix}: ${response.status}`);
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  const ext = path.extname(asset.originalName || '') || '.png';
  const filePath = path.join(DOWNLOAD_DIR, `${jobId}-${suffix}${ext}`);
  await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
  return filePath;
}

async function downloadInputAsset(job) {
  return downloadAssetByRef(job.jobId, job.inputAsset, 'input');
}

async function downloadEndInputAsset(job) {
  return downloadAssetByRef(job.jobId, job.endInputAsset, 'end-input');
}




function inferModelPreference(job) {
  const outputType = getJobOutputType(job);
  // BUG FIX: Use job.model sent from the web UI instead of always hardcoding.
  // The web UI sends a model ID like 'nano-banana-pro', 'veo-3.1-fast-lower-priority', etc.
  const jobModelId = String(job.model || '').trim().toLowerCase();

  if (outputType === 'image') {
    // For image jobs, always use Nano Banana Pro regardless of model field,
    // since that is the only image model on Flow.
    return {
      raw: 'Nano Banana Pro',
      kind: 'nano-banana-pro',
      labels: [
        'Nano Banana Pro',
        'Banana Pro',
        'Nano Banana',
        'Banana',
      ],
    };
  }

  // For video jobs, respect the model selected in the web UI.
  if (jobModelId.includes('veo-3.1-fast-generate') || jobModelId === 'veo-3.1-fast-generate-preview') {
    return {
      raw: 'Veo 3.1 - Fast',
      kind: 'veo3fast',
      labels: [
        'Veo 3.1 - Fast',
        'Veo 3.1 Fast',
        'Veo 3 Fast',
        'Veo 3.1',
      ],
    };
  }

  if (jobModelId.includes('veo-3.1-generate') || jobModelId === 'veo-3.1-generate-preview') {
    return {
      raw: 'Veo 3.1',
      kind: 'veo31standard',
      labels: [
        'Veo 3.1',
        'Veo 3.1 Standard',
        'Veo 3',
      ],
    };
  }

  // Default (and explicit 'veo-3.1-fast-lower-priority'): lower priority fast model.
  return {
    raw: 'Veo 3.1 - Fast [Lower Priority] (leaving 5/10)',
    kind: 'veo3fastLowerPriority',
    labels: [
      'Veo 3.1 - Fast [Lower Priority] (leaving 5/10)',
      'Veo 3.1 - Fast [Lower Priority]',
      'Veo 3.1 - Fast',
      'Fast [Lower Priority]',
      '[Lower Priority]',
      'Veo 3.1 Fast (lower priority - leaving 5/10)',
      'Veo 3.1 Fast (lower priority)',
      'Veo 3.1 Fast lower priority',
      'Veo 3.1 Fast Lower Priority',
      'Veo 3.1 Fast',
      'Veo 3 Fast',
      'Veo 3',
      '3.1 Fast',
      'Fast',
      'Lower Priority',
      'Lower priority',
      'lower priority',
      'leaving 5/10',
      '5/10',
    ],
  };
}


async function ensureFlowComposerReady(page, jobId, promptSelectors, newProjectSelectors) {
  // Chỉ coi là composer khi detectFlowComposer() thấy prompt thật.
  // Không dùng role=textbox fallback vì Flow có nhiều textbox/search box gây nhận nhầm.
  const composerNow = await detectFlowComposer(page);
  if (composerNow?.ready) {
    await setStatus(jobId, 'FLOW_READY', `Đã nhận diện composer Flow: ${composerNow.promptText || 'ready'}`);
    return 'flow-composer-detected';
  }

  const rounds = Number(env.FLOW_COMPOSER_READY_ROUNDS || 5);
  for (let round = 0; round < rounds; round += 1) {
    await clickFlowStageButtons(page, jobId).catch(() => null);

    const composerAfterStage = await detectFlowComposer(page);
    if (composerAfterStage?.ready) {
      await setStatus(jobId, 'FLOW_READY', `Đã vào composer Flow sau bước trung gian: ${composerAfterStage.promptText || 'ready'}`);
      return 'flow-composer-detected';
    }

    const clickedNewProject = await clickFirst(page, newProjectSelectors, { required: false, timeout: 2500 }).catch(() => null);
    if (clickedNewProject) {
      await setStatus(jobId, 'FLOW_STAGE_CLICKED', `Worker đã bấm New project bằng selector: ${clickedNewProject}`);
      await page.waitForTimeout(Number(env.FLOW_AFTER_NEW_PROJECT_DELAY_MS || 1000));
    }

    const startPoint = envPoint('FLOW_START_CREATING_CLICK');
    if (startPoint) {
      await setStatus(jobId, 'FLOW_STAGE_CLICKED', `Worker bấm Start creating bằng tọa độ thật: ${startPoint.x},${startPoint.y}`);
      await page.mouse.click(startPoint.x, startPoint.y);
      await page.waitForTimeout(Number(env.FLOW_AFTER_STAGE_CLICK_DELAY_MS || 900));
    }

    const composerAfterNew = await detectFlowComposer(page);
    if (composerAfterNew?.ready) {
      await setStatus(jobId, 'FLOW_READY', `Đã nhận diện composer Flow sau New project/Start creating: ${composerAfterNew.promptText || 'ready'}`);
      return 'flow-composer-detected';
    }
  }

  const debug = await detectFlowComposer(page).catch(() => null);
  throw new Error(`Đã bấm New project/Start creating nhưng chưa thấy prompt thật “What do you want to create?”. Màn hiện tại: ${debug?.bodyText || 'unknown'}`);
}

async function openFlowSettingsPanel(page, jobId, options = {}) {
  const force = Boolean(options.force);

  // Chỉ coi panel đã mở khi chính vùng overlay/popover đang hiện.
  // Tránh đọc text toàn body vì chip dưới prompt cũng có "Image/Video/Model".
  if (!force) {
    const panelState = await getFlowSettingsPanelState(page).catch(() => ({ open: false }));
    if (panelState?.open) return true;
  }

  const chip = await page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 20 &&
        r.height > 20 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < window.innerHeight &&
        r.left < window.innerWidth &&
        s.display !== 'none' &&
        s.visibility !== 'hidden' &&
        Number(s.opacity || 1) > 0;
    };

    const textOf = (el) => String([
      el.innerText,
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('data-testid'),
    ].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();

    const nodes = Array.from(document.querySelectorAll('button,[role="button"],div,span'))
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = textOf(el);
        const lower = text.toLowerCase();

        let score = 0;

        // Chip setting dưới prompt thường có model hiện tại + 1x/2x hoặc aspect/duration.
        if (/nano banana|banana|veo|imagen/i.test(text)) score += 260;
        if (/\b1x\b|\b2x\b|\b3x\b|\b4x\b|16:9|9:16|4:3|1:1|3:4|4s|6s|8s/i.test(text)) score += 180;

        // Vị trí chip thật nằm dưới/bên phải prompt.
        if (r.top > window.innerHeight * 0.62) score += 220;
        if (r.left > window.innerWidth * 0.42) score += 120;
        if (r.width >= 120 && r.width <= 460 && r.height >= 30 && r.height <= 95) score += 150;

        // Tránh hàng model trong panel nếu panel đã mở, tab Image/Video, toolbar/header.
        if (/^image$|^video$|^frames$|^ingredients$/i.test(text)) score -= 500;
        if (/generating will use/i.test(text)) score -= 300;
        if (/download|more|menu|search|help|settings|new project|start creating/i.test(text)) score -= 600;
        if (r.top < 120) score -= 400;

        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          text: text.slice(0, 180),
          score,
        };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return nodes[0] || null;
  }).catch(() => null);

  if (!chip) {
    await setStatus(jobId, 'SETTING_FLOW', 'Không tìm thấy chip setting dưới prompt để mở panel.').catch(() => null);
    return false;
  }

  await setStatus(jobId, 'SETTING_FLOW', `Mở panel setting bằng chip tại ${chip.x},${chip.y}: ${chip.text}`).catch(() => null);
  await page.mouse.click(chip.x, chip.y);
  await page.waitForTimeout(Number(env.FLOW_AFTER_OPEN_SETTINGS_PANEL_DELAY_MS || 900));

  const openedState = await getFlowSettingsPanelState(page).catch(() => ({ open: false }));
  const opened = Boolean(openedState?.open);

  if (!opened) {
    await setStatus(jobId, 'SETTING_FLOW', 'Đã click chip setting nhưng chưa xác nhận panel mở.').catch(() => null);
  }

  return opened;
}

async function ensureFlowOutputMode(page, jobId, outputType) {
  const wanted = String(outputType || 'video').toLowerCase();
  const isImage = wanted === 'image';
  const modeName = isImage ? 'Image' : 'Video';

  await openFlowSettingsPanel(page, jobId, { force: false });

  await setStatus(jobId, 'SETTING_FLOW', `Đang ép Flow sang mode ${modeName}.`).catch(() => null);

  const findModeTab = async () => page.evaluate(({ isImage }) => {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 20 &&
        r.height > 20 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < window.innerHeight &&
        r.left < window.innerWidth &&
        s.display !== 'none' &&
        s.visibility !== 'hidden' &&
        Number(s.opacity || 1) > 0;
    };

    const textOf = (el) => String([
      el.innerText,
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('data-testid'),
    ].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();

    const wantedRegex = isImage ? /^Image$/i : /^Video$/i;

    // Chỉ lấy node có text chính xác Image/Video, không lấy parent chứa cả cụm panel.
    const nodes = Array.from(document.querySelectorAll('button,[role="button"],[role="tab"],span,div'))
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = textOf(el);

        let score = 0;
        if (wantedRegex.test(text)) score += 800;
        else score -= 800;

        // Tab Image/Video nằm ở hàng đầu panel, nhưng panel có thể ở giữa hoặc dưới màn.
        if (r.top > window.innerHeight * 0.25 && r.top < window.innerHeight * 0.90) score += 150;
        if (r.width >= 55 && r.width <= 230 && r.height >= 28 && r.height <= 90) score += 180;
        if (el.matches('button,[role="button"],[role="tab"]')) score += 100;

        if (/Download|More|Menu|New project|Start creating|Help|Search|Settings|Generating will use/i.test(text)) score -= 700;
        if (r.top < 100) score -= 400;

        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          text,
          score,
        };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return nodes[0] || null;
  }, { isImage }).catch(() => null);

  let result = await findModeTab();

  // Nếu chưa thấy tab, mở panel cưỡng bức rồi tìm lại.
  if (!result) {
    await openFlowSettingsPanel(page, jobId, { force: true });
    await page.waitForTimeout(500);
    result = await findModeTab();
  }

  // Fallback cuối: nếu panel mở nhưng text node không match, click theo layout của panel.
  if (!result) {
    result = await page.evaluate(({ isImage }) => {
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 180 && r.height > 120 &&
          r.bottom > 0 && r.right > 0 &&
          r.top < window.innerHeight && r.left < window.innerWidth &&
          s.display !== 'none' && s.visibility !== 'hidden';
      };
      const textOf = (el) => String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const panels = Array.from(document.querySelectorAll('div,section,[role="dialog"],[role="menu"]'))
        .filter(visible)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const text = textOf(el);
          let score = 0;
          if (/\bImage\b/.test(text) && /\bVideo\b/.test(text)) score += 500;
          if (/Generating will use|Nano Banana|Veo|Frames|Ingredients|16:9|9:16/.test(text)) score += 250;
          if (r.width >= 260 && r.width <= 620 && r.height >= 160 && r.height <= 520) score += 150;
          if (r.top > 100) score += 60;
          return { r: { left: r.left, top: r.top, width: r.width, height: r.height }, score, text: text.slice(0, 180) };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      const p = panels[0];
      if (!p) return null;
      // Theo UI Flow hiện tại: Image ở nửa trái, Video ở nửa phải hàng đầu panel.
      return {
        x: Math.round(p.r.left + p.r.width * (isImage ? 0.28 : 0.73)),
        y: Math.round(p.r.top + 30),
        text: isImage ? 'layout-fallback-Image' : 'layout-fallback-Video',
        score: p.score,
      };
    }, { isImage }).catch(() => null);
  }

  if (!result) {
    await saveDebugArtifacts(page, jobId, `mode-${modeName.toLowerCase()}-not-found`).catch(() => null);
    throw new Error(`Không tìm thấy tab mode ${modeName} trong panel setting.`);
  }

  await setStatus(jobId, 'SETTING_FLOW', `Click mode ${modeName} tại ${result.x},${result.y}: ${result.text}`).catch(() => null);
  await page.mouse.click(result.x, result.y);
  await page.waitForTimeout(Number(env.FLOW_AFTER_MODE_CLICK_DELAY_MS || 1000));

  // Không verify bằng text toàn body vì body có thể vẫn chứa cả Image và Video.
  // Kiểm tra model sau đó mới quyết định đúng/sai.
  return result;
}

async function maybeSelectFlowModel(page, jobId, job) {
  const pref = inferModelPreference(job);
  const outputType = getJobOutputType(job);
  const wantsVideo = outputType === 'video';
  const wantsImage = outputType === 'image';

  if (!pref.raw) throw new Error('Job chưa có model để chọn.');

  await openFlowSettingsPanel(page, jobId);

  await setStatus(jobId, 'SETTING_MODEL', `Đang ép chọn model Flow: ${pref.raw}`).catch(() => null);

  const normalize = (value) => String(value || '')
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const wantedLabels = [
    pref.raw,
    ...(pref.labels || []),
    // BUG FIX: Do NOT append hardcoded lower-priority labels for all video jobs.
    // inferModelPreference already returns the correct labels for the chosen model.
    wantsImage ? 'Nano Banana Pro' : '',
  ].filter(Boolean).map(normalize);

  const clickModelRow = async () => {
    const row = await page.evaluate(({ wantsVideo, wantsImage }) => {
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 30 &&
          r.height > 24 &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.top < window.innerHeight &&
          r.left < window.innerWidth &&
          s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          Number(s.opacity || 1) > 0;
      };

      const textOf = (el) => String([
        el.innerText,
        el.textContent,
        el.getAttribute?.('aria-label'),
        el.getAttribute?.('title'),
        el.getAttribute?.('data-testid'),
      ].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();

      const nodes = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"],div[aria-haspopup],button[aria-haspopup],div,span'))
        .filter(visible)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const text = textOf(el);

          let score = 0;

          // Hàng model trong panel có tên model hiện tại + caret/dropdown.
          if (/Nano Banana|Banana|Veo|Imagen/i.test(text)) score += 350;
          if (/Veo 3\.1|Lower Priority|leaving 5\/10/i.test(text)) score += wantsVideo ? 300 : -300;
          if (/Nano Banana Pro/i.test(text)) score += wantsImage ? 300 : -200;

          // Ưu tiên row dài trong panel, không phải tab Image/Video.
          if (r.width >= 240 && r.width <= 560 && r.height >= 34 && r.height <= 90) score += 160;
          if (r.top > window.innerHeight * 0.38 && r.top < window.innerHeight * 0.86) score += 120;
          if (el.matches('button,[role="button"],[role="combobox"],button[aria-haspopup],div[aria-haspopup]')) score += 80;

          if (/^Image$|^Video$|^Frames$|^Ingredients$|^1x$|^2x$|^3x$|^4x$|^4s$|^6s$|^8s$|16:9|9:16|4:3|1:1|3:4/i.test(text)) score -= 500;
          if (/Download|More|Menu|New project|Start creating|Help|Search|Settings/i.test(text)) score -= 500;
          if (r.top < 120) score -= 300;

          return {
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
            text: text.slice(0, 180),
            score,
          };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);

      return nodes[0] || null;
    }, { wantsVideo, wantsImage }).catch(() => null);

    if (!row) return null;

    await setStatus(jobId, 'SETTING_MODEL', `Mở dropdown model tại ${row.x},${row.y}: ${row.text}`).catch(() => null);
    await page.mouse.click(row.x, row.y);
    await page.waitForTimeout(Number(env.FLOW_AFTER_OPEN_MODEL_DELAY_MS || 900));
    return row;
  };

  const chooseOption = async () => {
    const options = await page.evaluate(({ wantedLabels, wantsVideo, wantsImage }) => {
      const norm = (value) => String(value || '')
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/[()[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 30 &&
          r.height > 20 &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.top < window.innerHeight &&
          r.left < window.innerWidth &&
          s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          Number(s.opacity || 1) > 0;
      };

      const textOf = (el) => String([
        el.innerText,
        el.textContent,
        el.getAttribute?.('aria-label'),
        el.getAttribute?.('title'),
        el.getAttribute?.('data-testid'),
      ].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();

      const nodes = Array.from(document.querySelectorAll('button,[role="button"],[role="option"],[role="menuitem"],li,div,span'))
        .filter(visible)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const raw = textOf(el);
          const text = norm(raw);

          let score = 0;

          for (const wanted of wantedLabels) {
            if (!wanted) continue;
            if (text === wanted) score += 800;
            else if (text.includes(wanted)) score += 500;
            else if (wanted.includes(text) && text.length >= 8) score += 180;
          }

          if (wantsVideo) {
            if (text.includes('veo') && text.includes('3') && text.includes('fast')) score += 600;
            if (text.includes('lower priority')) score += 450;
            if (text.includes('leaving 5/10') || text.includes('5/10')) score += 250;
            if (text.includes('banana')) score -= 2000;
          }

          if (wantsImage) {
            if (text.includes('nano banana pro')) score += 700;
            if (text.includes('veo')) score -= 2000;
          }

          if (r.top < 100) score -= 300;
          if (/^Image$|^Video$|^Frames$|^Ingredients$|^1x$|^2x$|^3x$|^4x$|16:9|9:16|4:3|1:1|3:4/i.test(raw)) score -= 500;
          if (/Download|More|Menu|Search|Help|Settings|New project/i.test(raw)) score -= 500;

          const clickable = el.closest('button,[role="button"],[role="option"],[role="menuitem"],li') || el;
          const cr = clickable.getBoundingClientRect();

          return {
            x: Math.round(cr.left + cr.width / 2),
            y: Math.round(cr.top + cr.height / 2),
            text: raw.slice(0, 180),
            score,
          };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);

      return nodes.slice(0, 8);
    }, { wantedLabels, wantsVideo, wantsImage }).catch(() => []);

    console.log(`[${jobId}] Model option candidates strict:`, options);

    return options[0] || null;
  };

  const rounds = Number(env.FLOW_MODEL_SELECT_ROUNDS || 4);

  for (let round = 0; round < rounds; round += 1) {
    await openFlowSettingsPanel(page, jobId);

    const row = await clickModelRow();
    if (!row) {
      await setStatus(jobId, 'SETTING_MODEL', `Không tìm thấy hàng model trong panel, round ${round + 1}/${rounds}.`).catch(() => null);
      await page.waitForTimeout(700);
      continue;
    }

    const option = await chooseOption();

    if (!option) {
      await page.keyboard.press('Escape').catch(() => null);
      await page.waitForTimeout(400);
      continue;
    }

    await setStatus(jobId, 'SETTING_MODEL', `Chọn model option tại ${option.x},${option.y}: ${option.text}`).catch(() => null);
    await page.mouse.click(option.x, option.y);
    await page.waitForTimeout(Number(env.FLOW_AFTER_SELECT_MODEL_DELAY_MS || 1200));

    const afterText = await page.evaluate(() => String(document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 4000)).catch(() => '');
    const afterNorm = normalize(afterText);

    if (wantsVideo) {
      // BUG FIX: Verify against pref.kind so Veo 3.1 Standard and Veo 3.1 Fast
      // (without "lower priority") also pass verification, not just the lower-priority variant.
      let ok = false;
      if (pref.kind === 'veo3fastLowerPriority') {
        ok = afterNorm.includes('veo') && afterNorm.includes('3') && afterNorm.includes('fast');
      } else if (pref.kind === 'veo3fast') {
        ok = afterNorm.includes('veo') && afterNorm.includes('3') && afterNorm.includes('fast');
      } else if (pref.kind === 'veo31standard') {
        ok = afterNorm.includes('veo') && afterNorm.includes('3');
      } else {
        ok = afterNorm.includes('veo') && afterNorm.includes('3');
      }
      const stillBanana = afterNorm.includes('banana') && !ok;

      if (!ok || stillBanana) {
        await setStatus(jobId, 'SETTING_MODEL', `Chọn model video chưa đạt (kind=${pref.kind}), chưa thấy Veo đúng. Thử lại.`).catch(() => null);
        continue;
      }
    }

    if (wantsImage) {
      const ok = afterNorm.includes('nano banana pro') || afterNorm.includes('banana');
      if (!ok) {
        await setStatus(jobId, 'SETTING_MODEL', 'Chọn model ảnh chưa đạt, chưa thấy Nano Banana Pro. Thử lại.').catch(() => null);
        continue;
      }
    }

    await setStatus(jobId, 'SETTING_MODEL', `Đã chọn model Flow: ${pref.raw}`).catch(() => null);
    return `model-option:${option.text}`;
  }

  await saveDebugArtifacts(page, jobId, 'model-select-failed').catch(() => null);
  throw new Error(`Chưa tự chọn được model ${pref.raw}. Đã lưu screenshot/html debug.`);
}


async function ensureImageToVideoMode(page, jobId, job) {
  await setStatus(jobId, 'SETTING_FLOW', 'Image-to-video đang dùng sẵn thanh Start/End của Flow; Worker không chọn lại model/mode, chỉ kiểm tra Start/End và upload frame.');

  // Flow image-to-video đã mở sẵn Video + Frames + model Veo ở thanh input.
  // Không tự bấm lại Video/Frames/model nữa vì dễ mở nhầm dropdown và làm Flow hiểu ảnh thành Ingredients/reference.
  const modeCheck = await page.evaluate(() => {
    const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8;
    };
    const text = norm(document.body.innerText || document.body.textContent || '');
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const boxes = Array.from(document.querySelectorAll('button,[role="button"],div,span'))
      .filter(visible)
      .map((el) => norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || ''))
      .filter(Boolean);
    const hasStart = boxes.some((v) => /^Start$/i.test(v) || /Start frame|Starting/i.test(v)) || /\bStart\b/i.test(text);
    const hasEnd = boxes.some((v) => /^End$/i.test(v) || /End frame|Ending|Last frame/i.test(v)) || /\bEnd\b/i.test(text);
    const hasFrames = /Frames|Start|End|First frame|Last frame|Starting|Ending/i.test(text);
    return { ok: hasFrames && hasStart && hasEnd, hasFrames, hasStart, hasEnd, inputCount: inputs.length, bodyText: text.slice(0, 900) };
  }).catch(() => ({ ok: false, hasFrames: false, hasStart: false, hasEnd: false, inputCount: 0, bodyText: '' }));

  if (!modeCheck.ok) {
    await saveDebugArtifacts(page, jobId, 'image-to-video-start-end-not-found').catch(() => null);
    throw new Error(`Chưa thấy thanh Start/End của image-to-video. hasFrames=${modeCheck.hasFrames}; hasStart=${modeCheck.hasStart}; hasEnd=${modeCheck.hasEnd}; inputCount=${modeCheck.inputCount}.`);
  }

  await setStatus(jobId, 'SETTING_FLOW', `Đã thấy thanh Start/End image-to-video. input file hiện có=${modeCheck.inputCount}.`);
}

async function clickStartEndFrameBox(page, jobId, frameType = 'start') {
  const isEnd = frameType === 'end';
  const envPrefix = isEnd ? 'FLOW_END_FRAME_CLICK' : 'FLOW_START_FRAME_CLICK';
  const envClicked = await clickEnvPoint(page, envPrefix, jobId, `Chọn ${isEnd ? 'End' : 'Start'} frame theo tọa độ`, { status: 'UPLOADING_ASSETS', delayMs: 500 }).catch(() => null);
  if (envClicked) return envClicked;

  const clicked = await page.evaluate(({ isEnd }) => {
    const targetWord = isEnd ? 'End' : 'Start';
    const exact = new RegExp(`^${targetWord}$`, 'i');
    const loose = isEnd ? /End|Ending|Last frame/i : /Start|Starting|First frame/i;
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 18 && rect.height > 18;
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const nodes = Array.from(document.querySelectorAll('button,[role="button"],div,span,label'));
    const scored = [];
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
      if (!text || text.length > 80) continue;
      if (!exact.test(text) && !loose.test(text)) continue;
      const clickable = el.closest('button,[role="button"],label') || el;
      if (!isVisible(clickable)) continue;
      const rect = clickable.getBoundingClientRect();
      let score = 0;
      if (exact.test(text)) score += 100;
      if (rect.top > window.innerHeight * 0.35) score += 30; // Start/End box nằm ở thanh input dưới, tránh toolbar trên
      if (rect.width >= 40 && rect.width <= 140 && rect.height >= 35 && rect.height <= 90) score += 25;
      if (clickable.matches('button,[role="button"],label')) score += 20;
      scored.push({ el: clickable, rect, text, score });
    }
    scored.sort((a, b) => b.score - a.score || b.rect.top - a.rect.top);
    const best = scored[0];
    if (!best) return null;
    best.el.scrollIntoView({ block: 'center', inline: 'center' });
    best.el.click();
    return { text: best.text, x: Math.round(best.rect.left + best.rect.width / 2), y: Math.round(best.rect.top + best.rect.height / 2), score: best.score };
  }, { isEnd }).catch(() => null);

  if (clicked) {
    await setStatus(jobId, 'UPLOADING_ASSETS', `Đã click ô ${isEnd ? 'End' : 'Start'} frame: ${clicked.text} tại ${clicked.x},${clicked.y}.`);
    await page.waitForTimeout(Number(env.FLOW_AFTER_FRAME_TAB_DELAY_MS || 800));
    return `dom-${isEnd ? 'end' : 'start'}:${clicked.x},${clicked.y}`;
  }

  await setStatus(jobId, 'UPLOADING_ASSETS', `Không click được ô ${isEnd ? 'End' : 'Start'} frame bằng DOM, sẽ thử input file hiện có.`);
  return null;
}

async function uploadFlowFrameAsset(page, jobId, filePath, frameType = 'start') {
  if (!filePath) return null;
  const isEnd = frameType === 'end';
  const label = isEnd ? 'End frame' : 'Start frame';
  const timeout = Number(env.FLOW_FRAME_FILECHOOSER_TIMEOUT_MS || 10000);

  await setStatus(jobId, 'UPLOADING_ASSETS', `Đang mở file picker riêng của ${label}.`);

  let chooser = null;
  try {
    const chooserPromise = page.waitForEvent('filechooser', { timeout });
    await clickStartEndFrameBox(page, jobId, frameType);
    chooser = await chooserPromise;
  } catch (error) {
    await saveDebugArtifacts(page, jobId, `${isEnd ? 'end' : 'start'}-frame-filechooser-failed`).catch(() => null);
    throw new Error(`Không mở được file picker riêng của ${label}. Không dùng input upload chung để tránh ảnh bị đưa vào khung chat. Lỗi: ${error.message}`);
  }

  await chooser.setFiles(filePath);
  await page.waitForTimeout(Number(env.FLOW_AFTER_UPLOAD_DELAY_MS || 3000));

  await setStatus(jobId, 'UPLOADING_ASSETS', `Đã upload ảnh vào đúng ${label} qua filechooser.`);
  return true;
}


async function waitForFrameReady(page, jobId, frameType = 'start', timeout = Number(env.FLOW_FRAME_READY_TIMEOUT_MS || 30000)) {
  const isEnd = frameType === 'end';
  const label = isEnd ? 'End' : 'Start';
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const state = await page.evaluate(({ isEnd }) => {
      const target = isEnd ? /^(End|Ending|Last frame)$/i : /^(Start|Starting|First frame)$/i;
      const loose = isEnd ? /End|Ending|Last frame/i : /Start|Starting|First frame/i;
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 10 && rect.height > 10;
      };
      const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const nodes = Array.from(document.querySelectorAll('button,[role="button"],div,section,span,label')).filter(visible);
      const candidates = nodes.map((el) => ({ el, text: norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '') }))
        .filter((x) => x.text && x.text.length < 120 && (target.test(x.text) || loose.test(x.text)));
      let best = null;
      for (const candidate of candidates) {
        const root = candidate.el.closest('button,[role="button"],section,div') || candidate.el;
        const rect = root.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.35) continue;
        const rootText = norm(root.innerText || root.textContent || '').toLowerCase();
        const hasPreview = Boolean(root.querySelector('img,video,canvas'));
        const busy = /uploading|processing|loading|generating|đang tải|đang xử lý|đang tạo/.test(rootText);
        const score = (hasPreview ? 100 : 0) + (busy ? -100 : 0) + rect.top;
        if (!best || score > best.score) best = { text: candidate.text, hasPreview, busy, score, top: rect.top };
      }
      return best || { text: '', hasPreview: false, busy: false };
    }, { isEnd }).catch(() => ({ text: '', hasPreview: false, busy: true }));

    if (state.hasPreview && !state.busy) {
      await setStatus(jobId, 'UPLOADING_ASSETS', `${label} frame đã render preview và sẵn sàng.`);
      return true;
    }
    await page.waitForTimeout(800);
  }
  throw new Error(`${label} frame upload xong nhưng Flow chưa render preview/ready sau ${timeout}ms.`);
}

async function waitForImageToVideoComposerReady(page, jobId, timeout = Number(env.FLOW_IMAGE_TO_VIDEO_READY_TIMEOUT_MS || 30000)) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const state = await page.evaluate(() => {
      const text = String(document.body.innerText || document.body.textContent || '').replace(/\s+/g, ' ').toLowerCase();
      const hasPrompt = /what do you want to create\?/.test(text);
      const hasCreate = /create/.test(text);
      const busy = /uploading|processing|loading|đang tải|đang xử lý|đang tạo/.test(text);
      return { hasPrompt, hasCreate, busy };
    }).catch(() => ({ hasPrompt: false, hasCreate: false, busy: true }));
    if (state.hasPrompt && state.hasCreate && !state.busy) {
      await setStatus(jobId, 'SETTING_FLOW', 'Start/End đã sẵn sàng, composer hết trạng thái xử lý, chuẩn bị nhập prompt.');
      return true;
    }
    await page.waitForTimeout(700);
  }
  throw new Error('Composer chưa sẵn sàng sau khi upload Start/End.');
}

async function clickDynamicTextCenter(page, patterns, jobId, label, options = {}) {
  const result = await page.evaluate(({ patterns }) => {
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 8 && rect.height > 8;
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const regexes = patterns.map((p) => new RegExp(p, 'i'));
    const nodes = Array.from(document.querySelectorAll('button,a,[role="button"],[role="option"],div,p,span'));
    const scored = [];
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
      if (!text) continue;
      const matched = regexes.find((rx) => rx.test(text));
      if (!matched) continue;
      const clickable = el.closest('button,a,[role="button"],[role="option"]') || el;
      if (!isVisible(clickable)) continue;
      const rect = clickable.getBoundingClientRect();
      let score = 0;
      if (clickable.matches('button,a,[role="button"],[role="option"]')) score += 50;
      if (rect.width > 80 && rect.height > 30) score += 10;
      if (rect.top > window.innerHeight * 0.25) score += 8;
      if (text.length < 80) score += 6;
      scored.push({
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        text: text.slice(0, 120),
        tag: clickable.tagName,
        score,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }, { patterns }).catch(() => null);

  if (!result) return null;
  await setStatus(jobId, options.status || 'FLOW_STAGE_CLICKED', `${label}: ${result.text} tại ${result.x},${result.y}`);
  await page.mouse.click(result.x, result.y);
  await page.waitForTimeout(Number(options.delayMs || 350));
  return `dynamic-text:${result.text}`;
}


async function clickFlowNewProjectAuto(page, jobId) {
  const result = await page.evaluate(() => {
    const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 12 && r.height > 12 && r.bottom > 0 && r.right > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const nodes = Array.from(document.querySelectorAll('button,[role="button"],a,div,p,span'));
    const candidates = [];
    for (const el of nodes) {
      if (!visible(el)) continue;
      const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
      if (!/^New project$|New project|Create project|New video|Dự án mới|Tạo mới/i.test(text)) continue;
      const clickable = el.closest('button,[role="button"],a') || el;
      if (!visible(clickable)) continue;
      const r = clickable.getBoundingClientRect();
      let score = 0;
      if (clickable.matches('button,[role="button"],a')) score += 60;
      if (/^New project$/i.test(text)) score += 50;
      if (r.top > 80) score += 10;
      if (r.width > 80 && r.height > 30) score += 10;
      candidates.push({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: text.slice(0, 100), score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }).catch(() => null);
  if (!result) return null;
  await setStatus(jobId, 'FLOW_STAGE_CLICKED', `Auto bấm New project: ${result.text} tại ${result.x},${result.y}`);
  await page.mouse.click(result.x, result.y);
  await page.waitForTimeout(Number(env.FLOW_AFTER_NEW_PROJECT_DELAY_MS || 700));
  return result;
}

async function hasStartCreatingScreen(page) {
  return page.evaluate(() => /Start creating\s*(or|hoặc)?\s*drop media|Start creating/i.test(document.body?.innerText || '')).catch(() => false);
}

async function clickFlowStartCreatingCardAuto(page, jobId) {
  const candidates = await page.evaluate(() => {
    const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 8 && r.height > 8 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0;
    };
    const push = (list, x, y, label, score = 0, rect = null) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return;
      list.push({ x: Math.round(x), y: Math.round(y), label: String(label || '').slice(0, 140), score, rect });
    };

    const list = [];
    const nodes = Array.from(document.querySelectorAll('button,[role="button"],div,p,span,section,article'))
      .filter(visible)
      .map((el) => {
        const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
        const r = el.getBoundingClientRect();
        return { el, text, r, area: r.width * r.height };
      });

    const startNodes = nodes.filter((n) => /Start creating|drop media/i.test(n.text));
    for (const n of startNodes) {
      const clickable = n.el.closest('button,[role="button"]') || n.el;
      const cr = clickable.getBoundingClientRect();
      const area = cr.width * cr.height;
      let score = 80;
      if (clickable.matches('button,[role="button"]')) score += 60;
      if (area > 25000) score += 40;
      if (area > 90000) score += 30;
      if (cr.width > 250 && cr.height > 100) score += 30;
      if (cr.top > window.innerHeight * 0.18) score += 20;
      if (cr.left > window.innerWidth * 0.25) score += 12;
      if (cr.top < 90) score -= 60;
      if (area > window.innerWidth * window.innerHeight * 0.75) score -= 140;
      // Thử nhiều điểm trong cùng card. Flow đôi khi chỉ nhận click ở vùng giữa/phải của card.
      push(list, cr.left + cr.width / 2, cr.top + cr.height / 2, `start-card-center ${n.text}`, score, { w: Math.round(cr.width), h: Math.round(cr.height), area: Math.round(area) });
      push(list, cr.left + cr.width * 0.68, cr.top + cr.height * 0.68, `start-card-inner ${n.text}`, score + 16, { w: Math.round(cr.width), h: Math.round(cr.height), area: Math.round(area) });
      push(list, cr.left + cr.width * 0.80, cr.top + cr.height * 0.72, `start-card-right-bottom ${n.text}`, score + 12, { w: Math.round(cr.width), h: Math.round(cr.height), area: Math.round(area) });

      // Leo lên ancestor để lấy card lớn thật, nhưng không lấy body/main quá lớn.
      let parent = n.el.parentElement;
      let depth = 0;
      while (parent && parent !== document.body && depth < 9) {
        if (visible(parent)) {
          const pr = parent.getBoundingClientRect();
          const pArea = pr.width * pr.height;
          const pText = norm(parent.innerText || parent.textContent || '');
          if (/Start creating|drop media/i.test(pText) && pArea > 15000 && pArea < window.innerWidth * window.innerHeight * 0.72 && pr.top > 80) {
            let pScore = score + 20;
            if (pArea > area) pScore += 20;
            if (pr.width > 350 && pr.height > 180) pScore += 25;
            if (pr.left > window.innerWidth * 0.25) pScore += 15;
            push(list, pr.left + pr.width / 2, pr.top + pr.height / 2, `start-ancestor-center ${pText}`, pScore, { w: Math.round(pr.width), h: Math.round(pr.height), area: Math.round(pArea) });
            push(list, pr.left + pr.width * 0.70, pr.top + pr.height * 0.70, `start-ancestor-inner ${pText}`, pScore + 18, { w: Math.round(pr.width), h: Math.round(pr.height), area: Math.round(pArea) });
          }
        }
        parent = parent.parentElement;
        depth += 1;
      }
    }

    // Fallback không dùng tọa độ cố định: click theo tỉ lệ viewport ở vùng card tạo mới.
    // Ổn hơn fixed x/y khi đổi màn hình, vẫn tự động theo kích thước cửa sổ Chrome.
    push(list, window.innerWidth * 0.62, window.innerHeight * 0.72, 'viewport-start-creating-lower-middle', 45);
    push(list, window.innerWidth * 0.50, window.innerHeight * 0.55, 'viewport-start-creating-middle', 35);
    push(list, window.innerWidth * 0.70, window.innerHeight * 0.70, 'viewport-start-creating-right-lower', 32);

    const seen = new Set();
    const dedup = [];
    for (const item of list.sort((a, b) => b.score - a.score)) {
      const key = `${Math.round(item.x / 8)}:${Math.round(item.y / 8)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(item);
    }
    return dedup.slice(0, 8);
  }).catch(() => []);

  if (!candidates?.length) return null;

  for (const candidate of candidates) {
    await setStatus(jobId, 'FLOW_STAGE_CLICKED', `Auto thử bấm Start creating: ${candidate.label} tại ${candidate.x},${candidate.y}`);
    await page.mouse.click(candidate.x, candidate.y);
    await page.waitForTimeout(Number(env.FLOW_AFTER_STAGE_CLICK_DELAY_MS || 900));
    const composer = await detectFlowComposer(page);
    if (composer?.ready) {
      await setStatus(jobId, 'FLOW_READY', `Đã vào composer Flow sau Start creating: ${composer.promptText || 'What do you want to create?'}`);
      return candidate;
    }
  }

  return candidates[0];
}

async function clickFlowIntroAuto(page, jobId) {
  const result = await page.evaluate(() => {
    const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 12 && r.height > 12 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const nodes = Array.from(document.querySelectorAll('button,[role="button"],a,div,p,span'));
    const candidates = [];
    for (const el of nodes) {
      if (!visible(el)) continue;
      const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
      if (!/Create with Flow|Try Flow|Get started|Continue|Tiếp tục|Start creating/i.test(text)) continue;
      const clickable = el.closest('button,[role="button"],a') || el;
      if (!visible(clickable)) continue;
      const r = clickable.getBoundingClientRect();
      let score = 0;
      if (clickable.matches('button,[role="button"],a')) score += 50;
      if (/Create with Flow|Try Flow|Get started|Continue|Tiếp tục/i.test(text)) score += 50;
      if (r.top > 100) score += 10;
      candidates.push({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: text.slice(0, 100), score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }).catch(() => null);
  if (!result) return null;
  await setStatus(jobId, 'FLOW_STAGE_CLICKED', `Auto bấm bước mở Flow: ${result.text} tại ${result.x},${result.y}`);
  await page.mouse.click(result.x, result.y);
  await page.waitForTimeout(Number(env.FLOW_AFTER_STAGE_CLICK_DELAY_MS || 700));
  return result;
}

async function clickFlowStageButtons(page, jobId) {
  let clickedAny = false;
  const maxRounds = Number(env.FLOW_STAGE_CLICK_ROUNDS || 4);

  for (let round = 0; round < maxRounds; round += 1) {
    const composerBefore = await detectFlowComposer(page);
    if (composerBefore?.ready) {
      await setStatus(jobId, 'FLOW_READY', `Đã thấy ô prompt composer Flow: ${composerBefore.promptText || 'ready'}.`);
      return clickedAny;
    }

    // Quan trọng: nếu đã ở màn Start creating thì KHÔNG bấm New project tiếp,
    // vì sẽ tạo vòng lặp New project -> đứng màn Start creating.
    const hasStart = await hasStartCreatingScreen(page);
    if (hasStart) {
      const startCard = await clickFlowStartCreatingCardAuto(page, jobId);
      if (startCard) clickedAny = true;
      const composerAfterStart = await detectFlowComposer(page);
      if (composerAfterStart?.ready) {
        await setStatus(jobId, 'FLOW_READY', `Đã vào composer Flow sau Start creating: ${composerAfterStart.promptText || 'ready'}.`);
        return clickedAny;
      }
      // Nếu bấm Start creating chưa vào composer, thử lại vòng sau; không click New project chồng lên.
      continue;
    }

    const newProject = await clickFlowNewProjectAuto(page, jobId);
    if (newProject) {
      clickedAny = true;
      await page.waitForTimeout(Number(env.FLOW_AFTER_NEW_PROJECT_DELAY_MS || 900));
    }

    const composerAfterNew = await detectFlowComposer(page);
    if (composerAfterNew?.ready) {
      await setStatus(jobId, 'FLOW_READY', `Đã vào composer Flow sau New project: ${composerAfterNew.promptText || 'ready'}.`);
      return clickedAny;
    }

    const hasStartAfterNew = await hasStartCreatingScreen(page);
    if (hasStartAfterNew) {
      const startCard = await clickFlowStartCreatingCardAuto(page, jobId);
      if (startCard) clickedAny = true;
      const composerAfterStart = await detectFlowComposer(page);
      if (composerAfterStart?.ready) {
        await setStatus(jobId, 'FLOW_READY', `Đã vào composer Flow sau Start creating: ${composerAfterStart.promptText || 'ready'}.`);
        return clickedAny;
      }
      continue;
    }

    const intro = await clickFlowIntroAuto(page, jobId);
    if (intro) clickedAny = true;

    const composerAfterIntro = await detectFlowComposer(page);
    if (composerAfterIntro?.ready) {
      await setStatus(jobId, 'FLOW_READY', `Đã vào composer Flow sau bước mở: ${composerAfterIntro.promptText || 'ready'}.`);
      return clickedAny;
    }

    if (!newProject && !intro) break;
  }

  return clickedAny;
}

async function waitForAnyResultSignal(page, jobId) {
  const timeoutMs = Number(env.FLOW_RESULT_READY_TIMEOUT_MS || env.FLOW_GENERATE_WAIT_MS || 240000);
  const deadline = Date.now() + timeoutMs;
  const resultSelectors = parseSelectorList(
    env.FLOW_RESULT_READY_SELECTOR,
    [
      'video[src]',
      'video',
      'source[src]',
      'img[src]',
      'canvas',
      'a[download]',
      'a[href*="download" i]',
      'a[href*=".mp4" i]',
      'button[aria-label*="Download" i]',
      'button[aria-label*="Tải" i]',
      'button:has-text("Download")',
      'text=/Download|Tải xuống|Export|Save/i'
    ].join('||')
  );

  let lastHeartbeatAt = 0;
  while (Date.now() < deadline) {
    // Tuyệt đối không dùng fallback role=textbox ở bước kết quả.
    // role=textbox là ô prompt, nếu nhận nhầm sẽ tải quá sớm và luôn không thấy Download.
    const found = await findVisibleSelectorStrict(page, resultSelectors, 1500);
    if (found && found !== 'role=textbox') return found;

    const hasCandidate = await hasVideoCandidateNow(page);
    if (hasCandidate) return 'video-candidate';

    if (Date.now() - lastHeartbeatAt > 10000) {
      lastHeartbeatAt = Date.now();
      await heartbeat(jobId, 'Worker đang chờ Flow sinh video xong, chưa thấy video/download thật.');
    }
    await page.waitForTimeout(Number(env.FLOW_RESULT_READY_POLL_MS || 3000));
  }
  return null;
}

async function savePlaywrightDownload(download, savePathPrefix, jobId, sourceLabel = 'download') {
  if (!download) return null;
  const suggested = download.suggestedFilename?.() || `${savePathPrefix}.mp4`;
  const safeName = suggested.replace(/[^a-zA-Z0-9._-]/g, '_');
  const savePath = path.join(DOWNLOAD_DIR, `${savePathPrefix}-${safeName}`);
  await download.saveAs(savePath);
  console.log(`[${jobId}] Đã tải file qua ${sourceLabel}: ${savePath}`);
  return savePath;
}


async function isLocatorVisible(page, selector, timeout = 900) {
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function clickVisibleCenter(page, selector, timeout = 1500) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout });
  await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => null);
  const box = await locator.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await locator.click({ timeout });
  }
}

async function clickVideoDownloadConfirmationIfVisible(page, jobId) {
  const clicked = await page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 12 && r.height > 12 && r.bottom > 0 && r.right > 0 &&
        r.top < window.innerHeight && r.left < window.innerWidth &&
        s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0;
    };
    const textOf = (el) => String([
      el.innerText,
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('data-testid'),
    ].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();

    const wanted = [
      /^Download video$/i,
      /^Download$/i,
      /^Tải xuống$/i,
      /^Export$/i,
      /^Save$/i,
      /MP4/i,
      /1080p|720p|HD|High quality/i,
    ];

    const nodes = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],a,li,div,span'))
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = textOf(el);
        const clickable = el.closest('button,[role="button"],[role="menuitem"],[role="option"],a,li') || el;
        const cr = clickable.getBoundingClientRect();
        const inOverlay = Boolean(el.closest('[role="menu"],[role="dialog"],[role="listbox"],[data-radix-popper-content-wrapper]'));
        let score = 0;
        if (wanted.some((rx) => rx.test(text))) score += 500;
        if (/download|tải|export|save/i.test(text)) score += 250;
        if (/mp4|1080p|720p|hd|high quality/i.test(text)) score += 220;
        if (inOverlay) score += 220;
        if (clickable.matches('button,[role="button"],[role="menuitem"],[role="option"],a')) score += 120;
        if (cr.top < 80) score -= 600;
        if (/new project|start creating|settings|help|search|more options/i.test(text)) score -= 500;
        if (text.length > 120) score -= 150;
        return { el: clickable, text, score, x: Math.round(cr.left + cr.width / 2), y: Math.round(cr.top + cr.height / 2) };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = nodes[0];
    if (!best || best.score < 450) return null;
    best.el.click();
    return { text: best.text.slice(0, 100), x: best.x, y: best.y, score: best.score };
  }).catch(() => null);

  if (clicked) {
    await setStatus(jobId, 'FETCHING_RESULTS', `Xác nhận menu tải video: ${clicked.text || 'download option'} tại ${clicked.x},${clicked.y}.`).catch(() => null);
    await page.waitForTimeout(Number(env.FLOW_AFTER_DOWNLOAD_CONFIRM_DELAY_MS || 700));
    return clicked;
  }
  return null;
}

async function waitForDownloadAfterAction(page, action, savePathPrefix, jobId, sourceLabel, options = {}) {
  const timeout = Number(env.FLOW_DOWNLOAD_TIMEOUT_MS || 120000);
  const outputType = String(options.outputType || 'video').toLowerCase();
  const startedAt = Date.now();

  try {
    const downloadPromise = page.waitForEvent('download', { timeout }).catch((error) => {
      console.warn(`[${jobId}] Không có event download qua ${sourceLabel}: ${error.message}`);
      return null;
    });

    await action();

    let lastAssistAt = 0;
    while (Date.now() - startedAt < timeout) {
      const download = await Promise.race([
        downloadPromise,
        sleep(900).then(() => null),
      ]);
      if (download) return await savePlaywrightDownload(download, savePathPrefix, jobId, sourceLabel);

      if (Date.now() - lastAssistAt > 1800) {
        lastAssistAt = Date.now();
        if (outputType === 'image') {
          await clickFlowImageDownloadQuality(page, jobId, FLOW_IMAGE_DOWNLOAD_QUALITY).catch(() => null);
        } else {
          await clickVideoDownloadConfirmationIfVisible(page, jobId).catch(() => null);
        }
      }
    }

    return null;
  } catch (error) {
    console.warn(`[${jobId}] Lỗi khi chờ download qua ${sourceLabel}: ${error.message}`);
    return null;
  }
}

async function tryDownloadByClick(page, selectors, savePathPrefix, jobId, options = {}) {
  for (const selector of selectors) {
    const visible = await isLocatorVisible(page, selector, Number(env.FLOW_SELECTOR_VISIBLE_TIMEOUT_MS || 900));
    if (!visible) {
      console.warn(`[${jobId}] Bỏ qua selector download không thấy: ${selector}`);
      continue;
    }

    const savePath = await waitForDownloadAfterAction(
      page,
      async () => {
        await clickVisibleCenter(page, selector, 2500);
      },
      savePathPrefix,
      jobId,
      `selector ${selector}`,
      options
    );
    if (savePath) return savePath;
  }
  return null;
}

async function tryDownloadByCoordinates(page, savePathPrefix, jobId, options = {}) {
  const x = Number(env.FLOW_RESULT_DOWNLOAD_CLICK_X || env.FLOW_DOWNLOAD_CLICK_X || 0);
  const y = Number(env.FLOW_RESULT_DOWNLOAD_CLICK_Y || env.FLOW_DOWNLOAD_CLICK_Y || 0);
  if (!x || !y) return null;
  await setStatus(jobId, 'FETCHING_RESULTS', `Worker đang click tọa độ tải kết quả (${x}, ${y}).`);
  return waitForDownloadAfterAction(
    page,
    async () => {
      await page.mouse.click(x, y);
      await page.waitForTimeout(Number(env.FLOW_AFTER_DOWNLOAD_CLICK_DELAY_MS || 1200));
    },
    savePathPrefix,
    jobId,
    `tọa độ download ${x},${y}`,
    options
  );
}

async function tryDownloadFromOpenVideoOrNewTab(context, page, savePathPrefix, jobId) {
  const pagesBefore = context.pages();
  const maybeOpenSelectors = parseSelectorList(
    env.FLOW_OPEN_RESULT_SELECTOR,
    [
      'button:has-text("Open")',
      'a:has-text("Open")',
      'text=/Open|Mở|Preview|Xem/i',
      'video',
      '[role="button"]:has-text("Video")'
    ].join('||')
  );

  for (const selector of maybeOpenSelectors) {
    try {
      const popupPromise = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
      const clicked = await clickFirst(page, [selector], { required: false, timeout: 3500 });
      if (!clicked) continue;
      const popup = await popupPromise;
      const targetPage = popup || context.pages().find((p) => !pagesBefore.includes(p)) || page;
      await targetPage.waitForTimeout(1500).catch(() => null);
      const candidates = await collectVideoCandidates(targetPage);
      for (const candidate of candidates) {
        let saved = null;
        if (candidate.url.startsWith('http')) saved = await saveHttpVideoCandidate(context, candidate, savePathPrefix, jobId);
        else if (candidate.url.startsWith('blob:')) saved = await saveBlobVideoCandidate(targetPage, candidate, savePathPrefix, jobId);
        if (saved) return saved;
      }
    } catch (error) {
      console.warn(`[${jobId}] Không mở/quét được result qua ${selector}: ${error.message}`);
    }
  }
  return null;
}

async function tryDownloadFromMenu(page, savePathPrefix, jobId, options = {}) {
  const menuSelectors = parseSelectorList(
    env.FLOW_RESULT_MENU_SELECTOR,
    [
      'button[aria-label*="More" i]',
      'button[aria-label*="Menu" i]',
      'button[aria-label*="Actions" i]',
      'button:has-text("More")',
      'text=/More|Menu|Actions|Thêm/i',
      '[data-testid*="more" i]',
      '[data-testid*="menu" i]'
    ].join('||')
  );
  const downloadSelectors = parseSelectorList(
    env.FLOW_RESULT_DOWNLOAD_SELECTOR,
    [
      'text=/Download|Tải xuống|Export|Save/i',
      'button:has-text("Download")',
      'a:has-text("Download")',
      '[role="menuitem"]:has-text("Download")',
      '[role="menuitem"]:has-text("Tải xuống")'
    ].join('||')
  );

  for (const menuSelector of menuSelectors) {
    try {
      await clickFirst(page, [menuSelector], { required: true, timeout: 5000 });
      await page.waitForTimeout(900);
      const saved = await tryDownloadByClick(page, downloadSelectors, savePathPrefix, jobId, options);
      if (saved) return saved;
      await page.keyboard.press('Escape').catch(() => null);
    } catch (error) {
      await page.keyboard.press('Escape').catch(() => null);
    }
  }
  return null;
}


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
        ? 'img,canvas'
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
          else if (normalizedOutputType !== 'image' && /more|menu|action|option|thêm|more_vert|⋮|︙|ellipsis/i.test(label)) kind = 'more';
          else if (normalizedOutputType !== 'image' && !label && inTopRightOfMedia && r.width <= 70 && r.height <= 70) kind = 'maybe-more';

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


async function captureLargestImageResult(page, savePathPrefix, jobId) {
  // Fallback riêng cho job ảnh: không click More/Download toàn trang nữa.
  // Chụp đúng vùng ảnh/canvas lớn nhất đang hiển thị để tránh tải nhầm MP4 preview/candidate.
  const minY = Number(env.FLOW_IMAGE_RESULT_MIN_Y || env.FLOW_VIDEO_RESULT_MIN_Y || 80);
  const minArea = Number(env.FLOW_IMAGE_CAPTURE_MIN_AREA || 50000);
  const image = await page.evaluate(({ minY, minArea }) => {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 80 && r.height > 60 && r.bottom > 0 && r.right > 0 &&
        r.top < window.innerHeight && r.left < window.innerWidth &&
        s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0;
    };
    const items = Array.from(document.querySelectorAll('img,canvas'))
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        const src = el.currentSrc || el.src || el.getAttribute('src') || '';
        let score = area;
        if (r.top < minY) score -= 1000000;
        if (area < minArea) score -= 800000;
        if (r.width < 250 || r.height < 180) score -= 500000;
        if (r.left > window.innerWidth * 0.78 && area < 250000) score -= 700000;
        if (/avatar|icon|logo|profile|sprite|thumb/i.test(src)) score -= 600000;
        if (el.tagName === 'CANVAS') score += 30000;
        return {
          x: Math.max(0, Math.round(r.left)),
          y: Math.max(0, Math.round(r.top)),
          width: Math.min(Math.round(r.width), Math.round(window.innerWidth - Math.max(0, r.left))),
          height: Math.min(Math.round(r.height), Math.round(window.innerHeight - Math.max(0, r.top))),
          cx: Math.round(r.left + r.width / 2),
          cy: Math.round(r.top + r.height / 2),
          tag: el.tagName,
          area: Math.round(area),
          score,
        };
      })
      .filter((item) => item.width > 20 && item.height > 20 && item.score > 0)
      .sort((a, b) => b.score - a.score);
    return items[0] || null;
  }, { minY, minArea }).catch(() => null);

  if (!image) {
    console.warn(`[${jobId}] Không tìm thấy ảnh/canvas lớn để capture fallback.`);
    return null;
  }

  await setStatus(jobId, 'FETCHING_RESULTS', `Không tải được ảnh bằng nút card. Worker capture vùng ảnh ${image.tag} ${image.width}x${image.height} để tránh nhầm video.`).catch(() => null);
  await page.mouse.move(image.cx, image.cy).catch(() => null);
  await page.waitForTimeout(Number(env.FLOW_AFTER_RESULT_HOVER_DELAY_MS || 700)).catch(() => null);

  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  const savePath = path.join(DOWNLOAD_DIR, `${savePathPrefix}-captured-image.png`);
  await page.screenshot({
    path: savePath,
    clip: {
      x: image.x,
      y: image.y,
      width: Math.max(1, image.width),
      height: Math.max(1, image.height),
    },
  });
  console.log(`[${jobId}] Đã capture ảnh kết quả từ card ${image.tag}: ${savePath}`);
  return savePath;
}

async function collectVideoCandidates(page) {
  if (!page || page.isClosed?.()) return [];
  return page.evaluate(() => {
    const candidates = [];
    const push = (url, kind, label = '') => {
      if (!url || typeof url !== 'string') return;
      let normalized = url.replace(/&amp;/g, '&').trim();
      try { normalized = decodeURI(normalized); } catch { }
      if (!/^https?:|^blob:|^data:video\//i.test(normalized)) return;
      if (!/video|mp4|webm|mov|download|export|videoplayback|googleusercontent|blob:|data:video\//i.test(normalized + ' ' + kind + ' ' + label)) return;
      if (candidates.some((item) => item.url === normalized)) return;
      candidates.push({ url: normalized, kind, label });
    };

    const scanRoot = (root, rootLabel = 'document') => {
      if (!root?.querySelectorAll) return;
      for (const video of Array.from(root.querySelectorAll('video'))) {
        push(video.currentSrc || video.src, `${rootLabel}:video.currentSrc`, video.getAttribute('aria-label') || video.outerHTML?.slice?.(0, 80) || '');
        for (const source of Array.from(video.querySelectorAll('source'))) push(source.src, `${rootLabel}:video.source`, source.type || '');
        const poster = video.getAttribute('poster');
        if (poster) push(poster, `${rootLabel}:video.poster`, 'poster');
      }
      for (const source of Array.from(root.querySelectorAll('source[src]'))) push(source.src, `${rootLabel}:source`, source.type || '');
      for (const a of Array.from(root.querySelectorAll('a[href]'))) push(a.href, `${rootLabel}:a.href`, a.textContent || a.getAttribute('aria-label') || '');
      for (const el of Array.from(root.querySelectorAll('[src],[href],[data-src],[data-url],[data-download-url]'))) {
        for (const attr of ['src', 'href', 'data-src', 'data-url', 'data-download-url']) {
          const value = el.getAttribute?.(attr);
          if (value) push(value, `${rootLabel}:${attr}`, el.textContent || el.getAttribute('aria-label') || '');
        }
      }
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (el.shadowRoot) scanRoot(el.shadowRoot, `${rootLabel}:shadow`);
      }
    };

    scanRoot(document, 'document');

    try {
      for (const entry of performance.getEntriesByType('resource')) {
        push(entry.name, 'performance.resource', entry.initiatorType || '');
      }
    } catch { }

    try {
      const html = document.documentElement?.innerHTML || '';
      const urlMatches = html.match(/https?:\/\/[^"'<>\s\)]+/gi) || [];
      for (const raw of urlMatches) push(raw, 'html.url', '');
      const blobMatches = html.match(/blob:[^"'<>\s\)]+/gi) || [];
      for (const raw of blobMatches) push(raw, 'html.blob', '');
    } catch { }

    return candidates;
  });
}

async function saveHttpVideoCandidate(context, candidate, savePathPrefix, jobId) {
  if (!candidate?.url || !candidate.url.startsWith('http')) return null;
  try {
    const response = await context.request.get(candidate.url, { timeout: Number(env.FLOW_CANDIDATE_FETCH_TIMEOUT_MS || 90000) });
    if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
    const bytes = await response.body();
    if (!bytes?.length) throw new Error('candidate rỗng');
    const contentType = response.headers()['content-type'] || '';
    const ext = contentType.includes('image') ? '.png' : '.mp4';
    const savePath = path.join(DOWNLOAD_DIR, `${savePathPrefix}-candidate${ext}`);
    await fs.writeFile(savePath, bytes);
    console.log(`[${jobId}] Đã tải candidate HTTP ${candidate.kind}: ${savePath}`);
    return savePath;
  } catch (error) {
    console.warn(`[${jobId}] Không tải được candidate HTTP ${candidate.url.slice(0, 120)}: ${error.message}`);
    return null;
  }
}

async function saveBlobVideoCandidate(page, candidate, savePathPrefix, jobId) {
  if (!candidate?.url || !candidate.url.startsWith('blob:')) return null;
  try {
    const maxMb = Number(env.FLOW_VIDEO_BLOB_MAX_MB || 300);
    const dataUrl = await page.evaluate(async ({ url, maxMb }) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Blob fetch failed ${res.status}`);
      const blob = await res.blob();
      if (blob.size > maxMb * 1024 * 1024) throw new Error(`Blob lớn hơn ${maxMb}MB`);
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
    }, { url: candidate.url, maxMb });
    const [prefix, base64] = String(dataUrl).split(',');
    if (!base64) throw new Error('Không đọc được base64 từ blob.');
    const mime = prefix.match(/^data:(.*?);base64$/)?.[1] || 'video/mp4';
    const ext = mime.includes('image') ? '.png' : '.mp4';
    const savePath = path.join(DOWNLOAD_DIR, `${savePathPrefix}-blob${ext}`);
    await fs.writeFile(savePath, Buffer.from(base64, 'base64'));
    console.log(`[${jobId}] Đã lưu blob video: ${savePath}`);
    return savePath;
  } catch (error) {
    console.warn(`[${jobId}] Không lưu được blob candidate: ${error.message}`);
    return null;
  }
}

async function downloadOrCaptureResult({ context, page, job, prompt, promptIndex }) {
  const savePathPrefix = `${job.jobId}-${promptIndex + 1}`;
  const outputType = getJobOutputType(job);
  await setStatus(job.jobId, 'FETCHING_RESULTS', `Đang lấy kết quả ${promptIndex + 1}.`);

  if (!page || page.isClosed?.()) throw new Error('Trang Flow đã bị đóng trước khi lấy kết quả.');
  const readySelector = await waitForAnyResultSignal(page, job.jobId);
  if (readySelector) {
    await setStatus(job.jobId, 'FETCHING_RESULTS', `Đã thấy dấu hiệu video/kết quả: ${readySelector}. Worker đang thử tải.`);
  } else {
    await setStatus(job.jobId, 'FETCHING_RESULTS', 'Chưa thấy nút tải rõ ràng. Worker vẫn sẽ quét video trong trang.');
  }

  const directDownloadSelectors = parseSelectorList(
    env.FLOW_RESULT_DOWNLOAD_SELECTOR,
    [
      'a[download]',
      'a[href*="download" i]',
      'button[aria-label*="Download" i]',
      'button[aria-label*="Tải" i]',
      'button:has-text("Download")',
      'a:has-text("Download")',
      'text=/Download|Tải xuống|Export|Save/i'
    ].join('||')
  );

  let savePath = await tryDownloadByCoordinates(page, savePathPrefix, job.jobId, { outputType });
  if (!savePath) savePath = await tryDownloadFromVideoMoreDropdown(page, savePathPrefix, job.jobId, outputType);

  if (outputType === 'image') {
    // Tuyệt đối không fallback sang click Download/More toàn trang hoặc quét video candidate cho job ảnh.
    // Các đường đó là nguyên nhân bấm nhầm dấu 3 chấm và tải MP4 preview/candidate.
    if (!savePath) savePath = await captureLargestImageResult(page, savePathPrefix, job.jobId);
  } else {
    if (!savePath) savePath = await tryDownloadByClick(page, directDownloadSelectors, savePathPrefix, job.jobId, { outputType });
    if (!savePath) savePath = await tryDownloadFromMenu(page, savePathPrefix, job.jobId, { outputType });
    if (!savePath) savePath = await tryDownloadFromOpenVideoOrNewTab(context, page, savePathPrefix, job.jobId);
  }

  if (!savePath && outputType !== 'image') {
    const candidates = await collectVideoCandidates(page);

    console.log(
      `[${job.jobId}] Video candidates:`,
      candidates.map((item) => ({
        kind: item.kind,
        url: item.url.slice(0, 120),
        label: item.label?.slice?.(0, 40),
      }))
    );

    // Không dùng preview currentSrc làm file kết quả cuối,
    // vì Flow thường trả preview/stream segment, dễ thành MP4 lỗi.
    const safeCandidates = candidates.filter((item) => {
      const kind = String(item.kind || '').toLowerCase();
      const url = String(item.url || '').toLowerCase();

      if (kind.includes('video.currentsrc')) return false;
      if (kind.includes('video.poster')) return false;
      if (kind.includes('performance.resource') && !url.includes('.mp4') && !url.includes('download')) return false;

      return url.includes('.mp4') || url.includes('download') || url.includes('export');
    });

    for (const candidate of safeCandidates) {
      if (candidate.url.startsWith('http')) {
        savePath = await saveHttpVideoCandidate(context, candidate, savePathPrefix, job.jobId);
      } else if (candidate.url.startsWith('blob:')) {
        savePath = await saveBlobVideoCandidate(page, candidate, savePathPrefix, job.jobId);
      }
      if (savePath) break;
    }
  }

  if (!savePath) {
    await saveDebugArtifacts(page, job.jobId, 'no-download-found');
    throw new Error('Flow đã tạo video nhưng Worker chưa tìm được nút/link tải. Đã lưu screenshot/html debug trong .flow-downloads.');
  }

  const mediaPath = await normalizeDownloadedMediaPath(savePath, job.jobId, savePathPrefix, outputType);
  if ((job.tool === 'image-to-video' || job.outputType === 'video') && !isVideoFilePath(mediaPath)) {
    await saveDebugArtifacts(page, job.jobId, 'downloaded-not-video').catch(() => null);
    throw new Error(`Image-to-video phải trả về video. Worker đã bỏ qua header/topbar More nhưng vẫn tải được file không phải video: ${path.basename(mediaPath)}. Dừng lại để tránh trả ảnh về kết quả.`);
  }
  if (outputType === 'image' && !isImageFilePath(mediaPath)) {
    await saveDebugArtifacts(page, job.jobId, 'downloaded-not-image').catch(() => null);
    throw new Error(`Job ảnh phải trả về ảnh. Worker tải được file không phải ảnh: ${path.basename(mediaPath)}. Dừng lại để tránh trả video/mock về kết quả ảnh.`);
  }
  await uploadResultFile(job, mediaPath, {
    prompt,
    promptIndex,
    // Mark complete only after the last generated item, including videosPerPrompt multiplier.
    complete: promptIndex >= Math.max(0, (Number(job.requestedCount || 0) || ((Array.isArray(job.prompts) ? job.prompts.length : 1) * Math.max(1, Number(job.videosPerPrompt || 1)))) - 1),
  });

  return { type: 'file', path: mediaPath };
}

async function waitWithTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout sau ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function clickRealFlowPromptBox(page, jobId) {
  const point = await page.evaluate(() => {
    const BAD_WORDS = /Go Back|More options|Search|Sort|Filter|Add Media|Scenebuilder|View Tile|Grid Settings|help|settings|download|menu/i;

    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 20 && r.height > 15 && r.bottom > 0 && r.right > 0 &&
        r.top < window.innerHeight && r.left < window.innerWidth &&
        style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
    }

    function textOf(el) {
      return [
        el.getAttribute('placeholder'),
        el.getAttribute('aria-label'),
        el.getAttribute('aria-placeholder'),
        el.getAttribute('data-placeholder'),
        el.getAttribute('title'),
        el.innerText,
        el.textContent,
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    function badAncestor(el) {
      const bad = el.closest('[role="search"], form[role="search"], header, nav, aside, [aria-label*="search" i], [data-testid*="search" i]');
      if (bad) return true;
      const container = el.closest('[role="dialog"], [aria-modal="true"], [data-radix-popper-content-wrapper], [data-testid*="search" i]');
      if (!container) return false;
      const t = textOf(container);
      return /Search|Sort|Filter|More options|Grid Settings/i.test(t);
    }

    function candidateScore(el) {
      const r = el.getBoundingClientRect();
      const text = textOf(el);
      const lower = text.toLowerCase();
      const type = String(el.getAttribute('type') || '').toLowerCase();
      if (type === 'search' || type === 'email' || type === 'password') return -9999;
      if (BAD_WORDS.test(text) || /search|filter|sort|email|password|login|sign in|đăng nhập/.test(lower)) return -9999;
      if (badAncestor(el)) return -9999;
      if (r.top < window.innerHeight * 0.48) return -9999; // prompt composer is the bottom input, never the top search box
      if (r.width * r.height > window.innerWidth * window.innerHeight * 0.45) return -9999;

      let score = 0;
      if (/what do you want to create\?/i.test(text)) score += 1000;
      if (/prompt|describe|description|mô tả|ý tưởng|nhập/i.test(text)) score += 220;
      if (el.matches('textarea')) score += 160;
      if (el.matches('[contenteditable="true"]')) score += 150;
      if (el.matches('[role="textbox"]')) score += 140;
      if (r.width >= Math.min(360, window.innerWidth * 0.30)) score += 120;
      if (r.height >= 38 && r.height <= 220) score += 80;
      score += Math.min(250, r.top / window.innerHeight * 250); // prefer lower composer
      score += Math.min(160, r.width / 6);
      if (r.left > window.innerWidth * 0.05 && r.right < window.innerWidth * 0.98) score += 40;
      return score;
    }

    const editableSelectors = [
      'textarea',
      'input[type="text"]',
      'input:not([type])',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '[placeholder*="What do you want" i]',
      '[aria-label*="What do you want" i]',
      '[data-placeholder*="What do you want" i]',
      '[aria-placeholder*="What do you want" i]',
    ].join(',');

    const editables = [...document.querySelectorAll(editableSelectors)]
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const score = candidateScore(el);
        return { el, r, text: textOf(el), score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (editables.length) {
      const item = editables[0];
      const r = item.r;
      item.el.scrollIntoView({ block: 'center', inline: 'center' });
      return {
        x: Math.round(r.left + Math.min(Math.max(r.width * 0.20, 32), Math.max(32, r.width - 24))),
        y: Math.round(r.top + r.height / 2),
        label: item.text.slice(0, 120) || `bottom-editable score=${Math.round(item.score)}`,
      };
    }

    const labels = [...document.querySelectorAll('div,p,span,section,main,label')]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect(), text: textOf(el) }))
      .filter((x) => {
        if (!/What do you want to create/i.test(x.text)) return false;
        if (BAD_WORDS.test(x.text)) return false;
        if (badAncestor(x.el)) return false;
        if (x.r.top < window.innerHeight * 0.48) return false;
        if (x.text.length > 260) return false;
        if (x.r.width * x.r.height > 900 * 220) return false;
        return true;
      })
      .sort((a, b) => b.r.top - a.r.top || (b.r.width * b.r.height) - (a.r.width * a.r.height));

    if (labels.length) {
      const target = labels[0];
      const clickable = target.el.closest('[role="textbox"],[contenteditable="true"],textarea,input') || target.el;
      const r = clickable.getBoundingClientRect();
      return {
        x: Math.round(r.left + Math.min(Math.max(r.width * 0.20, 32), Math.max(32, r.width - 24))),
        y: Math.round(r.top + r.height / 2),
        label: target.text.slice(0, 120),
      };
    }

    // Last-resort bottom composer coordinate. This is safer than any top textbox/search match.
    return {
      x: Math.round(window.innerWidth * 0.32),
      y: Math.round(window.innerHeight * 0.88),
      label: 'fallback-bottom-composer',
    };
  });

  await setStatus(jobId, 'SUBMITTING_PROMPT', `Click ô prompt bottom Flow: ${point.label || 'bottom composer'} tại ${point.x},${point.y}`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(Number(env.FLOW_AFTER_PROMPT_DELAY_MS || 500));

  const activeInfo = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { ok: false, reason: 'no-active-element' };
    const r = el.getBoundingClientRect();
    const text = [
      el.getAttribute('type'),
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('data-placeholder'),
      el.getAttribute('aria-placeholder'),
      el.innerText,
      el.textContent,
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const bad = /search|filter|sort|email|password|login|sign in|đăng nhập/i.test(text) || String(el.getAttribute('type') || '').toLowerCase() === 'search';
    return { ok: !bad && r.top > window.innerHeight * 0.40, reason: text.slice(0, 120), rect: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) } };
  }).catch(() => ({ ok: true }));

  if (!activeInfo.ok) {
    await saveDebugArtifacts(page, jobId, 'wrong-active-input-search').catch(() => null);
    throw new Error(`Worker vừa focus nhầm ô không phải prompt bottom Flow: ${activeInfo.reason || 'unknown'}`);
  }

  return point;
}

async function clickFlowCreateButton(page, jobId, prompt = '') {
  if (String(prompt || '').trim()) {
    const verified = await verifyPromptVisibleInComposer(page, jobId, prompt, 'ngay trước khi bấm Create');
    if (!verified) {
      await saveDebugArtifacts(page, jobId, 'prompt-not-verified-before-create').catch(() => null);
      throw new Error('Prompt chưa nằm trong ô Flow nên worker không bấm Create/Generate.');
    }
  }

  const panelOpen = await isPanelStillOpen(page);
  if (panelOpen) {
    await saveDebugArtifacts(page, jobId, 'panel-open-before-create').catch(() => null);
    throw new Error('Panel setting/model vẫn mở trước khi bấm Create. Dừng để tránh bấm gửi sai.');
  }

  const point = await page.evaluate(({ prompt }) => {
    const needle = String(prompt || '').trim().slice(0, Math.min(28, String(prompt || '').trim().length));
    function visible(el) {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 12 &&
        r.height > 12 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < window.innerHeight &&
        r.left < window.innerWidth &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity || 1) > 0;
    }

    function textOf(el) {
      return [
        el.value,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.innerText,
        el.textContent,
        el.getAttribute('data-testid'),
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    function badAncestor(el) {
      return Boolean(el.closest('[role="search"], form[role="search"], header, nav, aside, [role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"], [data-testid*="search" i], [aria-label*="search" i]'));
    }

    const promptCandidates = [...document.querySelectorAll('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],div,p,span')]
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = textOf(el);
        let score = 0;
        if (needle && text.includes(needle)) score += 900;
        if (/What do you want to create\?|prompt|describe|description/i.test(text)) score += 180;
        if (r.top > window.innerHeight * 0.42) score += 220;
        if (r.width > 300) score += 120;
        if (badAncestor(el)) score -= 1000;
        if (/search|filter|sort|email|password|login|sign in|đăng nhập/i.test(text)) score -= 1000;
        return { r, text, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const composer = promptCandidates[0] || null;
    const composerRect = composer?.r || null;
    const bad = /New project|Start creating|Create with Flow|Create project|Download|More|Menu|Settings|Help|Search|Filter|Sort|Model|Nano Banana|Veo|Imagen|Image|Video|Frames|Ingredients|16:9|9:16|4:3|1:1|3:4/i;

    const candidates = [...document.querySelectorAll('button,[role="button"],a')]
      .filter(visible)
      .filter((el) => !badAncestor(el))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = textOf(el);

        let score = 0;
        if (/^(Create|Generate)$/i.test(text) || /Create|Generate|arrow_forward|send/i.test(text)) score += 300;

        // Nút tạo của Flow thường là nút tròn bên phải thanh prompt.
        if (r.top > window.innerHeight * 0.55) score += 120;
        if (r.left > window.innerWidth * 0.55) score += 120;
        if (r.width >= 30 && r.width <= 92 && r.height >= 30 && r.height <= 92) score += 180;

        if (composerRect) {
          const cy = r.top + r.height / 2;
          const py = composerRect.top + composerRect.height / 2;
          if (Math.abs(cy - py) <= 145) score += 260;
          if (r.left > composerRect.left + composerRect.width * 0.70) score += 260;
          if (r.left < composerRect.left + composerRect.width * 0.45) score -= 350;
        }

        if (bad.test(text)) score -= 800;
        if (r.top < 120) score -= 250;

        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          label: text.slice(0, 120),
          score,
        };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates[0] || null;
  }, { prompt });

  if (!point) {
    await setStatus(jobId, 'GENERATING', 'Không tìm thấy nút mũi tên/Create an toàn; không dùng Enter để tránh gửi nhầm.').catch(() => null);
    throw new Error('Không tìm thấy nút Create/Generate an toàn cạnh ô prompt Flow.');
  }

  await setStatus(jobId, 'GENERATING', `Bấm nút tạo thật tại ${point.x},${point.y}: ${point.label || 'arrow/create'}`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(Number(env.FLOW_AFTER_CREATE_CLICK_VERIFY_MS || 1400));

  if (await hasFlowPromptRequiredError(page)) {
    await saveDebugArtifacts(page, jobId, 'prompt-required-after-create').catch(() => null);
    throw new Error('Flow báo thiếu prompt sau khi bấm Create. Worker đã dừng để tránh gửi job rỗng.');
  }

  return point.label || 'dom-create-button';
}


async function getFlowSettingsPanelState(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 24 &&
        r.height > 24 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < window.innerHeight &&
        r.left < window.innerWidth &&
        s.display !== 'none' &&
        s.visibility !== 'hidden' &&
        Number(s.opacity || 1) > 0;
    };

    const textOf = (el) => norm([
      el.innerText,
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('data-testid'),
    ].filter(Boolean).join(' '));

    const bodyText = norm(document.body?.innerText || '');
    if (/Generating will use\s+\d+\s+credits|Generating will use\s+0\s+credits/i.test(bodyText)) {
      return { open: true, reason: 'credits-footer' };
    }

    const containers = Array.from(document.querySelectorAll([
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[data-radix-popper-content-wrapper]',
      '[role="menu"]',
      '[role="listbox"]',
      '[role="presentation"]',
      'mat-dialog-container',
      'div',
      'section',
    ].join(','))).filter(visible);

    let best = null;
    for (const el of containers) {
      const r = el.getBoundingClientRect();
      if (r.width > window.innerWidth * 0.88 && r.height > window.innerHeight * 0.72) continue;
      const text = textOf(el);
      if (!text || text.length > 2500) continue;

      const hasTabs = /\bImage\b[\s\S]{0,120}\bVideo\b|\bVideo\b[\s\S]{0,120}\bImage\b/i.test(text);
      const hasControls = /\bFrames\b|\bIngredients\b|\b16:9\b|\b9:16\b|\b4:3\b|\b1:1\b|\b3:4\b|\b4s\b|\b6s\b|\b8s\b|\bNano Banana\b|\bImagen\b|\bVeo\b/i.test(text);
      const hasFooter = /Generating will use\s+\d+\s+credits|Generating will use\s+0\s+credits/i.test(text);
      const looksLikePanel = hasFooter || (hasTabs && hasControls);
      if (!looksLikePanel) continue;

      let score = 0;
      if (hasFooter) score += 500;
      if (hasTabs) score += 220;
      if (hasControls) score += 180;
      if (r.top > window.innerHeight * 0.18) score += 80;
      if (r.height > 120) score += 60;
      if (r.width >= 260 && r.width <= 720) score += 60;

      if (!best || score > best.score) {
        best = {
          open: true,
          reason: hasFooter ? 'panel-footer' : 'panel-tabs-controls',
          score,
          rect: {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          },
          text: text.slice(0, 180),
        };
      }
    }

    return best || { open: false, reason: 'not-detected' };
  }).catch(() => ({ open: false, reason: 'evaluate-failed' }));
}

async function isPanelStillOpen(page) {
  const state = await getFlowSettingsPanelState(page);
  return Boolean(state?.open);
}

async function hasFlowPromptRequiredError(page) {
  return page.evaluate(() => /prompt must be provided|prompt is required|enter a prompt|please provide a prompt|add a prompt|type a prompt/i.test(String(document.body?.innerText || ''))).catch(() => false);
}

async function getFlowPromptVerification(page, prompt) {
  const expected = String(prompt || '').trim();
  const needle = expected.slice(0, Math.min(28, expected.length));
  return page.evaluate(({ needle }) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 10 &&
        r.height > 10 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < window.innerHeight &&
        r.left < window.innerWidth &&
        s.display !== 'none' &&
        s.visibility !== 'hidden' &&
        Number(s.opacity || 1) > 0;
    };
    const textOf = (el) => norm([
      el.value,
      el.innerText,
      el.textContent,
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('data-placeholder'),
      el.getAttribute?.('aria-placeholder'),
    ].filter(Boolean).join(' '));
    const badContainer = (el) => Boolean(el.closest('[role="search"], form[role="search"], header, nav, aside, [data-testid*="search" i], [aria-label*="search" i], [role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]'));
    const active = document.activeElement;
    const activeRect = active?.getBoundingClientRect?.();
    const activeText = active ? textOf(active) : '';
    const activeBad = Boolean(active && (
      /search|filter|sort|email|password|login|sign in|đăng nhập/i.test(activeText) ||
      /search|email|password/i.test(String(active?.getAttribute?.('type') || '')) ||
      ((activeRect && activeRect.top < window.innerHeight * 0.38) && !/what do you want to create|prompt|describe/i.test(activeText)) ||
      badContainer(active)
    ));

    const candidates = Array.from(document.querySelectorAll('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],div,p,span'))
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = textOf(el);
        return {
          el,
          text,
          rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
          bottom: r.top > window.innerHeight * 0.38,
          bad: badContainer(el) || /search|filter|sort|email|password|login|sign in|đăng nhập/i.test(text),
        };
      });

    const match = candidates.find((item) => item.bottom && !item.bad && needle && item.text.includes(needle));
    return {
      ok: Boolean(match) && !activeBad,
      foundText: match?.text?.slice(0, 160) || '',
      foundRect: match?.rect || null,
      activeBad: Boolean(activeBad),
      activeText: activeText.slice(0, 160),
      activeTag: active ? String(active.tagName || '').toLowerCase() : '',
      activeRect: activeRect ? { x: Math.round(activeRect.left), y: Math.round(activeRect.top), width: Math.round(activeRect.width), height: Math.round(activeRect.height) } : null,
    };
  }, { needle }).catch((error) => ({ ok: false, reason: error.message }));
}

async function verifyPromptVisibleInComposer(page, jobId, prompt, stage = 'sau nhập prompt') {
  const verification = await getFlowPromptVerification(page, prompt);
  if (verification?.ok) {
    await setStatus(jobId, 'SUBMITTING_PROMPT', `Đã xác nhận prompt nằm trong ô Flow ${stage}.`).catch(() => null);
    return true;
  }
  await setStatus(
    jobId,
    'SUBMITTING_PROMPT',
    `Chưa xác nhận được prompt trong ô Flow ${stage}; worker sẽ không bấm gửi. Active=${verification?.activeTag || 'unknown'} ${verification?.activeText || verification?.reason || ''}`
  ).catch(() => null);
  return false;
}

async function closeFlowSettingsPanel(page, jobId, options = {}) {
  const strict = options.strict !== false;
  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(Number(env.FLOW_AFTER_CLOSE_SETTINGS_DELAY_MS || 650));

  const maxAttempts = Number(env.FLOW_CLOSE_SETTINGS_MAX_ATTEMPTS || 7);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const state = await getFlowSettingsPanelState(page);
    if (!state?.open) break;

    await setStatus(jobId, 'SETTING_FLOW', `Panel setting vẫn mở (${state.reason || 'unknown'}, lần ${attempt + 1}/${maxAttempts}). Worker đóng panel trước khi nhập prompt.`).catch(() => null);

    const point = await page.evaluate(() => {
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 80 && r.height > 20 && r.bottom > 0 && r.right > 0 &&
          r.top < window.innerHeight && r.left < window.innerWidth &&
          s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0;
      };
      const textOf = (el) => String(
        el.getAttribute?.('placeholder') ||
        el.getAttribute?.('aria-label') ||
        el.getAttribute?.('data-placeholder') ||
        el.getAttribute?.('aria-placeholder') ||
        el.innerText ||
        el.textContent ||
        ''
      ).replace(/\s+/g, ' ').trim();
      const nodes = Array.from(document.querySelectorAll('textarea,[role="textbox"],[contenteditable="true"],div,span'))
        .filter(visible)
        .map((el) => ({ el, r: el.getBoundingClientRect(), text: textOf(el) }))
        .filter((x) => /What do you want to create/i.test(x.text) && x.r.top > window.innerHeight * 0.45)
        .sort((a, b) => b.r.top - a.r.top);
      const item = nodes[0];
      if (item) {
        return {
          x: Math.round(item.r.left + Math.min(Math.max(item.r.width * 0.18, 36), Math.max(36, item.r.width - 24))),
          y: Math.round(item.r.top + item.r.height / 2),
          label: item.text.slice(0, 120),
        };
      }
      return { x: Math.round(window.innerWidth * 0.18), y: Math.round(window.innerHeight * 0.86), label: 'outside-bottom-left' };
    }).catch(() => null);

    if (point) await page.mouse.click(point.x, point.y).catch(() => null);
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(Number(env.FLOW_AFTER_CLOSE_SETTINGS_DELAY_MS || 650));
  }

  const finalState = await getFlowSettingsPanelState(page);
  if (finalState?.open) {
    await saveDebugArtifacts(page, jobId, 'settings-panel-still-open').catch(() => null);
    const message = `Panel setting/model vẫn mở (${finalState.reason || 'unknown'}). Dừng job để tránh bấm gửi khi chưa nhập prompt.`;
    await setStatus(jobId, 'SETTING_FLOW', message).catch(() => null);
    if (strict) throw new Error(message);
  } else {
    await setStatus(jobId, 'SETTING_FLOW', 'Panel setting/model đã đóng. Chuẩn bị nhập prompt.').catch(() => null);
  }

  await page.waitForTimeout(Number(env.FLOW_AFTER_CLOSE_PANEL_BUFFER_MS || 450));
}

async function insertPromptIntoFocusedComposer(page, jobId, prompt) {
  const text = String(prompt || '');
  const domResult = await page.evaluate(({ text }) => {
    const el = document.activeElement;
    if (!el) return { ok: false, reason: 'no-active-element' };

    const tag = String(el.tagName || '').toLowerCase();
    const type = String(el.getAttribute?.('type') || '').toLowerCase();
    const isEditable = tag === 'textarea' || tag === 'input' || el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('role') === 'textbox';
    const bad = type === 'search' || type === 'email' || type === 'password';
    if (!isEditable || bad) return { ok: false, reason: `active-not-composer:${tag}:${type}` };

    const dispatchInput = (target, value) => {
      try {
        target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
      } catch { }
      try {
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      } catch {
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      target.dispatchEvent(new Event('change', { bubbles: true }));
    };

    if (tag === 'textarea' || tag === 'input') {
      const proto = tag === 'textarea' ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (descriptor?.set) descriptor.set.call(el, '');
      else el.value = '';
      dispatchInput(el, '');
      if (descriptor?.set) descriptor.set.call(el, text);
      else el.value = text;
      dispatchInput(el, text);
      return { ok: true, method: `native-${tag}`, length: text.length };
    }

    el.focus();
    const selection = window.getSelection?.();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, text);
    } catch {
      el.textContent = text;
    }
    dispatchInput(el, text);

    const current = String(el.innerText || el.textContent || '');
    if (!current.includes(text.slice(0, Math.min(30, text.length)))) {
      el.textContent = text;
      dispatchInput(el, text);
    }
    return { ok: true, method: 'contenteditable-fast', length: text.length };
  }, { text }).catch((error) => ({ ok: false, reason: error.message }));

  if (domResult?.ok) {
    await setStatus(jobId, 'SUBMITTING_PROMPT', `Đã nhập prompt nhanh bằng ${domResult.method}, ${domResult.length} ký tự.`).catch(() => null);
    return domResult.method;
  }

  await setStatus(jobId, 'SUBMITTING_PROMPT', `DOM paste chưa được (${domResult?.reason || 'unknown'}), dùng keyboard.insertText fallback.`).catch(() => null);
  try {
    await page.keyboard.insertText(text);
    return 'keyboard-insertText';
  } catch {
    await page.keyboard.type(text, { delay: Number(env.FLOW_KEYBOARD_TYPE_DELAY_MS || 0) });
    return 'keyboard-type-fallback';
  }
}

async function submitPromptAndCreateStrict(page, jobId, prompt) {
  const promptText = String(prompt || '').trim();
  if (!promptText) throw new Error('Prompt rỗng, worker không gửi lên Flow.');

  // Luôn đóng panel setting/model trước khi nhập. Nếu không đóng được thì dừng,
  // tuyệt đối không click Create khi prompt chưa nằm trong composer thật.
  await closeFlowSettingsPanel(page, jobId, { strict: true });

  await clickRealFlowPromptBox(page, jobId);

  const panelOpenAfterClick = await isPanelStillOpen(page);
  if (panelOpenAfterClick) {
    await setStatus(jobId, 'SUBMITTING_PROMPT', 'Click ô prompt vô tình mở panel setting/model. Đóng panel và click lại prompt.').catch(() => null);
    await closeFlowSettingsPanel(page, jobId, { strict: true });
    await clickRealFlowPromptBox(page, jobId);
  }

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
  await page.keyboard.press('Backspace').catch(() => null);
  await insertPromptIntoFocusedComposer(page, jobId, promptText);
  await page.waitForTimeout(Number(env.FLOW_AFTER_PROMPT_DELAY_MS || 450));

  let verified = await verifyPromptVisibleInComposer(page, jobId, promptText, 'sau lần nhập thứ nhất');
  if (!verified) {
    await setStatus(jobId, 'SUBMITTING_PROMPT', 'Prompt chưa vào composer sau lần 1, worker thử focus và nhập lại lần 2.').catch(() => null);
    await closeFlowSettingsPanel(page, jobId, { strict: true });
    await clickRealFlowPromptBox(page, jobId);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
    await page.keyboard.press('Backspace').catch(() => null);
    await page.keyboard.insertText(promptText).catch(async () => {
      await page.keyboard.type(promptText, { delay: Number(env.FLOW_KEYBOARD_TYPE_DELAY_MS || 4) });
    });
    await page.waitForTimeout(Number(env.FLOW_AFTER_PROMPT_DELAY_MS || 550));
    verified = await verifyPromptVisibleInComposer(page, jobId, promptText, 'sau lần nhập thứ hai');
  }

  if (!verified) {
    await saveDebugArtifacts(page, jobId, 'prompt-not-in-composer').catch(() => null);
    throw new Error('Không xác nhận được prompt đã nằm trong ô Flow. Worker dừng, không bấm Create/Generate.');
  }

  await closeFlowSettingsPanel(page, jobId, { strict: true });
  await clickFlowCreateButton(page, jobId, promptText);
}


async function getOrCreateBrowserContext() {
  if (FLOW_KEEP_BROWSER_OPEN && CACHED_BROWSER_CONTEXT) {
    try {
      const pages = CACHED_BROWSER_CONTEXT.pages();
      if (pages.some((page) => !page.isClosed?.())) return CACHED_BROWSER_CONTEXT;
    } catch {
      CACHED_BROWSER_CONTEXT = null;
    }
  }

  const context = await launchFlowBrowserContext(CHROME_PROFILE_DIR, 'windows-flow-worker');

  if (FLOW_KEEP_BROWSER_OPEN) {
    CACHED_BROWSER_CONTEXT = context;
    context.on('close', () => {
      if (CACHED_BROWSER_CONTEXT === context) CACHED_BROWSER_CONTEXT = null;
    });
  }

  return context;
}

async function automateWithPlaywright(job) {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  await setStatus(job.jobId, 'OPENING_FLOW', FLOW_KEEP_BROWSER_OPEN && CACHED_BROWSER_CONTEXT
    ? 'Worker dùng lại Chrome Flow đã mở.'
    : 'Worker đang mở Chrome và vào Flow.');

  const context = await getOrCreateBrowserContext();

  const page = context.pages()[0] || await context.newPage();
  const heartbeatTimer = setInterval(() => heartbeat(job.jobId, 'Worker vẫn đang thao tác Flow.'), HEARTBEAT_INTERVAL_MS);

  try {
    await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(Number(env.FLOW_AFTER_OPEN_DELAY_MS || 5000));
    await enableCoordinateLogger(page).catch(() => null);
    await clickFlowStageButtons(page, job.jobId).catch(() => null);

    const inputPath = await downloadInputAsset(job);
    const endInputPath = await downloadEndInputAsset(job);
    const prompts = job.prompts?.length ? job.prompts : [job.prompt].filter(Boolean);
    const videosPerPrompt = Math.max(1, Math.min(Number(job.videosPerPrompt || env.FLOW_VIDEOS_PER_PROMPT || 1), 4));
    const promptTasks = prompts.flatMap((prompt, promptIndex) =>
      Array.from({ length: videosPerPrompt }, (_, outputIndex) => ({ prompt, promptIndex, outputIndex }))
    );
    const downloadedFiles = [];

    const newProjectSelectors = parseSelectorList(
      env.FLOW_NEW_PROJECT_SELECTOR,
      'button:has-text("New project")||[role="button"]:has-text("New project")||text=/New project|Create project|Start new|New video|Dự án mới|Tạo mới/i'
    );

    const promptSelectors = parseSelectorList(
      env.FLOW_PROMPT_SELECTOR,
      'textarea[placeholder*="create" i]||textarea[aria-label*="prompt" i]||[contenteditable="true"][aria-label*="prompt" i]||div[aria-label*="prompt" i]||div[aria-placeholder*="prompt" i]||input[placeholder*="Describe" i]||[data-placeholder*="prompt" i]||[placeholder*="Describe" i]||text=/What do you want to create\\?/i'
    );

    const uploadSelector = env.FLOW_FILE_INPUT_SELECTOR || 'input[type="file"]';

    await clickFlowStageButtons(page, job.jobId).catch(() => null);
    await waitForFlowPromptOrManualLogin(page, job.jobId, promptSelectors);
    await ensureFlowComposerReady(page, job.jobId, promptSelectors, newProjectSelectors);

    for (let i = 0; i < promptTasks.length; i += 1) {
      const { prompt } = promptTasks[i];

      const outputType = getJobOutputType(job);
      const outputLabel = outputType === 'image' ? 'ảnh' : 'video';
      const modelPref = inferModelPreference(job);

      await setStatus(job.jobId, 'CREATING_PROJECT', `Đang tạo ${outputLabel} ${i + 1}/${promptTasks.length} ...`);

      if (i > 0) {
        await clickFirst(page, newProjectSelectors, { required: false, timeout: 4500 }).catch(() => null);
        await clickFlowStageButtons(page, job.jobId).catch(() => null);
        await page.waitForTimeout(Number(env.FLOW_AFTER_NEW_PROJECT_DELAY_MS || 1800));
      }

      await ensureFlowComposerReady(page, job.jobId, promptSelectors, newProjectSelectors);

      await setStatus(
        job.jobId,
        'SETTING_FLOW',
        `Job yêu cầu output=${outputType}, model=${modelPref.raw || '(trống)'}.`
      );

      if (String(env.FLOW_SKIP_SETTINGS || 'false').toLowerCase() === 'true') {
        await setStatus(job.jobId, 'SETTING_FLOW', 'Bỏ qua setting Flow theo FLOW_SKIP_SETTINGS=true.');
      } else if (job.tool === 'image-to-video') {
        await waitWithTimeout(
          ensureImageToVideoMode(page, job.jobId, job),
          Number(env.FLOW_IMAGE_TO_VIDEO_SETTING_TIMEOUT_MS || 45000),
          'ensureImageToVideoMode'
        );

        await waitWithTimeout(
          ensureFlowOutputMode(page, job.jobId, 'video'),
          Number(env.FLOW_MODE_SETTING_TIMEOUT_MS || 15000),
          'ensureFlowOutputMode(video)'
        );

        await waitWithTimeout(
          maybeSelectFlowModel(page, job.jobId, job),
          Number(env.FLOW_MODEL_SETTING_TIMEOUT_MS || 25000),
          'maybeSelectFlowModel'
        );

        await applyFlowSettingsRobust(page, job.jobId, {
          ...job,
          __modelAlreadySelected: true,
        }).catch(async (error) => {
          await setStatus(
            job.jobId,
            'SETTING_FLOW',
            `Đã chọn model video, bỏ qua setting phụ vì lỗi/timeout: ${error.message}`
          );
        });
      } else if (outputType === 'video') {
        await waitWithTimeout(
          ensureFlowOutputMode(page, job.jobId, 'video'),
          Number(env.FLOW_MODE_SETTING_TIMEOUT_MS || 15000),
          'ensureFlowOutputMode(video)'
        );

        await waitWithTimeout(
          maybeSelectFlowModel(page, job.jobId, job),
          Number(env.FLOW_MODEL_SETTING_TIMEOUT_MS || 25000),
          'maybeSelectFlowModel'
        );

        await applyFlowSettingsRobust(page, job.jobId, {
          ...job,
          __modelAlreadySelected: true,
        }).catch(async (error) => {
          await setStatus(
            job.jobId,
            'SETTING_FLOW',
            `Đã chọn model video, bỏ qua setting phụ vì lỗi/timeout: ${error.message}`
          );
        });
      } else {
        await waitWithTimeout(
          ensureFlowOutputMode(page, job.jobId, 'image'),
          Number(env.FLOW_MODE_SETTING_TIMEOUT_MS || 15000),
          'ensureFlowOutputMode(image)'
        );

        await waitWithTimeout(
          maybeSelectFlowModel(page, job.jobId, job),
          Number(env.FLOW_MODEL_SETTING_TIMEOUT_MS || 25000),
          'maybeSelectFlowModel'
        );

        await applyFlowSettingsRobust(page, job.jobId, {
          ...job,
          __modelAlreadySelected: true,
        }).catch(async (error) => {
          await setStatus(
            job.jobId,
            'SETTING_FLOW',
            `Đã chọn model ảnh, bỏ qua setting phụ vì lỗi/timeout: ${error.message}`
          );
        });
      }

      if (inputPath) {
        if (job.tool === 'image-to-video') {
          await setStatus(job.jobId, 'UPLOADING_ASSETS', `Đang upload ảnh điểm đầu / Start frame cho image-to-video ${i + 1}.`);
          await uploadFlowFrameAsset(page, job.jobId, inputPath, 'start');
          await waitForFrameReady(page, job.jobId, 'start');

          if (endInputPath) {
            await setStatus(job.jobId, 'UPLOADING_ASSETS', `Đang upload ảnh điểm cuối / End frame cho image-to-video ${i + 1}.`);
            await uploadFlowFrameAsset(page, job.jobId, endInputPath, 'end');
            await waitForFrameReady(page, job.jobId, 'end');
          }

          await waitForImageToVideoComposerReady(page, job.jobId);
        } else {
          await setStatus(job.jobId, 'UPLOADING_ASSETS', `Đang upload ảnh đầu vào cho ${outputLabel} ${i + 1}.`);
          const fileInput = page.locator(uploadSelector).first();
          await fileInput.setInputFiles(inputPath, { timeout: Number(env.FLOW_UPLOAD_TIMEOUT_MS || 30000) });
          await page.waitForTimeout(Number(env.FLOW_AFTER_UPLOAD_DELAY_MS || 2500));
        }
      }

      await closeFlowSettingsPanel(page, job.jobId);

      await waitWithTimeout(
        submitPromptAndCreateStrict(page, job.jobId, prompt),
        Number(env.FLOW_SUBMIT_PROMPT_TIMEOUT_MS || 30000),
        'submitPromptAndCreateStrict'
      );

      await page.waitForTimeout(FLOW_AFTER_CREATE_DELAY_MS);

      const result = await downloadOrCaptureResult({
        context,
        page,
        job,
        prompt,
        promptIndex: i,
      });

      if (result?.path) downloadedFiles.push(result.path);
    }

    return downloadedFiles;
  } catch (error) {
    await saveDebugArtifacts(page, job.jobId, 'flow-error');
    throw error;
  } finally {
    clearInterval(heartbeatTimer);
    if (!FLOW_KEEP_BROWSER_OPEN) await context.close();
  }
}


async function dryRun(job) {
  const prompts = job.prompts?.length ? job.prompts : [job.prompt].filter(Boolean);
  const outputType = getJobOutputType(job);
  const isImage = outputType === 'image';
  await setStatus(job.jobId, 'OPENING_FLOW', 'Dry-run: Worker mô phỏng mở Flow trên VPS.');
  await sleep(1200);
  await setStatus(job.jobId, 'GENERATING', `Dry-run: đang mô phỏng tạo ${isImage ? 'ảnh' : 'video'}.`);
  await sleep(2000);
  const results = prompts.map((prompt, index) => ({
    id: `${job.jobId}-dry-${index + 1}`,
    type: isImage ? 'image' : 'video',
    title: prompt.length > 72 ? `${prompt.slice(0, 69)}...` : prompt || `${isImage ? 'Image' : 'Video'} ${index + 1}`,
    prompt,
    promptIndex: index,
    url: isImage ? DEFAULT_SAMPLE_IMAGE : DEFAULT_SAMPLE_VIDEO,
    thumbnail: isImage ? DEFAULT_SAMPLE_IMAGE : `https://picsum.photos/seed/${encodeURIComponent(job.jobId)}-${index + 1}/800/450`,
    duration: isImage ? undefined : (job.duration || 8),
    aspectRatio: job.aspectRatio || '16:9',
    sizeLabel: 'dry-run',
  }));
  await appendExternalResults(job, results, true);
}

async function processJob(job) {
  const jobId = job?.jobId;
  if (!jobId) return;
  if (RUNNING_JOB_IDS.has(jobId)) {
    console.warn(`[${jobId}] Bỏ qua vì job này đang được Worker xử lý, tránh spam/claim lặp.`);
    return;
  }
  if (FINISHED_JOB_IDS.has(jobId)) {
    console.warn(`[${jobId}] Bỏ qua vì job này đã xử lý xong trong phiên Worker hiện tại.`);
    return;
  }

  RUNNING_JOB_IDS.add(jobId);
  console.log(`
[${jobId}] received ${job.prompts?.length || 1} prompt(s), mode=${FLOW_WORKER_MODE}`);
  try {
    if (FLOW_WORKER_MODE === 'playwright') {
      await automateWithPlaywright(job);
    } else {
      await dryRun(job);
    }
    FINISHED_JOB_IDS.add(jobId);
    await heartbeat(jobId, 'Worker hoàn tất job.');
    console.log(`[${jobId}] completed`);
  } catch (error) {
    FINISHED_JOB_IDS.add(jobId);
    await failJob(jobId, error);
  } finally {
    RUNNING_JOB_IDS.delete(jobId);
  }
}

async function main() {
  console.log(`LegalProTech Windows Flow Worker`);
  console.log(`API_BASE=${API_BASE}`);
  console.log(`WORKER_ID=${WORKER_ID}`);
  console.log(`FLOW_WORKER_MODE=${FLOW_WORKER_MODE}`);
  if (FLOW_WORKER_MODE === 'dry-run') {
    console.warn('ĐANG Ở DRY-RUN: Worker sẽ trả video mẫu. Muốn chạy Flow thật, đặt FLOW_WORKER_MODE=playwright trong .env.local rồi restart worker.');
  }
  console.log(`FLOW_URL=${FLOW_URL}`);
  console.log(`Chrome profile=${CHROME_PROFILE_DIR}`);
  console.log(`FLOW_LOGIN_WAIT_MS=${FLOW_LOGIN_WAIT_MS}`);
  console.log(`FLOW_KEEP_BROWSER_OPEN=${FLOW_KEEP_BROWSER_OPEN}`);
  console.log(`FLOW_FAST_SELECTOR_MODE=${FLOW_FAST_SELECTOR_MODE}`);
  console.log(`FLOW_FORCE_COORDINATES=${FLOW_FORCE_COORDINATES}`);
  console.log(`FLOW_COORDINATE_HELPER=${FLOW_COORDINATE_HELPER}`);
  console.log(`AUTO_DOM_STAGE=enhanced-start-card`);
  console.log(`FLOW_ACCOUNT_CONFIG_PATH=${FLOW_ACCOUNT_CONFIG_PATH}`);
  console.log(`FLOW_AUTO_LOGIN_ENABLED=${String(env.FLOW_AUTO_LOGIN_ENABLED || 'true')}`);
  if (!WORKER_API_KEY) {
    console.warn('Cảnh báo: WORKER_API_KEY đang trống. Chỉ nên để trống khi chạy local dev.');
  }

  while (true) {
    try {
      const job = await claimJob();
      if (job) await processJob(job);
      else await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      console.error(`[worker-loop] ${error.stack || error.message || error}`);
      await sleep(POLL_INTERVAL_MS * 2);
    }
  }
}

main();
