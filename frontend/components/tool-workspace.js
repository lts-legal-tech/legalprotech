'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, Copy, Loader2, Upload } from 'lucide-react';
import { ResultsList } from './results-list';
import { createJob as createImageJob, getJobStatus as getImageJobStatus, postResultsAction } from '../lib/vps';
import { createFlowJob, getFlowJobStatus, postFlowResultsAction, splitPromptLines } from '../lib/flow-client';

const imageAspectOptions = ['16:9', '4:3', '1:1', '3:4', '9:16'];
const legacyAspectOptions = ['1:1', '4:5', '16:9', '9:16'];
const videoAspectOptions = ['9:16', '16:9'];
const imageToVideoDurationOptions = ['4', '6', '8'];
const frameOptions = ['Frames', 'Ingredients'];
const PROFILE_KEY = 'legalprotech-current-profile';

function fileToPreview(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function shortMessage(lines) {
  if (!lines.length) return 'Chưa có prompt.';
  return lines.length === 1 ? lines[0] : `${lines.length} prompt đã sẵn sàng cho AutoFlow.`;
}

async function copyText(value) {
  if (!navigator?.clipboard) return false;
  await navigator.clipboard.writeText(value);
  return true;
}

function clampNumber(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(numeric, max));
}

function SegmentedOptions({ options, value, onChange, columns = 5 }) {
  const gridClass = columns === 5 ? 'grid-cols-5' : columns === 4 ? 'grid-cols-4' : columns === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className={`grid gap-2 ${gridClass}`}>
      {options.map((item) => {
        const active = String(item) === String(value);
        return (
          <button
            key={item}
            type="button"
            onClick={() => onChange(String(item))}
            className={`rounded-2xl border px-3 py-3 text-sm font-medium transition ${active ? 'border-slate-900 bg-slate-900 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
          >
            {columns === 4 && /^[1-4]$/.test(String(item)) ? `x${item}` : item}
          </button>
        );
      })}
    </div>
  );
}

export function ToolWorkspace({ tool }) {
  const [prompt, setPrompt] = useState(tool.defaults.prompt);
  const [model, setModel] = useState(tool.defaults.model);
  const [aspectRatio, setAspectRatio] = useState(tool.defaults.aspectRatio);
  const [duration, setDuration] = useState(tool.defaults.duration || '8');
  const [count, setCount] = useState(tool.defaults.count || String(tool.expectedCount || 4));
  const [videosPerPrompt, setVideosPerPrompt] = useState(tool.defaults.videosPerPrompt || '1');
  const [frame, setFrame] = useState('Frames');
  const [profile, setProfile] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [endImageFile, setEndImageFile] = useState(null);
  const [endImagePreview, setEndImagePreview] = useState('');
  const [jobId, setJobId] = useState('');
  const [statusText, setStatusText] = useState('Sẵn sàng gửi request');
  const [jobState, setJobState] = useState('idle');
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [zipUrl, setZipUrl] = useState('');
  const [results, setResults] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PROFILE_KEY);
      if (raw) setProfile(JSON.parse(raw));
    } catch { }
  }, []);

  useEffect(() => {
    setPrompt(tool.defaults.prompt);
    setModel(tool.defaults.model);
    setAspectRatio(tool.defaults.aspectRatio);
    setDuration(tool.defaults.duration || '8');
    setCount(tool.defaults.count || String(tool.expectedCount || 4));
    setVideosPerPrompt(tool.defaults.videosPerPrompt || '1');
    setFrame(tool.slug === 'image-to-video' ? 'Frames' : 'Auto');
    setImageFile(null);
    setImagePreview('');
    setEndImageFile(null);
    setEndImagePreview('');
    setJobId('');
    setStatusText('Sẵn sàng gửi request');
    setJobState('idle');
    setError('');
    setToken('');
    setExpiresAt('');
    setZipUrl('');
    setResults([]);
    setActionLoading(false);
    setCopiedPrompt(false);
  }, [tool.slug]);

  const requiresImage = tool.inputMode === 'image+text';
  const isImageToVideo = tool.slug === 'image-to-video';
  const isVideo = tool.outputType === 'video';
  const usesFlow = Boolean(tool.useFlow || isVideo);
  const isFlowImage = usesFlow && !isVideo;
  const maxVideoCount = profile?.entitlements?.maxVideoCount || tool.expectedCount || 10;
  const maxImagePromptCount = 4;
  const promptLines = useMemo(() => splitPromptLines(prompt), [prompt]);
  const promptCount = promptLines.length;
  const videosPerPromptNumber = clampNumber(videosPerPrompt || 1, 1, 4, 1);
  const imagePerPromptNumber = clampNumber(count || 1, 1, 4, 1);
  const expectedFlowTotal = isVideo ? promptCount * videosPerPromptNumber : promptCount * imagePerPromptNumber;

  async function handleFileChange(e) {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    if (!file) {
      setImagePreview('');
      return;
    }
    setImagePreview(await fileToPreview(file));
  }

  async function handleEndFileChange(e) {
    const file = e.target.files?.[0] || null;
    setEndImageFile(file);
    if (!file) {
      setEndImagePreview('');
      return;
    }
    setEndImagePreview(await fileToPreview(file));
  }

  async function pollImageJob(nextJobId) {
    if (!nextJobId) throw new Error('Backend chưa trả về jobId hợp lệ. Kiểm tra lại API key hoặc VPS_API_BASE_URL.');
    let attempts = 0;
    while (attempts < 180) {
      const data = await getImageJobStatus(nextJobId);
      setStatusText(data.message || 'Đang xử lý...');
      if (data.status === 'COMPLETED') {
        setJobState('done');
        setToken(data.token || '');
        setExpiresAt(data.expiresAt || '');
        setZipUrl(data.zipUrl || '');
        setResults(Array.isArray(data.results) ? data.results : []);
        return;
      }
      if (data.status === 'FAILED') throw new Error(data.error || 'Job thất bại.');
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 2200));
    }
    throw new Error('Job quá lâu. Hãy kiểm tra VPS hoặc model bên thứ ba.');
  }

  async function pollFlowJob(nextJobId) {
    if (!nextJobId) throw new Error('Backend chưa trả về jobId AutoFlow hợp lệ.');
    let attempts = 0;
    while (attempts < 720) {
      const data = await getFlowJobStatus(nextJobId);
      setStatusText(data.message || 'Windows VPS Worker đang xử lý...');
      if (data.token) setToken(data.token);
      if (data.expiresAt) setExpiresAt(data.expiresAt);
      if (data.zipUrl) setZipUrl(data.zipUrl);
      if (Array.isArray(data.results) && data.results.length > 0) setResults(data.results);
      if (data.status === 'COMPLETED') {
        setJobState('done');
        return;
      }
      if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(data.status)) {
        throw new Error(data.error || data.message || 'AutoFlow thất bại.');
      }
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    throw new Error('AutoFlow quá lâu hoặc Worker không gửi heartbeat. Kiểm tra Windows VPS Worker.');
  }

  async function handleFlowSubmit() {
    if (promptCount === 0) {
      setError('Vui lòng nhập ít nhất 1 prompt.');
      return;
    }
    if (isVideo && expectedFlowTotal > maxVideoCount) {
      setError(`Tối đa ${maxVideoCount} video mỗi lần. Hiện tại: ${promptCount} prompt × ${videosPerPromptNumber} = ${expectedFlowTotal} video.`);
      return;
    }
    if (isFlowImage && expectedFlowTotal > maxImagePromptCount) {
      setError(`Tối đa ${maxImagePromptCount} ảnh mỗi lần. Hiện tại: ${promptCount} prompt × ${imagePerPromptNumber} = ${expectedFlowTotal} ảnh.`);
      return;
    }
    if (requiresImage && !imageFile) {
      setError(isImageToVideo ? 'Vui lòng tải ảnh điểm đầu.' : 'Tool này cần ảnh đầu vào.');
      return;
    }

    setJobState('loading');
    setStatusText(isFlowImage ? 'Đang gửi lệnh tạo ảnh sang Windows VPS AutoFlow Image Worker.' : isImageToVideo ? 'Đang gửi lệnh image-to-video sang Windows VPS AutoFlow Veo 3.1 Fast (lower priority).' : 'Đang gửi lệnh text-to-video lên Windows VPS AutoFlow Video Worker.');
    setError('');
    setResults([]);
    setToken('');
    setZipUrl('');
    setExpiresAt('');
    setJobId('');

    const promptPayload = promptLines.join('\n');
    await copyText(promptPayload).then(() => setCopiedPrompt(true)).catch(() => setCopiedPrompt(false));

    try {
      const formData = new FormData();
      formData.append('tool', tool.slug);
      formData.append('model', model);
      formData.append('aspect_ratio', aspectRatio);
      formData.append('output_type', isFlowImage ? 'image' : 'video');
      formData.append('prompt', promptPayload);
      formData.append('videos_per_prompt', isVideo ? String(videosPerPromptNumber) : '1');
      formData.append('count', String(expectedFlowTotal));
      if (isFlowImage) formData.append('count_per_prompt', String(imagePerPromptNumber));
      formData.append('duration', String(Number(duration || 8)));
      formData.append('frame', frame);
      if (imageFile) formData.append('image', imageFile);
      if (isImageToVideo && endImageFile) formData.append('end_image', endImageFile);

      const data = await createFlowJob(formData);
      if (!data?.jobId) throw new Error(data?.message || data?.error || 'Backend chưa trả về jobId AutoFlow.');
      setJobId(data.jobId);
      setToken(data.token || '');
      setExpiresAt(data.expiresAt || '');
      setZipUrl(data.zipUrl || '');
      setStatusText(data.message || 'Đã tạo job. Windows VPS Worker sẽ tự claim và chạy Flow.');
      await pollFlowJob(data.jobId);
    } catch (err) {
      setJobState('error');
      setStatusText('Có lỗi');
      setError(err.message || 'Không khởi động được luồng AutoFlow trên Windows VPS.');
    }
  }

  async function handleImageSubmit() {
    try {
      setJobState('loading');
      setStatusText('Đang đẩy request sang VPS...');
      const formData = new FormData();
      formData.append('tool', tool.slug);
      formData.append('model', model);
      formData.append('aspect_ratio', aspectRatio);
      formData.append('prompt', prompt);
      formData.append('count', count);
      if (imageFile) formData.append('image', imageFile);
      const data = await createImageJob(formData);
      if (!data?.jobId) throw new Error(data?.message || data?.error || 'Backend chưa trả về jobId.');
      setJobId(data.jobId);
      setStatusText(data.message || 'VPS đã nhận job.');
      await pollImageJob(data.jobId);
    } catch (err) {
      setJobState('error');
      setStatusText('Có lỗi');
      setError(err.message || 'Đã có lỗi xảy ra.');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setResults([]);
    setToken('');
    setExpiresAt('');
    setZipUrl('');
    setJobId('');
    if (!String(prompt || '').trim()) {
      setError('Vui lòng nhập prompt.');
      return;
    }
    if (usesFlow) return handleFlowSubmit();
    return handleImageSubmit();
  }

  async function handleBatchAction(action) {
    if (!token && !jobId) return null;
    try {
      setActionLoading(true);
      const data = usesFlow
        ? await postFlowResultsAction({ token, jobId, action })
        : await postResultsAction({ token, action });
      if (action === 'delete_all') setResults([]);
      if (data.expiresAt) setExpiresAt(data.expiresAt);
      if (data.zipUrl) setZipUrl(data.zipUrl);
      setStatusText(data.message || 'Đã thực hiện action.');
      return data;
    } catch (err) {
      setError(err.message || 'Không thực hiện được action.');
      return null;
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="grid gap-6 2xl:grid-cols-[0.9fr_1.1fr]">
      <div className="panel rounded-[30px] p-4 md:p-5">
        <div className="border-b border-slate-200 pb-4">
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">{tool.label}</div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">{tool.shortLabel}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{tool.description}</p>
          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">
            {isFlowImage ? (
              <>Luồng ảnh chạy qua <b>Windows VPS AutoFlow Worker</b>, thao tác đúng giao diện Flow Web: tab <b>Image</b>, tỷ lệ <b>16:9 / 4:3 / 1:1 / 3:4 / 9:16</b>, số ảnh <b>x1–x4</b> và đúng model <b>Nano Banana 2 / Nano Banana Pro / Imagen 4</b>.</>
            ) : isImageToVideo ? (
              <>Luồng image-to-video chạy qua <b>Windows VPS AutoFlow Worker</b>, thao tác đúng giao diện Flow Web: tab <b>Video</b> → <b>Frames</b>, model <b>Veo 3.1 - Fast [Lower Priority] (leaving 5/10)</b>, tỷ lệ <b>9:16 / 16:9</b>, số video <b>x1–x4</b>, thời lượng <b>4s / 6s / 8s</b>, và dùng <b>ảnh điểm đầu + ảnh điểm cuối</b>.</>
            ) : (
              <>Luồng text-to-video chạy qua <b>Windows VPS AutoFlow Worker</b>, thao tác đúng giao diện Flow Web: tab <b>Video</b>, model <b>Veo 3.1 - Fast [Lower Priority] (leaving 5/10)</b>, tỷ lệ <b>9:16 / 16:9</b>, số video <b>x1–x4</b> và thời lượng <b>4s / 6s / 8s</b>.</>
            )}
          </div>
        </div>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {requiresImage && (
            isImageToVideo ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <div className="mb-2 text-sm text-slate-700">Ảnh điểm đầu</div>
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-4">
                    <input id="upload-input-start" type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                    <label htmlFor="upload-input-start" className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      <Upload className="h-4 w-4" /> Tải ảnh điểm đầu
                    </label>
                    {imagePreview ? <img src={imagePreview} alt="start preview" className="mt-4 h-56 w-full rounded-2xl object-cover" /> : <div className="mt-4 flex h-56 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-400">Start frame</div>}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm text-slate-700">Ảnh điểm cuối (tuỳ chọn)</div>
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-4">
                    <input id="upload-input-end" type="file" accept="image/*" onChange={handleEndFileChange} className="hidden" />
                    <label htmlFor="upload-input-end" className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      <Upload className="h-4 w-4" /> Tải ảnh điểm cuối
                    </label>
                    {endImagePreview ? <img src={endImagePreview} alt="end preview" className="mt-4 h-56 w-full rounded-2xl object-cover" /> : <div className="mt-4 flex h-56 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-400">End frame</div>}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-2 text-sm text-slate-700">Ảnh đầu vào</div>
                <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-4">
                  <input id="upload-input" type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                  <label htmlFor="upload-input" className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <Upload className="h-4 w-4" /> Tải ảnh lên
                  </label>
                  {imagePreview && <img src={imagePreview} alt="preview" className="mt-4 h-56 w-full rounded-2xl object-cover" />}
                </div>
              </div>
            )
          )}
          <div>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm text-slate-700">
              <span>Prompt</span>
              <span className="text-xs text-slate-500">
                {isVideo ? `${promptCount} prompt × ${videosPerPromptNumber} video = ${expectedFlowTotal}/${maxVideoCount} video` : `${promptCount} prompt × ${imagePerPromptNumber} ảnh = ${expectedFlowTotal}/${maxImagePromptCount} ảnh`}
              </span>
            </div>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="input-light min-h-40 resize-none" />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs leading-6 text-slate-500">
              <span>{isVideo ? 'Mỗi dòng là 1 prompt. Có thể chọn 1–4 video cho mỗi prompt.' : `Mỗi dòng là 1 prompt. Flow sẽ chọn đúng x${imagePerPromptNumber} trên web cho mỗi dòng, tối đa ${maxImagePromptCount} ảnh/lần.`}</span>
              <button type="button" onClick={() => copyText(promptLines.join('\n')).then(() => setCopiedPrompt(true))} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">
                <Copy className="h-3 w-3" /> Copy prompt
              </button>
              {copiedPrompt ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Đã copy</span> : null}
            </div>
          </div>

          {isFlowImage ? (
            <div className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Tỷ lệ ảnh</div>
                <SegmentedOptions options={imageAspectOptions} value={aspectRatio} onChange={setAspectRatio} columns={5} />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Số ảnh / prompt</div>
                <SegmentedOptions options={['1', '2', '3', '4']} value={String(imagePerPromptNumber)} onChange={setCount} columns={4} />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Model</div>
                <select value={model} onChange={(e) => setModel(e.target.value)} className="input-light bg-white">
                  {tool.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
            </div>
          ) : isVideo ? (
            <div className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Tỷ lệ video</div>
                <SegmentedOptions options={videoAspectOptions} value={aspectRatio} onChange={setAspectRatio} columns={2} />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Số video / prompt</div>
                <SegmentedOptions options={['1', '2', '3', '4']} value={String(videosPerPrompt)} onChange={setVideosPerPrompt} columns={4} />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Model</div>
                <select value={model} onChange={(e) => setModel(e.target.value)} className="input-light bg-white">
                  {tool.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Thời lượng</div>
                <SegmentedOptions options={imageToVideoDurationOptions} value={String(duration)} onChange={setDuration} columns={3} />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              <div>
                <div className="mb-2 text-sm text-slate-700">Model</div>
                <select value={model} onChange={(e) => setModel(e.target.value)} className="input-light">
                  {tool.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
              <div>
                <div className="mb-2 text-sm text-slate-700">Tỷ lệ</div>
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="input-light">
                  {legacyAspectOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="grid gap-3 xl:grid-cols-2">
            {isImageToVideo ? (
              <>
                <div>
                  <div className="mb-2 text-sm text-slate-700">Khung tạo video</div>
                  <select value={frame} onChange={(e) => setFrame(e.target.value)} className="input-light">
                    {frameOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
                <div>
                  <div className="mb-2 text-sm text-slate-700">Tổng video dự kiến</div>
                  <div className="input-light flex items-center">{promptCount || 0} prompt × {videosPerPromptNumber} video = {expectedFlowTotal}/{maxVideoCount} video</div>
                  <div className="mt-1 text-xs text-slate-500">Ảnh điểm cuối là tuỳ chọn. Nếu có, Worker sẽ cố upload thêm End frame.</div>
                </div>
              </>
            ) : isVideo ? (
              <>
                <div>
                  <div className="mb-2 text-sm text-slate-700">Setting video đang chọn</div>
                  <div className="input-light flex items-center">{aspectRatio} · x{videosPerPromptNumber} · {duration}s</div>
                </div>
                <div>
                  <div className="mb-2 text-sm text-slate-700">Tổng video dự kiến</div>
                  <div className="input-light flex items-center">{promptCount || 0} prompt × {videosPerPromptNumber} video = {expectedFlowTotal}/{maxVideoCount} video</div>
                </div>
              </>
            ) : isFlowImage ? (
              <div>
                <div className="mb-2 text-sm text-slate-700">Giới hạn tạo ảnh</div>
                <div className="input-light flex items-center">{promptCount || 0} prompt × {imagePerPromptNumber} ảnh = {expectedFlowTotal}/{maxImagePromptCount} ảnh</div>
              </div>
            ) : (
              <div>
                <div className="mb-2 text-sm text-slate-700">Số lượng</div>
                <select value={count} onChange={(e) => setCount(e.target.value)} className="input-light">
                  {['1', '2', '3', '4'].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            )}
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 xl:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-slate-600">Trạng thái</div>
                <div className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
                  {isFlowImage ? 'Flow Image · Nano Banana' : isImageToVideo ? 'Flow Image to Video · Veo 3.1 Fast' : isVideo ? 'Flow Video · Veo 3.1 Fast' : 'Windows VPS AutoFlow'}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-800">
                {jobState === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
                {statusText || shortMessage(promptLines)}
              </div>
              {jobId && <div className="mt-2 text-xs text-slate-400">Job ID: {jobId}</div>}
            </div>
          </div>
          {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
          <button className="btn-primary w-full">{jobState === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} {isImageToVideo ? 'Tạo image to video' : isVideo ? 'Tạo video' : isFlowImage ? 'Tạo ảnh bằng Nano Banana' : 'Tạo nội dung'}</button>
        </form>
      </div>
      <ResultsList results={results} token={token} expiresAt={expiresAt} zipUrl={zipUrl} actionLoading={actionLoading} jobState={jobState} statusText={statusText} onAction={handleBatchAction} />
    </div>
  );
}
