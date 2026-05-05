BẢN FIX: /configaccount + Worker tự điền Google Login

File thêm/sửa:
- frontend/app/configaccount/page.js
- frontend/components/config-account-workspace.js
- frontend/app/api/configaccount/route.js
- frontend/scripts/windows-flow-worker.mjs

Cách dùng:
1. Giải nén zip, dán đè vào thư mục legalprotech.
2. Trong frontend/.env.local nên thêm:
   CONFIG_ACCOUNT_ADMIN_KEY=dev_worker_key
   CONFIG_ACCOUNT_SECRET=doi_chuoi_bi_mat_khac_khi_len_vps
   FLOW_ACCOUNT_CONFIG_PATH=C:\legalprotech\flow-account-config.json
   FLOW_WORKER_MODE=playwright
   FLOW_URL=https://labs.google/fx/tools/flow
   CHROME_PROFILE_DIR=C:\legalprotech\chrome-flow-profile
   CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
   FLOW_LOGIN_WAIT_MS=600000
   FLOW_KEEP_BROWSER_OPEN=true

3. Restart web:
   npm run dev

4. Mở:
   http://localhost:3000/configaccount

5. Nhập mã quản trị, email, mật khẩu Google Ultra rồi lưu.
   Mã quản trị mặc định local đang là WORKER_API_KEY, ví dụ dev_worker_key.

6. Restart worker:
   npm run worker

Lưu ý:
- Worker chỉ tự điền email/mật khẩu khi gặp màn hình Google Login.
- Worker KHÔNG tự vượt captcha, 2FA hoặc xác minh bất thường. Nếu Google hỏi, xử lý thủ công trong Chrome Worker.
- Khi lên VPS thật, đổi CONFIG_ACCOUNT_ADMIN_KEY và CONFIG_ACCOUNT_SECRET sang chuỗi mạnh, không dùng dev_worker_key.
