LEGALPROTECH AUTOFLOW SETTINGS + RESULT UPLOAD FIX

Bản này sửa 3 phần:
1. Frontend thêm chọn "Số video / prompt" từ 1 đến 4.
2. API lưu videosPerPrompt, requestedCount và trả lại trong trạng thái job.
3. Worker đọc model / tỷ lệ / thời lượng / videosPerPrompt từ job, cố set trên Flow, tạo đủ số lượng và upload file/video URL về web.

Khuyến nghị .env.local:
FLOW_FAST_SELECTOR_MODE=true
FLOW_FORCE_COORDINATES=false
FLOW_COORDINATE_HELPER=false
FLOW_SKIP_SETTINGS=false
FLOW_KEEP_BROWSER_OPEN=true
FLOW_RESULT_READY_POLL_MS=2000
FLOW_DOWNLOAD_TIMEOUT_MS=30000
FLOW_VIDEO_BLOB_MAX_MB=500
FLOW_JOB_STORE_DIR=C:\legalprotech\flow-jobs
FLOW_DOWNLOAD_DIR=C:\legalprotech\flow-downloads

Sau khi đè file:
taskkill /F /IM node.exe
cd C:\Users\asus\Downloads\Compressed\legalprotech\frontend
npm run dev
# terminal 2
npm run worker