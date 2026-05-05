import { NextResponse } from 'next/server';
import { listRegistrations } from '../../../../lib/registration-store';

export async function GET() {
  try {
    return NextResponse.json({ success: true, registrations: listRegistrations() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không đọc được danh sách.' }, { status: 500 });
  }
}
