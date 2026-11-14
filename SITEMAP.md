# SITEMAP — App Điều Khiển AI v2

> Vẽ trước khi build (yêu cầu 3, 14/11/2026). App mới build lại từ đầu, thay cho app cũ `ung-dung-dieu-khien-ai-2` (fullstack, chạy trên Muse, không xuất file được).

## Sơ đồ tổng thể

```
App Điều Khiển AI v2 ("THƯ KÝ MỸ LINH — CHỈ HUY")
│
├── 📁 config/                    ← KHÔNG show trong app, sửa ở đây là app đổi theo
│   └── config.json               ← AI nào làm tính năng nào, key, luồng xử lý, danh sách tính năng
│
├── 🖥️ Giao diện app (1 file HTML, mở được trên MacBook + điện thoại)
│   ├── Sidebar icon (dọc, hẹp, dạng pill, sát mép trái)
│   │   ├── 📊 Dashboard thống kê
│   │   ├── 🌐 Chăm sóc web
│   │   ├── 📄 Chăm sóc page
│   │   ├── 🎬 Xây dựng kênh (Youtube, Tiktok, Fanpage...)
│   │   └── ✍️ Viết truyện
│   ├── Thanh pill trên cùng (tiêu đề + chuyển nhanh + trạng thái key)
│   └── Vùng nội dung chính (thẻ nổi: thống kê + chi tiết tính năng)
│
└── 📁 features/ (nguồn từng tính năng, mỗi tính năng 1 folder riêng)
    ├── dashboard/        → Dashboard thống kê
    ├── cham-soc-web/     → Chăm sóc web
    ├── cham-soc-page/    → Chăm sóc page
    ├── xay-dung-kenh/    → Xây dựng kênh
    ├── viet-truyen/      → Viết truyện
    ├── thiet-ke-hinh-anh/ → Thiết kế hình ảnh
    └── design-web/       → Design Web
```

## Luồng dữ liệu

```
config/config.json  ──đọc khi mở app──▶  App hiển thị
        │                                     │
        │  sửa file (thay AI / thay key /      │  nhiệm vụ + trạng thái
        │  đổi luồng / thêm-bớt tính năng)     │  lưu trong trình duyệt
        ▼                                     ▼
   App đổi theo                     Dashboard thống kê
```

## Từng tính năng (tính năng cố định, AI phục vụ được đổi)

| # | Tính năng | AI chính | AI dự phòng | Ghi chú |
|---|-----------|----------|-------------|---------|
| 1 | Dashboard thống kê | — (tổng hợp số liệu) | — | Số nhiệm vụ, key đã có, tiến độ từng tính năng |
| 2 | Chăm sóc web | Gemini API | GSC API + PageSpeed | SEO, bài viết, kiểm tra index |
| 3 | Chăm sóc page | Gemini API | Meta Graph API | Nội dung page, tương tác nhóm |
| 4 | Xây dựng kênh | Wan 3.0 / JSON2Video | fal.ai (Kling 3.0) | Video YouTube/TikTok, edit clip, lồng tiếng |
| 5 | Viết truyện | Gemini API | ElevenLabs / Vbee | Kịch bản + lồng tiếng truyện |
| 6 | Thiết kế hình ảnh | Leonardo AI | LightVisual / Grok | Avatar, banner, thumbnail, poster, ảnh sản phẩm |
| 7 | Design Web | Thư Ký Mỹ Linh | Leonardo / Gemini | Thiết kế giao diện trang chủ website |

## Quy tắc
- KHÔNG có mục "Tổng quan" trong giao diện app (nằm ở `config/`).
- Muốn đổi AI cho tính năng nào: sửa `config/config.json` (mục `ai_primary` / `ai_backup` của tính năng đó).
- Muốn thêm/bớt tính năng: thêm/bớt mục trong `config/config.json` + thêm/bớt folder trong `features/`.
- Lỗi ở đâu: mở đúng folder của tính năng đó ra sửa, không mò cả app.
- Giao diện: layout theo mẫu Pinterest (sidebar icon hẹp, thanh pill trên, thẻ nổi), chuẩn UX/UI, trực quan dễ dùng, tông sáng + điểm nhấn tím navy.
