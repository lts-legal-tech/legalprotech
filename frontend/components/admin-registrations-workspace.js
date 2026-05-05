'use client';
import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

export function AdminRegistrationsWorkspace() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/registrations', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không đọc được hồ sơ.');
      setItems(data.registrations || []);
    } catch (err) {
      setError(err.message || 'Có lỗi.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function act(id, action) {
    try {
      setBusyId(id + action);
      const res = await fetch(`/api/admin/registrations/${id}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không xử lý được.');
      await load();
    } catch (err) {
      setError(err.message || 'Có lỗi.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="panel rounded-[30px] p-5 md:p-6 app-fade">
      <div className="border-b border-slate-200 pb-4">
        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">Admin backend</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">Duyệt tài khoản và hồ sơ nghề nghiệp</h1>
        <p className="mt-3 text-sm leading-7 text-slate-600">Luật sư chính thức và tài khoản chuyên nghiệp cần được admin duyệt/kích hoạt trước khi có thể sử dụng đầy đủ entitlement trong hệ thống.</p>
      </div>
      {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải hồ sơ...</div>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-slate-900">{item.fullName}</div>
                  <div className="mt-1 text-sm text-slate-500">{item.email}</div>
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">{item.status}</div>
              </div>
              <div className="mt-3 space-y-1 text-sm text-slate-600">
                <div>Loại tài khoản: <strong>{item.accountLabel}</strong></div>
                {item.fields?.schoolName ? <div>Trường: <strong>{item.fields.schoolName}</strong></div> : null}
                {item.fields?.majorName ? <div>Ngành: <strong>{item.fields.majorName}</strong></div> : null}
                {item.fields?.lawFirmName ? <div>Công ty luật thực tập: <strong>{item.fields.lawFirmName}</strong></div> : null}
                {item.fields?.companyName ? <div>Tên công ty: <strong>{item.fields.companyName}</strong></div> : null}
                {item.fields?.jobTitle ? <div>Chức vụ: <strong>{item.fields.jobTitle}</strong></div> : null}
                <div>Entitlement video/lần: <strong>{item.entitlements?.maxVideoCount}</strong></div>
                <div>Chọn frame: <strong>{item.entitlements?.canSelectFrame ? 'Có' : 'Không'}</strong></div>
              </div>
              {item.lawyerCardImage ? <img src={item.lawyerCardImage} alt="lawyer card" className="mt-4 h-48 w-full rounded-2xl object-cover" /> : null}
              <div className="mt-4 flex flex-wrap gap-3">
                {item.status === 'pending_admin_review' ? (<>
                  <button className="btn-primary" onClick={() => act(item.id, 'approve')} disabled={busyId === item.id + 'approve'}>{busyId === item.id + 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Duyệt</button>
                  <button className="btn-secondary" onClick={() => act(item.id, 'reject')} disabled={busyId === item.id + 'reject'}>{busyId === item.id + 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Từ chối</button>
                </>) : null}
                {item.accountType !== 'professional' ? <button className="btn-secondary" onClick={() => act(item.id, 'promote-professional')} disabled={busyId === item.id + 'promote-professional'}>{busyId === item.id + 'promote-professional' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Nâng lên chuyên nghiệp</button> : <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Đã là tài khoản chuyên nghiệp</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
