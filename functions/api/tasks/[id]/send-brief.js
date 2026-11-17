// POST /api/tasks/:id/send-brief — Gửi lại brief sang Telegram (Yêu cầu 28 + 30).
// Admin hoặc chủ nhiệm vụ. Dùng khi lần gửi đầu lỗi (payload.luna.sendError).
// Nhận multipart tùy chọn: clientPhotos[] + refPhotos[] để đính kèm lại ảnh
// (chỉ Design Web); không có ảnh thì chỉ gửi lại brief text.
import { json, err, requireAuth, nowIso, forbidStaffPage } from '../../../_lib/auth.js';
import { notifyBrief, MAX_CLIENT_PHOTOS, MAX_REF_PHOTOS, MAX_PHOTO_BYTES } from '../../../_lib/telegram.js';

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
  // Yêu cầu 38 (bổ sung): Chăm sóc page CHỈ Admin — chặn cả chủ nhiệm vụ là nhân viên.
  const pg = forbidStaffPage(user, row.feature);
  if (pg) return pg;
  if (user.role !== 'admin' && row.user_id !== user.id) {
    return err('Không có quyền gửi lại brief cho nhiệm vụ này.', 403);
  }
  if (row.status !== 'luna') {
    return err(`Nhiệm vụ đang ở trạng thái “${row.status}” — chỉ gửi lại brief khi đang chờ Thư Ký Mỹ Linh.`, 409);
  }
  const ct = context.request.headers.get('Content-Type') || '';
  let clientPhotos = [];
  let refPhotos = [];
  if (ct.includes('multipart/form-data')) {
    try {
      const fd = await context.request.formData();
      clientPhotos = fd.getAll('clientPhotos').filter((f) => f && typeof f !== 'string');
      refPhotos = fd.getAll('refPhotos').filter((f) => f && typeof f !== 'string');
    } catch {
      return err('Dữ liệu gửi lên không hợp lệ.', 400);
    }
    // Yêu cầu 30: chỉ Design Web mới nhận ảnh đính kèm (web/page chỉ có brief text).
    if (row.feature !== 'designweb' && (clientPhotos.length || refPhotos.length)) {
      return err('Chỉ nhiệm vụ Design Web mới nhận ảnh đính kèm.', 400);
    }
    if (clientPhotos.length > MAX_CLIENT_PHOTOS) return err(`Tối đa ${MAX_CLIENT_PHOTOS} ảnh thật của khách mỗi lần gửi.`, 400);
    if (refPhotos.length > MAX_REF_PHOTOS) return err(`Tối đa ${MAX_REF_PHOTOS} ảnh mẫu / tài liệu tham khảo mỗi lần gửi.`, 400);
    for (const f of [...clientPhotos, ...refPhotos]) {
      if (!f.type || !f.type.startsWith('image/')) return err(`File “${f.name || 'không tên'}” không phải ảnh.`, 400);
      if (f.size > MAX_PHOTO_BYTES) return err(`Ảnh “${f.name || 'không tên'}” nặng hơn 5MB.`, 400);
    }
  }
  const payload = row.payload ? JSON.parse(row.payload) : {};
  const luna = payload.luna || {};
  const photoFiles = [];
  for (const f of clientPhotos) photoFiles.push({ name: f.name || 'anh.jpg', type: f.type || 'image/jpeg', data: await f.arrayBuffer() });
  const refFiles = [];
  for (const f of refPhotos) refFiles.push({ name: f.name || 'anh.jpg', type: f.type || 'image/jpeg', data: await f.arrayBuffer() });
  const taskForBrief = { id: row.id, title: row.title, feature: row.feature, payload };
  const sent = await notifyBrief(context.env, taskForBrief, { name: row.user_name, email: row.user_email }, photoFiles, refFiles);
  luna.notified = sent.notified;
  luna.sendError = sent.error || '';
  luna.sentAt = nowIso();
  if (photoFiles.length) {
    luna.photoCount = photoFiles.length;
    luna.photoNames = photoFiles.map((f) => f.name);
    luna.photosSent = sent.photosSent;
    luna.photos = sent.photoFileIds || [];
  }
  if (refFiles.length) {
    luna.refPhotoCount = refFiles.length;
    luna.refPhotoNames = refFiles.map((f) => f.name);
    luna.refPhotos = sent.refPhotoFileIds || [];
  }
  payload.luna = luna;
  await context.env.DB.prepare('UPDATE tasks SET payload = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(payload), nowIso(), context.params.id).run();
  if (!sent.notified) return err('Không gửi được brief sang Telegram: ' + (sent.error || 'lỗi không rõ.'), 502);
  return json({ ok: true, task_id: row.id, notified: true, photosSent: sent.photosSent, message: 'Đã gửi lại brief cho Thư Ký Mỹ Linh.' });
}
