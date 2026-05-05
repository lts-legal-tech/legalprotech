import Link from 'next/link';
import { ArrowRight, Clock3, Server, Sparkles, Workflow } from 'lucide-react';
import { TOOL_LIST } from '../lib/tools';
import { AppIcon } from './icon';

const stats = [
  { label: 'Video mỗi lệnh', value: '5 / 10', icon: Sparkles },
  { label: 'Thời gian lưu VPS', value: '3 ngày', icon: Clock3 },
  { label: 'Luồng xử lý', value: 'Website → VPS → Model', icon: Workflow },
  { label: 'Lưu trữ', value: 'Không lưu ở website', icon: Server },
];

export function Dashboard() {
  return (
    <div className="space-y-6">
      <section className="panel rounded-[32px] p-6 md:p-8">
        <div className="max-w-4xl">
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
            Tool web app
          </div>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 md:text-5xl">
            Workspace tạo prompt, ảnh và video trong một chỗ
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600 md:text-base">
            Chatbot đứng đầu để tạo prompt và kịch bản. Sau đó chuyển nhanh sang text to image,
            image to video hoặc my product để sản xuất nội dung thật qua VPS.
          </p>
          <div className="mt-6">
            <Link href="/chatbot" className="btn-primary">
              Mở chatbot <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-4 text-2xl font-semibold text-slate-900">{item.value}</div>
                <div className="mt-2 text-sm text-slate-500">{item.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        {TOOL_LIST.map((tool) => (
          <Link
            key={tool.slug}
            href={`/tools/${tool.slug}`}
            className="panel rounded-[30px] p-5 transition hover:-translate-y-1"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
                <AppIcon name={tool.iconName} className="h-5 w-5" />
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
                {tool.expectedCount} outputs
              </div>
            </div>
            <div className="mt-5 text-xl font-semibold text-slate-900">{tool.shortLabel}</div>
            <p className="mt-3 text-sm leading-7 text-slate-600">{tool.description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
