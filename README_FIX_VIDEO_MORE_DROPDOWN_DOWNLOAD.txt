README_FIX_VIDEO_MORE_DROPDOWN_DOWNLOAD.txt

Bản fix này xử lý trường hợp Google Flow giấu nút Download trong dropdown More của video card.

Cập nhật chính:
- Không chờ timeout lâu với selector Download không tồn tại.
- Tìm các nút More/Menu/Actions trên video card, ưu tiên phần tử thấp/phải hơn toolbar.
- Bấm More rồi tìm Download/Tải xuống/Export/Save trong dropdown.
- Nếu không có event download, quét video/blob/http candidate sau khi mở menu.

Env gợi ý:
FLOW_SKIP_SETTINGS=false
FLOW_VIDEO_MORE_MAX_ATTEMPTS=12
FLOW_AFTER_MORE_CLICK_DELAY_MS=700
FLOW_DOWNLOAD_TIMEOUT_MS=30000
FLOW_RESULT_READY_TIMEOUT_MS=600000
