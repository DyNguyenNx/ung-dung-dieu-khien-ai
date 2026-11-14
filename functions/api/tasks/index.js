// /api/tasks — Danh sách + tạo nhiệm vụ.
// GET  ?feature=&status=&today=1&limit=  (nhân viên chỉ thấy việc của mình)
// POST {feature, title, payload}         (kiểm tra lượt dùng theo tuần ISO)
import { json, err, FEATURES, FEATURE_KEYS, TASK_STATUSES, requireAuth, getLimit, getUsedThisWeek, nowIso, uuid } from '../../_lib/auth.js';

function taskRow(t) {
  return {
    id: t.id,
    user_id: t.user_id,
    user_name: t.user_name,
    user_email: t.user_email,
    feature: t.feature,
    title: t.title,
    status: t.status,
    progress: t.progress,
    payload: t.payload ? JSON.parse(t.payload) : null,
    result_url: t.result_url,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const url = new URL(context.request.url);
  const feature = url.searchParams.get('feature');
  const status = url.searchParams.get('status');
  const today = url.searchParams.get('today') === '1';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500);
  const where = [];
  const args = [];
  if (user.role !== 'admin') {
    where.push('t.user_id = ?');
    args.push(user.id);
  }
  if (feature) {
    if (!FEATURE_KEYS.includes(feature)) return err('Tính năng không hợp lệ.', 400);
    where.push('t.feature = ?');
    args.push(feature);
  }
  if (status) {
    if (!TASK_STATUSES.includes(status)) return err('Trạng thái không hợp lệ.', 400);
    where.push('t.status = ?');
    args.push(status);
  }
  if (today) where.push(`strftime('%Y-%m-%d', t.created_at, '+7 hours') = strftime('%Y-%m-%d', 'now', '+7 hours')`);
  const sql = `SELECT t.*, u.name AS user_name, u.email AS user_email
    FROM tasks t JOIN users u ON u.id = t.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.created_at DESC LIMIT ?`;
  args.push(limit);
  const { results } = await context.env.DB.prepare(sql).bind(...args).all();
  return json({ ok: true, tasks: (results || []).map(taskRow) });
}

export async function onRequestPost(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  let body;
  try {
    body = await context.request.json();
  } catch {
    return err('Dữ liệu gửi lên không hợp lệ.', 400);
  }
  const feature = String(body.feature || '');
  const title = String(body.title || '').trim();
  if (!FEATURE_KEYS.includes(feature)) return err('Tính năng không hợp lệ.', 400);
  if (!title) return err('Thiếu tiêu đề nhiệm vụ.', 400);
  if (body.payload !== undefined && (typeof body.payload !== 'object' || body.payload === null || Array.isArray(body.payload))) {
    return err('Payload phải là object JSON.', 400);
  }

  // Giới hạn lượt: Admin (anh Dy) không bị giới hạn; nhân viên bị giới hạn
  // theo bảng user_limits, không có dòng override thì mặc định 1 lần/tuần.
  let quota = null;
  if (user.role !== 'admin') {
    const limit = await getLimit(context.env, user.id, feature);
    const used = await getUsedThisWeek(context.env, user.id, feature);
    quota = { used, limit };
    if (used >= limit) {
      return err(
        `Hết lượt ${FEATURES[feature]} tuần này (${used}/${limit}). Muốn dùng thêm, hãy mua thêm lượt hoặc nhờ Admin setup tăng lượt.`,
        429,
        { quota: { used, limit, remaining: 0 } },
      );
    }
  }

  const id = uuid();
  const now = nowIso();
  await context.env.DB.prepare(
    'INSERT INTO tasks (id, user_id, feature, title, status, progress, payload, result_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)',
  ).bind(id, user.id, feature, title, 'running', body.payload ? JSON.stringify(body.payload) : null, now, now).run();
  const row = await context.env.DB.prepare(
    'SELECT t.*, u.name AS user_name, u.email AS user_email FROM tasks t JOIN users u ON u.id = t.user_id WHERE t.id = ?',
  ).bind(id).first();
  const out = taskRow(row);
  if (quota) {
    quota.used += 1;
    quota.remaining = Math.max(0, quota.limit - quota.used);
    out.quota = quota;
  }
  return json({ ok: true, task: out }, 201);
}
