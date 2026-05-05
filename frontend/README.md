# AI Content Workspace frontend

## Public page + internal API
- Public internet chỉ truy cập Next.js app.
- Browser gọi các route `/api/vps/*` trên Next server.
- Next server mới gọi tiếp sang `VPS_API_BASE_URL` là backend nội bộ trong VPS/private network.
- File media/zip từ backend nội bộ được đi qua proxy `/api/vps/asset` để không lộ host private ra ngoài.

## Local test mặc định
- Chạy backend tại `http://127.0.0.1:8080`
- `.env.local`:
  - `VPS_API_BASE_URL=http://127.0.0.1:8080`
  - `VPS_API_KEY=your_internal_api_key`
  - `VPS_MOCK_MODE=false`

## Điểm đã chỉnh trong bản zip này
- Đồng bộ key mặc định frontend/backend
- Báo lỗi rõ hơn khi backend nội bộ không gọi được
- Chặn poll `jobId=undefined` để không spam network
- Có proxy `/api/vps/asset` cho file media và zip

## Windows VPS AutoFlow Worker

Bản mới đã bỏ phụ thuộc Local Agent/Chrome Extension trên máy user cho luồng video. User chỉ tạo job trên web; Windows VPS Worker sẽ tự claim job, mở Flow và trả kết quả về website.

Chạy web:

```bash
npm install
npm run dev
```

Chạy worker dev/dry-run:

```bash
npm run worker
```

Chạy thật với Playwright trên Windows VPS:

```env
WORKER_API_KEY=change_this_worker_secret
FLOW_API_BASE_URL=http://127.0.0.1:3000
FLOW_WORKER_MODE=playwright
FLOW_URL=https://flow.google.com/
CHROME_PROFILE_DIR=C:\\legalprotech\\chrome-flow-profile
CHROME_EXECUTABLE_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
```

Chi tiết xem file gốc: `README_WINDOWS_VPS_AUTOFLOW.md` ở thư mục project.
