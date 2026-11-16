// Canva Connect API — nút "Chỉnh tiếp trên Canva" (Yêu cầu 36, 16/11/2026).
//
// Luồng: upload ảnh (POST /v1/asset-uploads, body octet-stream + header
// Asset-Upload-Metadata, job bất đồng bộ, poll GET /v1/asset-uploads/{jobId}
// tới khi xong) -> tạo design từ asset (POST /v1/designs
// {design_type:{type:'custom',w,h}, asset_id, title}) -> trả
// design.urls.edit_url (chỉ người đã gọi API mới mở được, hết hạn 30 ngày).
// Ảnh vào design dạng 1 ẢNH PHẲNG DUY NHẤT — API không dựng sẵn bố cục/chữ
// (theo docs Canva: "placed in the design as a single flat image, which the
// user can move, resize, or replace, but not edit as separate elements").
// Design trống tạo bằng API sẽ tự xoá sau 7 ngày nếu không ai sửa.
//
// Auth: OAuth 2.0 Authorization Code + PKCE (S256, bắt buộc — không có key
// tĩnh). Client ID/secret đọc từ env CANVA_CLIENT_ID / CANVA_CLIENT_SECRET
// (Cloudflare secret, KHÔNG nằm trong code). Scopes tối thiểu:
// asset:write (upload), design:content:write (tạo design),
// design:meta:read (lấy lại link mới cho design đã tạo).
// Refresh token XOAY 1 LẦN (single-use): mỗi lần refresh trả refresh token
// mới; dùng lại token cũ sẽ thu hồi TOÀN BỘ token — nên phải lưu token mới
// ngay sau khi refresh, và chỉ refresh khi access token sắp hết hạn. Nếu
// refresh thất bại invalid_grant thì đọc lại dòng token (một request khác
// có thể vừa refresh xong), còn không thì đánh dấu mất kết nối để admin
// kết nối lại.
//
// Env override để QA local trỏ sang mock (theo mẫu POLLINATIONS_API_BASE_URL
// ở Yêu cầu 35): CANVA_API_BASE_URL, CANVA_AUTH_BASE_URL, CANVA_REDIRECT_URI.
// Redirect URI mặc định (đăng ký đúng y hệt trên canva.dev):
// https://ung-dung-dieu-khien-ai.pages.dev/api/canva/callback
//
// LƯU TRỮ TOKEN: access + refresh token lưu ở bảng canva_tokens trong D1
// (migration 005) — cần lưu được giá trị thật để refresh (không hash được
// như session token). Chỉ Worker đọc được qua binding DB; không trả token
// ra client bao giờ (endpoint /api/canva/status chỉ trả connected/configured).
import { nowIso } from './auth.js';

export const CANVA_SCOPES = 'asset:write design:content:write design:meta:read';
export const CANVA_TOKEN_ROW_ID = 'admin'; // 1 dòng duy nhất: Canva của admin.
export const CANVA_ACCESS_TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // Canva: ~4 giờ.
export const CANVA_UPLOAD_POLL_MS = 45000; // Chờ Canva xử lý ảnh tối đa 45s.

export function canvaApiBase(env) {
  return String(env.CANVA_API_BASE_URL || 'https://api.canva.com/rest/v1').replace(/\/$/, '');
}
export function canvaAuthBase(env) {
  return String(env.CANVA_AUTH_BASE_URL || 'https://www.canva.com').replace(/\/$/, '');
}
export function canvaRedirectUri(env) {
  return String(env.CANVA_REDIRECT_URI || 'https://ung-dung-dieu-khien-ai.pages.dev/api/canva/callback');
}

export const CANVA_NOT_CONFIGURED_MSG = 'Chưa cấu hình CANVA_CLIENT_ID / CANVA_CLIENT_SECRET trên Cloudflare — anh Dy thêm 2 secret này vào Pages → Settings → Variables rồi mới kết nối Canva được.';
export const CANVA_NOT_CONNECTED_MSG = 'Chưa kết nối Canva — admin bấm nút “Kết nối Canva” trên thẻ nhiệm vụ để cấp quyền một lần.';
export const CANVA_NEED_RECONNECT_MSG = 'Phiên kết nối Canva đã hết hạn — admin bấm “Kết nối Canva” để cấp quyền lại.';

// Lỗi Canva có mã riêng để endpoint map sang HTTP status + frontend nhận biết.
export class CanvaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------- PKCE (S256) ----------
function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomVerifier() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return b64url(bytes); // 64 ký tự (43–128 theo chuẩn PKCE).
}
export async function codeChallenge(verifier) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(d));
}

// URL đưa người dùng sang Canva cấp quyền.
export function canvaAuthUrl(env, { state, challenge }) {
  const u = new URL('/api/oauth/authorize', canvaAuthBase(env));
  u.searchParams.set('client_id', env.CANVA_CLIENT_ID || '');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', CANVA_SCOPES);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  u.searchParams.set('redirect_uri', canvaRedirectUri(env));
  return u.toString();
}

// ---------- Token (D1, bảng canva_tokens) ----------
export async function getCanvaTokenRow(env) {
  return env.DB.prepare('SELECT * FROM canva_tokens WHERE id = ?')
    .bind(CANVA_TOKEN_ROW_ID).first();
}
export async function saveCanvaTokens(env, { accessToken, refreshToken, expiresIn, scope, connectedBy }) {
  const ttlMs = (Number(expiresIn) > 0 ? Number(expiresIn) * 1000 : CANVA_ACCESS_TOKEN_TTL_MS);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO canva_tokens (id, access_token, refresh_token, expires_at, scope, connected_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       scope = excluded.scope,
       connected_by = excluded.connected_by,
       updated_at = excluded.updated_at`,
  ).bind(CANVA_TOKEN_ROW_ID, accessToken, refreshToken, expiresAt, scope || '', connectedBy || '', now, now).run();
  return expiresAt;
}
export async function deleteCanvaTokens(env) {
  await env.DB.prepare('DELETE FROM canva_tokens WHERE id = ?').bind(CANVA_TOKEN_ROW_ID).run();
}

// ---------- Dịch lỗi Canva thành tiếng Việt ----------
export function canvaErrorMessage(res, data) {
  const raw = (data && data.error && data.error.message)
    || (data && data.error && typeof data.error === 'string' ? data.error : '')
    || (data && data.message)
    || ('HTTP ' + res.status);
  const msg = String(raw).slice(0, 300);
  if (res.status === 401) return 'Canva từ chối xác thực (token không còn hiệu lực) — admin kết nối lại Canva. ' + msg;
  if (res.status === 403) return 'Tài khoản Canva không có quyền dùng tính năng này — kiểm tra gói Canva / quyền của app trên canva.dev. ' + msg;
  if (res.status === 429) {
    const retry = res.headers && res.headers.get ? res.headers.get('retry-after') : null;
    return 'Canva đang giới hạn số lần gọi' + (retry ? ' — thử lại sau ' + retry + ' giây.' : ' — thử bấm lại sau ít phút.');
  }
  return 'Canva báo lỗi (HTTP ' + res.status + '): ' + msg;
}

// Đổi code / refresh token lấy access token (POST form-urlencoded, Basic auth
// base64(client_id:client_secret) — Canva chặn gọi endpoint này từ trình duyệt
// (CORS) nên chỉ gọi từ Worker). Không bao giờ log client_secret / token.
async function exchangeToken(env, params) {
  const clientId = env.CANVA_CLIENT_ID || '';
  const clientSecret = env.CANVA_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new CanvaError('NOT_CONFIGURED', CANVA_NOT_CONFIGURED_MSG);
  let res;
  try {
    res = await fetch(canvaApiBase(env) + '/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa(clientId + ':' + clientSecret),
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new CanvaError('API_ERROR', 'Canva quá thời gian chờ (30 giây) — thử kết nối lại.');
    throw new CanvaError('API_ERROR', 'Không gọi được Canva: ' + (e && e.message ? e.message : 'lỗi mạng'));
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const code = data && data.error;
    if (code === 'invalid_grant') throw new CanvaError('INVALID_GRANT', 'Phiên kết nối Canva đã hết hạn — admin bấm “Kết nối Canva” để cấp quyền lại.');
    if (code === 'invalid_client') throw new CanvaError('NOT_CONFIGURED', 'Client ID/Secret của Canva không đúng — anh Dy kiểm tra lại 2 secret trên Cloudflare.');
    throw new CanvaError('API_ERROR', canvaErrorMessage(res, data));
  }
  if (!data || !data.access_token) throw new CanvaError('API_ERROR', 'Canva không trả token — thử kết nối lại.');
  return data;
}
export async function exchangeCode(env, { code, verifier }) {
  return exchangeToken(env, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: canvaRedirectUri(env),
  });
}

// Access token còn hạn (dự phòng 60 giây) thì dùng luôn; hết/sắp hết thì
// refresh — token xoay 1 lần nên lưu ngay token mới vào D1.
export async function getValidAccessToken(env) {
  const row = await getCanvaTokenRow(env);
  if (!row) throw new CanvaError('NOT_CONNECTED', CANVA_NOT_CONNECTED_MSG);
  const exp = Date.parse(row.expires_at || '');
  if (Number.isFinite(exp) && exp - Date.now() > 60000) return row.access_token;
  try {
    const data = await exchangeToken(env, { grant_type: 'refresh_token', refresh_token: row.refresh_token });
    await saveCanvaTokens(env, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || row.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope || row.scope,
      connectedBy: row.connected_by || '',
    });
    return data.access_token;
  } catch (e) {
    if (e && e.code === 'INVALID_GRANT') {
      // Có thể một request khác vừa refresh xong (token cũ đã bị thu hồi):
      // đọc lại dòng token — nếu đã mới thì dùng luôn, khỏi bắt admin nối lại.
      const fresh = await getCanvaTokenRow(env);
      if (fresh && fresh.refresh_token !== row.refresh_token
        && Date.parse(fresh.expires_at || '') - Date.now() > 60000) {
        return fresh.access_token;
      }
      await deleteCanvaTokens(env);
      throw new CanvaError('NEED_RECONNECT', CANVA_NEED_RECONNECT_MSG);
    }
    throw e;
  }
}

// ---------- Upload ảnh lên Canva (job bất đồng bộ) ----------
// POST /v1/asset-uploads: body = bytes thô (application/octet-stream),
// header Asset-Upload-Metadata = JSON {name_base64}. Trả job {id, status};
// poll GET /v1/asset-uploads/{jobId} tới khi success (trả asset.id) hoặc
// failed. Ảnh < 50MB (ảnh app tạo ra tối đa ~2,5MB nên không lo).
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function uploadAsset(env, accessToken, { bytes, name, mime }) {
  const nameB64 = btoa(String.fromCharCode.apply(null, new TextEncoder().encode(name)));
  let res;
  try {
    res = await fetch(canvaApiBase(env) + '/asset-uploads', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/octet-stream',
        'Asset-Upload-Metadata': JSON.stringify({ name_base64: nameB64 }),
      },
      body: bytes,
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new CanvaError('UPLOAD_FAILED', 'Tải ảnh lên Canva quá thời gian chờ — thử bấm lại.');
    throw new CanvaError('UPLOAD_FAILED', 'Không tải được ảnh lên Canva: ' + (e && e.message ? e.message : 'lỗi mạng'));
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new CanvaError('UPLOAD_FAILED', canvaErrorMessage(res, data));
  const jobId = data && data.job && data.job.id;
  if (!jobId) throw new CanvaError('UPLOAD_FAILED', 'Canva không trả mã job upload — thử bấm lại.');
  const deadline = Date.now() + CANVA_UPLOAD_POLL_MS;
  while (Date.now() < deadline) {
    let pollRes;
    try {
      pollRes = await fetch(canvaApiBase(env) + '/asset-uploads/' + encodeURIComponent(jobId), {
        headers: { Authorization: 'Bearer ' + accessToken },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      if (e && e.name === 'TimeoutError') throw new CanvaError('UPLOAD_FAILED', 'Canva xử lý ảnh quá lâu — thử bấm lại sau ít phút.');
      throw new CanvaError('UPLOAD_FAILED', 'Không kiểm tra được tiến độ upload lên Canva: ' + (e && e.message ? e.message : 'lỗi mạng'));
    }
    let pollData = null;
    try {
      pollData = await pollRes.json();
    } catch {
      pollData = null;
    }
    const job = pollData && pollData.job;
    if (pollRes.ok && job) {
      if (job.status === 'success' && job.asset && job.asset.id) return job.asset.id;
      if (job.status === 'failed') {
        const code = job.error && job.error.code;
        if (code === 'file_too_big') throw new CanvaError('UPLOAD_FAILED', 'Ảnh quá lớn, Canva không nhận (giới hạn 50MB) — giao lại việc với kích thước nhỏ hơn.');
        throw new CanvaError('UPLOAD_FAILED', 'Canva không nhận được ảnh (' + (code || 'import_failed') + ') — thử lại hoặc dùng ảnh khác.');
      }
    } else if (!pollRes.ok) {
      throw new CanvaError('UPLOAD_FAILED', canvaErrorMessage(pollRes, pollData));
    }
    await sleep(1000);
  }
  throw new CanvaError('TIMEOUT', 'Canva xử lý ảnh quá lâu (45 giây) — thử bấm lại sau ít phút.');
}

// ---------- Tạo design từ asset ----------
export function clampDesignSize(w, h) {
  // Canva design custom: mỗi cạnh 40–8000px, tổng diện tích ≤ 25.000.000px².
  let cw = Math.max(40, Math.min(8000, Math.round(Number(w) || 1024)));
  let ch = Math.max(40, Math.min(8000, Math.round(Number(h) || 1024)));
  if (cw * ch > 25000000) {
    const s = Math.sqrt(25000000 / (cw * ch));
    cw = Math.max(40, Math.floor(cw * s));
    ch = Math.max(40, Math.floor(ch * s));
  }
  return { w: cw, h: ch };
}
export async function createDesign(env, accessToken, { assetId, w, h, title }) {
  const { w: cw, h: ch } = clampDesignSize(w, h);
  let res;
  try {
    res = await fetch(canvaApiBase(env) + '/designs', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        design_type: { type: 'custom', width: cw, height: ch },
        asset_id: assetId,
        title: String(title || 'Thiết kế từ App Điều Khiển AI').slice(0, 255),
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new CanvaError('DESIGN_FAILED', 'Canva tạo design quá thời gian chờ — thử bấm lại.');
    throw new CanvaError('DESIGN_FAILED', 'Không tạo được design trên Canva: ' + (e && e.message ? e.message : 'lỗi mạng'));
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new CanvaError('DESIGN_FAILED', canvaErrorMessage(res, data));
  const design = data && data.design;
  if (!design || !design.urls || !design.urls.edit_url) {
    throw new CanvaError('DESIGN_FAILED', 'Canva tạo design nhưng không trả link chỉnh sửa — thử bấm lại.');
  }
  return design;
}

// Lấy lại design (link edit_url mới — link cũ hết hạn sau 30 ngày).
export async function getDesign(env, accessToken, designId) {
  let res;
  try {
    res = await fetch(canvaApiBase(env) + '/designs/' + encodeURIComponent(designId), {
      headers: { Authorization: 'Bearer ' + accessToken },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new CanvaError('API_ERROR', 'Canva quá thời gian chờ — thử bấm lại.');
    throw new CanvaError('API_ERROR', 'Không lấy được design trên Canva: ' + (e && e.message ? e.message : 'lỗi mạng'));
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 404) throw new CanvaError('DESIGN_NOT_FOUND', 'Design trên Canva không còn (có thể đã tự xoá sau 7 ngày không sửa).');
  if (!res.ok) throw new CanvaError('API_ERROR', canvaErrorMessage(res, data));
  const design = data && data.design;
  if (!design || !design.urls || !design.urls.edit_url) {
    throw new CanvaError('DESIGN_NOT_FOUND', 'Design trên Canva không còn link chỉnh sửa.');
  }
  return design;
}

// Tên file không dấu cho asset upload (theo mẫu slug ở result.js).
export function slugifyTitle(title) {
  return String(title || 'hinh-anh').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'hinh-anh';
}

// Mở ảnh của nhiệm vụ 'anh' trên Canva: dùng lại design đã tạo (nếu còn)
// để không tải trùng asset; chưa có thì upload + tạo design mới.
// task = dòng tasks (có title), stored = JSON result_image {mime, data, w, h},
// payload = payload nhiệm vụ đã parse (đọc payload.canva.design_id).
export async function openTaskInCanva(env, { task, stored, payload }) {
  const accessToken = await getValidAccessToken(env);
  const existingId = payload && payload.canva && payload.canva.design_id;
  if (existingId) {
    try {
      const d = await getDesign(env, accessToken, existingId);
      return {
        edit_url: d.urls.edit_url,
        view_url: d.urls.view_url || '',
        design_id: d.id,
        asset_id: (payload.canva && payload.canva.asset_id) || '',
        reused: true,
      };
    } catch (e) {
      if (!e || e.code !== 'DESIGN_NOT_FOUND') throw e;
      // Design cũ đã mất (tự xoá sau 7 ngày không sửa) — tạo mới bên dưới.
    }
  }
  const bytes = Uint8Array.from(atob(stored.data), (c) => c.charCodeAt(0));
  const ext = stored.mime === 'image/jpeg' ? '.jpg' : (stored.mime === 'image/webp' ? '.webp' : '.png');
  const name = slugifyTitle(task.title) + ext;
  const assetId = await uploadAsset(env, accessToken, { bytes, name, mime: stored.mime || 'image/png' });
  const design = await createDesign(env, accessToken, {
    assetId,
    w: stored.w || 1024,
    h: stored.h || 1024,
    title: task.title,
  });
  return {
    edit_url: design.urls.edit_url,
    view_url: design.urls.view_url || '',
    design_id: design.id,
    asset_id: assetId,
    created: true,
  };
}
