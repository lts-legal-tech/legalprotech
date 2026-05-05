import { buildFlowJobZip, readFlowJob } from '../../../../../../lib/flow-job-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const { jobId } = await params;
  const job = await readFlowJob(jobId);
  if (!job) return new Response('Không tìm thấy job.', { status: 404 });
  // BUG FIX: Add Content-Length so browsers show download progress and trigger correctly.
  const body = await buildFlowJobZip(jobId);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${jobId}-results.zip"`,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    },
  });
}
