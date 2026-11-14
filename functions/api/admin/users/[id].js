// PATCH /api/admin/users/:id — Duyệt (status=active) / khóa (status=locked) /
// mở khóa (status=active), sửa tiền đã nạp, sửa giới hạn lượt từng tính năng.
// DELETE /api/admin/users/:id — Từ chối (xóa tài khoản chờ duyệt) hoặc xóa hẳn.
// Không sửa/xóa được tài khoản của chính mình; không xóa được tài khoản Admin.
import { json, err, FEATURE_KEYS, requireAdmin, nowIso } from '../../../_lib/auth.js';

export async function onRequestPatch(context) {
  const { user, response } = await requireAdmin(context.env, context.request);
  if (response) return response;
  const id = context.params.id;
  const target = await context.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) return err('Không tìm thấy tài khoản.', 404);
  if (target.id === user.id) return err('Không sửa được tài khoản của chính mình ở đây.', 400);
  let body;
  try {
    body = await context.request.json();
  } catch {
    return err('Dữ liệu gửi lên không hợp lệ.', 400);
  }
  const now = nowIso();
  if (body.status !== undefined) {
    if (!['active', 'locked'].includes(body.status)) return err('Trạng thái không hợp lệ.', 400);
    await context.env.DB.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').bind(body.status, now, id).run();
    if (body.status === 'locked') {
      await context.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    }
  }
  if (body.deposit_vnd !== undefined) {
    const v = parseInt(body.deposit_vnd, 10);
    if (isNaN(v) || v < 0) return err('Số tiền nạp không hợp lệ.', 400);
    await context.env.DB.prepare('UPDATE users SET deposit_vnd = ?, updated_at = ? WHERE id = ?').bind(v, now, id).run();
  }
  if (body.limits !== undefined) {
    if (typeof body.limits !== 'object' || body.limits === null) return err('Giới hạn lượt không hợp lệ.', 400);
    for (const f of Object.keys(body.limits)) {
      if (!FEATURE_KEYS.includes(f)) return err('Tính năng không hợp lệ: ' + f, 400);
      const v = parseInt(body.limits[f], 10);
      if (isNaN(v) || v < 0) return err('Giới hạn lượt không hợp lệ.', 400);
      await context.env.DB.prepare(
        `INSERT INTO user_limits (id, user_id, feature, weekly_limit, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, feature) DO UPDATE SET weekly_limit = excluded.weekly_limit, updated_at = excluded.updated_at`,
      ).bind(crypto.randomUUID(), id, f, v, now, now).run();
    }
  }
  const updated = await context.env.DB.prepare(
    'SELECT id, name, email, role, status, deposit_vnd, created_at FROM users WHERE id = ?',
  ).bind(id).first();
  return json({ ok: true, user: updated });
}

export async function onRequestDelete(context) {
  const { user, response } = await requireAdmin(context.env, context.request);
  if (response) return response;
  const id = context.params.id;
  const target = await context.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) return err('Không tìm thấy tài khoản.', 404);
  if (target.id === user.id) return err('Không xóa được tài khoản của chính mình.', 400);
  if (target.role === 'admin') return err('Không xóa được tài khoản Admin.', 403);
  // D1 không ép khóa ngoại nên tự xóa liên đới.
  await context.env.DB.batch([
    context.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM user_limits WHERE user_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM tasks WHERE user_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}
