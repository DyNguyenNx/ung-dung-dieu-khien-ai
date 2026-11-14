// POST /api/tasks/:id/approve — Admin duyệt bản thiết kế Luna đã trả (Yêu cầu 28).
// Chỉ Admin. Nhiệm vụ phải ở trạng thái 'review' (đã có file) → 'completed'.
// Nhân viên thấy file chỉ sau khi anh duyệt.
import { json, err, requireAdmin, nowIso } from '../../../_lib/auth.js';

export async function onRequestPost(context) {
  const { response } = await requireAdmin(context.env, context.request);
  if (response) return response;
  const row = await context.env.DB.prepare('SELECT t.* FROM tasks t WHERE t.id = ?')
    .bind(context.params.id).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  if (row.feature !== 'designweb') return err('Nhiệm vụ này không phải Design Web.', 400);
  if (row.status !== 'review') {
    return err(`Nhiệm vụ đang ở trạng thái “${row.status}” — chỉ duyệt được khi đang chờ anh duyệt.`, 409);
  }
  if (!row.result_html) return err('Nhiệm vụ này chưa có file thiết kế để duyệt.', 409);
  await context.env.DB.prepare('UPDATE tasks SET status = ?, progress = 100, updated_at = ? WHERE id = ?')
    .bind('completed', nowIso(), context.params.id).run();
  return json({ ok: true, task_id: context.params.id, status: 'completed', message: 'Đã duyệt — nhân viên đã thấy được file thiết kế.' });
}
