#!/usr/bin/env node
const http = require('http');
const fs = require('fs/promises');
const fssync = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HOST = process.env.LOCAL_AGENT_HOST || '127.0.0.1';
const PORT = Number(process.env.LOCAL_AGENT_PORT || 48765);
const FLOW_URL = process.env.FLOW_URL || 'https://flow.google/';
const ROOT = path.join(process.cwd(), '.local-agent');
const JOBS_DIR = path.join(ROOT, 'jobs');
const DOWNLOAD_DIR = process.env.FLOW_DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads');
const WATCH_TIMEOUT_MS = Number(process.env.FLOW_DOWNLOAD_TIMEOUT_MS || 10 * 60 * 1000);
const watchTimers = new Map();

function nowIso() {
  return new Date().toISOString();
}

async function ensureDirs() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
}

function safeJobId(jobId) {
  return String(jobId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function jobPath(jobId) {
  return path.join(JOBS_DIR, `${safeJobId(jobId)}.json`);
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readJob(jobId) {
  await ensureDirs();
  return readJson(jobPath(jobId), null);
}

async function writeJob(job) {
  await ensureDirs();
  const payload = {
    ...job,
    updatedAt: nowIso(),
  };
  await fs.writeFile(jobPath(payload.jobId), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function patchJob(jobId, patch) {
  const current = await readJob(jobId);
  if (!current) return null;
  return writeJob({ ...current, ...patch, jobId });
}

async function listJobs() {
  await ensureDirs();
  const files = await fs.readdir(JOBS_DIR).catch(() => []);
  const jobs = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const job = await readJson(path.join(JOBS_DIR, file), null);
    if (job?.jobId) jobs.push(job);
  }
  return jobs.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data || {});
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Body JSON không hợp lệ.'));
      }
    });
    req.on('error', reject);
  });
}

function openExternal(url) {
  const platform = process.platform;
  let command;
  let args;

  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function guessMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function findNewestCompletedMedia(sinceMs) {
  const entries = await fs.readdir(DOWNLOAD_DIR, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (/\.crdownload$|\.tmp$|\.part$/i.test(entry.name)) continue;
    if (!/\.(mp4|webm|mov|png|jpe?g)$/i.test(entry.name)) continue;
    const filePath = path.join(DOWNLOAD_DIR, entry.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || stat.size <= 0) continue;
    if (stat.mtimeMs < sinceMs) continue;
    candidates.push({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

async function waitUntilFileStable(filePath) {
  const first = await fs.stat(filePath).catch(() => null);
  if (!first) return false;
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const second = await fs.stat(filePath).catch(() => null);
  return Boolean(second && second.size === first.size && second.size > 0);
}

async function uploadDownloadedFile(job, filePath) {
  if (!job?.uploadUrl) {
    await patchJob(job.jobId, {
      status: 'WAITING_USER',
      message: `Đã thấy file tải về: ${path.basename(filePath)} nhưng job thiếu uploadUrl.`,
    });
    return;
  }

  const buffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append('jobId', job.jobId);
  form.append('prompt', Array.isArray(job.prompts) ? String(job.prompts[0] || '') : String(job.prompt || job.promptText || ''));
  form.append('aspectRatio', job.aspectRatio || '16:9');
  form.append('duration', String(job.duration || 8));
  form.append('file', new Blob([buffer], { type: guessMime(filePath) }), path.basename(filePath));

  await patchJob(job.jobId, {
    status: 'UPLOADING',
    message: `Đã tải xong ${path.basename(filePath)}, đang upload về website...`,
  });

  const response = await fetch(job.uploadUrl, { method: 'POST', body: form });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Upload thất bại HTTP ${response.status}`);
  }

  await patchJob(job.jobId, {
    status: 'COMPLETED',
    message: 'Hoàn tất: Flow đã tải video và Local Agent đã upload lại website.',
    results: data?.result ? [data.result] : (Array.isArray(data?.results) ? data.results : []),
    uploadedFile: path.basename(filePath),
  });
}

function startDownloadWatcher(jobId) {
  if (watchTimers.has(jobId)) return;

  const startedAt = Date.now();
  const timer = setInterval(async () => {
    try {
      const job = await readJob(jobId);
      if (!job) return;

      if (['COMPLETED', 'FAILED'].includes(job.status)) {
        clearInterval(timer);
        watchTimers.delete(jobId);
        return;
      }

      if (Date.now() - startedAt > WATCH_TIMEOUT_MS) {
        clearInterval(timer);
        watchTimers.delete(jobId);
        await patchJob(jobId, {
          status: 'WAITING_USER',
          message: `Chưa tìm thấy file tải về trong ${DOWNLOAD_DIR}. Nếu Chrome hỏi nơi lưu file, hãy tải thủ công rồi upload lại.`,
        });
        return;
      }

      const media = await findNewestCompletedMedia(startedAt - 3000);
      if (!media) return;
      const stable = await waitUntilFileStable(media.filePath);
      if (!stable) return;

      clearInterval(timer);
      watchTimers.delete(jobId);
      await uploadDownloadedFile(job, media.filePath);
    } catch (error) {
      clearInterval(timer);
      watchTimers.delete(jobId);
      await patchJob(jobId, {
        status: 'FAILED',
        message: error.message || 'Không upload được file tải về.',
        error: error.message || 'Download watcher failed',
      });
    }
  }, 3500);

  watchTimers.set(jobId, timer);
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(res);

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname.replace(/\/$/, '') || '/';

  try {
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        success: true,
        status: 'online',
        agent: 'legalprotech-local-agent',
        flowUrl: FLOW_URL,
        downloadDir: DOWNLOAD_DIR,
      });
    }

    if (req.method === 'POST' && pathname === '/jobs') {
      const body = await readBody(req);
      const jobId = String(body.jobId || `flow_${Date.now()}`).trim();
      if (!jobId) return sendJson(res, 400, { error: 'Thiếu jobId.' });

      const job = await writeJob({
        ...body,
        jobId,
        status: 'QUEUED',
        message: 'Local Agent đã nhận job. Đang mở Flow và chờ Chrome Extension lấy job...',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        openedFlowUrl: FLOW_URL,
      });

      try {
        openExternal(FLOW_URL);
      } catch (error) {
        await patchJob(jobId, { message: `Đã nhận job nhưng không tự mở được Flow: ${error.message}` });
      }

      return sendJson(res, 200, {
        success: true,
        jobId,
        status: job.status,
        message: job.message,
      });
    }

    const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === 'GET') {
      const job = await readJob(decodeURIComponent(jobMatch[1]));
      if (!job) return sendJson(res, 404, { error: 'Không tìm thấy job automation.' });
      return sendJson(res, 200, job);
    }

    if (jobMatch && (req.method === 'POST' || req.method === 'PATCH')) {
      const body = await readBody(req);
      const jobId = decodeURIComponent(jobMatch[1]);
      const job = await patchJob(jobId, body);
      if (!job) return sendJson(res, 404, { error: 'Không tìm thấy job automation.' });
      if (['WAITING_DOWNLOAD', 'UPLOADING'].includes(job.status)) startDownloadWatcher(jobId);
      return sendJson(res, 200, { success: true, job });
    }

    if (req.method === 'GET' && pathname === '/automation/next') {
      const jobs = await listJobs();
      const job = jobs.find((item) => ['QUEUED', 'DISPATCHING'].includes(item.status));
      if (!job) return sendJson(res, 200, { empty: true });

      const patched = await patchJob(job.jobId, {
        status: 'DISPATCHING',
        message: 'Extension đang lấy job và chuẩn bị tự động hóa Flow...',
      });

      return sendJson(res, 200, patched || job);
    }

    if (req.method === 'POST' && pathname === '/automation/status') {
      const body = await readBody(req);
      const jobId = String(body.jobId || '').trim();
      if (!jobId) return sendJson(res, 400, { error: 'Thiếu jobId.' });

      const patch = { ...body };
      delete patch.type;
      const job = await patchJob(jobId, patch);
      if (!job) return sendJson(res, 404, { error: 'Không tìm thấy job automation.' });
      if (['WAITING_DOWNLOAD', 'UPLOADING'].includes(job.status)) startDownloadWatcher(jobId);

      return sendJson(res, 200, { success: true, job });
    }

    return sendJson(res, 404, { error: 'Route Local Agent không tồn tại.' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Local Agent lỗi.' });
  }
}

ensureDirs().then(() => {
  const server = http.createServer(handle);
  server.listen(PORT, HOST, () => {
    console.log(`LegalProTech Local Agent online: http://${HOST}:${PORT}`);
    console.log(`Flow URL: ${FLOW_URL}`);
    console.log(`Download dir: ${DOWNLOAD_DIR}`);
  });
}).catch((error) => {
  console.error('Không khởi động được Local Agent:', error);
  process.exit(1);
});
