# Ứng Dụng Điều Khiển AI

App điều khiển các AI qua API để làm việc: chăm sóc web, chăm sóc page, xây dựng kênh, viết truyện, thiết kế hình ảnh, design web. Chỉ huy: Thư Ký Mỹ Linh.

## Chạy thử ngay

Mở `index.html` bằng trình duyệt là dùng được. Bản xem trước (demo): bấm "Đăng nhập demo (tài khoản Admin)".

## Cấu trúc folder (sửa phần nào chỉ vào đúng folder đó)

- `index.html` — toàn bộ app (bản build 14/11/2026). Mỗi màn hình có comment `[features/...]` đánh dấu đúng folder của nó.
- `config/config.json` — cấu hình app: tên app, danh sách tính năng, AI chính/dự phòng từng tính năng, trạng thái API key. Sửa AI/key/luồng thì sửa ở đây.
- `features/dashboard/` — màn hình Dashboard thống kê.
- `features/cham-soc-web/` — tính năng Chăm sóc web.
- `features/cham-soc-page/` — tính năng Chăm sóc page.
- `features/xay-dung-kenh/` — tính năng Xây dựng kênh (YouTube, TikTok, Fanpage...).
- `features/viet-truyen/` — tính năng Viết truyện.
- `features/thiet-ke-hinh-anh/` — tính năng Thiết kế hình ảnh.
- `features/design-web/` — tính năng Design Web (xem demo, yêu cầu chỉnh sửa, tải HTML).
- `features/quan-ly-tai-khoan/` — màn hình Quản lý tài khoản (duyệt tài khoản, setup lượt dùng từng nhân viên).
- `features/dang-nhap-dang-ky/` — màn hình Đăng nhập / Đăng ký / Chờ duyệt.
- `shared/` — code dùng chung: CSS chung, router, phiên đăng nhập, quản lý lượt dùng.
- `SITEMAP.md` — sơ đồ cấu trúc app.

## Quy tắc đã chốt

- Mặc định mỗi tài khoản được dùng miễn phí 1 lần/tuần cho mỗi tính năng; muốn nhiều hơn thì phải mua thêm lượt. Admin setup riêng từng nhân viên theo số tiền đã nạp.
- Nhân viên chỉ thấy việc của chính mình, không thấy khối "AI phụ trách" / "Luồng xử lý" và không thấy mục Quản lý tài khoản.
- Tài khoản mới phải được admin duyệt tay mới dùng được.
- API key giấu ở phía server khi lên Cloudflare, không để trong trình duyệt.

## Triển khai lên Cloudflare (bước tiếp theo)

- Cloudflare Pages (giao diện) + Workers (đăng nhập) + D1 (tài khoản, nhiệm vụ).
- Nối repo GitHub với Cloudflare Pages: mỗi lần đẩy code mới lên repo thì Cloudflare tự build lại và đăng bản mới, không cần đăng tay.
- Khi tách app thành nhiều file thật, code từng tính năng chuyển vào đúng folder `features/...` của nó; `config/config.json` giữ nguyên làm nguồn cấu hình.

## Lưu ý

- Bản này lưu dữ liệu trong trình duyệt (phiên làm việc). Đăng nhập thật đa người dùng + đồng bộ giữa các máy cần backend Cloudflare (Workers + D1) ở bước tiếp theo.
- API key thật KHÔNG nằm trong repo này. Key đã lưu trong app cũ (Gemini, JSON2Video, fal.ai) — khi lên Cloudflare sẽ chuyển vào biến môi trường của Workers.
