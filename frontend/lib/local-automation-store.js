import fs from 'fs/promises';
import path from 'path';

const ROOT = path.join(process.cwd(), '.local-automation');
const JOBS_DIR = path.join(ROOT, 'jobs');
const PUBLIC_RESULTS_DIR = path.join(process.cwd(), 'public', 'local-automation');

async function ensureDirs() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_RESULTS_DIR, { recursive: true });
}

function jobPath(jobId) {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

export async function readAutomationJob(jobId) {
  await ensureDirs();
  try {
    const raw = await fs.readFile(jobPath(jobId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeAutomationJob(job) {
  await ensureDirs();
  const payload = {
    ...job,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(jobPath(job.jobId), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export async function upsertAutomationJob(jobId, patch) {
  const current = (await readAutomationJob(jobId)) || {
    jobId,
    status: 'QUEUED',
    message: 'Đã tạo job local automation.',
    prompts: [],
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return writeAutomationJob({ ...current, ...patch, jobId });
}

export async function saveAutomationResult({ jobId, originalName, bytes, mimeType, prompt, aspectRatio, duration }) {
  await ensureDirs();
  const safeName = `${Date.now()}-${String(originalName || 'result.mp4').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const dir = path.join(PUBLIC_RESULTS_DIR, jobId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, safeName);
  await fs.writeFile(filePath, bytes);
  const result = {
    id: `${jobId}-${Date.now()}`,
    type: mimeType?.startsWith('image/') ? 'image' : 'video',
    title: prompt || originalName || 'Kết quả automation',
    prompt: prompt || '',
    url: `/local-automation/${jobId}/${safeName}`,
    thumbnail: '',
    duration: duration || 8,
    aspectRatio: aspectRatio || '16:9',
    sizeLabel: mimeType?.startsWith('image/') ? 'HD' : '1080p',
    createdAt: new Date().toISOString(),
  };

  const current = await readAutomationJob(jobId);
  const results = Array.isArray(current?.results) ? [...current.results, result] : [result];
  await upsertAutomationJob(jobId, {
    status: 'COMPLETED',
    message: 'Local Agent đã tải video về và đẩy lại website.',
    results,
  });

  return result;
}
