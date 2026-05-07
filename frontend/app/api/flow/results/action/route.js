import { NextResponse } from 'next/server';
import { applyFlowResultsAction, getRequestAccess } from '../../../../../lib/flow-job-store';

export async function POST(request) {
  try {
    const payload = await request.json();
    const access = getRequestAccess(request);
    const data = await applyFlowResultsAction({ ...(payload || {}), user_id: payload?.user_id || access.userId, token: payload?.token || access.token });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không thực hiện được action.' }, { status: 400 });
  }
}
