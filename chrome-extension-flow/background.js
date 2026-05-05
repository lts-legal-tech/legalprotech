const AGENT = 'http://127.0.0.1:48765';
const FLOW_URL_PATTERNS = [
  /^https:\/\/flow\.google(?:\/|$)/i,
  /^https:\/\/labs\.google\/fx\/tools\/flow(?:\/|$)/i,
];
const FLOW_TAB_URLS = ['https://flow.google/*', 'https://labs.google/*'];
const POLL_ALARM = 'legalprotech-flow-poll';

const activeJobIds = new Set();
let dispatching = false;

function isFlowUrl(url = '') {
  return FLOW_URL_PATTERNS.some((pattern) => pattern.test(String(url || '')));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${AGENT}${path}`, {
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!response.ok) {
      throw new Error(data?.message || data?.error || `Agent HTTP ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(path, payload) {
  return fetchJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

async function reportStatus(payload) {
  if (!payload?.jobId) return;
  const normalized = {
    ...payload,
    updatedAt: new Date().toISOString(),
  };

  const endpoints = [
    '/automation/status',
    `/jobs/${encodeURIComponent(payload.jobId)}`,
  ];

  for (const endpoint of endpoints) {
    try {
      await postJson(endpoint, normalized);
      return;
    } catch (error) {
      // Try the next endpoint because older Local Agent builds used different routes.
    }
  }
}

async function getNextJob() {
  try {
    const job = await fetchJson(`/automation/next?ts=${Date.now()}`);
    if (!job || job.empty || !job.jobId) return null;
    return job;
  } catch (error) {
    return null;
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

async function pingContent(tabId) {
  try {
    const response = await sendTabMessage(tabId, { type: 'PING_FLOW_CONTENT' });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  if (await pingContent(tabId)) return true;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-flow.js'],
    });
  } catch (error) {
    // Content script may already be present or injection can be blocked while the page is still loading.
  }

  await delay(700);
  return pingContent(tabId);
}

async function getFlowTabs() {
  const byId = new Map();

  for (const url of FLOW_TAB_URLS) {
    try {
      const tabs = await chrome.tabs.query({ url });
      tabs.forEach((tab) => {
        if (tab?.id && isFlowUrl(tab.url)) byId.set(tab.id, tab);
      });
    } catch {
      // Ignore query pattern errors and fall back below.
    }
  }

  if (byId.size === 0) {
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => {
      if (tab?.id && isFlowUrl(tab.url)) byId.set(tab.id, tab);
    });
  }

  return Array.from(byId.values()).sort((a, b) => Number(b.active) - Number(a.active));
}

async function deliverJobToFlow(job, reason = 'unknown') {
  const tabs = await getFlowTabs();

  if (!tabs.length) {
    await reportStatus({
      jobId: job.jobId,
      status: 'WAITING_USER',
      message: 'Chưa thấy tab Flow. Hãy mở Flow rồi extension sẽ tự lấy job.',
      reason,
    });
    return false;
  }

  const tab = tabs.find((item) => item.active) || tabs[0];

  await reportStatus({
    jobId: job.jobId,
    status: 'PROCESSING',
    message: 'Chrome Extension đã nhận job, đang kết nối content script trong Flow...',
    reason,
    flowUrl: tab.url,
  });

  const ready = await ensureContentScript(tab.id);
  if (!ready) {
    await reportStatus({
      jobId: job.jobId,
      status: 'FAILED',
      message: 'Extension chưa inject được content script vào tab Flow. Hãy reload extension và reload tab Flow.',
      reason,
    });
    return false;
  }

  try {
    await chrome.tabs.update(tab.id, { active: true });
  } catch { }

  const response = await sendTabMessage(tab.id, { type: 'RUN_FLOW_JOB', job });
  if (!response?.started) {
    throw new Error('Content script chưa xác nhận chạy job.');
  }

  await reportStatus({
    jobId: job.jobId,
    status: 'PROCESSING',
    message: 'Job đã được gửi vào tab Flow, đang tự động tạo project và điền prompt...',
    reason,
    flowUrl: tab.url,
  });

  return true;
}

async function dispatchNextJob(reason = 'poll') {
  if (dispatching) return;
  dispatching = true;
  try {
    const job = await getNextJob();
    if (!job?.jobId) return;
    if (activeJobIds.has(job.jobId)) return;

    activeJobIds.add(job.jobId);
    const delivered = await deliverJobToFlow(job, reason);
    if (!delivered) activeJobIds.delete(job.jobId);
  } catch (error) {
    // Keep the worker quiet; detailed errors are reported per job when available.
    console.warn('[Flow Automation Bridge] dispatch failed:', error);
  } finally {
    dispatching = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  dispatchNextJob('installed');
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  dispatchNextJob('startup');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) dispatchNextJob('alarm');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isFlowUrl(tab?.url)) {
    dispatchNextJob('tab-complete');
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isFlowUrl(tab?.url)) dispatchNextJob('tab-activated');
  } catch { }
});

chrome.windows.onFocusChanged.addListener(() => {
  dispatchNextJob('window-focus');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'FLOW_CONTENT_READY') {
    dispatchNextJob('content-ready');
    sendResponse?.({ ok: true });
    return true;
  }

  if (message?.type === 'FLOW_AUTOMATION_STATUS') {
    reportStatus({
      ...message,
      flowUrl: sender?.tab?.url,
    }).then(() => {
      if (['FAILED', 'COMPLETED', 'WAITING_DOWNLOAD'].includes(message.status)) {
        activeJobIds.delete(message.jobId);
      }
      sendResponse?.({ ok: true });
    }).catch((error) => {
      sendResponse?.({ ok: false, error: error.message });
    });
    return true;
  }

  if (message?.type === 'FLOW_DOWNLOAD_TRIGGERED') {
    reportStatus({
      jobId: message.jobId,
      status: 'WAITING_DOWNLOAD',
      message: 'Flow đã bấm tải video. Local Agent đang theo dõi thư mục Downloads để upload lại website.',
      flowUrl: sender?.tab?.url,
    }).then(() => sendResponse?.({ ok: true }));
    activeJobIds.delete(message.jobId);
    return true;
  }

  if (message?.type === 'FLOW_RENDER_READY') {
    reportStatus({
      jobId: message.jobId,
      status: 'WAITING_USER',
      message: 'Flow đã có preview nhưng chưa thấy nút download. Có thể cần thao tác tải thủ công.',
      note: message.note,
      flowUrl: sender?.tab?.url,
    }).then(() => sendResponse?.({ ok: true }));
    return true;
  }

  return false;
});

setInterval(() => dispatchNextJob('interval'), 7000);
dispatchNextJob('worker-start');
