// /api/gsc/properties — Map dự án ↔ GSC property (Yêu cầu 39).
// CHỈ Admin. GET: danh sách mapping đã lưu + danh sách property service
// account thấy được trên Google (sites.list, best-effort — chưa cấu hình
// thì trả mảng rỗng + ghi chú). POST {project, site_url}: lưu/cập nhật
// mapping; site_url phải đúng identifier GSC: URL-prefix (https://...)
// hoặc Domain (sc-domain:...). KHÔNG BAO GIỜ trả secret.
import { json, err, requireAdmin, nowIso, uuid } from '../../_lib/auth.js';
import { isValidProjectSlug, PROJECT_SLUGS } from '../../_lib/projects.js';
import { listSites, GscError } from '../../_lib/gsc.js';

function isValidSiteUrl(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (/^sc-domain:[a-z0-9.-]+$/i.test(t)) return true;
  if (/^https?:\/\/[a-z0-9.-]+(\/.*)?$/i.test(t)) return true;
  return false;
}

export async function onRequestGet(context) {
  const { user, response } = await requireAdmin(context.env, context.request);
  if (response) return response;
  const { results } = await context.env.DB.prepare(
    'SELECT project, site_url, status, last_sync_at, last_error, updated_at FROM gsc_properties ORDER BY project ASC',
  ).all();
  let googleSites = [];
  let googleError = '';
  try {
    googleSites = await listSites(context.env);
  } catch (e) {
    googleError = e instanceof GscError ? e.message : 'Không lấy được danh sách property từ Google.';
  }
  return json({
    ok: true,
    properties: results || [],
    googleSites,
    googleError,
    validProjects: PROJECT_SLUGS,
  });
}

export async function onRequestPost(context) {
  const { user, response } = await requireAdmin(context.env, context.request);
  if (response) return response;
  let body;
  try {
    body = await context.request.json();
  } catch {
    return err('Dữ liệu gửi lên không hợp lệ.', 400);
  }
  const project = String(body.project || '').trim();
  const siteUrl = String(body.site_url || '').trim();
  if (!isValidProjectSlug(project)) {
    return err('project phải là 1 trong: ' + PROJECT_SLUGS.join(', ') + '.', 400);
  }
  if (!isValidSiteUrl(siteUrl)) {
    return err('site_url phải đúng identifier GSC: URL-prefix (https://ten-mien/) hoặc Domain (sc-domain:ten-mien).', 400);
  }
  const now = nowIso();
  const existing = await context.env.DB.prepare(
    'SELECT id FROM gsc_properties WHERE project = ?',
  ).bind(project).first();
  await context.env.DB.prepare(
    `INSERT INTO gsc_properties (id, project, site_url, connection_id, status, last_sync_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, 'service_account', 'ok', NULL, NULL, ?, ?)
     ON CONFLICT(project) DO UPDATE SET site_url = excluded.site_url, status = 'ok', last_error = NULL, updated_at = excluded.updated_at`,
  ).bind(existing ? existing.id : uuid(), project, siteUrl, now, now).run();
  const row = await context.env.DB.prepare(
    'SELECT project, site_url, status, last_sync_at, last_error, updated_at FROM gsc_properties WHERE project = ?',
  ).bind(project).first();
  return json({ ok: true, property: row }, existing ? 200 : 201);
}
