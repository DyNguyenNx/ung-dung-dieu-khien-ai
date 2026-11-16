-- Migration 005 — Nút "Chỉnh tiếp trên Canva" (Yêu cầu 36, 16/11/2026).
-- Chạy trên D1 live TRƯỚC khi deploy code mới (code mới đọc/ghi 2 bảng này).
--   wrangler d1 execute app-dieu-khien-ai-db --remote --file=migrations/005-canva-tokens.sql
--   (hoặc dán vào mục SQL của D1 trên dashboard Cloudflare)
-- canva_tokens: CHỈ 1 dòng (id='admin') — access + refresh token OAuth của
-- Canva (tài khoản Canva của admin). Refresh token XOAY 1 LẦN (single-use):
-- mỗi lần refresh Canva trả refresh token mới, dùng lại token cũ sẽ thu hồi
-- toàn bộ token — code lưu token mới ngay sau khi refresh (xem
-- functions/_lib/canva.js). Token lưu dạng chữ thường trong D1 vì cần dùng
-- được để refresh (không hash được như session token); chỉ Worker đọc được
-- qua binding DB, không trả token ra client bao giờ.
-- canva_oauth_states: state + PKCE code_verifier tạm của luồng OAuth (1 lần,
-- hết hạn 10 phút), xoá ngay khi callback xong.
-- LƯU Ý: file này KHÔNG có PRAGMA/BEGIN/COMMIT — D1 Console từ chối SQL chứa
-- BEGIN TRANSACTION (bài học từ migration 001: phải chạy bản đã bỏ PRAGMA/BEGIN/COMMIT).
CREATE TABLE IF NOT EXISTS canva_tokens (
  id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  connected_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS canva_oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canva_oauth_states_expires ON canva_oauth_states(expires_at);
