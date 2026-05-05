import { RequireLogin } from '../../components/auth-gates';
import { Sidebar } from '../../components/sidebar';
import { ChatbotWorkspace } from '../../components/chatbot-workspace';

export default function ChatbotPage() {
  return (
    <RequireLogin>
      <div className="min-h-screen bg-base text-slate-900">
        <div className="pointer-events-none fixed inset-0 bg-hero-radial" />
        <div className="mx-auto grid min-h-screen max-w-[1800px] gap-4 p-3 md:p-4 xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-5">
          <Sidebar />
          <main className="min-w-0 py-1">
            <ChatbotWorkspace />
          </main>
        </div>
      </div>
    </RequireLogin>
  );
}