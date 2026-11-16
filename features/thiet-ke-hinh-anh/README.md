# features/thiet-ke-hinh-anh

Code của tính năng này hiện nằm trong `index.html` (bản build 14/11/2026), đánh dấu bằng comment `[features/thiet-ke-hinh-anh]`.

Khi tách app thành nhiều file thật (bước Cloudflare), toàn bộ HTML/CSS/JS riêng của tính năng này chuyển vào folder này, sửa chỉ trong folder này, không động tới các tính năng khác.

## Yêu cầu 33 — Thiết kế hình ảnh qua Gemini (16/11/2026, thay Leonardo đang chờ thẻ)

AI chính đổi từ Leonardo sang **Gemini** — model `gemini-2.5-flash-image`
("Nano Banana", gọi qua `generateContent`, `responseModalities: ["IMAGE"]`).
Bản mới `gemini-3.1-flash-image` / `gemini-3-pro-image` chỉ cân nhắc khi cần 4K.
`config/config.json`: `thiet-ke-hinh-anh.ai_primary` = `gemini`, key `GEMINI_API_KEY`.

### Luồng

Nhân viên giao việc (loại ảnh, kích thước, phong cách, mô tả, ảnh mẫu)
→ `POST /api/tasks` (multipart, `refPhotos` tối đa 4 ảnh, mỗi ảnh ≤ 5MB)
→ Worker gọi Gemini **bất đồng bộ bằng `context.waitUntil`** (tạo ảnh mất
10–60 giây, không chặn response tạo nhiệm vụ) → tiến độ thật theo chặng
(10 prompt đã ghép → 30 đã gửi Gemini → 80 đã nhận ảnh → 100)
→ nhiệm vụ `completed`, ảnh lưu vào cột `result_image`
→ nút "Tải hình ảnh" tải đúng file đó (`GET /api/tasks/:id/result`).

### File liên quan

- `functions/_lib/gemini-image-prompts.js` — **prompt ẩn**: Worker tự ghép prompt
  chuẩn vào brief nhân viên trước khi gọi Gemini; nhân viên không thấy.
  Quy tắc (tài liệu Google + skill Nano Banana): tả cảnh bằng câu chuyện,
  không liệt kê từ khóa rời; ghi rõ ống kính/góc máy/ánh sáng/phong cách/
  tỉ lệ khung; chữ trong ảnh dưới 25 ký tự, tối đa 2–3 cụm; dùng ảnh mẫu
  đính kèm để sửa/ghép nhiều ảnh; lặp từng bước nhỏ. Prompt gửi Gemini bằng
  tiếng Anh (brief tiếng Việt giữ nguyên ý trong phần trích dẫn).
  Map loại ảnh từ đúng các option của select `#anh-type` (Avatar Zalo,
  Banner Zalo, Avatar Facebook, Ảnh bìa Facebook, Avatar YouTube,
  Banner YouTube, Thumbnail YouTube, Avatar TikTok, Video TikTok + "Khác":
  poster, ảnh sản phẩm...); tỉ lệ khung = tỉ lệ gần nhất trong
  1:1 / 3:4 / 4:3 / 9:16 / 16:9 so với Rộng × Cao người dùng nhập.
- `functions/_lib/gemini-image.js` — gọi Gemini (`callGeminiImage`, 1 lần thử,
  timeout 2 phút, host override bằng `GEMINI_API_BASE_URL` để QA trỏ mock)
  + chạy nền `runGeminiImageTask` (cập nhật progress, lưu ảnh, xử lý lỗi).
- `functions/api/tasks/index.js` — nhận `refPhotos` cho `anh`; thiếu
  `GEMINI_API_KEY` thì nhiệm vụ sang `error` ngay lúc tạo kèm lý do rõ ràng.
- `functions/api/tasks/[id]/result.js` — nhánh `anh`: trả đúng bytes ảnh
  với Content-Type theo mime đã lưu, 404 khi chưa có ảnh, chỉ admin hoặc
  chủ nhiệm vụ được xem.
- `functions/_lib/auth.js` — `taskExtras` thêm `has_result_image`.
- `migrations/004-gemini-image-result.sql` + `schema.sql` — cột mới
  `result_image TEXT` (JSON `{mime, data base64, bytes, w, h, aspect, type,
  generated_at, ms}`).
- `index.html` — `FEATURE_AI.anh.main` + picker + khối AI phụ trách = Gemini;
  `onAssign` cho `anh` gửi multipart kèm ảnh mẫu, **không gọi `runSimulation`**;
  poller riêng 5 giây/nhịp (`startAnhPolling`/`pollAnhTasks`) cập nhật % thật
  trên thẻ (không có luồng refresh danh sách định kỳ ngoài Dashboard nên
  riêng `anh` cần poller này); `resumeTask` bỏ qua nhiệm vụ `anh` khi tải
  lại trang (bật poller thay cho mô phỏng); nút `data-dl="image"` tải file
  thật qua `fetchTaskImage`; `drawImagePNG`/`wrapText` (vẽ khung tím giả
  bằng canvas) đã xóa. Thẻ nhiệm vụ `error` hiện rõ lý do trong
  `payload.gemini.error` (thiếu key / Gemini chặn / timeout).

### Quyết định lưu trữ

**CHỈ 1 ảnh / nhiệm vụ** (bản mới nhất ghi đè, không giữ 5 phiên bản như file
HTML — ảnh base64 1,5–2,5MB/phiên bản sẽ phình D1, theo tinh thần cap phiên
bản của soát bảo mật run-1 ngày 16/11/2026). Nhiệm vụ xin nhiều ảnh
(`count` > 1) hiện vẫn chỉ trả 1 ảnh — vòng sau mới tính tạo nhiều ảnh.

### Key

Key Gemini **KHÔNG** nằm trong repo/file/chat (config `keys` để trống).
Live: anh Dy đã tự dán `GEMINI_API_KEY` vào Cloudflare (Variables and
secrets, Production, dạng Secret, 16:51 16/11/2026) — secret mới thêm cần
**redeploy mới có hiệu lực** (push code lên main là Cloudflare tự redeploy).

### QA (mock — chưa có key ở local)

- Backend E2E 42/42 PASS (`~/workspace/qa-app2/qa33-gemini-image/run_e2e_yc33.py`):
  mock Gemini trả PNG thật đúng tỉ lệ, tiến độ server giữ 30% qua nhiều nhịp
  poll rồi 100 (không tăng theo nhịp 650ms), ảnh lưu + tải đúng bytes,
  phân quyền 403/401, kèm 2 ảnh mẫu (mock nhận 2 inlineData), đường lỗi
  (SAFETY / không có ảnh / thiếu key / quota 429 / sai ảnh 400),
  migration 004 chạy sạch trên DB cũ, đo D1 local: PNG thật 2.499.087 byte
  → base64 3.332.116 ký tự → cột `result_image` 3.332.167 ký tự, đọc lại
  khớp 100% (lưu ý: đây là SQLite local — D1 live cần kiểm lại sau khi
  deploy bằng 1 lần gọi Gemini thật).
- Frontend Chromium thật 31/31 PASS (`qa33-frontend.py`, 390/768/1440):
  giao việc thật → giữ "Đang chạy · 30%" qua 6 lần lấy mẫu 1 giây → hoàn
  thành → tải được PNG 1280×720 (~2,5MB) cả khi không và khi có ảnh mẫu;
  không lỗi console, không tràn ngang. (Ghi chú QA: Chrome trong VM chặn
  mọi điều hướng localhost — ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS —
  nên script nhảy qua trang `file://` rồi `location.href` sang dev server;
  lỗi này chỉ ở môi trường QA, không phải lỗi app.)
- **Còn chờ key live** (sau push + redeploy): gọi thật 1 lần + đo thời gian
  + kiểm dung lượng ảnh thật + watermark SynthID.
