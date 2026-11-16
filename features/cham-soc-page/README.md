# features/cham-soc-page

Code của tính năng này hiện nằm trong `index.html` (bản build 14/11/2026), đánh dấu bằng comment `[features/cham-soc-page]`.

Khi tách app thành nhiều file thật (bước Cloudflare), toàn bộ HTML/CSS/JS riêng của tính năng này chuyển vào folder này, sửa chỉ trong folder này, không động tới các tính năng khác.

## Cập nhật 16/11/2026 — Yêu cầu 30: cầu nối Thư Ký Mỹ Linh (mở rộng từ Design Web)
- Nhiệm vụ Chăm sóc page chuyển sang trạng thái 'luna' + gửi brief text sang Telegram KHI VÀ CHỈ KHI AI phụ trách là Thư Ký Mỹ Linh (`payload.ai` chứa "Mỹ Linh"). Chọn Gemini thì giữ nguyên 'running' + tiến độ mô phỏng.
- Brief: title + meta + lines (Page / Loại nội dung / Chủ đề / Khung giờ đăng). Không có credential trong brief hay D1.
- Kết quả Luna trả về có 2 loại (`POST /api/luna/delivery {task_id, kind, text, link?}`):
  - `kind: 'posted'` — page của anh Dy (vd Page BlueMax): Luna tự đăng bài lên page thật rồi trả báo cáo + link bài đã đăng.
  - `kind: 'content'` — page nhân viên đăng ký: Luna trả nội dung bài đăng hoàn chỉnh để nhân viên tự đăng.
- Kết quả lưu cột `result_text` (migration 002) + `result_versions` (kind/text/link). Status sau giao → 'review', anh duyệt → 'completed'. Xem kết quả qua `GET /api/tasks/:id/result` (JSON).
- Frontend: màn review hiện báo cáo + link bấm được (posted) hoặc nội dung + nút sao chép (content), kèm Duyệt / Yêu cầu chỉnh sửa / Gửi lại brief.
