# VPS API Contract

POST /jobs/create (multipart/form-data): tool, prompt, model, aspect_ratio, duration|count, image?
GET /jobs/status?jobId=...
GET /results/:token
POST /results/action with `{ token, action }` and actions: save_all | delete_all | keep_3_days | share
