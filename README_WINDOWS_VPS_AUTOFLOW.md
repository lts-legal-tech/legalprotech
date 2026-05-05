# LegalProTech - Windows VPS AutoFlow Worker Handoff

Bản này đã đổi luồng video từ **Local Agent/Chrome Extension trên máy user** sang **Windows VPS Worker tự chạy Flow**.

## 1. Luồng mới

```text
User máy tính / điện thoại
  -> Frontend legalprotech
  -> POST /api/flow/jobs
  -> Next API lưu job vào .flow-jobs + public/flow-inputs
  -> Windows VPS Worker claim job qua /api/internal/worker/claim
  -> Worker mở Chrome/Flow bằng Playwright
  -> Worker upload kết quả về /api/internal/worker/jobs/:jobId/result
  -> Frontend polling /api/flow/jobs/:jobId để hiển thị kết quả
```

User không cần cài extension, không cần mở Flow, dùng điện thoại vẫn tạo job được.

## 2. File chính đã thêm/sửa

```text
frontend/components/tool-workspace.js
frontend/lib/flow-client.js
frontend/lib/flow-job-store.js
frontend/scripts/windows-flow-worker.mjs
frontend/app/api/flow/jobs/route.js
frontend/app/api/flow/jobs/[jobId]/route.js
frontend/app/api/flow/jobs/[jobId]/download/route.js
frontend/app/api/flow/results/action/route.js
frontend/app/api/flow/results/[token]/route.js
frontend/app/api/internal/worker/claim/route.js
frontend/app/api/internal/worker/jobs/[jobId]/heartbeat/route.js
frontend/app/api/internal/worker/jobs/[jobId]/status/route.js
frontend/app/api/internal/worker/jobs/[jobId]/result/route.js
frontend/app/api/internal/worker/jobs/[jobId]/fail/route.js
frontend/app/shared/[token]/page.js
frontend/package.json
frontend/.env.example
```

## 3. API cho user/browser

### Tạo job AutoFlow

```http
POST /api/flow/jobs
Content-Type: multipart/form-data
```

Field:

```text
tool
model
aspect_ratio
prompt
count
duration
frame
image? optional
```

Response:

```json
{
  "success": true,
  "jobId": "flow_...",
  "token": "share_...",
  "status": "QUEUED",
  "message": "Đã nhận lệnh. Windows VPS Worker sẽ tự động lấy job và chạy Flow.",
  "zipUrl": "/api/flow/jobs/flow_.../download",
  "expiresAt": "...",
  "results": []
}
```

### Xem trạng thái job

```http
GET /api/flow/jobs/:jobId
```

Status hỗ trợ:

```text
QUEUED
CLAIMED
OPENING_FLOW
CREATING_PROJECT
UPLOADING_ASSETS
SUBMITTING_PROMPT
GENERATING
FETCHING_RESULTS
PACKAGING
COMPLETED
FAILED
CANCELLED
EXPIRED
```

### Action kết quả

```http
POST /api/flow/results/action
Content-Type: application/json
```

Body:

```json
{
  "jobId": "flow_...",
  "token": "share_...",
  "action": "save_all | delete_all | keep_3_days | share"
}
```

## 4. API nội bộ cho Windows VPS Worker

Tất cả API nội bộ dùng header:

```http
x-worker-key: <WORKER_API_KEY>
```

### Claim job

```http
POST /api/internal/worker/claim
```

Body:

```json
{
  "workerId": "windows-vps-01"
}
```

### Heartbeat

```http
POST /api/internal/worker/jobs/:jobId/heartbeat
```

### Update status

```http
POST /api/internal/worker/jobs/:jobId/status
```

Body:

```json
{
  "status": "GENERATING",
  "message": "Flow đang tạo video",
  "workerId": "windows-vps-01"
}
```

### Upload kết quả dạng file

```http
POST /api/internal/worker/jobs/:jobId/result
Content-Type: multipart/form-data
```

Field:

```text
file
prompt
promptIndex
duration
aspectRatio
complete=true|false
```

### Upload kết quả dạng URL ngoài

```http
POST /api/internal/worker/jobs/:jobId/result
Content-Type: application/json
```

Body:

```json
{
  "complete": true,
  "results": [
    {
      "type": "video",
      "title": "Video 1",
      "prompt": "...",
      "url": "https://...mp4",
      "thumbnail": "https://...jpg",
      "duration": 8,
      "aspectRatio": "16:9"
    }
  ]
}
```

### Báo lỗi job

```http
POST /api/internal/worker/jobs/:jobId/fail
```

## 5. Cách chạy dev trên máy hiện tại

Trong thư mục `frontend`:

```bash
npm install
npm run dev
```

Mở terminal khác:

```bash
npm run worker
```

Mặc định worker đang ở `FLOW_WORKER_MODE=dry-run`, nghĩa là mô phỏng AutoFlow để test end-to-end: user tạo job -> worker claim -> job completed -> frontend có kết quả mẫu.

## 6. Cách chạy thật trên Windows VPS

Trong `.env.local` hoặc biến môi trường của Windows VPS:

```env
WORKER_API_KEY=change_this_worker_secret
FLOW_API_BASE_URL=http://127.0.0.1:3000
FLOW_WORKER_ID=windows-vps-01
FLOW_WORKER_MODE=playwright
FLOW_URL=https://flow.google.com/
CHROME_PROFILE_DIR=C:\legalprotech\chrome-flow-profile
CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

Sau đó cài Playwright browser:

```bash
npx playwright install chromium
```

Chạy worker:

```bash
npm run worker
```

Lần đầu worker mở Chrome, cần đăng nhập Flow trong profile Chrome đó. Từ lần sau profile sẽ được giữ trong `CHROME_PROFILE_DIR`.

## 7. Selector cần chỉnh theo UI Flow thật

Playwright worker có các selector env để chỉnh khi UI Flow thay đổi:

```env
FLOW_NEW_PROJECT_SELECTOR=text=/New project|Create project|Dự án mới|Tạo mới/i
FLOW_PROMPT_SELECTOR=textarea||[contenteditable="true"]||input[type="text"]
FLOW_FILE_INPUT_SELECTOR=input[type="file"]
FLOW_GENERATE_SELECTOR=text=/Generate|Create|Tạo|Submit|Run/i
FLOW_RESULT_DOWNLOAD_SELECTOR=text=/Download|Tải xuống|Export/i
FLOW_GENERATE_WAIT_MS=180000
FLOW_DOWNLOAD_TIMEOUT_MS=120000
FLOW_KEEP_BROWSER_OPEN=true
```

Các selector tách bằng `||`, worker sẽ thử lần lượt.

## 8. Khác biệt so với bản cũ

Bản cũ:

```text
Browser user -> Local Agent localhost -> Chrome Extension user -> Flow
```

Bản mới:

```text
Browser user -> Next API -> Windows VPS Worker -> Chrome/Flow trên VPS -> Next API -> Browser user
```

Vì vậy điện thoại, máy tính, hoặc bất kỳ trình duyệt nào đều dùng được như nhau.
