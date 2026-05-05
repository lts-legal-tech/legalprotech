import { NextResponse } from 'next/server';
import { updateRegistration } from '../../../../../../lib/registration-store';

export async function POST(_request, { params }) {
  const { id } = await params;
  const record = updateRegistration(id, (old) => ({
    ...old,
    status: 'active',
    entitlements: old.accountType === 'professional'
      ? { maxVideoCount: 10, canSelectFrame: true }
      : (old.entitlements || { maxVideoCount: 5, canSelectFrame: false }),
    reviewedAt: new Date().toISOString(),
  }));
  if (!record) return NextResponse.json({ success: false, error: 'Không tìm thấy hồ sơ.' }, { status: 404 });
  const clean = { ...record };
  delete clean.password;
  return NextResponse.json({ success: true, registration: clean, message: 'Đã duyệt tài khoản.' });
}
