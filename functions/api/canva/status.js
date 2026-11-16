// GET /api/canva/status — Trạng thái kết nối Canva (Yêu cầu 36).
// Mọi tài khoản đã đăng nhập đều gọi được: chỉ trả {connected} cho nhân viên
// (đủ để hiện nút / thông báo trên thẻ nhiệm vụ). Admin thấy thêm
// {configured} (đã có CANVA_CLIENT_ID/SECRET trên Cloudflare chưa) +
// scope / expires_at / connected_by. KHÔNG BAO GIỜ trả token ra client.
import { json, requireAuth } from '../../_lib/auth.js';
import { getCanvaTokenRow } from '../../_lib/canva.js';

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await getCanvaTokenRow(context.env);
  const out = { ok: true, connected: !!row };
  if (user.role === 'admin') {
    out.configured = !!(context.env.CANVA_CLIENT_ID && context.env.CANVA_CLIENT_SECRET);
    if (row) {
      out.scopes = row.scope || '';
      out.expires_at = row.expires_at;
      out.connected_by = row.connected_by || '';
    }
  }
  return json(out);
}
