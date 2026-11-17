// POST /api/tasks/:id/canva — Mở ảnh của nhiệm vụ Thiết kế hình ảnh trên
// Canva để chỉnh tiếp (Yêu cầu 36).
// Chỉ nhiệm vụ 'anh' đã Hoàn thành và có ảnh (result_image). Chủ nhiệm vụ
// hoặc Admin mới dùng được (cùng luật với GET /api/tasks/:id/result).
// Upload ảnh lên Canva làm asset rồi tạo design từ ảnh đó, trả
// {ok, edit_url, view_url, design_id, reused} — frontend mở edit_url trong
// tab mới. Bấm lại cùng nhiệm vụ thì dùng lại design đã tạo (lấy link mới
// qua GET /designs/:id, vì link cũ hết hạn sau 30 ngày) thay vì tải trùng
// asset; design cũ đã mất (tự xoá sau 7 ngày không sửa) thì tạo mới.
import { json, err, requireAuth, nowIso } from '../../../_lib/auth.js';
import { openTaskInCanva, CanvaError, isMissingScopesMessage } from '../../../_lib/canva.js';

const CANVA_HTTP_STATUS = {
  NOT_CONFIGURED: 500,
  NOT_CONNECTED: 409,
  NEED_RECONNECT: 409,
  UPLOAD_FAILED: 502,
  DESIGN_FAILED: 502,
  TIMEOUT: 504,
  API_ERROR: 502,
};

export async function onRequestPost(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await context.env.DB.prepare('SELECT * FROM tasks WHERE id = ?')
    .bind(context.params.id).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  if (user.role !== 'admin' && row.user_id !== user.id) {
    return err('Không có quyền xem nhiệm vụ này.', 403);
  }
  if (row.feature !== 'anh') {
    return err('Chỉ nhiệm vụ Thiết kế hình ảnh mới mở được trên Canva.', 400);
  }
  if (row.status !== 'completed' || !row.result_image) {
    return err('Nhiệm vụ này chưa có ảnh hoàn thành để mở trên Canva.', 409);
  }
  let stored = null;
  try {
    stored = JSON.parse(row.result_image);
  } catch {
    stored = null;
  }
  if (!stored || !stored.data) return err('Ảnh đã lưu bị lỗi định dạng.', 500);
  let payload = {};
  try {
    payload = JSON.parse(row.payload || '{}');
  } catch {
    payload = {};
  }
  try {
    const out = await openTaskInCanva(context.env, { task: row, stored, payload });
    if (out.created) {
      // Mới tạo — lưu lại design để bấm lại dùng lại link, khỏi tải trùng.
      payload.canva = {
        design_id: out.design_id,
        asset_id: out.asset_id,
        edit_url: out.edit_url,
        view_url: out.view_url,
        created_at: nowIso(),
      };
      await context.env.DB.prepare('UPDATE tasks SET payload = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(payload), nowIso(), row.id).run();
    }
    return json({
      ok: true,
      edit_url: out.edit_url,
      view_url: out.view_url,
      design_id: out.design_id,
      reused: !!out.reused,
    });
  } catch (e) {
    if (e instanceof CanvaError) {
      // Canva báo thiếu scope giữa luồng (vd Canva đổi yêu cầu scope) —
      // bắt admin kết nối lại thay vì báo lỗi API chung chung.
      if (isMissingScopesMessage(e.message)) {
        return err('Token Canva thiếu quyền cho tính năng này — admin bấm “Kết nối Canva” để cấp lại quyền.', 409, { code: 'NEED_RECONNECT' });
      }
      return err(e.message, CANVA_HTTP_STATUS[e.code] || 502, { code: e.code });
    }
    if (isMissingScopesMessage(e && e.message)) {
      return err('Token Canva thiếu quyền cho tính năng này — admin bấm “Kết nối Canva” để cấp lại quyền.', 409, { code: 'NEED_RECONNECT' });
    }
    return err('Không mở được Canva: ' + (e && e.message ? String(e.message).slice(0, 200) : 'lỗi không rõ.'), 502);
  }
}
