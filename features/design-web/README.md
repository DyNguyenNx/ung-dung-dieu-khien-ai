# features/design-web

Code của tính năng này hiện nằm trong `index.html` (bản build 14/11/2026), đánh dấu bằng comment `[features/design-web]`.

Khi tách app thành nhiều file thật (bước Cloudflare), toàn bộ HTML/CSS/JS riêng của tính năng này chuyển vào folder này, sửa chỉ trong folder này, không động tới các tính năng khác.

## Cập nhật 14/11/2026 — Yêu cầu 24: áp dụng 3 skill Hallmark / Taste / Impeccable
- Form thêm khối "Brief thiết kế — hỏi 1 lần" (đối tượng, hành động chính, tone, chất liệu thật) + "3 núm thiết kế" (biến tấu 5, chuyển động 3, mật độ 4) + dòng chuẩn thiết kế áp dụng.
- Luồng xử lý đổi 4 → 6 bước: Brief → Viết copy trước → Chọn hướng → Dựng bản → Kiểm tra audit → Anh duyệt & bàn giao.
- Các trường mới lưu vào `d.web` trong `collect("designweb")` (audience, action, tone, materials, dials); JS hiện số núm nằm trong `initDesignDials()` (kế bên handler form giao việc).
