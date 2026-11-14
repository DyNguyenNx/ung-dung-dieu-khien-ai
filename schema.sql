-- Schema D1 cho "Ứng dụng Điều Khiển AI"
-- Database: app-dieu-khien-ai-db
-- Chạy bằng: wrangler d1 execute app-dieu-khien-ai-db --remote --file=schema.sql
-- (hoặc dán vào mục SQL của D1 trên dashboard Cloudflare)
--
-- Quy ước:
-- - id dùng crypto.randomUUID() (TEXT).
-- - created_at / updated_at lưu dạng ISO 8601 UTC (vd: 2026-11-14T08:30:00.000Z).
--   "Tuần ISO hiện tại" tính theo giờ Việt Nam (+7) bằng
--   strftime('%Y-%W', created_at, '+7 hours').
-- - password_hash lưu dạng "salt_base64:hash_base64" (PBKDF2-SHA256, 100.000 vòng).
-- - sessions chỉ lưu SHA-256 của token (không lưu token thô).
-- - D1 không bật ép khóa ngoại (FOREIGN KEY) mặc định nên code tự xóa
--   liên đới (sessions, user_limits, tasks) khi xóa user.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'locked', 'rejected')),
  deposit_vnd INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS user_limits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  weekly_limit INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, feature)
);
CREATE INDEX IF NOT EXISTS idx_user_limits_user_id ON user_limits(user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'waiting', 'scheduled', 'error')),
  progress INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  result_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_feature ON tasks(feature);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
