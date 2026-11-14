// POST /api/auth/logout — Đăng xuất: xóa session + xóa cookie.
import { json, parseCookies, sha256Hex, clearSessionCookie } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = parseCookies(request).session;
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(request) });
}
