import { NextResponse } from 'next/server';
import { getFlowResultsByToken } from '../../../../../lib/flow-job-store';

export async function GET(_request, { params }) {
  const { token } = await params;
  const data = await getFlowResultsByToken(token);
  if (!data) return NextResponse.json({ success: false, error: 'Token không tồn tại hoặc đã hết hạn.' }, { status: 404 });
  return NextResponse.json(data);
}
