import { NextResponse } from 'next/server';
import { appendFlowResultRecords, saveFlowResultFile } from '../../../../../../../lib/flow-job-store';

function isAllowed(request) {
  const key = process.env.WORKER_API_KEY || process.env.FLOW_WORKER_API_KEY || '';
  if (!key) return true;
  return request.headers.get('x-worker-key') === key;
}

export async function POST(request, { params }) {
  if (!isAllowed(request)) return NextResponse.json({ success: false, error: 'Sai WORKER_API_KEY.' }, { status: 401 });
  const { jobId } = await params;
  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();
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

    const { job, result } = await saveFlowResultFile({
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
    return NextResponse.json({ ...job, result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không lưu được kết quả.' }, { status: 400 });
  }
}
