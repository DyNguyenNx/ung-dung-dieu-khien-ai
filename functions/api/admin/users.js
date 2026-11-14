// GET /api/admin/users — Liệt kê toàn bộ tài khoản kèm trạng thái, tiền đã nạp,
// lượt dùng từng tính năng trong tuần này và ngày tham gia. (Chỉ Admin)
import { json, FEATURE_KEYS, requireAdmin, getLimit, getUsedThisWeek } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { user, response } = await requireAdmin(context.env, context.request);
  if (response) return response;
  const { results } = await context.env.DB.prepare(
    'SELECT id, name, email, role, status, deposit_vnd, created_at FROM users ORDER BY created_at ASC',
  ).all();
  const users = [];
  for (const u of results || []) {
    const limits = {};
    const used = {};
    for (const f of FEATURE_KEYS) {
      limits[f] = await getLimit(context.env, u.id, f);
      used[f] = await getUsedThisWeek(context.env, u.id, f);
    }
    users.push({ ...u, limits, used });
  }
  return json({ ok: true, users });
}
