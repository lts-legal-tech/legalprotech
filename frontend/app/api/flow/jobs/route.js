import { NextResponse } from 'next/server';
import { createFlowJobFromFormData, getRequestUserId } from '../../../../lib/flow-job-store';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const headerUserId = getRequestUserId(request);
    if (headerUserId && !formData.get('user_id')) formData.set('user_id', headerUserId);
    const job = await createFlowJobFromFormData(formData);
    return NextResponse.json(job, { status: 200 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không tạo được job AutoFlow.' }, { status: 400 });
  }
}
