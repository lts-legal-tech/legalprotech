import { NextResponse } from 'next/server';
import { applyFlowResultsAction } from '../../../../../lib/flow-job-store';

export async function POST(request) {
  try {
    const payload = await request.json();
    const data = await applyFlowResultsAction(payload || {});
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không thực hiện được action.' }, { status: 400 });
  }
}
