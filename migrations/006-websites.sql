-- Migration 006 — Bảng `websites` (Yêu cầu 38, 17/11/2026).
-- Chạy trên D1 live TRƯỚC khi deploy code mới (code mới đọc/ghi bảng này).
--   wrangler d1 execute app-dieu-khien-ai-db --remote --file=migrations/006-websites.sql
--   (hoặc dán vào mục SQL của D1 trên dashboard Cloudflare)
-- websites: website khách mà nhân viên thêm ở form "Thêm website mới"
-- (Chăm sóc web). admin_pass_enc = mật khẩu admin đã mã hóa AES-256-GCM
-- (xem functions/_lib/credentials.js) — KHÔNG BAO GIỜ lưu mật khẩu dạng thường.
-- Tên đăng nhập (admin_user) lưu thường; mật khẩu chỉ Thư Ký Mỹ Linh giải mã
-- qua GET /api/luna/tasks/:id/credentials để đăng bài hộ nhân viên.
-- LƯU Ý: file này chỉ có CREATE TABLE / CREATE INDEX, không có lệnh
-- giao dịch hay pragma nào — D1 Console từ chối SQL chứa lệnh đó
-- (bài học từ migration 001/005).
CREATE TABLE IF NOT EXISTS websites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  admin_url TEXT NOT NULL DEFAULT '',
  admin_user TEXT NOT NULL DEFAULT '',
  admin_pass_enc TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_websites_user_id ON websites(user_id);
