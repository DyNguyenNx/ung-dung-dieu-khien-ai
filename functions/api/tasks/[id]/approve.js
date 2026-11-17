// POST /api/tasks/:id/approve — Admin duyệt kết quả Luna đã trả (Yêu cầu 28 + 30).
// Chỉ Admin. Nhiệm vụ phải ở trạng thái 'review' (đã có kết quả) → 'completed'.
// Design Web: kết quả là file HTML. Chăm sóc web/page: kết quả là text
// (báo cáo đã đăng / nội dung). Nhân viên thấy kết quả chỉ sau khi anh duyệt.
import { json, err, requireAdmin, nowIso } from '../../../_lib/auth.js';

export async function onRequestPost(context) {
  const { response } = await requireAdmin(context.env, context.request);
  if (response) return response;
  const row = await context.env.DB.prepare('SELECT t.* FROM tasks t WHERE t.id = ?')
    .bind(context.params.id).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  if (row.feature !== 'designweb' && row.feature !== 'web' && row.feature !== 'page') {
    // Yêu cầu 43: nhiệm vụ 'anh' do Luna đẩy từ Muse (payload.muse) cũng
    // duyệt được ở đây — UI đã có nút Duyệt cho mọi task review, chỉ server
    // chặn. Nhiệm vụ 'anh' thường (Pollinations) vẫn giữ luật cũ.
    let isMuseAnh = false;
    if (row.feature === 'anh') {
      try {
        const p = row.payload ? JSON.parse(row.payload) : null;
        isMuseAnh = !!(p && p.muse && p.muse.source === 'muse');
      } catch {
        isMuseAnh = false;
      }
    }
    if (!isMuseAnh) return err('Nhiệm vụ này không qua cầu nối Thư Ký Mỹ Linh.', 400);
  }
  if (row.status !== 'review') {
    return err(`Nhiệm vụ đang ở trạng thái “${row.status}” — chỉ duyệt được khi đang chờ anh duyệt.`, 409);
  }
  const hasResult = row.feature === 'designweb' ? !!row.result_html : !!row.result_text;
  if (!hasResult) return err('Nhiệm vụ này chưa có kết quả để duyệt.', 409);
  await context.env.DB.prepare('UPDATE tasks SET status = ?, progress = 100, updated_at = ? WHERE id = ?')
    .bind('completed', nowIso(), context.params.id).run();
  return json({ ok: true, task_id: context.params.id, status: 'completed', message: 'Đã duyệt — nhân viên đã thấy được kết quả.' });
}
