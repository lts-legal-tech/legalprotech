import { NextResponse } from 'next/server';
import { createRegistration, findRegistrationByEmail } from '../../../../lib/registration-store';
import { getAccountConfig } from '../../../../lib/account-types';

async function fileToDataUrl(file) {
  if (!file) return '';
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const accountType = String(formData.get('accountType') || '');
    const cfg = getAccountConfig(accountType);
    if (!accountType) {
      return NextResponse.json({ success: false, error: 'Thiếu loại tài khoản.' }, { status: 400 });
    }
    if (!cfg) {
      return NextResponse.json({ success: false, error: 'Loại tài khoản không hợp lệ.' }, { status: 400 });
    }

    const fullName = String(formData.get('fullName') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');
    if (!fullName || !email || !password) {
      return NextResponse.json({ success: false, error: 'Thiếu thông tin bắt buộc.' }, { status: 400 });
    }

    if (findRegistrationByEmail(email)) {
      return NextResponse.json({ success: false, error: 'Email đã tồn tại.' }, { status: 409 });
    }

    const fields = {};
    for (const key of cfg.requires) {
      const value = String(formData.get(key) || '').trim();
      if (!value) {
        return NextResponse.json({ success: false, error: `Thiếu trường bắt buộc: ${key}` }, { status: 400 });
      }
      fields[key] = value;
    }

    let lawyerCardImage = '';
    if (accountType === 'licensed_lawyer') {
      const file = formData.get('lawyerCardImage');
      if (!file || typeof file === 'string') {
        return NextResponse.json({ success: false, error: 'Thiếu ảnh thẻ hành nghề luật sư.' }, { status: 400 });
      }
      lawyerCardImage = await fileToDataUrl(file);
    }

    const record = createRegistration({
      fullName,
      email,
      password,
      accountType,
      accountLabel: cfg.label,
      status: cfg.status,
      fields,
      lawyerCardImage,
      entitlements: cfg.entitlements,
    });

    return NextResponse.json({
      success: true,
      registration: (() => { const clean = { ...record }; delete clean.password; return clean; })(),
      message: cfg.status === 'pending_admin_review'
        ? (accountType === 'professional'
            ? 'Đã gửi đăng ký tài khoản chuyên nghiệp. Chờ admin duyệt kích hoạt.'
            : 'Đã gửi đăng ký. Chờ admin duyệt hồ sơ.')
        : 'Đã tạo tài khoản thành công.',
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không tạo được tài khoản.' }, { status: 500 });
  }
}
