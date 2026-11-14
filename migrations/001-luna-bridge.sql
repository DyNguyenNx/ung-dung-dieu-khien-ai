-- Migration 001 — Cầu nối Thư Ký Mỹ Linh cho Design Web (Yêu cầu 28, 15/11/2026).
-- Chạy trên D1 live TRƯỚC khi deploy code mới (code mới INSERT/đọc 2 cột mới
-- và dùng 2 trạng thái mới 'luna' / 'review').
--   wrangler d1 execute app-dieu-khien-ai-db --remote --file=migrations/001-luna-bridge.sql
--   (hoặc dán vào mục SQL của D1 trên dashboard Cloudflare)
-- SQLite không sửa CHECK constraint trực tiếp được nên rebuild bảng tasks:
-- tạo bảng mới → copy dữ liệu → xóa bảng cũ → đổi tên → tạo lại index.
-- Dữ liệu cũ giữ nguyên (status cũ vẫn hợp lệ trong CHECK mới).
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;
CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'waiting', 'scheduled', 'error', 'luna', 'review')),
  progress INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  result_url TEXT,
  result_html TEXT,
  result_versions TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO tasks_new (id, user_id, feature, title, status, progress, payload, result_url, result_html, result_versions, created_at, updated_at)
  SELECT id, user_id, feature, title, status, progress, payload, result_url, NULL, NULL, created_at, updated_at FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_feature ON tasks(feature);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
COMMIT;
PRAGMA foreign_keys = ON;
