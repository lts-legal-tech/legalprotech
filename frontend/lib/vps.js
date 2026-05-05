
const MOCK_VIDEO = [
  'https://samplelib.com/lib/preview/mp4/sample-5s.mp4',
  'https://samplelib.com/lib/preview/mp4/sample-10s.mp4',
  'https://www.w3schools.com/html/mov_bbb.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://media.istockphoto.com/id/1403119984/video/rotating-white-podium-on-a-white-background.mp4?s=mp4-640x640-is&k=20&c=AU5GKNxMrgwT2vVrAedQ_-Ko0Qg_NDcQh6n7atwq5k8=',
];
const MOCK_IMAGE = [
  'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1511556820780-d912e42b4980?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80',
];

const splitPromptLines = (value) =>
  String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const shortTitle = (value, fallback) => {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
};

const headers = () => {
  const h = {};
  if (process.env.VPS_API_KEY) h['x-api-key'] = process.env.VPS_API_KEY;
  return h;
};
const mock = () => String(process.env.VPS_MOCK_MODE || 'false') === 'true';
const future = (d = 3) => new Date(Date.now() + d * 86400000).toISOString();
const id = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const base = () => String(process.env.VPS_API_BASE_URL || '').replace(/\/$/, '');
const BROWSER_MOCK_KEY = 'legalprotech-browser-mock-store';

function readBrowserStore() {
  if (typeof window === 'undefined') return { jobs: {}, tokens: {} };
  try {
    const raw = window.localStorage.getItem(BROWSER_MOCK_KEY);
    if (!raw) return { jobs: {}, tokens: {} };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { jobs: {}, tokens: {} };
  } catch {
    return { jobs: {}, tokens: {} };
  }
}

function writeBrowserStore(data) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BROWSER_MOCK_KEY, JSON.stringify(data));
}

function createMockJob(job) {
  const s = readBrowserStore();
  s.jobs[job.jobId] = job;
  s.tokens[job.token] = { results: job.results, expiresAt: job.expiresAt, jobId: job.jobId, zipUrl: job.zipUrl };
  writeBrowserStore(s);
}

function getMockJob(jobId) {
  return readBrowserStore().jobs[jobId];
}

function updateMockJob(jobId, updater) {
  const s = readBrowserStore();
  if (!s.jobs[jobId]) return null;
  s.jobs[jobId] = updater(s.jobs[jobId]);
  s.tokens[s.jobs[jobId].token] = {
    results: s.jobs[jobId].results,
    expiresAt: s.jobs[jobId].expiresAt,
    jobId,
    zipUrl: s.jobs[jobId].zipUrl,
  };
  writeBrowserStore(s);
  return s.jobs[jobId];
}

function getTokenRecord(token) {
  return readBrowserStore().tokens[token];
}

function updateTokenRecord(token, updater) {
  const s = readBrowserStore();
  if (!s.tokens[token]) return null;
  s.tokens[token] = updater(s.tokens[token]);
  writeBrowserStore(s);
  return s.tokens[token];
}

function ensureBase() {
  const value = base();
  if (!value) {
    throw new Error('Thiếu VPS_API_BASE_URL trong .env.local của frontend.');
  }
  return value;
}

async function parseResponse(res, fallback) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || fallback };
  }
  if (!res.ok) {
    const message = data?.message || data?.error || fallback || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function proxifyUrl(value) {
  if (!value) return '';
  if (value.startsWith('/api/vps/') || value.startsWith('/shared/')) return value;
  if (mock()) return value;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return `/api/vps/asset?url=${encodeURIComponent(value)}`;
  }
  if (value.startsWith('/')) {
    return `/api/vps/asset?path=${encodeURIComponent(value)}`;
  }
  return value;
}

function normalizeResults(results) {
  if (!Array.isArray(results)) return [];
  return results.map((item) => ({
    ...item,
    url: proxifyUrl(item.url),
    thumbnail: proxifyUrl(item.thumbnail),
  }));
}

function normalizePayload(data) {
  if (!data || typeof data !== 'object') return data;
  const normalized = { ...data };
  if (Array.isArray(data.results)) normalized.results = normalizeResults(data.results);
  if (data.zipUrl) normalized.zipUrl = proxifyUrl(data.zipUrl);
  return normalized;
}

function makeResults(tool, count, promptLines = []) {
  const isVideo = tool.includes('video');
  const src = isVideo ? MOCK_VIDEO : MOCK_IMAGE;
  return Array.from({ length: count }, (_, i) => {
    const prompt = promptLines[i] || promptLines[0] || '';
    return {
      id: id('r'),
      type: isVideo ? 'video' : 'image',
      title: shortTitle(prompt, `${isVideo ? 'Video' : 'Image'} ${i + 1}`),
      prompt,
      url: src[i % src.length],
      thumbnail: isVideo ? `https://picsum.photos/seed/${tool}-${i + 1}/800/450` : src[i % src.length],
      duration: isVideo ? 5 + (i % 3) * 3 : undefined,
      sizeLabel: isVideo ? '1080p' : '1600px',
    };
  });
}

export async function createJob(formData) {
  if (mock()) {
    const tool = String(formData.get('tool') || 'image-to-video');
    const promptLines = splitPromptLines(formData.get('prompt'));
    const requestedCount = Number(formData.get('count') || (tool.includes('video') ? 5 : 4));
    const count = tool.includes('video')
      ? Math.max(1, Math.min(requestedCount || promptLines.length || 1, 10))
      : Math.max(1, Math.min(requestedCount || 1, 4));
    const jobId = id('job');
    const token = id('share');
    const zipUrl = `/api/vps/mock/zip?token=${token}`;
    createMockJob({
      jobId,
      tool,
      createdAt: Date.now(),
      token,
      expiresAt: future(3),
      zipUrl,
      results: makeResults(tool, count, promptLines),
      requestedFrame: String(formData.get('frame') || 'Auto'),
      status: 'QUEUED',
      prompts: promptLines,
    });
    return { success: true, jobId, status: 'QUEUED', message: 'Mock VPS đã nhận job.' };
  }
  const target = `${ensureBase()}/jobs/create`;
  const res = await fetch(target, { method: 'POST', headers: headers(), body: formData, cache: 'no-store' });
  return normalizePayload(await parseResponse(res, 'Không tạo được job từ backend nội bộ.'));
}

export async function getJobStatus(jobId) {
  if (mock()) {
    const job = getMockJob(jobId);
    if (!job) return { status: 'FAILED', error: 'Không tìm thấy mock job.' };
    const elapsed = Date.now() - job.createdAt;
    if (elapsed < 2500) return { success: true, status: 'QUEUED', message: 'Đã vào hàng chờ VPS...' };
    if (elapsed < 6000) return { success: true, status: 'PROCESSING', message: 'Đang tạo biến thể...' };
    updateMockJob(jobId, (p) => ({ ...p, status: 'COMPLETED' }));
    return normalizePayload({
      success: true,
      status: 'COMPLETED',
      message: 'Đã tạo xong.',
      token: job.token,
      expiresAt: job.expiresAt,
      resultCount: Array.isArray(job.results) ? job.results.length : 0,
      results: job.results,
      zipUrl: job.zipUrl,
      frame: job.requestedFrame,
    });
  }
  const target = `${ensureBase()}/jobs/status?jobId=${encodeURIComponent(jobId)}`;
  const res = await fetch(target, { headers: headers(), cache: 'no-store' });
  return normalizePayload(await parseResponse(res, 'Không đọc được trạng thái job từ backend nội bộ.'));
}

export async function getResultsByToken(token) {
  if (mock()) {
    const rec = getTokenRecord(token);
    return rec || { error: 'Token không tồn tại.' };
  }
  const target = `${ensureBase()}/results/${token}`;
  const res = await fetch(target, { headers: headers(), cache: 'no-store' });
  return normalizePayload(await parseResponse(res, 'Không lấy được batch kết quả từ backend nội bộ.'));
}

export async function postResultsAction(payload) {
  if (mock()) {
    const { token, action } = payload;
    const record = getTokenRecord(token);
    if (!record) return { error: 'Không tìm thấy token.' };
    if (action === 'delete_all') {
      updateTokenRecord(token, (p) => ({ ...p, results: [] }));
      return { success: true, message: 'Đã xoá toàn bộ kết quả trên VPS mock.', expiresAt: record.expiresAt };
    }
    if (action === 'keep_3_days') {
      const next = future(3);
      updateTokenRecord(token, (p) => ({ ...p, expiresAt: next }));
      return { success: true, message: 'Đã gia hạn giữ 3 ngày.', expiresAt: next };
    }
    if (action === 'share') return { success: true, message: 'Đã tạo link chia sẻ.', shareUrl: `/shared/${token}`, expiresAt: record.expiresAt };
    if (action === 'save_all') return { success: true, message: 'Zip package đã sẵn sàng.', zipUrl: record.zipUrl, expiresAt: record.expiresAt };
    return { success: false, error: 'Action không hợp lệ.' };
  }
  const target = `${ensureBase()}/results/action`;
  const res = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers() },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  return normalizePayload(await parseResponse(res, 'Không gửi được action tới backend nội bộ.'));
}
