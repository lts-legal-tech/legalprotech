import { NextResponse } from 'next/server';
import { readFlowJob, normalizeJob, updateFlowJobStatus, FLOW_STATUSES, getRequestAccess, userCanAccessFlowJob } from '../../../../../lib/flow-job-store';

export async function GET(request, { params }) {
  const { jobId } = await params;
  const job = await readFlowJob(jobId);
  if (!job) return NextResponse.json({ success: false, error: 'Không tìm thấy job AutoFlow.' }, { status: 404 });
  if (!userCanAccessFlowJob(job, getRequestAccess(request))) {
    return NextResponse.json({ success: false, error: 'Không có quyền xem job của user khác.' }, { status: 403 });
  }
  return NextResponse.json(normalizeJob(job));
}

export async function DELETE(request, { params }) {
  const { jobId } = await params;
  const existing = await readFlowJob(jobId);
  if (!existing) return NextResponse.json({ success: false, error: 'Không tìm thấy job AutoFlow.' }, { status: 404 });
  if (!userCanAccessFlowJob(existing, getRequestAccess(request))) {
    return NextResponse.json({ success: false, error: 'Không có quyền hủy job của user khác.' }, { status: 403 });
  }
  const job = await updateFlowJobStatus(jobId, {
    status: FLOW_STATUSES.CANCELLED,
    message: 'User đã hủy job AutoFlow.',
  });
  if (!job) return NextResponse.json({ success: false, error: 'Không tìm thấy job AutoFlow.' }, { status: 404 });
  return NextResponse.json(job);
}
