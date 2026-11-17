// Helpers dùng chung cho mọi API endpoint.
// Thư mục này bắt đầu bằng "_" nên Cloudflare Pages KHÔNG tạo route cho nó.
export const FEATURES = {
  web: 'Chăm sóc web',
  page: 'Chăm sóc page',
  kenh: 'Xây dựng kênh',
  truyen: 'Viết truyện',
  anh: 'Thiết kế hình ảnh',
  designweb: 'Design Web',
};
export const FEATURE_KEYS = Object.keys(FEATURES);
export const TASK_STATUSES = ['running', 'completed', 'waiting', 'scheduled', 'error', 'luna', 'review'];
// 'luna' = đã gửi brief, đang chờ Thư Ký Mỹ Linh vẽ (Yêu cầu 28).
// 'review' = Luna đã trả file, chờ anh duyệt.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
export function err(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}
export function nowIso() {
  return new Date().toISOString();
}
export function uuid() {
  return crypto.randomUUID();
}

// ---------- Mật khẩu: PBKDF2-SHA256, 100.000 vòng, salt 16 byte ----------
// Lưu dạng "salt_base64:hash_base64".
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return b64(salt) + ':' + b64(bits);
}
export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const salt = unb64(parts[0]);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return b64(bits) === parts[1];
}

// ---------- Session: cookie HttpOnly, server chỉ lưu SHA-256 của token ----------
export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function parseCookies(request) {
  const out = {};
  const h = request.headers.get('Cookie') || '';
  h.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
export function sessionCookie(request, token, maxAge = 30 * 24 * 60 * 60) {
  const secure = new URL(request.url).protocol === 'https:';
  return `session=${token}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:';
  return `session=; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=0`;
}
export async function createSession(env, userId) {
  const token = crypto.randomUUID() + '-' + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(uuid(), userId, tokenHash, expiresAt, nowIso()).run();
  return { token, expiresAt };
}
export async function getSessionUser(env, request) {
  const token = parseCookies(request).session;
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.expires_at AS expiresAt, u.id, u.name, u.email, u.role, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  ).bind(tokenHash).first();
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role, status: row.status };
}
export async function requireAuth(env, request) {
  const user = await getSessionUser(env, request);
  if (!user) return { user: null, response: err('Chưa đăng nhập.', 401) };
  if (user.status === 'locked') return { user: null, response: err('Tài khoản đã bị khóa. Liên hệ quản trị viên.', 403) };
  if (user.status === 'pending') return { user: null, response: err('Tài khoản đang chờ quản trị viên duyệt.', 403) };
  if (user.status === 'rejected') return { user: null, response: err('Tài khoản đã bị từ chối.', 403) };
  return { user, response: null };
}
export async function requireAdmin(env, request) {
  const { user, response } = await requireAuth(env, request);
  if (response) return { user: null, response };
  if (user.role !== 'admin') return { user: null, response: err('Chỉ Admin mới dùng được chức năng này.', 403) };
  return { user, response: null };
}

// ---------- Giới hạn lượt (tuần ISO, giờ Việt Nam) ----------
export function weekKeySql(col = 'created_at') {
  return `strftime('%Y-%W', ${col}, '+7 hours')`;
}
export async function getLimit(env, userId, feature) {
  const row = await env.DB.prepare('SELECT weekly_limit FROM user_limits WHERE user_id = ? AND feature = ?')
    .bind(userId, feature).first();
  return row ? row.weekly_limit : 1;
}
export async function getUsedThisWeek(env, userId, feature) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM tasks
     WHERE user_id = ? AND feature = ?
       AND ${weekKeySql()} = strftime('%Y-%W', 'now', '+7 hours')`,
  ).bind(userId, feature).first();
  return row ? row.n : 0;
}

export function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    deposit_vnd: u.deposit_vnd,
    created_at: u.created_at,
  };
}

// ---------- Nhiệm vụ Design Web — file Luna trả về (Yêu cầu 28) ----------
// result_versions lưu JSON mảng [{v, delivered_at, size, note, html}].
// Yêu cầu 30: bản web/page lưu thêm {kind: 'posted'|'content', text, link}.
// Trả về cho client CHỈ metadata (không kèm html/text) để danh sách không phình to;
// nội dung lấy riêng qua GET /api/tasks/:id/result.
export function parseVersions(row) {
  if (!row || !row.result_versions) return [];
  try {
    const arr = JSON.parse(row.result_versions);
    if (!Array.isArray(arr)) return [];
    return arr.map((v) => ({ v: v.v, delivered_at: v.delivered_at, size: v.size || 0, note: v.note || '', kind: v.kind || 'html' }));
  } catch {
    return [];
  }
}
export function parseVersionsFull(row) {
  if (!row || !row.result_versions) return [];
  try {
    const arr = JSON.parse(row.result_versions);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
export function taskExtras(row) {
  const versions = parseVersions(row);
  return {
    has_result: !!(row && row.result_html),
    // Yêu cầu 30: web/page qua cầu nối Luna trả kết quả text (báo cáo đã đăng / nội dung).
    has_result_text: !!(row && row.result_text),
    // Yêu cầu 33: Thiết kế hình ảnh qua Gemini trả ảnh thật (cột result_image).
    has_result_image: !!(row && row.result_image),
    result_versions: versions,
  };
}

// ---------- Chăm sóc page CHỈ Admin (Yêu cầu 38, bổ sung 09:27 17/11/2026) ----------
// Luna chỉ viết/đăng được trên page của anh (qua facebook-cli), không đăng được
// lên page của nhân viên — nên nhân viên không tạo/dùng được nhiệm vụ page.
// Trả về response lỗi 403 khi tài khoản không phải admin đụng tới feature 'page',
// ngược lại trả null. Dùng ở mọi endpoint task (tạo, xem, sửa, xóa, duyệt...).
export function forbidStaffPage(user, feature) {
  if (feature === 'page' && user && user.role !== 'admin') {
    return err('Chăm sóc page chỉ Admin dùng — nhân viên không tạo/xem được nhiệm vụ page.', 403);
  }
  return null;
}

// ---------- Cầu nối Thư Ký Mỹ Linh (Yêu cầu 28 + 30) ----------
// Nhiệm vụ qua cầu nối khi AI phụ trách là Thư Ký Mỹ Linh. Design Web mặc định
// là Luna nên không cần kiểm tra; web/page chỉ qua Luna khi nhân viên chọn
// "Thư Ký Mỹ Linh" ở bộ chọn AI (payload.ai ghi lúc giao việc).
export function isLunaAi(ai) {
  return String(ai || '').indexOf('Mỹ Linh') !== -1;
}

// ---------- Secret của Luna (Yêu cầu 28): so sánh bằng hash, tránh rò rỉ qua timing ----------
export async function lunaSecretOk(env, request) {
  const expected = env.LUNA_API_SECRET || '';
  if (!expected) return false;
  const given = request.headers.get('X-Luna-Secret') || '';
  if (!given) return false;
  const a = await sha256Hex(expected);
  const b = await sha256Hex(given);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
