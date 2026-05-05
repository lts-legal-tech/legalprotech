'use client';
import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Upload } from 'lucide-react';
import { ACCOUNT_TYPE_OPTIONS, getAccountConfig } from '../lib/account-types';

const PROFILE_KEY = 'legalprotech-current-profile';

export function RegistrationWorkspace({ externalFlow = false, onSwitchLogin }) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    accountType: 'student',
    schoolName: '',
    majorName: '',
    lawFirmName: '',
    companyName: '',
    jobTitle: '',
  });
  const [imageFile, setImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const cfg = useMemo(() => getAccountConfig(form.accountType), [form.accountType]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      setLoading(true);
      const fd = new FormData();
      if (form.password.length < 6) throw new Error('Mật khẩu phải từ 6 ký tự trở lên.');
      if (form.password !== form.confirmPassword) throw new Error('Xác nhận mật khẩu chưa khớp.');
      Object.entries(form).forEach(([k, v]) => { if (k !== 'confirmPassword') fd.append(k, v); });
      if (imageFile) fd.append('lawyerCardImage', imageFile);
      const res = await fetch('/api/auth/register', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không đăng ký được.');
      setSuccess(data.message || 'Đã gửi đăng ký.');
      if (data.registration?.status === 'active') {
        window.localStorage.setItem(PROFILE_KEY, JSON.stringify(data.registration));
        if (externalFlow) {
          window.setTimeout(() => {
            window.location.href = '/chatbot';
          }, 700);
        }
      }
    } catch (err) {
      setError(err.message || 'Đã có lỗi xảy ra.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-card rounded-[30px] p-6 md:p-7 app-fade">
      <div className="border-b border-slate-200/80 pb-4">
        <div className="glass-chip">Đăng ký tài khoản</div>
        <h1 className="mt-4 text-[32px] font-black tracking-[-0.04em] text-slate-950">Tạo tài khoản để vào legalprotech</h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-7 text-slate-700">Hoàn tất đúng nhóm nghề nghiệp để hệ thống tự cấu hình quyền sử dụng và luồng duyệt phù hợp.</p>
      </div>
      <form onSubmit={handleSubmit} className="mt-5 grid gap-4 xl:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-800">Họ và tên</div>
          <input className="input-light" value={form.fullName} onChange={(e) => setField('fullName', e.target.value)} required />
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-800">Email</div>
          <input type="email" className="input-light" value={form.email} onChange={(e) => setField('email', e.target.value)} required />
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-800">Mật khẩu</div>
          <input type="password" className="input-light" value={form.password} onChange={(e) => setField('password', e.target.value)} required />
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-800">Xác nhận mật khẩu</div>
          <input type="password" className="input-light" value={form.confirmPassword} onChange={(e) => setField('confirmPassword', e.target.value)} required />
        </div>
        <div className="xl:col-span-2">
          <div className="mb-2 text-sm font-semibold text-slate-800">Nghề nghiệp</div>
          <select className="input-light" value={form.accountType} onChange={(e) => setField('accountType', e.target.value)}>
            {ACCOUNT_TYPE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>

        {(form.accountType === 'student' || form.accountType === 'intern' || form.accountType === 'trainee_lawyer') && (
          <>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">Tên trường</div>
              <input className="input-light" value={form.schoolName} onChange={(e) => setField('schoolName', e.target.value)} required />
            </div>
            {form.accountType !== 'trainee_lawyer' ? (
              <div>
                <div className="mb-2 text-sm font-semibold text-slate-800">Tên ngành</div>
                <input className="input-light" value={form.majorName} onChange={(e) => setField('majorName', e.target.value)} required />
              </div>
            ) : (
              <div>
                <div className="mb-2 text-sm font-semibold text-slate-800">Tên công ty luật đang thực tập</div>
                <input className="input-light" value={form.lawFirmName} onChange={(e) => setField('lawFirmName', e.target.value)} required />
              </div>
            )}
          </>
        )}

        {form.accountType === 'licensed_lawyer' && (
          <div className="xl:col-span-2">
            <div className="mb-2 text-sm font-semibold text-slate-800">Ảnh thẻ hành nghề luật sư</div>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[20px] bg-slate-50 px-4 py-6 text-sm font-medium text-slate-700 ring-1 ring-dashed ring-slate-300 transition hover:bg-white">
              <Upload className="h-4 w-4" /> {imageFile ? imageFile.name : 'Tải ảnh thẻ hành nghề để admin duyệt'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setImageFile(e.target.files?.[0] || null)} required />
            </label>
          </div>
        )}

        {form.accountType === 'partner' && (
          <>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">Tên công ty</div>
              <input className="input-light" value={form.companyName} onChange={(e) => setField('companyName', e.target.value)} required />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">Chức vụ</div>
              <input className="input-light" value={form.jobTitle} onChange={(e) => setField('jobTitle', e.target.value)} required />
            </div>
          </>
        )}

        <div className="xl:col-span-2 panel-deep rounded-[22px] p-4 text-sm text-slate-700">
          <div className="font-bold text-slate-950">Quyền theo loại tài khoản</div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <div>Trạng thái mặc định: <strong>{cfg.status}</strong></div>
            <div>Số video tối đa/lần: <strong>{cfg.entitlements.maxVideoCount}</strong></div>
            <div>Cho phép chọn frame: <strong>{cfg.entitlements.canSelectFrame ? 'Có' : 'Không'}</strong></div>
          </div>
        </div>

        {error && <div className="xl:col-span-2 rounded-[18px] bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200/80">{error}</div>}
        {success && <div className="xl:col-span-2 flex items-center gap-2 rounded-[18px] bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200/80"><CheckCircle2 className="h-4 w-4" /> {success}{externalFlow && form.accountType !== 'licensed_lawyer' ? ' Đang chuyển vào legalprotech...' : ''}</div>}
        <div className="xl:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button className="btn-primary min-w-[220px]">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Gửi đăng ký</button>
          {externalFlow && onSwitchLogin ? <button type="button" onClick={onSwitchLogin} className="text-sm font-semibold text-slate-700 underline underline-offset-4">Đã có tài khoản? Đăng nhập</button> : null}
        </div>
      </form>
    </section>
  );
}
