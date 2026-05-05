'use client';
import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';

const ADMIN_SESSION_KEY = 'legalprotech-admin-session';

export function AdminLoginWorkspace() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('12345');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (username !== 'admin' || password !== '12345') {
        throw new Error('Sai tài khoản hoặc mật khẩu admin.');
      }
      window.localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
        loggedIn: true,
        username: 'admin',
        role: 'admin',
      }));
      window.location.href = '/admin/registrations';
    } catch (err) {
      setError(err.message || 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel rounded-[32px] p-6 md:p-8 app-fade">
      <div className="mx-auto max-w-xl">
        <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">Admin login</div>
        <div className="mt-6 flex items-center gap-3 text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-base font-bold text-white shadow-lg shadow-slate-200">LP</span>
          legalprotech
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          Đăng nhập backend admin để duyệt hồ sơ luật sư chính thức. Tài khoản mặc định hiện tại là <strong>admin</strong>, mật khẩu <strong>12345</strong>.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 grid gap-4">
          <div>
            <div className="mb-2 text-sm text-slate-700">Tài khoản admin</div>
            <input className="input-light" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <div className="mb-2 text-sm text-slate-700">Mật khẩu</div>
            <input type="password" className="input-light" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          <button className="btn-primary min-w-[220px]">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Đăng nhập admin
          </button>
        </form>
      </div>
    </section>
  );
}
