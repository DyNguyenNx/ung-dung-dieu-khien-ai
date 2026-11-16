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
    CHECK (status IN ('running', 'completed', 'waiting', 'scheduled', 'error', 'luna', 'review')),
  progress INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  result_url TEXT,
  -- Yêu cầu 28 (cầu nối Thư Ký Mỹ Linh): file HTML Luna trả về.
  -- result_html = HTML bản mới nhất; result_versions = JSON mảng
  -- [{v, delivered_at, size, note, html}] (đủ bản để Xem demo / Tải HTML từng bản).
  result_html TEXT,
  -- Yêu cầu 30: kết quả text Luna trả về cho Chăm sóc web/page.
  -- result_text = text bản mới nhất; result_versions = JSON mảng
  -- [{v, delivered_at, size, note, kind, text, link}] với kind 'posted'
  -- (Luna đã tự đăng — text là báo cáo, link là URL bài đã đăng) hoặc
  -- 'content' (nội dung hoàn chỉnh để nhân viên tự đăng).
  result_text TEXT,
  result_versions TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_feature ON tasks(feature);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- Yêu cầu 31: số liệu Luna đẩy từ Muse về từng dự án theo tuần
-- (nguồn 2 của dashboard thống kê theo dự án). Một dòng = 1 dự án +
-- 1 loại + 1 tuần; đẩy lại cùng khóa thì cập nhật đè (upsert).
-- links = JSON mảng URL bài đã đăng; details = JSON {seo, index,
-- late/missing, articles:[{date, title, link, seo, indexed}]}.
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
