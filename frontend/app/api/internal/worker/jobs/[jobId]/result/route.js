import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { appendFlowResultRecords, saveFlowResultFile } from '../../../../../../../lib/flow-job-store';

function isAllowed(request) {
  const key = process.env.WORKER_API_KEY || process.env.FLOW_WORKER_API_KEY || '';
  if (!key) return true;
  return request.headers.get('x-worker-key') === key;
}

function contentTypeFromName(name = '', fallback = 'video/mp4') {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return fallback;
}

async function readLocalResultFile(localPath) {
  const resolved = path.resolve(String(localPath || ''));
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error('Đường dẫn kết quả không phải file.');
  if (stat.size <= 0) throw new Error('File kết quả rỗng.');
  return { bytes: await fs.readFile(resolved), resolved, size: stat.size };
}

export async function POST(request, { params }) {
  if (!isAllowed(request)) return NextResponse.json({ success: false, error: 'Sai WORKER_API_KEY.' }, { status: 401 });
  const { jobId } = await params;
  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();

      // Fast path for Windows/VPS worker: the Flow worker and Next app run on the same machine.
      // Instead of posting a large MP4 through multipart/form-data, send the local path and let
      // the Next process copy it into the result folder. This avoids large body/request failures.
      if (body?.localPath) {
        const { bytes, resolved, size } = await readLocalResultFile(body.localPath);
        const originalName = body.originalName || path.basename(resolved) || 'result.mp4';
        const { job, result, results, savedCount } = await saveFlowResultFile({
          jobId,
          bytes,
          originalName,
          mimeType: body.mimeType || contentTypeFromName(originalName, 'video/mp4'),
          prompt: String(body.prompt || ''),
          promptIndex: Number(body.promptIndex || 0),
          duration: Number(body.duration || 8),
          aspectRatio: String(body.aspectRatio || '16:9'),
          complete: Boolean(body.complete),
          jobSnapshot: body.jobSnapshot || null,
        });
        return NextResponse.json({ ...job, result, uploadedResults: results || [result].filter(Boolean), savedCount: savedCount || 1, uploadMode: 'local-path', uploadedBytes: size });
      }

      const job = await appendFlowResultRecords(jobId, body?.results || [], {
        complete: Boolean(body?.complete),
        message: body?.message,
        jobSnapshot: body?.jobSnapshot,
      });
      return NextResponse.json(job);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ success: false, error: 'Thiếu file kết quả.' }, { status: 400 });
    }
    let jobSnapshot = null;
    try {
      const rawSnapshot = formData.get('jobSnapshot');
      jobSnapshot = rawSnapshot ? JSON.parse(String(rawSnapshot)) : null;
    } catch {
      jobSnapshot = null;
    }

    const { job, result, results, savedCount } = await saveFlowResultFile({
      jobId,
      file,
      originalName: file.name,
      mimeType: file.type || 'video/mp4',
      prompt: String(formData.get('prompt') || ''),
      promptIndex: Number(formData.get('promptIndex') || 0),
      duration: Number(formData.get('duration') || 8),
      aspectRatio: String(formData.get('aspectRatio') || '16:9'),
      complete: String(formData.get('complete') || 'false') === 'true',
      jobSnapshot,
    });
    return NextResponse.json({ ...job, result, uploadedResults: results || [result].filter(Boolean), savedCount: savedCount || 1, uploadMode: 'multipart' });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không lưu được kết quả.' }, { status: 400 });
  }
}
