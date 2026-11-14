// POST /api/auth/login — Đăng nhập (email + mật khẩu).
// Tài khoản pending/locked/rejected đều bị chặn ở đây.
import { json, err, verifyPassword, createSession, sessionCookie } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return err('Dữ liệu gửi lên không hợp lệ.', 400);
  }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!u || !(await verifyPassword(password, u.password_hash))) {
    return err('Email hoặc mật khẩu không đúng.', 401);
  }
  if (u.status === 'pending') return err('Tài khoản đang chờ quản trị viên duyệt.', 403);
  if (u.status === 'locked') return err('Tài khoản đã bị khóa. Liên hệ quản trị viên.', 403);
  if (u.status === 'rejected') return err('Tài khoản đã bị từ chối.', 403);
  const { token } = await createSession(env, u.id);
  return json(
    { ok: true, user: { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status } },
    200,
    { 'Set-Cookie': sessionCookie(request, token) },
  );
}
