# Ứng Dụng Điều Khiển AI

App điều khiển các AI qua API để làm việc: chăm sóc web, chăm sóc page, xây dựng kênh, viết truyện, thiết kế hình ảnh, design web. Chỉ huy: Thư Ký Mỹ Linh.

## Chạy thử ngay

Mở `index.html` bằng trình duyệt là dùng được (bản này gọi API thật — cần chạy
qua Cloudflare Pages hoặc `npx wrangler pages dev` để có API).

Đăng ký tài khoản đầu tiên (anh Dy, nguyenduy.nasani@gmail.com) sẽ tự thành
**Admin** và được kích hoạt ngay. Các tài khoản đăng ký sau mặc định **chờ duyệt** —
Admin vào mục Quản lý tài khoản để duyệt mới dùng được.

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

## Backend v1 — Cloudflare Pages Functions + D1 (đã làm xong 14/11/2026)

- `schema.sql` — 4 bảng: `users`, `sessions`, `user_limits`, `tasks`.
- `functions/api/` — Auth (`auth/register`, `auth/login`, `auth/logout`, `auth/me`),
  nhiệm vụ (`tasks`, `tasks/:id`), lượt dùng (`quota`), Dashboard (`dashboard`),
  quản lý tài khoản (`admin/users`, `admin/users/:id`). Xem chi tiết trong từng file.
- Mật khẩu hash PBKDF2-SHA256 (100.000 vòng, salt 16 byte), lưu dạng `salt:hash`.
  Session bằng cookie HttpOnly + SameSite=Lax, hạn 30 ngày; server chỉ lưu SHA-256
  của token.
- Mặc định mỗi tài khoản được **1 lượt/tuần cho mỗi tính năng** (tính theo tuần ISO,
  giờ Việt Nam); Admin setup riêng từng người qua bảng `user_limits`. Admin không bị
  giới hạn lượt. Hết lượt: API trả 429 + thông báo rõ ràng.
- Nhiệm vụ v1 vẫn chạy **mô phỏng tiến độ** như bản demo (chưa gọi API AI thật);
  backend chỉ lo đăng nhập + dữ liệu + giới hạn lượt. API key KHÔNG nằm trong code.

### Chạy thử ở máy (local dev)

```bash
npx wrangler d1 execute app-dieu-khien-ai-db --local --file=schema.sql
npx wrangler pages dev --port 8788
```

### Lên Cloudflare thật (làm 1 lần, trên dashboard)

1. Workers & Pages → D1 → tạo database tên `app-dieu-khien-ai-db` → chạy file
   `schema.sql` trong mục SQL của database đó.
2. Pages project `ung-dung-dieu-khien-ai` → Settings → Functions → D1 database
   bindings → thêm binding tên `DB` trỏ tới database vừa tạo.
3. Đẩy code lên nhánh main là tự deploy. Kiểm chứng: đăng ký tài khoản đầu tiên
   (thành Admin) rồi đăng nhập, giao việc, kiểm tra lượt dùng.

## Lưu ý

- Dữ liệu (tài khoản, nhiệm vụ) lưu trong D1, đồng bộ giữa các máy. Lịch & Kế hoạch
  và danh sách dự án trong form giao việc vẫn chỉ lưu trong phiên trình duyệt (chưa
  có bảng riêng ở backend v1).
- API key thật KHÔNG nằm trong repo này. Key đã lưu trong app cũ (Gemini, JSON2Video, fal.ai) — khi lên Cloudflare sẽ chuyển vào biến môi trường của Workers.
