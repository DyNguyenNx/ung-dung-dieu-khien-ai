// Google Search Console API — Phương án B: service account (Yêu cầu 39).
//
// Auth: service account ký JWT RS256 bằng private key (WebCrypto — Workers
// không có google-auth-library), đổi lấy access token tại
// oauth2.googleapis.com/token, cache token trong bộ nhớ tới khi hết hạn.
// Secrets đọc từ env Cloudflare: GSC_SA_EMAIL + GSC_SA_PRIVATE_KEY (PEM).
// Chưa có secret → GscError NOT_CONFIGURED với lỗi rõ, KHÔNG crash.
// KHÔNG làm OAuth web-server flow ở đây (phương án A — chỉ dùng khi anh Dy
// đổi phương án; đổi phương án chỉ cần đổi secret + cờ, endpoint/DB giữ nguyên).
//
// Scope: webmasters.readonly (chỉ đọc). Chỉ xin scope ghi (webmasters) khi
// anh chốt thêm nộp sitemap qua API.
// Host mặc định: www.googleapis.com/webmasters/v3 (Search Analytics /
// Sitemaps / Sites) và searchconsole.googleapis.com/v1 (URL Inspection).
// Env override để QA local trỏ sang mock (theo mẫu CANVA_API_BASE_URL ở
// Yêu cầu 36): GSC_TOKEN_URL, GSC_API_BASE_URL, GSC_INSPECT_BASE_URL.
// Access token chỉ giữ trong bộ nhớ lúc gọi, không lưu D1, không ghi log.
// Private key KHÔNG BAO GIỜ vào repo/D1/log.
import { nowIso } from './auth.js';

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GSC_TOKEN_URL_DEFAULT = 'https://oauth2.googleapis.com/token';
export const GSC_API_BASE_DEFAULT = 'https://www.googleapis.com/webmasters/v3';
export const GSC_INSPECT_BASE_DEFAULT = 'https://searchconsole.googleapis.com/v1';
export const GSC_FETCH_TIMEOUT_MS = 30000;

export function gscTokenUrl(env) {
  return String(env.GSC_TOKEN_URL || GSC_TOKEN_URL_DEFAULT).replace(/\/$/, '');
}
export function gscApiBase(env) {
  return String(env.GSC_API_BASE_URL || GSC_API_BASE_DEFAULT).replace(/\/$/, '');
}
export function gscInspectBase(env) {
  return String(env.GSC_INSPECT_BASE_URL || GSC_INSPECT_BASE_DEFAULT).replace(/\/$/, '');
}

export const GSC_NOT_CONFIGURED_MSG =
  'Chưa cấu hình GSC_SA_EMAIL / GSC_SA_PRIVATE_KEY trên Cloudflare — anh Dy tạo service account trong Google Cloud, thêm email service account vào từng property trong Search Console, rồi dán 2 secret này vào Pages → Settings → Variables.';
export const GSC_NO_ACCESS_MSG =
  'Tài khoản service account chưa có quyền trên property này — thêm email service account vào Search Console của website (Settings → Users and permissions) rồi đồng bộ lại.';

export class GscError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------- base64url ----------
function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  const pad = (4 - (String(s).length % 4)) % 4;
  return Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)), (c) => c.charCodeAt(0));
}

// ---------- Service account ----------
// Chuẩn hoá khóa PEM đọc từ env: file JSON key Google cấp chứa private_key
// với "\n" dạng escape (chuỗi 2 ký tự backslash + n) — khi dán nguyên giá
// trị đó lên Cloudflare thì secret giữ dạng escape, phải đổi thành xuống
// dòng thật trước khi ký JWT. Khóa đã có xuống dòng thật thì giữ nguyên
// (không còn ký tự escape nào để thay). Idempotent: thân PEM base64 không
// bao giờ chứa backslash nên gọi nhiều lần vẫn cho cùng kết quả.
export function normalizePrivateKeyPem(pem) {
  return String(pem || '').replace(/\\n/g, '\n');
}

export function getServiceAccount(env) {
  const email = String(env.GSC_SA_EMAIL || '').trim();
  const key = normalizePrivateKeyPem(env.GSC_SA_PRIVATE_KEY).trim();
  if (!email || !key) throw new GscError('NOT_CONFIGURED', GSC_NOT_CONFIGURED_MSG);
  if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(email)) {
    throw new GscError('NOT_CONFIGURED', 'GSC_SA_EMAIL không đúng dạng email service account (…@….iam.gserviceaccount.com) — kiểm tra lại secret trên Cloudflare.');
  }
  return { email, key };
}

function parsePrivateKeyPem(pem) {
  const body = String(pem || '')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, '')
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new GscError('KEY_INVALID', 'GSC_SA_PRIVATE_KEY không phải khóa PEM hợp lệ — kiểm tra lại secret trên Cloudflare.');
  try {
    const std = body.replace(/-/g, '+').replace(/_/g, '/');
    const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    throw new GscError('KEY_INVALID', 'GSC_SA_PRIVATE_KEY không phải base64 hợp lệ — kiểm tra lại secret trên Cloudflare.');
  }
}

async function importPrivateKey(pem) {
  const der = parsePrivateKeyPem(pem);
  try {
    return await crypto.subtle.importKey(
      'pkcs8', der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
    );
  } catch {
    throw new GscError('KEY_INVALID', 'GSC_SA_PRIVATE_KEY không import được (cần khóa PKCS#8 — file JSON key Google cấp) — kiểm tra lại secret trên Cloudflare.');
  }
}

// JWT RS256 cho service-account flow (Google OAuth 2.0 server-to-server).
async function createServiceAccountJwt(env, { email, key }) {
  const privateKey = await importPrivateKey(key);
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(new TextEncoder().encode(JSON.stringify({
    iss: email,
    scope: GSC_SCOPE,
    aud: gscTokenUrl(env),
    exp: nowSec + 3600,
    iat: nowSec,
  })));
  const unsigned = header + '.' + claim;
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, privateKey, new TextEncoder().encode(unsigned),
  );
  return unsigned + '.' + b64url(new Uint8Array(sig));
}

// Access token cache trong bộ nhớ (1 isolate): tránh ký JWT + đổi token
// mỗi lần gọi API. Token hết hạn thật thì Google trả 401 → xóa cache.
let cachedToken = null; // { token, expiresAt }
export function clearCachedToken() {
  cachedToken = null;
}

export async function getAccessToken(env) {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60000) return cachedToken.token;
  const sa = getServiceAccount(env);
  const jwt = await createServiceAccountJwt(env, sa);
  let res;
  try {
    res = await fetch(gscTokenUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
      signal: AbortSignal.timeout(GSC_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new GscError('API_ERROR', 'Google quá thời gian chờ khi đổi token (30 giây) — thử đồng bộ lại.');
    throw new GscError('API_ERROR', 'Không gọi được Google để đổi token: ' + (e && e.message ? e.message : 'lỗi mạng'));
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const msg = (data && (data.error_description || data.error)) || ('HTTP ' + res.status);
    if (res.status === 400 || res.status === 401) {
      throw new GscError('AUTH_FAILED', 'Google từ chối service account (sai email/khóa, hoặc chưa bật Search Console API trong Google Cloud) — ' + String(msg).slice(0, 200));
    }
    throw new GscError('API_ERROR', 'Google đổi token lỗi (HTTP ' + res.status + '): ' + String(msg).slice(0, 200));
  }
  if (!data || !data.access_token) throw new GscError('API_ERROR', 'Google không trả access token — thử đồng bộ lại.');
  const ttlMs = (Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600) * 1000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ttlMs };
  return cachedToken.token;
}

// ---------- Dịch lỗi Google thành tiếng Việt ----------
export function gscErrorMessage(res, data) {
  const raw = (data && data.error && (data.error.message || data.error.status))
    || (data && data.error && typeof data.error === 'string' ? data.error : '')
    || (data && data.message)
    || ('HTTP ' + res.status);
  const msg = String(raw).slice(0, 300);
  if (res.status === 401) return 'Google từ chối xác thực (token không còn hiệu lực) — thử đồng bộ lại. ' + msg;
  if (res.status === 403) return GSC_NO_ACCESS_MSG + ' ' + msg;
  if (res.status === 404) return 'Không tìm thấy property này trên Search Console (sai site_url hoặc tài khoản chưa có quyền) — kiểm tra lại mapping dự án ↔ property. ' + msg;
  if (res.status === 429) {
    const retry = res.headers && res.headers.get ? res.headers.get('retry-after') : null;
    return 'Google đang giới hạn số lần gọi API' + (retry ? ' — thử lại sau ' + retry + ' giây.' : ' — thử đồng bộ lại sau ít phút.');
  }
  return 'Google báo lỗi (HTTP ' + res.status + '): ' + msg;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gọi API Google có xác thực; retry 1 lần với backoff khi 429/5xx.
// Trả { status, data }. Lỗi HTTP → ném GscError (trừ 404 ở inspect: trả null
// để sync ghi verdict 'not_found' thay vì dừng cả dự án).
async function gscFetch(env, url, { method = 'GET', body = null, retryAuth = true } = {}) {
  const token = await getAccessToken(env);
  const headers = { Authorization: 'Bearer ' + token };
  let payload = null;
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(GSC_FETCH_TIMEOUT_MS) });
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new GscError('API_ERROR', 'Google quá thời gian chờ (30 giây) — thử đồng bộ lại.');
    throw new GscError('API_ERROR', 'Không gọi được Google: ' + (e && e.message ? e.message : 'lỗi mạng'));
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 401 && retryAuth) {
    // Token có thể đã hết hạn thật (cache lệch giờ) — xóa cache, lấy token
    // mới rồi gọi lại 1 lần duy nhất.
    clearCachedToken();
    return gscFetch(env, url, { method, body, retryAuth: false });
  }
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = res.headers && res.headers.get ? Number(res.headers.get('retry-after') || 0) : 0;
    await sleep(Math.min(5000, Math.max(1000, retryAfter * 1000 || 2000)));
    let res2;
    try {
      const token2 = await getAccessToken(env);
      res2 = await fetch(url, {
        method,
        headers: { ...headers, Authorization: 'Bearer ' + token2 },
        body: payload,
        signal: AbortSignal.timeout(GSC_FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      if (e && e.name === 'TimeoutError') throw new GscError('API_ERROR', 'Google quá thời gian chờ (30 giây) — thử đồng bộ lại.');
      throw new GscError('API_ERROR', 'Không gọi được Google: ' + (e && e.message ? e.message : 'lỗi mạng'));
    }
    let data2 = null;
    try { data2 = await res2.json(); } catch { data2 = null; }
    if (!res2.ok) {
      if (res2.status === 403) throw new GscError('NO_ACCESS', gscErrorMessage(res2, data2));
      if (res2.status === 429) throw new GscError('QUOTA', gscErrorMessage(res2, data2));
      throw new GscError('API_ERROR', gscErrorMessage(res2, data2));
    }
    return { status: res2.status, data: data2 };
  }
  if (!res.ok) {
    if (res.status === 403) throw new GscError('NO_ACCESS', gscErrorMessage(res, data));
    if (res.status === 429) throw new GscError('QUOTA', gscErrorMessage(res, data));
    throw new GscError('API_ERROR', gscErrorMessage(res, data));
  }
  return { status: res.status, data };
}

// ---------- Search Analytics ----------
// POST /sites/{siteUrl}/searchAnalytics/query
// dimensions: ['date'] | ['page'] | ['query'] (KHÔNG group page+query cùng
// lúc — đắt load quota nhất, theo spec). rowLimit tối đa 25.000.
export async function querySearchAnalytics(env, siteUrl, { startDate, endDate, dimensions, rowLimit = 1000 } = {}) {
  const url = gscApiBase(env) + '/sites/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query';
  const { data } = await gscFetch(env, url, {
    method: 'POST',
    body: {
      startDate,
      endDate,
      dimensions: dimensions || ['date'],
      rowLimit: Math.max(1, Math.min(25000, Number(rowLimit) || 1000)),
    },
  });
  const rows = (data && Array.isArray(data.rows)) ? data.rows : [];
  return rows.map((r) => ({
    keys: r.keys || [],
    clicks: Number(r.clicks) || 0,
    impressions: Number(r.impressions) || 0,
    ctr: Number(r.ctr) || 0,
    position: Number(r.position) || 0,
  }));
}

// ---------- URL Inspection ----------
// POST /v1/urlInspection/index:inspect {inspectionUrl, siteUrl}
// Trả { verdict, coverageState, lastCrawlTime, canonical } hoặc null khi
// Google trả 404 (URL chưa từng được Google biết tới).
export async function inspectUrl(env, siteUrl, url, _retried = false) {
  const endpoint = gscInspectBase(env) + '/urlInspection/index:inspect';
  const token = await getAccessToken(env);
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: url, siteUrl }),
      signal: AbortSignal.timeout(GSC_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new GscError('API_ERROR', 'Google quá thời gian chờ khi kiểm URL (30 giây) — thử đồng bộ lại.');
    throw new GscError('API_ERROR', 'Không gọi được Google: ' + (e && e.message ? e.message : 'lỗi mạng'));
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 404) return null;
  if (res.status === 401 && !_retried) {
    clearCachedToken();
    return inspectUrl(env, siteUrl, url, true);
  }
  if (res.status === 401) throw new GscError('AUTH_FAILED', 'Google từ chối xác thực khi kiểm URL — thử đồng bộ lại.');
  if (res.status === 429) throw new GscError('QUOTA', gscErrorMessage(res, data));
  if (!res.ok) {
    if (res.status === 403) throw new GscError('NO_ACCESS', gscErrorMessage(res, data));
    throw new GscError('API_ERROR', gscErrorMessage(res, data));
  }
  const r = (data && data.inspectionResult && data.inspectionResult.indexStatusResult) || {};
  return {
    verdict: r.verdict || 'NEUTRAL',
    coverageState: r.coverageState || '',
    lastCrawlTime: r.lastCrawlTime || '',
    canonical: (r.googleCanonical || r.userCanonical || ''),
  };
}

// ---------- Sites ----------
// GET /sites — danh sách property service account có quyền (dùng để đối
// chiếu khi map dự án ↔ property; chưa thấy property nào thì dừng ở đó).
export async function listSites(env) {
  const { data } = await gscFetch(env, gscApiBase(env) + '/sites');
  const entries = (data && Array.isArray(data.siteEntry)) ? data.siteEntry : [];
  return entries.map((e) => ({ siteUrl: e.siteUrl || '', permissionLevel: e.permissionLevel || '' }));
}

// ---------- Ngày (giờ Việt Nam) ----------
// Dữ liệu GSC trễ 2–3 ngày nên khoảng đồng bộ mặc định kết thúc ở hôm kia.
export function vnTodayIso(now = new Date()) {
  const d = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
export function addDaysIso(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function defaultSyncRange(now = new Date()) {
  const end = addDaysIso(vnTodayIso(now), -3);
  const start = addDaysIso(end, -27);
  return { startDate: start, endDate: end };
}
export { nowIso };
