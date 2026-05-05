'use client';
import { useState } from 'react';
import { Loader2, LockKeyhole, Mail, LogIn } from 'lucide-react';

const PROFILE_KEY = 'legalprotech-current-profile';
const ADMIN_KEY = 'legalprotech-admin-session';

export function LoginWorkspace({ compact = false, onSwitchRegister }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không đăng nhập được.');
      if (data.profile) {
        window.localStorage.setItem(PROFILE_KEY, JSON.stringify(data.profile));
      } else {
        window.localStorage.removeItem(PROFILE_KEY);
      }
      if (data.admin) {
        window.localStorage.setItem(ADMIN_KEY, JSON.stringify(data.admin));
        window.location.href = '/admin/registrations';
      } else {
        window.localStorage.removeItem(ADMIN_KEY);
        window.location.href = '/chatbot';
      }
    } catch (err) {
      setError(err.message || 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`auth-card rounded-[30px] ${compact ? 'p-6 md:p-7' : 'p-7 md:p-8'} app-fade`}>
      <div className="border-b border-slate-200/80 pb-4">
        <div className="glass-chip">Đăng nhập</div>
        <h1 className="mt-4 text-[34px] font-black tracking-[-0.04em] text-slate-950">Vào legalprotech</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-7 text-slate-700"></p>
      </div>
      <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-800">Email / Tài khoản</div>
          <div className="auth-field">
            <Mail className="auth-field-icon" />
            <input type="text" className="auth-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@gmail.com hoặc email đã đăng ký" required />
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-800">Mật khẩu</div>
          <div className="auth-field">
            <LockKeyhole className="auth-field-icon" />
            <input type="password" className="auth-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu" required />
          </div>
        </div>
        {error ? <div className="rounded-[18px] bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200/80">{error}</div> : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button className="btn-primary min-w-[220px]">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Đăng nhập</button>
          {onSwitchRegister ? (
            <button type="button" onClick={onSwitchRegister} className="text-sm font-semibold text-slate-700 underline underline-offset-4">Chưa có tài khoản? Đăng ký</button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
