'use client';
import { useState } from 'react';
import { Sparkles, Video, Image as ImageIcon, Layers3 } from 'lucide-react';
import { LoginWorkspace } from './login-workspace';
import { RegistrationWorkspace } from './registration-workspace';

export function AuthPortal() {
  const [tab, setTab] = useState('login');

  return (
    <div className="auth-shell text-slate-900">
      <div className="pointer-events-none fixed inset-0 bg-hero-radial" />
      <div className="mx-auto flex min-h-screen max-w-7xl items-center px-4 py-5 md:px-6">
        <div className="grid w-full gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="auth-card app-fade overflow-hidden rounded-[30px] p-6 md:p-7">
            <div className="glass-chip">legalprotech · Workspace Access</div>
            <div className="mt-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-slate-950 text-sm font-black text-white shadow-[0_20px_34px_rgba(15,23,42,0.2)]">LP</div>
              <div>
                <div className="text-[30px] font-black tracking-[-0.04em] text-slate-950">legalprotech</div>
                <div className="text-sm font-medium text-slate-600">AI content workspace for legal creators</div>
              </div>
            </div>
            <p className="mt-5 text-[15px] leading-7 text-slate-700">Đăng nhập để vào workspace. Nếu chưa có tài khoản, đăng ký theo đúng nhóm nghề nghiệp để hệ thống tự cấp quyền sử dụng phù hợp cho prompt, hình ảnh và video.</p>

            <div className="mt-6 grid gap-3">
              <div className="panel-deep app-pop rounded-[22px] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[16px] bg-indigo-600 text-white"><Video className="h-4 w-4" /></div>
                  <div>
                    <div className="text-sm font-bold text-slate-950">Tài khoản chuyên nghiệp</div>
                    <div className="mt-1 text-sm leading-6 text-slate-700">Cho phép tạo <strong>10 video/lần</strong> và mở quyền <strong>chọn frame</strong> trong workflow video.</div>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="panel-deep rounded-[20px] p-4 app-pop">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-950"><ImageIcon className="h-4 w-4 text-cyan-600" /> Prompt & visual</div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">Tạo prompt ảnh, prompt video, outline và shot list theo chế độ chuyên sâu.</div>
                </div>
                <div className="panel-deep rounded-[20px] p-4 app-pop">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-950"><Layers3 className="h-4 w-4 text-violet-600" /> Role-based workflow</div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">Phân nhóm tài khoản theo nghề nghiệp để kiểm soát entitlement và quy trình duyệt.</div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3 text-sm">
              <button type="button" onClick={() => setTab('login')} className={tab === 'login' ? 'btn-primary min-w-[136px]' : 'btn-secondary min-w-[136px]'}>Đăng nhập</button>
              <button type="button" onClick={() => setTab('register')} className={tab === 'register' ? 'btn-primary min-w-[136px]' : 'btn-secondary min-w-[136px]'}>Đăng ký</button>
            </div>
          </section>
          <main className="min-h-0">
            {tab === 'login' ? <LoginWorkspace compact onSwitchRegister={() => setTab('register')} /> : <RegistrationWorkspace externalFlow onSwitchLogin={() => setTab('login')} />}
          </main>
        </div>
      </div>
    </div>
  );
}
