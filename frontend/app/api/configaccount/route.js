import { NextResponse } from 'next/server';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

const CONFIG_PATH = process.env.FLOW_ACCOUNT_CONFIG_PATH || path.join(process.cwd(), '.flow-account-config.json');
const ALGORITHM = 'aes-256-gcm';

function adminKey() {
  return process.env.CONFIG_ACCOUNT_ADMIN_KEY || process.env.WORKER_API_KEY || 'dev_worker_key';
}

function encryptionSecret() {
  return process.env.CONFIG_ACCOUNT_SECRET || process.env.WORKER_API_KEY || 'legalprotech-local-dev-secret-change-me';
}

function checkAuth(request, body = {}) {
  const provided = request.headers.get('x-config-key') || body.adminKey || '';
  return provided && provided === adminKey();
}

function keyBuffer() {
  return crypto.createHash('sha256').update(encryptionSecret()).digest();
}

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function publicConfig(config) {
  return {
    email: config.email || '',
    hasPassword: Boolean(config.passwordEncrypted),
    autoLoginEnabled: config.autoLoginEnabled !== false,
    updatedAt: config.updatedAt || null,
    configPath: CONFIG_PATH,
  };
}

export async function GET(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ success: false, error: 'Sai mã quản trị cấu hình.' }, { status: 401 });
  }

  const config = await readConfig();
  return NextResponse.json({ success: true, config: publicConfig(config) });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  if (!checkAuth(request, body)) {
    return NextResponse.json({ success: false, error: 'Sai mã quản trị cấu hình.' }, { status: 401 });
  }

  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  const autoLoginEnabled = body.autoLoginEnabled !== false;

  if (!email) {
    return NextResponse.json({ success: false, error: 'Thiếu email Google Ultra.' }, { status: 400 });
  }

  const oldConfig = await readConfig();
  const nextConfig = {
    ...oldConfig,
    email,
    autoLoginEnabled,
    updatedAt: new Date().toISOString(),
  };

  if (password) {
    nextConfig.passwordEncrypted = encrypt(password);
  } else if (!oldConfig.passwordEncrypted) {
    return NextResponse.json({ success: false, error: 'Thiếu mật khẩu.' }, { status: 400 });
  }

  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
  return NextResponse.json({ success: true, config: publicConfig(nextConfig) });
}
