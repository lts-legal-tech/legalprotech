import { NextResponse } from 'next/server';
import { saveAutomationResult, upsertAutomationJob } from '../../../../lib/local-automation-store';

export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get('file');
  const jobId = String(formData.get('jobId') || '').trim();
  const prompt = String(formData.get('prompt') || '');
  const aspectRatio = String(formData.get('aspectRatio') || '16:9');
  const duration = Number(formData.get('duration') || 8);

  if (!jobId) {
    return NextResponse.json({ error: 'Thiếu jobId.' }, { status: 400 });
  }
  if (!file || typeof file.arrayBuffer !== 'function') {
    await upsertAutomationJob(jobId, { status: 'FAILED', message: 'Thiếu file upload từ Local Agent.' });
    return NextResponse.json({ error: 'Thiếu file upload.' }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await saveAutomationResult({
    jobId,
    originalName: file.name || 'result.mp4',
    bytes,
    mimeType: file.type || 'video/mp4',
    prompt,
    aspectRatio,
    duration,
  });

  return NextResponse.json({ success: true, result });
}
