// POST /api/luna/muse-work — Thư Ký Mỹ Linh đẩy việc làm bên Muse vào app (Yêu cầu 43).
// Xác thực: header X-Luna-Secret phải khớp secret LUNA_API_SECRET.
// Hai hành động, khóa chống trùng work_key (vd 'bluemax-2026-11-18-dap-ga-xe-i'):
//   start:  tạo nhiệm vụ thật (status 'luna', chủ = admin đầu tiên) để bảng
//           MCP thấy luồng đang chạy; start lại cùng work_key trả task cũ,
//           KHÔNG tạo thêm nhiệm vụ.
//   finish: nhiệm vụ 'luna'/'review' -> 'review' + kết quả (báo cáo text +
//           link), upsert project_stats tuần ISO hiện tại (chỉ kind
//           article/web; design không vào bảng thống kê bài viết).
// kind: 'article' -> feature 'web' (vào vòng Content của MCP);
//       'design'  -> feature 'anh' (vào vòng Tạo ảnh);
//       'web'     -> feature 'designweb' (vào vòng Tạo ảnh).
// Viết truyện KHÔNG thuộc YC43 (không gắn dự án web nào trong 6 dự án của app).
// Chỉ đẩy kết quả ĐÃ KIỂM CHỨNG link live: kind 'posted' bắt buộc link
// (helper kiểm live trước khi gọi); server chỉ kiểm định dạng URL.
// Sau khi giao: gửi thông báo Telegram cho anh Dy (best-effort).
import { json, err, lunaSecretOk, parseVersionsFull, nowIso, uuid } from '../../_lib/auth.js';
import { isValidProjectSlug, projectBySlug, currentWeekKey } from '../../_lib/projects.js';
import { notifyDelivery, MAX_DELIVERY_BYTES } from '../../_lib/telegram.js';

const WORK_KEY_RE = /^[a-z0-9][a-z0-9-]{2,120}$/;
const MUSE_KINDS = {
  article: { feature: 'web', statKind: 'article', titlePrefix: 'Viết bài SEO ' },
  design: { feature: 'anh', statKind: null, titlePrefix: 'Thiết kế hình ảnh ' },
  web: { feature: 'designweb', statKind: 'web', titlePrefix: 'Design Web ' },
};

function isHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s.trim());
}
// Ngày hiện tại theo giờ Việt Nam (YYYY-MM-DD).
function todayVn() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Dòng payload đúng định dạng MCP đọc (mcpTaskMeta + mcpIsArticle):
// "Website: <Tên> — <domain>", "Chủ đề: …", "Số từ mong muốn: …".
function buildLines(project, kind, title, words, keyword) {
  const p = projectBySlug(project);
  const name = p ? p.name + ' — ' + p.domain : project;
  if (kind === 'article') {
    const lines = ['Website: ' + name, 'Chủ đề: ' + title];
    if (keyword) lines.push('Từ khóa chính: ' + keyword);
    if (words) lines.push('Số từ mong muốn: ' + words);
    return lines;
  }
  if (kind === 'design') return ['Dự án: ' + name, 'Mô tả: ' + title];
  return ['Website: ' + name, 'Dự án: ' + title];
}

async function handleStart(env, body) {
  const project = String(body.project || '').trim();
  const kind = String(body.kind || '').trim();
  const workKey = String(body.work_key || '').trim();
  const title = String(body.title || '').trim();
  const words = body.words === undefined || body.words === null ? null : body.words;
  const keyword = String(body.keyword || '').trim().slice(0, 200);
  const note = String(body.note || '').trim().slice(0, 500);
  if (!isValidProjectSlug(project)) {
    return err('project phải là 1 trong: bluemax, binhminh, khanhnghi, inox, tranvu, nhatlinh.', 400);
  }
  if (!MUSE_KINDS[kind]) return err("kind phải là 'article', 'design' hoặc 'web'.", 400);
  if (!WORK_KEY_RE.test(workKey)) {
    return err('work_key chỉ gồm chữ thường, số và dấu gạch ngang (3–121 ký tự, bắt đầu bằng chữ/số).', 400);
  }
  if (!title || title.length > 300) return err('title bắt buộc, tối đa 300 ký tự.', 400);
  if (words !== null && (!Number.isInteger(words) || words <= 0 || words > 100000)) {
    return err('words phải là số nguyên dương.', 400);
  }
  // Chống đẩy trùng: work_key đã có → trả task cũ, không tạo thêm.
  const existing = await env.DB.prepare('SELECT * FROM muse_work WHERE work_key = ?').bind(workKey).first();
  if (existing) {
    const t = await env.DB.prepare('SELECT status FROM tasks WHERE id = ?').bind(existing.task_id).first();
    return json({
      ok: true, created: false, task_id: existing.task_id,
      status: t ? t.status : 'unknown', work_key: workKey,
      message: 'Việc này đã đẩy vào app rồi — không tạo thêm.',
    });
  }
  // Chủ sở hữu: admin active tạo sớm nhất (anh Dy).
  const admin = await env.DB.prepare(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at ASC LIMIT 1",
  ).first();
  if (!admin) return err('App chưa có tài khoản Admin active — không tạo được nhiệm vụ.', 503);
  const map = MUSE_KINDS[kind];
  const now = nowIso();
  const payload = {
    lines: buildLines(project, kind, title, words, keyword),
    ai: 'Thư Ký Mỹ Linh',
    meta: note,
    muse: { work_key: workKey, project, kind, source: 'muse', started_at: now },
  };
  const id = uuid();
  // Batch để task + muse_work đi cùng nhau (lỗi giữa chừng thì không để
  // lại task mồ côi mà start lại sẽ tạo trùng).
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO tasks (id, user_id, feature, title, status, progress, payload, result_url, result_html, result_text, result_image, result_versions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)',
    ).bind(id, admin.id, map.feature, map.titlePrefix + '"' + title + '"', 'luna', JSON.stringify(payload), now, now),
    env.DB.prepare(
      'INSERT INTO muse_work (work_key, task_id, project, kind, title, link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
    ).bind(workKey, id, project, kind, title, now, now),
  ]);
  return json({
    ok: true, created: true, task_id: id, status: 'luna', work_key: workKey,
    message: 'Đã đẩy việc vào app — bảng MCP đang thấy luồng.',
  }, 201);
}

async function handleFinish(env, body) {
  const workKey = String(body.work_key || '').trim();
  const resultKind = String(body.result_kind || '').trim();
  const text = typeof body.text === 'string' ? body.text : '';
  const link = String(body.link || '').trim();
  const note = String(body.note || '').trim().slice(0, 500);
  const seo = body.seo === undefined || body.seo === null ? null : body.seo;
  const wordsDone = body.words_done === undefined || body.words_done === null ? null : body.words_done;
  if (!WORK_KEY_RE.test(workKey)) return err('work_key không hợp lệ.', 400);
  if (resultKind !== 'posted' && resultKind !== 'content') {
    return err("result_kind phải là 'posted' (đã đăng live) hoặc 'content' (trả nội dung/thiết kế).", 400);
  }
  if (!text.trim()) return err('Thiếu nội dung kết quả (text).', 400);
  const size = new TextEncoder().encode(text).length;
  if (size > MAX_DELIVERY_BYTES) return err('Nội dung kết quả nặng hơn 1MB — hãy gửi nội dung gọn hơn.', 413);
  if (resultKind === 'posted' && !isHttpUrl(link)) {
    return err("kind 'posted' bắt buộc có link bài đã đăng (URL http(s)).", 400);
  }
  if (link && !isHttpUrl(link)) return err('link phải là URL bắt đầu bằng http:// hoặc https://.', 400);
  if (seo !== null && (typeof seo !== 'number' || seo < 0 || seo > 100)) {
    return err('seo phải là số 0–100.', 400);
  }
  if (wordsDone !== null && (!Number.isInteger(wordsDone) || wordsDone <= 0)) {
    return err('words_done phải là số nguyên dương.', 400);
  }
  const mw = await env.DB.prepare('SELECT * FROM muse_work WHERE work_key = ?').bind(workKey).first();
  if (!mw) return err('Chưa có việc này trong app (chưa start) — hãy start trước rồi mới finish.', 404);
  const row = await env.DB.prepare('SELECT t.* FROM tasks t WHERE t.id = ?').bind(mw.task_id).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  if (row.status !== 'luna' && row.status !== 'review') {
    return err(`Nhiệm vụ đang ở trạng thái “${row.status}” — chỉ nhận kết quả khi đang chờ Thư Ký Mỹ Linh hoặc chờ duyệt.`, 409);
  }
  const now = nowIso();
  const versions = parseVersionsFull(row);
  const versionId = 'v' + (versions.length + 1);
  const cleanLink = link || '';
  versions.push({ v: versionId, delivered_at: now, size, note, kind: resultKind, text, link: cleanLink });
  const oldLink = mw.link || '';
  const statKind = MUSE_KINDS[mw.kind] ? MUSE_KINDS[mw.kind].statKind : null;
  const stmts = [
    env.DB.prepare(
      'UPDATE tasks SET status = ?, progress = 100, result_text = ?, result_versions = ?, result_url = ?, updated_at = ? WHERE id = ?',
    ).bind('review', text, JSON.stringify(versions), cleanLink || row.result_url || null, now, mw.task_id),
    env.DB.prepare(
      'UPDATE muse_work SET link = ?, updated_at = ? WHERE work_key = ?',
    ).bind(cleanLink || null, now, workKey),
  ];
  let statsMsg = '';
  if (statKind && resultKind === 'posted' && cleanLink) {
    // Upsert project_stats tuần ISO hiện tại: posted đếm theo link phân biệt.
    const period = currentWeekKey();
    const existing = await env.DB.prepare(
      'SELECT * FROM project_stats WHERE project = ? AND kind = ? AND period = ?',
    ).bind(mw.project, statKind, period).first();
    let links = [];
    let details = {};
    let scheduled = 0;
    let posted = 0;
    if (existing) {
      try { links = JSON.parse(existing.links || '[]'); } catch { links = []; }
      try { details = JSON.parse(existing.details || '{}'); } catch { details = {}; }
      if (!Array.isArray(links)) links = [];
      if (!details || typeof details !== 'object' || Array.isArray(details)) details = {};
      scheduled = existing.scheduled || 0;
      posted = existing.posted || 0;
    }
    const articles = Array.isArray(details.articles) ? details.articles.slice() : [];
    // Đếm posted theo link phân biệt TRONG TUẦN NÀY:
    // - Lần đầu có link (chưa từng đếm trong tuần) → posted + 1.
    // - Giao lại cùng link, hoặc đổi link trong cùng tuần (link cũ đã nằm
    //   trong links tuần này) → thay link, posted KHÔNG đổi.
    const hadOldInWeek = !!oldLink && links.indexOf(oldLink) !== -1;
    if (hadOldInWeek) {
      links = links.filter((l) => l !== oldLink);
      const ai = articles.findIndex((a) => a.link === oldLink);
      if (ai !== -1) articles.splice(ai, 1);
    }
    if (links.indexOf(cleanLink) === -1) {
      links.push(cleanLink);
      articles.push({ date: todayVn(), title: mw.title, link: cleanLink, seo, indexed: false });
      if (!hadOldInWeek) posted += 1;
      if (links.length > 200) links = links.slice(-200);
      if (articles.length > 200) articles.splice(0, articles.length - 200);
    } else {
      // Giao lại cùng link: cập nhật seo mới nhất, không nhân đôi posted.
      const ai = articles.findIndex((a) => a.link === cleanLink);
      if (ai !== -1 && seo !== null) articles[ai].seo = seo;
    }
    details.articles = articles;
    stmts.push(env.DB.prepare(
      `INSERT INTO project_stats (id, project, kind, period, scheduled, posted, links, details, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'luna', ?, ?)
       ON CONFLICT(project, kind, period) DO UPDATE SET
         scheduled = excluded.scheduled, posted = excluded.posted,
         links = excluded.links, details = excluded.details, updated_at = excluded.updated_at`,
    ).bind(existing ? existing.id : uuid(), mw.project, statKind, period, scheduled, posted,
      JSON.stringify(links), JSON.stringify(details), now, now));
    statsMsg = ' Thống kê ' + mw.project + '/' + statKind + '/' + period + ': đã đăng ' + posted + '.';
  }
  await env.DB.batch(stmts);
  // Thông báo cho anh Dy (best-effort — lỗi Telegram không làm hỏng việc giao kết quả).
  await notifyDelivery(env, { id: mw.task_id, title: row.title, feature: row.feature }, versionId, resultKind).catch(() => {});
  return json({
    ok: true,
    task_id: mw.task_id,
    version: versionId,
    kind: resultKind,
    status: 'review',
    link: cleanLink,
    message: 'Đã nhận kết quả ' + versionId + ' — nhiệm vụ đang chờ anh duyệt.' + statsMsg,
  });
}

export async function onRequestPost(context) {
  if (!(await lunaSecretOk(context.env, context.request))) {
    return err('Sai secret hoặc chưa cấu hình LUNA_API_SECRET.', 401);
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return err('Dữ liệu gửi lên không hợp lệ.', 400);
  }
  const action = String(body.action || '').trim();
  if (action === 'start') return handleStart(context.env, body);
  if (action === 'finish') return handleFinish(context.env, body);
  return err("action phải là 'start' hoặc 'finish'.", 400);
}
