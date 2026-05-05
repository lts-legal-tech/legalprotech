import { NextResponse } from 'next/server';
import { postResultsAction } from '../../../../../lib/vps';

export async function POST(request) {
  try {
    const payload = await request.json();
    const data = await postResultsAction(payload);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Không gửi được action.' }, { status: 502 });
  }
}
