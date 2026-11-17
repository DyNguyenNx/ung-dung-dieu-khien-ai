-- Migration 007 — Bảng Google Search Console (Yêu cầu 39, 17/11/2026).
-- Chạy trên D1 live TRƯỚC khi deploy code mới (code mới đọc/ghi các bảng này).
--   wrangler d1 execute app-dieu-khien-ai-db --remote --file=migrations/007-gsc.sql
--   (hoặc dán vào mục SQL của D1 trên dashboard Cloudflare)
-- Phương án B (service account): không lưu refresh token — gsc_connections
-- chỉ có 1 dòng service account (refresh_token_enc NULL). Access token chỉ
-- giữ trong bộ nhớ lúc gọi, không lưu D1, không ghi log. Private key chỉ nằm
-- trên Cloudflare secret (GSC_SA_PRIVATE_KEY), không vào repo/D1.
-- LƯU Ý: file này chỉ có CREATE TABLE / CREATE INDEX, không có lệnh
-- giao dịch hay pragma nào — D1 Console từ chối SQL chứa lệnh đó
-- (bài học từ migration 001/005/006).
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
