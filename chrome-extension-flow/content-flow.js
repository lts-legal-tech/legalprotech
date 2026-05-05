(() => {
  const FLOW_HOST_OK =
    /(^|\.)flow\.google$/i.test(window.location.hostname) ||
    (/(^|\.)labs\.google$/i.test(window.location.hostname) && window.location.pathname.includes('/fx/tools/flow'));

  if (!FLOW_HOST_OK) return;

  const STATE = {
    running: false,
    currentJobId: null,
    lastStatusAt: 0,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function qsa(selector, root = document) {
    const output = [];
    const seenRoots = new Set();

    function visit(scope) {
      if (!scope || seenRoots.has(scope)) return;
      seenRoots.add(scope);
      try {
        output.push(...Array.from(scope.querySelectorAll(selector)));
        Array.from(scope.querySelectorAll('*')).forEach((node) => {
          if (node.shadowRoot) visit(node.shadowRoot);
        });
      } catch { }
    }

    visit(root);
    return output;
  }

  function qs(selector, root = document) {
    return qsa(selector, root)[0] || null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function lower(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function textOf(el) {
    if (!el) return '';
    const parts = [
      el.innerText,
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('name'),
      el.getAttribute?.('data-testid'),
      el.getAttribute?.('data-test-id'),
      el.getAttribute?.('id'),
    ].filter(Boolean);
    return String(parts.join(' ')).replace(/\s+/g, ' ').trim();
  }

  function unique(elements) {
    return [...new Set(elements.filter(Boolean))];
  }

  function interactiveNodes(root = document) {
    return unique([
      ...qsa('button', root),
      ...qsa('a[href]', root),
      ...qsa('[role="button"]', root),
      ...qsa('[role="menuitem"]', root),
      ...qsa('[role="option"]', root),
      ...qsa('[aria-haspopup="menu"]', root),
      ...qsa('[aria-haspopup="listbox"]', root),
      ...qsa('[data-testid]', root),
      ...qsa('[data-test-id]', root),
      ...qsa('[tabindex]:not([tabindex="-1"])', root),
    ]).filter(isVisible);
  }

  function inputNodes(root = document) {
    return unique([
      ...qsa('textarea', root),
      ...qsa('input:not([type])', root),
      ...qsa('input[type="text"]', root),
      ...qsa('input[type="search"]', root),
      ...qsa('[contenteditable="true"]', root),
      ...qsa('[role="textbox"]', root),
    ]).filter(isVisible);
  }

  function findByText(candidates, keywords, { exact = false, requireAll = false } = {}) {
    const keys = keywords.map((k) => lower(k)).filter(Boolean);
    return candidates.find((node) => {
      const t = lower(textOf(node));
      if (!t) return false;
      if (exact) return keys.includes(t);
      if (requireAll) return keys.every((k) => t.includes(k));
      return keys.some((k) => t.includes(k));
    });
  }

  function findButton(keywords, opts = {}) {
    return findByText(interactiveNodes(), keywords, opts);
  }

  function fireMouseSequence(node) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      try {
        node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch { }
    });
  }

  async function clickNode(node) {
    if (!node) return false;
    try {
      node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch { }
    try {
      node.focus?.({ preventScroll: true });
    } catch { }
    try {
      fireMouseSequence(node);
      node.click?.();
      await sleep(450);
      return true;
    } catch {
      return false;
    }
  }

  async function clickButtonByText(keywords, opts = {}) {
    const node = findButton(keywords, opts);
    if (!node) return false;
    return clickNode(node);
  }

  async function waitFor(fn, timeout = 30000, interval = 400) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = await fn();
      if (value) return value;
      await sleep(interval);
    }
    return null;
  }

  async function waitForSelector(selectors, timeout = 30000) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    return waitFor(() => {
      for (const sel of list) {
        const node = qs(sel);
        if (isVisible(node)) return node;
      }
      return null;
    }, timeout);
  }

  async function sendRuntimeMessage(payload) {
    try {
      if (chrome?.runtime?.sendMessage) {
        return await chrome.runtime.sendMessage(payload);
      }
    } catch { }
    return null;
  }

  async function updateStatus(jobId, status, message, extra = {}) {
    const now = Date.now();
    if (now - STATE.lastStatusAt < 250 && status === 'PROCESSING') return;
    STATE.lastStatusAt = now;

    console.log('[Flow Automation]', status, message, extra);

    await sendRuntimeMessage({
      type: 'FLOW_AUTOMATION_STATUS',
      jobId,
      status,
      message,
      ...extra,
    });
  }

  function normalizePrompt(job) {
    if (typeof job?.prompt === 'string' && job.prompt.trim()) return job.prompt.trim();
    if (typeof job?.promptText === 'string' && job.promptText.trim()) return job.promptText.trim();
    if (Array.isArray(job?.prompts) && job.prompts.length) return String(job.prompts[0] || '').trim();
    return '';
  }

  function normalizeDuration(job) {
    const allowed = new Set(['4', '6', '8']);
    const v = String(job?.duration || '8').replace(/[^\d]/g, '');
    return allowed.has(v) ? v : '8';
  }

  function normalizeAspect(job) {
    const raw = String(job?.aspectRatio || job?.aspect_ratio || '16:9').trim();
    const allowed = new Set(['16:9', '9:16', '1:1', '4:5']);
    return allowed.has(raw) ? raw : '16:9';
  }

  async function dismissOverlays() {
    const oneShots = [
      ['got it', 'ok', 'okay', 'close', 'dismiss', 'not now', 'skip', 'continue'],
      ['understood', 'accept', 'agree', 'done', 'maybe later'],
    ];

    for (const keywords of oneShots) {
      const btn = findButton(keywords);
      if (btn) {
        await clickNode(btn);
        await sleep(350);
      }
    }

    const closeIcon = unique([
      ...qsa('[aria-label*="close" i]'),
      ...qsa('[title*="close" i]'),
      ...qsa('[aria-label*="dismiss" i]'),
    ]).find(isVisible);

    if (closeIcon) {
      await clickNode(closeIcon);
      await sleep(250);
    }
  }

  async function ensureFlowReady(job) {
    await updateStatus(job.jobId, 'PROCESSING', 'Đang chờ Flow sẵn sàng...');
    await dismissOverlays();

    return waitFor(() => {
      const editor = findPromptInput();
      if (editor) return editor;
      const newProject = findButton([
        'new project',
        'create project',
        'create new',
        'new video',
        'new scene',
        'start creating',
        'text to video',
        'image to video',
        'create',
      ]);
      if (newProject) return newProject;
      return null;
    }, 45000, 500);
  }

  function findPromptInput() {
    const nodes = inputNodes();

    const scored = nodes
      .map((node) => {
        const attrs = lower(textOf(node));
        let score = 0;
        if (attrs.includes('prompt')) score += 10;
        if (attrs.includes('describe')) score += 7;
        if (attrs.includes('description')) score += 5;
        if (attrs.includes('video')) score += 4;
        if (attrs.includes('create')) score += 2;
        if (attrs.includes('ask')) score += 2;
        if (node.matches?.('textarea')) score += 5;
        if (node.getAttribute?.('contenteditable') === 'true') score += 3;
        if (node.getAttribute?.('role') === 'textbox') score += 3;
        if (isVisible(node)) score += 2;

        const rect = node.getBoundingClientRect();
        if (rect.width > 250 && rect.height > 36) score += 3;
        if (rect.height > 80) score += 2;

        return { node, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored.find((item) => item.score >= 5)?.node || scored[0]?.node || null;
  }

  async function ensureProjectReady(job) {
    await updateStatus(job.jobId, 'PROCESSING', 'Đang chuẩn bị project Flow...');

    let editor = findPromptInput();
    if (editor) return editor;

    const createActions = [
      () => clickButtonByText(['new project', 'create project', 'create new', 'start new'], { requireAll: false }),
      () => clickButtonByText(['new video', 'new scene', 'start creating', 'start project'], { requireAll: false }),
      () => clickButtonByText(['text to video', 'image to video', 'generate video'], { requireAll: false }),
      () => clickButtonByText(['create'], { exact: false }),
      () => clickButtonByText(['continue'], { exact: false }),
      () => clickButtonByText(['start'], { exact: false }),
    ];

    for (const action of createActions) {
      if (findPromptInput()) break;
      const clicked = await action();
      if (clicked) {
        await sleep(1800);
        await dismissOverlays();
      }
    }

    editor = await waitFor(() => findPromptInput(), 45000, 500);
    if (!editor) {
      throw new Error('Không tìm thấy ô prompt trong Flow. Có thể UI Flow đã đổi selector hoặc cần đăng nhập/chọn workspace trước.');
    }

    return editor;
  }

  function setNativeValue(node, value) {
    const tag = String(node.tagName || '').toLowerCase();
    const proto = tag === 'textarea' ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
    const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    if (descriptor?.set) descriptor.set.call(node, value);
    else node.value = value;
  }

  async function setValueOnInput(node, value) {
    if (!node) return false;

    try {
      node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch { }

    try {
      node.focus?.({ preventScroll: true });
      await sleep(180);
    } catch { }

    const tag = String(node.tagName || '').toLowerCase();
    const isContentEditable = node.getAttribute?.('contenteditable') === 'true';

    try {
      if (tag === 'textarea' || tag === 'input') {
        setNativeValue(node, '');
        node.dispatchEvent(new Event('input', { bubbles: true }));
        setNativeValue(node, value);
        node.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      if (isContentEditable || node.getAttribute?.('role') === 'textbox') {
        node.focus?.({ preventScroll: true });
        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, value);
        } catch {
          node.innerHTML = '';
          node.textContent = value;
        }
        node.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    } catch { }

    return false;
  }

  async function ensurePromptFilled(job, editor) {
    const prompt = normalizePrompt(job);
    if (!prompt) {
      throw new Error('Job không có prompt để gửi sang Flow.');
    }

    await updateStatus(job.jobId, 'PROCESSING', 'Đang dán prompt vào Flow...');
    const ok = await setValueOnInput(editor, prompt);
    if (!ok) {
      throw new Error('Không dán được prompt vào Flow.');
    }

    await sleep(700);
  }

  async function tryOpenSettingsPanel() {
    return (
      (await clickButtonByText(['settings'])) ||
      (await clickButtonByText(['video settings'])) ||
      (await clickButtonByText(['advanced'])) ||
      (await clickButtonByText(['more settings'])) ||
      false
    );
  }

  async function tryChooseListOption(targetTexts) {
    const targets = targetTexts.map(lower);
    const exact = interactiveNodes().find((node) => targets.includes(lower(textOf(node))));
    if (exact) {
      await clickNode(exact);
      return true;
    }

    const loose = findButton(targetTexts.map((x) => x.toLowerCase()));
    if (loose) {
      await clickNode(loose);
      return true;
    }

    return false;
  }

  async function ensureDuration(job) {
    const duration = normalizeDuration(job);
    const target = `${duration}s`;

    await updateStatus(job.jobId, 'PROCESSING', `Đang đặt thời lượng ${target}...`);

    const direct = findButton([target, `${duration} sec`, `${duration} seconds`], { exact: false });
    if (direct) {
      await clickNode(direct);
      return true;
    }

    const opened =
      (await clickButtonByText(['duration'])) ||
      (await clickButtonByText(['clip length'])) ||
      (await clickButtonByText(['length'])) ||
      (await tryOpenSettingsPanel());

    if (opened) {
      await sleep(600);
      if (await tryChooseListOption([target, `${duration} sec`, `${duration} seconds`])) return true;
    }

    return false;
  }

  async function ensureAspectRatio(job) {
    const target = normalizeAspect(job);

    await updateStatus(job.jobId, 'PROCESSING', `Đang đặt tỷ lệ ${target}...`);

    const direct = findButton([target], { exact: false });
    if (direct) {
      await clickNode(direct);
      return true;
    }

    const opened =
      (await clickButtonByText(['aspect ratio'])) ||
      (await clickButtonByText(['ratio'])) ||
      (await clickButtonByText(['frame'])) ||
      (await tryOpenSettingsPanel());

    if (opened) {
      await sleep(600);
      if (await tryChooseListOption([target])) return true;
    }

    return false;
  }

  async function ensureGenerateClicked(job) {
    await updateStatus(job.jobId, 'PROCESSING', 'Đang bấm Generate...');

    const ok =
      (await clickButtonByText(['generate video', 'generate', 'create video', 'render', 'submit'])) ||
      (await clickButtonByText(['create'])) ||
      false;

    if (!ok) {
      throw new Error('Không tìm thấy nút Generate trong Flow.');
    }

    await sleep(1800);
  }

  async function ensureImageUpload(job) {
    const imageDataUrl = job?.imageDataUrl || job?.inputImageDataUrl || job?.imagePreviewDataUrl || '';
    if (!imageDataUrl) return false;

    const uploadButton = findButton(['upload', 'image', 'reference', 'add image']);
    if (uploadButton) {
      await clickNode(uploadButton);
      await sleep(800);
    }

    const fileInput = qs('input[type="file"]') || await waitForSelector(['input[type="file"]'], 10000);
    if (!fileInput) return false;

    await updateStatus(job.jobId, 'PROCESSING', 'Đang tải ảnh đầu vào lên Flow...');

    const res = await fetch(imageDataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'input-image.png', { type: blob.type || 'image/png' });

    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await sleep(1500);
    return true;
  }

  async function waitForDownloadOrReady(job) {
    await updateStatus(job.jobId, 'PROCESSING', 'Đang chờ Flow render video...');

    const result = await waitFor(() => {
      const downloadBtn = findButton(['download', 'export', 'save video', 'download video']);
      if (downloadBtn) return { type: 'download', node: downloadBtn };

      const rendering = findButton(['stop', 'cancel']);
      if (rendering) return { type: 'rendering' };

      const maybePreview = qs('video');
      if (isVisible(maybePreview)) return { type: 'preview' };

      return null;
    }, 600000, 2000);

    if (!result) {
      throw new Error('Hết thời gian chờ video trong Flow.');
    }

    if (result.type === 'download' && result.node) {
      await updateStatus(job.jobId, 'PROCESSING', 'Video đã sẵn sàng, đang tải về...');
      await clickNode(result.node);
      await sleep(1200);
      await sendRuntimeMessage({
        type: 'FLOW_DOWNLOAD_TRIGGERED',
        jobId: job.jobId,
      });
      return true;
    }

    await sendRuntimeMessage({
      type: 'FLOW_RENDER_READY',
      jobId: job.jobId,
      note: result.type,
    });

    return true;
  }

  async function runFlowJob(rawJob) {
    const job = {
      ...rawJob,
      jobId: rawJob?.jobId || `job_${Date.now()}`,
      duration: normalizeDuration(rawJob),
      aspectRatio: normalizeAspect(rawJob),
      prompt: normalizePrompt(rawJob),
    };

    if (!job.prompt) {
      throw new Error('Thiếu prompt trong job Flow.');
    }

    if (STATE.running) {
      await updateStatus(job.jobId, 'FAILED', 'Một job Flow khác đang chạy. Hãy thử lại.');
      return;
    }

    STATE.running = true;
    STATE.currentJobId = job.jobId;

    try {
      await updateStatus(job.jobId, 'PROCESSING', 'Bắt đầu tự động hóa Flow...');
      await ensureFlowReady(job);
      const editor = await ensureProjectReady(job);
      await ensurePromptFilled(job, editor);
      await ensureImageUpload(job);   // best-effort cho image-to-video
      await ensureDuration(job);      // best-effort
      await ensureAspectRatio(job);   // best-effort
      await ensureGenerateClicked(job);
      await waitForDownloadOrReady(job);
      await updateStatus(job.jobId, 'WAITING_DOWNLOAD', 'Flow đã bắt đầu tải video. Local Agent sẽ theo dõi file tải về.');
    } catch (error) {
      console.error('[Flow Automation Error]', error);
      await updateStatus(job.jobId, 'FAILED', error?.message || 'Tự động hóa Flow thất bại.');
    } finally {
      STATE.running = false;
      STATE.currentJobId = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PING_FLOW_CONTENT') {
      sendResponse?.({ ok: true, href: location.href });
      return true;
    }

    if (message?.type === 'RUN_FLOW_JOB') {
      runFlowJob(message.job);
      sendResponse?.({ ok: true, started: true });
      return true;
    }

    return false;
  });

  sendRuntimeMessage({ type: 'FLOW_CONTENT_READY', href: location.href });
  console.log('[Flow Automation] content-flow injected:', location.href);
})();
