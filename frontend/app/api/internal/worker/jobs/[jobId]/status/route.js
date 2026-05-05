import { NextResponse } from 'next/server';
import { updateFlowJobStatus } from '../../../../../../../lib/flow-job-store';

function isAllowed(request) {
  const key = process.env.WORKER_API_KEY || process.env.FLOW_WORKER_API_KEY || '';
  if (!key) return true;
  return request.headers.get('x-worker-key') === key;
}

export async function POST(request, { params }) {
  if (!isAllowed(request)) return NextResponse.json({ success: false, error: 'Sai WORKER_API_KEY.' }, { status: 401 });
  const { jobId } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const job = await updateFlowJobStatus(jobId, body || {});
    if (!job) return NextResponse.json({ success: false, error: 'Không tìm thấy job.' }, { status: 404 });
    return NextResponse.json(job);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không cập nhật được status.' }, { status: 400 });
  }
}
