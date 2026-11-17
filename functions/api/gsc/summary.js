// GET /api/gsc/summary — Số liệu GSC đã cache trong D1 cho Dashboard
// (Yêu cầu 39). CHỈ Admin. KHÔNG gọi Google trực tiếp khi mở trang — đọc
// từ gsc_daily / gsc_top_queries / gsc_url_status đã đồng bộ trước đó.
// ?project=slug | all (mặc định all) — tổng 28 ngày gần nhất (dữ liệu GSC
// trễ 2–3 ngày nên khoảng lấy tới hôm kia). Trả thêm ghi chú giới hạn:
// API GSC chỉ đọc trạng thái index, không có nút xin index.
import { json, err, requireAdmin } from '../../_lib/auth.js';
import { isValidProjectSlug, PROJECT_SLUGS, publicProjects } from '../../_lib/projects.js';
import { vnTodayIso, addDaysIso } from '../../_lib/gsc.js';

// Gio VN (UTC+7) dang HH:MM dd/MM/yyyy — hien moc dong bo cho de doc thay
// vi ISO tho (fix loi 1: dong trang thai kho doc, de nham la "chua dong bo").
function fmtVnTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const v = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return p(v.getUTCHours()) + ':' + p(v.getUTCMinutes()) + ' ' + p(v.getUTCDate()) + '/' + p(v.getUTCMonth() + 1) + '/' + v.getUTCFullYear();
}

export async function onRequestGet(context) {
  const { user, response } = await requireAdmin(context.env, context.request);
  if (response) return response;
  const url = new URL(context.request.url);
  const project = String(url.searchParams.get('project') || 'all').trim();
  const slugs = project === 'all' ? PROJECT_SLUGS : [project];
  if (project !== 'all' && !isValidProjectSlug(project)) {
    return err('project phải là 1 trong: ' + PROJECT_SLUGS.join(', ') + ' hoặc all.', 400);
  }
  const db = context.env.DB;
  const end = addDaysIso(vnTodayIso(), -3);
  const start = addDaysIso(end, -27);
  const inList = slugs.map(() => '?').join(',');
  const dailyQ = await db.prepare(
    `SELECT project, date, clicks, impressions, ctr, position FROM gsc_daily
     WHERE project IN (${inList}) AND date >= ? AND date <= ? ORDER BY date ASC`,
  ).bind(...slugs, start, end).all();
  const daily = dailyQ.results || [];
  let clicks = 0;
  let impressions = 0;
  let posWeighted = 0;
  const byProject = {};
  for (const p of slugs) byProject[p] = { clicks: 0, impressions: 0, posWeighted: 0, days: 0 };
  for (const r of daily) {
    const c = Number(r.clicks) || 0;
    const i = Number(r.impressions) || 0;
    clicks += c;
    impressions += i;
    posWeighted += (Number(r.position) || 0) * i;
    const bp = byProject[r.project];
    if (bp) { bp.clicks += c; bp.impressions += i; bp.posWeighted += (Number(r.position) || 0) * i; bp.days += 1; }
  }
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const position = impressions > 0 ? posWeighted / impressions : 0;
  const perProject = {};
  for (const p of slugs) {
    const bp = byProject[p];
    perProject[p] = {
      clicks: bp.clicks,
      impressions: bp.impressions,
      ctr: bp.impressions > 0 ? bp.clicks / bp.impressions : 0,
      position: bp.impressions > 0 ? bp.posWeighted / bp.impressions : 0,
      days: bp.days,
    };
  }
  const topQ = await db.prepare(
    `SELECT project, query, clicks, impressions, ctr, position, period FROM gsc_top_queries
     WHERE project IN (${inList}) ORDER BY period DESC, clicks DESC LIMIT 50`,
  ).bind(...slugs).all();
  const urlsQ = await db.prepare(
    `SELECT project, url, verdict, coverage_state, last_crawl, canonical, checked_at
     FROM gsc_url_status WHERE project IN (${inList}) ORDER BY checked_at DESC LIMIT 100`,
  ).bind(...slugs).all();
  const logsQ = await db.prepare(
    `SELECT project, finished_at, status FROM gsc_sync_log
     WHERE project IN (${inList}) AND status = 'ok' ORDER BY finished_at DESC LIMIT 1`,
  ).bind(...slugs).all();
  const lastSyncAt = (logsQ.results && logsQ.results[0] && logsQ.results[0].finished_at) || '';
  const names = {};
  for (const p of publicProjects()) names[p.slug] = p.name;
  return json({
    ok: true,
    project,
    period: { start, end, days: 28 },
    totals: { clicks, impressions, ctr, position, days: daily.length ? [...new Set(daily.map((r) => r.date))].length : 0 },
    perProject,
    topQueries: (topQ.results || []).map((r) => ({
      project: r.project, query: r.query, clicks: r.clicks, impressions: r.impressions,
      ctr: r.ctr, position: r.position, period: r.period,
    })),
    urls: (urlsQ.results || []).map((r) => ({
      project: r.project, name: names[r.project] || r.project, url: r.url,
      verdict: r.verdict, coverage_state: r.coverage_state,
      last_crawl: r.last_crawl, canonical: r.canonical, checked_at: r.checked_at,
    })),
    lastSyncAt,
    note: 'Số liệu Google Search Console, cập nhật lần cuối ' + (lastSyncAt ? fmtVnTime(lastSyncAt) : 'chưa đồng bộ') + ' (dữ liệu trễ 2–3 ngày). API GSC chỉ đọc trạng thái index, không có nút xin index — muốn xin index vẫn bấm tay trên Search Console.',
  });
}
