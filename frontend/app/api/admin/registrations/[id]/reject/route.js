import { NextResponse } from 'next/server';
import { updateRegistration } from '../../../../../../lib/registration-store';

export async function POST(_request, { params }) {
  const { id } = await params;
  const record = updateRegistration(id, (old) => ({ ...old, status: 'rejected', reviewedAt: new Date().toISOString() }));
  if (!record) return NextResponse.json({ success: false, error: 'Không tìm thấy hồ sơ.' }, { status: 404 });
  return NextResponse.json({ success: true, registration: record, message: 'Đã từ chối hồ sơ.' });
}
