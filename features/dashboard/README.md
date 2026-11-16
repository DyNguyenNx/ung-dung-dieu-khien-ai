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

## Yêu cầu 32 v2 — Bảng tín hiệu CHẠY ĐỘNG như video (16/11/2026, anh sửa 14:22 sau khi xem ảnh 390px v1)
- Vấn đề v1: bảng thẻ số tĩnh, không giống video "Tín hiệu MCP" anh gửi. v2 chỉ đổi cách HIỂN THỊ, giữ nguyên tầng dữ liệu v1 (byStatus theo vai trò, polling 5s, lọc theo trạng thái, "Thư Ký Mỹ Linh đang làm" cho status luna, escape HTML).
- Đồ thị trung tâm: nút chỉ huy "App Điều Khiển AI — Thư Ký Mỹ Linh, Chỉ huy" (nền navy, vòng pulse) nối 6 nút tính năng bằng đường SVG do JS vẽ theo vị trí thật (đo bằng getBoundingClientRect, vẽ lại khi số lượng đổi/resize/font load); chấm sáng chạy dọc bằng SMIL `animateMotion` — chỉ khi tính năng đó đang có việc chạy thật (count > 0), số chấm = min(3, count), tốc độ nhanh dần theo count (2.6s / 2.0s / 1.6s). Bấm nút tính năng lọc thêm theo tính năng (bấm lại để bỏ, có dòng "Đang lọc tính năng" + nút bỏ lọc); bấm nút chỉ huy về chế độ xem mặc định. Không copy avatar hoạt hình hay thương hiệu "Medusa".
- Luồng chặng: 4 đoạn nối `.sig-link` thay mũi tên "→" tĩnh — chấm sáng chạy bằng CSS background-position (ngang desktop, dọc mobile khi luồng xếp dọc); chặng nào 0 thì thành vạch mờ không chạy (class `.idle`, đổi theo đúng số thật).
- Số liệu: đếm lên 600ms ease-out (`sigSetNum`, rAF, có token chống đếm chồng) cho cả 5 thẻ số, 5 nút luồng, 6 badge tính năng, số ở nút chỉ huy.
- Thanh tiến độ: danh sách nhiệm vụ cập nhật DOM tại chỗ theo id (`sigRowMap`/`sigGroupMap`, textContent — vẫn chống XSS), `transition: width .6s` làm thanh chạy mượt khi % đổi; running/luna ở 0% vẫn giữ hiệu ứng trượt `.bar.indet`.
- Mobile 390px: trung tâm trên, tính năng lưới 2 cột, luồng thành chuỗi dọc có chấm chạy xuống; không tràn ngang. `prefers-reduced-motion`: tắt hết chuyển động (chấm SVG không vẽ, link/hub-ring/bar trượt dừng).
- Bẫy: không vẽ lại SVG mỗi lần polling (chữ ký `sigLinkSig` đổi mới vẽ lại — vẽ lại giữa chừng làm chấm nhảy về đầu); khi board đang ẩn thì reset `sigLinkSig = ""` để lần hiện sau vẽ lại đúng vị trí (tránh vị trí cũ sau khi resize lúc đang ở màn khác).
- QA v2: xem `~/workspace/qa-app2/qa32-signal-board-v2/` (kèm cặp ảnh chứng minh chấm đã di chuyển).
- Lên live: push qua PAT mới — TUYỆT ĐỐI không tự tạo PAT hay push. Không cần migration.
