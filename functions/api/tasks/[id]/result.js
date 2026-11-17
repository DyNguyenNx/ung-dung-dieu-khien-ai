// GET /api/tasks/:id/result — Lấy kết quả Luna đã trả về (Yêu cầu 28 + 30).
// Design Web: trả file HTML (text/html). ?version=v1|v2… — mặc định bản mới nhất.
// Chăm sóc web/page: trả JSON {ok, task_id, version, kind, text, link,
//   delivered_at, note} — kind 'posted' (báo cáo đã đăng + link) hoặc
//   'content' (nội dung để nhân viên tự đăng). Chỉ Admin hoặc chủ nhiệm vụ mới xem được.
// Thiết kế hình ảnh (Yêu cầu 35, đổi provider Gemini -> Pollinations): trả đúng bytes ảnh Pollinations đã tạo
// (Content-Type theo mime đã lưu trong cột result_image), 404 khi chưa có ảnh.
import { json, err, requireAuth, parseVersionsFull, forbidStaffPage } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const row = await context.env.DB.prepare(
    'SELECT t.* FROM tasks t WHERE t.id = ?',
  ).bind(context.params.id).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  // Yêu cầu 38 (bổ sung): Chăm sóc page CHỈ Admin — chặn cả chủ nhiệm vụ là nhân viên.
  const pg = forbidStaffPage(user, row.feature);
  if (pg) return pg;
  if (user.role !== 'admin' && row.user_id !== user.id) {
    return err('Không có quyền xem nhiệm vụ này.', 403);
  }
  if (row.feature !== 'designweb' && row.feature !== 'web' && row.feature !== 'page' && row.feature !== 'anh') {
    return err('Nhiệm vụ này không qua cầu nối Thư Ký Mỹ Linh.', 400);
  }
  const versions = parseVersionsFull(row);
  const url = new URL(context.request.url);
  const want = url.searchParams.get('version');

  // ---------- Thiết kế hình ảnh: ảnh thật Pollinations đã tạo (Yêu cầu 35) ----------
  // result_image = JSON {mime, data (base64), bytes, w, h, aspect, generated_at}.
  // Chỉ lưu 1 ảnh / nhiệm vụ (bản mới nhất) nên không có ?version.
  // Yêu cầu 43: nhiệm vụ 'anh' nguồn Muse có kết quả TEXT mà KHÔNG có ảnh
  // thì bỏ qua nhánh ảnh, đi tiếp xuống nhánh JSON bên dưới (như web/page).
  // Nhiệm vụ 'anh' thường (Pollinations) vẫn đi nhánh ảnh như cũ.
  let museAnhText = false;
  try {
    const p0 = row.payload ? JSON.parse(row.payload) : null;
    museAnhText = !!(p0 && p0.muse && p0.muse.source === 'muse') && !!row.result_text && !row.result_image;
  } catch {
    museAnhText = false;
  }
  if (row.feature === 'anh' && !museAnhText) {
    if (!row.result_image) {
      return err('Nhiệm vụ này chưa có ảnh — Pollinations chưa trả ảnh.', 404);
    }
    let stored = null;
    try {
      stored = JSON.parse(row.result_image);
    } catch {
      stored = null;
    }
    if (!stored || !stored.data) {
      return err('Ảnh đã lưu bị lỗi định dạng.', 500);
    }
    const mime = stored.mime || 'image/png';
    const ext = mime === 'image/jpeg' ? '.jpg' : (mime === 'image/webp' ? '.webp' : '.png');
    const fileSlug = String(row.title || 'hinh-anh').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'hinh-anh';
    const bytes = Uint8Array.from(atob(stored.data), (c) => c.charCodeAt(0));
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${fileSlug}${ext}"`,
        'X-Task-Id': row.id,
        'Cache-Control': 'no-store',
      },
    });
  }

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
