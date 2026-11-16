// Gọi Gemini tạo ảnh thật cho Thiết kế hình ảnh (Yêu cầu 33, 16/11/2026).
// Model gemini-2.5-flash-image ("Nano Banana") qua generateContent,
// responseModalities ["IMAGE"]. Ảnh trả về dạng base64 inlineData {mimeType, data},
// kèm watermark SynthID của Google (không gỡ được, cũng không cần gỡ).
// Bản mới gemini-3.1-flash-image / gemini-3-pro-image chỉ cân nhắc khi cần 4K.
//
// Chạy BẤT ĐỒNG BỘ bằng context.waitUntil (gọi Gemini mất 10–60 giây, không
// chặn response tạo nhiệm vụ). 1 lần thử duy nhất, KHÔNG retry mù.
// Mọi lỗi (thiếu key, bị chặn an toàn, không có ảnh, timeout) đều đưa nhiệm vụ
// sang status 'error' kèm lý do rõ ràng — không giả vờ thành công, không chạy
// mô phỏng. Key đọc từ env.GEMINI_API_KEY (Cloudflare secret, KHÔNG nằm trong code).
// Host override bằng env.GEMINI_API_BASE_URL (mặc định host thật) để QA local
// trỏ sang mock — không dùng cho mục đích khác.
import { buildImagePrompt } from './gemini-image-prompts.js';
import { nowIso } from './auth.js';

export const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
export const GEMINI_IMAGE_TIMEOUT_MS = 120000; // 2 phút — Gemini tạo ảnh thường 10–60 giây.

export function geminiApiBase(env) {
  return String(env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
}

export const GEMINI_KEY_MISSING_MSG = 'Chưa cấu hình GEMINI_API_KEY trên Cloudflare — anh Dy cần thêm key vào Pages → Settings → Variables (tên GEMINI_API_KEY) rồi redeploy. Nhiệm vụ chưa tạo được ảnh.';

// ArrayBuffer -> base64 (chunked, tránh tràn stack với ảnh vài MB).
export function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

// 1 lần gọi Gemini duy nhất. refs = [{name, type, base64}] (ảnh mẫu, tối đa 4).
export async function callGeminiImage(env, { prompt, refs }) {
  const key = env.GEMINI_API_KEY || '';
  if (!key) throw new Error(GEMINI_KEY_MISSING_MSG);
  const parts = [{ text: prompt }];
  for (const r of refs || []) {
    if (r && r.base64) parts.push({ inlineData: { mimeType: r.type || 'image/jpeg', data: r.base64 } });
  }
  let res;
  try {
    res = await fetch(`${geminiApiBase(env)}/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
      signal: AbortSignal.timeout(GEMINI_IMAGE_TIMEOUT_MS),
    });
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new Error('Gemini quá thời gian chờ (2 phút) — hãy giao lại việc.');
    throw new Error('Không gọi được Gemini: ' + (e && e.message ? e.message : 'lỗi mạng'));
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
    throw new Error('Gemini từ chối (HTTP ' + res.status + '): ' + String(msg).slice(0, 300));
  }
  const candidates = (data && data.candidates) || [];
  const part = (candidates[0] && candidates[0].content && candidates[0].content.parts || [])
    .find((p) => p && p.inlineData && String(p.inlineData.mimeType || '').startsWith('image/') && p.inlineData.data);
  if (!part) {
    const reason = (data && data.promptFeedback && data.promptFeedback.blockReason)
      || (candidates[0] && candidates[0].finishReason) || '';
    if (reason) throw new Error('Gemini chặn yêu cầu (' + reason + ') — hãy đổi mô tả rồi giao lại việc.');
    throw new Error('Gemini không trả về ảnh — hãy giao lại việc.');
  }
  return { mimeType: part.inlineData.mimeType, data: part.inlineData.data };
}

// Chạy nền sau khi tạo nhiệm vụ 'anh': cập nhật progress thật theo từng chặng
// rồi lưu ảnh vào cột result_image (xem migration 004) và đánh completed.
// LƯU TRỮ — CHỈ 1 ảnh / nhiệm vụ: bản mới nhất ghi đè (không giữ 5 phiên bản
// như file HTML — ảnh base64 1,5–2,5MB/phiên bản sẽ phình D1, theo tinh thần
// cap phiên bản của soát bảo mật run-1 ngày 16/11/2026).
// refFiles = File[] ảnh mẫu từ FormData (đọc thành base64 ngay trong runner,
// không chặn response tạo nhiệm vụ).
export async function runGeminiImageTask(env, taskId, refFiles) {
  const db = env.DB;
  const setProgress = (p) => db.prepare('UPDATE tasks SET progress = ?, updated_at = ? WHERE id = ?')
    .bind(p, nowIso(), taskId).run();
  const setError = async (message) => {
    let payload = {};
    try {
      const row = await db.prepare('SELECT payload FROM tasks WHERE id = ?').bind(taskId).first();
      payload = JSON.parse((row && row.payload) || '{}');
    } catch {
      payload = {};
    }
    payload.gemini = { error: String(message || 'Lỗi không rõ.').slice(0, 500), at: nowIso() };
    await db.prepare("UPDATE tasks SET status = 'error', progress = 0, payload = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(payload), nowIso(), taskId).run();
  };
  try {
    const row = await db.prepare('SELECT payload FROM tasks WHERE id = ?').bind(taskId).first();
    if (!row) return;
    let payload = {};
    try {
      payload = JSON.parse(row.payload || '{}');
    } catch {
      payload = {};
    }
    const img = payload.img || {};
    // Ảnh mẫu: đọc file gốc thành base64 để gửi kèm Gemini (tối đa 4 ảnh).
    const refs = [];
    for (const f of refFiles || []) {
      if (!f || typeof f === 'string') continue;
      refs.push({ name: f.name || 'anh.jpg', type: f.type || 'image/jpeg', base64: bufToB64(await f.arrayBuffer()) });
    }
    const built = buildImagePrompt(img, refs.length);
    await setProgress(10); // Đã ghép prompt ẩn xong.
    const startedAt = Date.now();
    await setProgress(30); // Đã gửi yêu cầu sang Gemini.
    const out = await callGeminiImage(env, { prompt: built.prompt, refs });
    await setProgress(80); // Đã nhận ảnh từ Gemini.
    const bytes = Math.round((out.data.length * 3) / 4);
    const stored = JSON.stringify({
      mime: out.mimeType,
      data: out.data,
      bytes,
      w: Number(img.w) || null,
      h: Number(img.h) || null,
      aspect: built.aspectRatio,
      type: img.type || '',
      generated_at: nowIso(),
      ms: Date.now() - startedAt,
    });
    await db.prepare("UPDATE tasks SET status = 'completed', progress = 100, result_image = ?, updated_at = ? WHERE id = ?")
      .bind(stored, nowIso(), taskId).run();
  } catch (e) {
    await setError(e && e.message ? e.message : 'Lỗi không rõ khi gọi Gemini.');
  }
}
