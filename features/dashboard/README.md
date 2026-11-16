# features/dashboard

Code của tính năng này hiện nằm trong `index.html` (bản build 14/11/2026), đánh dấu bằng comment `[features/dashboard]`.

Khi tách app thành nhiều file thật (bước Cloudflare), toàn bộ HTML/CSS/JS riêng của tính năng này chuyển vào folder này, sửa chỉ trong folder này, không động tới các tính năng khác.

## Yêu cầu 31 — Thống kê theo dự án (16/11/2026, code xong, QA đạt, CHƯA lên live)
- Khối "Thống kê theo dự án" trong màn Dashboard (`index.html`, comment `Yêu cầu 31`, id `projectStatsBlock`, CSS `.ps-*`): CHỈ Admin thấy (`data-admin-only` + server chỉ trả `projectStats` cho admin). Nhân viên không thấy (khối vẫn `hidden` + class `staff-hidden`).
- 2 nguồn: (1) nhiệm vụ trong app — gom theo tính năng/dự án/trạng thái từ bảng `tasks` (`GET /api/dashboard` → `appTasks.byFeature/byProject/byStatus`); (2) số liệu Luna đẩy từ Muse — bảng `project_stats`, endpoint `POST /api/luna/stats` (xác thực `X-Luna-Secret`, upsert theo `(project, kind, period)`), công cụ `tools/luna-stats.py push` (alias `tools/luna-bridge.py stats push`).
- Seed 4 dự án + lịch thật: `functions/_lib/projects.js` (BlueMax T2-T4-T6 hết 27/11/2026; Bình Minh T2-T6 hết 27/11/2026; Khánh Nghi T3+T7; Inox T3+T6). Tính "bài theo lịch" theo tuần ISO (`scheduledInWeek`). Thêm dự án sau chỉ cần thêm 1 mục seed.
- Migration: `migrations/003-project-stats.sql` (KHÔNG có PRAGMA/BEGIN/COMMIT — D1 Console từ chối BEGIN TRANSACTION). Chưa chạy trên D1 live.
- QA: E2E backend `~/workspace/qa-app2/luna-bridge-yc31/run_e2e_yc31.py` 38/38 PASS; frontend Chromium thật `~/workspace/qa-app2/qa31-frontend.py` 38/38 PASS (390 trước, rồi 768/1440; ảnh `qa31-block-*.png`).
- Lên live còn 2 bước (chờ anh): (1) chạy migration 003 trên D1 live, (2) push qua PAT mới — TUYỆT ĐỐI không tự tạo PAT hay push.
