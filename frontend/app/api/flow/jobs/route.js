import { NextResponse } from 'next/server';
import { createFlowJobFromFormData } from '../../../../lib/flow-job-store';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const job = await createFlowJobFromFormData(formData);
    return NextResponse.json(job, { status: 200 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không tạo được job AutoFlow.' }, { status: 400 });
  }
}
