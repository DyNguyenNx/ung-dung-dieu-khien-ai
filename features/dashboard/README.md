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

## Yêu cầu 32 — Bảng tín hiệu live (16/11/2026, code xong, QA đạt, CHƯA lên live)
- Khối "Bảng tín hiệu" trong màn Dashboard (`index.html`, comment `Yêu cầu 32`, id `signalBoard`, CSS `.sig-*`), ngay dưới khối "Thống kê theo dự án": mọi vai trò đều thấy (số liệu có phạm vi theo vai trò).
- 5 thẻ số live từ `GET /api/dashboard` → `byStatus` (mới thêm cho mọi vai trò, có phạm vi: admin = toàn app, nhân viên = chỉ việc của mình): Lệnh đang chạy (running + luna), Hàng chờ (waiting + scheduled), Chờ duyệt (review), Hoàn tất (completed), Lỗi (error). Dòng riêng "Thư Ký Mỹ Linh đang làm: N nhiệm vụ" khi có task status `luna`.
- Sơ đồ luồng Hàng chờ → Đang chạy → Chờ duyệt → Hoàn thành + nhánh Lỗi; mỗi nút hiện số lượng, bấm để lọc danh sách. Danh sách nhiệm vụ mặc định lọc `running` (running + luna), chia theo tính năng, có tiến độ % đúng giá trị server lưu (running/luna ở 0% thì thanh bar chạy hiệu ứng trượt, không bịa số %). Bấm một nhiệm vụ mở đúng màn hình tính năng đó.
- Polling 5 giây: `signalTick` tải lại `/api/tasks?limit=500` rồi `refreshDashboard`; dừng khi tab ẩn (`visibilitychange` + guard `document.hidden`) hoặc khi rời màn Dashboard (`go()` start/stop); hiện "Cập nhật lần cuối HH:MM:SS" + chấm "Đang live". Chỉ cập nhật số + danh sách, không re-render toàn trang.
- An toàn: tiêu đề/nội dung nhiệm vụ render LUÔN qua `escHtml` (rút kinh nghiệm soát bảo mật run-1). Không thêm endpoint mới (dùng `/api/dashboard` + `/api/tasks` có sẵn); backend chỉ thêm `byStatus` vào `functions/api/dashboard.js` (lý do: nhân viên không có nguồn đếm chính xác — `/api/tasks` bị cắt ở limit 500; khối admin tái dùng `byStatus` chung cho `appTasks.byStatus`).
- Bẫy phạm vi script: khối JS YC32 nằm ở script block 1 (top-level) nên KHÔNG thấy biến trong IIFE AppBackend (`FEATURE_KEYS`/`FEATURE_NAMES`/`fmtTime`/`refreshDashboard`) — dùng bản sao cục bộ `SIG_FEATURE_*`/`sigFmtTime` và gọi AppBackend qua `window.AppBackend.api` / `window.AppBackend.refreshDashboard`. `go()` chạy ở block 1 trước khi `window.AppState` tồn tại nên kiểm tra `window.AppState && window.AppState.me`.
- QA: E2E backend `~/workspace/qa-app2/qa32-signal-board/run_e2e_yc32.py` 18/18 PASS; frontend Chromium thật `~/workspace/qa-app2/qa32-signal-board/qa32-frontend.py` 40/40 PASS (390 trước, rồi 768/1440; ảnh `qa32-board-*.png`). Chưa kiểm chứng tab ẩn thật bằng CDP (headless không đổi được `document.hidden` — đã kiểm thay bằng rời/quay lại Dashboard qua `go()`, nhánh `document.hidden` chỉ soát bằng code).
- Lên live còn 1 bước (chờ anh về máy Mac): push qua PAT mới — TUYỆT ĐỐI không tự tạo PAT hay push. Không cần migration (không đổi schema).
