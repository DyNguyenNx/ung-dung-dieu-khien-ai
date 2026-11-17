// Hàng chờ cho Bảng tín hiệu MCP (Yêu cầu 45, 17/11/2026).
// Luật: TỐI ĐA 1 nhiệm vụ Đang tạo (status 'running' hoặc 'luna') cho mỗi
// tính năng tại một thời điểm; nhiệm vụ tới khi suất bận thì xếp hàng trong
// HÀNG CHỜ (status 'waiting') theo thứ tự tới trước làm trước (FIFO theo
// created_at). 'anh' (Thiết kế hình ảnh) NGOẠI LỆ: job Pollinations chạy
// bất đồng bộ ở server, cần file ảnh mẫu ngay lúc tạo (không lưu lại để
// chạy sau) nên nhiệm vụ 'anh' vẫn vào thẳng 'running' như cũ.
// QUEUE_MAX_ACTIVE là hằng số duy nhất — anh đổi số này là đổi luật.
import { isLunaAi, nowIso } from './auth.js';

export const QUEUE_MAX_ACTIVE = 1;
export const QUEUE_GATED_FEATURES = new Set(['web', 'page', 'kenh', 'truyen', 'designweb']);
export const QUEUE_ACTIVE_STATUSES = ['running', 'luna'];

function parsePayload(row) {
  try {
    return row && row.payload ? JSON.parse(row.payload) : {};
  } catch {
    return {};
  }
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

export async function activeCount(env, feature) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tasks WHERE feature = ? AND status IN ('running', 'luna')",
  ).bind(feature).first();
  return (r && r.n) || 0;
}

// Trạng thái khởi tạo khi tạo nhiệm vụ mới: suất trống thì vào trạng thái
// muốn vào, suất bận thì xếp hàng 'waiting'. 'anh' không qua hàng chờ.
export async function gateInitialStatus(env, feature, wantStatus) {
  if (!QUEUE_GATED_FEATURES.has(feature)) return wantStatus;
  if (!isActiveStatus(wantStatus)) return wantStatus;
  const n = await activeCount(env, feature);
  return n >= QUEUE_MAX_ACTIVE ? 'waiting' : wantStatus;
}

// Đẩy nhiệm vụ 'waiting' cũ nhất của tính năng lên khi có suất trống.
// UPDATE có điều kiện số suất còn trống nên 2 lần đẩy cùng lúc không vượt
// quá 1 suất. Trả {id, status} của nhiệm vụ được đẩy, hoặc null (không có
// suất / không có hàng chờ). Lỗi đẩy lên không được làm hỏng request chính —
// hàm gọi bọc try/catch (best-effort).
export async function promoteNext(env, feature) {
  if (!QUEUE_GATED_FEATURES.has(feature)) return null;
  const row = await env.DB.prepare(
    "SELECT id, payload FROM tasks WHERE feature = ? AND status = 'waiting' ORDER BY created_at ASC, id ASC LIMIT 1",
  ).bind(feature).first();
  if (!row) return null;
  const want = wantActiveStatus(feature, parsePayload(row));
  const res = await env.DB.prepare(
    "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = 'waiting' AND (SELECT COUNT(*) FROM tasks WHERE feature = ? AND status IN ('running', 'luna')) < ?",
  ).bind(want, nowIso(), row.id, feature, QUEUE_MAX_ACTIVE).run();
  const changed = res && res.meta ? res.meta.changes : 1;
  if (!changed) return null;
  return { id: row.id, status: want };
}
