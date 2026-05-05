import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import zlib from 'zlib';

const STORE_ROOT = process.env.FLOW_JOB_STORE_DIR
  ? path.resolve(process.env.FLOW_JOB_STORE_DIR)
  : path.join(process.cwd(), '.flow-jobs');
const JOBS_DIR = path.join(STORE_ROOT, 'jobs');
const INPUT_DIR = path.join(process.cwd(), 'public', 'flow-inputs');
const RESULT_DIR = path.join(process.cwd(), 'public', 'flow-results');

const PUBLIC_INPUT_PREFIX = '/flow-inputs';
const PUBLIC_RESULT_PREFIX = '/api/flow/files';
const RETENTION_DAYS = Number(process.env.FLOW_RESULT_RETENTION_DAYS || 3);
const STALLED_AFTER_MS = Number(process.env.FLOW_WORKER_STALLED_SECONDS || 180) * 1000;
const CLAIM_TTL_MS = Number(process.env.FLOW_WORKER_CLAIM_TTL_SECONDS || 3600) * 1000;
const RECLAIM_STALLED_JOBS = String(process.env.FLOW_RECLAIM_STALLED_JOBS || 'false').toLowerCase() === 'true';
const MAX_CLAIM_ATTEMPTS = Number(process.env.FLOW_MAX_CLAIM_ATTEMPTS || 1);
const TIMELINE_DEDUP_MS = Number(process.env.FLOW_TIMELINE_DEDUP_SECONDS || 20) * 1000;

const CLAIM_LOCK_PATH = path.join(STORE_ROOT, 'claim.lock');
const CLAIM_LOCK_STALE_MS = Number(process.env.FLOW_CLAIM_LOCK_STALE_MS || 30000);
const CLAIM_LOCK_WAIT_MS = Number(process.env.FLOW_CLAIM_LOCK_WAIT_MS || 15000);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withClaimLock(fn) {
  await ensureDirs();
  const owner = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await fs.open(CLAIM_LOCK_PATH, 'wx');
      try {
        await handle.writeFile(JSON.stringify({ owner, pid: process.pid, createdAt: nowIso() }), 'utf8');
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;

      try {
        const stat = await fs.stat(CLAIM_LOCK_PATH);
        if (Date.now() - stat.mtimeMs > CLAIM_LOCK_STALE_MS) {
          await fs.unlink(CLAIM_LOCK_PATH).catch(() => {});
          continue;
        }
      } catch {
        continue;
      }

      if (Date.now() - startedAt > CLAIM_LOCK_WAIT_MS) {
        return null;
      }
      await sleep(150 + Math.floor(Math.random() * 250));
    }
  }

  try {
    return await fn();
  } finally {
    await fs.unlink(CLAIM_LOCK_PATH).catch(() => {});
  }
}

export const FLOW_STATUSES = {
  QUEUED: 'QUEUED',
  CLAIMED: 'CLAIMED',
  OPENING_FLOW: 'OPENING_FLOW',
  CREATING_PROJECT: 'CREATING_PROJECT',
  UPLOADING_ASSETS: 'UPLOADING_ASSETS',
  SUBMITTING_PROMPT: 'SUBMITTING_PROMPT',
  GENERATING: 'GENERATING',
  FETCHING_RESULTS: 'FETCHING_RESULTS',
  PACKAGING: 'PACKAGING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
};

const ACTIVE_STATUSES = new Set([
  FLOW_STATUSES.CLAIMED,
  FLOW_STATUSES.OPENING_FLOW,
  FLOW_STATUSES.CREATING_PROJECT,
  FLOW_STATUSES.UPLOADING_ASSETS,
  FLOW_STATUSES.SUBMITTING_PROMPT,
  FLOW_STATUSES.GENERATING,
  FLOW_STATUSES.FETCHING_RESULTS,
  FLOW_STATUSES.PACKAGING,
]);

function nowIso() {
  return new Date().toISOString();
}

function futureIso(days = RETENTION_DAYS) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function safeFileName(value, fallback = 'file') {
  const clean = String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, '_');
  return clean || fallback;
}


const MEDIA_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function contentTypeFromName(fileName, fallback = 'application/octet-stream') {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return MEDIA_TYPES[ext] || fallback;
}

function extensionFromBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer.slice(4, 8).toString('ascii') === 'ftyp') return '.mp4';
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return '.webm';
  if (buffer[0] === 0x89 && buffer.slice(1, 4).toString('ascii') === 'PNG') return '.png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '';
}

function isZipBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function extractFirstMediaFromZipBuffer(zipBuffer) {
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
    const fileName = path.basename(rawName || 'result');
    const ext = path.extname(fileName).toLowerCase();
    const isDirectory = rawName.endsWith('/');
    const isMedia = Boolean(MEDIA_TYPES[ext]);

    if (!isDirectory && isMedia) {
      let data = zipBuffer.slice(dataStart, dataEnd);
      if (compressionMethod === 8) data = zlib.inflateRawSync(data);
      if (compressionMethod !== 0 && compressionMethod !== 8) {
        throw new Error(`File media trong ZIP dùng compression method chưa hỗ trợ: ${compressionMethod}`);
      }
      if (!data.length) throw new Error('File media trong ZIP rỗng.');
      return {
        fileName: safeFileName(fileName, `result${ext}`),
        bytes: data,
        mimeType: contentTypeFromName(fileName),
      };
    }

    // Nếu ZIP dùng data descriptor, local header có thể không có size chuẩn.
    // Trường hợp này yêu cầu dùng nút download thật hoặc để worker tải lại candidate khác.
    if ((generalPurposeFlag & 0x08) && compressedSize === 0) break;
    offset = dataEnd;
  }
  return null;
}

function normalizeResultFilePayload({ bytes, originalName, mimeType }) {
  let resultBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  let resultName = safeFileName(originalName || 'result.mp4', 'result.mp4');
  let resultMimeType = mimeType || contentTypeFromName(resultName, 'video/mp4');

  if (isZipBuffer(resultBytes) || path.extname(resultName).toLowerCase() === '.zip') {
    const extracted = extractFirstMediaFromZipBuffer(resultBytes);
    if (!extracted) {
      throw new Error('Worker tải nhầm file ZIP nhưng không tìm thấy video/ảnh bên trong ZIP. Hãy kiểm tra lại nút Download trên Flow.');
    }
    resultBytes = extracted.bytes;
    resultName = extracted.fileName;
    resultMimeType = extracted.mimeType;
  }

  const ext = path.extname(resultName).toLowerCase();
  if (!MEDIA_TYPES[ext]) {
    const detectedExt = extensionFromBytes(resultBytes);
    if (!detectedExt) {
      throw new Error(`File kết quả không phải media hợp lệ: ${resultName}`);
    }
    resultName = `${path.basename(resultName, path.extname(resultName))}${detectedExt}`;
    resultMimeType = MEDIA_TYPES[detectedExt];
  }

  return { bytes: resultBytes, originalName: resultName, mimeType: resultMimeType };
}

function shortTitle(value, fallback) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
}

export function splitPromptLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function ensureDirs() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  await fs.mkdir(INPUT_DIR, { recursive: true });
  await fs.mkdir(RESULT_DIR, { recursive: true });
}

function jobPath(jobId) {
  return path.join(JOBS_DIR, `${safeFileName(jobId)}.json`);
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function readFlowJob(jobId) {
  if (!jobId) return null;
  await ensureDirs();
  try {
    return await readJsonFile(jobPath(jobId));
  } catch {
    return null;
  }
}

export async function writeFlowJob(job) {
  await ensureDirs();
  const payload = {
    ...job,
    updatedAt: nowIso(),
  };
  await fs.writeFile(jobPath(payload.jobId), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}


export async function recoverFlowJobFromSnapshot(jobId, snapshot = {}) {
  if (!jobId) return null;
  const existing = await readFlowJob(jobId);
  if (existing) return existing;

  const now = nowIso();
  const token = snapshot.token || makeId('share');
  const prompt = snapshot.prompt || (Array.isArray(snapshot.prompts) ? snapshot.prompts.join('\n') : '');
  const prompts = Array.isArray(snapshot.prompts) && snapshot.prompts.length ? snapshot.prompts : splitPromptLines(prompt || snapshot.prompt || 'Recovered AutoFlow job');
  const recovered = {
    jobId,
    token,
    status: FLOW_STATUSES.FETCHING_RESULTS,
    message: 'Job được khôi phục tự động khi Worker trả kết quả. Có thể Next dev server đã reload trong lúc Flow đang chạy.',
    tool: snapshot.tool || 'image-to-video',
    model: snapshot.model || 'flow',
    aspectRatio: snapshot.aspectRatio || '16:9',
    duration: Number(snapshot.duration || 8),
    frame: snapshot.frame || 'Auto',
    requestedCount: Number(snapshot.requestedCount || prompts.length || 1),
    prompt,
    prompts,
    inputAsset: snapshot.inputAsset || null,
    endInputAsset: snapshot.endInputAsset || null,
    results: [],
    zipUrl: snapshot.zipUrl || `/api/flow/jobs/${jobId}/download`,
    shareUrl: snapshot.shareUrl || `/shared/${token}`,
    expiresAt: snapshot.expiresAt || futureIso(),
    workerId: snapshot.workerId || '',
    heartbeatAt: now,
    claimedAt: snapshot.claimedAt || '',
    createdAt: snapshot.createdAt || now,
    updatedAt: now,
    timeline: [
      ...(Array.isArray(snapshot.timeline) ? snapshot.timeline.slice(-40) : []),
      {
        status: FLOW_STATUSES.FETCHING_RESULTS,
        message: 'Hệ thống đã tự khôi phục job từ snapshot của Worker.',
        at: now,
      },
    ],
  };
  return writeFlowJob(recovered);
}

export async function patchFlowJob(jobId, patchOrUpdater) {
  const current = await readFlowJob(jobId);
  if (!current) return null;
  const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(current) : patchOrUpdater;
  return writeFlowJob({ ...current, ...patch, jobId });
}

export async function listFlowJobs() {
  await ensureDirs();
  const files = await fs.readdir(JOBS_DIR).catch(() => []);
  const jobs = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      jobs.push(await readJsonFile(path.join(JOBS_DIR, file)));
    } catch {
      // skip broken job file
    }
  }
  return jobs.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

async function saveInputFile(jobId, file) {
  if (!file || typeof file.arrayBuffer !== 'function') return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length) return null;
  const ext = path.extname(file.name || '') || '.png';
  const name = `${Date.now()}-${safeFileName(file.name || `input${ext}`)}`;
  const dir = path.join(INPUT_DIR, jobId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, bytes);
  return {
    originalName: file.name || name,
    mimeType: file.type || 'application/octet-stream',
    size: bytes.length,
    url: `${PUBLIC_INPUT_PREFIX}/${jobId}/${name}`,
    relativePath: `/public/flow-inputs/${jobId}/${name}`,
    serverPath: filePath,
  };
}

export async function createFlowJobFromFormData(formData) {
  await ensureDirs();
  const jobId = makeId('flow');
  const token = makeId('share');
  const prompt = String(formData.get('prompt') || '');
  const prompts = splitPromptLines(prompt);
  if (!prompts.length) throw new Error('Thiếu prompt.');

  const tool = String(formData.get('tool') || 'image-to-video');
  const outputTypeRaw = String(formData.get('output_type') || formData.get('outputType') || '').toLowerCase();
  const outputType = outputTypeRaw || (tool === 'text-to-image' || tool === 'my-product' ? 'image' : 'video');
  const isVideoJob = outputType === 'video';
  const videosPerPromptRaw = Number(formData.get('videos_per_prompt') || formData.get('videosPerPrompt') || 1);
  const videosPerPrompt = isVideoJob ? Math.max(1, Math.min(videosPerPromptRaw || 1, 4)) : 1;
  const serverMaxResults = isVideoJob
    ? Number(process.env.FLOW_MAX_VIDEO_RESULTS_PER_JOB || process.env.FLOW_MAX_RESULTS_PER_JOB || 10)
    : Number(process.env.FLOW_IMAGE_MAX_PROMPTS || process.env.FLOW_MAX_IMAGE_PROMPTS_PER_JOB || 4);
  const requestedTotal = isVideoJob ? prompts.length * videosPerPrompt : prompts.length;

  if (requestedTotal > serverMaxResults) {
    throw new Error(isVideoJob
      ? `Mỗi job chỉ được tối đa ${serverMaxResults} video. Hiện tại: ${prompts.length} prompt × ${videosPerPrompt} video = ${requestedTotal} video.`
      : `Mỗi job chỉ được tối đa ${serverMaxResults} ảnh. Hiện tại: ${prompts.length} prompt.`);
  }

  const image = formData.get('image');
  const endImage = formData.get('end_image');
  const inputAsset = await saveInputFile(jobId, image);
  const endInputAsset = await saveInputFile(jobId, endImage);
  const countRaw = Number(formData.get('count') || requestedTotal || 1);
  const count = Math.max(1, Math.min(countRaw || requestedTotal || 1, serverMaxResults));
  const now = nowIso();
  const job = {
    jobId,
    token,
    status: FLOW_STATUSES.QUEUED,
    message: isVideoJob
      ? 'Đã nhận lệnh. Windows VPS Worker sẽ tự động lấy job và chạy Flow.'
      : 'Đã nhận lệnh tạo ảnh. Windows VPS Worker sẽ tự động lấy job, chọn Nano Banana Pro và chạy Flow.',
    tool,
    outputType,
    model: String(formData.get('model') || 'flow'),
    aspectRatio: String(formData.get('aspect_ratio') || formData.get('aspectRatio') || '16:9'),
    duration: Number(formData.get('duration') || 8),
    frame: String(formData.get('frame') || 'Auto'),
    videosPerPrompt,
    requestedCount: count,
    maxResults: serverMaxResults,
    prompt,
    prompts,
    inputAsset,
    endInputAsset,
    results: [],
    zipUrl: `/api/flow/jobs/${jobId}/download`,
    shareUrl: `/shared/${token}`,
    expiresAt: futureIso(),
    workerId: '',
    heartbeatAt: '',
    claimedAt: '',
    createdAt: now,
    updatedAt: now,
    timeline: [
      {
        status: FLOW_STATUSES.QUEUED,
        message: isVideoJob ? 'Job đã vào hàng chờ AutoFlow trên Windows VPS.' : 'Job ảnh Nano Banana Pro đã vào hàng chờ AutoFlow trên Windows VPS.',
        at: now,
      },
    ],
  };

  await writeFlowJob(job);
  return normalizeJob(job);
}

function appendTimeline(job, status, message, extra = {}) {
  const timeline = Array.isArray(job.timeline) ? job.timeline : [];
  const text = message || status;
  const last = timeline[timeline.length - 1];
  const lastAt = last?.at ? new Date(last.at).getTime() : 0;
  if (
    last &&
    last.status === status &&
    last.message === text &&
    Date.now() - lastAt < TIMELINE_DEDUP_MS
  ) {
    return timeline;
  }
  return [
    ...timeline,
    {
      status,
      message: text,
      at: nowIso(),
      ...extra,
    },
  ].slice(-80);
}

export async function claimNextFlowJob(workerId = 'windows-vps-worker') {
  return withClaimLock(async () => {
    const jobs = await listFlowJobs();
    const nowMs = Date.now();
    const candidate = jobs.find((job) => {
      if (job.status === FLOW_STATUSES.QUEUED) return true;
      if (!RECLAIM_STALLED_JOBS) return false;
      if (!ACTIVE_STATUSES.has(job.status)) return false;
      if (job.workerId && job.workerId === workerId) return false;
      if (Number(job.attempts || 0) >= MAX_CLAIM_ATTEMPTS) return false;
      const hb = job.heartbeatAt ? new Date(job.heartbeatAt).getTime() : 0;
      const claimed = job.claimedAt ? new Date(job.claimedAt).getTime() : 0;
      return (hb && nowMs - hb > STALLED_AFTER_MS) || (claimed && nowMs - claimed > CLAIM_TTL_MS);
    });

    if (!candidate) return null;

    // Đọc lại ngay trong lock để tránh 2 worker claim trùng cùng một job.
    const fresh = await readFlowJob(candidate.jobId);
    if (!fresh) return null;
    if (fresh.status !== FLOW_STATUSES.QUEUED) {
      if (!RECLAIM_STALLED_JOBS || !ACTIVE_STATUSES.has(fresh.status)) return null;
    }

    const patched = await patchFlowJob(candidate.jobId, (current) => ({
      status: FLOW_STATUSES.CLAIMED,
      message: `Worker ${workerId} đã nhận job và chuẩn bị mở Flow.`,
      workerId,
      claimedAt: nowIso(),
      heartbeatAt: nowIso(),
      attempts: Number(current.attempts || 0) + 1,
      timeline: appendTimeline(current, FLOW_STATUSES.CLAIMED, `Worker ${workerId} đã nhận job.`, { workerId }),
    }));
    return normalizeJob(patched);
  });
}

export async function heartbeatFlowJob(jobId, { workerId, message } = {}) {
  return patchFlowJob(jobId, (current) => ({
    heartbeatAt: nowIso(),
    workerId: workerId || current.workerId || '',
    message: message || current.message || 'Worker heartbeat.',
  }));
}

export async function updateFlowJobStatus(jobId, { status, message, workerId, extra } = {}) {
  if (!status) throw new Error('Thiếu status.');
  const patched = await patchFlowJob(jobId, (current) => ({
    status,
    message: message || current.message || status,
    workerId: workerId || current.workerId || '',
    heartbeatAt: nowIso(),
    ...(extra && typeof extra === 'object' ? extra : {}),
    timeline: appendTimeline(current, status, message || status, { workerId: workerId || current.workerId || '' }),
  }));
  return normalizeJob(patched);
}

export async function failFlowJob(jobId, { error, message, workerId } = {}) {
  const patched = await patchFlowJob(jobId, (current) => ({
    status: FLOW_STATUSES.FAILED,
    message: message || error || 'AutoFlow thất bại.',
    error: error || message || 'AutoFlow thất bại.',
    workerId: workerId || current.workerId || '',
    heartbeatAt: nowIso(),
    timeline: appendTimeline(current, FLOW_STATUSES.FAILED, message || error || 'AutoFlow thất bại.', { workerId: workerId || current.workerId || '' }),
  }));
  return normalizeJob(patched);
}

function normalizeResultInput({ jobId, originalName, mimeType, prompt, promptIndex, url, thumbnail, duration, aspectRatio, sizeLabel }) {
  const isImage = mimeType?.startsWith?.('image/') || String(url || '').match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i);
  return {
    id: makeId('res'),
    type: isImage ? 'image' : 'video',
    title: shortTitle(prompt, `${isImage ? 'Image' : 'Video'} ${Number(promptIndex || 0) + 1}`),
    prompt: prompt || '',
    promptIndex: Number(promptIndex || 0),
    url,
    thumbnail: thumbnail || '',
    duration: duration || 8,
    aspectRatio: aspectRatio || '16:9',
    sizeLabel: sizeLabel || (isImage ? 'HD' : '1080p'),
    originalName: originalName || '',
    createdAt: nowIso(),
  };
}

export async function saveFlowResultFile({ jobId, file, bytes, originalName, mimeType, prompt, promptIndex, duration, aspectRatio, complete, jobSnapshot }) {
  await ensureDirs();
  let job = await readFlowJob(jobId);
  if (!job && jobSnapshot) job = await recoverFlowJobFromSnapshot(jobId, jobSnapshot);
  if (!job) throw new Error('Không tìm thấy job.');

  const rawBytes = bytes || Buffer.from(await file.arrayBuffer());
  const prepared = normalizeResultFilePayload({
    bytes: rawBytes,
    originalName: originalName || file?.name || 'result.mp4',
    mimeType: mimeType || file?.type || '',
  });
  const name = `${Date.now()}-${safeFileName(prepared.originalName || 'result.mp4')}`;
  const dir = path.join(RESULT_DIR, jobId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, prepared.bytes);

  const result = normalizeResultInput({
    jobId,
    originalName: prepared.originalName || name,
    mimeType: prepared.mimeType || contentTypeFromName(name, 'video/mp4'),
    prompt,
    promptIndex,
    url: `${PUBLIC_RESULT_PREFIX}/${jobId}/${name}`,
    duration,
    aspectRatio,
  });

  const currentResults = Array.isArray(job.results) ? job.results : [];
  const nextStatus = complete ? FLOW_STATUSES.COMPLETED : FLOW_STATUSES.FETCHING_RESULTS;
  const patched = await patchFlowJob(jobId, (current) => ({
    status: nextStatus,
    message: complete ? 'AutoFlow đã hoàn tất và trả kết quả về website.' : 'Worker đã gửi một kết quả về website.',
    results: [...currentResults, result],
    heartbeatAt: nowIso(),
    completedAt: complete ? nowIso() : current.completedAt || '',
    timeline: appendTimeline(current, nextStatus, complete ? 'Hoàn tất job.' : 'Đã nhận thêm kết quả.', { resultId: result.id }),
  }));

  return { result, job: normalizeJob(patched) };
}

export async function appendFlowResultRecords(jobId, results = [], { complete = false, message, jobSnapshot } = {}) {
  let job = await readFlowJob(jobId);
  if (!job && jobSnapshot) job = await recoverFlowJobFromSnapshot(jobId, jobSnapshot);
  if (!job) throw new Error('Không tìm thấy job.');
  const normalized = results.map((item, index) => normalizeResultInput({
    ...item,
    jobId,
    promptIndex: item.promptIndex ?? index,
    prompt: item.prompt || job.prompts?.[item.promptIndex ?? index] || '',
    mimeType: item.mimeType || (item.type === 'image' ? 'image/png' : 'video/mp4'),
    duration: item.duration || job.duration || 8,
    aspectRatio: item.aspectRatio || job.aspectRatio || '16:9',
  }));
  const patched = await patchFlowJob(jobId, (current) => ({
    status: complete ? FLOW_STATUSES.COMPLETED : FLOW_STATUSES.FETCHING_RESULTS,
    message: message || (complete ? 'AutoFlow đã hoàn tất và trả kết quả về website.' : 'Worker đã cập nhật kết quả.'),
    results: [...(current.results || []), ...normalized],
    heartbeatAt: nowIso(),
    completedAt: complete ? nowIso() : current.completedAt || '',
    timeline: appendTimeline(current, complete ? FLOW_STATUSES.COMPLETED : FLOW_STATUSES.FETCHING_RESULTS, message || 'Worker đã cập nhật kết quả.'),
  }));
  return normalizeJob(patched);
}

export async function getFlowResultsByToken(token) {
  if (!token) return null;
  const jobs = await listFlowJobs();
  const job = jobs.find((item) => item.token === token);
  if (!job) return null;
  return {
    success: true,
    token,
    jobId: job.jobId,
    expiresAt: job.expiresAt,
    results: Array.isArray(job.results) ? job.results : [],
    zipUrl: job.zipUrl,
  };
}

export async function applyFlowResultsAction({ token, jobId, action }) {
  const job = jobId ? await readFlowJob(jobId) : (await listFlowJobs()).find((item) => item.token === token);
  if (!job) throw new Error('Không tìm thấy job/token.');

  if (action === 'delete_all') {
    const patched = await patchFlowJob(job.jobId, (current) => ({
      results: [],
      message: 'Đã xóa kết quả khỏi danh sách hiển thị.',
      timeline: appendTimeline(current, current.status, 'Đã xóa danh sách kết quả.'),
    }));
    return { success: true, message: 'Đã xóa kết quả khỏi danh sách hiển thị.', expiresAt: patched.expiresAt, results: [] };
  }

  if (action === 'keep_3_days') {
    const next = futureIso();
    const patched = await patchFlowJob(job.jobId, (current) => ({
      expiresAt: next,
      message: 'Đã gia hạn giữ kết quả thêm 3 ngày.',
      timeline: appendTimeline(current, current.status, 'Đã gia hạn giữ kết quả thêm 3 ngày.'),
    }));
    return { success: true, message: 'Đã gia hạn giữ kết quả thêm 3 ngày.', expiresAt: patched.expiresAt };
  }

  if (action === 'share') {
    return { success: true, message: 'Đã tạo link chia sẻ.', shareUrl: `/shared/${job.token}`, token: job.token, expiresAt: job.expiresAt };
  }

  if (action === 'save_all') {
    return { success: true, message: 'Gói tải xuống đã sẵn sàng.', zipUrl: job.zipUrl || `/api/flow/jobs/${job.jobId}/download`, expiresAt: job.expiresAt };
  }

  throw new Error('Action không hợp lệ.');
}

export function normalizeJob(job) {
  if (!job) return null;
  return {
    success: true,
    jobId: job.jobId,
    token: job.token,
    status: job.status,
    message: job.message,
    error: job.error || '',
    tool: job.tool,
    outputType: job.outputType || ((job.tool === 'text-to-image' || job.tool === 'my-product') ? 'image' : 'video'),
    model: job.model,
    aspectRatio: job.aspectRatio,
    duration: job.duration,
    frame: job.frame,
    videosPerPrompt: Number(job.videosPerPrompt || 1),
    requestedCount: Number(job.requestedCount || (Array.isArray(job.prompts) ? job.prompts.length : 1)),
    maxResults: Number(job.maxResults || job.requestedCount || (Array.isArray(job.prompts) ? job.prompts.length : 1)),
    prompts: job.prompts || [],
    inputAsset: job.inputAsset || null,
    endInputAsset: job.endInputAsset || null,
    results: Array.isArray(job.results) ? job.results : [],
    resultCount: Array.isArray(job.results) ? job.results.length : 0,
    zipUrl: job.zipUrl || `/api/flow/jobs/${job.jobId}/download`,
    shareUrl: job.shareUrl || `/shared/${job.token}`,
    expiresAt: job.expiresAt,
    workerId: job.workerId || '',
    heartbeatAt: job.heartbeatAt || '',
    claimedAt: job.claimedAt || '',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    timeline: Array.isArray(job.timeline) ? job.timeline : [],
  };
}

// Minimal ZIP writer, stored/no-compression. It avoids adding a heavy dependency.
function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value & 0xffff, 0);
  return b;
}

function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0, 0);
  return b;
}

export async function buildFlowJobZip(jobId) {
  const job = await readFlowJob(jobId);
  if (!job) throw new Error('Không tìm thấy job.');
  const files = [];
  for (const [index, result] of (job.results || []).entries()) {
    if (!result.url || !result.url.startsWith(PUBLIC_RESULT_PREFIX)) continue;
    const relative = result.url.replace(PUBLIC_RESULT_PREFIX, '').replace(/^\//, '');
    const diskPath = path.join(RESULT_DIR, relative);
    if (!fsSync.existsSync(diskPath)) continue;
    const ext = path.extname(diskPath) || (result.type === 'image' ? '.png' : '.mp4');
    files.push({
      name: `${String(index + 1).padStart(2, '0')}-${safeFileName(result.title || 'result')}${ext}`,
      data: await fs.readFile(diskPath),
      date: new Date(result.createdAt || job.createdAt || Date.now()),
    });
  }

  const manifest = Buffer.from(JSON.stringify({
    jobId: job.jobId,
    token: job.token,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    prompts: job.prompts,
    results: job.results,
  }, null, 2));
  files.push({ name: 'manifest.json', data: manifest, date: new Date() });

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = file.data;
    const crc = crc32(data);
    const dt = dosDateTime(file.date);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(dt.time), u16(dt.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dt.time), u16(dt.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...localParts, central, end]);
}
