import { NextResponse } from 'next/server';
import { readFlowJob, normalizeJob, updateFlowJobStatus, FLOW_STATUSES } from '../../../../../lib/flow-job-store';

export async function GET(_request, { params }) {
  const { jobId } = await params;
  const job = await readFlowJob(jobId);
  if (!job) return NextResponse.json({ success: false, error: 'Không tìm thấy job AutoFlow.' }, { status: 404 });
  return NextResponse.json(normalizeJob(job));
}

export async function DELETE(_request, { params }) {
  const { jobId } = await params;
  const job = await updateFlowJobStatus(jobId, {
    status: FLOW_STATUSES.CANCELLED,
    message: 'User đã hủy job AutoFlow.',
  });
  if (!job) return NextResponse.json({ success: false, error: 'Không tìm thấy job AutoFlow.' }, { status: 404 });
  return NextResponse.json(job);
}
