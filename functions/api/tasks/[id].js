// /api/tasks/:id — Xem / cập nhật / xóa một nhiệm vụ.
// Mọi thao tác đều kiểm tra quyền sở hữu (trừ Admin).
import { json, err, FEATURES, TASK_STATUSES, requireAuth, nowIso, taskExtras, forbidStaffPage } from '../../_lib/auth.js';

function taskRow(t) {
  return {
    id: t.id,
    user_id: t.user_id,
    user_name: t.user_name,
    user_email: t.user_email,
    feature: t.feature,
    title: t.title,
    status: t.status,
    progress: t.progress,
    payload: t.payload ? JSON.parse(t.payload) : null,
    result_url: t.result_url,
    ...taskExtras(t),
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}
async function loadTask(env, id) {
  return env.DB.prepare(
    'SELECT t.*, u.name AS user_name, u.email AS user_email FROM tasks t JOIN users u ON u.id = t.user_id WHERE t.id = ?',
  ).bind(id).first();
}
function canAccess(user, row) {
  return user.role === 'admin' || row.user_id === user.id;
}

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await loadTask(context.env, context.params.id);
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  // Yêu cầu 38 (bổ sung): Chăm sóc page CHỈ Admin — chặn cả chủ nhiệm vụ là nhân viên.
  const pg = forbidStaffPage(user, row.feature);
  if (pg) return pg;
  if (!canAccess(user, row)) return err('Không có quyền xem nhiệm vụ này.', 403);
  return json({ ok: true, task: taskRow(row) });
}

export async function onRequestPatch(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await loadTask(context.env, context.params.id);
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  // Yêu cầu 38 (bổ sung): Chăm sóc page CHỈ Admin — chặn cả chủ nhiệm vụ là nhân viên.
  const pg = forbidStaffPage(user, row.feature);
  if (pg) return pg;
  if (!canAccess(user, row)) return err('Không có quyền sửa nhiệm vụ này.', 403);
  let body;
  try {
    body = await context.request.json();
  } catch {
    return err('Dữ liệu gửi lên không hợp lệ.', 400);
  }
  const sets = [];
  const args = [];
  if (body.status !== undefined) {
    if (!TASK_STATUSES.includes(body.status)) return err('Trạng thái không hợp lệ.', 400);
    // Yêu cầu 28 + 30: nhiệm vụ qua cầu nối Luna (designweb/web/page) đang chờ
    // Luna / chờ duyệt thì chỉ Admin mới đổi trạng thái (duyệt qua
    // POST /api/tasks/:id/approve). Nhân viên không tự chuyển "Chờ Thư Ký
    // Mỹ Linh" / "Chờ anh duyệt" thành Hoàn thành.
    if (['designweb', 'web', 'page'].includes(row.feature) && (row.status === 'luna' || row.status === 'review') && user.role !== 'admin') {
      return err(`Nhiệm vụ ${FEATURES[row.feature]} đang chờ Thư Ký Mỹ Linh / chờ anh duyệt — chỉ Admin mới đổi trạng thái.`, 403);
    }
    sets.push('status = ?');
    args.push(body.status);
  }
  if (body.progress !== undefined) {
    const p = parseInt(body.progress, 10);
    if (isNaN(p) || p < 0 || p > 100) return err('Tiến độ phải từ 0 đến 100.', 400);
    sets.push('progress = ?');
    args.push(p);
  }
  if (body.result_url !== undefined) {
    sets.push('result_url = ?');
    args.push(body.result_url ? String(body.result_url) : null);
  }
  if (body.payload !== undefined) {
    if (body.payload !== null && (typeof body.payload !== 'object' || Array.isArray(body.payload))) {
      return err('Payload phải là object JSON.', 400);
    }
    sets.push('payload = ?');
    args.push(body.payload ? JSON.stringify(body.payload) : null);
  }
  if (!sets.length) return err('Không có trường nào để cập nhật.', 400);
  sets.push('updated_at = ?');
  args.push(nowIso(), context.params.id);
  await context.env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
  const updated = await loadTask(context.env, context.params.id);
  return json({ ok: true, task: taskRow(updated) });
}

export async function onRequestDelete(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await loadTask(context.env, context.params.id);
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  // Yêu cầu 38 (bổ sung): Chăm sóc page CHỈ Admin — chặn cả chủ nhiệm vụ là nhân viên.
  const pg = forbidStaffPage(user, row.feature);
  if (pg) return pg;
  if (!canAccess(user, row)) return err('Không có quyền xóa nhiệm vụ này.', 403);
  await context.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(context.params.id).run();
  return json({ ok: true });
}
