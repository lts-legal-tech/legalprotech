import { AdminLoginWorkspace } from '../../../components/admin-login-workspace';

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen bg-base text-slate-900">
      <div className="pointer-events-none fixed inset-0 bg-hero-radial" />
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-4 py-8 md:px-6">
        <div className="w-full">
          <AdminLoginWorkspace />
        </div>
      </div>
    </div>
  );
}
