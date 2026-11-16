-- Migration 002 — Cầu nối Thư Ký Mỹ Linh cho Chăm sóc web + Chăm sóc page (Yêu cầu 30, 16/11/2026).
-- Chạy trên D1 live TRƯỚC khi deploy code mới (code mới INSERT/đọc cột result_text).
--   wrangler d1 execute app-dieu-khien-ai-db --remote --file=migrations/002-luna-bridge-web-page.sql
--   (hoặc dán vào mục SQL của D1 trên dashboard Cloudflare)
-- Chỉ thêm 1 cột result_text (báo cáo đã đăng / nội dung Luna trả về cho web/page),
-- không đổi CHECK constraint nên KHÔNG cần rebuild bảng như migration 001.
-- LƯU Ý: file này KHÔNG có PRAGMA/BEGIN/COMMIT — D1 Console từ chối SQL chứa
-- BEGIN TRANSACTION (bài học từ migration 001: phải chạy bản đã bỏ PRAGMA/BEGIN/COMMIT).
ALTER TABLE tasks ADD COLUMN result_text TEXT;
