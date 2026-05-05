# LegalProTech Frontend Full Source

Bản này đã gộp các fix AutoFlow Windows Worker mới nhất và đổi default model video sang `Veo 3.1 Fast (lower priority - leaving 5/10)`.

## Chạy local

```powershell
cd frontend
npm install
npm run dev
```

Terminal thứ 2:

```powershell
cd frontend
npm run worker
```

## Cấu hình

Copy `.env.example` thành `.env.local`, sau đó điền key thật trên máy/VPS của anh. Không commit `.env.local`.

## Lưu ý

- Source không kèm `node_modules` và `.next`.
- Worker mặc định dùng Flow URL: `https://labs.google/fx/tools/flow`.
- Model video mặc định: `veo-3.1-fast-lower-priority`.
