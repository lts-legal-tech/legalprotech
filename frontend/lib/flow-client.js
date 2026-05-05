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
  const response = await fetch('/api/flow/jobs', {
    method: 'POST',
    body: formData,
    cache: 'no-store',
  });
  return parseJson(response, 'Không tạo được job AutoFlow.');
}

export async function getFlowJobStatus(jobId) {
  const response = await fetch(`/api/flow/jobs/${encodeURIComponent(jobId)}`, {
    cache: 'no-store',
  });
  return parseJson(response, 'Không đọc được trạng thái AutoFlow.');
}

export async function postFlowResultsAction(payload) {
  const response = await fetch('/api/flow/results/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  return parseJson(response, 'Không thực hiện được thao tác với kết quả AutoFlow.');
}
