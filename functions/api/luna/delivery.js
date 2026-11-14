// POST /api/luna/delivery — Thư Ký Mỹ Linh trả file HTML đã vẽ xong (Yêu cầu 28).
// Xác thực: header X-Luna-Secret phải khớp secret LUNA_API_SECRET.
// Body: { task_id, html, note? } — html tối đa 1MB.
// Lưu file vào result_html + thêm bản vào result_versions, status → 'review'
// (chờ anh duyệt), rồi gửi thông báo Telegram cho anh Dy.
import { json, err, lunaSecretOk, parseVersionsFull, nowIso, uuid } from '../../_lib/auth.js';
import { notifyDelivery, MAX_DELIVERY_BYTES } from '../../_lib/telegram.js';

export async function onRequestPost(context) {
  if (!(await lunaSecretOk(context.env, context.request))) {
    return err('Sai secret hoặc chưa cấu hình LUNA_API_SECRET.', 401);
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return err('Dữ liệu gửi lên không hợp lệ.', 400);
  }
  const taskId = String(body.task_id || '').trim();
  const html = typeof body.html === 'string' ? body.html : '';
  const note = String(body.note || '').trim().slice(0, 500);
  if (!taskId) return err('Thiếu task_id.', 400);
  if (!html.trim()) return err('Thiếu nội dung HTML.', 400);
  const size = new TextEncoder().encode(html).length;
  if (size > MAX_DELIVERY_BYTES) return err('File HTML nặng hơn 1MB — hãy gửi file gọn hơn.', 413);
  const trimmed = html.trim();
  if (!/^<!doctype html/i.test(trimmed) && !/^<html/i.test(trimmed)) {
    return err('Nội dung gửi lên không phải file HTML hoàn chỉnh (thiếu <!doctype html> hoặc <html>).', 400);
  }
  const row = await context.env.DB.prepare(
    'SELECT t.*, u.name AS user_name, u.email AS user_email FROM tasks t JOIN users u ON u.id = t.user_id WHERE t.id = ?',
  ).bind(taskId).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  if (row.feature !== 'designweb') return err('Nhiệm vụ này không phải Design Web.', 400);
  if (row.status !== 'luna' && row.status !== 'review') {
    return err(`Nhiệm vụ đang ở trạng thái “${row.status}” — chỉ nhận file khi đang chờ Thư Ký Mỹ Linh hoặc chờ duyệt.`, 409);
  }
  const versions = parseVersionsFull(row);
  const versionId = 'v' + (versions.length + 1);
  versions.push({ v: versionId, delivered_at: nowIso(), size, note, html });
  const now = nowIso();
  await context.env.DB.prepare(
    'UPDATE tasks SET status = ?, progress = 100, result_html = ?, result_versions = ?, updated_at = ? WHERE id = ?',
  ).bind('review', html, JSON.stringify(versions), now, taskId).run();
  // Thông báo cho anh Dy (best-effort — lỗi Telegram không làm hỏng việc giao file).
  await notifyDelivery(context.env, { id: taskId, title: row.title }, versionId).catch(() => {});
  return json({
    ok: true,
    task_id: taskId,
    version: versionId,
    status: 'review',
    size,
    message: `Đã nhận bản ${versionId} — nhiệm vụ đang chờ anh duyệt.`,
  });
}
