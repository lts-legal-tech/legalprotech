import { NextResponse } from 'next/server';
import { createJob } from '../../../../../lib/vps';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const data = await createJob(formData);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Không tạo được job.' }, { status: 502 });
  }
}
