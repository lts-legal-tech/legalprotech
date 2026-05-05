# Internal VPS backend for AI Content Workspace

Backend này chạy nội bộ trong VPS/private network.
Frontend public gọi vào backend qua Next proxy route `/api/vps/*`.

## API đã có
- `POST /jobs/create`
- `GET /jobs/status?jobId=...`
- `GET /results/{token}`
- `POST /results/action`

## Static paths nội bộ
- `/files/*`
- `/downloads/*`

Các path này đã được map trong `Program.cs` để frontend public proxy qua `/api/vps/asset` mà không lộ host private.

## Rule chính
- Queue tối đa 40 job đang `QUEUED/PROCESSING`
- Video job thành công luôn trả 5 kết quả
- Có `token`, `expiresAt`, `zipUrl`, `shareUrl`
- Có hỗ trợ `character_id`, `reference_image`
- Có cleanup định kỳ cho batch hết hạn

## Chỗ thay API Veo / Banana thật
- `Services/VeoProviderService.cs`
- `Services/BananaProviderService.cs`
- `Services/JobStore.cs` tại các hàm `AdvanceJob(...)` và `CreateResultFiles(...)`
- `appsettings.json` trong mục `Providers`

## Local test mặc định
- Backend: `dotnet run --urls=http://127.0.0.1:8080`
- Frontend `.env.local`:
  - `VPS_API_BASE_URL=http://127.0.0.1:8080`
  - `VPS_API_KEY=your_internal_api_key`
  - `VPS_MOCK_MODE=false`
