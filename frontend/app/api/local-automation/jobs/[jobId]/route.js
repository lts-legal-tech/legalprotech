import { NextResponse } from 'next/server';
import { readAutomationJob, upsertAutomationJob } from '../../../../../lib/local-automation-store';

export async function GET(_request, { params }) {
  const { jobId } = await params;
  const job = await readAutomationJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job automation.' }, { status: 404 });
  }
  return NextResponse.json(job);
}

export async function POST(request, { params }) {
  const { jobId } = await params;
  const body = await request.json().catch(() => ({}));
  const job = await upsertAutomationJob(jobId, body || {});
  return NextResponse.json({ success: true, job });
}
