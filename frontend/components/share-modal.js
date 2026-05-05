'use client';
import { useMemo, useState } from 'react';
import { Copy, ExternalLink, X } from 'lucide-react';

export function ShareModal({ open, token, onClose }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = useMemo(() => {
    if (!token) return '';
    if (typeof window === 'undefined') return `/shared/${token}`;
    return `${window.location.origin}/shared/${token}`;
  }, [token]);

  if (!open) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="panel w-full max-w-xl rounded-[30px] p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xl font-semibold text-slate-900">Chia sẻ kết quả</div>
            <div className="mt-2 text-sm text-slate-500">
              Link này đọc dữ liệu từ VPS qua token, không cần website lưu kết quả.
            </div>
          </div>
          <button onClick={onClose} className="btn-secondary p-3"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 break-all">{shareUrl}</div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button onClick={handleCopy} className="btn-primary"><Copy className="h-4 w-4" /> {copied ? 'Đã copy' : 'Copy link'}</button>
          <a href={shareUrl} target="_blank" className="btn-secondary"><ExternalLink className="h-4 w-4" /> Mở trang chia sẻ</a>
        </div>
      </div>
    </div>
  );
}
