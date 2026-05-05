const DEFAULT_BASE = process.env.NEXT_PUBLIC_LOCAL_AGENT_BASE_URL || 'http://127.0.0.1:48765';

function ensureBrowser() {
  if (typeof window === 'undefined') throw new Error('Local Agent chỉ được gọi từ trình duyệt.');
}

export function splitPromptLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function parseJson(response, fallback) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || fallback };
  }
  if (!response.ok) {
    throw new Error(data?.message || data?.error || fallback || `Request failed (${response.status})`);
  }
  return data;
}

export async function pingLocalAgent() {
  ensureBrowser();
  const response = await fetch(`${DEFAULT_BASE}/health`, { cache: 'no-store' });
  return parseJson(response, 'Không kết nối được Local Agent.');
}

export async function createLocalAutomationJob(payload) {
  ensureBrowser();
  const response = await fetch(`${DEFAULT_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson(response, 'Không tạo được job ở Local Agent.');
}

export async function getLocalAutomationJob(jobId) {
  ensureBrowser();
  const response = await fetch(`${DEFAULT_BASE}/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  return parseJson(response, 'Không đọc được trạng thái từ Local Agent.');
}
