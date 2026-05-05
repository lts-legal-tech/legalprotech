# Bản vá Flow Automation LegalProTech

## Nguyên nhân treo chính

- `background.js` chỉ lấy job tại thời điểm tab `flow.google` báo `complete`. Nếu job đến sau hoặc Flow đã mở sẵn thì extension không gửi job vào content script.
- Content script có gửi `FLOW_AUTOMATION_STATUS` về background, nhưng background cũ không có `runtime.onMessage` để cập nhật lại Local Agent. Vì vậy website/agent dễ đứng ở trạng thái “Flow đã mở...” mà không biết extension đang làm gì.
- Payload ảnh từ frontend là `imagePreviewDataUrl`, trong khi content script cũ chỉ đọc `imageDataUrl` / `inputImageDataUrl`.
- Selector UI của Flow quá hẹp: chỉ tìm theo text hiển thị, chưa đọc aria-label/title/placeholder/data-testid, nên dễ không tìm được nút tạo project hoặc ô prompt.

## File đã sửa / thêm

- `chrome-extension-flow/background.js`
- `chrome-extension-flow/content-flow.js`
- `chrome-extension-flow/manifest.json`
- `chrome-extension-flow/README.md`
- `frontend/components/tool-workspace.js`
- `frontend/package.json`
- `frontend/scripts/local-agent.js`

## Cách dùng nhanh

1. Giải nén zip này đè lên thư mục project gốc.
2. Vào `chrome://extensions` → reload extension `LegalProTech Flow Automation Bridge`.
3. Reload tab Flow nếu đang mở.
4. Mở terminal trong `frontend`:

```bash
npm run agent
```

5. Mở terminal khác trong `frontend`:

```bash
npm run dev
```

6. Vào web, nhập prompt và bấm tạo video.

Nếu Flow không tự mở đúng trang, chạy:

```bash
FLOW_URL=https://labs.google/fx/tools/flow npm run agent
```
