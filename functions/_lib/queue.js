// Hàng chờ — Yêu cầu 45 (+ sửa luật 17/11/2026, xem yeu-cau-moi.md "Yêu cầu 45").
// Cổng xếp hàng theo AI PHỤ TRÁCH của nhiệm vụ (payload.ai), không theo tính năng:
// hai nhiệm vụ cùng AI thì tối đa 1 Đang tạo, còn lại xếp Hàng chờ FIFO theo
// created_at; hai nhiệm vụ khác AI thì chạy song song. Không còn miễn riêng
// 'anh' (Thiết kế hình ảnh): việc ảnh dùng AI khác với việc của Luna nên tự
// chạy song song; hai việc ảnh cùng AI thì xếp hàng như luật chung.
// Nhiệm vụ không có giá trị AI (payload.ai rỗng/thiếu — dữ liệu cũ, việc mô
// phỏng frontend) giữ cổng theo tính năng như cũ (an toàn).
// Không cần migration: chỉ dùng cột payload đã có (json_extract).
import { isLunaAi, nowIso } from './auth.js';

export const QUEUE_MAX_ACTIVE = 1;
export const QUEUE_ACTIVE_STATUSES = ['running', 'luna'];

function parsePayload(row) {
  try {
    return row && row.payload ? JSON.parse(row.payload) : {};
  } catch {
    return {};
  }
}

// Khóa cổng của một nhiệm vụ: { kind: 'ai', key: <tên AI> } khi có payload.ai,
// ngược lại { kind: 'feature', key: <tính năng> }. payload nhận cả object lẫn
// chuỗi JSON (row thô từ D1) lẫn null.
export function gateKeyOf(payload, feature) {
  const p = typeof payload === 'string' ? parsePayload({ payload }) : payload || {};
  const ai = String(p.ai || '').trim();
  return ai ? { kind: 'ai', key: ai } : { kind: 'feature', key: feature };
}

// Trạng thái "muốn vào" của một nhiệm vụ chờ: việc Luna thì 'luna', còn lại 'running'.
export function wantActiveStatus(feature, payload) {
  const p = payload || {};
  if (p.muse && p.muse.source === 'muse') return 'luna';
  if (feature === 'designweb') return 'luna';
  if ((feature === 'web' || feature === 'page') && isLunaAi(p.ai)) return 'luna';
  return 'running';
}

export function isActiveStatus(status) {
  return QUEUE_ACTIVE_STATUSES.includes(status);
}

// Đếm số nhiệm vụ đang chiếm suất Đang tạo của một khóa cổng.
export async function activeCount(env, gate) {
  let r;
  if (gate.kind === 'ai') {
    r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('running','luna') AND json_extract(payload, '$.ai') = ?",
    ).bind(gate.key).first();
  } else {
    r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM tasks WHERE feature = ? AND status IN ('running','luna')",
    ).bind(gate.key).first();
  }
  return (r && r.n) || 0;
}

// Trạng thái khởi tạo khi tạo nhiệm vụ mới: suất Đang tạo của khóa cổng bận
// thì xếp hàng 'waiting', trống thì giữ trạng thái muốn vào.
export async function gateInitialStatus(env, feature, wantStatus, payload = null) {
  if (!isActiveStatus(wantStatus)) return wantStatus;
  const gate = gateKeyOf(payload, feature);
  const n = await activeCount(env, gate);
  return n >= QUEUE_MAX_ACTIVE ? 'waiting' : wantStatus;
}

// Đẩy nhiệm vụ 'waiting' cũ nhất của CÙNG khóa cổng lên Đang tạo khi có suất
// trống. Nhiệm vụ được đẩy giữ đúng trạng thái "muốn vào" của chính nó
// ('luna' cho việc Luna, 'running' cho việc khác). UPDATE có điều kiện số suất
// còn trống nên 2 lần đẩy cùng lúc không vượt quá 1 suất. Trả {id, status}
// của nhiệm vụ được đẩy, hoặc null (không có suất / không có hàng chờ).
// Lỗi đẩy lên không được làm hỏng request chính — hàm gọi bọc try/catch.
export async function promoteNext(env, feature, payload = null) {
  const gate = gateKeyOf(payload, feature);
  let row;
  if (gate.kind === 'ai') {
    row = await env.DB.prepare(
      "SELECT id, feature, payload FROM tasks WHERE status = 'waiting' AND json_extract(payload, '$.ai') = ? ORDER BY created_at ASC, id ASC LIMIT 1",
    ).bind(gate.key).first();
  } else {
    row = await env.DB.prepare(
      "SELECT id, feature, payload FROM tasks WHERE feature = ? AND status = 'waiting' AND (json_extract(payload, '$.ai') IS NULL OR TRIM(json_extract(payload, '$.ai')) = '') ORDER BY created_at ASC, id ASC LIMIT 1",
    ).bind(gate.key).first();
  }
  if (!row) return null;
  const p = parsePayload(row);
  const want = wantActiveStatus(row.feature, p);
  const where =
    gate.kind === 'ai' ? "json_extract(payload, '$.ai') = ?" : 'feature = ?';
  const res = await env.DB.prepare(
    `UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = 'waiting'
     AND (SELECT COUNT(*) FROM tasks WHERE status IN ('running', 'luna') AND ${where}) < ?`,
  )
    .bind(want, nowIso(), row.id, gate.key, QUEUE_MAX_ACTIVE)
    .run();
  const changed = res && res.meta ? res.meta.changes : 1;
  if (!changed) return null;
  // Yêu cầu 45 (sửa luật 17/11/2026): việc ảnh đã có ảnh sẵn (job Pollinations
  // xong trong lúc chờ — xem pollinations-image.js) thì hoàn tất luôn khi tới
  // lượt, không để kẹt ở Đang tạo.
  let finalStatus = want;
  if (row.feature === 'anh' && p.pollinations && p.pollinations.ready) {
    await env.DB.prepare("UPDATE tasks SET status = 'completed', progress = 100, updated_at = ? WHERE id = ? AND status = ?")
      .bind(nowIso(), row.id, want).run();
    finalStatus = 'completed';
  }
  return { id: row.id, status: finalStatus };
}
