// /api/websites — Danh sách + thêm website khách (Yêu cầu 38).
// GET: nhân viên chỉ thấy website của mình; admin thấy tất cả (kèm chủ sở hữu).
//   KHÔNG BAO GIỜ trả mật khẩu — chỉ trả has_creds (đã lưu mật khẩu admin hay chưa).
// POST {name, address?, admin_url?, admin_user?, admin_pass?}
//   — có admin_pass thì mã hóa bằng CRED_ENCRYPTION_KEY rồi mới lưu;
//   thiếu khóa thì trả lỗi rõ, KHÔNG lưu mật khẩu dạng thường.
//   Trùng tên website của chính mình → 409.
import { json, err, requireAuth, nowIso, uuid } from '../../_lib/auth.js';
import { encryptAdminPass, CredentialError } from '../../_lib/credentials.js';

function websiteRow(w, includeOwner) {
  const out = {
    id: w.id,
    user_id: w.user_id,
    name: w.name,
    address: w.address || '',
    admin_url: w.admin_url || '',
    admin_user: w.admin_user || '',
    has_creds: !!w.admin_pass_enc,
    created_at: w.created_at,
    updated_at: w.updated_at,
  };
  if (includeOwner) {
    out.owner_name = w.owner_name || '';
    out.owner_email = w.owner_email || '';
  }
  return out;
}

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const admin = user.role === 'admin';
  const sql = admin
    ? 'SELECT w.*, u.name AS owner_name, u.email AS owner_email FROM websites w JOIN users u ON u.id = w.user_id ORDER BY w.name ASC'
    : 'SELECT w.* FROM websites w WHERE w.user_id = ? ORDER BY w.name ASC';
  const args = admin ? [] : [user.id];
  const { results } = await context.env.DB.prepare(sql).bind(...args).all();
  return json({ ok: true, websites: (results || []).map((w) => websiteRow(w, admin)) });
}

export async function onRequestPost(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  let body;
  try {
    body = await context.request.json();
  } catch {
    return err('Dữ liệu gửi lên không hợp lệ.', 400);
  }
  const name = String(body.name || '').trim();
  if (!name) return err('Thiếu tên website.', 400);
  if (name.length > 200) return err('Tên website dài hơn 200 ký tự.', 400);
  const address = String(body.address || '').trim().slice(0, 500);
  const adminUrl = String(body.admin_url || '').trim().slice(0, 500);
  const adminUser = String(body.admin_user || '').trim().slice(0, 200);
  const adminPass = typeof body.admin_pass === 'string' ? body.admin_pass : '';
  let adminPassEnc = null;
  if (adminPass) {
    try {
      adminPassEnc = await encryptAdminPass(context.env, adminPass);
    } catch (e) {
      if (e instanceof CredentialError) return err(e.message, 500);
      return err('Không mã hóa được mật khẩu admin.', 500);
    }
  }
  const id = uuid();
  const now = nowIso();
  try {
    await context.env.DB.prepare(
      'INSERT INTO websites (id, user_id, name, address, admin_url, admin_user, admin_pass_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, user.id, name, address, adminUrl, adminUser, adminPassEnc, now, now).run();
  } catch (e) {
    if (String((e && e.message) || '').includes('UNIQUE')) {
      return err(`Website “${name}” đã có trong danh sách của bạn rồi.`, 409);
    }
    throw e;
  }
  const row = await context.env.DB.prepare('SELECT * FROM websites WHERE id = ?').bind(id).first();
  return json({ ok: true, website: websiteRow(row, false) }, 201);
}
