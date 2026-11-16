// POST /api/tasks/:id/revision — Yêu cầu chỉnh sửa kết quả Luna đã trả (Yêu cầu 28 + 30).
// Admin hoặc chủ nhiệm vụ. Body: { note }.
// Lưu ghi chú vào payload.luna.revisions, gửi thông báo Telegram, đưa nhiệm vụ
// về trạng thái 'luna' để Luna poll thấy và trả bản mới (v2, v3…).
// Nhận yêu cầu chỉnh sửa cả khi nhiệm vụ đã 'completed' (sửa sau bàn giao)
// lẫn khi đang 'review' (chưa duyệt mà đã thấy chỗ cần sửa).
import { json, err, requireAuth, nowIso } from '../../../_lib/auth.js';
import { notifyRevision } from '../../../_lib/telegram.js';

export async function onRequestPost(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await context.env.DB.prepare(
    'SELECT t.*, u.name AS user_name, u.email AS user_email FROM tasks t JOIN users u ON u.id = t.user_id WHERE t.id = ?',
  ).bind(context.params.id).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  if (row.feature !== 'designweb' && row.feature !== 'web' && row.feature !== 'page') {
    return err('Nhiệm vụ này không qua cầu nối Thư Ký Mỹ Linh.', 400);
  }
  if (user.role !== 'admin' && row.user_id !== user.id) {
    return err('Không có quyền yêu cầu chỉnh sửa nhiệm vụ này.', 403);
  }
  if (row.status !== 'review' && row.status !== 'completed') {
    return err(`Nhiệm vụ đang ở trạng thái “${row.status}” — chưa có kết quả để yêu cầu chỉnh sửa.`, 409);
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return err('Dữ liệu gửi lên không hợp lệ.', 400);
  }
  const note = String(body.note || '').trim();
  if (!note) return err('Hãy ghi rõ chỗ cần sửa trước khi gửi.', 400);
  if (note.length > 2000) return err('Ghi chú chỉnh sửa tối đa 2000 ký tự.', 400);
  const payload = row.payload ? JSON.parse(row.payload) : {};
  const luna = payload.luna || {};
  luna.revisions = Array.isArray(luna.revisions) ? luna.revisions : [];
  luna.revisions.push({ note, by: user.name || '', at: nowIso() });
  payload.luna = luna;
  await context.env.DB.prepare('UPDATE tasks SET status = ?, progress = 0, payload = ?, updated_at = ? WHERE id = ?')
    .bind('luna', JSON.stringify(payload), nowIso(), context.params.id).run();
  // Thông báo cho anh Dy (best-effort — Luna lấy ghi chú qua /api/luna/pending).
  await notifyRevision(context.env, { id: row.id, title: row.title, feature: row.feature }, note, user.name || '').catch(() => {});
  return json({ ok: true, task_id: row.id, status: 'luna', message: 'Đã gửi yêu cầu chỉnh sửa cho Thư Ký Mỹ Linh — chờ kết quả mới.' });
}
