-- Migration 008 — Bảng việc Muse đẩy về app (Yêu cầu 43, 17/11/2026).
-- Chạy trên D1 live TRƯỚC khi deploy code mới (code mới đọc/ghi bảng này).
--   wrangler d1 execute app-dieu-khien-ai-db --remote --file=migrations/008-muse-work.sql
--   (hoặc dán vào mục SQL của D1 trên dashboard Cloudflare)
-- muse_work: khóa chống trùng work_key ↔ nhiệm vụ trong bảng tasks.
-- Luna start việc bên Muse (bài viết / thiết kế) → tạo nhiệm vụ status
-- 'luna' trong app để bảng MCP thấy luồng; finish → nhiệm vụ sang 'review'
-- + upsert project_stats. Start lại cùng work_key thì trả task cũ, không
-- tạo thêm nhiệm vụ (chống đẩy trùng).
-- LƯU Ý: file này KHÔNG có PRAGMA/BEGIN/COMMIT — D1 Console từ chối SQL chứa
-- BEGIN TRANSACTION (bài học từ migration 001: phải chạy bản đã bỏ PRAGMA/BEGIN/COMMIT).
CREATE TABLE IF NOT EXISTS muse_work (
  work_key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('article', 'design', 'web')),
  title TEXT NOT NULL,
  link TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_muse_work_task_id ON muse_work(task_id);
CREATE INDEX IF NOT EXISTS idx_muse_work_project ON muse_work(project);
