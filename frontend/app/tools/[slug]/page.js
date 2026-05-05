import { RequireLogin } from '../../../components/auth-gates';
import { Sidebar } from '../../../components/sidebar';
import { ToolWorkspace } from '../../../components/tool-workspace';
import { getToolBySlug } from '../../../lib/tools';

export default async function ToolPage({ params }) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);

  if (!tool) {
    return <div>Tool not found.</div>;
  }

  return (
    <RequireLogin>
      <div className="min-h-screen bg-base text-slate-900">
        <div className="pointer-events-none fixed inset-0 bg-hero-radial" />
        <div className="mx-auto grid min-h-screen max-w-[1800px] gap-4 p-3 md:p-4 xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-5">
          <Sidebar />
          <main className="min-w-0 py-1">
            <ToolWorkspace key={slug} tool={tool} />
          </main>
        </div>
      </div>
    </RequireLogin>
  );
}