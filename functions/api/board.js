// GET /api/board — Dữ liệu Bảng tín hiệu MCP chung cho cả đội (Yêu cầu 45, 17/11/2026).
// Mọi tài khoản đăng nhập (admin + nhân viên) đều thấy CÙNG một bảng: số liệu
// toàn app, KHÔNG lọc theo người xem (ngoại lệ do anh chốt 19:53).
// Chỉ trả trường bảng cần (tiêu đề/số lượng/trạng thái) — KHÔNG trả payload
// đầy đủ, result_text/html/image, result_url, result_versions.
// Ngoại lệ YC38 được giữ: nhân viên KHÔNG thấy dữ liệu Chăm sóc page.
import { json, FEATURE_KEYS, TASK_STATUSES, requireAuth } from '../_lib/auth.js';

function boardTaskRow(t) {
  let lines = [];
  let ai = '';
  try {
    const p = t.payload ? JSON.parse(t.payload) : null;
    if (p) {
      if (Array.isArray(p.lines)) lines = p.lines.filter((x) => typeof x === 'string').slice(0, 20);
      if (typeof p.ai === 'string') ai = p.ai;
    }
  } catch {
    // payload cũ hỏng thì bỏ qua
  }
  return {
    id: t.id,
    title: t.title,
    feature: t.feature,
    status: t.status,
    progress: t.progress,
    user_name: t.user_name,
    created_at: t.created_at,
    lines,
    ai,
  };
}

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const db = context.env.DB;
  const staff = user.role !== 'admin';
  // Nhân viên: loại Chăm sóc page khỏi bảng (YC38).
  const scope = staff ? "AND t.feature != 'page'" : '';

  const byStatus = {};
  for (const s of TASK_STATUSES) byStatus[s] = 0;
  const statusQ = await db.prepare(
    `SELECT t.status, COUNT(*) AS n FROM tasks t WHERE 1 = 1 ${scope} GROUP BY t.status`,
  ).all();
  for (const r of (statusQ.results || [])) {
    if (byStatus[r.status] !== undefined) byStatus[r.status] = r.n;
  }

  const featCounts = {};
  for (const f of FEATURE_KEYS) featCounts[f] = 0;
  const featQ = await db.prepare(
    `SELECT t.feature, COUNT(*) AS n FROM tasks t WHERE t.status IN ('running', 'luna') ${scope} GROUP BY t.feature`,
  ).all();
  for (const r of (featQ.results || [])) {
    if (featCounts[r.feature] !== undefined) featCounts[r.feature] = r.n;
  }

  // Vòng con Content/Tạo ảnh — cùng luật mcpIsArticle của frontend.
  const contentQ = await db.prepare(
    `SELECT COUNT(*) AS n FROM tasks t WHERE t.status IN ('running', 'luna') ${scope}
     AND (t.feature = 'truyen' OR t.title LIKE 'Viết bài SEO%' OR t.payload LIKE '%Chủ đề:%')`,
  ).first();
  const active = (byStatus.running || 0) + (byStatus.luna || 0);
  const content = (contentQ && contentQ.n) || 0;

  const tasksQ = await db.prepare(
    `SELECT t.id, t.title, t.feature, t.status, t.progress, t.payload, t.created_at, u.name AS user_name
     FROM tasks t JOIN users u ON u.id = t.user_id WHERE 1 = 1 ${scope}
     ORDER BY t.created_at DESC LIMIT 500`,
  ).all();

  return json({
    ok: true,
    byStatus,
    featCounts,
    subCounts: { content, image: Math.max(0, active - content) },
    tasks: (tasksQ.results || []).map(boardTaskRow),
  });
}
