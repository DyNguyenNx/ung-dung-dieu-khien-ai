// GET /api/canva/auth — Bắt đầu kết nối Canva (Yêu cầu 36).
// Chỉ Admin: sinh state + PKCE code_verifier, lưu tạm vào D1
// (canva_oauth_states, hết hạn 10 phút), rồi chuyển hướng trình duyệt sang
// trang cấp quyền của Canva. Đây là endpoint điều hướng (navigation) nên mọi
// lỗi đều chuyển về app với ?canva=error&reason=... thay vì trả JSON.
import { requireAdmin, uuid, nowIso } from '../../_lib/auth.js';
import { canvaAuthUrl, codeChallenge, randomVerifier } from '../../_lib/canva.js';

function home(request, reason) {
  const u = new URL('/', request.url);
  if (reason) {
    u.searchParams.set('canva', 'error');
    u.searchParams.set('reason', reason);
  } else {
    u.searchParams.set('canva', 'connected');
  }
  return Response.redirect(u.toString(), 302);
}

export async function onRequestGet(context) {
  const { user, response } = await requireAdmin(context.env, context.request);
  if (response) return home(context.request, 'auth');
  if (!context.env.CANVA_CLIENT_ID || !context.env.CANVA_CLIENT_SECRET) {
    return home(context.request, 'not_configured');
  }
  const state = uuid() + '-' + uuid();
  const verifier = randomVerifier();
  const challenge = await codeChallenge(verifier);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await context.env.DB.prepare(
    'INSERT INTO canva_oauth_states (state, code_verifier, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(state, verifier, user.id, nowIso(), expiresAt).run();
  // Dọn state hết hạn (best-effort, không chặn luồng chính).
  try {
    await context.env.DB.prepare('DELETE FROM canva_oauth_states WHERE expires_at < ?').bind(nowIso()).run();
  } catch {
    // Bỏ qua — state hết hạn cũng bị từ chối ở callback.
  }
  return Response.redirect(canvaAuthUrl(context.env, { state, challenge }), 302);
}
