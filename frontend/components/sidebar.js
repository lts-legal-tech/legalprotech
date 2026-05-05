'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, LogOut, Shield, Trash2 } from 'lucide-react';
import { AppIcon } from './icon';
import { CHATBOT_PROJECT_SEED, TOOL_LIST } from '../lib/tools';

const STORAGE_KEY = 'ai-workspace-projects';
const PROFILE_KEY = 'legalprotech-current-profile';
const ADMIN_KEY = 'legalprotech-admin-session';
const PROJECT_EVENT = 'legalprotech:projects-updated';

function readProjects() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return CHATBOT_PROJECT_SEED;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : CHATBOT_PROJECT_SEED;
  } catch {
    return CHATBOT_PROJECT_SEED;
  }
}

function readProfile() {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readAdmin() {
  try {
    const raw = window.localStorage.getItem(ADMIN_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedProject = searchParams.get('project') || '';
  const [projects, setProjects] = useState(CHATBOT_PROJECT_SEED);
  const [profile, setProfile] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [showAllProjects, setShowAllProjects] = useState(false);

  useEffect(() => {
    setProjects(readProjects());
    setProfile(readProfile());
    setAdmin(readAdmin());
    const sync = (event) => {
      if (event?.detail && Array.isArray(event.detail)) {
        setProjects(event.detail);
      } else {
        setProjects(readProjects());
      }
      setProfile(readProfile());
      setAdmin(readAdmin());
    };
    const syncStorage = (event) => {
      if (event.key === STORAGE_KEY) setProjects(readProjects());
      if (event.key === PROFILE_KEY) setProfile(readProfile());
      if (event.key === ADMIN_KEY) setAdmin(readAdmin());
    };
    window.addEventListener(PROJECT_EVENT, sync);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(PROJECT_EVENT, sync);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  const visibleProjects = useMemo(() => (showAllProjects ? projects : projects.slice(0, 4)), [projects, showAllProjects]);

  function createProject() {
    const next = {
      id: `proj-${Date.now()}`,
      name: `Dự án mới ${projects.length + 1}`,
      type: 'prompt',
    };
    const merged = [next, ...projects];
    setProjects(merged);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent(PROJECT_EVENT, { detail: merged }));
    router.push(`/chatbot?project=${next.id}`);
  }

  function deleteProject(id) {
    if (projects.length <= 1) return;
    const merged = projects.filter((item) => item.id !== id);
    setProjects(merged);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent(PROJECT_EVENT, { detail: merged }));
    if (selectedProject === id) {
      router.push(`/chatbot?project=${merged[0]?.id || ''}`);
    }
  }

  function logoutUser() {
    window.localStorage.removeItem(PROFILE_KEY);
    router.push('/');
  }

  function logoutAdmin() {
    window.localStorage.removeItem(ADMIN_KEY);
    setAdmin(null);
    router.push('/');
  }

  return (
    <aside className="panel rounded-[28px] p-4 xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] xl:overflow-auto app-fade">
      <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs uppercase tracking-[0.28em] text-slate-400">Workspace</div>
        <div className="mt-3 flex items-center gap-3 text-xl font-semibold text-slate-900">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-sm font-bold text-white shadow-lg shadow-slate-200">LP</span>
          legalprotech
        </div>
        <div className="mt-2 text-sm leading-6 text-slate-500">
          Chatbot để tạo prompt và kịch bản. Tool ảnh và video dùng chung cùng hệ workflow.
        </div>
        {profile ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-900">Tài khoản hiện tại</div>
            <div className="mt-1">{profile.fullName} · {profile.accountLabel}</div>
            <div className="mt-1">Trạng thái: {profile.status}</div>
            <button type="button" onClick={logoutUser} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 transition hover:bg-slate-100">
              <LogOut className="h-3.5 w-3.5" /> Đăng xuất
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-6 space-y-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition ${
            pathname.startsWith('/chatbot') ? 'bg-slate-900 text-white shadow-lg shadow-slate-200/40' : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <AppIcon name="chatbot" className="h-4 w-4" />
          <span className="font-medium">Chatbot</span>
          <span className="ml-auto">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        </button>

        {expanded && (
          <div className="space-y-2 overflow-hidden pl-3 app-slide">
            <button type="button" onClick={createProject} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm text-slate-700 transition hover:bg-slate-100">
              <AppIcon name="new-project" className="h-4 w-4" />
              Dự án mới
            </button>

            {visibleProjects.map((project) => {
              const href = `/chatbot?project=${project.id}`;
              const active = pathname.startsWith('/chatbot') && (selectedProject ? selectedProject === project.id : projects[0]?.id === project.id);
              return (
                <div key={project.id} className={`group flex items-center gap-2 rounded-2xl pr-2 ${active ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                  <Link href={href} className={`flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-3 text-sm transition ${active ? 'text-slate-900' : 'text-slate-600'}`}>
                    <span className="h-2 w-2 rounded-full bg-violet-500" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{project.name}</div>
                      <div className="text-xs text-slate-400">{project.type}</div>
                    </div>
                  </Link>
                  {projects.length > 1 && (
                    <button type="button" onClick={() => deleteProject(project.id)} className="invisible rounded-xl p-2 text-slate-400 transition hover:bg-white hover:text-rose-600 group-hover:visible" aria-label={`Xóa ${project.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}

            {projects.length > 4 && (
              <button type="button" onClick={() => setShowAllProjects((v) => !v)} className="px-3 py-2 text-sm text-slate-500 transition hover:text-slate-900">
                {showAllProjects ? 'Ẩn bớt dự án' : `Xem thêm ${projects.length - 4} dự án`}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-slate-200 pt-6">
        <div className="mb-3 text-xs uppercase tracking-[0.28em] text-slate-400">Tools</div>
        <div className="space-y-2">
          {TOOL_LIST.map((tool) => {
            const href = `/tools/${tool.slug}`;
            const active = pathname === href;
            return (
              <Link key={tool.slug} href={href} className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition ${active ? 'bg-slate-900 text-white shadow-lg shadow-slate-200/40' : 'text-slate-700 hover:bg-slate-100'}`}>
                <AppIcon name={tool.iconName} className="h-4 w-4" />
                <div>
                  <div className="font-medium">{tool.label}</div>
                  <div className={`text-xs ${active ? 'text-slate-300' : 'text-slate-400'}`}>{tool.expectedCount} kết quả</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {admin?.loggedIn ? (
        <div className="mt-6 border-t border-slate-200 pt-6">
          <div className="mb-3 text-xs uppercase tracking-[0.28em] text-slate-400">Admin</div>
          <div className="space-y-2">
            <Link href="/admin/registrations" className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition ${pathname === '/admin/registrations' ? 'bg-slate-900 text-white shadow-lg shadow-slate-200/40' : 'text-slate-700 hover:bg-slate-100'}`}>
              <Shield className="h-4 w-4" />
              <div><div className="font-medium">Admin duyệt</div><div className={`text-xs ${pathname === '/admin/registrations' ? 'text-slate-300' : 'text-slate-400'}`}>Duyệt thẻ hành nghề</div></div>
            </Link>
            <button type="button" onClick={logoutAdmin} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm text-slate-700 transition hover:bg-slate-100">
              <LogOut className="h-4 w-4" />
              <div><div className="font-medium">Đăng xuất admin</div><div className="text-xs text-slate-400">Tài khoản mặc định: admin</div></div>
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
