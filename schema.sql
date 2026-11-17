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
  -- Yêu cầu 33: ảnh thật Gemini trả về cho Thiết kế hình ảnh.
  -- result_image = JSON {mime, data (base64), bytes, w, h, aspect, type,
  -- generated_at, ms} — CHỈ 1 ảnh / nhiệm vụ (bản mới nhất, xem migration 004).
  result_image TEXT,
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

-- Yêu cầu 36: nút "Chỉnh tiếp trên Canva" — OAuth Canva (xem migration 005).
-- canva_tokens: CHỈ 1 dòng (id='admin') — access + refresh token của Canva
-- (tài khoản Canva của admin). Refresh token xoay 1 lần: lưu token mới ngay
-- sau khi refresh. Token lưu dạng chữ thường trong D1 vì cần dùng được để
-- refresh; chỉ Worker đọc được, không trả token ra client bao giờ.
-- canva_oauth_states: state + PKCE code_verifier tạm (1 lần, hết hạn 10 phút).
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

-- Yêu cầu 38: website khách mà nhân viên thêm ở form "Thêm website mới"
-- (Chăm sóc web). admin_pass_enc = mật khẩu admin đã mã hóa AES-256-GCM
-- (xem functions/_lib/credentials.js) — KHÔNG BAO GIỜ lưu mật khẩu dạng thường.
-- Xem migration 006.
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

-- Yêu cầu 39: Google Search Console (phương án B — service account).
-- gsc_connections: 1 dòng / tài khoản đã nối (phương án B: 1 dòng service
-- account, refresh_token_enc NULL; access token chỉ giữ trong bộ nhớ).
-- gsc_properties: map slug dự án ↔ GSC property (site_url ghi đúng
-- identifier: URL-prefix https://... hoặc Domain sc-domain:...).
-- gsc_daily: số liệu ngày (cache 28 ngày gần nhất); gsc_top_queries: top
-- từ khóa theo kỳ (cap 50 dòng/dự án/kỳ); gsc_url_status: trạng thái index
-- từng URL (cache verdict 7 ngày); gsc_sync_log: nhật ký đồng bộ.
-- Xem migration 007.
CREATE TABLE IF NOT EXISTS gsc_connections (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL CHECK (method IN ('oauth', 'service_account')),
  account_label TEXT NOT NULL DEFAULT '',
  refresh_token_enc TEXT,
  scope TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gsc_properties (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL UNIQUE,
  site_url TEXT NOT NULL,
  connection_id TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'no_access', 'not_found')),
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gsc_properties_project ON gsc_properties(project);
CREATE TABLE IF NOT EXISTS gsc_daily (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  date TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  ctr REAL NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  UNIQUE(project, date)
);
CREATE INDEX IF NOT EXISTS idx_gsc_daily_project_date ON gsc_daily(project, date);
CREATE TABLE IF NOT EXISTS gsc_top_queries (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  period TEXT NOT NULL,
  query TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  ctr REAL NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gsc_top_queries_project_period ON gsc_top_queries(project, period);
CREATE TABLE IF NOT EXISTS gsc_url_status (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  url TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT '',
  coverage_state TEXT NOT NULL DEFAULT '',
  last_crawl TEXT NOT NULL DEFAULT '',
  canonical TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL,
  UNIQUE(project, url)
);
CREATE INDEX IF NOT EXISTS idx_gsc_url_status_project ON gsc_url_status(project);
CREATE TABLE IF NOT EXISTS gsc_sync_log (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  error TEXT,
  rows_synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gsc_sync_log_project_started ON gsc_sync_log(project, started_at);
