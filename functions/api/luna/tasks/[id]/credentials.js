// GET /api/luna/tasks/:id/credentials — Thư Ký Mỹ Linh lấy tài khoản admin
// của website để đăng bài hộ nhân viên (Yêu cầu 38, 17/11/2026).
// Xác thực: header X-Luna-Secret (như /api/luna/delivery).
// Tra nhiệm vụ → chủ nhiệm vụ → payload.lines "Website: ..." → dòng websites
// tương ứng (khớp theo tên hoặc địa chỉ, của đúng chủ nhiệm vụ) → giải mã
// admin_pass → trả {website, admin_url, admin_user, admin_pass}.
// 404 khi không có website hoặc chưa lưu mật khẩu. TUYỆT ĐỐI không ghi giá trị
// credential vào log, không đưa vào brief Telegram.
import { json, err, lunaSecretOk } from '../../../../_lib/auth.js';
import { decryptAdminPass, CredentialError } from '../../../../_lib/credentials.js';

function websiteLabelFromLines(lines) {
  for (const l of lines || []) {
    const s = String(l || '');
    if (s.indexOf('Website:') === 0) return s.slice('Website:'.length).trim();
  }
  return '';
}

export async function onRequestGet(context) {
  if (!(await lunaSecretOk(context.env, context.request))) {
    return err('Sai secret hoặc chưa cấu hình LUNA_API_SECRET.', 401);
  }
  const row = await context.env.DB.prepare(
    'SELECT t.*, u.name AS user_name, u.email AS user_email FROM tasks t JOIN users u ON u.id = t.user_id WHERE t.id = ?',
  ).bind(context.params.id).first();
  if (!row) return err('Không tìm thấy nhiệm vụ.', 404);
  let payload = null;
  try {
    payload = row.payload ? JSON.parse(row.payload) : null;
  } catch {
    payload = null;
  }
  const lines = payload && Array.isArray(payload.lines) ? payload.lines : [];
  const siteLabel = websiteLabelFromLines(lines);
  if (!siteLabel) return err('Nhiệm vụ này không ghi website nào để lấy tài khoản admin.', 404);
  // Label trong lines là text của option select: "Tên — địa chỉ" hoặc chỉ "Tên".
  const parts = siteLabel.split(' — ');
  const namePart = (parts[0] || '').trim();
  const addrPart = (parts[1] || '').trim();
  const { results } = await context.env.DB.prepare(
    'SELECT * FROM websites WHERE user_id = ?',
  ).bind(row.user_id).all();
  const site = (results || []).find((w) =>
    (namePart && w.name === namePart)
    || (siteLabel && w.name === siteLabel)
    || (addrPart && w.address === addrPart)
    || (siteLabel && w.address === siteLabel));
  if (!site) return err('Không tìm thấy website này trong danh sách đã lưu của nhân viên.', 404);
  if (!site.admin_pass_enc) {
    return err('Website này chưa lưu mật khẩu admin — Luna trả nội dung để nhân viên tự đăng.', 404);
  }
  let adminPass;
  try {
    adminPass = await decryptAdminPass(context.env, site.admin_pass_enc);
  } catch (e) {
    if (e instanceof CredentialError) return err('Không giải mã được mật khẩu đã lưu: ' + e.message, 500);
    return err('Không giải mã được mật khẩu đã lưu.', 500);
  }
  return json({
    ok: true,
    website: site.name,
    admin_url: site.admin_url || '',
    admin_user: site.admin_user || '',
    admin_pass: adminPass,
  });
}
