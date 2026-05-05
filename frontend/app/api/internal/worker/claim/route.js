import { NextResponse } from 'next/server';
import { claimNextFlowJob } from '../../../../../lib/flow-job-store';

function isAllowed(request) {
  const key = process.env.WORKER_API_KEY || process.env.FLOW_WORKER_API_KEY || '';
  if (!key) return true;
  return request.headers.get('x-worker-key') === key;
}

export async function POST(request) {
  if (!isAllowed(request)) return NextResponse.json({ success: false, error: 'Sai WORKER_API_KEY.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const workerId = String(body?.workerId || 'windows-vps-worker');
  const job = await claimNextFlowJob(workerId);
  if (!job) return NextResponse.json({ success: true, job: null, message: 'Không có job mới.' });
  return NextResponse.json({ success: true, job });
}
