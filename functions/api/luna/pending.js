// GET /api/luna/pending — Hộp thư brief cho Thư Ký Mỹ Linh (Yêu cầu 28 + 30).
// ĐÂY LÀ ĐƯỜNG DỮ LIỆU CHÍNH: Luna poll endpoint này định kỳ (như poll clip
// 15 phút) để lấy việc — KHÔNG phụ thuộc vào tin nhắn Telegram, vì bot không
// nhận được tin nhắn do bot khác gửi (Bots FAQ, core.telegram.org/bots/faq).
// Xác thực: header X-Luna-Secret phải khớp secret LUNA_API_SECRET (Cloudflare secret).
// ?status=luna (mặc định, đang chờ làm) | review (đã trả kết quả, chờ duyệt) | all
// Trả nhiệm vụ của cả 3 tính năng qua cầu nối: designweb, web, page.
import { json, err, lunaSecretOk, parseVersions, parseVersionsFull } from '../../_lib/auth.js';

function pendingItem(t) {
  const payload = t.payload ? JSON.parse(t.payload) : null;
  const w = (payload && payload.web) || {};
  const luna = (payload && payload.luna) || {};
  const versions = parseVersions(t);
  const item = {
    id: t.id,
    title: t.title,
    feature: t.feature,
    status: t.status,
    created_at: t.created_at,
    updated_at: t.updated_at,
    owner: { name: t.user_name, email: t.user_email },
    // Yêu cầu 30: web/page — brief là title + meta + lines (collect() của 2 tính năng này).
    ai: (payload && payload.ai) || '',
    meta: (payload && payload.meta) || '',
    lines: Array.isArray(payload && payload.lines) ? payload.lines : [],
    brief: {
      customer: w.customer || '',
      field: w.field || '',
      color: w.color || '',
      font: w.font || '',
      ref: w.ref || '',
      sections: Array.isArray(w.sections) ? w.sections : [],
      logoPos: w.logoPos || '',
      audience: w.audience || '',
      action: w.action || '',
      materials: Array.isArray(w.materials) ? w.materials : [],
      note: w.note || '',
    },
    photos: {
      client: {
        count: luna.photoCount || 0,
        names: Array.isArray(luna.photoNames) ? luna.photoNames : [],
        // file_id Telegram để Luna tải ảnh qua getFile (token bot mới).
        files: Array.isArray(luna.photos) ? luna.photos : [],
        sent: luna.photosSent || 0,
      },
      ref: {
        count: luna.refPhotoCount || 0,
        names: Array.isArray(luna.refPhotoNames) ? luna.refPhotoNames : [],
        files: Array.isArray(luna.refPhotos) ? luna.refPhotos : [],
      },
      tickedPhotoButEmpty: (Array.isArray(w.materials) && w.materials.includes('Ảnh thật')) && (luna.photoCount || 0) === 0,
    },
    // Ghi chú chỉnh sửa đang chờ (mới nhất lên đầu).
    revisions: Array.isArray(luna.revisions) ? luna.revisions : [],
    versions,
    notified: !!luna.notified,
    sendError: luna.sendError || '',
  };
  // Vòng chỉnh sửa: kèm HTML bản mới nhất để Luna sửa từ đó (không cần vẽ lại từ đầu).
  if (versions.length && t.result_html) item.latest_html = t.result_html;
  // Yêu cầu 30: vòng chỉnh sửa web/page — kèm kết quả text mới nhất để Luna sửa từ đó.
  if (versions.length && t.result_text) {
    const full = parseVersionsFull(t);
    const last = full.length ? full[full.length - 1] : null;
    if (last) {
      item.latest_result = {
        version: last.v || versions[versions.length - 1].v,
        kind: last.kind || 'content',
        text: last.text || t.result_text,
        link: last.link || '',
        note: last.note || '',
      };
    }
  }
  return item;
}

export async function onRequestGet(context) {
  if (!(await lunaSecretOk(context.env, context.request))) {
    return err('Sai secret hoặc chưa cấu hình LUNA_API_SECRET.', 401);
  }
  const url = new URL(context.request.url);
  const status = url.searchParams.get('status') || 'luna';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
  // Yêu cầu 30: cả 3 tính năng qua cầu nối (designweb, web, page).
  let where = "t.feature IN ('designweb', 'web', 'page')";
  const args = [];
  if (status === 'luna') where += " AND t.status = 'luna'";
  else if (status === 'review') where += " AND t.status = 'review'";
  else if (status !== 'all') return err('status phải là luna, review hoặc all.', 400);
  const sql = `SELECT t.*, u.name AS user_name, u.email AS user_email
    FROM tasks t JOIN users u ON u.id = t.user_id
    WHERE ${where} ORDER BY t.created_at ASC LIMIT ?`;
  args.push(limit);
  const { results } = await context.env.DB.prepare(sql).bind(...args).all();
  return json({ ok: true, tasks: (results || []).map(pendingItem) });
}
