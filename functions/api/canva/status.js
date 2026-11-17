// GET /api/canva/status — Trạng thái kết nối Canva (Yêu cầu 36).
// Mọi tài khoản đã đăng nhập đều gọi được: chỉ trả {connected} cho nhân viên
// (đủ để hiện nút / thông báo trên thẻ nhiệm vụ). Admin thấy thêm
// {configured} (đã có CANVA_CLIENT_ID/SECRET trên Cloudflare chưa) +
// scope / expires_at / connected_by. KHÔNG BAO GIỜ trả token ra client.
import { json, requireAuth } from '../../_lib/auth.js';
import { getCanvaTokenRow, hasRequiredScopes } from '../../_lib/canva.js';

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await getCanvaTokenRow(context.env);
  // connected = có token ĐÃ ĐỦ scope yêu cầu. Token cũ thiếu scope (vd
  // cấp trước khi thêm asset:read, 17/11/2026) thì báo chưa kết nối để app
  // hiện lại nút "Kết nối Canva" cho admin cấp lại quyền, thay vì kẹt ở
  // nút "Chỉnh tiếp" rồi lỗi mãi. KHÔNG kiểm tra hết hạn ở đây: token hết
  // hạn vẫn tự refresh được ở getValidAccessToken, chỉ khi refresh thất bại
  // invalid_grant mới xoá dòng token (lúc đó connected tự thành false).
  const out = { ok: true, connected: !!row && hasRequiredScopes(row.scope || '') };
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
