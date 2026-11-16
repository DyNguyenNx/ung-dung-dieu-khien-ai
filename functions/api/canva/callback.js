// GET /api/canva/callback — Canva chuyển về sau khi người dùng cấp quyền
// (Yêu cầu 36). Redirect URI đã đăng ký trên canva.dev:
// https://ung-dung-dieu-khien-ai.pages.dev/api/canva/callback
// Kiểm tra state (1 lần duy nhất, đúng admin đã bắt đầu luồng, chưa hết hạn
// 10 phút) rồi đổi code + code_verifier lấy access + refresh token, lưu vào
// D1 (canva_tokens) và chuyển về app với ?canva=connected. Mọi lỗi đều
// chuyển về app với ?canva=error&reason=... — không bao giờ để token/code
// lọt ra URL hay trang trả về.
import { requireAdmin } from '../../_lib/auth.js';
import { exchangeCode, saveCanvaTokens } from '../../_lib/canva.js';

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
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const denied = url.searchParams.get('error');
  if (denied) return home(context.request, 'denied');
  if (!code || !state) return home(context.request, 'missing');
  const { user, response } = await requireAdmin(context.env, context.request);
  if (response) return home(context.request, 'auth');
  const row = await context.env.DB.prepare(
    'SELECT * FROM canva_oauth_states WHERE state = ?',
  ).bind(state).first();
  if (!row || row.user_id !== user.id) return home(context.request, 'state');
  await context.env.DB.prepare('DELETE FROM canva_oauth_states WHERE state = ?').bind(state).run();
  if (new Date(row.expires_at).getTime() < Date.now()) return home(context.request, 'expired');
  try {
    const tokens = await exchangeCode(context.env, { code, verifier: row.code_verifier });
    await saveCanvaTokens(context.env, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope || '',
      connectedBy: user.id,
    });
  } catch {
    return home(context.request, 'exchange');
  }
  return home(context.request, null);
}
