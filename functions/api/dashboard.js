// GET /api/dashboard — Số liệu Dashboard: việc hôm nay, đang chạy, hoàn thành,
// lỗi, tiến độ từng tính năng, 5 hoạt động gần nhất. Nhân viên chỉ thấy số
// của chính mình; Admin thấy tất cả (+ số tài khoản đang chờ duyệt).
import { json, FEATURE_KEYS, FEATURES, requireAuth } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const db = context.env.DB;
  const scope = user.role === 'admin' ? '' : 'AND t.user_id = ?';
  const args = user.role === 'admin' ? [] : [user.id];
  const count = async (sql, a = []) => (await db.prepare(sql).bind(...a).first()).n;
  const today = await count(
    `SELECT COUNT(*) AS n FROM tasks t WHERE strftime('%Y-%m-%d', t.created_at, '+7 hours') = strftime('%Y-%m-%d', 'now', '+7 hours') ${scope}`,
    args,
  );
  const total = await count(`SELECT COUNT(*) AS n FROM tasks t WHERE 1 = 1 ${scope}`, args);
  const running = await count(`SELECT COUNT(*) AS n FROM tasks t WHERE t.status = 'running' ${scope}`, args);
  const done = await count(`SELECT COUNT(*) AS n FROM tasks t WHERE t.status = 'completed' ${scope}`, args);
  const errors = await count(`SELECT COUNT(*) AS n FROM tasks t WHERE t.status = 'error' ${scope}`, args);
  const byFeature = {};
  for (const f of FEATURE_KEYS) {
    const ft = await count(`SELECT COUNT(*) AS n FROM tasks t WHERE t.feature = ? ${scope}`, [f, ...args]);
    const fd = await count(`SELECT COUNT(*) AS n FROM tasks t WHERE t.feature = ? AND t.status = 'completed' ${scope}`, [f, ...args]);
    byFeature[f] = { name: FEATURES[f], total: ft, done: fd, pct: ft ? Math.round((fd * 100) / ft) : 0 };
  }
  const recentQ = await db.prepare(
    `SELECT t.*, u.name AS user_name FROM tasks t JOIN users u ON u.id = t.user_id WHERE 1 = 1 ${scope} ORDER BY t.created_at DESC LIMIT 5`,
  ).bind(...args).all();
  const recent = (recentQ.results || []).map((r) => {
    let meta = '';
    if (r.payload) {
      try {
        meta = JSON.parse(r.payload).meta || '';
      } catch { /* payload cũ hỏng thì bỏ qua */ }
    }
    return { id: r.id, feature: r.feature, title: r.title, meta, status: r.status, progress: r.progress, owner: r.user_name, created_at: r.created_at };
  });
  const out = { ok: true, today, total, running, done, errors, byFeature, recent };
  if (user.role === 'admin') {
    out.pendingCount = await count(`SELECT COUNT(*) AS n FROM users WHERE status = 'pending'`);
  }
  return json(out);
}
