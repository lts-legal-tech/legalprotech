# Chrome Extension Flow Bridge

## Bản sửa 0.2.0

Đã sửa các điểm gây treo automation:

1. Extension không còn chỉ lấy job đúng lúc tab Flow vừa load xong. Extension sẽ tự quét lại khi tab Flow reload, được focus, content script sẵn sàng, và theo chu kỳ.
2. Background đã relay trạng thái từ content script về Local Agent qua `/automation/status` hoặc `/jobs/:jobId`.
3. Tự inject lại `content-flow.js` nếu tab Flow đã mở sẵn nhưng content script chưa chạy.
4. Hỗ trợ thêm URL Flow dạng `labs.google/fx/tools/flow` ngoài `flow.google`.
5. Tìm nút/ô nhập tốt hơn bằng cả text, aria-label, title, placeholder, data-testid và shadow DOM.
6. Sửa mismatch ảnh đầu vào: frontend gửi `imagePreviewDataUrl`, content script giờ nhận đúng key này.

## Cài / reload extension

1. Mở `chrome://extensions`.
2. Bật `Developer mode`.
3. Nếu đã load extension cũ: bấm nút reload hình mũi tên xoay trên card `LegalProTech Flow Automation Bridge`.
4. Nếu chưa load: bấm `Load unpacked` và chọn thư mục `chrome-extension-flow`.
5. Reload tab Flow đang mở.

## Chạy Local Agent

Mở terminal trong thư mục `frontend` rồi chạy:

```bash
npm run agent
```

Mở terminal khác để chạy web:

```bash
npm run dev
```

Nếu Flow đang chạy ở URL khác, chạy agent như sau:

```bash
FLOW_URL=https://labs.google/fx/tools/flow npm run agent
```

Nếu Chrome tải file về thư mục khác Downloads mặc định:

```bash
FLOW_DOWNLOAD_DIR="D:\\Downloads" npm run agent
```

## Luồng đúng sau khi sửa

Website → `Local Agent /jobs` → mở Flow → Extension lấy `/automation/next` → content script tạo project, dán prompt, bấm Generate → Extension gửi trạng thái về agent → Agent theo dõi Downloads và upload file về website.
