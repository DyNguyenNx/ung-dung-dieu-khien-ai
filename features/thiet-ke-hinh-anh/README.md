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

## Yêu cầu 35 — Thiết kế hình ảnh qua Pollinations (anh chốt 18:17 16/11/2026)

Thay Gemini (YC33) vì quota free của Gemini cho model tạo ảnh = 0 (kiểm chứng
18:10 16/11/2026 trên trang rate-limit AI Studio — giới hạn 0 ở cả RPM/TPM/RPD,
chờ reset không khắc phục được). Model chốt: `black-forest-labs/flux.2-klein-4b`
(alias flux-klein), 0.005 Pollen/ảnh, tối đa 10 ảnh mẫu, W×H tự chọn.

- Đường chính `POST /v1/images/generations` (JSON, `response_format: "b64_json"`);
  nhánh có ảnh mẫu `POST /v1/images/edits` multipart, lặp field `image` cho mỗi
  ảnh mẫu (theo APIDOCS.md chính thức của Pollinations). Auth `Authorization:
  Bearer <key sk_>` từ env `POLLINATIONS_API_KEY`.
- Kích thước: klein-4b yêu cầu mỗi cạnh ≥ 256px, tổng ≤ 2.359.296 pixel —
  `clampSize()` thu nhỏ giữ tỉ lệ khi vượt (vd 2560×1440 → 2048×1152, đã
  kiểm bằng mock). Mime ảnh đoán từ magic bytes của base64 (`sniffMime`)
  vì Pollinations không trả mime kèm `b64_json`.
- Ảnh quá lớn làm D1 trả `SQLITE_TOOBIG` khi lưu `result_image` (mock PNG
  noise 2048×1152 ~6,5MB, base64 ~8,7 triệu ký tự — phát hiện khi QA):
  runner dịch thành lý do tiếng Việt, bảo nhân viên giao lại với kích
  thước nhỏ hơn (vd 1280×720). Ảnh thật từ Pollinations thường nhỏ hơn
  nhiều, nhưng vẫn cần kiểm dung lượng ảnh thật 2048×1152 khi kiểm live.
- Lỗi dịch sang tiếng Việt: 401 key sai/thiếu, 402 hết Pollen, 429 quá tải
  (kèm Retry-After), 422/400 nội dung bị chặn. Thiếu key → nhiệm vụ sang
  `error` ngay lúc tạo, lý do trong `payload.pollinations.error`.
- Prompt ẩn dùng chung module `gemini-image-prompts.js` (không chứa gì riêng
  của Gemini). Khung chạy nền + lưu D1 `result_image` giữ nguyên YC33 —
  không cần migration. `gemini-image.js` đã xoá (không còn ai dùng).
- **Key: ĐÃ CÓ** — anh đã tạo key + tự dán vào Cloudflare làm secret
  `POLLINATIONS_API_KEY` + redeploy (18:25 16/11/2026, 5 secret Production).
  Key Gemini (`GEMINI_API_KEY`) GIỮ LẠI trên Cloudflare tới khi Pollinations
  chạy ngon trên live rồi mới xóa. Chỉ còn kiểm live sau khi push: field
  multipart `image` có được klein-4b nhận đúng nhiều ảnh mẫu không, lỗi
  402 hết Pollen hiển thị đúng không, ảnh/kích thước/thời gian thật.

### QA (mock — key thật chưa có ở local lúc QA)

- Backend E2E **45/45 PASS** + frontend Chromium thật 390/768/1440
  **31/31 PASS** (`~/workspace/qa-app2/qa35-pollinations-image/`): mock trả
  PNG thật đúng kích thước yêu cầu; giao việc thật (có/không ảnh mẫu,
  1280×720) → tải được ảnh PNG thật 1280×720 (~880KB); đường lỗi
  401/402/429/422 + thiếu key → error ngay lúc tạo; clamp 2560×1440 →
  2048×1152; phân quyền 403/401; không lỗi console, không tràn ngang.
- Hai lỗi phát hiện khi QA, đã sửa trong commit này: (1) ảnh quá lớn →
  `SQLITE_TOOBIG` (xem trên); (2) `ReferenceError: AppState is not
  defined` ở `sigFeatCounts` — `document.fonts.ready` có thể gọi
  `sigDrawLinks` trước khi block script sau định nghĩa `window.AppState`
  (lỗi có từ YC32, không phải do YC35; đã sửa bằng cách dùng
  `window.AppState` có kiểm tra tồn tại).

## Yêu cầu 36 — Nút "Chỉnh tiếp trên Canva" (anh chốt 18:44 16/11/2026)

- Trên thẻ nhiệm vụ Thiết kế hình ảnh ĐÃ HOÀN THÀNH: nút "Chỉnh tiếp trên
  Canva" (cạnh nút "Tải hình ảnh"). Bấm → server tải ảnh lên Canva làm
  asset rồi tạo design từ ảnh đó, trả `edit_url` → mở tab mới vào trình
  sửa Canva. Ảnh vào design dạng 1 ảnh phẳng duy nhất (API không dựng sẵn
  bố cục/chữ — đã báo anh). Link chỉnh sửa hết hạn sau 30 ngày; design
  trống tự xoá sau 7 ngày nếu không ai sửa.
- Chưa kết nối: admin thấy nút "Kết nối Canva" (mở luồng OAuth, cấp quyền
  một lần); nhân viên thấy dòng "Chưa kết nối Canva — nhờ admin kết nối...".
  Chưa cấu hình client ID/secret thì admin thấy dòng hướng dẫn thêm secret.
- Auth: Canva Connect API, OAuth 2.0 Authorization Code + PKCE (S256, bắt
  buộc), không có key tĩnh. Client ID/secret đọc từ env
  `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` (Cloudflare secret).
  Redirect URI đăng ký trên canva.dev:
  `https://ung-dung-dieu-khien-ai.pages.dev/api/canva/callback`.
  Scopes: `asset:write design:content:write design:meta:read`.
- Backend: lib `functions/_lib/canva.js` (PKCE, đổi/refresh token, upload
  asset + poll job, tạo design, lấy lại design); endpoints
  `GET /api/canva/auth` (chỉ admin, sinh state + verifier, lưu D1 10 phút),
  `GET /api/canva/callback` (đổi code lấy token, lưu D1, về app với
  `?canva=connected|error`), `GET /api/canva/status` (ai cũng gọi được,
  chỉ trả connected/configured — KHÔNG trả token), `POST
  /api/tasks/:id/canva` (chủ nhiệm vụ hoặc admin; chỉ nhiệm vụ 'anh' đã
  hoàn thành và có ảnh).
- Token: bảng `canva_tokens` (migration 005, CHỈ 1 dòng id='admin').
  Refresh token xoay 1 lần — lưu ngay token mới sau khi refresh; dùng lại
  token cũ sẽ thu hồi toàn bộ token nên code có đường đọc lại dòng token
  khi refresh thất bại invalid_grant (một request khác có thể vừa refresh
  xong), còn không thì xoá token và báo admin kết nối lại.
- Bấm lại cùng nhiệm vụ: dùng lại design đã tạo (lấy link mới qua
  `GET /designs/:id` vì link cũ hết hạn sau 30 ngày) thay vì tải trùng
  asset; design cũ đã mất thì tạo mới. Thông tin design lưu ở
  `payload.canva` của nhiệm vụ.
- API Canva (đã đọc docs chính thức canva.dev 16/11/2026):
  `POST /v1/asset-uploads` (octet-stream + header `Asset-Upload-Metadata`
  `{"name_base64": ...}`, trả job `{id, status}`, poll
  `GET /v1/asset-uploads/{jobId}` tới `success` → `asset.id`; ảnh < 50MB),
  `POST /v1/designs` (`design_type: {type:'custom', width, height}` 40–8000px,
  diện tích ≤ 25.000.000px², kèm `asset_id` + `title`, trả
  `design.urls.edit_url`), authorize
  `https://www.canva.com/api/oauth/authorize`, token
  `POST https://api.canva.com/rest/v1/oauth/token` (form-urlencoded, Basic
  auth `base64(client_id:client_secret)`; access token ~4 giờ).
- Lỗi dịch tiếng Việt: chưa cấu hình secret, chưa kết nối, phiên hết hạn
  (cần kết nối lại), upload lỗi (file quá lớn / import thất bại), Canva
  quá tải (429), design đã mất.
- PHẦN ANH PHẢI LÀM (builder không tự đăng ký app hay tạo secret thay anh):
  (1) đăng ký app tại canva.dev (tích đủ 3 scope trên, redirect URI đúng
  y hệt trên); (2) dán `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` vào
  Cloudflare (Pages → Settings → Variables, dạng Secret) + redeploy;
  (3) bấm "Kết nối Canva" trên thẻ nhiệm vụ và cấp quyền một lần.
  Dùng được cả tài khoản Canva miễn phí cho các endpoint này (upload /
  tạo design / xuất) theo docs Canva; autofill / brand template mới cần
  gói Pro trở lên — tính năng này không dùng autofill.
- CHỈ KIỂM ĐƯỢC SAU KHI CÓ OAUTH THẬT TRÊN LIVE: luồng cấp quyền thật
  trên canva.dev, upload + tạo design thật, link edit_url mở đúng trình
  sửa Canva, refresh token xoay thật, tài khoản Canva miễn phí của anh
  có gọi được API không (có nguồn nói Connect API cần gói Teams — docs
  chính thức không ghi giới hạn này cho các endpoint dùng ở đây, cần kiểm
  thật).
