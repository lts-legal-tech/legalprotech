import { NextResponse } from 'next/server';
import { listRegistrations } from '../../../../lib/registration-store';

export async function POST(request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Thiếu email hoặc mật khẩu.' }, { status: 400 });
    }

    if (String(email).toLowerCase() === 'admin@gmail.com' && password === '12345') {
      return NextResponse.json({
        success: true,
        admin: { loggedIn: true, username: 'admin@gmail.com', role: 'admin' },
        profile: null,
      });
    }

    const registrations = listRegistrations();
    const user = registrations.find((item) => String(item.email || '').toLowerCase() === String(email).toLowerCase());

    if (!user) {
      return NextResponse.json({ success: false, error: 'Tài khoản không tồn tại.' }, { status: 404 });
    }

    if (user.password !== password) {
      return NextResponse.json({ success: false, error: 'Sai mật khẩu.' }, { status: 401 });
    }

    if (user.status !== 'active') {
      return NextResponse.json(
        {
          success: false,
          error: user.status === 'pending_admin_review'
            ? 'Tài khoản đang chờ admin duyệt.'
            : user.status === 'rejected'
              ? 'Tài khoản đã bị từ chối.'
              : 'Tài khoản chưa sẵn sàng đăng nhập.',
        },
        { status: 403 }
      );
    }

    const profile = { ...user };
    delete profile.password;

    return NextResponse.json({ success: true, profile });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không đăng nhập được.' }, { status: 500 });
  }
}
