// Gửi thông báo + ảnh sang Telegram bằng bot RIÊNG của app (Yêu cầu 28).
// Token KHÔNG nằm trong code: đọc từ env.TELEGRAM_BOT_TOKEN (Cloudflare secret).
// Mọi lần gọi đều best-effort: lỗi Telegram không bao giờ làm hỏng thao tác chính
// (tạo nhiệm vụ / giao file) — lỗi được trả về để ghi vào payload.luna.sendError.
// KHÔNG log token hay nội dung secret ra bất cứ đâu.
import { nowIso } from './auth.js';

const DEFAULT_CHAT_ID = '8740408748'; // DM anh Dy (id Telegram của anh, không đổi theo bot).
export const MAX_BRIEF_CHARS = 4000;
export const MAX_CLIENT_PHOTOS = 6;
export const MAX_REF_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB / ảnh
export const MAX_DELIVERY_BYTES = 1024 * 1024; // 1MB / file HTML

function tgBase(env) {
  return (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
}
function tgToken(env) {
  return env.TELEGRAM_BOT_TOKEN || '';
}
function tgChatId(env) {
  // LUNA_NOTIFY_CHAT_ID: chat nhận thông báo brief (DM anh Dy, id 8740408748 —
  // đã kiểm chứng 15/11: anh đã /start bot mới, tin thử đã tới đúng DM này).
  // TELEGRAM_CHAT_ID giữ làm tên dự phòng.
  return env.LUNA_NOTIFY_CHAT_ID || env.TELEGRAM_CHAT_ID || DEFAULT_CHAT_ID;
}

async function tgCall(env, method, body, isForm = false) {
  const token = tgToken(env);
  if (!token) return { ok: false, error: 'Chưa cấu hình TELEGRAM_BOT_TOKEN.' };
  const url = `${tgBase(env)}/bot${token}/${method}`;
  const init = { method: 'POST' };
  if (isForm) {
    init.body = body; // FormData — fetch tự đặt Content-Type + boundary.
  } else {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    return { ok: false, error: 'Không gọi được Telegram: ' + (e && e.message ? e.message : 'lỗi mạng') };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: 'Telegram trả về dữ liệu không đọc được (HTTP ' + res.status + ').' };
  }
  if (!res.ok || !data || data.ok !== true) {
    const desc = data && data.description ? data.description : 'HTTP ' + res.status;
    return { ok: false, error: 'Telegram từ chối: ' + desc };
  }
  return { ok: true, result: data.result };
}

export async function sendTelegramMessage(env, text) {
  return tgCall(env, 'sendMessage', { chat_id: tgChatId(env), text });
}

// Gửi ảnh: 1 ảnh → sendPhoto; 2+ ảnh → sendMediaGroup (tối đa 10/lần gọi).
// files: [{ name, type, data }] với data là ArrayBuffer.
// Trả về { ok, sent: [{ file_id, file_unique_id, name }], error }.
export async function sendTelegramPhotos(env, files, caption) {
  if (!files || !files.length) return { ok: true, sent: [] };
  if (!tgToken(env)) return { ok: false, error: 'Chưa cấu hình TELEGRAM_BOT_TOKEN.', sent: [] };
  const chatId = tgChatId(env);
  if (files.length === 1) {
    const f = files[0];
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    fd.append('photo', new Blob([f.data], { type: f.type || 'image/jpeg' }), f.name || 'anh.jpg');
    if (caption) fd.append('caption', caption);
    const r = await tgCall(env, 'sendPhoto', fd, true);
    if (!r.ok) return { ok: false, error: r.error, sent: [] };
    const p = r.result && r.result.photo ? r.result.photo[r.result.photo.length - 1] : null;
    return { ok: true, sent: p ? [{ file_id: p.file_id, file_unique_id: p.file_unique_id, name: f.name || 'anh.jpg' }] : [] };
  }
  const media = files.map((f, i) => {
    const m = { type: 'photo', media: 'attach://photo' + i };
    if (i === 0 && caption) m.caption = caption;
    return m;
  });
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('media', JSON.stringify(media));
  files.forEach((f, i) => {
    fd.append('photo' + i, new Blob([f.data], { type: f.type || 'image/jpeg' }), f.name || ('anh-' + (i + 1) + '.jpg'));
  });
  const r = await tgCall(env, 'sendMediaGroup', fd, true);
  if (!r.ok) return { ok: false, error: r.error, sent: [] };
  const sent = (Array.isArray(r.result) ? r.result : []).map((msg, i) => {
    const p = msg && msg.photo ? msg.photo[msg.photo.length - 1] : null;
    return p ? { file_id: p.file_id, file_unique_id: p.file_unique_id, name: (files[i] && files[i].name) || ('anh-' + (i + 1) + '.jpg') } : null;
  }).filter(Boolean);
  return { ok: true, sent };
}

function cut(s, max) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
function line(label, value, max = 300) {
  const v = cut(value, max);
  return v ? label + ': ' + v : '';
}

// Brief text gửi cho anh Dy (đọc được) — cũng là nội dung Luna đối chiếu qua /api/luna/pending.
export function formatBrief(task, owner) {
  const w = (task.payload && task.payload.web) || {};
  const luna = (task.payload && task.payload.luna) || {};
  const mats = Array.isArray(w.materials) ? w.materials : [];
  const secs = Array.isArray(w.sections) ? w.sections : [];
  const hasPhotoMat = mats.includes('Ảnh thật');
  const photoCount = luna.photoCount || 0;
  const photoLine = hasPhotoMat
    ? (photoCount > 0 ? `Ảnh thật của khách: đã đính kèm ${photoCount} ảnh (xem ảnh trong tin sau).` : 'Ảnh thật của khách: đã tick Ảnh thật nhưng chưa đính kèm ảnh nào.')
    : 'Ảnh thật của khách: không có — dùng ảnh Google (ảnh thật, không logo/watermark của công ty khác) hoặc tự thiết kế ảnh bằng AI (Leonardo / LightVisual / Grok).';
  const rows = [
    '🎨 BRIEF DESIGN WEB — Mã: ' + task.id,
    line('Khách', w.customer || task.title, 120),
    line('Lĩnh vực', w.field, 120),
    line('Màu', w.color, 200),
    line('Font', w.font, 200),
    line('Web tham khảo', w.ref, 300),
    secs.length ? 'Các mục: ' + secs.map((s) => cut(s, 60)).join(', ') : '',
    line('Vị trí logo', w.logoPos, 120),
    line('Đối tượng xem web', w.audience, 300),
    line('Hành động chính', w.action, 200),
    'Chất liệu thật: ' + (mats.length ? mats.join(', ') : 'chưa tick mục nào'),
    photoLine,
    (luna.refPhotoCount || 0) > 0 ? `Ảnh mẫu / tài liệu tham khảo: ${luna.refPhotoCount} ảnh (xem ảnh trong tin sau).` : '',
    line('Ghi chú', w.note, 400),
    owner ? `Người giao: ${owner.name || ''}${owner.email ? ' (' + owner.email + ')' : ''}` : '',
    '—',
    'Brief đầy đủ + ảnh lấy qua: GET /api/luna/pending (kèm secret).',
    'Trả file: POST /api/luna/delivery {task_id, html}.',
  ].filter(Boolean);
  return cut(rows.join('\n'), MAX_BRIEF_CHARS);
}

// Gửi brief text + ảnh. Trả về { notified, photosSent, photoFileIds, refPhotoFileIds, error }.
export async function notifyBrief(env, task, owner, clientPhotos, refPhotos) {
  const text = formatBrief(task, owner);
  const msg = await sendTelegramMessage(env, text);
  const out = {
    notified: !!msg.ok,
    photosSent: 0,
    photoFileIds: [],
    refPhotoFileIds: [],
    error: msg.ok ? '' : (msg.error || 'Không gửi được brief.'),
  };
  if (clientPhotos && clientPhotos.length) {
    const cap = 'Ảnh thật của khách — ' + (task.title || 'Design Web') + ' — mã: ' + task.id;
    const r = await sendTelegramPhotos(env, clientPhotos, cap);
    if (r.ok) {
      out.photosSent = r.sent.length;
      out.photoFileIds = r.sent;
    } else {
      out.error = (out.error ? out.error + ' ' : '') + 'Ảnh thật: ' + (r.error || 'không gửi được.');
    }
  }
  if (refPhotos && refPhotos.length) {
    const cap = 'Ảnh mẫu / tài liệu tham khảo — ' + (task.title || 'Design Web') + ' — mã: ' + task.id;
    const r = await sendTelegramPhotos(env, refPhotos, cap);
    if (r.ok) {
      out.refPhotoFileIds = r.sent;
    } else {
      out.error = (out.error ? out.error + ' ' : '') + 'Ảnh tham khảo: ' + (r.error || 'không gửi được.');
    }
  }
  return out;
}

export async function notifyDelivery(env, task, version) {
  const text = `✅ Thư Ký Mỹ Linh đã trả bản ${version} cho nhiệm vụ “${task.title}” (mã: ${task.id}).\nMở app → Design Web → bấm Duyệt để trả cho nhân viên.`;
  return sendTelegramMessage(env, text);
}

export async function notifyRevision(env, task, note, byName) {
  const text = `✏️ Yêu cầu chỉnh sửa cho nhiệm vụ “${task.title}” (mã: ${task.id}).\n${byName ? 'Người gửi: ' + byName + '\n' : ''}Nội dung: ${cut(note, 800)}\nLuna lấy brief + bản cũ qua GET /api/luna/pending (kèm secret) rồi trả bản mới qua POST /api/luna/delivery.`;
  return sendTelegramMessage(env, text);
}

export { nowIso };
