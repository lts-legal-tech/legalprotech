import { getTokenRecord } from '../../../../../lib/mock-store';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') || '';
  const record = getTokenRecord(token);
  const body = JSON.stringify({ token, expiresAt: record?.expiresAt || null, results: record?.results || [] }, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${token || 'results'}.zip"`,
    },
  });
}
