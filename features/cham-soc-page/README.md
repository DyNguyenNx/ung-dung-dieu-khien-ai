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

## Cập nhật 17/11/2026 — Yêu cầu 38: mặc định Thư Ký Mỹ Linh + CHỈ ADMIN dùng
- Mặc định AI Chăm sóc page → Thư Ký Mỹ Linh (`config.json` `ai_primary: "mylinh"`, `FEATURE_AI` + `APP_CONFIG` + option `selected` trong select + tên/trạng thái/ghi chú hiển thị theo chế độ trực tiếp). Admin vẫn đổi lại sang Gemini được; chọn Gemini thì nhiệm vụ chạy mô phỏng như cũ.
- **CHỈ ADMIN dùng (bổ sung 09:27 17/11/2026, anh Dy chốt): nhân viên KHÔNG được thấy tính năng này.** Lý do: Luna chỉ viết/đăng được trên page của anh (qua facebook-cli), không đăng được lên page của nhân viên.
  - Frontend: 4 nút dẫn tới page (sidebar, tabbar mobile, dòng "Tiến độ theo tính năng" trên Dashboard, nút tính năng ở Bảng tín hiệu) gắn `data-admin-only` (ẩn hẳn với nhân viên, theo đúng mẫu phân quyền sẵn có); `go("page")` chặn nhân viên về Dashboard + toast; `setViewMode` cũng đẩy nhân viên đang ở màn page về Dashboard. Dòng `kind: 'content'` ở YC30 cho page nhân viên KHÔNG còn áp dụng — page nhân viên không tồn tại nữa.
  - Backend: `forbidStaffPage(user, feature)` trong `functions/_lib/auth.js` — chặn ở `POST /api/tasks` (403), `GET /api/tasks?feature=page` (403), danh sách `GET /api/tasks` của nhân viên loại hẳn nhiệm vụ page, `GET/PATCH/DELETE /api/tasks/:id` + `revision`/`send-brief`/`result` (403 cả với chủ nhiệm vụ là nhân viên), số liệu `GET /api/dashboard` của nhân viên không đếm nhiệm vụ page. `approve` vốn đã chỉ admin nên không cần sửa.
