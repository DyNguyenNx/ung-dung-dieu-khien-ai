// /api/websites/:id — Xem / xóa một website khách (Yêu cầu 38).
// Chỉ chủ sở hữu hoặc admin. KHÔNG BAO GIỜ trả mật khẩu (chỉ has_creds).
import { json, err, requireAuth } from '../../_lib/auth.js';

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

async function loadWebsite(env, id) {
  return env.DB.prepare(
    'SELECT w.*, u.name AS owner_name, u.email AS owner_email FROM websites w JOIN users u ON u.id = w.user_id WHERE w.id = ?',
  ).bind(id).first();
}

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await loadWebsite(context.env, context.params.id);
  if (!row) return err('Không tìm thấy website.', 404);
  if (user.role !== 'admin' && row.user_id !== user.id) return err('Không có quyền xem website này.', 403);
  return json({ ok: true, website: websiteRow(row, user.role === 'admin') });
}

export async function onRequestDelete(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await loadWebsite(context.env, context.params.id);
  if (!row) return err('Không tìm thấy website.', 404);
  if (user.role !== 'admin' && row.user_id !== user.id) return err('Không có quyền xóa website này.', 403);
  await context.env.DB.prepare('DELETE FROM websites WHERE id = ?').bind(context.params.id).run();
  return json({ ok: true });
}
