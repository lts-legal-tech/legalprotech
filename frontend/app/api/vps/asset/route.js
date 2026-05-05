import { NextResponse } from 'next/server';

const headers = () => {
  const h = {};
  if (process.env.VPS_API_KEY) h['x-api-key'] = process.env.VPS_API_KEY;
  return h;
};

function resolveTarget(searchParams) {
  const directUrl = searchParams.get('url');
  const path = searchParams.get('path');
  const base = String(process.env.VPS_API_BASE_URL || '').replace(/\/$/, '');
  if (directUrl) return directUrl;
  if (path?.startsWith('/')) return `${base}${path}`;
  return '';
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const target = resolveTarget(searchParams);
    if (!target) return NextResponse.json({ error: 'Thiếu url hoặc path.' }, { status: 400 });

    const upstream = await fetch(target, {
      headers: headers(),
      cache: 'no-store',
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Không tải được file từ backend nội bộ.' }, { status: upstream.status || 502 });
    }

    const responseHeaders = new Headers();
    const contentType = upstream.headers.get('content-type');
    const contentDisposition = upstream.headers.get('content-disposition');
    const contentLength = upstream.headers.get('content-length');
    if (contentType) responseHeaders.set('content-type', contentType);
    if (contentDisposition) responseHeaders.set('content-disposition', contentDisposition);
    if (contentLength) responseHeaders.set('content-length', contentLength);
    responseHeaders.set('cache-control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Không proxy được file nội bộ.' }, { status: 500 });
  }
}
