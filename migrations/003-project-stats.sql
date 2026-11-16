-- Migration 003 — Bảng thống kê theo dự án (Yêu cầu 31, 16/11/2026).
-- Chạy trên D1 live TRƯỚC khi deploy code mới (code mới đọc/ghi bảng này).
--   wrangler d1 execute app-dieu-khien-ai-db --remote --file=migrations/003-project-stats.sql
--   (hoặc dán vào mục SQL của D1 trên dashboard Cloudflare)
-- project_stats: số liệu Luna đẩy từ Muse về từng dự án theo tuần
-- (nguồn 2 của dashboard thống kê theo dự án). Một dòng = 1 dự án + 1 loại
-- + 1 tuần; đẩy lại cùng khóa thì cập nhật đè (upsert), không tạo dòng mới.
-- LƯU Ý: file này KHÔNG có PRAGMA/BEGIN/COMMIT — D1 Console từ chối SQL chứa
-- BEGIN TRANSACTION (bài học từ migration 001: phải chạy bản đã bỏ PRAGMA/BEGIN/COMMIT).
CREATE TABLE IF NOT EXISTS project_stats (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('article', 'page', 'web')),
  period TEXT NOT NULL,
  scheduled INTEGER NOT NULL DEFAULT 0,
  posted INTEGER NOT NULL DEFAULT 0,
  links TEXT,
  details TEXT,
  source TEXT NOT NULL DEFAULT 'luna',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project, kind, period)
);
CREATE INDEX IF NOT EXISTS idx_project_stats_project ON project_stats(project);
CREATE INDEX IF NOT EXISTS idx_project_stats_period ON project_stats(period);
