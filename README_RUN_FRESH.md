# LegalProTech - Fresh Run Guide

## Cài lại frontend

```powershell
cd C:\Users\asus\Downloads\Compressed\legalprotech\frontend
npm install
npx playwright install chromium
copy .env.local.example .env.local
notepad .env.local
```

Trong `.env.local`, giữ `OPENAI_API_KEY=` trống hoặc thay key mới. Không dùng lại key cũ đã dán ra chat.

## Chạy web/API

PowerShell 1:

```powershell
cd C:\Users\asus\Downloads\Compressed\legalprotech\frontend
npm run dev
```

## Chạy Worker AutoFlow

PowerShell 2:

```powershell
cd C:\Users\asus\Downloads\Compressed\legalprotech\frontend
npm run worker
```

## Cấu hình tài khoản Google Ultra/Flow

Mở:

```text
http://localhost:3000/configaccount
```

Mã quản trị mặc định trong `.env.local.example` là:

```text
dev_worker_key
```

Nếu Chrome profile đã đăng nhập Google Ultra rồi, để:

```env
FLOW_AUTO_LOGIN_ENABLED=false
```

Nếu lên VPS mới và muốn Worker tự điền email/password, đổi lại `true`, nhưng captcha/2FA vẫn cần xử lý thủ công.

## Lưu ý

- Không cần chạy backend .NET để test AutoFlow mới. Web/API job nằm trong Next.js trên port 3000.
- Cần chạy đồng thời 2 terminal: `npm run dev` và `npm run worker`.
- Kết quả tải về lưu ở `C:\legalprotech\flow-downloads` và được upload về API để web hiển thị.
- Nếu Flow UI thay đổi, Worker có thể cần cập nhật selector.
