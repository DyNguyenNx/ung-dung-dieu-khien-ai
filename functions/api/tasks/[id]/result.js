// GET /api/tasks/:id/result — Lấy file HTML Luna đã trả về (Yêu cầu 28).
// ?version=v1|v2… — mặc định bản mới nhất. Chỉ Admin hoặc chủ nhiệm vụ mới xem được.
import { err, requireAuth, parseVersionsFull } from '../../../_lib/auth.js';

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
  if (row.feature !== 'designweb') return err('Nhiệm vụ này không phải Design Web.', 400);
  const versions = parseVersionsFull(row);
  if (!row.result_html && !versions.length) {
    return err('Nhiệm vụ này chưa có file thiết kế — Thư Ký Mỹ Linh chưa trả file.', 404);
  }
  const url = new URL(context.request.url);
  const want = url.searchParams.get('version');
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
