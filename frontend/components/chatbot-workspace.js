'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bot, Loader2, Plus, Send, Sparkles, MessageSquareText, Film, Image as ImageIcon, ClipboardList } from 'lucide-react';
import { CHATBOT_PROJECT_SEED } from '../lib/tools';
import { getCurrentUserScope, scopedStorageKey } from '../lib/user-scope-client';

const STORAGE_KEY = 'ai-workspace-projects';
const CHAT_KEY = 'ai-workspace-chat-history';
const PROJECT_EVENT = 'legalprotech:projects-updated';

const MODES = [
  { id: 'prompt', label: 'Prompt mode', icon: Sparkles, description: 'Tối ưu prompt chuyên nghiệp, rõ outcome, dễ copy sang công cụ tạo nội dung.' },
  { id: 'script', label: 'Script mode', icon: MessageSquareText, description: 'Tạo cấu trúc ý tưởng, triển khai kịch bản, hook, CTA và flow nội dung.' },
  { id: 'image_prompt', label: 'Tạo prompt ảnh', icon: ImageIcon, description: 'Tập trung vào prompt hình ảnh thương mại, visual social, poster, concept và key visual.' },
  { id: 'video_script', label: 'Viết kịch bản video', icon: Film, description: 'Đi vào kịch bản video hoàn chỉnh: opening hook, nhịp cảnh, thoại, super và CTA.' },
  { id: 'shot_list', label: 'Làm shot list', icon: ClipboardList, description: 'Tách ý tưởng thành shot list rõ ràng để giao dựng hoặc đưa sang AI video workflow.' },
];

function readProjects(userId = getCurrentUserScope().userId) {
  try {
    const raw = window.localStorage.getItem(scopedStorageKey(STORAGE_KEY, userId));
    if (!raw) return CHATBOT_PROJECT_SEED;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : CHATBOT_PROJECT_SEED;
  } catch { return CHATBOT_PROJECT_SEED; }
}
function readHistory(userId = getCurrentUserScope().userId) {
  try {
    const raw = window.localStorage.getItem(scopedStorageKey(CHAT_KEY, userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
function saveProjects(projects, userId = getCurrentUserScope().userId) {
  try {
    window.localStorage.setItem(scopedStorageKey(STORAGE_KEY, userId), JSON.stringify(projects));
    window.dispatchEvent(new CustomEvent(PROJECT_EVENT, { detail: { projects, userId } }));
  } catch {}
}
function saveHistory(history, userId = getCurrentUserScope().userId) {
  try { window.localStorage.setItem(scopedStorageKey(CHAT_KEY, userId), JSON.stringify(history)); } catch {}
}

function RichText({ text }) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((part, index) => /^\*\*[^*]+\*\*$/.test(part) ? <strong key={index}>{part.slice(2,-2)}</strong> : <span key={index}>{part}</span>)}</>;
}

export function ChatbotWorkspace({ projectId }) {
  const searchParams = useSearchParams();
  const selectedProjectId = projectId || searchParams.get('project') || '';
  const [userId, setUserId] = useState('');
  const [projects, setProjects] = useState(CHATBOT_PROJECT_SEED);
  const [history, setHistory] = useState({});
  const [mode, setMode] = useState('prompt');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    const currentUserId = getCurrentUserScope().userId || 'anonymous';
    setUserId(currentUserId);
    setProjects(readProjects(currentUserId));
    setHistory(readHistory(currentUserId));
    const syncProjects = (event) => {
      const nextUserId = getCurrentUserScope().userId || 'anonymous';
      if (event?.detail?.userId && event.detail.userId !== nextUserId) return;
      setProjects(Array.isArray(event?.detail?.projects) ? event.detail.projects : readProjects(nextUserId));
    };
    const syncStorage = (event) => {
      const nextUserId = getCurrentUserScope().userId || 'anonymous';
      if (event.key === scopedStorageKey(STORAGE_KEY, nextUserId)) setProjects(readProjects(nextUserId));
      if (event.key === scopedStorageKey(CHAT_KEY, nextUserId)) setHistory(readHistory(nextUserId));
    };
    window.addEventListener(PROJECT_EVENT, syncProjects);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(PROJECT_EVENT, syncProjects);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  useEffect(() => { if (userId) saveHistory(history, userId); }, [history, userId]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [selectedProjectId, history, loading]);

  const activeProject = useMemo(() => projects.find((item) => item.id === selectedProjectId) || projects[0] || CHATBOT_PROJECT_SEED[0], [projects, selectedProjectId]);
  const activeMode = MODES.find((item) => item.id === mode) || MODES[0];

  const messages = history[activeProject?.id] || [{
    id: 'welcome', role: 'assistant', content: 'Xin chào. Tôi sẽ hỗ trợ bạn xây **prompt**, **kịch bản**, **shot list** và cấu trúc nội dung theo đúng chế độ đang bật. Hãy gửi brief càng rõ càng tốt để tôi trả ra bản dùng được ngay.'
  }];

  async function submitMessage(text) {
    const clean = text.trim();
    if (!clean || !activeProject) return;
    setError('');
    const nextUser = { id: `u-${Date.now()}`, role: 'user', content: clean };
    const nextMessages = [...messages, nextUser];
    setHistory((prev) => ({ ...prev, [activeProject.id]: nextMessages }));
    setInput('');
    try {
      setLoading(true);
      const response = await fetch('/api/openai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, project: activeProject, messages: nextMessages, message: clean }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Không gọi được OpenAI.');
      if (!data.text?.trim()) throw new Error('Không có nội dung phản hồi.');
      const assistant = { id: `a-${Date.now()}`, role: 'assistant', content: data.text };
      setHistory((prev) => ({ ...prev, [activeProject.id]: [...(prev[activeProject.id] || nextMessages), assistant] }));
    } catch (err) {
      setError(err.message || 'Đã có lỗi xảy ra.');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitMessage(input);
    }
  }

  function createLocalProject() {
    const next = { id: `proj-${Date.now()}`, name: `Dự án mới ${projects.length + 1}`, type: mode };
    const merged = [next, ...projects];
    setProjects(merged);
    saveProjects(merged, userId);
  }

  return (
    <div className="min-h-[calc(100vh-1rem)]">
      <section className="panel app-fade flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[26px] p-3 md:p-4">
        <div className="rounded-[22px] bg-white/70 px-4 py-4 ring-1 ring-slate-200/70">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="glass-chip">legalprotech · Chatbot</div>
              <h1 className="mt-3 text-[28px] font-black tracking-[-0.04em] text-slate-950 md:text-[32px]">AI workspace cho prompt và kịch bản</h1>
            </div>
            <button type="button" onClick={createLocalProject} className="btn-secondary shrink-0"><Plus className="h-4 w-4" /> Dự án mới</button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {MODES.map((item) => {
              const Icon = item.icon;
              const active = item.id === mode;
              return (
                <button key={item.id} type="button" onClick={() => setMode(item.id)} className={`mode-card ${active ? 'mode-card-active' : ''}`}>
                  <div className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" /> {item.label}</div>
                  <div className="mt-2 text-[12px] leading-5 text-slate-500">{item.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex min-h-0 flex-1">
          <div className="panel-deep flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[24px] p-0">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-950">{activeProject?.name || 'Dự án mặc định'}</div>
                <div className="mt-1 truncate text-xs font-medium text-slate-600">{activeMode.label}</div>
              </div>
              <div className="glass-chip !text-[10px] !tracking-[0.14em]">{loading ? 'Đang phản hồi' : 'Sẵn sàng'}</div>
            </div>

            <div ref={listRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
                {messages.map((message, index) => (
                  <div key={message.id || index} className={`message-shell ${message.role === 'user' ? 'message-shell-user' : 'message-shell-assistant'}`}>
                    <div className={`message-label ${message.role === 'assistant' ? 'message-label-assistant' : 'message-label-user'}`}>
                      {message.role === 'assistant' ? <Bot className="h-3.5 w-3.5" /> : null}
                      {message.role === 'assistant' ? 'legalprotech AI' : 'Bạn'}
                    </div>
                    {message.role === 'assistant' ? (
                      <div className="message-assistant-plain whitespace-pre-wrap text-[15px] leading-8 text-slate-800"><RichText text={message.content} /></div>
                    ) : (
                      <div className="message-user-bubble whitespace-pre-wrap text-sm leading-7 text-white"><RichText text={message.content} /></div>
                    )}
                  </div>
                ))}

                {loading && (
                  <div className="message-shell message-shell-assistant">
                    <div className="message-label message-label-assistant"><Bot className="h-3.5 w-3.5" /> legalprotech AI</div>
                    <div className="message-assistant-plain flex items-center gap-2 text-sm font-medium text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Đang xây nội dung theo chế độ {activeMode.label.toLowerCase()}…</div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200/80 bg-white/90 px-4 py-3 md:px-5">
              {error && <div className="mb-3 rounded-[18px] bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200/80">{error}</div>}
              <div className="rounded-[22px] bg-white p-2 ring-1 ring-slate-200/80 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Mô tả brief, sản phẩm, nền tảng, mục tiêu chuyển đổi hoặc yêu cầu kịch bản..."
                  className="min-h-[52px] max-h-[120px] w-full resize-y border-0 bg-transparent px-2 py-2 text-[15px] font-medium leading-6 text-slate-900 outline-none placeholder:text-slate-400"
                />
                <div className="mt-2 flex items-center justify-end gap-3 border-t border-slate-100 px-2 pt-2">
                  <button type="button" onClick={() => submitMessage(input)} disabled={loading || !input.trim()} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Gửi
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
