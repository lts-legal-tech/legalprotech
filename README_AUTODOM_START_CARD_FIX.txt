# LegalProTech Worker Auto DOM Start Card Fix

Fix lỗi Flow bấm New project rồi đứng ở màn Start creating.

Điểm sửa chính:
- Nếu đã thấy màn "Start creating or drop media" thì không bấm New project tiếp.
- Tự tìm card Start creating bằng DOM/bounding box và thử nhiều điểm bên trong card.
- Fallback dùng tỉ lệ viewport, không dùng fixed x/y.
- Chỉ đi tiếp khi detect đúng prompt "What do you want to create?".
