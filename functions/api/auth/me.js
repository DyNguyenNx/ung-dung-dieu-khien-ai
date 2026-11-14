// GET /api/auth/me — Trả về tài khoản đang đăng nhập (từ cookie session).
import { json, err, getSessionUser } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context.env, context.request);
  if (!user) return err('Chưa đăng nhập.', 401);
  if (user.status !== 'active') return err('Tài khoản chưa được kích hoạt.', 403);
  return json({ ok: true, user });
}
