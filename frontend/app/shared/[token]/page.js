import { getResultsByToken } from '../../../lib/vps';
import { getFlowResultsByToken } from '../../../lib/flow-job-store';

async function readSharedResults(token) {
  const flowData = await getFlowResultsByToken(token).catch(() => null);
  if (flowData) return flowData;
  return getResultsByToken(token).catch((error) => ({ error: error.message || 'Không đọc được token.' }));
}

export default async function SharedPage({ params }) {
  const { token } = await params;
  const data = await readSharedResults(token);
  const results = data?.results || [];

  return (
    <div className="min-h-screen bg-base px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="panel rounded-[30px] p-6">
          <div className="text-sm text-slate-500">Trang chia sẻ</div>
          <h1 className="mt-3 text-3xl font-semibold">Kết quả từ VPS</h1>
          <div className="mt-3 text-sm text-slate-600">Token: {token}</div>
          {data?.expiresAt && <div className="mt-1 text-sm text-slate-600">Hết hạn: {new Date(data.expiresAt).toLocaleString('vi-VN')}</div>}
          {data?.error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{data.error}</div>}
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {results.map((item) => (
            <div key={item.id} className="panel overflow-hidden rounded-[28px] p-3">
              {item.type === 'video' ? (
                <video src={item.url} poster={item.thumbnail} controls className="aspect-video w-full rounded-[24px] object-cover" />
              ) : (
                <img src={item.url} alt={item.title} className="aspect-[4/5] w-full rounded-[24px] object-cover" />
              )}
              <div className="p-3">
                <div className="font-medium text-slate-900">{item.title}</div>
                <a href={item.url} target="_blank" className="btn-secondary mt-3 inline-flex">Mở file</a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
