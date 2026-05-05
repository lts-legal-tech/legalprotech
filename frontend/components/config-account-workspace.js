'use client';

import { useEffect, useMemo, useState } from 'react';

const initialForm = {
  adminKey: '',
  email: '',
  password: '',
  autoLoginEnabled: true,
};

export default function ConfigAccountWorkspace() {
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [current, setCurrent] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const canLoad = useMemo(() => form.adminKey.trim().length > 0, [form.adminKey]);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function loadConfig() {
    if (!canLoad) {
      setStatus('Nhập mã quản trị trước khi tải cấu hình.');
      return;
    }

    setLoading(true);
    setStatus('Đang tải cấu hình...');
    try {
      const response = await fetch('/api/configaccount', {
        headers: {
          'x-config-key': form.adminKey.trim(),
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Không tải được cấu hình.');

      setCurrent(data.config || null);
      setForm((prev) => ({
        ...prev,
        email: data.config?.email || '',
        password: '',
        autoLoginEnabled: data.config?.autoLoginEnabled !== false,
      }));
      setStatus('Đã tải cấu hình hiện tại. Mật khẩu không hiển thị lại vì lý do bảo mật.');
    } catch (error) {
      setStatus(error.message || 'Không tải được cấu hình.');
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig(event) {
    event.preventDefault();
    if (!form.adminKey.trim()) {
      setStatus('Thiếu mã quản trị.');
      return;
    }
    if (!form.email.trim()) {
      setStatus('Thiếu email Google Ultra.');
      return;
    }
    if (!form.password.trim() && !current?.hasPassword) {
      setStatus('Thiếu mật khẩu. Nếu đã lưu mật khẩu trước đó thì có thể để trống để giữ nguyên.');
      return;
    }

    setLoading(true);
    setStatus('Đang lưu cấu hình...');
    try {
      const response = await fetch('/api/configaccount', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-config-key': form.adminKey.trim(),
        },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          autoLoginEnabled: form.autoLoginEnabled,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Không lưu được cấu hình.');

      setCurrent(data.config || null);
      setForm((prev) => ({ ...prev, password: '' }));
      setStatus('Đã lưu. Worker sẽ dùng tài khoản này ở lần chạy tiếp theo. Nếu Google hỏi captcha/2FA, anh xử lý thủ công một lần trong Chrome Worker.');
    } catch (error) {
      setStatus(error.message || 'Không lưu được cấu hình.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const savedKey = window.localStorage.getItem('legalprotech_config_admin_key');
    if (savedKey) setForm((prev) => ({ ...prev, adminKey: savedKey }));
  }, []);

  function rememberAdminKey() {
    if (!form.adminKey.trim()) return;
    window.localStorage.setItem('legalprotech_config_admin_key', form.adminKey.trim());
    setStatus('Đã lưu mã quản trị trên trình duyệt này.');
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur md:p-8">
        <div className="mb-6">
          <p className="text-sm uppercase tracking-[0.28em] text-cyan-300">LegalProTech AutoFlow</p>
          <h1 className="mt-2 text-3xl font-bold">Cấu hình tài khoản Google Ultra</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Trang này dùng để lưu tài khoản cho Windows VPS Worker. Worker chỉ tự điền email/mật khẩu khi gặp màn hình đăng nhập Google; nếu có captcha, 2FA hoặc xác minh bất thường, anh vẫn cần xử lý thủ công trong cửa sổ Chrome Worker.
          </p>
        </div>

        <form onSubmit={saveConfig} className="space-y-5">
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
            <strong>Lưu ý bảo mật:</strong> không gửi tài khoản/mật khẩu qua chat. Nên đặt <code className="rounded bg-black/30 px-1">CONFIG_ACCOUNT_ADMIN_KEY</code> và <code className="rounded bg-black/30 px-1">CONFIG_ACCOUNT_SECRET</code> trong <code className="rounded bg-black/30 px-1">.env.local</code> trước khi dùng trên VPS.
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-200">Mã quản trị cấu hình</span>
            <div className="flex gap-2">
              <input
                type="password"
                value={form.adminKey}
                onChange={(event) => updateField('adminKey', event.target.value)}
                placeholder="Nhập CONFIG_ACCOUNT_ADMIN_KEY hoặc WORKER_API_KEY"
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none ring-cyan-300/30 focus:ring-4"
              />
              <button
                type="button"
                onClick={rememberAdminKey}
                className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10"
              >
                Nhớ mã
              </button>
            </div>
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={loadConfig}
              disabled={loading || !canLoad}
              className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Tải cấu hình hiện tại
            </button>
            {current ? (
              <div className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-300">
                Đang lưu: <strong className="text-slate-100">{current.email || 'chưa có email'}</strong> · Mật khẩu: {current.hasPassword ? 'đã lưu' : 'chưa lưu'}
              </div>
            ) : null}
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-200">Email Google Ultra</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => updateField('email', event.target.value)}
              placeholder="example@gmail.com"
              className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none ring-cyan-300/30 focus:ring-4"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-200">Mật khẩu Google Ultra</span>
            <div className="flex gap-2">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(event) => updateField('password', event.target.value)}
                placeholder={current?.hasPassword ? 'Để trống nếu muốn giữ mật khẩu cũ' : 'Nhập mật khẩu'}
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none ring-cyan-300/30 focus:ring-4"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10"
              >
                {showPassword ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={form.autoLoginEnabled}
              onChange={(event) => updateField('autoLoginEnabled', event.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              Bật tự điền đăng nhập Google khi Chrome Worker chưa có session. Nếu Google yêu cầu captcha/2FA, Worker sẽ chờ anh xác minh thủ công.
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-cyan-300 px-5 py-4 text-base font-extrabold text-slate-950 shadow-lg shadow-cyan-950/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Lưu cấu hình tài khoản
          </button>
        </form>

        {status ? (
          <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm leading-6 text-cyan-50">
            {status}
          </div>
        ) : null}

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-300">
          <p className="font-semibold text-slate-100">Sau khi lưu:</p>
          <p>1. Tắt Worker cũ bằng Ctrl + C.</p>
          <p>2. Chạy lại <code className="rounded bg-black/40 px-1">npm run worker</code>.</p>
          <p>3. Tạo job mới. Nếu Chrome Worker chưa đăng nhập, nó sẽ tự điền tài khoản đã lưu.</p>
        </div>
      </div>
    </main>
  );
}
