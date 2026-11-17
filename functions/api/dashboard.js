// GET /api/dashboard — Số liệu Dashboard: việc hôm nay, đang chạy, hoàn thành,
// lỗi, tiến độ từng tính năng, 5 hoạt động gần nhất. Nhân viên chỉ thấy số
// của chính mình; Admin thấy tất cả (+ số tài khoản đang chờ duyệt).
// Yêu cầu 31: Admin thấy thêm projectStats (thống kê theo dự án, 2 nguồn:
// nhiệm vụ trong app + số liệu Luna đẩy từ Muse). Nhân viên KHÔNG có mục này.
import { json, FEATURE_KEYS, FEATURES, requireAuth } from '../_lib/auth.js';
import { publicProjects, matchProjectSlug, UNASSIGNED, PROJECT_SLUGS, TASK_STATUS_KEYS } from '../_lib/projects.js';

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const db = context.env.DB;
  // Yêu cầu 38 (bổ sung): Chăm sóc page CHỈ Admin — số liệu Dashboard của nhân
  // viên không đếm nhiệm vụ page (kể cả page cũ của chính mình).
  const scope = user.role === 'admin' ? '' : 'AND t.user_id = ? AND t.feature != ?';
  const args = user.role === 'admin' ? [] : [user.id, 'page'];
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
  // ---------- Yêu cầu 32: số liệu theo trạng thái cho Bảng tín hiệu ----------
  // Tính cho MỌI vai trò (đếm có phạm vi: nhân viên chỉ đếm việc của mình).
  // Trước đây byStatus chỉ có trong projectStats của Admin; nhân viên không có
  // nguồn đếm chính xác (đếm từ danh sách /api/tasks bị cắt ở limit) nên bổ
  // sung tại đây. Admin vẫn nhận đúng số cũ (scope rỗng = toàn app).
  const byStatus = {};
  for (const s of TASK_STATUS_KEYS) byStatus[s] = 0;
  const statusQ = await db.prepare(
    `SELECT status, COUNT(*) AS n FROM tasks t WHERE 1 = 1 ${scope} GROUP BY status`,
  ).bind(...args).all();
  for (const r of (statusQ.results || [])) {
    if (byStatus[r.status] !== undefined) byStatus[r.status] = r.n;
  }
  const out = { ok: true, today, total, running, done, errors, byFeature, recent, byStatus };
  if (user.role === 'admin') {
    out.pendingCount = await count(`SELECT COUNT(*) AS n FROM users WHERE status = 'pending'`);
    // ---------- Yêu cầu 31: thống kê theo dự án (CHỈ admin) ----------
    // Nguồn 2 — số liệu Luna đẩy từ Muse (bảng project_stats).
    // Yêu cầu 41: chỉ gửi 8 kỳ gần nhất (giảm tải khi mở Dashboard —
    // trước đây trả toàn bộ rows từ trước tới giờ). Đủ cho Yêu cầu 40
    // (10 bài gần nhất: mỗi dự án đăng 2–5 bài/tuần → 8 tuần có 16–40
    // bài/dự án). Ô chọn tuần chỉ hiện 6 tuần gần nhất nên không thiếu.
    const PROJECT_STATS_PERIODS = 8;
    const rowsQ = await db.prepare(
      'SELECT id, project, kind, period, scheduled, posted, links, details, source, created_at, updated_at FROM project_stats WHERE period IN (SELECT DISTINCT period FROM project_stats ORDER BY period DESC LIMIT ?) ORDER BY period DESC, project ASC',
    ).bind(PROJECT_STATS_PERIODS).all();
    const rows = (rowsQ.results || []).map((r) => {
      let links = [];
      let details = {};
      try { links = JSON.parse(r.links || '[]'); } catch { links = []; }
      try { details = JSON.parse(r.details || '{}'); } catch { details = {}; }
      if (!Array.isArray(links)) links = [];
      if (!details || typeof details !== 'object' || Array.isArray(details)) details = {};
      return {
        id: r.id, project: r.project, kind: r.kind, period: r.period,
        scheduled: r.scheduled, posted: r.posted, links, details,
        source: r.source, updated_at: r.updated_at,
      };
    });
    // Nguồn 1 — nhiệm vụ trong app, gom theo dự án + trạng thái.
    // Dự án đoán từ payload (lines "Website:/Page:", customer Design Web,
    // meta); không đoán được → 'unassigned' ("Chưa gắn dự án"), không bỏ mất.
    const byProject = {};
    for (const s of [...PROJECT_SLUGS, UNASSIGNED]) {
      byProject[s] = { total: 0, done: 0, running: 0, luna: 0, review: 0, error: 0 };
    }
    const byFeatureDetail = {};
    for (const f of FEATURE_KEYS) {
      byFeatureDetail[f] = { total: 0, done: 0, running: 0, luna: 0, review: 0, error: 0 };
    }
    const allQ = await db.prepare('SELECT feature, status, title, payload FROM tasks').all();
    for (const t of (allQ.results || [])) {
      // byStatus đã tính có phạm vi ở trên (Yêu cầu 32) — dùng chung cho admin.
      const fd = byFeatureDetail[t.feature];
      if (fd) {
        fd.total++;
        if (t.status === 'completed') fd.done++;
        if (t.status === 'running') fd.running++;
        if (t.status === 'luna') fd.luna++;
        if (t.status === 'review') fd.review++;
        if (t.status === 'error') fd.error++;
      }
      let text = t.title || '';
      try {
        const p = JSON.parse(t.payload || '{}');
        if (Array.isArray(p.lines)) text += ' ' + p.lines.join(' ');
        if (p.web && p.web.customer) text += ' ' + p.web.customer;
        if (p.meta) text += ' ' + p.meta;
      } catch { /* payload cũ hỏng thì chỉ dùng title */ }
      const slug = matchProjectSlug(text);
      const b = byProject[slug];
      b.total++;
      if (t.status === 'completed') b.done++;
      if (t.status === 'running') b.running++;
      if (t.status === 'luna') b.luna++;
      if (t.status === 'review') b.review++;
      if (t.status === 'error') b.error++;
    }
    out.projectStats = {
      projects: publicProjects(),
      rows,
      appTasks: { byProject, byStatus, byFeature: byFeatureDetail },
    };
  }
  return json(out);
}
