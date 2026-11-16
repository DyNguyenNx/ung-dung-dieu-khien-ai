# features/design-web

Code của tính năng này hiện nằm trong `index.html` (bản build 14/11/2026), đánh dấu bằng comment `[features/design-web]`.
Backend nằm trong `functions/api/` (xem `functions/_lib/telegram.js` cho phần gửi Telegram).

Khi tách app thành nhiều file thật (bước Cloudflare), toàn bộ HTML/CSS/JS riêng của tính năng này chuyển vào folder này, sửa chỉ trong folder này, không động tới các tính năng khác.

## Cập nhật 14/11/2026 — Yêu cầu 24: áp dụng 3 skill Hallmark / Taste / Impeccable
- Form thêm khối "Brief thiết kế — hỏi 1 lần" (đối tượng, hành động chính, tone, chất liệu thật) + "3 núm thiết kế" (biến tấu 5, chuyển động 3, mật độ 4) + dòng chuẩn thiết kế áp dụng.
- Luồng xử lý đổi 4 → 6 bước: Brief → Viết copy trước → Chọn hướng → Dựng bản → Kiểm tra audit → Anh duyệt & bàn giao.
- Các trường mới lưu vào `d.web` trong `collect("designweb")` (audience, action, tone, materials, dials); JS hiện số núm nằm trong `initDesignDials()` (kế bên handler form giao việc).

## Cập nhật 14/11/2026 — Yêu cầu 24b: gỡ 3 núm + tone + dòng chuẩn khỏi form
- Skill chỉ nằm trong bộ nhớ Luna; form chỉ giữ thông tin dự án (đối tượng, hành động chính, chất liệu thật). 3 núm thành mặc định Luna tự áp dụng (biến tấu 5, chuyển động 3, mật độ 4); tone do Luna tự chọn theo brief. Luồng 6 bước giữ nguyên.

## Cập nhật 15/11/2026 — Yêu cầu 28: cầu nối Thư Ký Mỹ Linh (bot Telegram RIÊNG + Inbox API)

### Vấn đề
Design Web v1 chỉ sinh khung mẫu tĩnh (`buildWebDoc` trong `index.html`) — không vẽ được như bản Phúc Thịnh/ZA do Luna vẽ trực tiếp trong chat. Cần đấu nối để Luna vẽ và trả file hoàn chỉnh về app.

### Quyết định đường dữ liệu — ĐÃ KIỂM CHỨNG (15/11/2026)
**Telegram KHÔNG PHẢI đường dữ liệu duy nhất. Nguồn dữ liệu thật là app (D1) qua endpoint inbox cho Luna.**

Bằng chứng (tài liệu chính thức Telegram):
- Bots FAQ — https://core.telegram.org/bots/faq — mục "Why doesn't my bot see messages from other bots?":
  > "Bots talking to each other could potentially get stuck in unwelcome loops. To avoid this, we decided that bots will not be able to see messages from other bots regardless of mode."
  Và mục "What messages will my bot get?": "Bot admins and bots with privacy mode disabled will receive all messages **except messages sent by other bots**."
- Có tính năng mới "Bot-to-bot communication" (https://core.telegram.org/api/bots/bot-to-bot) cho phép bot nhận tin từ bot khác trong một số ngữ cảnh (nhóm: tin nhắn chứa lệnh nhắc tới nó `/command@TargetBot`, hoặc trả lời trực tiếp tin của nó; chat riêng: cả hai bot đều phải bật Bot-to-Bot Communication Mode trong @BotFather). Nhưng: phải bật chế độ này trên CẢ HAI bot, cơ chế nhắc/trả lời rất dễ gãy, và đây không phải kênh được thiết kế để truyền dữ liệu công việc. **Không chọn làm đường dữ liệu chính.**

Vì vậy luồng cuối cùng là:
1. **Inbox API là đường dữ liệu chính (bền):** `GET /api/luna/pending` (xác thực bằng secret `LUNA_API_SECRET`) trả về các nhiệm vụ Design Web đang chờ Luna — đủ brief, ảnh (file_id Telegram), ghi chú chỉnh sửa. Luna poll endpoint này định kỳ (như poll clip 15 phút) bằng script `tools/luna-bridge.py`.
2. **Telegram là kênh thông báo (cho anh Dy đọc + nhắc việc):** Worker gửi bản brief đọc được + ảnh thật của khách (media group) tới chat của anh Dy qua **bot Telegram RIÊNG của app** (KHÔNG dùng bot training @Mylinh_traingning_bot). Anh Dy đọc được brief + ảnh ngay trên Telegram; Luna KHÔNG phụ thuộc vào tin nhắn này để lấy việc.
3. **Trả file:** Luna dùng `tools/luna-bridge.py deliver` → `POST /api/luna/delivery` (xác thực bằng cùng secret) → nhiệm vụ sang "Chờ anh duyệt" → anh duyệt trong app → "Hoàn thành", nhân viên thấy file.

### Bot Telegram riêng của app (anh Dy chốt 00:47 15/11, đã nối xong 00:51 15/11)
- Bot riêng: **@app_dieu_khien_ai_bot** ("App Điều Khiển AI", id `9111349777`), connector `custom.telegram-app`, đã kiểm chứng getMe OK. **KHÔNG dùng bot training @Mylinh_traingning_bot.**
- Token nằm trong connection, KHÔNG đọc được raw — khi code xong, báo parent để hướng dẫn anh thêm secret `TELEGRAM_BOT_TOKEN` trên Cloudflare dashboard (không tự bịa cách lấy token).
- Privacy mode đang BẬT (`can_read_all_group_messages` false) — nhắn DM không ảnh hưởng; nếu brief đi qua nhóm thì phải tắt privacy ở BotFather.
- Chat nhận thông báo: DM của anh Dy với bot mới, chat id **`8740408748`** — **ĐÃ KIỂM CHỨNG 00:52 15/11: anh đã bấm /start với bot mới, bot nhận được /start từ Duy Nguyễn, tin nhắn thử đã gửi tới đúng DM này.** Worker dùng chat id này qua secret/biến `LUNA_NOTIFY_CHAT_ID` (mặc định trong code cũng là `8740408748`; đổi sang id nhóm riêng (số âm) nếu sau này chuyển sang nhóm).
- KHÔNG dùng nhóm "Training Mỹ Linh" (nhóm đó chỉ cho clip training).

### Sơ đồ trạng thái nhiệm vụ Design Web
```
Giao việc (form) ──POST /api/tasks (multipart)──▶ [luna] "Chờ Thư Ký Mỹ Linh"
   │  Worker gửi brief text + ảnh sang Telegram (best-effort).
   │  Gửi lỗi → payload.luna.sendError, task vẫn ở [luna], admin/owner bấm "Gửi lại brief".
   ▼
Luna poll GET /api/luna/pending → vẽ → POST /api/luna/delivery {task_id, html}
   ▼
[review] "Chờ anh duyệt" (file đã lưu, admin xem demo + duyệt; nhân viên chưa thấy file)
   │  Admin bấm Duyệt ──POST /api/tasks/:id/approve──▶ [completed] "Hoàn thành"
   │  (nhân viên thấy Xem demo / Tải HTML)
   ▼
Yêu cầu chỉnh sửa (admin/owner, từ bảng demo) ──POST /api/tasks/:id/revision {note}
   → nhiệm vụ về lại [luna], Luna poll thấy ghi chú → trả bản mới (v2, v3…)
```
- Nhiệm vụ Design Web **KHÔNG chạy thanh tiến độ giả nữa** (bỏ `runSimulation` cho designweb).
- Nút "Tải HTML" / "Xem demo" dùng file Luna trả về (`GET /api/tasks/:id/result`); chưa có file thì hiện trạng thái chờ, không tải khung mẫu `buildWebDoc` nữa đối với nhiệm vụ đã gửi Luna. `buildWebDoc` chỉ còn là fallback cho nhiệm vụ demo cũ (hoàn thành trước cầu nối, không có file Luna).

### Endpoint (xem `functions/`)
- `POST /api/tasks` (multipart cho designweb): tạo nhiệm vụ Design Web với status `luna`, gửi brief + ảnh sang Telegram. Giới hạn: ảnh thật của khách tối đa 6, ảnh tham khảo tối đa 4, mỗi ảnh ≤ 5MB, chỉ `image/*`. Vượt giới hạn → 400 với thông báo rõ.
- `GET /api/luna/pending?status=luna|review|all` — header `X-Luna-Secret: <LUNA_API_SECRET>`. Trả brief đầy đủ + metadata ảnh (tên, kích thước, `file_id` Telegram để Luna tải qua `getFile`).
- `POST /api/luna/delivery` — header `X-Luna-Secret`. Body `{task_id, html, note?}`. HTML ≤ 1MB. Lưu `result_html` + thêm bản vào `result_versions` (JSON: `{v, delivered_at, size, note, html}`), status → `review`, progress 100. Gửi thông báo Telegram cho anh Dy.
- `GET /api/tasks/:id/result?version=v1|v2…` — đăng nhập, admin hoặc chủ nhiệm vụ. Trả HTML (text/html).
- `POST /api/tasks/:id/approve` — chỉ admin. Status → `completed`.
- `POST /api/tasks/:id/send-brief` — admin hoặc chủ nhiệm vụ. Gửi lại brief text (+ ảnh đính kèm lại nếu gửi multipart).
- `POST /api/tasks/:id/revision` — admin hoặc chủ nhiệm vụ. Body `{note}`. Lưu ghi chú, gửi thông báo Telegram, status → `luna`.

### Schema (xem `schema.sql` + `migrations/001-luna-bridge.sql`)
- `tasks.status` thêm `'luna'` và `'review'` (CHECK constraint).
- `tasks.result_html TEXT` — HTML bản mới nhất Luna trả về.
- `tasks.result_versions TEXT` — JSON mảng các bản `{v, delivered_at, size, note, html}`.
- Migration `001-luna-bridge.sql` rebuild bảng tasks (SQLite không sửa CHECK trực tiếp được). **Phải chạy migration này trên D1 live trước khi deploy code mới** (xem `README.md` mục Deploy).

### Secrets (Cloudflare — KHÔNG nằm trong repo)
- `TELEGRAM_BOT_TOKEN` — token bot RIÊNG của app (@app_dieu_khien_ai_bot; anh Dy tạo qua @BotFather, gửi qua Secure Vault).
- `LUNA_NOTIFY_CHAT_ID` — chat nhận thông báo brief: `8740408748` (DM anh Dy, đã kiểm chứng /start + tin thử 00:52 15/11). Đổi sang id nhóm riêng (số âm) nếu sau này chuyển sang nhóm. (`TELEGRAM_CHAT_ID` vẫn được code đọc làm tên dự phòng.)
- `LUNA_API_SECRET` — secret chung cho `GET /api/luna/pending` và `POST /api/luna/delivery`. Tạo bằng `openssl rand -hex 32`; Luna dùng qua biến môi trường khi chạy `tools/luna-bridge.py` (đọc từ Secure Vault, không ghi cứng).
- `LUNA_TELEGRAM_BOT_TOKEN` — cùng giá trị `TELEGRAM_BOT_TOKEN`, để script của Luna tải ảnh qua Telegram `getFile` (cũng lấy từ Secure Vault khi chạy, không ghi cứng).
- `TELEGRAM_API_BASE` — chỉ dùng khi test local (mặc định `https://api.telegram.org`).

### Ảnh thật của khách (Yêu cầu bổ sung 00:44 15/11)
- Form Design Web, mục "Chất liệu thật đã có": tick checkbox "Ảnh thật" thì hiện ô tải nhiều ảnh (tái dùng mẫu `initRef` — thumbnail, gỡ từng ảnh). Nhãn rõ: **"Ảnh thật của khách — dùng trong thiết kế"** (khác ô "Ảnh mẫu / tài liệu tham khảo" #design-ref).
- Ảnh đi KÈM brief sang Telegram (sendPhoto / sendMediaGroup), không chỉ gửi checkbox. Tick "Ảnh thật" mà chưa đính kèm ảnh nào → brief ghi rõ "đã tick Ảnh thật nhưng chưa đính kèm ảnh" để Luna biết.
- Quy tắc dự phòng (ghi trong hint dưới mục Chất liệu + trong brief): nếu nhân viên không có ảnh khách thì Luna dùng ảnh Google (ảnh thật, không logo/watermark của công ty khác) hoặc tự thiết kế ảnh bằng AI (Leonardo / LightVisual / Grok, theo tính năng Thiết kế hình ảnh của app).
- Ảnh KHÔNG lưu vào D1 (chỉ lưu metadata: tên, kích thước, file_id Telegram). Ảnh sống trong tin nhắn Telegram; Luna tải qua `getFile` bằng token bot mới.

### Công cụ phía Luna (xem `tools/luna-bridge.py`)
- `pending` — poll `GET /api/luna/pending`, in các brief mới chưa thấy (state lưu ngoài repo).
- `photos <task-id>` — tải ảnh của nhiệm vụ qua Telegram `getFile` về thư mục local.
- `deliver <task-id> <file.html> [--note ...]` — POST file lên `/api/luna/delivery`.
- Secret đọc từ biến môi trường khi chạy, không ghi cứng vào script.

### Triển khai — trạng thái 15/11
- [x] Backend + schema + migration (xem các mục trên).
- [x] Frontend (`index.html`): hint màn Design Web + bước 4 luồng xử lý; khối `#design-mat-photos-field` (ô tải ảnh thật, chỉ hiện khi tick "Ảnh thật"); `initRef` giữ File gốc (`input._refItems`/`_refClear`); `collect("designweb")` thêm metadata ảnh; `onAssign` gửi FormData multipart cho designweb + KHÔNG chạy simulation + giữ file khi gửi brief lỗi để thử lại; `taskTag`/`renderTaskItem` 3 trạng thái (luna/review/completed) + nút Duyệt/Gửi lại brief; `buildLunaVersions`/`fetchTaskHtml` lấy HTML thật bất đồng bộ; form "Yêu cầu chỉnh sửa" trong overlay → endpoint revision (nhiệm vụ demo cũ không có file Luna vẫn dùng `buildWebDoc` như trước); `notifItems` thêm thông báo "Bản thiết kế chờ duyệt" cho admin.
- [x] Công cụ Luna: `tools/luna-bridge.py` (pending / photos / deliver).
- [x] Bảng demo: overlay `.rt-overlay` có thêm hàng "Lịch sử phiên bản" (chip v1/v2… bấm đổi bản đang xem; nút "Tải HTML" trong overlay tải đúng bản đang xem) — bổ sung 15/11 khi QA phát hiện overlay cũ chỉ hiện bản mới nhất. Lưu ý: `#previewWrap` (panel demo tĩnh trong HTML, có `#versionList`) là UI chết từ trước — không có JS nào mở nó, overlay đang dùng là `.rt-overlay`; chưa dọn trong đợt này (ngoài phạm vi Yêu cầu 28).
- [x] Kiểm thử E2E local: `~/workspace/qa-app2/luna-bridge-e2e/run_e2e.py` — **51/51 PASS** (mock Telegram; xem dưới).
- [x] QA frontend CDP 3 cỡ màn hình: `~/workspace/qa-app2/qa28-frontend.py` — **40/40 PASS** (1440/768/390).
- [ ] Commit local (KHÔNG đẩy GitHub, KHÔNG động Thư viện).

### Kiểm thử E2E local (15/11, `~/workspace/qa-app2/luna-bridge-e2e/`)
- Môi trường: `wrangler pages dev --d1=DB --local` + mock Telegram (`mock-telegram.js`, cổng 18777) + D1 local seed bằng sqlite3 trực tiếp. **Phát hiện hạ tầng:** `wrangler d1 execute --local` và `wrangler pages dev --local` dùng 2 file D1 local khác nhau (pages dev dùng file `e7352547…sqlite`, d1 execute dùng `075ceb47…sqlite`) — phải seed file của pages dev thì server mới thấy bảng; miniflare tạo file D1 lười (chỉ khi có request chạm DB thật).
- 51 kiểm tra pass: đăng ký admin/staff + duyệt; tạo designweb kèm 2 ảnh thật + 1 ảnh tham khảo → brief text + sendMediaGroup (2 ảnh) + sendPhoto (1 ảnh) đúng nội dung/mã nhiệm vụ, file_id lưu đúng; pending sai secret → 401, đúng secret → đủ brief + file_id + `tickedPhotoButEmpty`; `luna-bridge.py pending` (lần 2 không trùng) + `photos` (tải đủ 3 ảnh qua getFile giả lập) + `deliver` v1/v2; result theo version; phân quyền (staff khác 403 + không thấy task); staff duyệt → 403, admin duyệt → completed; revision → về luna + pending thấy note + latest_html; quota 429; 7 ảnh → 400; đường lỗi Telegram chết → notified=false + sendError, gửi lại brief → notified=true. Dọn sạch: `.dev.vars` + `.wrangler` đã xóa sau chạy.

## Cập nhật 16/11/2026 — Yêu cầu 30: cầu nối mở sang Chăm sóc web + Chăm sóc page
- Cầu nối Luna (brief Telegram → inbox `/api/luna/pending` → giao kết quả → anh duyệt) giờ dùng chung cho 3 tính năng: designweb (file HTML), web/page (kết quả text `kind: 'posted'` | `'content'`). Xem `features/cham-soc-web/README.md` và `features/cham-soc-page/README.md`.
- Thay đổi chung: `pending.js` bỏ lọc cứng `feature = 'designweb'`; `delivery.js` nhận thêm text; `result.js` trả JSON cho web/page; guard admin-only + approve/revision/send-brief mở sang web/page; cột mới `result_text` (migration 002). Đường HTML của Design Web giữ nguyên.
