// Gọi Pollinations tạo ảnh thật cho Thiết kế hình ảnh (Yêu cầu 35, 16/11/2026).
// Thay Gemini (Yêu cầu 33) sau khi kiểm chứng 18:10 16/11/2026: gói Free tier
// của Gemini cho model gemini-2.5-flash-image có giới hạn = 0 (không cấp quota
// miễn phí cho project này) — chờ reset cũng không khắc phục được.
//
// Model chốt: black-forest-labs/flux.2-klein-4b (alias flux-klein), giá live
// 0.005 Pollen/ảnh; hỗ trợ tối đa 10 ảnh mẫu, W×H tự chọn (app dùng ≤ 4 ảnh).
// Đường chính POST /v1/images/generations (JSON, OpenAI-compatible, trả
// b64_json — khớp khung lưu D1 result_image hiện tại). Nhánh có ảnh mẫu dùng
// POST /v1/images/edits multipart — field multipart theo APIDOCS.md của
// Pollinations (raw.githubusercontent.com/pollinations/pollinations/main/
// APIDOCS.md, đã đọc 16/11/2026): lặp lại field "image" cho mỗi ảnh mẫu
// (-F "image=@file"), kèm "prompt", "model", "size", "response_format".
// GIẢ ĐỊNH CẦN KIỂM LIVE: field multipart "image" + việc klein-4b nhận đúng
// nhiều ảnh mẫu qua multipart — docs ghi rõ như vậy, nhưng chưa có lần gọi
// thật nào (key chưa có ở local, QA bằng mock).
//
// Chạy BẤT ĐỒNG BỘ bằng context.waitUntil (tạo ảnh mất 10–60 giây, không
// chặn response tạo nhiệm vụ). 1 lần thử duy nhất, KHÔNG retry mù.
// Mọi lỗi đều đưa nhiệm vụ sang status 'error' kèm lý do rõ ràng bằng
// tiếng Việt — không giả vờ thành công, không chạy mô phỏng.
// Key đọc từ env.POLLINATIONS_API_KEY (Cloudflare secret, KHÔNG nằm trong
// code). Host override bằng env.POLLINATIONS_API_BASE_URL (mặc định host
// thật) để QA local trỏ sang mock — không dùng cho mục đích khác.
import { buildImagePrompt } from './gemini-image-prompts.js';
import { promoteNext } from './queue.js';
import { nowIso } from './auth.js';

export const POLLINATIONS_IMAGE_MODEL = 'black-forest-labs/flux.2-klein-4b';
export const POLLINATIONS_IMAGE_TIMEOUT_MS = 120000; // 2 phút — tạo ảnh thường 10–60 giây.

// Giới hạn kích thước của flux.2-klein-4b theo APIDOCS.md: mỗi cạnh ≥ 256px,
// tổng số pixel ≤ 2.359.296. Vượt thì thu nhỏ theo đúng tỉ lệ (giữ nguyên
// aspect), không crop.
export const POLLINATIONS_MAX_PIXELS = 2359296;
export const POLLINATIONS_MIN_SIDE = 256;

export function pollinationsApiBase(env) {
  return String(env.POLLINATIONS_API_BASE_URL || 'https://gen.pollinations.ai').replace(/\/$/, '');
}

export const POLLINATIONS_KEY_MISSING_MSG = 'Chưa cấu hình POLLINATIONS_API_KEY trên Cloudflare — anh Dy cần tạo key tại enter.pollinations.ai/keys rồi dán vào Pages → Settings → Variables (tên POLLINATIONS_API_KEY) và redeploy. Nhiệm vụ chưa tạo được ảnh.';

// Thu kích thước yêu cầu về trong giới hạn của model (giữ nguyên tỉ lệ khung).
export function clampSize(w, h) {
  let cw = Math.max(POLLINATIONS_MIN_SIDE, Math.round(Number(w) || 1024));
  let ch = Math.max(POLLINATIONS_MIN_SIDE, Math.round(Number(h) || 1024));
  if (cw * ch > POLLINATIONS_MAX_PIXELS) {
    const s = Math.sqrt(POLLINATIONS_MAX_PIXELS / (cw * ch));
    cw = Math.max(POLLINATIONS_MIN_SIDE, Math.floor(cw * s));
    ch = Math.max(POLLINATIONS_MIN_SIDE, Math.floor(ch * s));
  }
  return { w: cw, h: ch };
}

// Đoán mime từ magic bytes qua tiền tố base64 (Pollinations không trả mime
// kèm b64_json — không đoán theo model, đo thật từ bytes).
export function sniffMime(b64) {
  const s = String(b64 || '');
  if (s.startsWith('iVBOR')) return 'image/png';
  if (s.startsWith('/9j/')) return 'image/jpeg';
  if (s.startsWith('UklGR')) return 'image/webp';
  if (s.startsWith('R0lGOD')) return 'image/gif';
  return 'image/png';
}

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

// Dịch lỗi Pollinations (envelope {error:{code,message}}) thành lý do tiếng
// Việt rõ ràng cho nhân viên. Theo APIDOCS.md: 401 = key thiếu/sai;
// 402 = hết Pollen (key đúng nhưng số dư/budget đã hết); 429 = quá nhiều
// yêu cầu (kèm Retry-After); 422 content_policy_violation / 400
// content_blocked = nội dung bị chặn.
function pollinationsErrorMessage(res, data) {
  const raw = (data && data.error && data.error.message)
    || (data && data.message)
    || ('HTTP ' + res.status);
  const msg = String(raw).slice(0, 300);
  if (res.status === 401) {
    return 'Key Pollinations không đúng hoặc chưa có — anh Dy kiểm tra lại secret POLLINATIONS_API_KEY trên Cloudflare (tạo key tại enter.pollinations.ai/keys).';
  }
  if (res.status === 402) {
    return 'Hết Pollen trên tài khoản Pollinations (0.005 Pollen/ảnh) — anh Dy nạp thêm Pollen rồi giao lại việc. ' + msg;
  }
  if (res.status === 429) {
    const retry = res.headers && res.headers.get ? res.headers.get('retry-after') : null;
    return 'Pollinations đang quá tải / quá nhiều yêu cầu' + (retry ? ' — thử lại sau ' + retry + ' giây.' : ' — giao lại việc sau ít phút.');
  }
  if (res.status === 422 || (data && data.error && data.error.code === 'content_policy_violation')) {
    return 'Nội dung bị chặn bởi kiểm duyệt của Pollinations — hãy đổi mô tả / ảnh mẫu rồi giao lại việc. ' + msg;
  }
  if (res.status === 400 && data && data.error && data.error.code === 'content_blocked') {
    return 'Nội dung bị chặn bởi bộ lọc an toàn — hãy đổi mô tả / ảnh mẫu rồi giao lại việc. ' + msg;
  }
  return 'Pollinations từ chối (HTTP ' + res.status + '): ' + msg;
}

// Đọc 1 ảnh từ CreateImageResponse OpenAI-compatible {data:[{b64_json|url}]}.
// Ưu tiên b64_json; nếu chỉ có url thì tải về rồi mã hoá base64 (cùng timeout).
async function readImageFromResponse(data, timeoutMs) {
  const item = (data && Array.isArray(data.data) && data.data[0]) || null;
  if (!item) return null;
  if (item.b64_json) return { mimeType: sniffMime(item.b64_json), data: item.b64_json };
  if (item.url) {
    const res = await fetch(item.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error('Không tải được ảnh Pollinations đã tạo (HTTP ' + res.status + ').');
    const buf = await res.arrayBuffer();
    const b64 = bufToB64(buf);
    return { mimeType: sniffMime(b64), data: b64 };
  }
  return null;
}

// 1 lần gọi Pollinations duy nhất. refs = File[] ảnh mẫu (tối đa 4).
// Không có ảnh mẫu -> POST /v1/images/generations (JSON).
// Có ảnh mẫu -> POST /v1/images/edits (multipart, lặp field "image").
export async function callPollinationsImage(env, { prompt, refs, w, h }) {
  const key = env.POLLINATIONS_API_KEY || '';
  if (!key) throw new Error(POLLINATIONS_KEY_MISSING_MSG);
  const { w: cw, h: ch } = clampSize(w, h);
  const size = cw + 'x' + ch;
  const hasRefs = (refs || []).some((f) => f && typeof f !== 'string');
  let res;
  try {
    if (!hasRefs) {
      res = await fetch(pollinationsApiBase(env) + '/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key,
        },
        body: JSON.stringify({
          prompt,
          model: POLLINATIONS_IMAGE_MODEL,
          size,
          response_format: 'b64_json',
        }),
        signal: AbortSignal.timeout(POLLINATIONS_IMAGE_TIMEOUT_MS),
      });
    } else {
      const fd = new FormData();
      for (const f of refs || []) {
        if (!f || typeof f === 'string') continue;
        // File gốc từ FormData nhiệm vụ — append thẳng làm field "image"
        // (docs: lặp -F "image=@file" cho nhiều ảnh mẫu, klein-4b hỗ trợ).
        fd.append('image', f, f.name || 'anh.jpg');
      }
      fd.append('prompt', prompt);
      fd.append('model', POLLINATIONS_IMAGE_MODEL);
      fd.append('size', size);
      fd.append('response_format', 'b64_json');
      res = await fetch(pollinationsApiBase(env) + '/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key },
        body: fd,
        signal: AbortSignal.timeout(POLLINATIONS_IMAGE_TIMEOUT_MS),
      });
    }
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new Error('Pollinations quá thời gian chờ (2 phút) — hãy giao lại việc.');
    throw new Error('Không gọi được Pollinations: ' + (e && e.message ? e.message : 'lỗi mạng'));
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(pollinationsErrorMessage(res, data));
  const out = await readImageFromResponse(data, POLLINATIONS_IMAGE_TIMEOUT_MS);
  if (!out) throw new Error('Pollinations không trả về ảnh — hãy giao lại việc.');
  return out;
}

// Chạy nền sau khi tạo nhiệm vụ 'anh': cập nhật progress thật theo từng chặng
// rồi lưu ảnh vào cột result_image (xem migration 004) và đánh completed.
// LƯU TRỮ — CHỈ 1 ảnh / nhiệm vụ: bản mới nhất ghi đè (không giữ 5 phiên bản
// như file HTML — ảnh base64 1,5–2,5MB/phiên bản sẽ phình D1, theo tinh thần
// cap phiên bản của soát bảo mật run-1 ngày 16/11/2026).
// refFiles = File[] ảnh mẫu từ FormData (đọc thành File gốc để gửi multipart,
// không chặn response tạo nhiệm vụ). Prompt ẩn ghép bằng buildImagePrompt
// (module viết cho Gemini ở YC33 nhưng không chứa gì riêng của Gemini — tả
// cảnh bằng câu chuyện, ống kính/góc máy/ánh sáng/phong cách/tỉ lệ khung,
// chữ <25 ký tự tối đa 2–3 cụm; giữ nguyên cho Pollinations).
export async function runPollinationsImageTask(env, taskId, refFiles) {
  const db = env.DB;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    payload.pollinations = { error: String(message || 'Lỗi không rõ.').slice(0, 500), at: nowIso() };
    await db.prepare("UPDATE tasks SET status = 'error', progress = 0, payload = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(payload), nowIso(), taskId).run();
    // Yêu cầu 45 (sửa luật 17/11/2026): nhiệm vụ lỗi NHẢ suất Đang tạo — đẩy
    // việc chờ cùng AI lên làm tiếp (job chạy nền nên PATCH/delivery không
    // biết mà đẩy hộ).
    await promoteNext(env, 'anh', payload).catch(() => {});
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
    // Yêu cầu 45 (sửa luật 17/11/2026): nhiệm vụ 'anh' có thể vào Hàng chờ khi
    // cùng AI đang bận — CHƯA tới lượt thì CHƯA gọi Pollinations (đỡ tốn Pollen,
    // đúng luật xếp hàng). Chờ tối đa 10 phút (việc ảnh trước mặt thường xong
    // trong 10–60 giây); quá hạn thì vẫn tạo để khỏi mất việc, ảnh lưu sẵn và
    // promoteNext sẽ hoàn tất khi tới lượt.
    let waitedMs = 0;
    for (;;) {
      const st = await db.prepare('SELECT status FROM tasks WHERE id = ?').bind(taskId).first();
      if (!st) return; // nhiệm vụ đã bị xóa
      if (st.status === 'running' || st.status === 'luna') break;
      if (st.status !== 'waiting') return; // error/completed: không tạo nữa
      if (waitedMs >= 10 * 60 * 1000) break;
      await sleep(3000);
      waitedMs += 3000;
    }
    const img = payload.img || {};
    const refs = [];
    for (const f of refFiles || []) {
      if (!f || typeof f === 'string') continue;
      refs.push(f);
    }
    const built = buildImagePrompt(img, refs.length);
    const { w: cw, h: ch } = clampSize(Number(img.w) || 0, Number(img.h) || 0);
    await setProgress(10); // Đã ghép prompt ẩn xong.
    const startedAt = Date.now();
    await setProgress(30); // Đã gửi yêu cầu sang Pollinations.
    const out = await callPollinationsImage(env, { prompt: built.prompt, refs, w: cw, h: ch });
    await setProgress(80); // Đã nhận ảnh từ Pollinations.
    const bytes = Math.round((out.data.length * 3) / 4);
    const stored = JSON.stringify({
      mime: out.mimeType,
      data: out.data,
      bytes,
      w: cw,
      h: ch,
      aspect: built.aspectRatio,
      type: img.type || '',
      generated_at: nowIso(),
      ms: Date.now() - startedAt,
    });
    // Yêu cầu 45 (sửa luật 17/11/2026): chỉ hoàn tất khi nhiệm vụ còn ở trạng
    // thái Đang tạo — nhiệm vụ đã rời Đang tạo (vẫn đang chờ / đã xong tay)
    // thì lưu ảnh + đánh dấu sẵn, GIỮ nguyên trạng thái; promoteNext sẽ hoàn
    // tất khi đẩy lên Đang tạo.
    const done = await db.prepare("UPDATE tasks SET status = 'completed', progress = 100, result_image = ?, updated_at = ? WHERE id = ? AND status IN ('running','luna')")
      .bind(stored, nowIso(), taskId).run();
    if (!(done.meta && done.meta.changes)) {
      const row2 = await db.prepare('SELECT payload FROM tasks WHERE id = ?').bind(taskId).first();
      if (row2) {
        let p2 = {};
        try {
          p2 = JSON.parse(row2.payload || '{}');
        } catch {
          p2 = {};
        }
        p2.pollinations = { ...(p2.pollinations || {}), ready: true, generated_at: nowIso() };
        await db.prepare('UPDATE tasks SET progress = 100, result_image = ?, payload = ?, updated_at = ? WHERE id = ?')
          .bind(stored, JSON.stringify(p2), nowIso(), taskId).run();
      }
    }
    // Yêu cầu 45 (sửa luật 17/11/2026): nhiệm vụ xong NHẢ suất Đang tạo — đẩy
    // việc chờ cùng AI lên làm tiếp (job chạy nền nên PATCH/delivery không
    // biết mà đẩy hộ).
    await promoteNext(env, 'anh', payload).catch(() => {});
  } catch (e) {
    // Yêu cầu 35 (phát hiện khi QA mock): ảnh quá lớn (base64 ~8 triệu ký tự
    // trở lên) làm D1 trả SQLITE_TOOBIG khi lưu result_image — dịch thành lý
    // do tiếng Việt rõ ràng thay vì để nhân viên thấy mã lỗi kỹ thuật.
    const rawMsg = e && e.message ? e.message : 'Lỗi không rõ khi gọi Pollinations.';
    const friendly = /TOOBIG|too big/i.test(rawMsg)
      ? 'Ảnh Pollinations tạo ra quá lớn, không lưu được vào cơ sở dữ liệu — hãy giao lại việc với kích thước nhỏ hơn (ví dụ 1280×720).'
      : rawMsg;
    await setError(friendly);
  }
}
