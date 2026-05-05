BẢN PATCH GỘP

- Text to Image chạy qua Windows VPS AutoFlow, model Nano Banana Pro
- Web ảnh có tỷ lệ 16:9 / 4:3 / 1:1 / 3:4 / 9:16 và x1-x4
- Image to Video có ảnh điểm đầu / điểm cuối, tỷ lệ 9:16 / 16:9, x1-x4, thời lượng 4s/6s/8s
- Model mặc định image-to-video: Veo 3.1 Fast (lower priority - leaving 5/10)
- Worker nhận thêm end_image và cố upload end frame nếu có
- Reset state theo slug và remount ToolWorkspace theo slug
