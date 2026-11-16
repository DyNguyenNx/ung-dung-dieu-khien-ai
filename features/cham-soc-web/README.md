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
