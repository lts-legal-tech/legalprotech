import { NextResponse } from 'next/server';
import { getResultsByToken } from '../../../../../lib/vps';

export async function GET(_request, { params }) {
  try {
    const token = params?.token;
    if (!token) return NextResponse.json({ error: 'Thiếu token.' }, { status: 400 });
    const data = await getResultsByToken(token);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Không lấy được kết quả.' }, { status: 502 });
  }
}
