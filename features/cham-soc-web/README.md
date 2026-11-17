# features/cham-soc-web

Code của tính năng này hiện nằm trong `index.html` (bản build 14/11/2026), đánh dấu bằng comment `[features/cham-soc-web]`.

Khi tách app thành nhiều file thật (bước Cloudflare), toàn bộ HTML/CSS/JS riêng của tính năng này chuyển vào folder này, sửa chỉ trong folder này, không động tới các tính năng khác.

## Cập nhật 16/11/2026 — Yêu cầu 30: cầu nối Thư Ký Mỹ Linh (mở rộng từ Design Web)
- Nhiệm vụ Chăm sóc web chuyển sang trạng thái 'luna' + gửi brief text sang Telegram KHI VÀ CHỈ KHI AI phụ trách là Thư Ký Mỹ Linh (`payload.ai` chứa "Mỹ Linh"). Chọn Gemini thì giữ nguyên 'running' + tiến độ mô phỏng.
- Brief: title + meta + lines (Website / Chủ đề / Từ khóa chính / Số từ mong muốn). KHÔNG có credential admin trong brief hay D1 (Link admin/ID/Pass của nhân viên chỉ nằm ở localStorage trình duyệt nhân viên).
- Kết quả Luna trả về có 2 loại (`POST /api/luna/delivery {task_id, kind, text, link?}`):
  - `kind: 'posted'` — dự án của anh Dy: Luna tự đăng bài lên web thật rồi trả báo cáo + link bài đã đăng.
  - `kind: 'content'` — dự án nhân viên đăng ký: Luna trả nội dung bài viết hoàn chỉnh để nhân viên tự đăng.
- Kết quả lưu cột `result_text` (migration 002) + `result_versions` (kind/text/link). Status sau giao → 'review', anh duyệt → 'completed'. Xem kết quả qua `GET /api/tasks/:id/result` (JSON).
- Frontend: màn review hiện báo cáo + link bấm được (posted) hoặc nội dung + nút sao chép (content), kèm Duyệt / Yêu cầu chỉnh sửa / Gửi lại brief. Sửa kèm: `setAI` đồng bộ lựa chọn AI vào `APP_CONFIG.features[key].aiPrimary` (trước đây `d.ai` vẫn là AI mặc định).

## Cập nhật 17/11/2026 — Yêu cầu 38: mặc định Thư Ký Mỹ Linh + lưu tài khoản admin mã hóa
- Mặc định AI Chăm sóc web → Thư Ký Mỹ Linh (`config.json` `ai_primary: "mylinh"`, `FEATURE_AI` + `APP_CONFIG` + option `selected` trong select + tên/trạng thái/ghi chú hiển thị theo chế độ trực tiếp). Nhân viên vẫn đổi lại sang Gemini được; chọn Gemini thì nhiệm vụ chạy mô phỏng như cũ. Dòng ghi chú ở YC30 "KHÔNG có credential trong D1" KHÔNG còn đúng từ YC38 — xem dưới.
- Bảng `websites` (migration 006): `id, user_id, name, address, admin_url, admin_user, admin_pass_enc, created_at, updated_at`, `UNIQUE(user_id, name)`. Form "Thêm website mới" giờ lưu thật 3 ô Link admin / ID / Pass qua `POST /api/websites` (lỗi thì toast rõ, website vẫn thêm local, mật khẩu chưa lưu). Lúc mở app `GET /api/websites` rồi thêm option vào select dự án web (bỏ trùng). `GET /api/websites` không bao giờ trả mật khẩu, chỉ trả `has_creds`.
- Mã hóa (`functions/_lib/credentials.js`): AES-256-GCM qua WebCrypto, khóa từ secret `CRED_ENCRYPTION_KEY` (base64, 32 byte). Chỉ mã hóa `admin_pass`; thiếu khóa → API trả lỗi rõ, không lưu mật khẩu dạng thường bao giờ.
- Endpoint Luna `GET /api/luna/tasks/:id/credentials` (header `X-Luna-Secret`): tra nhiệm vụ → chủ nhiệm vụ → dòng `Website:` trong `payload.lines` → dòng websites tương ứng (khớp tên/địa chỉ) → giải mã → trả `{website, admin_url, admin_user, admin_pass}`. 404 khi không có website/mật khẩu. Không ghi credential vào log, không đưa vào brief Telegram. Lệnh `tools/luna-bridge.py creds <task-id>` gọi endpoint này (in ra stdout chỉ để Luna dùng lúc làm việc).
- Luồng mới: nhân viên giao việc (mặc định Mỹ Linh) → brief Telegram → Luna viết bài → lấy credential qua endpoint → tự đăng lên web khách → trả `kind: 'posted'` + link → chờ anh duyệt. Không có credential thì trả `kind: 'content'` như cũ.
