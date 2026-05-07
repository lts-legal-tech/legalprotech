export const PROFILE_KEY = 'legalprotech-current-profile';
export const ADMIN_KEY = 'legalprotech-admin-session';

function readJsonStorage(key) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function normalizeUserId(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return clean.toLowerCase().replace(/[^a-z0-9@._:-]/g, '_');
}

export function getCurrentUserScope() {
  const profile = readJsonStorage(PROFILE_KEY);
  const admin = readJsonStorage(ADMIN_KEY);
  const rawUserId = profile?.id || profile?.email || (admin?.username ? `admin:${admin.username}` : '');
  const userId = normalizeUserId(rawUserId);
  return { userId, profile, admin };
}

export function scopedStorageKey(base, explicitUserId) {
  const userId = normalizeUserId(explicitUserId || getCurrentUserScope().userId || 'anonymous');
  return `${base}:${userId || 'anonymous'}`;
}

export function userRequestHeaders() {
  const { userId } = getCurrentUserScope();
  return userId ? { 'x-user-id': userId } : {};
}

export function appendUserToFormData(formData) {
  const { userId } = getCurrentUserScope();
  if (userId && formData && typeof formData.set === 'function') {
    formData.set('user_id', userId);
  }
  return userId;
}

export function withUserQuery(url) {
  const { userId } = getCurrentUserScope();
  if (!userId) return url;
  const joiner = String(url).includes('?') ? '&' : '?';
  return `${url}${joiner}user_id=${encodeURIComponent(userId)}`;
}
