// GET /api/gsc/status — Trạng thái nối Google Search Console (Yêu cầu 39).
// CHỈ Admin. Trả: đã cấu hình service account chưa (GSC_SA_EMAIL +
// GSC_SA_PRIVATE_KEY trên Cloudflare), mapping property từng dự án,
// lần đồng bộ cuối + lỗi cuối. KHÔNG BAO GIỜ trả secret/private key.
import { json, requireAdmin } from '../../_lib/auth.js';
import { publicProjects } from '../../_lib/projects.js';

export async function onRequestGet(context) {
  const { user, response } = await requireAdmin(context.env, context.request);
  if (response) return response;
  const db = context.env.DB;
  const configured = !!(context.env.GSC_SA_EMAIL && context.env.GSC_SA_PRIVATE_KEY);
  const propsQ = await db.prepare(
    'SELECT project, site_url, status, last_sync_at, last_error FROM gsc_properties',
  ).all();
  const props = {};
  for (const r of (propsQ.results || [])) props[r.project] = r;
  const logsQ = await db.prepare(
    'SELECT project, started_at, finished_at, status, error, rows_synced FROM gsc_sync_log ORDER BY started_at DESC',
  ).all();
  const lastLog = {};
  for (const r of (logsQ.results || [])) {
    if (!lastLog[r.project]) lastLog[r.project] = r;
  }
  const projects = publicProjects().map((p) => {
    const prop = props[p.slug] || null;
    const log = lastLog[p.slug] || null;
    return {
      slug: p.slug,
      name: p.name,
      domain: p.domain,
      site_url: prop ? prop.site_url : '',
      status: prop ? prop.status : 'not_mapped',
      last_sync_at: prop ? (prop.last_sync_at || '') : '',
      last_error: prop ? (prop.last_error || '') : '',
      last_sync: log ? {
        started_at: log.started_at, finished_at: log.finished_at || '',
        status: log.status, error: log.error || '', rows_synced: log.rows_synced || 0,
      } : null,
    };
  });
  return json({
    ok: true,
    configured,
    method: 'service_account',
    note: configured
      ? 'Service account đã cấu hình. Thêm email service account vào từng property trong Search Console rồi bấm Đồng bộ.'
      : 'Chưa cấu hình GSC_SA_EMAIL / GSC_SA_PRIVATE_KEY trên Cloudflare.',
    projects,
  });
}
