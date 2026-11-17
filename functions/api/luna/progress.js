// POST /api/luna/progress — Thư Ký Mỹ Linh đẩy % tiến độ thật của nhiệm vụ
// đang làm (Yêu cầu 43, bổ sung 19:52 17/11/2026).
// Xác thực: header X-Luna-Secret phải khớp secret LUNA_API_SECRET.
// Body: { task_id, progress, note? }.
// Chỉ nhận khi nhiệm vụ ở trạng thái 'luna' (đang chờ Thư Ký Mỹ Linh làm).
// progress là số nguyên 0–99 — 100% chỉ đặt khi giao kết quả qua
// finish/delivery, không đặt tay qua đây. Chỉ cập nhật progress +
// updated_at, KHÔNG đổi trạng thái. note (tối đa 500 ký tự) lưu vào
// payload.luna.progress = { value, note, at } để màn hình nhiệm vụ hiện kèm.
// Quy tắc % (spec Yêu cầu 43): chỉ đẩy % khi có căn cứ thật từ công việc
// Luna đã làm (0% chưa bắt đầu, 30% dàn ý + tư liệu, 70% nháp xong, 90%
// nội dung xong + soát chuẩn SEO chỉ còn chờ đăng); không suy % từ tiêu đề.
// % chỉ reset về 0 khi anh yêu cầu sửa lại (revision) hoặc Luna tự đặt lại —
// nhịp poll 15 giây của bảng CHỈ ĐỌC, không ghi, nên không reset %.
import { json, err, lunaSecretOk, nowIso } from '../../_lib/auth.js';

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
  const p = body.progress;
  if (!Number.isInteger(p) || p < 0 || p > 99) {
    return err('progress phải là số nguyên 0–99 (100% chỉ đặt khi giao kết quả).', 400);
  }
  const note = String(body.note || '').trim().slice(0, 500);
  const row = await context.env.DB.prepare('SELECT t.* FROM tasks t WHERE t.id = ?').bind(taskId).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  if (row.status !== 'luna') {
    return err(`Nhiệm vụ đang ở trạng thái “${row.status}” — chỉ đẩy tiến độ khi đang chờ Thư Ký Mỹ Linh làm.`, 409);
  }
  let payload = {};
  try {
    payload = row.payload ? JSON.parse(row.payload) : {};
  } catch {
    payload = {};
  }
  if (!payload.luna || typeof payload.luna !== 'object' || Array.isArray(payload.luna)) payload.luna = {};
  payload.luna.progress = { value: p, note, at: nowIso() };
  await context.env.DB.prepare('UPDATE tasks SET progress = ?, payload = ?, updated_at = ? WHERE id = ?')
    .bind(p, JSON.stringify(payload), nowIso(), taskId).run();
  return json({
    ok: true,
    task_id: taskId,
    status: 'luna',
    progress: p,
    message: 'Đã cập nhật tiến độ ' + p + '%.',
  });
}
