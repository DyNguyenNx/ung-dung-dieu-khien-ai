// GET /api/quota — Lượt dùng còn lại của tài khoản hiện tại, theo từng tính năng.
// Admin trả về limit = null (không giới hạn lượt).
import { json, FEATURE_KEYS, FEATURES, requireAuth, getLimit, getUsedThisWeek } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const { user, response } = await requireAuth(context.env, context.request);
  if (response) return response;
  const out = {};
  for (const f of FEATURE_KEYS) {
    const limit = user.role === 'admin' ? null : await getLimit(context.env, user.id, f);
    const used = await getUsedThisWeek(context.env, user.id, f);
    out[f] = { name: FEATURES[f], used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
  }
  return json({ ok: true, quota: out });
}
