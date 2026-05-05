'use client';
import { useEffect, useState } from 'react';

const PROFILE_KEY = 'legalprotech-current-profile';
const ADMIN_KEY = 'legalprotech-admin-session';

function readProfile() {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readAdmin() {
  try {
    const raw = window.localStorage.getItem(ADMIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function LoadingScreen({ label }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="panel rounded-[28px] p-6 text-center">
        <div className="text-sm font-medium text-slate-600">{label}</div>
      </div>
    </div>
  );
}

export function RequireLogin({ children }) {
  const [state, setState] = useState('checking');

  useEffect(() => {
    const profile = readProfile();
    const admin = readAdmin();
    const isActiveUser = !!profile && profile.status === 'active';
    const isAdmin = !!admin?.loggedIn;

    if (!isActiveUser && !isAdmin) {
      window.location.replace('/');
      return;
    }

    setState('ready');
  }, []);

  if (state !== 'ready') return <LoadingScreen label="Cần đăng nhập để vào legalprotech" />;
  return children;
}

export function RequireAdmin({ children }) {
  const [state, setState] = useState('checking');

  useEffect(() => {
    const admin = readAdmin();
    if (!admin?.loggedIn) {
      window.location.replace('/');
      return;
    }
    setState('ready');
  }, []);

  if (state !== 'ready') return <LoadingScreen label="Đang xác minh quyền quản trị" />;
  return children;
}
