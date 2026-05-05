FIX: Worker trả video placeholder/mock thay vì kết quả Flow thật

Nguyên nhân thường gặp:
1) Worker slot chạy sai thư mục ProjectRoot, nên không đọc đúng .env.local và rơi về FLOW_WORKER_MODE=dry-run.
2) start-flow-slot.ps1 mặc định ProjectRoot=C:\legalprotech, trong khi project thật đang ở thư mục khác, ví dụ C:\Users\asus\Downloads\Compressed\legalprotech.
3) Khi FLOW_WORKER_MODE=dry-run, worker dùng DEFAULT_SAMPLE_VIDEO = https://samplelib.com/... nên web hiển thị video placeholder.

Bản vá này sửa:
- start-flow-slot.ps1 tự nhận ProjectRoot theo vị trí file script, không ép C:\legalprotech nữa.
- start-flow-slots.ps1 cũng tự nhận ProjectRoot theo vị trí file script.
- Mỗi slot ép FLOW_WORKER_MODE=playwright để không bao giờ rơi về dry-run.
- Log đầu worker sẽ hiện Project root, Mode, API base, Chrome profile, Job store để kiểm tra nhanh.

Cách chạy:
cd C:\Users\asus\Downloads\Compressed\legalprotech\frontend
taskkill /F /IM node.exe
taskkill /F /IM chrome.exe
npm run worker:slots

Khi mở 3 cửa sổ worker, phải thấy:
Mode: playwright
Project root: C:\Users\asus\Downloads\Compressed\legalprotech
Job store: C:\Users\asus\Downloads\Compressed\legalprotech\frontend\.flow-jobs

Nếu vẫn thấy dry-run hoặc Project root: C:\legalprotech, nghĩa là bạn đang chạy nhầm project/thư mục cũ.
