import { NextResponse } from 'next/server';
import { getJobStatus } from '../../../../../lib/vps';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    if (!jobId || jobId === 'undefined') {
      return NextResponse.json({ error: 'Thiếu jobId hợp lệ.' }, { status: 400 });
    }
    const data = await getJobStatus(jobId);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Không đọc được trạng thái job.' }, { status: 502 });
  }
}
