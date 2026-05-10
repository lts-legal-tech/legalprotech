import { NextResponse } from 'next/server';
import { getRequestUserId, listFlowVideoLibraryForUser } from '../../../../lib/flow-job-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const userId = getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Thiếu user_id.' }, { status: 401 });
    }
    const data = await listFlowVideoLibraryForUser(userId);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không tải được My Product.' }, { status: 400 });
  }
}
