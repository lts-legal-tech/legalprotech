Backend media config

Da cau hinh san:
- Google API key trong appsettings.json > Providers > Google > ApiKey
- Default video model: veo-3.1-fast-generate-preview
- Default image model: gemini-3.1-flash-image-preview
- Image fallback model: imagen-4

Luu y:
- Luong OpenAI/chatbot khong bi dong vao.
- Google key khong dung chung cho Banana. Neu can Banana, backend team phai thay Providers:Banana:ApiKey bang key rieng.
- JobStore hien tai da default model theo Google fast/video va Google image, nhung provider service van la khung de backend team noi request/poll that.
