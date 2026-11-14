// POST /api/auth/register — Đăng ký.
// Người đăng ký ĐẦU TIÊN (bảng users còn trống) tự thành Admin + Active
// (anh Dy đăng ký đầu tiên bằng nguyenduy.nasani@gmail.com).
// Các đăng ký sau mặc định status "pending" — Admin duyệt mới dùng được.
// Nếu là Admin bootstrap thì tạo session ngay (đăng nhập luôn).
import { json, err, nowIso, uuid, hashPassword, createSession, sessionCookie } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return err('Dữ liệu gửi lên không hợp lệ.', 400);
  }
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const password2 = String(body.password2 || '');
  if (name.length < 2) return err('Nhập họ tên đầy đủ.', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Email không hợp lệ.', 400);
  if (password.length < 6) return err('Mật khẩu tối thiểu 6 ký tự.', 400);
  if (password !== password2) return err('Hai mật khẩu nhập lại không khớp.', 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return err('Email này đã đăng ký rồi — đăng nhập hoặc dùng email khác.', 409);

  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const isFirst = (countRow ? countRow.n : 0) === 0;
  const role = isFirst ? 'admin' : 'staff';
  const status = isFirst ? 'active' : 'pending';
  const id = uuid();
  const now = nowIso();
  await env.DB.prepare(
    'INSERT INTO users (id, name, email, password_hash, role, status, deposit_vnd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).bind(id, name, email, await hashPassword(password), role, status, now, now).run();

  if (isFirst) {
    const { token } = await createSession(env, id);
    return json(
      { ok: true, status, role, isAdmin: true, session: true, user: { id, name, email, role, status } },
      201,
      { 'Set-Cookie': sessionCookie(request, token) },
    );
  }
  return json(
    { ok: true, status, role, isAdmin: false, session: false, user: { id, name, email, role, status } },
    201,
  );
}
