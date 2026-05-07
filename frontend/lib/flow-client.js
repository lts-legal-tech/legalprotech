import { appendUserToFormData, userRequestHeaders, withUserQuery, getCurrentUserScope } from './user-scope-client';
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

export async function createFlowJob(formData) {
  appendUserToFormData(formData);
  const response = await fetch('/api/flow/jobs', {
    method: 'POST',
    headers: userRequestHeaders(),
    body: formData,
    cache: 'no-store',
  });
  return parseJson(response, 'Không tạo được job AutoFlow.');
}

export async function getFlowJobStatus(jobId) {
  const response = await fetch(withUserQuery(`/api/flow/jobs/${encodeURIComponent(jobId)}`), {
    headers: userRequestHeaders(),
    cache: 'no-store',
  });
  return parseJson(response, 'Không đọc được trạng thái AutoFlow.');
}

export async function postFlowResultsAction(payload) {
  const { userId } = getCurrentUserScope();
  const response = await fetch('/api/flow/results/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userRequestHeaders() },
    body: JSON.stringify({ ...(payload || {}), user_id: userId }),
    cache: 'no-store',
  });
  return parseJson(response, 'Không thực hiện được thao tác với kết quả AutoFlow.');
}
