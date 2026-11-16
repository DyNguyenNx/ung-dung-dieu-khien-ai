// GET /api/tasks/:id/result — Lấy kết quả Luna đã trả về (Yêu cầu 28 + 30).
// Design Web: trả file HTML (text/html). ?version=v1|v2… — mặc định bản mới nhất.
// Chăm sóc web/page: trả JSON {ok, task_id, version, kind, text, link,
//   delivered_at, note} — kind 'posted' (báo cáo đã đăng + link) hoặc
//   'content' (nội dung để nhân viên tự đăng). Chỉ Admin hoặc chủ nhiệm vụ mới xem được.
import { json, err, requireAuth, parseVersionsFull } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await context.env.DB.prepare(
    'SELECT t.* FROM tasks t WHERE t.id = ?',
  ).bind(context.params.id).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  if (user.role !== 'admin' && row.user_id !== user.id) {
    return err('Không có quyền xem nhiệm vụ này.', 403);
  }
  if (row.feature !== 'designweb' && row.feature !== 'web' && row.feature !== 'page') {
    return err('Nhiệm vụ này không qua cầu nối Thư Ký Mỹ Linh.', 400);
  }
  const versions = parseVersionsFull(row);
  const url = new URL(context.request.url);
  const want = url.searchParams.get('version');

  // ---------- Design Web: file HTML (Yêu cầu 28, giữ nguyên) ----------
  if (row.feature === 'designweb') {
    if (!row.result_html && !versions.length) {
      return err('Nhiệm vụ này chưa có file thiết kế — Thư Ký Mỹ Linh chưa trả file.', 404);
    }
    let html = row.result_html;
    let versionId = versions.length ? versions[versions.length - 1].v : 'v1';
    if (want) {
      const found = versions.find((v) => v.v === want);
      if (!found) return err(`Không có bản ${want}.`, 404);
      html = found.html;
      versionId = found.v;
    }
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Task-Id': row.id,
        'X-Version': versionId,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ---------- Chăm sóc web/page: kết quả text JSON (Yêu cầu 30) ----------
  if (!row.result_text && !versions.length) {
    return err('Nhiệm vụ này chưa có kết quả — Thư Ký Mỹ Linh chưa trả kết quả.', 404);
  }
  let entry = versions.length ? versions[versions.length - 1] : null;
  if (want) {
    const found = versions.find((v) => v.v === want);
    if (!found) return err(`Không có bản ${want}.`, 404);
    entry = found;
  }
  return json({
    ok: true,
    task_id: row.id,
    version: (entry && entry.v) || 'v1',
    kind: (entry && entry.kind) || 'content',
    text: (entry && entry.text) || row.result_text || '',
    link: (entry && entry.link) || '',
    delivered_at: (entry && entry.delivered_at) || '',
    note: (entry && entry.note) || '',
  });
}
