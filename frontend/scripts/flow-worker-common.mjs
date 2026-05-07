import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
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

const FLOW_API_BASE_URL = process.env.FLOW_API_BASE_URL || 'http://127.0.0.1:3000';
const WORKER_API_KEY = process.env.WORKER_API_KEY || process.env.FLOW_WORKER_API_KEY || '';
const FLOW_URL = process.env.FLOW_URL || 'https://labs.google/fx/tools/flow';
const CHROME_EXECUTABLE_PATH = process.env.CHROME_EXECUTABLE_PATH || '';
const CHROME_PROFILE_DIR = process.env.CHROME_PROFILE_DIR || path.join(process.cwd(), '.flow-profile');
const FLOW_DOWNLOAD_DIR = process.env.FLOW_DOWNLOAD_DIR || path.join(process.cwd(), '.flow-downloads');
const FLOW_LOGIN_WAIT_MS = Number(process.env.FLOW_LOGIN_WAIT_MS || 600000);
const FLOW_KEEP_BROWSER_OPEN = String(process.env.FLOW_KEEP_BROWSER_OPEN || 'false').toLowerCase() === 'true';
const FLOW_CLOSE_AFTER_JOB = String(process.env.FLOW_CLOSE_AFTER_JOB || 'true').toLowerCase() !== 'false';
const FLOW_FRESH_CONTEXT_PER_JOB = String(process.env.FLOW_FRESH_CONTEXT_PER_JOB || 'true').toLowerCase() !== 'false';
const FLOW_FRESH_PAGE_PER_PROMPT = String(process.env.FLOW_FRESH_PAGE_PER_PROMPT || 'true').toLowerCase() !== 'false';
const FLOW_FORCE_NEW_PROJECT_PER_JOB = String(process.env.FLOW_FORCE_NEW_PROJECT_PER_JOB || 'true').toLowerCase() !== 'false';
const FLOW_STRICT_MULTIPLIER_VERIFY = String(process.env.FLOW_STRICT_MULTIPLIER_VERIFY || 'true').toLowerCase() !== 'false';
const FLOW_MULTIPLIER_CLICK_ATTEMPTS = Math.max(2, Number(process.env.FLOW_MULTIPLIER_CLICK_ATTEMPTS || 5));
const FLOW_RESULT_READY_POLL_MS = Number(process.env.FLOW_RESULT_READY_POLL_MS || 2500);
const FLOW_RESULT_READY_TIMEOUT_MS = Number(process.env.FLOW_RESULT_READY_TIMEOUT_MS || 600000);
const FLOW_DOWNLOAD_TIMEOUT_MS = Number(process.env.FLOW_DOWNLOAD_TIMEOUT_MS || 120000);
const FLOW_WORKER_POLL_INTERVAL_MS = Number(process.env.FLOW_WORKER_POLL_INTERVAL_MS || 3000);
const FLOW_AFTER_OPEN_DELAY_MS = Number(process.env.FLOW_AFTER_OPEN_DELAY_MS || 1000);
const FLOW_AFTER_PROMPT_DELAY_MS = Number(process.env.FLOW_AFTER_PROMPT_DELAY_MS || 500);
const FLOW_AFTER_SELECT_MODEL_DELAY_MS = Number(process.env.FLOW_AFTER_SELECT_MODEL_DELAY_MS || 700);
const FLOW_AFTER_UPLOAD_DELAY_MS = Number(process.env.FLOW_AFTER_UPLOAD_DELAY_MS || 1000);
const FLOW_STAGE_CLICK_ROUNDS = Number(process.env.FLOW_STAGE_CLICK_ROUNDS || 5);
const FLOW_COMPOSER_READY_ROUNDS = Number(process.env.FLOW_COMPOSER_READY_ROUNDS || 5);
const HEARTBEAT_INTERVAL_MS = Math.max(5000, Math.floor(FLOW_WORKER_POLL_INTERVAL_MS * 2));
const FLOW_DEBUG = String(process.env.FLOW_DEBUG || 'false').toLowerCase() === 'true';
const FLOW_DEBUG_DIR = process.env.FLOW_DEBUG_DIR || path.join(process.cwd(), '.flow-debug');
const FLOW_SKIP_SETTINGS = String(process.env.FLOW_SKIP_SETTINGS || 'false').toLowerCase() === 'true';
const FLOW_CHROME_WINDOW_WIDTH = Number(process.env.FLOW_CHROME_WINDOW_WIDTH || 1400);
const FLOW_CHROME_WINDOW_HEIGHT = Number(process.env.FLOW_CHROME_WINDOW_HEIGHT || 1000);
const FLOW_BROWSER_LAUNCH_RETRIES = Math.max(1, Number(process.env.FLOW_BROWSER_LAUNCH_RETRIES || 2));
const FLOW_FRESH_PROFILE_ON_LAUNCH_ERROR = String(process.env.FLOW_FRESH_PROFILE_ON_LAUNCH_ERROR || 'true').toLowerCase() !== 'false';

const MODEL_LABELS = {
  'nano-banana-2': ['Nano Banana 2'],
  'nano-banana-pro': ['Nano Banana Pro'],
  'imagen-4': ['Imagen 4'],
  'veo-3.1-fast-lower-priority': [
    'Veo 3.1 - Fast [Lower Priority] (leaving 5/10)',
    'Veo 3.1 - Fast [Lower Priority]',
    'Veo 3.1 - Fast Lower Priority',
  ],
  'veo-3.1-fast-generate-preview': ['Veo 3.1 - Fast', 'Veo 3.1 Fast'],
  'veo-3.1-generate-preview': ['Veo 3.1 - Standard', 'Veo 3.1 Standard'],
};

const READY_TEXTS = ['Image', 'Video', 'Frames', 'Ingredients', 'Search for Assets', 'Recent', 'No results found', 'Untitled Collection', 'Start creating', 'drop media', 'What do you want to create?', 'Flow'];
const GENERATE_TEXTS = ['Generate'];
const DOWNLOAD_TEXTS = ['Download', 'Download video', 'Download image', 'MP4', 'PNG', 'Save'];
const MORE_TEXT_RE = /(more|options|menu|actions|overflow)/i;

const VIDEO_RESULT_MIN_WAIT_MS = Number(process.env.FLOW_VIDEO_RESULT_MIN_WAIT_MS || 15000);
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|avi|mkv)(?:$|[?#])/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif|bmp)(?:$|[?#])/i;
const ZIP_EXT_RE = /\.zip(?:$|[?#])/i;

function downloadSuggestedName(download) {
  try {
    return String(download?.suggestedFilename?.() || '').trim();
  } catch {
    return '';
  }
}

function isDownloadCompatibleWithOutput(download, outputType = '') {
  const type = String(outputType || '').toLowerCase();
  if (!type) return true;
  const name = downloadSuggestedName(download).toLowerCase();
  if (!name) {
    // Unknown names are risky for video because old image downloads can be returned by Flow
    // before the newly generated video card is ready. Keep image path permissive.
    return type === 'video'
      ? String(process.env.FLOW_ACCEPT_UNKNOWN_VIDEO_DOWNLOAD || 'false').toLowerCase() === 'true'
      : true;
  }
  if (type === 'video') {
    // Flow often downloads video results as download.zip. Accept ZIP for video;
    // the Next result API extracts the first media file before saving it to the web library.
    if (ZIP_EXT_RE.test(name)) {
      return String(process.env.FLOW_ACCEPT_VIDEO_ZIP_DOWNLOAD || 'true').toLowerCase() !== 'false';
    }
    if (VIDEO_EXT_RE.test(name) || /\b(video|mp4|webm|quicktime)\b/i.test(name)) return true;
    if (IMAGE_EXT_RE.test(name) || /\b(image|png|jpeg|jpg|webp)\b/i.test(name)) return false;
    return String(process.env.FLOW_ACCEPT_UNKNOWN_VIDEO_DOWNLOAD || 'false').toLowerCase() === 'true';
  }
  if (type === 'image') {
    // Preserve the existing image flow: accept normal image names and unknown names.
    if (IMAGE_EXT_RE.test(name) || /\b(image|png|jpeg|jpg|webp)\b/i.test(name)) return true;
    return !VIDEO_EXT_RE.test(name);
  }
  return true;
}

async function acceptOrSkipDownload(download, downloadState, outputType, sourceLabel) {
  if (!download) return null;
  if (isDownloadCompatibleWithOutput(download, outputType)) return download;
  const name = downloadSuggestedName(download) || 'unknown';
  if (!downloadState.skippedDownloads) downloadState.skippedDownloads = [];
  downloadState.skippedDownloads.push({ source: sourceLabel, name, outputType, at: new Date().toISOString() });
  console.log('[FLOW DEBUG] skip stale/wrong download candidate', { source: sourceLabel, name, outputType });
  return null;
}

function splitPathList(value = '') {
  return String(value || '')
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function candidateVideoDownloadDirs(extraDirs = []) {
  return Array.from(new Set([
    ...ensureArray(extraDirs),
    FLOW_DOWNLOAD_DIR,
    path.join(process.cwd(), '.flow-downloads'),
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'downloads'),
    ...splitPathList(process.env.FLOW_VIDEO_DOWNLOAD_SCAN_DIRS || ''),
  ].filter(Boolean)));
}

async function isStableVideoFile(filePath) {
  try {
    const first = await fs.stat(filePath);
    if (!first.isFile()) return false;
    if (first.size < Number(process.env.FLOW_VIDEO_MIN_BYTES || 100000)) return false;
    // Chrome/Edge temporary downloads should not be uploaded.
    if (/\.(crdownload|tmp|part)$/i.test(filePath)) return false;
    await sleep(Number(process.env.FLOW_VIDEO_FILE_STABLE_WAIT_MS || 900));
    const second = await fs.stat(filePath);
    return second.isFile() && second.size === first.size && second.size >= Number(process.env.FLOW_VIDEO_MIN_BYTES || 100000);
  } catch {
    return false;
  }
}

async function collectRecentVideoFiles(dir, sinceMs, depth = 0, out = []) {
  if (!dir || depth > Number(process.env.FLOW_VIDEO_DOWNLOAD_SCAN_DEPTH || 4)) return out;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        if (/node_modules|\.next|cache|code cache|shadercache|grshadercache|crashpad/i.test(entry.name)) continue;
        await collectRecentVideoFiles(full, sinceMs, depth + 1, out);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!VIDEO_EXT_RE.test(entry.name)) continue;
      const stat = await fs.stat(full);
      if (stat.mtimeMs < sinceMs - Number(process.env.FLOW_VIDEO_DOWNLOAD_SCAN_SKEW_MS || 10000)) continue;
      out.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {}
  }
  return out;
}

async function findRecentDownloadedVideoFile(downloadState = {}, extraDirs = []) {
  const sinceMs = Number(downloadState.startedAt || Date.now());
  if (!downloadState.usedLocalVideoFiles) downloadState.usedLocalVideoFiles = new Set();
  const dirs = candidateVideoDownloadDirs(extraDirs);
  let candidates = [];
  for (const dir of dirs) {
    const found = await collectRecentVideoFiles(dir, sinceMs).catch(() => []);
    candidates.push(...found);
  }
  candidates = candidates
    .filter((item) => item?.path && !downloadState.usedLocalVideoFiles.has(path.resolve(item.path)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);

  for (const item of candidates.slice(0, 10)) {
    if (await isStableVideoFile(item.path)) {
      const resolved = path.resolve(item.path);
      downloadState.usedLocalVideoFiles.add(resolved);
      console.log('[FLOW DEBUG] found recent local video download fallback', { path: resolved, size: item.size, mtimeMs: item.mtimeMs });
      return { localFilePath: resolved, suggestedFilename: () => path.basename(resolved) };
    }
  }
  return null;
}

function safeSlug(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'worker';
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function jobSnapshot(job = {}) {
  return {
    jobId: job.jobId,
    token: job.token,
    tool: job.tool,
    outputType: job.outputType,
    model: job.model,
    aspectRatio: job.aspectRatio,
    duration: job.duration,
    frame: job.frame,
    videosPerPrompt: job.videosPerPrompt,
    countPerPrompt: job.countPerPrompt,
    requestedCount: job.requestedCount,
    maxResults: job.maxResults,
    prompt: ensureArray(job.prompts).join('\n'),
    prompts: ensureArray(job.prompts),
    inputAsset: job.inputAsset || null,
    endInputAsset: job.endInputAsset || null,
    zipUrl: job.zipUrl,
    shareUrl: job.shareUrl,
    expiresAt: job.expiresAt,
    workerType: job.workerType,
    workerId: job.workerId,
    claimedAt: job.claimedAt,
    createdAt: job.createdAt,
    timeline: ensureArray(job.timeline),
  };
}

function multiplierForJob(job) {
  if (job.outputType === 'image') return Number(job.countPerPrompt || 1);
  return Number(job.videosPerPrompt || 1);
}

function promptIndexForResult(job, runningIndex) {
  const multiplier = Math.max(1, multiplierForJob(job));
  return Math.floor(runningIndex / multiplier);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function apiFetch(endpoint, { method = 'GET', headers = {}, json, body } = {}) {
  const finalHeaders = { ...headers };
  if (WORKER_API_KEY) finalHeaders['x-worker-key'] = WORKER_API_KEY;
  let payload = body;
  if (json !== undefined) {
    finalHeaders['content-type'] = 'application/json';
    payload = JSON.stringify(json);
  }
  const res = await fetch(`${FLOW_API_BASE_URL}${endpoint}`, { method, headers: finalHeaders, body: payload });
  if (!res.ok) {
    const message = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${endpoint}: ${message || res.statusText}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

async function downloadBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được asset ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function contentTypeForResultFile(fileName = '', fallback = 'video/mp4') {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.zip')) return 'application/zip';
  return fallback;
}


async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}


const CHROME_PROFILE_LOCK_FILES = [
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'DevToolsActivePort',
  'BrowserMetrics-spare.pma',
];

async function cleanupChromeProfileLocks(userDataDir) {
  for (const fileName of CHROME_PROFILE_LOCK_FILES) {
    await fs.rm(path.join(userDataDir, fileName), { force: true, recursive: true }).catch(() => {});
  }
}

function extraChromeArgs() {
  return String(process.env.FLOW_CHROME_EXTRA_ARGS || '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const CLOSED_CONTEXTS = new WeakSet();

function markContextClosed(context, ownerLabel = 'flow-worker') {
  if (!context) return;
  CLOSED_CONTEXTS.add(context);
  console.log(`[FLOW DEBUG] Chrome context closed for ${ownerLabel}`);
}

function isTargetClosedError(error) {
  const message = String(error?.message || error || '');
  return /Target page, context or browser has been closed|Browser closed|context.*closed|Target closed|Protocol error|Browser\.getWindowForTarget|Browser window not found|process did exit/i.test(message);
}

async function isContextHealthy(context) {
  if (!context || CLOSED_CONTEXTS.has(context)) return false;
  try {
    // pages() throws when Playwright already knows the context/browser is closed.
    context.pages();
    return !CLOSED_CONTEXTS.has(context);
  } catch {
    return false;
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
    ...extraChromeArgs(),
  ];
}

function shouldRetryWithFreshProfile(error) {
  const message = String(error?.message || error || '');
  return isTargetClosedError(error) || /ProcessSingleton|profile|user data directory|Singleton|DevToolsActivePort/i.test(message);
}

async function launchFlowBrowserContext(userDataDir, ownerLabel = 'flow-worker') {
  await ensureDir(userDataDir);
  await cleanupChromeProfileLocks(userDataDir);

  let currentDir = userDataDir;
  let lastError = null;
  for (let attempt = 1; attempt <= FLOW_BROWSER_LAUNCH_RETRIES; attempt += 1) {
    try {
      console.log(`[FLOW DEBUG] launching Chrome for ${ownerLabel}`, { userDataDir: currentDir, attempt });
      const context = await chromium.launchPersistentContext(currentDir, {
        headless: false,
        executablePath: CHROME_EXECUTABLE_PATH || undefined,
        acceptDownloads: true,
        permissions: ['clipboard-read', 'clipboard-write'],
        viewport: { width: FLOW_CHROME_WINDOW_WIDTH, height: FLOW_CHROME_WINDOW_HEIGHT },
        screen: { width: FLOW_CHROME_WINDOW_WIDTH, height: FLOW_CHROME_WINDOW_HEIGHT },
        args: chromeLaunchArgs(),
      });
      context.on('close', () => markContextClosed(context, ownerLabel));

      // Chrome đôi khi launch xong rồi tự đóng rất nhanh; nếu trả context ngay,
      // bước sau sẽ chết ở browserContext.newPage(). Probe nhẹ tại đây để retry
      // bằng profile recover thay vì fail job.
      await sleep(Number(process.env.FLOW_POST_LAUNCH_STABILIZE_MS || 700));
      if (!(await isContextHealthy(context))) {
        throw new Error('Chrome context closed immediately after launch.');
      }
      try {
        if (!context.pages().some((page) => !page.isClosed())) {
          const probe = await context.newPage();
          await probe.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
        }
      } catch (probeError) {
        CLOSED_CONTEXTS.add(context);
        await context.close().catch(() => {});
        throw probeError;
      }
      return context;
    } catch (error) {
      lastError = error;
      console.error(`[FLOW DEBUG] Chrome launch failed for ${ownerLabel} attempt ${attempt}/${FLOW_BROWSER_LAUNCH_RETRIES}:`, error?.message || error);
      await cleanupChromeProfileLocks(currentDir);
      if (attempt === 1 && FLOW_FRESH_PROFILE_ON_LAUNCH_ERROR && shouldRetryWithFreshProfile(error)) {
        currentDir = `${userDataDir}-recover-${Date.now()}`;
        await ensureDir(currentDir);
      }
      await sleep(900);
    }
  }

  throw new Error(`Không mở được Chrome Flow (${ownerLabel}). Đã dọn lock profile và bỏ --start-maximized nhưng Chrome vẫn đóng. Lỗi cuối: ${lastError?.message || lastError}`);
}
async function debugStep(page, job, label, extra = {}) {
  const msg = `[FLOW DEBUG] ${job?.jobId || 'no-job'} | ${label} | ${page?.url?.() || ''}`;
  console.log(msg, extra || '');
  if (!FLOW_DEBUG || !page) return;
  try {
    await page.evaluate(({ label, extra }) => {
      const id = '__flow_worker_debug_overlay__';
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.position = 'fixed';
        el.style.left = '12px';
        el.style.top = '12px';
        el.style.zIndex = '2147483647';
        el.style.background = 'rgba(255, 214, 10, 0.96)';
        el.style.color = '#111';
        el.style.font = '13px/1.35 monospace';
        el.style.padding = '10px 12px';
        el.style.border = '2px solid #111';
        el.style.borderRadius = '8px';
        el.style.maxWidth = '520px';
        el.style.whiteSpace = 'pre-wrap';
        document.body.appendChild(el);
      }
      el.textContent = `FLOW WORKER DEBUG\n${label}\n${JSON.stringify(extra || {}, null, 2)}`;
    }, { label, extra });
    const safe = String(label).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
    const dir = path.join(FLOW_DEBUG_DIR, job?.jobId || 'no-job');
    await ensureDir(dir);
    await page.screenshot({
      path: path.join(dir, `${Date.now()}-${safe}.png`),
      fullPage: false,
    }).catch(() => {});
  } catch (error) {
    console.log('[FLOW DEBUG] debugStep failed:', error?.message || error);
  }
}

async function findExistingPage(context) {
  if (!(await isContextHealthy(context))) return null;
  let pages = [];
  try {
    pages = context.pages();
  } catch {
    CLOSED_CONTEXTS.add(context);
    return null;
  }
  for (const page of pages) {
    try {
      if (!page.isClosed()) return page;
    } catch {}
  }
  return null;
}

async function clickVisibleText(page, texts, { exact = false, timeout = 1200 } = {}) {
  const values = ensureArray(texts);
  const selectors = [
    'button',
    '[role="button"]',
    'div[tabindex]',
    '[role="tab"]',
    'label',
    'span',
    'div',
  ];
  for (const text of values) {
    for (const selector of selectors) {
      const locator = page.locator(`${selector}:visible`).filter({ hasText: exact ? new RegExp(`^\\s*${escapeRegex(text)}\\s*$`, 'i') : new RegExp(escapeRegex(text), 'i') }).first();
      try {
        if (await locator.count()) {
          await locator.click({ timeout });
          return true;
        }
      } catch {
        // try next selector
      }
    }
    try {
      const locator = page.getByText(text, { exact }).first();
      if (await locator.count()) {
        await locator.click({ timeout });
        return true;
      }
    } catch {
      // continue
    }
  }
  return false;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function ensureFlowReady(page) {
  const started = Date.now();
  while (Date.now() - started < FLOW_LOGIN_WAIT_MS) {
    for (const text of READY_TEXTS) {
      try {
        const found = page.getByText(text, { exact: false }).first();
        if (await found.count()) return true;
      } catch {
        // ignore
      }
    }
    const composer = await findComposer(page);
    if (composer) return true;
    await sleep(1500);
  }
  throw new Error('Flow chưa sẵn sàng. Có thể chưa đăng nhập hoặc giao diện chưa tải xong.');
}

async function findComposer(page) {
  const viewport = page.viewportSize() || { width: 1400, height: 1000 };
  // UI mới: prompt nằm ở dock dưới, text placeholder là "What do you want to create?"
  const preferredText = [
    /what do you want to create\?/i,
    /describe/i,
    /prompt/i,
  ];
  for (const rx of preferredText) {
    try {
      const textLoc = page.getByText(rx).first();
      if (await textLoc.count()) {
        const box = await textLoc.boundingBox().catch(() => null);
        if (box && box.y > viewport.height * 0.45) {
          // Click chính placeholder để focus prompt thật.
          await textLoc.click({ timeout: 1500 }).catch(() => {});
          await sleep(300);
          const active = page.locator(':focus').first();
          if (await active.count()) return active;
          // Nếu focus không rõ, lấy textbox/contenteditable gần đáy màn hình.
          const near = await findBottomTextbox(page);
          if (near) return near;
        }
      }
    } catch {}
  }
  return findBottomTextbox(page);
}
async function findBottomTextbox(page) {
  const viewport = page.viewportSize() || { width: 1400, height: 1000 };
  const selectors = [
    'textarea:visible',
    'input:visible',
    '[contenteditable="true"]:visible',
    '[contenteditable="plaintext-only"]:visible',
    '[role="textbox"]:visible',
    'div.ProseMirror:visible',
    'div[aria-label*="prompt" i]:visible',
    'div[aria-label*="describe" i]:visible',
  ];
  let best = null;
  let bestScore = -9999;
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 20); i += 1) {
      const item = locator.nth(i);
      try {
        const box = await item.boundingBox();
        if (!box) continue;
        const meta = await item.evaluate((el) => ({
          text: (el.innerText || el.value || '').trim(),
          placeholder: (el.getAttribute('placeholder') || '').trim(),
          aria: (el.getAttribute('aria-label') || '').trim(),
          role: (el.getAttribute('role') || '').trim(),
          type: (el.getAttribute('type') || '').trim(),
        })).catch(() => ({ text: '', placeholder: '', aria: '', role: '', type: '' }));
        const label = `${meta.text} ${meta.placeholder} ${meta.aria} ${meta.role} ${meta.type}`.toLowerCase();
        let score = 0;
        // Composer thật nằm ở dock dưới màn hình.
        if (box.y > viewport.height * 0.45) score += 30;
        if (box.y > viewport.height * 0.60) score += 20;
        // Composer thường rộng.
        if (box.width > 300) score += 20;
        if (box.height > 30) score += 8;
        // Dấu hiệu prompt thật.
        if (/what do you want to create|prompt|describe|create/.test(label)) score += 35;
        // Loại search/assets/topbar.
        if (/search|asset|assets|recent|filter/.test(label)) score -= 80;
        if (box.y < 180) score -= 80;
        if (meta.type === 'search') score -= 80;
        if (score > bestScore) {
          bestScore = score;
          best = item;
        }
      } catch {}
    }
  }
  if (best && bestScore > 0) {
    return best;
  }
  return null;
}
async function hasComposer(page) {
  return Boolean(await findComposer(page));
}
async function openAnyWorkspace(page) {
  if (await hasComposer(page)) return true;
  // 1) Ưu tiên link/card project thật. Không hard-code project ID.
  const projectSelectors = [
    'a[href*="/project/"]:visible',
    'a[href*="/flow/project/"]:visible',
    '[role="link"][href*="/project/"]:visible',
  ];
  for (const selector of projectSelectors) {
    const items = page.locator(selector);
    let count = 0;
    try {
      count = await items.count();
    } catch { }
    for (let i = 0; i < Math.min(count, 6); i += 1) {
      try {
        await items.nth(i).click({ timeout: 2500 });
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        await sleep(1800);
        if (await hasComposer(page)) return true;
      } catch { }
    }
  }
  // 2) Thử các text/card thường xuất hiện ở trang home/project list của Flow.
  const textCandidates = [
    /untitled/i,
    /recent/i,
    /project/i,
    /open/i,
    /continue/i,
    /create/i,
    /new/i,
    /start/i,
    /image/i,
    /video/i,
    /dự án/i,
    /tiếp tục/i,
    /tạo/i,
  ];
  for (const rx of textCandidates) {
    try {
      const el = page.getByText(rx).first();
      if (await el.count()) {
        await el.click({ timeout: 2000 }).catch(() => { });
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        await sleep(1800);
        if (await hasComposer(page)) return true;
      }
    } catch { }
  }
  // 3) Fallback: click các card/button lớn ở vùng nội dung, bỏ qua topbar/account.
  const generic = page.locator('a:visible, button:visible, [role="button"]:visible, [role="link"]:visible, [tabindex]:visible');
  let count = 0;
  try {
    count = await generic.count();
  } catch { }
  for (let i = 0; i < Math.min(count, 20); i += 1) {
    const item = generic.nth(i);
    try {
      const box = await item.boundingBox();
      if (!box) continue;
      if (box.y < 90 || box.width < 60 || box.height < 28) continue;
      const label = await item.evaluate((el) => `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.toLowerCase()).catch(() => '');
      if (/account|profile|help|privacy|terms|sign out|log out|feedback/.test(label)) continue;
      await item.click({ timeout: 1500 });
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
      await sleep(1800);
      if (await hasComposer(page)) return true;
    } catch { }
  }
  return false;
}
async function ensureWorkspaceReady(page) {
  const timeoutMs = Number(process.env.FLOW_WORKSPACE_READY_TIMEOUT_MS || 120000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasComposer(page)) return true;
    await openAnyWorkspace(page).catch(() => { });
    if (await hasComposer(page)) return true;
    await sleep(1500);
  }
  throw new Error('Đã mở Flow nhưng không tự vào được workspace/project có ô prompt.');
}
async function isAssetLibraryView(page) {
  let score = 0;

  const checks = [
    /search for assets/i,
    /no results found/i,
    /^recent$/i,
  ];

  for (const rx of checks) {
    try {
      const loc = page.getByText(rx).first();
      if (await loc.count()) score += 1;
    } catch { }
  }

  return score >= 2;
}

async function clickTopRightCreate(page) {
  const locator = page.locator('button:visible,[role="button"]:visible');
  const count = await locator.count().catch(() => 0);

  let bestIndex = -1;
  let bestScore = -9999;

  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);

    try {
      const meta = await item.evaluate((el) => ({
        text: (el.innerText || '').trim(),
        aria: (el.getAttribute('aria-label') || '').trim(),
        title: (el.getAttribute('title') || '').trim(),
      }));

      const box = await item.boundingBox();
      if (!box) continue;

      const label = `${meta.text} ${meta.aria} ${meta.title}`.toLowerCase();

      let score = 0;

      // Ưu tiên nút ở góc trên phải
      if (box.y < 140) score += 8;
      if (box.x > 1000) score += 12;

      // Ưu tiên nút vuông, nhỏ kiểu icon button
      if (Math.abs(box.width - box.height) < 16) score += 4;
      if (box.width >= 24 && box.width <= 64) score += 3;
      if (box.height >= 24 && box.height <= 64) score += 3;

      // Ưu tiên nút tạo mới
      if (/\bcreate\b|\bnew\b|\badd\b|\bplus\b/.test(label)) score += 20;
      if (meta.text === '+' || meta.aria === '+' || meta.title === '+') score += 20;

      // Bỏ các nút không liên quan
      if (/help|settings|filter|search|account|profile|menu|more|overflow/.test(label)) score -= 10;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    } catch { }
  }

  if (bestIndex >= 0) {
    await locator.nth(bestIndex).click({ timeout: 2000 }).catch(() => { });
    await sleep(800);
    return true;
  }

  return false;
}

async function clickCollectionCard(page) {
  const candidates = [
    /untitled collection/i,
    /collection/i,
    /start creating/i,
    /drop media/i,
  ];
  for (const rx of candidates) {
    try {
      const el = page.getByText(rx).first();
      if (await el.count()) {
        await el.click({ timeout: 2500 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await sleep(1500);
        return true;
      }
    } catch {}
  }
  const cards = page.locator('div:visible, [role="button"]:visible, a:visible');
  const count = await cards.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 25); i += 1) {
    const item = cards.nth(i);
    try {
      const box = await item.boundingBox();
      if (!box) continue;
      if (box.y < 120 || box.width < 140 || box.height < 100) continue;
      await item.click({ timeout: 1500 });
      await sleep(1500);
      return true;
    } catch {}
  }
  return false;
}
async function clickBottomModePill(page) {
  const viewport = page.viewportSize() || { width: 1400, height: 1000 };
  const locator = page.locator('button:visible,[role="button"]:visible,div[role="button"]:visible');
  const count = await locator.count().catch(() => 0);
  let bestIndex = -1;
  let bestScore = -9999;
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    try {
      const box = await item.boundingBox();
      if (!box) continue;
      const label = await item.evaluate((el) =>
        `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.trim()
      ).catch(() => '');
      const lower = label.toLowerCase();
      let score = 0;
      // Pill setting nằm gần dock dưới composer.
      if (box.y > viewport.height * 0.50) score += 12;
      if (box.x > viewport.width * 0.45) score += 6;
      // UI mới thường hiện "Video x2", "Image x1", hoặc có aspect/model.
      if (/\bvideo\b|\bimage\b/.test(lower)) score += 22;
      if (/x\s*[1-4]|[1-4]\s*x/i.test(label)) score += 16;
      if (/9:16|16:9|4:3|1:1|3:4/.test(label)) score += 10;
      // Tránh bấm nút submit mũi tên / setting / account.
      if (/generate|submit|help|settings|account|profile|search|filter|arrow/.test(lower)) score -= 18;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    } catch {}
  }
  if (bestIndex >= 0 && bestScore > 8) {
    await locator.nth(bestIndex).click({ timeout: 2000 }).catch(() => {});
    await sleep(900);
    return true;
  }
  return false;
}
async function selectOutputModeFromPanel(page, job) {
  const target = job.outputType === 'image' ? 'Image' : 'Video';
  // UI mới giấu Image/Video trong pill dưới composer, ví dụ "Video x2".
  await clickBottomModePill(page).catch(() => {});
  await sleep(600);
  await clickVisibleText(page, [target], { exact: false, timeout: 2500 }).catch(() => {});
  await sleep(800);
  if (job.tool === 'image-to-video') {
    await clickVisibleText(page, ['Frames'], { exact: false, timeout: 2000 }).catch(() => {});
  }
  return true;
}
async function ensureComposerOrCollection(page, job) {
  if (await hasComposer(page)) return true;
  // Màn collection card.
  await clickCollectionCard(page).catch(() => {});
  await sleep(1200);
  if (await hasComposer(page)) return true;
  // Màn asset library rỗng.
  await clickTopRightCreate(page).catch(() => {});
  await sleep(1000);
  if (job?.outputType === 'image') {
    await clickVisibleText(page, ['Image', 'Create image', 'Generate image'], { exact: false, timeout: 2000 }).catch(() => {});
  } else {
    await clickVisibleText(page, ['Video', 'Create video', 'Generate video'], { exact: false, timeout: 2000 }).catch(() => {});
  }
  await sleep(1500);
  return Boolean(await hasComposer(page));
}
async function ensureGenerationSurface(page, job) {
  const deadline = Date.now() + Number(process.env.FLOW_GENERATION_SURFACE_TIMEOUT_MS || 90000);
  while (Date.now() < deadline) {
    if (!(await hasComposer(page))) {
      await ensureComposerOrCollection(page, job).catch(() => {});
    }
    if (await hasComposer(page)) {
      // Không return ngay. Phải ép đúng Image/Video vì có thể đang là Video x2.
      await selectOutputModeFromPanel(page, job).catch(() => {});
      await sleep(700);
      return true;
    }
    if (await isAssetLibraryView(page)) {
      await clickTopRightCreate(page).catch(() => {});
      await sleep(1000);
    }
    await openAnyWorkspace(page).catch(() => {});
    await sleep(1200);
  }
  throw new Error('Đã vào Flow nhưng chưa chuyển được sang màn tạo nội dung Image/Video đúng mode.');
}

async function prepareFreshFlowProject(page, job) {
  if (!FLOW_FORCE_NEW_PROJECT_PER_JOB) return true;
  await debugStep(page, job, '01a-before-force-new-project').catch(() => {});

  // Nếu Flow tự restore vào project cũ, bấm nút tạo mới trước khi chỉnh setting/prompt.
  // Ưu tiên các nhãn rõ ràng; fallback là nút +/Create góc phải.
  const labels = ['New project', 'Create project', 'New', 'Start creating', 'Create'];
  for (let attempt = 1; attempt <= Number(process.env.FLOW_FORCE_NEW_PROJECT_ATTEMPTS || 2); attempt += 1) {
    await clickVisibleText(page, labels, { exact: false, timeout: 1600 }).catch(() => false);
    await sleep(900);
    await clickTopRightCreate(page).catch(() => false);
    await sleep(1400);
    if (await hasComposer(page)) {
      await debugStep(page, job, '01b-after-force-new-project', { attempt, url: page.url() }).catch(() => {});
      return true;
    }
  }

  // Không fail ở đây vì một số account mở thẳng vào composer trống.
  await debugStep(page, job, '01c-force-new-project-not-confirmed-nonfatal', { url: page.url() }).catch(() => {});
  return true;
}

async function findSubmitArrowBox(page) {
  const viewport = page.viewportSize() || { width: 1400, height: 1000 };
  const locator = page.locator('button:visible,[role="button"]:visible,div[role="button"]:visible');
  const count = await locator.count().catch(() => 0);
  let best = null;
  let bestScore = -9999;
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    try {
      const meta = await item.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: String(el.innerText || el.textContent || '').trim(),
          aria: String(el.getAttribute('aria-label') || '').trim(),
          title: String(el.getAttribute('title') || '').trim(),
          disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });
      if (meta.disabled) continue;
      const label = `${meta.text} ${meta.aria} ${meta.title}`.trim();
      const lower = label.toLowerCase();
      const box = meta.rect;
      let score = 0;
      if (box.y > viewport.height * 0.55) score += 20;
      if (box.x > viewport.width * 0.55) score += 20;
      if (box.width >= 24 && box.width <= 90) score += 8;
      if (box.height >= 24 && box.height <= 90) score += 8;
      if (Math.abs(box.width - box.height) < 28) score += 8;
      if (/arrow|send|submit|generate|create|go|run|forward/i.test(label)) score += 35;
      // Tránh chọn pill setting.
      if (/\bvideo\b|\bimage\b|x\s*[1-4]|9:16|16:9|4:3|1:1|3:4|nano|banana|imagen|veo|model/i.test(label)) score -= 60;
      if (/help|settings|account|profile|search|filter|menu|more|assets|recent|ultra/i.test(lower)) score -= 35;
      if (box.y < 160) score -= 50;
      if (score > bestScore) {
        bestScore = score;
        best = { index: i, box, label, score };
      }
    } catch {}
  }
  if (best && bestScore > 15) return best;
  return null;
}
async function clickPromptInputArea(page) {
  const viewport = page.viewportSize() || { width: 1400, height: 1000 };
  // Cách 1: click vào vùng input nằm ngay bên trái nút mũi tên submit.
  const arrow = await findSubmitArrowBox(page).catch(() => null);
  if (arrow?.box) {
    const x = Math.max(240, Math.round(arrow.box.x - 280));
    const y = Math.round(arrow.box.y + arrow.box.height / 2);
    console.log('[FLOW DEBUG] click prompt area left of submit arrow', { arrow, click: { x, y } });
    await page.mouse.click(x, y);
    await sleep(500);
    return true;
  }
  // Cách 2: click placeholder thật nếu thấy.
  const placeholders = [
    /what do you want to create\?/i,
    /describe/i,
    /prompt/i,
  ];
  for (const rx of placeholders) {
    try {
      const loc = page.getByText(rx).first();
      if (await loc.count()) {
        const box = await loc.boundingBox().catch(() => null);
        if (box && box.y > viewport.height * 0.42) {
          await loc.click({ timeout: 2000 }).catch(() => {});
          await sleep(500);
          return true;
        }
      }
    } catch {}
  }
  // Cách 3: click textbox/contenteditable phía dưới.
  const composer = await findBottomTextbox(page).catch(() => null);
  if (composer) {
    const box = await composer.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(Math.round(box.x + box.width * 0.35), Math.round(box.y + box.height * 0.5));
      await sleep(500);
      return true;
    }
  }
  // Fallback cuối.
  await page.mouse.click(Math.round(viewport.width * 0.50), Math.round(viewport.height * 0.90));
  await sleep(500);
  return true;
}
async function getBottomComposerText(page) {
  const viewport = page.viewportSize() || { width: 1400, height: 1000 };
  return page.evaluate((minY) => {
    const overlay = document.getElementById('__flow_worker_debug_overlay__');
    const nodes = Array.from(document.querySelectorAll(
      'textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],div'
    ));
    const values = [];
    for (const el of nodes) {
      if (overlay && (el === overlay || overlay.contains(el))) continue;
      const rect = el.getBoundingClientRect();
      if (!rect || rect.y < minY || rect.width < 120 || rect.height < 18) continue;
      const text = String(el.innerText || el.textContent || el.value || '').trim();
      const placeholder = String(el.getAttribute('placeholder') || '').trim();
      const aria = String(el.getAttribute('aria-label') || '').trim();
      if (/search|asset|assets|recent|filter/i.test(`${text} ${placeholder} ${aria}`)) continue;
      values.push({
        text,
        placeholder,
        aria,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    }
    return values;
  }, viewport.height * 0.42).catch(() => []);
}


async function markPromptComposerCandidates(page) {
  const token = `fw-composer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return page.evaluate(({ token }) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 20 && r.height > 14 && r.bottom > 0 && r.right > 0 &&
        r.top < window.innerHeight && r.left < window.innerWidth &&
        style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const textOf = (el) => norm([
      el.value,
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('aria-placeholder'),
      el.getAttribute?.('data-placeholder'),
      el.getAttribute?.('title'),
      el.innerText,
      el.textContent,
    ].filter(Boolean).join(' '));
    const badAncestor = (el) => Boolean(el.closest(
      '[role="search"], form[role="search"], header, nav, aside, [data-testid*="search" i], [aria-label*="search" i], [role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]'
    ));
    document.querySelectorAll('[data-flow-worker-composer-token]').forEach((el) => {
      el.removeAttribute('data-flow-worker-composer-token');
      el.removeAttribute('data-flow-worker-composer-rank');
    });

    const candidateSet = new Set();
    const editableSelector = [
      'textarea',
      'input[type="text"]',
      'input:not([type])',
      '[contenteditable="true"]',
      '[contenteditable="plaintext-only"]',
      '[role="textbox"]',
      '.ProseMirror',
      '[data-placeholder*="What do you want" i]',
      '[aria-placeholder*="What do you want" i]',
      '[placeholder*="What do you want" i]',
      '[aria-label*="What do you want" i]',
      '[aria-label*="prompt" i]',
      '[aria-label*="describe" i]',
      '[data-placeholder*="prompt" i]',
      '[data-placeholder*="describe" i]',
    ].join(',');
    document.querySelectorAll(editableSelector).forEach((el) => candidateSet.add(el));

    // UI Flow đôi khi render placeholder trong span/p riêng, còn editor thật là parent gần nhất.
    document.querySelectorAll('div,p,span,label').forEach((el) => {
      if (!visible(el)) return;
      const t = textOf(el);
      if (!/what do you want to create\?|prompt|describe|mô tả|ý tưởng|nhập/i.test(t)) return;
      const editable = el.closest('[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],textarea,input,.ProseMirror');
      if (editable) candidateSet.add(editable);
      let cur = el;
      for (let i = 0; i < 4 && cur; i += 1, cur = cur.parentElement) candidateSet.add(cur);
    });

    const candidates = Array.from(candidateSet)
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = textOf(el);
        const lower = text.toLowerCase();
        const tag = String(el.tagName || '').toLowerCase();
        const type = String(el.getAttribute?.('type') || '').toLowerCase();
        const editable = el.matches?.('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],.ProseMirror');
        let score = 0;
        if (r.top > window.innerHeight * 0.42) score += 220;
        if (r.top > window.innerHeight * 0.58) score += 160;
        if (r.width >= Math.min(360, window.innerWidth * 0.30)) score += 120;
        if (r.height >= 28 && r.height <= 240) score += 80;
        if (editable) score += 260;
        if (tag === 'textarea') score += 220;
        if (tag === 'input') score += 180;
        if (el.getAttribute?.('contenteditable') === 'true' || el.classList?.contains('ProseMirror')) score += 240;
        if (el.getAttribute?.('role') === 'textbox') score += 180;
        if (/what do you want to create\?/i.test(text)) score += 360;
        if (/prompt|describe|description|mô tả|ý tưởng|nhập/i.test(text)) score += 140;
        score += Math.min(120, (r.top / window.innerHeight) * 120);
        if (type === 'search' || type === 'email' || type === 'password') score -= 1200;
        if (/search|asset|assets|recent|filter|sort|email|password|login|sign in|đăng nhập/i.test(lower)) score -= 1200;
        if (/generating will use|credits|model|nano banana|imagen|veo|image\s+video|frames|ingredients|16:9|9:16|4:3|1:1|3:4|x\s*[1-4]/i.test(text)) score -= 550;
        if (badAncestor(el)) score -= 900;
        if (r.top < window.innerHeight * 0.35) score -= 900;
        if (r.width * r.height > window.innerWidth * window.innerHeight * 0.50) score -= 500;
        return {
          el,
          score,
          label: text.slice(0, 160),
          tag,
          editable,
          rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) },
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    candidates.forEach((item, index) => {
      item.el.setAttribute('data-flow-worker-composer-token', token);
      item.el.setAttribute('data-flow-worker-composer-rank', String(index));
    });

    return {
      token,
      candidates: candidates.map(({ score, label, tag, editable, rect }) => ({ score: Math.round(score), label, tag, editable, rect })),
    };
  }, { token }).catch((error) => ({ token: '', candidates: [], error: String(error?.message || error) }));
}

async function activeComposerInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { ok: false, reason: 'no-active-element' };
    const r = el.getBoundingClientRect?.();
    const text = String([
      el.value,
      el.getAttribute?.('type'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('aria-placeholder'),
      el.getAttribute?.('data-placeholder'),
      el.innerText,
      el.textContent,
    ].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
    const tag = String(el.tagName || '').toLowerCase();
    const type = String(el.getAttribute?.('type') || '').toLowerCase();
    const editable = tag === 'textarea' || tag === 'input' || el.isContentEditable || el.getAttribute?.('role') === 'textbox';
    const bottom = r ? r.top > window.innerHeight * 0.35 : false;
    const bad = /search|filter|sort|email|password|login|sign in|đăng nhập/i.test(text) || /search|email|password/i.test(type) || Boolean(el.closest?.('[role="search"],form[role="search"],header,nav,aside'));
    return {
      ok: Boolean(editable && bottom && !bad),
      editable: Boolean(editable),
      bottom: Boolean(bottom),
      bad: Boolean(bad),
      tag,
      type,
      text: text.slice(0, 180),
      rect: r ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null,
    };
  }).catch((error) => ({ ok: false, reason: String(error?.message || error) }));
}

async function clickMarkedPromptComposer(page, token, rank) {
  const loc = page.locator(`[data-flow-worker-composer-token="${token}"][data-flow-worker-composer-rank="${rank}"]`).first();
  if (!(await loc.count().catch(() => 0))) return false;
  const box = await loc.boundingBox().catch(() => null);
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
    await loc.click({ timeout: 1600, force: true, position: box ? {
      x: Math.max(6, Math.min(box.width - 6, Math.round(box.width * 0.22))),
      y: Math.max(6, Math.min(box.height - 6, Math.round(box.height * 0.50))),
    } : undefined });
  } catch {
    if (!box) return false;
    await page.mouse.click(Math.round(box.x + Math.max(12, box.width * 0.22)), Math.round(box.y + box.height / 2)).catch(() => {});
  }
  await sleep(250);
  const info = await activeComposerInfo(page);
  if (info.ok) return true;
  // Một số ProseMirror focus vào child/parent sau click; thử focus trực tiếp bằng DOM.
  const focused = await loc.evaluate((el) => {
    const target = el.matches('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]')
      ? el
      : el.querySelector('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]') || el;
    target.focus?.();
    return true;
  }).catch(() => false);
  if (focused) await sleep(150);
  return Boolean((await activeComposerInfo(page)).ok);
}

async function focusBestPromptComposer(page) {
  const marked = await markPromptComposerCandidates(page);
  console.log('[FLOW DEBUG] prompt composer candidates', marked?.candidates || marked);
  for (let rank = 0; rank < Math.min(5, marked?.candidates?.length || 0); rank += 1) {
    const ok = await clickMarkedPromptComposer(page, marked.token, rank).catch(() => false);
    if (ok) return { ok: true, rank, candidate: marked.candidates[rank] };
  }
  await clickPromptInputArea(page).catch(() => {});
  const info = await activeComposerInfo(page);
  return { ok: Boolean(info.ok), fallback: true, active: info, candidates: marked?.candidates || [] };
}

async function firePromptInputEventsOnActive(page, promptText) {
  return page.evaluate((value) => {
    const el = document.activeElement;
    if (!el) return false;
    const dispatch = (target) => {
      try { target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value })); } catch {}
      try { target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); } catch { target.dispatchEvent(new Event('input', { bubbles: true })); }
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Process' }));
      try { target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value })); } catch {}
    };
    dispatch(el);
    const child = el.querySelector?.('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]');
    if (child && child !== el) dispatch(child);
    return true;
  }, promptText).catch(() => false);
}

async function keyboardInsertPromptIntoComposer(page, promptText) {
  const focus = await focusBestPromptComposer(page);
  if (!focus.ok) return { ok: false, reason: 'cannot-focus-composer', focus };
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  await sleep(80);
  await page.keyboard.press('Backspace').catch(() => {});
  await sleep(100);
  await page.keyboard.insertText(promptText).catch(async () => {
    await page.keyboard.type(promptText, { delay: Number(process.env.FLOW_TYPE_DELAY_MS || 5) });
  });
  await firePromptInputEventsOnActive(page, promptText).catch(() => false);
  await sleep(Number(process.env.FLOW_AFTER_PROMPT_DELAY_MS || 650));
  let verify = await verifyBottomComposerHasPrompt(page, promptText).catch(() => ({ ok: false }));
  if (verify.ok) return { ok: true, verify, focus, active: await activeComposerInfo(page).catch(() => null), method: 'keyboard-insertText' };

  // Paste fallback: nhiều editor React/ProseMirror nhận paste tốt hơn DOM textContent.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  const pasted = await page.evaluate(async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }, promptText).catch(() => false);
  if (pasted) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V').catch(() => {});
    await firePromptInputEventsOnActive(page, promptText).catch(() => false);
    await sleep(Number(process.env.FLOW_AFTER_PROMPT_DELAY_MS || 800));
    verify = await verifyBottomComposerHasPrompt(page, promptText).catch(() => ({ ok: false }));
    if (verify.ok) return { ok: true, verify, focus, active: await activeComposerInfo(page).catch(() => null), method: 'clipboard-paste' };
  }

  await page.keyboard.type(promptText, { delay: Number(process.env.FLOW_TYPE_DELAY_MS || 8) }).catch(() => {});
  await firePromptInputEventsOnActive(page, promptText).catch(() => false);
  await sleep(Number(process.env.FLOW_AFTER_PROMPT_DELAY_MS || 800));
  verify = await verifyBottomComposerHasPrompt(page, promptText).catch(() => ({ ok: false }));
  return { ok: Boolean(verify.ok), verify, focus, active: await activeComposerInfo(page).catch(() => null), method: pasted ? 'keyboard-type-after-paste-failed' : 'keyboard-type' };
}

async function getFlowSettingsPanelState(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 80 && rect.height > 50 &&
        rect.bottom > 0 && rect.right > 0 &&
        rect.top < window.innerHeight && rect.left < window.innerWidth &&
        style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const textOf = (el) => String([
      el.innerText,
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('role'),
    ].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
    const selector = [
      '[role="dialog"]', '[role="menu"]', '[role="listbox"]', '[role="tree"]', '[aria-modal="true"]',
      'div[popover]', 'div[class*="popover" i]', 'div[class*="menu" i]', 'div[class*="dialog" i]',
      'div[class*="modal" i]', 'div[class*="sheet" i]'
    ].join(',');
    const candidates = Array.from(document.querySelectorAll(selector)).filter(visible);
    let best = null;
    for (const el of candidates) {
      const text = textOf(el);
      const rect = el.getBoundingClientRect();
      let score = 0;
      if (/Generating will use\s+\d+\s+credits|Generating will use\s+0\s+credits/i.test(text)) score += 120;
      if (/\bImage\b[\s\S]{0,120}\bVideo\b|\bVideo\b[\s\S]{0,120}\bImage\b/i.test(text)) score += 45;
      if (/\bFrames\b|\bIngredients\b|16:9|9:16|4:3|1:1|3:4|1\s*x|x\s*1|2\s*x|x\s*2|3\s*x|x\s*3|4\s*x|x\s*4|\b4s\b|\b6s\b|\b8s\b/i.test(text)) score += 45;
      if (/Nano Banana|Imagen|Veo|Model|Fast|Standard/i.test(text)) score += 30;
      if (/Search for Assets|Recent|No results found|Assets/i.test(text)) score -= 70;
      if (rect.top < 80 && rect.height < 180) score -= 30;
      if (score > 70 && (!best || score > best.score)) {
        best = {
          open: true,
          score,
          text: text.slice(0, 220),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      }
    }
    return best || { open: false };
  }).catch(() => ({ open: false }));
}

async function closeSettingsPanelBeforePrompt(page, jobId = 'no-job') {
  const maxAttempts = Number(process.env.FLOW_CLOSE_SETTINGS_MAX_ATTEMPTS || 8);
  const strict = String(process.env.FLOW_STRICT_CLOSE_SETTINGS || 'false').toLowerCase() === 'true';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const state = await getFlowSettingsPanelState(page).catch(() => ({ open: false }));
    if (!state?.open) return true;
    console.log('[FLOW DEBUG] closing settings panel before prompt', { attempt: attempt + 1, state });

    // 1) Escape là cách an toàn nhất để đóng menu/listbox/dialog của Flow.
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(250);
    if (!(await getFlowSettingsPanelState(page).catch(() => ({ open: false })))?.open) return true;

    // 2) Click ra vùng trống phía trên composer, tránh click vào nút setting/submit.
    const viewport = page.viewportSize() || { width: 1400, height: 1000 };
    await page.mouse.click(Math.round(viewport.width * 0.50), Math.round(viewport.height * 0.38)).catch(() => {});
    await sleep(350);
    if (!(await getFlowSettingsPanelState(page).catch(() => ({ open: false })))?.open) return true;

    // 3) Click trực tiếp vào vùng prompt để Flow tự đóng popover.
    await clickPromptInputArea(page).catch(() => {});
    await sleep(350);
  }

  const finalState = await getFlowSettingsPanelState(page).catch(() => ({ open: false }));
  if (finalState?.open) {
    await debugStep(page, { jobId }, 'settings-panel-still-open-before-prompt-nonfatal', finalState).catch(() => {});
    console.log('[FLOW DEBUG] settings panel may still be open; continue typing instead of failing', finalState);
    if (strict) {
      throw new Error(`Panel setting/model của Flow vẫn đang mở: ${finalState.text || 'unknown panel'}`);
    }
  }
  return true;
}

async function verifyBottomComposerHasPrompt(page, promptText) {
  const prompt = String(promptText || '').trim();
  const bottomValues = await getBottomComposerText(page);
  if (!prompt) return { ok: false, reason: 'Prompt rỗng.', bottomValues };
  const snippet = prompt.slice(0, Math.min(24, prompt.length));
  const ok = bottomValues.some((item) => String(item.text || '').includes(snippet));
  return { ok, snippet, bottomValues };
}
async function forceSetTextOnFocusedOrBottomComposer(page, promptText) {
  const composer = await findBottomTextbox(page).catch(() => null);
  if (composer) {
    const ok = await composer.evaluate((el, value) => {
      const setNativeValue = (node, val) => {
        const proto =
          node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
          node instanceof HTMLInputElement ? HTMLInputElement.prototype :
          null;
        if (proto) {
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          setter?.call(node, val);
          node.dispatchEvent(new InputEvent('input', { bubbles: true, data: val, inputType: 'insertText' }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      };
      el.focus();
      if (setNativeValue(el, value)) return true;
      if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
        el.textContent = '';
        el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: value, inputType: 'insertText' }));
        el.textContent = value;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      const child = el.querySelector('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]');
      if (child) {
        child.focus();
        if (setNativeValue(child, value)) return true;
        child.textContent = value;
        child.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        child.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, promptText).catch(() => false);
    if (ok) return true;
  }
  return page.evaluate((value) => {
    const active = document.activeElement;
    if (!active) return false;
    const proto =
      active instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
      active instanceof HTMLInputElement ? HTMLInputElement.prototype :
      null;
    if (proto) {
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(active, value);
      active.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (active.isContentEditable || active.getAttribute('role') === 'textbox') {
      active.textContent = value;
      active.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }, promptText).catch(() => false);
}
async function setComposerText(page, value, job) {
  const promptText = String(value || '').trim();
  if (!promptText) throw new Error('Prompt rỗng trước khi nhập vào Flow.');

  // Chỉ ensure surface khi thật sự cần. Sau khi đã set setting xong, gọi lại ensureGenerationSurface
  // có thể mở lại panel Image/Video ngay trước lúc nhập prompt.
  if (job) await ensureGenerationSurface(page, job).catch((error) => {
    console.log('[FLOW DEBUG] ensureGenerationSurface before prompt was non-fatal:', error?.message || error);
  });

  await closeSettingsPanelBeforePrompt(page, job?.jobId || 'no-job');

  // Đường chính mới: focus đúng editor bottom thật, rồi nhập bằng keyboard/CDP.
  // Không dùng textContent/innerText làm đường chính vì Flow/React có thể nhìn thấy chữ
  // trên DOM nhưng state nội bộ vẫn rỗng và báo "prompt must be provided".
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await keyboardInsertPromptIntoComposer(page, promptText).catch((error) => ({ ok: false, reason: error?.message || error }));
    console.log('[FLOW DEBUG] keyboard prompt insert attempt', { attempt, result });
    if (result?.ok) return true;
    await closeSettingsPanelBeforePrompt(page, job?.jobId || 'no-job').catch(() => {});
    await sleep(300);
  }

  async function clearAndTypeWithKeyboard(clickerLabel, clicker) {
    await clicker();
    await sleep(250);
    const active = await activeComposerInfo(page).catch(() => ({ ok: false }));
    if (!active.ok) {
      console.log('[FLOW DEBUG] skip legacy typing because active element is not composer', { clickerLabel, active });
      return false;
    }
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await sleep(80);
    await page.keyboard.press('Backspace').catch(() => {});
    await sleep(120);
    await page.keyboard.insertText(promptText).catch(async () => {
      await page.keyboard.type(promptText, { delay: Number(process.env.FLOW_TYPE_DELAY_MS || 8) });
    });
    await firePromptInputEventsOnActive(page, promptText).catch(() => false);
    await sleep(650);
    let verify = await verifyBottomComposerHasPrompt(page, promptText).catch(() => ({ ok: false }));
    console.log('[FLOW DEBUG] verify after prompt input', { clickerLabel, verify });
    if (verify.ok) return true;

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await sleep(80);
    await page.keyboard.press('Backspace').catch(() => {});
    await sleep(120);
    await page.keyboard.type(promptText, { delay: Number(process.env.FLOW_TYPE_DELAY_MS || 10) }).catch(() => {});
    await firePromptInputEventsOnActive(page, promptText).catch(() => false);
    await sleep(800);
    verify = await verifyBottomComposerHasPrompt(page, promptText).catch(() => ({ ok: false }));
    console.log('[FLOW DEBUG] verify after prompt keyboard.type fallback', { clickerLabel, verify });
    return Boolean(verify.ok);
  }

  const arrow = await findSubmitArrowBox(page).catch(() => null);
  if (arrow?.box) {
    const y = Math.round(arrow.box.y + arrow.box.height / 2);
    const xs = [
      Math.max(260, Math.round(arrow.box.x - 520)),
      Math.max(260, Math.round(arrow.box.x - 390)),
      Math.max(260, Math.round(arrow.box.x - 260)),
    ];
    for (const x of xs) {
      const ok = await clearAndTypeWithKeyboard('left-of-submit-arrow', async () => {
        console.log('[FLOW DEBUG] click prompt area before typing', { arrow, click: { x, y } });
        await page.mouse.click(x, y);
      }).catch(() => false);
      if (ok) return true;
      await closeSettingsPanelBeforePrompt(page, job?.jobId || 'no-job').catch(() => {});
    }
  }

  const okViaKnownInput = await clearAndTypeWithKeyboard('known-bottom-composer', async () => {
    await clickPromptInputArea(page);
  }).catch(() => false);
  if (okViaKnownInput) return true;

  // Fallback cuối: DOM chỉ dùng sau khi keyboard thất bại, và vẫn phải verify.
  await focusBestPromptComposer(page).catch(() => null);
  await forceSetTextOnFocusedOrBottomComposer(page, promptText).catch(() => false);
  await firePromptInputEventsOnActive(page, promptText).catch(() => false);
  await sleep(600);
  const finalVerify = await verifyBottomComposerHasPrompt(page, promptText).catch(() => ({ ok: false }));
  console.log('[FLOW DEBUG] final prompt verify after DOM fallback', finalVerify);
  if (!finalVerify.ok) {
    await debugStep(page, job || { jobId: 'no-job' }, 'prompt-not-entered-in-flow-composer', { finalVerify }).catch(() => {});
    throw new Error('Prompt chưa vào đúng ô prompt Flow. Worker dừng trước khi bấm Generate để tránh lỗi prompt must be provided.');
  }
  return true;
}
async function flowVisibleTextSnapshot(page) {
  return page.evaluate(() => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim()).catch(() => '');
}

function escapeForExactText(value) {
  return escapeRegex(String(value || '').trim());
}

async function clickBestSettingOption(page, labels, { exact = true, timeout = 1600 } = {}) {
  const values = ensureArray(labels).map((item) => String(item || '').trim()).filter(Boolean);
  if (!values.length) return false;

  const selectors = [
    '[role="option"]',
    '[role="menuitem"]',
    '[role="radio"]',
    '[role="button"]',
    'button',
    'label',
    'span',
    'div',
  ];

  for (const label of values) {
    const rx = exact
      ? new RegExp(`^\\s*${escapeForExactText(label)}\\s*$`, 'i')
      : new RegExp(escapeRegex(label), 'i');
    for (const selector of selectors) {
      const items = page.locator(`${selector}:visible`).filter({ hasText: rx });
      const count = await items.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 8); i += 1) {
        const item = items.nth(i);
        try {
          const box = await item.boundingBox();
          if (!box) continue;
          const meta = await item.evaluate((el) => ({
            text: String(el.innerText || el.textContent || '').trim(),
            aria: String(el.getAttribute('aria-label') || '').trim(),
            title: String(el.getAttribute('title') || '').trim(),
            disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
          })).catch(() => ({ text: '', aria: '', title: '', disabled: false }));
          if (meta.disabled) continue;
          const allText = `${meta.text} ${meta.aria} ${meta.title}`.replace(/\s+/g, ' ').trim();
          if (!rx.test(allText) && !rx.test(meta.text)) continue;
          // Bỏ các item topbar/account/search; Flow setting nằm trong dock/popup ở giữa hoặc nửa dưới màn hình.
          const lower = allText.toLowerCase();
          if (/account|profile|sign out|log out|help|privacy|terms|search for assets|recent|no results found/.test(lower)) continue;
          await item.click({ timeout });
          await sleep(650);
          return true;
        } catch {}
      }
    }
  }
  return false;
}

async function openSettingsPanel(page) {
  const before = await getFlowSettingsPanelState(page).catch(() => ({ open: false }));
  if (before?.open) return true;
  const clicked = await clickBottomModePill(page).catch(() => false);
  await sleep(650);
  const after = await getFlowSettingsPanelState(page).catch(() => ({ open: false }));
  // Không fail cứng nếu detector không nhận ra panel: Flow thay DOM thường xuyên.
  // chooseSetting vẫn sẽ chỉ bấm option visible có label khớp, nhưng không được chặn prompt/generate.
  return Boolean(after?.open || clicked);
}

async function chooseSetting(page, labels, { exact = true, verifyLabels = [], delayMs = 700 } = {}) {
  const wanted = ensureArray(labels).filter(Boolean);
  const verify = ensureArray(verifyLabels).filter(Boolean);
  if (!wanted.length) return false;
  for (let attempt = 1; attempt <= Number(process.env.FLOW_SETTING_RETRY_ATTEMPTS || 2); attempt += 1) {
    const opened = await openSettingsPanel(page).catch(() => false);
    const clicked = opened ? await clickBestSettingOption(page, wanted, { exact, timeout: 1800 }).catch(() => false) : false;
    await sleep(delayMs);
    const snapshot = await flowVisibleTextSnapshot(page);
    const verified = verify.length
      ? verify.some((item) => snapshot.toLowerCase().includes(String(item).toLowerCase()))
      : clicked;
    console.log('[FLOW DEBUG] chooseSetting', { wanted, attempt, opened, clicked, verified });
    // Luôn cố đóng panel sau mỗi setting, để bước nhập prompt không bị kẹt.
    await closeSettingsPanelBeforePrompt(page, 'choose-setting').catch(() => {});
    if (clicked && verified) return true;
  }
  return false;
}

async function chooseModel(page, modelId) {
  if (!modelId) return false;
  const labels = MODEL_LABELS[modelId] || [modelId];
  const selected = await chooseSetting(page, labels, {
    exact: false,
    verifyLabels: labels,
    delayMs: FLOW_AFTER_SELECT_MODEL_DELAY_MS,
  });
  if (!selected) {
    const select = page.locator('select:visible').first();
    if (await select.count()) {
      await select.selectOption(modelId).catch(async () => {
        for (const label of labels) await select.selectOption({ label }).catch(() => {});
      });
    }
  }
  await sleep(FLOW_AFTER_SELECT_MODEL_DELAY_MS);
  return selected;
}

async function chooseAspectRatio(page, aspectRatio) {
  if (!aspectRatio) return false;
  return chooseSetting(page, [aspectRatio], { exact: true, verifyLabels: [aspectRatio] });
}

async function readBottomDockSettingLabels(page) {
  const viewport = page.viewportSize() || { width: 1400, height: 1000 };
  return page.evaluate(({ minY }) => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 20 && rect.height > 18 &&
        rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth &&
        style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const textOf = (el) => String([
      el.innerText,
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
    ].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();

    return Array.from(document.querySelectorAll('button,[role="button"],div[role="button"],label,span,div'))
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: textOf(el),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        };
      })
      .filter((item) => item.rect.y >= minY && /\b(Image|Video)\b|x\s*[1-4]|[1-4]\s*x|16:9|9:16|4:3|1:1|3:4|Nano|Banana|Imagen|Veo/i.test(item.text))
      .slice(0, 80);
  }, { minY: Math.round(viewport.height * 0.48) }).catch(() => []);
}

function multiplierLabelVariants(count = 1) {
  const safeCount = Math.max(1, Math.min(Number(count || 1), 4));
  // Flow UI currently renders the first option as "1x", while the collapsed pill
  // and older UI variants may render multipliers as "x1/x2/x3/x4".
  // Keep both orders so web setting xN is mapped to the exact Flow chip.
  const variants = safeCount === 1
    ? ['1x', 'x1']
    : [`x${safeCount}`, `${safeCount}x`];
  return [...new Set(variants)];
}

function multiplierTokenRegex(count = 1) {
  const safeCount = Math.max(1, Math.min(Number(count || 1), 4));
  return new RegExp(`(?:^|\\s|\\b)(?:x\\s*${safeCount}|${safeCount}\\s*x)(?:$|\\s|\\b)`, 'i');
}

function textHasExactMultiplier(text = '', count = 1) {
  return multiplierTokenRegex(count).test(String(text || ''));
}

function textHasConflictingMultiplier(text = '', count = 1) {
  const safeCount = Math.max(1, Math.min(Number(count || 1), 4));
  const found = [...String(text || '').matchAll(/(?:^|\s|\b)(?:x\s*([1-4])|([1-4])\s*x)(?:$|\s|\b)/ig)]
    .map((match) => Number(match[1] || match[2]))
    .filter(Boolean);
  return found.some((value) => value !== safeCount);
}

async function verifyMultiplierSelection(page, job, count, { throwOnFail = true } = {}) {
  const safeCount = Math.max(1, Math.min(Number(count || 1), 4));
  await closeSettingsPanelBeforePrompt(page, job?.jobId || 'verify-multiplier').catch(() => {});
  await sleep(450);
  const labels = await readBottomDockSettingLabels(page).catch(() => []);
  const joined = labels.map((item) => item.text).join(' | ');
  const candidates = labels.filter((item) => /x\s*[1-4]|[1-4]\s*x/i.test(item.text));
  const exact = candidates.some((item) => textHasExactMultiplier(item.text, safeCount));
  const conflict = candidates.some((item) => textHasConflictingMultiplier(item.text, safeCount));
  console.log('[FLOW DEBUG] verify multiplier selection', { expected: multiplierLabelVariants(safeCount).join('/'), exact, conflict, labels: labels.slice(0, 12) });
  if (exact && !conflict) return true;
  if (conflict) {
    if (!throwOnFail) return false;
    throw new Error(`Flow vẫn đang hiển thị multiplier cũ (${joined || 'không rõ'}), chưa đúng ${multiplierLabelVariants(safeCount).join('/')} theo setting trên web. Worker dừng để tránh tạo sai số lượng.`);
  }
  if (FLOW_STRICT_MULTIPLIER_VERIFY) {
    if (!throwOnFail) return false;
    throw new Error(`Không xác nhận được Flow đã chọn đúng ${multiplierLabelVariants(safeCount).join('/')} theo setting trên web. Worker dừng trước khi Generate để tránh tạo sai số lượng.`);
  }
  return true;
}

async function getVisibleMultiplierCandidates(page, count) {
  const safeCount = Math.max(1, Math.min(Number(count || 1), 4));
  return page.evaluate(({ safeCount }) => {
    const desiredRx = new RegExp(`(?:^|\\s|\\b)(?:x\\s*${safeCount}|${safeCount}\\s*x)(?:$|\\s|\\b)`, 'i');
    const exactDesiredRx = new RegExp(`^\\s*(?:x\\s*${safeCount}|${safeCount}\\s*x)\\s*$`, 'i');
    const exactNumberRx = new RegExp(`^\\s*${safeCount}\\s*$`, 'i');
    const optionContextRx = /1\s*x|x\s*1|2\s*x|x\s*2|3\s*x|x\s*3|4\s*x|x\s*4|Generating will use|credits|Image|Video/i;
    const blockerRx = /account|profile|sign out|log out|help|privacy|terms|search for assets|recent|no results found|asset/i;

    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 8 && rect.height > 8 &&
        rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth &&
        style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 &&
        style.pointerEvents !== 'none';
    };
    const textOf = (el) => String([
      el.innerText,
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('data-testid'),
      el.getAttribute?.('role'),
    ].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();

    const panelSelector = [
      '[role="dialog"]', '[role="menu"]', '[role="listbox"]', '[role="tree"]', '[aria-modal="true"]',
      'div[popover]', 'div[class*="popover" i]', 'div[class*="menu" i]', 'div[class*="dialog" i]',
      'div[class*="modal" i]', 'div[class*="sheet" i]'
    ].join(',');
    const panels = Array.from(document.querySelectorAll(panelSelector)).filter(visible).map((el) => {
      const rect = el.getBoundingClientRect();
      const text = textOf(el);
      let score = 0;
      if (/Generating will use\s+\d+\s+credits|Generating will use\s+0\s+credits/i.test(text)) score += 120;
      if (/1\s*x|x\s*1|2\s*x|x\s*2|3\s*x|x\s*3|4\s*x|x\s*4/i.test(text)) score += 80;
      if (/\bImage\b|\bVideo\b|16:9|9:16|4:3|1:1|3:4|\b4s\b|\b6s\b|\b8s\b/i.test(text)) score += 30;
      if (/Search for Assets|Recent|No results found|Assets/i.test(text)) score -= 100;
      return { el, rect, text, score };
    }).filter((item) => item.score > 20)
      .sort((a, b) => b.score - a.score);

    const bestPanel = panels[0]?.el || null;
    const panelRect = bestPanel?.getBoundingClientRect?.() || null;
    const panelText = bestPanel ? textOf(bestPanel) : '';
    const scope = bestPanel ? Array.from(bestPanel.querySelectorAll('*')) : [];
    const broader = Array.from(document.querySelectorAll('button,[role="button"],[role="option"],[role="menuitem"],[role="radio"],label,span,div'));
    const nodes = [...new Set([...scope, ...broader])].filter(visible);

    const candidates = [];
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      const text = textOf(el);
      if (!text || blockerRx.test(text)) continue;
      const inPanel = bestPanel ? (el === bestPanel || bestPanel.contains(el)) : false;
      const nearBottomDock = rect.top > window.innerHeight * 0.45;
      const role = String(el.getAttribute?.('role') || '').toLowerCase();
      const tag = String(el.tagName || '').toLowerCase();
      const isClickable = tag === 'button' || tag === 'label' || /button|option|menuitem|radio/.test(role) || el.onclick || el.tabIndex >= 0;
      let score = 0;
      if (inPanel) score += 70;
      if (isClickable) score += 25;
      if (nearBottomDock) score += 12;
      if (exactDesiredRx.test(text)) score += 120;
      else if (desiredRx.test(text)) score += 85;
      else if (exactNumberRx.test(text) && (inPanel || optionContextRx.test(panelText))) score += 35;
      else continue;
      if (/16:9|9:16|4:3|3:4|1:1|4s|6s|8s|Nano|Banana|Imagen|Veo|Model/i.test(text)) score -= 25;
      if (rect.width > 520 || rect.height > 160) score -= 35;
      if (score <= 20) continue;
      candidates.push({
        text: text.slice(0, 160),
        score,
        inPanel,
        isClickable: Boolean(isClickable),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        panelRect: panelRect ? { x: panelRect.x, y: panelRect.y, width: panelRect.width, height: panelRect.height } : null,
      });
    }
    return candidates.sort((a, b) => b.score - a.score).slice(0, 12);
  }, { safeCount }).catch(() => []);
}

async function clickMultiplierByPanelGrid(page, count) {
  const safeCount = Math.max(1, Math.min(Number(count || 1), 4));
  const state = await getFlowSettingsPanelState(page).catch(() => ({ open: false }));
  if (!state?.open || !state?.rect) return false;
  const text = String(state.text || '');
  if (!/1\s*x|x\s*1|2\s*x|x\s*2|3\s*x|x\s*3|4\s*x|x\s*4/i.test(text)) return false;
  const r = state.rect;
  const ratios = [0.145, 0.385, 0.62, 0.855];
  const x = Math.round(r.x + r.width * ratios[safeCount - 1]);
  // In the current Flow popup, the multiplier row is the row under aspect ratio.
  // This fallback is only used after text/role selectors fail.
  const yCandidates = [0.49, 0.52, 0.56].map((ratio) => Math.round(r.y + r.height * ratio));
  for (const y of yCandidates) {
    try {
      await page.mouse.click(x, y);
      await sleep(650);
      const verified = await verifyMultiplierSelection(page, null, safeCount, { throwOnFail: false }).catch(() => false);
      if (verified === true) return true;
      await openSettingsPanel(page).catch(() => false);
      await sleep(250);
    } catch {}
  }
  return false;
}

async function clickMultiplierCandidate(page, count) {
  const safeCount = Math.max(1, Math.min(Number(count || 1), 4));
  const expectedLabels = multiplierLabelVariants(safeCount);
  const candidates = await getVisibleMultiplierCandidates(page, safeCount);
  console.log('[FLOW DEBUG] multiplier candidates', { expected: expectedLabels.join('/'), candidates: candidates.slice(0, 8) });
  for (const candidate of candidates) {
    try {
      const x = Math.round(candidate.rect.x + candidate.rect.width / 2);
      const y = Math.round(candidate.rect.y + candidate.rect.height / 2);
      await page.mouse.click(x, y);
      await sleep(650);
      return true;
    } catch {}
  }
  return clickMultiplierByPanelGrid(page, safeCount);
}

async function chooseMultiplierViaPanel(page, count) {
  const safeCount = Math.max(1, Math.min(Number(count || 1), 4));
  for (let attempt = 1; attempt <= FLOW_MULTIPLIER_CLICK_ATTEMPTS; attempt += 1) {
    const before = await verifyMultiplierSelection(page, null, safeCount, { throwOnFail: false }).catch(() => false);
    if (before === true) return true;

    const opened = await openSettingsPanel(page).catch(() => false);
    await sleep(350);

    // Đường cũ: dùng text selector. Giữ lại vì ổn khi Flow render option là button/role option riêng.
    let clicked = false;
    if (opened) {
      const labels = multiplierLabelVariants(safeCount);
      clicked = await clickBestSettingOption(page, labels, { exact: true, timeout: 1600 }).catch(() => false);
      if (!clicked) clicked = await clickBestSettingOption(page, labels, { exact: false, timeout: 1600 }).catch(() => false);
      if (!clicked) clicked = await clickMultiplierCandidate(page, safeCount).catch(() => false);
    }

    await sleep(500);
    const verified = await verifyMultiplierSelection(page, null, safeCount, { throwOnFail: false }).catch(() => false);
    console.log('[FLOW DEBUG] choose multiplier attempt', { expected: multiplierLabelVariants(safeCount).join('/'), attempt, opened, clicked, verified });
    if (verified === true) return true;

    // Nếu panel bị đóng hoặc click nhầm, đóng hẳn rồi thử lại từ đầu để tránh giữ state cũ.
    await closeSettingsPanelBeforePrompt(page, `multiplier-retry-x${safeCount}`).catch(() => {});
    await sleep(300);
  }
  return false;
}

async function chooseMultiplier(page, count, job = null) {
  const safeCount = Math.max(1, Math.min(Number(count || 1), 4));
  // Không mặc định ép x1. safeCount luôn lấy từ setting web:
  // video = job.videosPerPrompt, image = job.countPerPrompt.
  const selected = await chooseMultiplierViaPanel(page, safeCount);
  if (!selected && FLOW_STRICT_MULTIPLIER_VERIFY) {
    throw new Error(`Không chọn/xác nhận được multiplier ${multiplierLabelVariants(safeCount).join('/')} theo setting trên web. Worker dừng để tránh Flow giữ multiplier cũ và tạo sai số lượng.`);
  }
  await verifyMultiplierSelection(page, job, safeCount);
  return selected;
}

async function chooseDuration(page, seconds) {
  const safeSeconds = Number(seconds || 8);
  return chooseSetting(page, [`${safeSeconds}s`, String(safeSeconds)], {
    exact: true,
    verifyLabels: [`${safeSeconds}s`],
  });
}

async function chooseFrameMode(page, frame = 'Frames') {
  await clickVisibleText(page, [frame], { exact: false, timeout: 1500 });
}

async function ensureMode(page, job) {
  await ensureGenerationSurface(page, job);

  const tab = job.outputType === 'image' ? 'Image' : 'Video';
  await clickVisibleText(page, [tab], { exact: false, timeout: 2000 }).catch(() => { });

  if (job.tool === 'image-to-video') {
    await chooseFrameMode(page, job.frame || 'Frames');
  }
}

async function uploadAssetIntoNthInput(page, filePath, nth = 0) {
  if (!filePath) return false;
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count().catch(() => 0);
  if (count > nth) {
    await inputs.nth(nth).setInputFiles(filePath);
    await sleep(FLOW_AFTER_UPLOAD_DELAY_MS);
    return true;
  }
  return false;
}

async function clickUploadButton(page, labels) {
  return clickVisibleText(page, labels, { exact: false, timeout: 1500 });
}

async function uploadImageAssets(page, job, localFiles = {}) {
  const startPath = localFiles.start || null;
  const endPath = localFiles.end || null;
  if (!startPath) return;

  let uploaded = await uploadAssetIntoNthInput(page, startPath, 0);
  if (!uploaded) {
    await clickUploadButton(page, ['Start frame', 'Upload', 'Upload image', 'Add frame', 'Frames']);
    uploaded = await uploadAssetIntoNthInput(page, startPath, 0);
  }
  if (!uploaded) throw new Error('Không upload được ảnh điểm đầu lên Flow.');

  if (job.tool === 'image-to-video' && endPath) {
    let endUploaded = await uploadAssetIntoNthInput(page, endPath, 1);
    if (!endUploaded) {
      await clickUploadButton(page, ['End frame', 'Add end frame', 'Upload end frame']);
      endUploaded = await uploadAssetIntoNthInput(page, endPath, 1);
    }
    if (endUploaded) await sleep(FLOW_AFTER_UPLOAD_DELAY_MS);
  }
}

async function hasPromptRequiredError(page) {
  try {
    return (await page.getByText(/prompt must be provided|prompt is required|enter a prompt|please provide a prompt/i).count()) > 0;
  } catch {
    return false;
  }
}
async function hasGenerationStarted(page) {
  if (await hasPromptRequiredError(page)) {
    console.log('[FLOW DEBUG] prompt-required error detected');
    return false;
  }
  // Flow thay đổi chữ trạng thái khá thường xuyên. Kiểm tra cả text tiếng Anh/Việt,
  // nhưng loại trừ CTA tĩnh "Start creating" để không nhận nhầm trước khi submit.
  const checks = [
    /generating/i,
    /processing/i,
    /queued/i,
    /rendering/i,
    /creating/i,
    /in progress/i,
    /please wait/i,
    /starting/i,
    /đang tạo/i,
    /đang xử lý/i,
    /đang chờ/i,
  ];
  const blocker = /start creating|what do you want to create|create with|tạo mới/i;
  for (const rx of checks) {
    try {
      const loc = page.getByText(rx).first();
      if (!(await loc.count())) continue;
      const text = String(await loc.innerText({ timeout: 700 }).catch(() => '') || '').trim();
      if (text && blocker.test(text) && !/generating|processing|rendering|queued|in progress|đang/i.test(text)) continue;
      return true;
    } catch {}
  }
  return false;
}async function markSubmitCandidates(page) {
  return page.evaluate(() => {
    const token = `fw-submit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || 1) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 8 && rect.height >= 8 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    };
    const textOf = (el) => [
      el.innerText || '',
      el.textContent || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.getAttribute('data-tooltip') || '',
      el.getAttribute('jsname') || '',
      el.getAttribute('class') || '',
    ].join(' ').replace(/\s+/g, ' ').trim();

    // Xác định vùng composer dưới màn hình để ưu tiên nút tròn bên phải composer.
    const textboxes = Array.from(document.querySelectorAll(
      'textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],div.ProseMirror'
    )).filter(isVisible);
    let composerRect = null;
    let composerScore = -9999;
    for (const el of textboxes) {
      const rect = el.getBoundingClientRect();
      const label = textOf(el).toLowerCase();
      let score = 0;
      if (rect.top > window.innerHeight * 0.45) score += 30;
      if (rect.top > window.innerHeight * 0.60) score += 25;
      if (rect.width > 280) score += 20;
      if (/what do you want to create|prompt|describe|create/.test(label)) score += 35;
      if (/search|asset|recent|filter/.test(label)) score -= 80;
      if (score > composerScore) {
        composerScore = score;
        composerRect = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      }
    }

    const rawClickables = Array.from(document.querySelectorAll(
      'button,[role="button"],div[role="button"],span[role="button"],a,[tabindex],mat-icon,mwc-icon'
    )).filter(isVisible);

    // Deduplicate: nếu con nằm trong button/role=button thì dùng ancestor thật.
    const clickables = [];
    const seen = new Set();
    for (const el of rawClickables) {
      const host = el.closest('button,[role="button"],a,[tabindex]') || el;
      if (seen.has(host) || !isVisible(host)) continue;
      seen.add(host);
      clickables.push(host);
    }

    const candidates = [];
    for (const el of clickables) {
      try {
        const rect = el.getBoundingClientRect();
        const label = textOf(el);
        const lower = label.toLowerCase();
        const disabled =
          Boolean(el.disabled) ||
          el.getAttribute('disabled') !== null ||
          el.getAttribute('aria-disabled') === 'true' ||
          /\bdisabled\b|mat-mdc-button-disabled|mdc-button--disabled/.test(lower);
        const hasSvg = Boolean(el.querySelector('svg,path,mat-icon,mwc-icon'));
        const html = String(el.innerHTML || '').slice(0, 800).toLowerCase();
        let score = 0;

        // Nút Generate có thể là text button hoặc nút tròn mũi tên/send cạnh composer.
        if (/\bgenerate\b/i.test(label)) score += 140;
        if (/\bsend\b|\bsubmit\b|\brun\b|\bgo\b/i.test(label)) score += 95;
        if (/arrow|arrow_forward|send|paper|plane|spark|magic|create/i.test(label) || /arrow_forward|send|paper|plane|magic|spark/.test(html)) score += 70;
        if (hasSvg) score += 18;

        // Vị trí gần composer là tín hiệu mạnh nhất cho UI Flow mới.
        if (rect.top > window.innerHeight * 0.45) score += 22;
        if (rect.top > window.innerHeight * 0.60) score += 28;
        if (rect.left > window.innerWidth * 0.50) score += 18;
        if (rect.width >= 24 && rect.width <= 96 && rect.height >= 24 && rect.height <= 96) score += 20;
        if (Math.abs(rect.width - rect.height) <= 30) score += 10;
        if (composerRect) {
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const composerCy = composerRect.top + composerRect.height / 2;
          if (Math.abs(cy - composerCy) < 150) score += 34;
          if (cx > composerRect.left + composerRect.width * 0.68 && cx < composerRect.right + 140) score += 42;
          if (rect.left >= composerRect.left && rect.right <= composerRect.right + 120) score += 18;
        }

        // Tránh bấm setting/model/menu/account.
        if (/\bvideo\b|\bimage\b|x\s*[1-4]|9:16|16:9|4:3|1:1|3:4|nano|banana|imagen|veo|model|duration|seconds|quality|aspect/i.test(label)) score -= 85;
        if (/help|settings|account|profile|search|filter|menu|more|assets|recent|ultra|credits|library|upload|download|delete/i.test(lower)) score -= 70;
        if (rect.top < 140) score -= 80;
        if (disabled) score -= 90;

        candidates.push({
          el,
          label,
          disabled,
          score,
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      } catch {}
    }

    candidates.sort((a, b) => b.score - a.score);
    candidates.slice(0, 12).forEach((item, index) => {
      item.el.setAttribute('data-flow-worker-submit-token', token);
      item.el.setAttribute('data-flow-worker-submit-rank', String(index));
    });
    return {
      token,
      composerRect,
      candidates: candidates.slice(0, 12).map(({ label, disabled, score, box }) => ({ label, disabled, score, box })),
    };
  }).catch((error) => ({ token: '', composerRect: null, candidates: [], error: String(error?.message || error) }));
}

async function nudgeComposerState(page, promptText = '') {
  const prompt = String(promptText || '').trim();
  await page.evaluate((value) => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      if (!style || style.visibility === 'hidden' || style.display === 'none') return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 8 && rect.height >= 8 && rect.top < window.innerHeight && rect.bottom > 0;
    };
    const candidates = Array.from(document.querySelectorAll(
      'textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],div.ProseMirror'
    )).filter(isVisible).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    const el = candidates[0] || document.activeElement;
    if (!el) return false;
    const setValue = (node, val) => {
      if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
        const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter?.call(node, val);
        return true;
      }
      if (node.isContentEditable || node.getAttribute?.('role') === 'textbox') {
        // Không set textContent ở bước nudge: React/ProseMirror có thể hiển thị chữ
        // nhưng state nội bộ vẫn rỗng, dẫn tới Flow báo prompt must be provided.
        node.focus();
        return true;
      }
      return false;
    };
    el.focus?.();
    if (value) setValue(el, value);
    for (const type of ['beforeinput', 'input']) {
      el.dispatchEvent(new InputEvent(type, { bubbles: true, cancelable: true, data: value, inputType: 'insertText' }));
    }
    for (const type of ['change', 'keyup', 'compositionend']) {
      el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    }
    return true;
  }, prompt).catch(() => false);
  await sleep(350);
}

async function clickMarkedCandidate(page, token, rank, label = 'submit candidate') {
  const loc = page.locator(`[data-flow-worker-submit-token="${token}"][data-flow-worker-submit-rank="${rank}"]`).first();
  if (!(await loc.count().catch(() => 0))) return false;
  const box = await loc.boundingBox().catch(() => null);
  const meta = await loc.evaluate((el) => ({
    text: (el.innerText || '').trim(),
    aria: (el.getAttribute('aria-label') || '').trim(),
    title: (el.getAttribute('title') || '').trim(),
    disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('disabled') !== null,
  })).catch(() => ({ text: '', aria: '', title: '', disabled: false }));
  console.log(`[FLOW DEBUG] clicking ${label}`, { rank, meta, box });

  // 1) Playwright click bình thường.
  try {
    await loc.click({ timeout: 1800 });
    await sleep(1200);
    return true;
  } catch (error) {
    console.log(`[FLOW DEBUG] normal click ${label} failed`, error?.message || error);
  }

  // 2) Force click khi overlay vô hình che nút.
  try {
    await loc.click({ timeout: 1800, force: true });
    await sleep(1200);
    return true;
  } catch (error) {
    console.log(`[FLOW DEBUG] force click ${label} failed`, error?.message || error);
  }

  // 3) Click theo toạ độ trung tâm.
  if (box) {
    try {
      await page.mouse.click(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
      await sleep(1200);
      return true;
    } catch (error) {
      console.log(`[FLOW DEBUG] mouse coordinate click ${label} failed`, error?.message || error);
    }
  }

  // 4) DOM click cuối cùng.
  try {
    const clicked = await loc.evaluate((el) => {
      el.scrollIntoView?.({ block: 'center', inline: 'center' });
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.click?.();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    }).catch(() => false);
    if (clicked) {
      await sleep(1200);
      return true;
    }
  } catch {}
  return false;
}

async function clickGenerateByText(page) {
  const locators = [
    page.getByRole('button', { name: /generate/i }).last(),
    page.locator('button:visible,[role="button"]:visible').filter({ hasText: /generate/i }).last(),
    page.getByText(/^generate$/i).last(),
    page.getByText(/generate/i).last(),
  ];
  for (const loc of locators) {
    try {
      if (!(await loc.count().catch(() => 0))) continue;
      await loc.click({ timeout: 1600 }).catch(async () => loc.click({ timeout: 1600, force: true }));
      await sleep(1200);
      return true;
    } catch (error) {
      console.log('[FLOW DEBUG] clickGenerateByText fallback failed', error?.message || error);
    }
  }
  return false;
}

async function clickSubmitNearComposerByCoordinate(page) {
  const marked = await markSubmitCandidates(page);
  const composer = marked?.composerRect;
  if (!composer) return false;

  // Bấm nhiều điểm ở cạnh phải composer. Đây là fallback khi Flow render nút bằng icon/SVG không có label.
  const points = [
    { x: composer.right - 34, y: composer.top + composer.height / 2 },
    { x: composer.right - 52, y: composer.top + composer.height / 2 },
    { x: composer.right - 76, y: composer.top + composer.height / 2 },
    { x: Math.min(windowWidthFallback(page), composer.right + 34), y: composer.top + composer.height / 2 },
  ];
  for (const point of points) {
    try {
      console.log('[FLOW DEBUG] coordinate submit fallback', point);
      await page.mouse.click(Math.round(point.x), Math.round(point.y));
      await sleep(1200);
      return true;
    } catch {}
  }
  return false;
}

function windowWidthFallback(page) {
  const viewport = page.viewportSize?.() || { width: 1400 };
  return viewport.width - 12;
}

async function clickComposerSubmitArrow(page) {
  const marked = await markSubmitCandidates(page);
  console.log('[FLOW DEBUG] submit candidates', marked?.candidates || marked);

  // Ưu tiên mọi candidate có điểm đủ cao, kể cả khi label rỗng nhưng đúng vị trí cạnh composer.
  const candidates = ensureArray(marked?.candidates);
  for (let rank = 0; rank < Math.min(candidates.length, 8); rank += 1) {
    const candidate = candidates[rank];
    if (!candidate || candidate.score < Number(process.env.FLOW_SUBMIT_MIN_SCORE || 18)) continue;
    if (candidate.disabled && !/\bgenerate\b|send|submit|arrow/i.test(candidate.label || '')) continue;
    const clicked = await clickMarkedCandidate(page, marked.token, rank, 'submit candidate').catch(() => false);
    if (clicked) return true;
  }

  // Text button cũ.
  if (await clickGenerateByText(page)) return true;

  // Coordinate fallback cạnh composer.
  return clickSubmitNearComposerByCoordinate(page);
}
async function assumeSubmittedAfterClick(page, promptText, source = 'click') {
  const deadline = Date.now() + Number(process.env.FLOW_SUBMIT_VERIFY_TIMEOUT_MS || 25000);
  let promptStillVisible = true;
  while (Date.now() < deadline) {
    if (await hasPromptRequiredError(page)) {
      console.log(`[FLOW DEBUG] ${source} failed: Prompt must be provided`);
      return false;
    }
    if (await hasGenerationStarted(page)) {
      console.log(`[FLOW DEBUG] generation signal detected after ${source}`);
      return true;
    }
    const verifyAfterClick = await verifyBottomComposerHasPrompt(page, promptText).catch(() => ({ ok: false }));
    promptStillVisible = Boolean(verifyAfterClick?.ok);
    // Khi Flow nhận lệnh, composer thường bị clear/ẩn ngay nhưng UI không luôn hiện chữ Generating.
    // Trước đây worker coi trường hợp này là lỗi và tự tắt browser dù Flow đang generate.
    if (!promptStillVisible) {
      console.log(`[FLOW DEBUG] prompt disappeared after ${source}; treat as submitted`);
      return true;
    }
    await sleep(800);
  }
  if (String(process.env.FLOW_ASSUME_SUBMITTED_AFTER_CLICK || 'true').toLowerCase() === 'true') {
    console.log(`[FLOW DEBUG] ${source} clicked but no generation text detected; assume submitted and wait for result`, { promptStillVisible });
    return true;
  }
  console.log(`[FLOW DEBUG] ${source} clicked but generation signal was not detected`);
  return false;
}

async function submitGenerate(page, promptText = '') {
  async function recoverPromptRequired(stage) {
    if (!(await hasPromptRequiredError(page).catch(() => false))) return false;
    console.log(`[FLOW DEBUG] prompt-required detected at ${stage}; retyping prompt with keyboard/paste recovery`);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(350);
    await setComposerText(page, promptText, null).catch((error) => {
      console.log('[FLOW DEBUG] prompt retype recovery failed', error?.message || error);
    });
    await closeSettingsPanelBeforePrompt(page, 'submit-generate-retry').catch(() => {});
    await sleep(450);
    return true;
  }

  await closeSettingsPanelBeforePrompt(page, 'submit-generate').catch(() => {});
  await nudgeComposerState(page, promptText).catch(() => {});

  let verify = await verifyBottomComposerHasPrompt(page, promptText).catch(() => ({ ok: false }));
  if (!verify.ok) {
    console.log('[FLOW DEBUG] prompt verify before submit was not ok; nudging once more and continuing with guarded submit', verify);
    await forceSetTextOnFocusedOrBottomComposer(page, String(promptText || '').trim()).catch(() => false);
    await nudgeComposerState(page, promptText).catch(() => {});
    await sleep(500);
    verify = await verifyBottomComposerHasPrompt(page, promptText).catch(() => ({ ok: false }));
    console.log('[FLOW DEBUG] prompt verify after pre-submit nudge', verify);
    // Không return false ở đây nữa: Flow DOM thay đổi làm verify sai dù prompt đã nằm trong React editor.
    // Nếu thật sự thiếu prompt, hasPromptRequiredError() trong assumeSubmittedAfterClick sẽ phát hiện và trả false.
  }

  const panelState = await getFlowSettingsPanelState(page).catch(() => ({ open: false }));
  if (panelState?.open) {
    console.log('[FLOW DEBUG] settings/model panel still open at submit; pressing Escape and continuing', panelState);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(450);
  }

  // Lần 1: UI mới, bấm nút tròn/mũi tên/generate thật ở cạnh composer.
  await nudgeComposerState(page, promptText).catch(() => {});
  let clicked = await clickComposerSubmitArrow(page).catch((error) => {
    console.log('[FLOW DEBUG] clickComposerSubmitArrow failed', error?.message || error);
    return false;
  });
  if (clicked) {
    if (await assumeSubmittedAfterClick(page, promptText, 'submit candidate')) return true;
    if (await recoverPromptRequired('submit candidate')) {
      clicked = await clickComposerSubmitArrow(page).catch(() => false);
      if (clicked && await assumeSubmittedAfterClick(page, promptText, 'submit candidate after prompt recovery')) return true;
    }
  }

  // Lần 2: Flow đôi khi enable nút chậm sau input event. Chờ ngắn, nudge, scan lại.
  await sleep(Number(process.env.FLOW_SUBMIT_ENABLE_WAIT_MS || 1200));
  await nudgeComposerState(page, promptText).catch(() => {});
  clicked = await clickComposerSubmitArrow(page).catch((error) => {
    console.log('[FLOW DEBUG] clickComposerSubmitArrow retry failed', error?.message || error);
    return false;
  });
  if (clicked) {
    if (await assumeSubmittedAfterClick(page, promptText, 'submit candidate retry')) return true;
    if (await recoverPromptRequired('submit candidate retry')) {
      clicked = await clickComposerSubmitArrow(page).catch(() => false);
      if (clicked && await assumeSubmittedAfterClick(page, promptText, 'submit candidate retry after prompt recovery')) return true;
    }
  }

  // UI cũ: text button Generate.
  const clickedGenerate = await clickVisibleText(page, ['Generate'], { exact: false, timeout: 1500 }).catch(() => false);
  if (clickedGenerate && await assumeSubmittedAfterClick(page, promptText, 'Generate text button')) return true;

  // Fallback phím tắt. Nhiều bản Flow nhận Ctrl/Cmd+Enter, có bản nhận Enter khi focus composer.
  const composer = await findComposer(page).catch(() => null);
  if (composer) {
    await composer.click({ timeout: 1000 }).catch(() => {});
    await nudgeComposerState(page, promptText).catch(() => {});
    const shortcuts = [
      process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter',
      'Enter',
    ];
    for (const key of shortcuts) {
      await page.keyboard.press(key).catch(() => {});
      await sleep(1400);
      if (await assumeSubmittedAfterClick(page, promptText, `keyboard ${key}`)) return true;
      if (await hasPromptRequiredError(page)) return false;
    }
  }

  // Fallback cuối: bấm theo toạ độ cạnh phải composer một lần nữa.
  const coordClicked = await clickSubmitNearComposerByCoordinate(page).catch(() => false);
  if (coordClicked) return assumeSubmittedAfterClick(page, promptText, 'coordinate fallback final');

  console.log('[FLOW DEBUG] all submit methods failed');
  return false;
}
async function scanButtons(page) {
  const locator = page.locator('button:visible,[role="button"]:visible');
  const count = await locator.count().catch(() => 0);
  const buttons = [];
  for (let i = 0; i < count; i += 1) {
    const loc = locator.nth(i);
    try {
      const meta = await loc.evaluate((el) => ({
        text: (el.innerText || '').trim(),
        ariaLabel: (el.getAttribute('aria-label') || '').trim(),
        title: (el.getAttribute('title') || '').trim(),
      }));
      buttons.push({ index: i, ...meta });
    } catch {
      // ignore detached button
    }
  }
  return { locator, buttons };
}

async function triggerDirectDownload(page, usedIndices = new Set()) {
  const { locator, buttons } = await scanButtons(page);
  for (const button of buttons) {
    const label = `${button.text} ${button.ariaLabel} ${button.title}`.trim();
    if (!DOWNLOAD_TEXTS.some((item) => label.toLowerCase().includes(item.toLowerCase()))) continue;
    if (usedIndices.has(button.index)) continue;
    usedIndices.add(button.index);
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 3000 });
      await locator.nth(button.index).click({ timeout: 1000 });
      return await downloadPromise;
    } catch {
      // continue scanning next candidate
    }
  }
  return null;
}

async function triggerMenuDownload(page, usedMenuIndices = new Set(), usedDirectIndices = new Set()) {
  const { locator, buttons } = await scanButtons(page);
  for (const button of buttons) {
    const label = `${button.text} ${button.ariaLabel} ${button.title}`.trim();
    if (!MORE_TEXT_RE.test(label)) continue;
    if (usedMenuIndices.has(button.index)) continue;
    usedMenuIndices.add(button.index);
    try {
      await locator.nth(button.index).click({ timeout: 1200 });
      await sleep(400);
      const download = await triggerDirectDownload(page, usedDirectIndices);
      if (download) return download;
      await page.keyboard.press('Escape').catch(() => { });
    } catch {
      await page.keyboard.press('Escape').catch(() => { });
    }
  }
  return null;
}

async function waitForResultSurface(page, downloadState = {}, options = {}) {
  if (!downloadState.directIndices) downloadState.directIndices = new Set();
  if (!downloadState.menuIndices) downloadState.menuIndices = new Set();
  if (!downloadState.startedAt) downloadState.startedAt = Date.now();

  const outputType = String(options.outputType || '').toLowerCase();
  const minWaitMs = outputType === 'video' ? VIDEO_RESULT_MIN_WAIT_MS : 0;
  const deadline = Date.now() + FLOW_RESULT_READY_TIMEOUT_MS;
  const scanDirs = ensureArray(options.scanDirs);

  while (Date.now() < deadline) {
    const hasGenerating = await page.getByText(/generating|processing|creating|rendering|processing video|generating video/i).count().catch(() => 0);
    const elapsed = Date.now() - downloadState.startedAt;
    const tooEarlyForVideo = outputType === 'video' && elapsed < minWaitMs;

    // If Chrome/Flow already completed a video download but Playwright missed the download event,
    // recover from disk and still upload it to the web instead of timing out.
    if (outputType === 'video' && !tooEarlyForVideo) {
      const localVideo = await findRecentDownloadedVideoFile(downloadState, scanDirs).catch(() => null);
      if (localVideo) return localVideo;
    }

    // Video path only: do not click any old Download button immediately after submit.
    // Flow often keeps previous image cards in the same project; clicking too early returns that stale PNG/JPG.
    if (!tooEarlyForVideo) {
      const direct = await triggerDirectDownload(page, downloadState.directIndices).catch(() => null);
      const acceptedDirect = await acceptOrSkipDownload(direct, downloadState, outputType, 'direct-download');
      if (acceptedDirect) return acceptedDirect;
    } else if (FLOW_DEBUG) {
      console.log('[FLOW DEBUG] waiting before video download scan to avoid stale image result', { elapsed, minWaitMs });
    }

    if (!hasGenerating && !tooEarlyForVideo) {
      const maybeMenu = await triggerMenuDownload(page, downloadState.menuIndices, downloadState.directIndices).catch(() => null);
      const acceptedMenu = await acceptOrSkipDownload(maybeMenu, downloadState, outputType, 'menu-download');
      if (acceptedMenu) return acceptedMenu;
    }

    if (outputType === 'video' && !tooEarlyForVideo) {
      const localVideoAfterClick = await findRecentDownloadedVideoFile(downloadState, scanDirs).catch(() => null);
      if (localVideoAfterClick) return localVideoAfterClick;
    }

    await sleep(FLOW_RESULT_READY_POLL_MS);
  }

  if (outputType === 'video') {
    const localVideo = await findRecentDownloadedVideoFile(downloadState, scanDirs).catch(() => null);
    if (localVideo) return localVideo;
  }
  throw new Error('Hết thời gian chờ kết quả trên Flow.');
}

async function saveDownload(download, targetDir, index) {
  await ensureDir(targetDir);
  const localFilePath = typeof download === 'string' ? download : download?.localFilePath;
  if (localFilePath) {
    const sourcePath = path.resolve(localFilePath);
    const sourceName = path.basename(sourcePath) || `result-${index + 1}.mp4`;
    const ext = path.extname(sourceName) || '.mp4';
    const base = path.basename(sourceName, ext) || `result-${index + 1}`;
    const outPath = path.join(targetDir, `${String(index + 1).padStart(2, '0')}-${safeSlug(base) || `result-${index + 1}`}${ext}`);
    if (path.resolve(outPath) !== sourcePath) {
      await fs.copyFile(sourcePath, outPath);
    }
    return outPath;
  }

  const suggested = download.suggestedFilename ? download.suggestedFilename() : `result-${index + 1}`;
  const ext = path.extname(suggested || '');
  const base = path.basename(suggested || `result-${index + 1}`, ext);
  const outPath = path.join(targetDir, `${String(index + 1).padStart(2, '0')}-${safeSlug(base) || `result-${index + 1}`}${ext}`);
  await download.saveAs(outPath);
  return outPath;
}

async function createLocalInputCopy(asset, workerRoot, namePrefix) {
  if (!asset?.url) return null;
  await ensureDir(workerRoot);
  const bytes = await downloadBytes(new URL(asset.url, FLOW_API_BASE_URL).toString());
  const ext = path.extname(asset.originalName || asset.url || '') || '.png';
  const target = path.join(workerRoot, `${namePrefix}${ext}`);
  await fs.writeFile(target, bytes);
  return target;
}

export class FlowWorker {
  constructor({ workerName, supportedTools, supportedWorkerTypes }) {
    this.workerName = workerName;
    this.supportedTools = supportedTools;
    this.supportedWorkerTypes = supportedWorkerTypes;
    this.workerId = `${workerName}-${os.hostname()}-${process.pid}`;
    this.browserContext = null;
    this.heartbeatTimer = null;
    this.currentJob = null;
  }

  async start() {
    console.log(`[${this.workerName}] started. workerId=${this.workerId}`);
    while (true) {
      try {
        const claimed = await apiFetch('/api/internal/worker/claim', {
          method: 'POST',
          json: {
            workerId: this.workerId,
            supportedTools: this.supportedTools,
            supportedWorkerTypes: this.supportedWorkerTypes,
          },
        });
        if (!claimed?.job) {
          await sleep(FLOW_WORKER_POLL_INTERVAL_MS);
          continue;
        }
        await this.processJob(claimed.job);
      } catch (error) {
        console.error(`[${this.workerName}] loop error`, error);
        await sleep(FLOW_WORKER_POLL_INTERVAL_MS);
      }
    }
  }

  async discardBrowserContext(reason = '') {
    if (this.browserContext) {
      console.log(`[FLOW DEBUG] discarding Chrome context for ${this.workerName}`, { reason });
      CLOSED_CONTEXTS.add(this.browserContext);
      await this.browserContext.close().catch(() => {});
      this.browserContext = null;
    }
  }

  async ensureContext() {
    if (await isContextHealthy(this.browserContext)) {
      return this.browserContext;
    }

    await this.discardBrowserContext('context missing or unhealthy before use');
    const userDataDir = `${CHROME_PROFILE_DIR}-${safeSlug(this.workerName)}`;
    this.browserContext = await launchFlowBrowserContext(userDataDir, this.workerName);
    return this.browserContext;
  }

  async newOrExistingPage(context) {
    const existing = await findExistingPage(context);
    if (existing) return existing;
    if (!(await isContextHealthy(context))) throw new Error('Chrome context is closed before newPage().');
    return context.newPage();
  }

  async newFreshPage(context) {
    if (!(await isContextHealthy(context))) throw new Error('Chrome context is closed before newPage().');
    let oldPages = [];
    try {
      oldPages = context.pages().filter((p) => p && !p.isClosed());
    } catch {
      oldPages = [];
    }
    const page = await context.newPage();
    for (const oldPage of oldPages) {
      if (oldPage !== page && !oldPage.isClosed()) await oldPage.close().catch(() => {});
    }
    return page;
  }

  async getFlowPage({ freshPage = FLOW_FRESH_PAGE_PER_PROMPT } = {}) {
    let lastError = null;
    const attempts = Math.max(2, FLOW_BROWSER_LAUNCH_RETRIES + 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const context = await this.ensureContext();
        const page = freshPage ? await this.newFreshPage(context) : await this.newOrExistingPage(context);
        if (!page || page.isClosed()) throw new Error('Flow page is closed before goto().');
        await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: Number(process.env.FLOW_PAGE_GOTO_TIMEOUT_MS || 60000) });
        await sleep(FLOW_AFTER_OPEN_DELAY_MS);
        await ensureFlowReady(page);
        // Không gọi ensureWorkspaceReady ở đây.
        // Flow có thể đang ở asset library; ensureMode() sẽ bấm + và chọn Image/Video sau.
        return page;
      } catch (error) {
        lastError = error;
        console.error(`[FLOW DEBUG] getFlowPage failed attempt ${attempt}/${attempts}:`, error?.message || error);
        if (!isTargetClosedError(error) && attempt >= 2) throw error;
        await this.discardBrowserContext(error?.message || error);
        await sleep(900);
      }
    }
    throw new Error(`Không mở được tab Flow vì Chrome/context bị đóng liên tục. Lỗi cuối: ${lastError?.message || lastError}`);
  }

  async closeContextIfNeeded() {
    if (FLOW_CLOSE_AFTER_JOB) {
      await this.discardBrowserContext('FLOW_CLOSE_AFTER_JOB=true: đóng Flow sau khi job trả kết quả hoặc kết thúc');
      return;
    }
    if (FLOW_KEEP_BROWSER_OPEN && await isContextHealthy(this.browserContext)) return;
    await this.discardBrowserContext(FLOW_KEEP_BROWSER_OPEN ? 'context already unhealthy' : 'FLOW_KEEP_BROWSER_OPEN=false');
  }

  async setStatus(jobId, status, message, extra = {}) {
    await apiFetch(`/api/internal/worker/jobs/${jobId}/status`, {
      method: 'POST',
      json: { workerId: this.workerId, status, message, extra },
    });
  }

  async heartbeat(jobId, message) {
    await apiFetch(`/api/internal/worker/jobs/${jobId}/heartbeat`, {
      method: 'POST',
      json: { workerId: this.workerId, message },
    });
  }

  async failJob(jobId, error) {
    await apiFetch(`/api/internal/worker/jobs/${jobId}/fail`, {
      method: 'POST',
      json: { workerId: this.workerId, error: String(error?.message || error || 'Worker failed') },
    });
  }

  async uploadResult(job, localPath, runningIndex, complete = false) {
    const promptIndex = promptIndexForResult(job, runningIndex);
    const prompt = ensureArray(job.prompts)[promptIndex] || '';
    const fileName = path.basename(localPath);
    const mimeType = contentTypeForResultFile(fileName, job.outputType === 'image' ? 'image/png' : 'video/mp4');
    const snapshot = jobSnapshot(job);

    // Default on VPS/Windows: worker and Next server share the same disk.
    // Send a small JSON payload with localPath; the API copies the MP4 into .flow-results.
    // This avoids multipart upload failures for large generated videos.
    const uploadMode = String(process.env.FLOW_RESULT_UPLOAD_MODE || 'local-path').toLowerCase();
    if (uploadMode !== 'multipart') {
      try {
        const response = await apiFetch(`/api/internal/worker/jobs/${job.jobId}/result`, {
          method: 'POST',
          json: {
            localPath,
            originalName: fileName,
            mimeType,
            prompt,
            promptIndex,
            duration: Number(job.duration || 8),
            aspectRatio: String(job.aspectRatio || '16:9'),
            complete: Boolean(complete),
            jobSnapshot: snapshot,
          },
        });
        console.log('[FLOW DEBUG] result uploaded to web via local-path', {
          jobId: job.jobId,
          fileName,
          resultCount: Array.isArray(response?.results) ? response.results.length : undefined,
          uploadMode: response?.uploadMode,
        });
        return response;
      } catch (error) {
        if (String(process.env.FLOW_RESULT_UPLOAD_FALLBACK_MULTIPART || 'true').toLowerCase() !== 'true') throw error;
        console.error('[FLOW DEBUG] local-path result upload failed, fallback to multipart', error?.message || error);
      }
    }

    const bytes = await fs.readFile(localPath);
    const form = new FormData();
    const blob = new Blob([bytes], { type: mimeType });
    form.append('file', blob, fileName);
    form.append('prompt', prompt);
    form.append('promptIndex', String(promptIndex));
    form.append('duration', String(job.duration || 8));
    form.append('aspectRatio', String(job.aspectRatio || '16:9'));
    form.append('complete', complete ? 'true' : 'false');
    form.append('jobSnapshot', JSON.stringify(snapshot));
    const response = await apiFetch(`/api/internal/worker/jobs/${job.jobId}/result`, { method: 'POST', body: form });
    console.log('[FLOW DEBUG] result uploaded to web via multipart', {
      jobId: job.jobId,
      fileName,
      resultCount: Array.isArray(response?.results) ? response.results.length : undefined,
      uploadMode: response?.uploadMode,
    });
    return response;
  }

  async processJob(job) {
    this.currentJob = job;
    const workerTempRoot = path.join(FLOW_DOWNLOAD_DIR, safeSlug(this.workerName), job.jobId);
    await ensureDir(workerTempRoot);
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat(job.jobId, `Worker ${this.workerName} vẫn đang xử lý job ${job.jobId}.`).catch(() => { });
    }, HEARTBEAT_INTERVAL_MS);

    try {
      if (FLOW_FRESH_CONTEXT_PER_JOB) {
        await this.discardBrowserContext('FLOW_FRESH_CONTEXT_PER_JOB=true: tạo phiên Flow sạch cho job mới');
      }
      await this.setStatus(job.jobId, 'OPENING_FLOW', `Worker ${this.workerName} đang mở Flow mới cho job này.`);
      const page = await this.getFlowPage({ freshPage: true });
      await debugStep(page, job, '01-opened-flow-page');
      await prepareFreshFlowProject(page, job);
      const localFiles = {
        start: await createLocalInputCopy(job.inputAsset, workerTempRoot, 'start-frame'),
        end: await createLocalInputCopy(job.endInputAsset, workerTempRoot, 'end-frame'),
      };
      let uploadedCount = 0;
      for (let promptIndex = 0; promptIndex < ensureArray(job.prompts).length; promptIndex += 1) {
        const prompt = job.prompts[promptIndex];
        await this.setStatus(job.jobId, 'CREATING_PROJECT', `Đang chuẩn bị Flow cho prompt ${promptIndex + 1}/${job.prompts.length}.`);
        const promptPage = promptIndex === 0 ? page : await this.getFlowPage({ freshPage: true });
        await debugStep(promptPage, job, '02-before-ensure-mode', { outputType: job.outputType, tool: job.tool, model: job.model });
        await ensureMode(promptPage, job);
        await debugStep(promptPage, job, '03-after-ensure-mode');
        await debugStep(promptPage, job, '04-before-aspect-ratio', { aspectRatio: job.aspectRatio });
        if (!FLOW_SKIP_SETTINGS) await chooseAspectRatio(promptPage, job.aspectRatio || '16:9');
        else console.log('[FLOW DEBUG] skip chooseAspectRatio because FLOW_SKIP_SETTINGS=true');
        await debugStep(promptPage, job, '05-after-aspect-ratio');
        await debugStep(promptPage, job, '06-before-multiplier', { multiplier: multiplierForJob(job) });
        if (!FLOW_SKIP_SETTINGS) await chooseMultiplier(promptPage, multiplierForJob(job), job);
        else console.log('[FLOW DEBUG] skip chooseMultiplier because FLOW_SKIP_SETTINGS=true');
        await debugStep(promptPage, job, '07-after-multiplier');
        await debugStep(promptPage, job, '08-before-model', { model: job.model });
        if (!FLOW_SKIP_SETTINGS) await chooseModel(promptPage, job.model || '');
        else console.log('[FLOW DEBUG] skip chooseModel because FLOW_SKIP_SETTINGS=true');
        await debugStep(promptPage, job, '09-after-model');
        if (!FLOW_SKIP_SETTINGS && job.outputType === 'video') await chooseDuration(promptPage, job.duration || 8);
        else if (FLOW_SKIP_SETTINGS && job.outputType === 'video') console.log('[FLOW DEBUG] skip chooseDuration because FLOW_SKIP_SETTINGS=true');
        if (job.tool === 'image-to-video') {
          await this.setStatus(job.jobId, 'UPLOADING_ASSETS', `Đang upload ảnh điểm đầu/điểm cuối cho prompt ${promptIndex + 1}.`);
          await uploadImageAssets(promptPage, job, localFiles);
        }
        await this.setStatus(job.jobId, 'SUBMITTING_PROMPT', `Đang gửi prompt ${promptIndex + 1}/${job.prompts.length} lên Flow.`);
        await debugStep(promptPage, job, '10-before-set-prompt', { prompt });
        await setComposerText(promptPage, prompt, null);
        await debugStep(promptPage, job, '11-after-set-prompt');
        await debugStep(promptPage, job, '12-before-submit-generate');
        const submitted = await submitGenerate(promptPage, prompt);
        await debugStep(promptPage, job, '13-after-submit-generate', { submitted });
        if (!submitted) throw new Error('Không bấm được nút Generate trên Flow.');

        const remainingForJob = Math.max(0, Number(job.requestedCount || 1) - uploadedCount);
        const expectedForPrompt = Math.max(1, Math.min(multiplierForJob(job), remainingForJob || 1));
        const downloadState = {};
        for (let i = 0; i < expectedForPrompt; i += 1) {
          await this.setStatus(job.jobId, 'GENERATING', `Flow đang generate kết quả ${uploadedCount + 1}/${job.requestedCount}.`);
          const download = await waitForResultSurface(promptPage, downloadState, { outputType: job.outputType, scanDirs: [workerTempRoot, FLOW_DOWNLOAD_DIR] });
          const saved = await saveDownload(download, workerTempRoot, uploadedCount);
          uploadedCount += 1;
          await this.setStatus(job.jobId, 'FETCHING_RESULTS', `Đang gửi kết quả ${uploadedCount}/${job.requestedCount} về website.`);
          await this.uploadResult(job, saved, uploadedCount - 1, uploadedCount >= Number(job.requestedCount || 1));
          await sleep(500);
        }
      }

      if (uploadedCount < Number(job.requestedCount || 1)) {
        throw new Error(`Số kết quả nhận được (${uploadedCount}) ít hơn yêu cầu (${job.requestedCount}).`);
      }
      await this.setStatus(job.jobId, 'COMPLETED', `Worker ${this.workerName} đã hoàn tất ${uploadedCount} kết quả.`);
    } catch (error) {
      console.error(`[${this.workerName}] job failed`, job.jobId, error);
      await this.failJob(job.jobId, error);
    } finally {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.currentJob = null;
      await this.closeContextIfNeeded();
    }
  }
}

export async function startWorker(options) {
  const worker = new FlowWorker(options);
  await worker.start();
}
