PATCH V9 - FIX IMAGE-TO-VIDEO UPLOAD ĐÚNG START/END + CHỈ NHẬN VIDEO

Sửa chính:
- Bỏ hoàn toàn cách upload frame bằng input[type=file] chung.
- Click Start/End rồi bắt filechooser riêng của Flow để upload ảnh vào đúng Start frame / End frame.
- Nếu không mở được filechooser riêng của Start/End thì fail job, không upload ảnh vào khung chat nữa.
- Image-to-video chỉ chấp nhận kết quả video (.mp4/.webm/.mov). Nếu tải nhầm ảnh thì fail để không trả ảnh về web.

Log đúng:
UPLOADING_ASSETS - Đang mở file picker riêng của Start frame.
UPLOADING_ASSETS - Đã upload ảnh vào đúng Start frame qua filechooser.
UPLOADING_ASSETS - Đang mở file picker riêng của End frame.
UPLOADING_ASSETS - Đã upload ảnh vào đúng End frame qua filechooser.

Log sai cũ đã bỏ:
Đã upload ... qua input #1/1
