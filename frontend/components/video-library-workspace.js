'use client';
import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Image as ImageIcon, Loader2, RefreshCw, Video } from 'lucide-react';
import { getCurrentUserScope, userRequestHeaders, withUserQuery } from '../lib/user-scope-client';

async function parseJson(response) {
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  return data;
}

function dateLabel(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleString('vi-VN'); } catch { return String(value); }
}

export function VideoLibraryWorkspace() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [userId, setUserId] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const scope = getCurrentUserScope();
      setUserId(scope.userId || 'anonymous');
      const response = await fetch(withUserQuery('/api/flow/library'), {
        headers: userRequestHeaders(),
        cache: 'no-store',
      });
      const data = await parseJson(response);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err.message || 'Không tải được My Product.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const total = useMemo(() => items.length, [items]);

  return (
    <div className="space-y-5">
      <section className="panel rounded-[30px] p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="glass-chip">legalprotech · My Product</div>
            <h1 className="mt-4 text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-4xl">My Product của tôi</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              My Product lưu cả <b>ảnh</b> và <b>video</b> đã tạo theo <b>user_id</b> của tài khoản đang đăng nhập, nên tài khoản khác không thấy nhầm kết quả của bạn.
            </p>
            <div className="mt-3 text-xs text-slate-400">User ID: {userId || 'chưa xác định'} · {total} sản phẩm</div>
          </div>
          <button type="button" onClick={load} disabled={loading} className="btn-secondary shrink-0 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Làm mới
          </button>
        </div>
        {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      </section>

      {loading ? (
        <div className="panel flex min-h-[420px] items-center justify-center rounded-[30px] p-6 text-sm font-medium text-slate-600">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Đang tải My Product...
        </div>
      ) : !items.length ? (
        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[30px] border border-dashed border-slate-200 bg-white px-6 text-center">
          <Video className="h-9 w-9 text-slate-300" />
          <div className="mt-4 text-xl font-semibold text-slate-900">Chưa có sản phẩm nào</div>
          <div className="mt-2 max-w-md text-sm leading-7 text-slate-500">Sau khi tạo ảnh hoặc video, kết quả hoàn tất sẽ tự xuất hiện tại đây theo user_id của bạn.</div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((item) => (
            <article key={`${item.jobId}-${item.id}`} className="panel overflow-hidden rounded-[28px] p-3">
              <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-black">
                {item.type === 'video' ? (
                  <video src={item.url} poster={item.thumbnail || ''} controls className="aspect-video w-full object-cover" />
                ) : (
                  <img src={item.url} alt={item.title || 'Image'} className="aspect-[4/5] w-full object-cover" />
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  {item.type === 'video' ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                  {item.title || (item.type === 'video' ? 'Video' : 'Image')}
                </div>
                <div className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{item.prompt || 'Không có prompt.'}</div>
                <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                  <div>Job: {item.jobId}</div>
                  <div>Ngày tạo: {dateLabel(item.createdAt || item.jobCreatedAt)}</div>
                </div>
                <div className="mt-4 flex gap-3">
                  <a href={item.url} target="_blank" className="btn-secondary flex-1"><ExternalLink className="h-4 w-4" /> Mở</a>
                  <a href={item.url} download className="btn-secondary flex-1"><Download className="h-4 w-4" /> Tải</a>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
