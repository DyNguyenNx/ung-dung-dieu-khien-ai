// POST /api/luna/delivery — Thư Ký Mỹ Linh trả kết quả về app (Yêu cầu 28 + 30).
// Xác thực: header X-Luna-Secret phải khớp secret LUNA_API_SECRET.
// Design Web: Body { task_id, html, note? } — html tối đa 1MB, phải là file
//   HTML hoàn chỉnh. Lưu vào result_html + result_versions, status → 'review'.
// Chăm sóc web/page: Body { task_id, kind, text, link?, note? } — 2 loại kết quả:
//   kind 'posted'  = Luna đã TỰ ĐĂNG lên web/page thật (dự án của anh Dy):
//                    text = báo cáo đã làm gì, link = URL bài đã đăng.
//   kind 'content' = Luna trả NỘI DUNG hoàn chỉnh (dự án nhân viên đăng ký):
//                    text = bài viết / bài đăng để nhân viên tự đăng.
//   Lưu vào result_text + result_versions, status → 'review' (chờ anh duyệt).
// Sau khi giao: gửi thông báo Telegram cho anh Dy.
import { json, err, lunaSecretOk, parseVersionsFull, nowIso, uuid } from '../../_lib/auth.js';
import { notifyDelivery, MAX_DELIVERY_BYTES } from '../../_lib/telegram.js';
import { promoteNext } from '../../_lib/queue.js';

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
  if (!taskId) return err('Thiếu task_id.', 400);
  const row = await context.env.DB.prepare(
    'SELECT t.*, u.name AS user_name, u.email AS user_email FROM tasks t JOIN users u ON u.id = t.user_id WHERE t.id = ?',
  ).bind(taskId).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  if (row.feature !== 'designweb' && row.feature !== 'web' && row.feature !== 'page') {
    return err('Nhiệm vụ này không qua cầu nối Thư Ký Mỹ Linh.', 400);
  }
  if (row.status !== 'luna' && row.status !== 'review') {
    return err(`Nhiệm vụ đang ở trạng thái “${row.status}” — chỉ nhận kết quả khi đang chờ Thư Ký Mỹ Linh hoặc chờ duyệt.`, 409);
  }
  const note = String(body.note || '').trim().slice(0, 500);
  const now = nowIso();

  // ---------- Design Web: file HTML (Yêu cầu 28, giữ nguyên) ----------
  if (row.feature === 'designweb') {
    const html = typeof body.html === 'string' ? body.html : '';
    if (!html.trim()) return err('Thiếu nội dung HTML.', 400);
    const size = new TextEncoder().encode(html).length;
    if (size > MAX_DELIVERY_BYTES) return err('File HTML nặng hơn 1MB — hãy gửi file gọn hơn.', 413);
    const trimmed = html.trim();
    if (!/^<!doctype html/i.test(trimmed) && !/^<html/i.test(trimmed)) {
      return err('Nội dung gửi lên không phải file HTML hoàn chỉnh (thiếu <!doctype html> hoặc <html>).', 400);
    }
    const versions = parseVersionsFull(row);
    const versionId = 'v' + (versions.length + 1);
    versions.push({ v: versionId, delivered_at: now, size, note, html });
    await context.env.DB.prepare(
      'UPDATE tasks SET status = ?, progress = 100, result_html = ?, result_versions = ?, updated_at = ? WHERE id = ?',
    ).bind('review', html, JSON.stringify(versions), now, taskId).run();
    // Yêu cầu 45: giao xong NHẢ suất Đang tạo — đẩy việc chờ lên làm tiếp.
    await promoteNext(context.env, row.feature).catch(() => {});
    // Thông báo cho anh Dy (best-effort — lỗi Telegram không làm hỏng việc giao file).
    await notifyDelivery(context.env, { id: taskId, title: row.title, feature: row.feature }, versionId).catch(() => {});
    return json({
      ok: true,
      task_id: taskId,
      version: versionId,
      status: 'review',
      size,
      message: `Đã nhận bản ${versionId} — nhiệm vụ đang chờ anh duyệt.`,
    });
  }

  // ---------- Chăm sóc web/page: kết quả text (Yêu cầu 30) ----------
  const kind = String(body.kind || '').trim();
  const text = typeof body.text === 'string' ? body.text : '';
  const link = String(body.link || '').trim();
  if (kind !== 'posted' && kind !== 'content') {
    return err('kind phải là "posted" (Luna đã tự đăng) hoặc "content" (trả nội dung để nhân viên tự đăng).', 400);
  }
  if (!text.trim()) return err('Thiếu nội dung kết quả (text).', 400);
  const size = new TextEncoder().encode(text).length;
  if (size > MAX_DELIVERY_BYTES) return err('Nội dung kết quả nặng hơn 1MB — hãy gửi nội dung gọn hơn.', 413);
  if (kind === 'posted' && link && !/^https?:\/\//i.test(link)) {
    return err('link phải là URL bắt đầu bằng http:// hoặc https://.', 400);
  }
  const cleanLink = kind === 'posted' ? link : '';
  const versions = parseVersionsFull(row);
  const versionId = 'v' + (versions.length + 1);
  versions.push({ v: versionId, delivered_at: now, size, note, kind, text, link: cleanLink });
  await context.env.DB.prepare(
    'UPDATE tasks SET status = ?, progress = 100, result_text = ?, result_versions = ?, updated_at = ? WHERE id = ?',
  ).bind('review', text, JSON.stringify(versions), now, taskId).run();
  // Yêu cầu 45: giao xong NHẢ suất Đang tạo — đẩy việc chờ lên làm tiếp.
  await promoteNext(context.env, row.feature).catch(() => {});
  // Thông báo cho anh Dy (best-effort — lỗi Telegram không làm hỏng việc giao kết quả).
  await notifyDelivery(context.env, { id: taskId, title: row.title, feature: row.feature }, versionId, kind).catch(() => {});
  const kindLabel = kind === 'posted' ? 'đã tự đăng' : 'nội dung để nhân viên tự đăng';
  return json({
    ok: true,
    task_id: taskId,
    version: versionId,
    kind,
    status: 'review',
    size,
    message: `Đã nhận kết quả ${versionId} (${kindLabel}) — nhiệm vụ đang chờ anh duyệt.`,
  });
}
