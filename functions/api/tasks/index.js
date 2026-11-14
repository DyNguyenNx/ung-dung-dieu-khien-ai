// /api/tasks — Danh sách + tạo nhiệm vụ.
// GET  ?feature=&status=&today=1&limit=  (nhân viên chỉ thấy việc của mình)
// POST {feature, title, payload}         (kiểm tra lượt dùng theo tuần ISO)
// POST multipart (chỉ Design Web): fields + clientPhotos[] + refPhotos[]
//      (ảnh thật của khách + ảnh tham khảo — gửi kèm brief sang Telegram, Yêu cầu 28)
import { json, err, FEATURES, FEATURE_KEYS, TASK_STATUSES, requireAuth, getLimit, getUsedThisWeek, nowIso, uuid, taskExtras } from '../../_lib/auth.js';
import { notifyBrief, MAX_CLIENT_PHOTOS, MAX_REF_PHOTOS, MAX_PHOTO_BYTES } from '../../_lib/telegram.js';

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
    ...taskExtras(t),
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

function checkPhotos(files, max, label) {
  if (files.length > max) return `Tối đa ${max} ${label} mỗi nhiệm vụ (đang gửi ${files.length}).`;
  for (const f of files) {
    if (!f.type || !f.type.startsWith('image/')) return `File “${f.name || 'không tên'}” không phải ảnh — chỉ nhận file ảnh.`;
    if (f.size > MAX_PHOTO_BYTES) return `Ảnh “${f.name || 'không tên'}” nặng hơn 5MB — hãy nén nhỏ lại rồi gửi.`;
  }
  return '';
}

export async function onRequestPost(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const ct = context.request.headers.get('Content-Type') || '';
  let body;
  let clientPhotos = [];
  let refPhotos = [];
  try {
    if (ct.includes('multipart/form-data')) {
      const fd = await context.request.formData();
      const raw = fd.get('payload');
      body = raw ? JSON.parse(String(raw)) : {};
      clientPhotos = fd.getAll('clientPhotos').filter((f) => f && typeof f !== 'string');
      refPhotos = fd.getAll('refPhotos').filter((f) => f && typeof f !== 'string');
    } else {
      body = await context.request.json();
    }
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
  if (feature === 'designweb') {
    const bad = checkPhotos(clientPhotos, MAX_CLIENT_PHOTOS, 'ảnh thật của khách')
      || checkPhotos(refPhotos, MAX_REF_PHOTOS, 'ảnh mẫu / tài liệu tham khảo');
    if (bad) return err(bad, 400);
  } else if (clientPhotos.length || refPhotos.length) {
    return err('Chỉ nhiệm vụ Design Web mới nhận ảnh đính kèm.', 400);
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

  // Design Web (Yêu cầu 28): nhiệm vụ vào trạng thái 'luna' — chờ Thư Ký Mỹ Linh vẽ.
  // Các tính năng khác giữ nguyên 'running' (chạy tiến độ mô phỏng ở frontend).
  const initialStatus = feature === 'designweb' ? 'luna' : 'running';
  const id = uuid();
  const now = nowIso();
  const payloadObj = body.payload ? { ...body.payload } : {};
  if (feature === 'designweb') {
    payloadObj.luna = {
      notified: false,
      photoCount: clientPhotos.length,
      photoNames: clientPhotos.map((f) => f.name || 'anh.jpg'),
      refPhotoCount: refPhotos.length,
      refPhotoNames: refPhotos.map((f) => f.name || 'anh.jpg'),
      photos: [],
      refPhotos: [],
      sendError: '',
      revisions: [],
    };
  }
  await context.env.DB.prepare(
    'INSERT INTO tasks (id, user_id, feature, title, status, progress, payload, result_url, result_html, result_versions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, ?, ?)',
  ).bind(id, user.id, feature, title, initialStatus, JSON.stringify(payloadObj), now, now).run();

  // Gửi brief + ảnh sang Telegram (best-effort — lỗi không làm hỏng nhiệm vụ).
  let luna = null;
  if (feature === 'designweb') {
    const photoFiles = [];
    for (const f of clientPhotos) photoFiles.push({ name: f.name || 'anh.jpg', type: f.type || 'image/jpeg', data: await f.arrayBuffer() });
    const refFiles = [];
    for (const f of refPhotos) refFiles.push({ name: f.name || 'anh.jpg', type: f.type || 'image/jpeg', data: await f.arrayBuffer() });
    const taskForBrief = { id, title, payload: payloadObj };
    const sent = await notifyBrief(context.env, taskForBrief, { name: user.name, email: user.email }, photoFiles, refFiles);
    luna = {
      ...payloadObj.luna,
      notified: sent.notified,
      photosSent: sent.photosSent,
      photos: sent.photoFileIds || [],
      refPhotos: sent.refPhotoFileIds || [],
      sendError: sent.error || '',
      sentAt: now,
    };
    payloadObj.luna = luna;
    await context.env.DB.prepare('UPDATE tasks SET payload = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(payloadObj), nowIso(), id).run();
  }

  const row = await context.env.DB.prepare(
    'SELECT t.*, u.name AS user_name, u.email AS user_email FROM tasks t JOIN users u ON u.id = t.user_id WHERE t.id = ?',
  ).bind(id).first();
  const out = taskRow(row);
  if (quota) {
    quota.used += 1;
    quota.remaining = Math.max(0, quota.limit - quota.used);
    out.quota = quota;
  }
  if (luna) out.luna = luna;
  return json({ ok: true, task: out }, 201);
}
