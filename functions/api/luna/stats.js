// POST /api/luna/stats — Thư Ký Mỹ Linh đẩy số liệu thống kê theo dự án
// từ Muse về app (Yêu cầu 31, nguồn 2 của dashboard thống kê theo dự án).
// Xác thực: header X-Luna-Secret phải khớp secret LUNA_API_SECRET
// (cùng secret cầu nối YC28/YC30, KHÔNG cơ chế xác thực mới).
// Body: { project, kind, period, scheduled, posted, links?, details? }
//   project: 1 trong 4 slug seed (bluemax, binhminh, khanhnghi, inox).
//   kind: 'article' | 'page' | 'web'.
//   period: tuần ISO 'YYYY-Www' (vd '2026-W47').
//   scheduled/posted: số nguyên >= 0 (bài theo lịch / bài đã đăng).
//   links: mảng URL http(s) bài đã đăng.
//   details: { seo?: {avg, min}, index?: {requested, indexed},
//              late?: [{title, due}], missing?: [{title, due}],
//              articles?: [{date, title, link, seo, indexed}] }.
// Đẩy lại cùng (project, kind, period) thì cập nhật đè (upsert).
// Sai bất kỳ trường nào → 400. Không secret → 401.
import { json, err, lunaSecretOk, nowIso, uuid } from '../../_lib/auth.js';
import { isValidProjectSlug, isValidKind, isValidPeriod } from '../../_lib/projects.js';

function isHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s.trim());
}
function isInt(n) {
  return Number.isInteger(n) && n >= 0;
}
function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function validateDetails(d) {
  if (d === undefined || d === null) return null;
  if (typeof d !== 'object' || Array.isArray(d)) return 'details phải là object.';
  if (d.seo !== undefined) {
    if (typeof d.seo !== 'object' || Array.isArray(d.seo)) return 'details.seo phải là object.';
    for (const k of ['avg', 'min']) {
      if (d.seo[k] !== undefined && (typeof d.seo[k] !== 'number' || d.seo[k] < 0 || d.seo[k] > 100)) {
        return `details.seo.${k} phải là số 0–100.`;
      }
    }
  }
  if (d.index !== undefined) {
    if (typeof d.index !== 'object' || Array.isArray(d.index)) return 'details.index phải là object.';
    for (const k of ['requested', 'indexed']) {
      if (d.index[k] !== undefined && !isInt(d.index[k])) return `details.index.${k} phải là số nguyên >= 0.`;
    }
  }
  for (const k of ['late', 'missing']) {
    if (d[k] !== undefined) {
      if (!Array.isArray(d[k])) return `details.${k} phải là mảng.`;
      for (const it of d[k]) {
        if (!it || typeof it.title !== 'string' || !it.title.trim() || it.title.length > 300) {
          return `details.${k}: mỗi mục phải có title (chuỗi, tối đa 300 ký tự).`;
        }
        if (it.due !== undefined && !isDateStr(it.due)) return `details.${k}: due phải dạng YYYY-MM-DD.`;
      }
    }
  }
  if (d.articles !== undefined) {
    if (!Array.isArray(d.articles)) return 'details.articles phải là mảng.';
    if (d.articles.length > 200) return 'details.articles tối đa 200 bài.';
    for (const a of d.articles) {
      if (!a || typeof a.title !== 'string' || !a.title.trim() || a.title.length > 300) {
        return 'details.articles: mỗi bài phải có title (chuỗi, tối đa 300 ký tự).';
      }
      if (a.link !== undefined && a.link !== '' && !isHttpUrl(a.link)) return 'details.articles: link phải là URL http(s).';
      if (a.date !== undefined && a.date !== '' && !isDateStr(a.date)) return 'details.articles: date phải dạng YYYY-MM-DD.';
      if (a.seo !== undefined && a.seo !== null && (typeof a.seo !== 'number' || a.seo < 0 || a.seo > 100)) {
        return 'details.articles: seo phải là số 0–100.';
      }
      if (a.indexed !== undefined && typeof a.indexed !== 'boolean') return 'details.articles: indexed phải là true/false.';
    }
  }
  return null;
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
  const project = String(body.project || '').trim();
  const kind = String(body.kind || '').trim();
  const period = String(body.period || '').trim();
  if (!isValidProjectSlug(project)) {
    return err('project phải là 1 trong: bluemax, binhminh, khanhnghi, inox, tranvu, nhatlinh.', 400);
  }
  if (!isValidKind(kind)) {
    return err("kind phải là 'article', 'page' hoặc 'web'.", 400);
  }
  if (!isValidPeriod(period)) {
    return err("period phải đúng dạng tuần ISO 'YYYY-Www' (vd '2026-W47').", 400);
  }
  if (!isInt(body.scheduled)) return err('scheduled phải là số nguyên >= 0.', 400);
  if (!isInt(body.posted)) return err('posted phải là số nguyên >= 0.', 400);
  const links = body.links === undefined ? [] : body.links;
  if (!Array.isArray(links)) return err('links phải là mảng URL.', 400);
  if (links.length > 200) return err('links tối đa 200 URL.', 400);
  for (const l of links) {
    if (!isHttpUrl(l)) return err('links: mỗi phần tử phải là URL http(s).', 400);
  }
  const detailsErr = validateDetails(body.details);
  if (detailsErr) return err(detailsErr, 400);
  const details = body.details === undefined ? {} : body.details;

  const now = nowIso();
  const existing = await context.env.DB.prepare(
    'SELECT id FROM project_stats WHERE project = ? AND kind = ? AND period = ?',
  ).bind(project, kind, period).first();
  await context.env.DB.prepare(
    `INSERT INTO project_stats (id, project, kind, period, scheduled, posted, links, details, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'luna', ?, ?)
     ON CONFLICT(project, kind, period) DO UPDATE SET
       scheduled = excluded.scheduled, posted = excluded.posted,
       links = excluded.links, details = excluded.details, updated_at = excluded.updated_at`,
  ).bind(existing ? existing.id : uuid(), project, kind, period, body.scheduled, body.posted,
    JSON.stringify(links), JSON.stringify(details), now, now).run();
  return json({
    ok: true,
    project, kind, period,
    scheduled: body.scheduled, posted: body.posted,
    created: !existing,
    message: existing
      ? `Đã cập nhật số liệu ${project} / ${kind} / ${period}.`
      : `Đã lưu số liệu ${project} / ${kind} / ${period}.`,
  });
}
