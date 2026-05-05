BẢN VÁ: SỬA LỖI DOWNLOAD SAI BẢN / UPLOAD FILE LỖI LÊN WEB
Ngày vá: 26/04/2026

1. LỖI TÌM THẤY
- Worker tải về file có đuôi .zip từ Flow.
- Bên trong file .zip mới là video MP4 thật.
- Bản cũ upload nguyên file .zip lên public/flow-results nhưng lại ghi nhận như video.
- Kết quả: website đưa URL .zip vào thẻ <video>, nên mở/tải trên web bị lỗi hoặc video không chạy.

Ví dụ trong bản anh gửi:
public/flow-results/flow_1777198316311_n3ld0b3/1777198570048-flow_1777198316311_n3ld0b3-1-download.zip
Bên trong có video thật: cat_202604261716.mp4

2. ĐÃ SỬA NHỮNG GÌ
- frontend/scripts/windows-flow-worker.mjs
  + Nếu Worker tải phải ZIP, tự tách file media thật bên trong ZIP trước khi upload lên web.
  + Chỉ cho upload file media hợp lệ: mp4, webm, mov, png, jpg, jpeg, webp.
  + Nếu file tải về không phải media hợp lệ thì báo lỗi, không đẩy file lỗi lên website.

- frontend/lib/flow-job-store.js
  + API nhận kết quả cũng tự kiểm tra file upload.
  + Nếu nhận ZIP thì tự tách MP4/WebM/MOV/ảnh bên trong rồi mới lưu vào public/flow-results.
  + Chặn trường hợp ZIP/HTML/file lạ bị lưu nhầm thành video.

- frontend/app/api/flow/files/[jobId]/[fileName]/route.js
  + Nếu job cũ đang trỏ tới file .zip, API sẽ tự tách media bên trong ZIP và trả về video/mp4 cho player.
  + Hỗ trợ range request để video vẫn tua/xem được trên trình duyệt.

3. CÁCH ĐÈ FILE
Giải nén file legalprotech-fix-download-upload-zip.zip và đè vào đúng thư mục project gốc.
Cấu trúc trong zip đã để sẵn:
legalprotech/frontend/...

Nếu đang chạy server/worker thì tắt trước:
Ctrl + C ở các cửa sổ PowerShell đang chạy npm run dev / npm run start / npm run worker

Sau khi đè file, vào frontend:
cd C:\Users\asus\Downloads\Compressed\legalprotech-full-source-autoflow-final\legalprotech\frontend

Xóa build cũ để tránh Next dùng cache:
Remove-Item -Recurse -Force .next

Chạy lại:
npm install
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000

Mở thêm cửa sổ PowerShell khác để chạy worker:
cd C:\Users\asus\Downloads\Compressed\legalprotech-full-source-autoflow-final\legalprotech\frontend
npm run worker

4. LƯU Ý QUAN TRỌNG
- Nếu .env.local đang để FLOW_WORKER_MODE=dry-run thì hệ thống chỉ trả video mẫu, không phải video thật từ Flow.
- Muốn chạy Flow thật phải để:
FLOW_WORKER_MODE=playwright

- Với kết quả cũ đã lỡ lưu dạng ZIP: sau khi vá, API có thể tự tách video trong ZIP khi player gọi URL cũ.
- Với job mới: Worker sẽ tách MP4 trước khi upload, nên danh sách kết quả sẽ không còn đưa file ZIP lên web như video nữa.
