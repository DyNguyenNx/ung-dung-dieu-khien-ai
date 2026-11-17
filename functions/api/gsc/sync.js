// POST /api/gsc/sync — Đồng bộ số liệu Google Search Console (Yêu cầu 39).
// CHỈ Admin. Body {project?} — 1 slug dự án, hoặc tất cả khi bỏ trống.
// Mỗi dự án: 3 query Search Analytics (tổng theo ngày 28 ngày; top trang;
// top từ khóa) + inspect URL bài mới (tối đa 100 URL/ngày/dự án, tối đa
// 20 URL/lần đồng bộ để request không quá dài; cache verdict 7 ngày,
// không inspect lại URL đã kiểm trong 24h). Kết quả URL Inspection cập
// nhật trường indexed trong project_stats.details.articles (YC31) để cột
// Index trên Dashboard chuyển xanh mà không cần bấm tay kiểm tra.
// Cooldown 15 phút/dự án (trả 429 rõ nếu bấm liên tục; lần đồng bộ lỗi
// thì được thử lại ngay). Thiếu secret → 500 lỗi rõ; service account
// chưa có quyền trên property → 403 lỗi rõ; hết quota ngày → 429.
// API GSC KHÔNG có endpoint xin index — endpoint này CHỈ ĐỌC trạng thái.
import { json, err, requireAdmin, nowIso, uuid } from '../../_lib/auth.js';
import { projectBySlug, PROJECT_SLUGS } from '../../_lib/projects.js';
import {
  GscError, getAccessToken, querySearchAnalytics, inspectUrl, listSites,
  defaultSyncRange, vnTodayIso, addDaysIso,
} from '../../_lib/gsc.js';

const COOLDOWN_MS = 15 * 60 * 1000;
const MAX_INSPECT_PER_RUN = 20;
const MAX_INSPECT_PER_DAY = 100;
const VERDICT_CACHE_DAYS = 7;
const RECHECK_AFTER_HOURS = 24;

function httpStatusFor(code) {
  if (code === 'NO_ACCESS') return 403;
  if (code === 'QUOTA') return 429;
  return 500;
}

// Resolve mapping dự án ↔ GSC property: lấy dòng đã lưu; chưa có thì thử
// tự khớp từ sites.list theo domain (URL-prefix hoặc sc-domain) rồi lưu.
async function resolveProperty(env, project) {
  const db = env.DB;
  let row = await db.prepare(
    'SELECT project, site_url, status FROM gsc_properties WHERE project = ?',
  ).bind(project.slug).first();
  if (row && row.site_url) return row.site_url;
  const sites = await listSites(env);
  const domain = project.domain.toLowerCase();
  const match = sites.find((s) => {
    const u = String(s.siteUrl || '').toLowerCase();
    return u === 'sc-domain:' + domain || u === 'https://' + domain + '/' || u === 'https://' + domain;
  });
  if (!match) {
    throw new GscError('NOT_MAPPED',
      `Chưa map GSC property cho dự án ${project.name} — admin map trước ở GET/POST /api/gsc/properties (site_url dạng https://... hoặc sc-domain:...).`);
  }
  const now = nowIso();
  await db.prepare(
    `INSERT INTO gsc_properties (id, project, site_url, connection_id, status, last_sync_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, 'service_account', 'ok', NULL, NULL, ?, ?)
     ON CONFLICT(project) DO UPDATE SET site_url = excluded.site_url, status = 'ok', last_error = NULL, updated_at = excluded.updated_at`,
  ).bind(uuid(), project.slug, match.siteUrl, now, now).run();
  return match.siteUrl;
}

async function checkCooldown(env, slug) {
  const last = await env.DB.prepare(
    'SELECT started_at, status FROM gsc_sync_log WHERE project = ? ORDER BY started_at DESC LIMIT 1',
  ).bind(slug).first();
  if (!last || (last.status !== 'ok' && last.status !== 'running')) return null;
  const elapsed = Date.now() - Date.parse(last.started_at || '');
  if (Number.isFinite(elapsed) && elapsed < COOLDOWN_MS) {
    const waitMin = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
    return `Dự án này vừa đồng bộ ${Math.max(1, Math.floor(elapsed / 60000))} phút trước — thử lại sau ${waitMin} phút (cooldown 15 phút).`;
  }
  return null;
}

async function writeLog(env, id, slug, startedAt, status, error, rowsSynced) {
  // Tra ve moc finished_at vua ghi — frontend dung de doi ban doc summary
  // phan anh dung lan dong bo nay (fix loi 1/3: D1 doc co the tre sau ghi).
  const finishedAt = nowIso();
  await env.DB.prepare(
    'UPDATE gsc_sync_log SET finished_at = ?, status = ?, error = ?, rows_synced = ? WHERE id = ?',
  ).bind(finishedAt, status, error || null, rowsSynced || 0, id).run();
  return finishedAt;
}

async function setPropertySync(env, slug, status, lastError) {
  await env.DB.prepare(
    'UPDATE gsc_properties SET status = ?, last_sync_at = ?, last_error = ?, updated_at = ? WHERE project = ?',
  ).bind(status, nowIso(), lastError || null, nowIso(), slug).run();
}

// Link bài đã đăng của dự án (từ project_stats.details.articles, 4 tuần
// gần nhất) — nguồn URL chính để kiểm tra index.
async function articleLinks(env, slug) {
  const { results } = await env.DB.prepare(
    `SELECT details FROM project_stats WHERE project = ? AND kind = 'article' ORDER BY period DESC LIMIT 4`,
  ).bind(slug).all();
  const links = [];
  for (const r of (results || [])) {
    try {
      const d = JSON.parse(r.details || '{}');
      for (const a of (Array.isArray(d.articles) ? d.articles : [])) {
        if (a && typeof a.link === 'string' && a.link.indexOf('https://') === 0) links.push(a.link);
      }
    } catch { /* details cũ hỏng thì bỏ qua */ }
  }
  return [...new Set(links)];
}

// Cập nhật cờ indexed của bài trong project_stats theo kết quả inspect.
async function updateArticlesIndexed(env, slug, verdictMap) {
  const { results } = await env.DB.prepare(
    `SELECT id, details FROM project_stats WHERE project = ? AND kind = 'article' ORDER BY period DESC LIMIT 4`,
  ).bind(slug).all();
  let changed = 0;
  for (const r of (results || [])) {
    let d;
    try { d = JSON.parse(r.details || '{}'); } catch { continue; }
    if (!d || !Array.isArray(d.articles)) continue;
    let rowChanged = false;
    for (const a of d.articles) {
      if (!a || typeof a.link !== 'string') continue;
      const v = verdictMap[a.link];
      if (v === undefined) continue;
      const next = v === 'PASS' ? true : (v === 'FAIL' ? false : null);
      if (a.indexed !== next) { a.indexed = next; rowChanged = true; }
    }
    if (!rowChanged) continue;
    const articles = d.articles;
    d.index = { requested: articles.length, indexed: articles.filter((a) => a.indexed === true).length };
    await env.DB.prepare(
      'UPDATE project_stats SET details = ?, updated_at = ? WHERE id = ?',
    ).bind(JSON.stringify(d), nowIso(), r.id).run();
    changed++;
  }
  return changed;
}

async function syncProject(env, slug) {
  const project = projectBySlug(slug);
  const db = env.DB;
  // Cooldown PHẢI kiểm tra TRƯỚC khi ghi log 'running' — nếu kiểm tra sau
  // thì dòng log vừa ghi luôn là "mới nhất" và lần nào cũng 429.
  const cooldownMsg = await checkCooldown(env, slug);
  if (cooldownMsg) throw new GscError('COOLDOWN', cooldownMsg);
  const startedAt = nowIso();
  const logId = uuid();
  await db.prepare(
    'INSERT INTO gsc_sync_log (id, project, started_at, finished_at, status, error, rows_synced) VALUES (?, ?, ?, NULL, ?, NULL, 0)',
  ).bind(logId, slug, startedAt, 'running').run();
  let rowsSynced = 0;
  try {
    // Fail nhanh khi chưa cấu hình secret (trước khi gọi Google).
    await getAccessToken(env);
    const siteUrl = await resolveProperty(env, project);
    const { startDate, endDate } = defaultSyncRange();
    const period = startDate + '_' + endDate;
    // 1) Tổng theo ngày → gsc_daily.
    const dailyRows = await querySearchAnalytics(env, siteUrl, { startDate, endDate, dimensions: ['date'], rowLimit: 1000 });
    for (const r of dailyRows) {
      const date = r.keys[0] || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      await db.prepare(
        `INSERT INTO gsc_daily (id, project, date, clicks, impressions, ctr, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project, date) DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions, ctr = excluded.ctr, position = excluded.position`,
      ).bind(uuid(), slug, date, r.clicks, r.impressions, r.ctr, r.position).run();
      rowsSynced++;
    }
    // 2) Top trang → nguồn URL để kiểm index.
    const pageRows = await querySearchAnalytics(env, siteUrl, { startDate, endDate, dimensions: ['page'], rowLimit: 100 });
    const topPages = pageRows.map((r) => r.keys[0]).filter((u) => typeof u === 'string' && u.indexOf('https://') === 0);
    // 3) Top từ khóa → gsc_top_queries (xóa kỳ cũ rồi ghi mới, cap 50).
    const queryRows = await querySearchAnalytics(env, siteUrl, { startDate, endDate, dimensions: ['query'], rowLimit: 50 });
    await db.prepare('DELETE FROM gsc_top_queries WHERE project = ? AND period = ?').bind(slug, period).run();
    for (const r of queryRows) {
      const q = r.keys[0] || '';
      if (!q) continue;
      await db.prepare(
        'INSERT INTO gsc_top_queries (id, project, period, query, clicks, impressions, ctr, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(uuid(), slug, period, q, r.clicks, r.impressions, r.ctr, r.position).run();
      rowsSynced++;
    }
    // 4) URL Inspection: bài mới + top trang; cache verdict 7 ngày, không
    // inspect lại trong 24h; tối đa 100 URL/ngày/dự án, 20 URL/lần chạy.
    const domain = project.domain.toLowerCase();
    const candidates = [...new Set([...(await articleLinks(env, slug)), ...topPages])]
      .filter((u) => u.toLowerCase().indexOf(domain) !== -1);
    const { results: statusRows } = await db.prepare(
      'SELECT url, verdict, checked_at FROM gsc_url_status WHERE project = ?',
    ).bind(slug).all();
    const seen = {};
    for (const r of (statusRows || [])) seen[r.url] = r;
    const vnToday = vnTodayIso();
    const todayStartUtc = addDaysIso(vnToday, -1) + 'T17:00:00.000Z';
    const inspectedToday = (statusRows || []).filter((r) => (r.checked_at || '') >= todayStartUtc).length;
    let inspectBudget = Math.max(0, MAX_INSPECT_PER_DAY - inspectedToday);
    inspectBudget = Math.min(inspectBudget, MAX_INSPECT_PER_RUN);
    const verdictMap = {};
    let inspected = 0;
    const nowMs = Date.now();
    for (const u of candidates) {
      if (inspected >= inspectBudget) break;
      const prev = seen[u];
      if (prev) {
        const ageMs = nowMs - Date.parse(prev.checked_at || '');
        if (Number.isFinite(ageMs) && ageMs < RECHECK_AFTER_HOURS * 3600 * 1000) continue;
        if (prev.verdict && Number.isFinite(ageMs) && ageMs < VERDICT_CACHE_DAYS * 24 * 3600 * 1000) continue;
      }
      const res = await inspectUrl(env, siteUrl, u);
      if (res === null) {
        // Google chưa biết URL này — ghi verdict rỗng, lần sau kiểm lại.
        await db.prepare(
          `INSERT INTO gsc_url_status (id, project, url, verdict, coverage_state, last_crawl, canonical, checked_at)
           VALUES (?, ?, ?, '', '', '', '', ?)
           ON CONFLICT(project, url) DO UPDATE SET verdict = '', coverage_state = '', last_crawl = '', canonical = '', checked_at = excluded.checked_at`,
        ).bind(uuid(), slug, u, nowIso()).run();
        inspected++;
        continue;
      }
      await db.prepare(
        `INSERT INTO gsc_url_status (id, project, url, verdict, coverage_state, last_crawl, canonical, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project, url) DO UPDATE SET verdict = excluded.verdict, coverage_state = excluded.coverage_state, last_crawl = excluded.last_crawl, canonical = excluded.canonical, checked_at = excluded.checked_at`,
      ).bind(uuid(), slug, u, res.verdict, res.coverageState, res.lastCrawlTime, res.canonical, nowIso()).run();
      verdictMap[u] = res.verdict;
      inspected++;
      rowsSynced++;
    }
    if (inspected > 0) await updateArticlesIndexed(env, slug, verdictMap);
    await setPropertySync(env, slug, 'ok', null);
    const finishedAt = await writeLog(env, logId, slug, startedAt, 'ok', null, rowsSynced);
    return { project: slug, name: project.name, ok: true, rows: rowsSynced, inspected, site_url: siteUrl, period, synced_at: finishedAt };
  } catch (e) {
    const code = e instanceof GscError ? e.code : 'SYNC_FAILED';
    const message = e instanceof GscError ? e.message : ('Đồng bộ lỗi: ' + (e && e.message ? e.message : 'không rõ nguyên nhân'));
    if (code === 'NO_ACCESS') await setPropertySync(env, slug, 'no_access', message);
    else await db.prepare('UPDATE gsc_properties SET last_error = ?, updated_at = ? WHERE project = ?').bind(message, nowIso(), slug).run();
    await writeLog(env, logId, slug, startedAt, 'error', message, rowsSynced);
    return { project: slug, name: project ? project.name : slug, ok: false, error: message, code, rows: rowsSynced, inspected: 0 };
  }
}

export async function onRequestPost(context) {
  const { user, response } = await requireAdmin(context.env, context.request);
  if (response) return response;
  let body = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }
  const project = String(body.project || 'all').trim();
  const slugs = project === 'all' ? PROJECT_SLUGS : [project];
  if (project !== 'all' && !projectBySlug(project)) {
    return err('project phải là 1 trong: ' + PROJECT_SLUGS.join(', ') + ' hoặc all.', 400);
  }
  const results = [];
  for (const slug of slugs) {
    try {
      results.push(await syncProject(context.env, slug));
    } catch (e) {
      // COOLDOWN ném ra ngoài để endpoint trả 429 (chỉ khi đồng bộ 1 dự án).
      if (e instanceof GscError && e.code === 'COOLDOWN') {
        if (slugs.length === 1) return err(e.message, 429);
        results.push({ project: slug, ok: false, error: e.message, code: 'COOLDOWN' });
        continue;
      }
      results.push({ project: slug, ok: false, error: e && e.message ? e.message : 'Lỗi không rõ', code: 'SYNC_FAILED' });
    }
  }
  if (slugs.length === 1 && !results[0].ok) {
    return err(results[0].error, httpStatusFor(results[0].code || 'SYNC_FAILED'));
  }
  return json({ ok: true, results });
}
