'use client';
import {
  CalendarClock,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Share2,
  Trash2,
  Video,
} from 'lucide-react';
import { ShareModal } from './share-modal';
import { useState } from 'react';

function EmptyState({ jobState, statusText }) {
  let title = 'Chưa có kết quả';
  let desc = 'Gửi job từ khung bên trái để VPS xử lý và trả về danh sách kết quả tại đây.';
  if (jobState === 'loading') {
    title = 'Đang xử lý';
    desc = statusText || 'VPS đang tạo nội dung...';
  }
  if (jobState === 'error') {
    title = 'Có lỗi xảy ra';
    desc = statusText || 'Kiểm tra lại request, cấu hình VPS hoặc model.';
  }
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[30px] border border-dashed border-slate-200 bg-white px-6 text-center">
      {jobState === 'loading' ? <Loader2 className="h-8 w-8 animate-spin text-slate-500" /> : <Video className="h-8 w-8 text-slate-300" />}
      <div className="mt-4 text-xl font-semibold text-slate-900">{title}</div>
      <div className="mt-2 max-w-md text-sm leading-7 text-slate-500">{desc}</div>
    </div>
  );
}

export function ResultsList({ results, token, expiresAt, zipUrl, actionLoading, jobState, statusText, onAction }) {
  const [shareOpen, setShareOpen] = useState(false);
  const hasResults = results.length > 0;

  async function handleSaveAll() {
    const data = await onAction('save_all');
    const target = data?.zipUrl || zipUrl;
    if (target) {
      const link = document.createElement('a');
      link.href = target;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.click();
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel rounded-[28px] p-4 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-900">Kết quả từ VPS</div>
            <div className="mt-2 text-sm text-slate-600">
              Website chỉ hiển thị danh sách. File thực tế nằm trên VPS và tự hết hạn sau 3 ngày nếu không gia hạn.
            </div>
            {token && <div className="mt-2 text-xs text-slate-400">Token: {token}</div>}
            {expiresAt && <div className="mt-1 text-xs text-slate-400">Hết hạn: {new Date(expiresAt).toLocaleString('vi-VN')}</div>}
          </div>
          <div className="flex flex-wrap gap-3">
            <button disabled={!hasResults || actionLoading} onClick={handleSaveAll} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
              <Download className="h-4 w-4" /> Lưu hết
            </button>
            <button disabled={!hasResults || actionLoading} onClick={() => onAction('delete_all')} className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> Xóa hết
            </button>
            <button disabled={!token || actionLoading} onClick={() => onAction('keep_3_days')} className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50">
              <CalendarClock className="h-4 w-4" /> Giữ 3 ngày
            </button>
            <button
              disabled={!token || actionLoading}
              onClick={async () => {
                await onAction('share');
                setShareOpen(true);
              }}
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Share2 className="h-4 w-4" /> Chia sẻ
            </button>
          </div>
        </div>
      </div>
      {!hasResults ? (
        <EmptyState jobState={jobState} statusText={statusText} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {results.map((item) => (
            <div key={item.id} className="panel overflow-hidden rounded-[28px] p-3">
              <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-black">
                {item.type === 'video' ? (
                  <video src={item.url} poster={item.thumbnail} controls className="aspect-video w-full object-cover" />
                ) : (
                  <img src={item.url} alt={item.title} className="aspect-[4/5] w-full object-cover" />
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-900">{item.title}</div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
                    {item.type === 'video' ? (
                      <span className="inline-flex items-center gap-1"><Video className="h-3 w-3" /> {item.duration || 5}s</span>
                    ) : (
                      <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" /> {item.sizeLabel || 'HD'}</span>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex gap-3">
                  <a href={item.url} target="_blank" className="btn-secondary flex-1"><ExternalLink className="h-4 w-4" /> Mở</a>
                  <a href={item.url} download className="btn-secondary flex-1"><Download className="h-4 w-4" /> Tải</a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ShareModal open={shareOpen} token={token} onClose={() => setShareOpen(false)} />
    </div>
  );
}
