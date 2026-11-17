// Mã hóa mật khẩu admin của website khách (Yêu cầu 38, 17/11/2026).
// AES-256-GCM qua WebCrypto; khóa từ secret CRED_ENCRYPTION_KEY (base64, 32 byte).
// Chỉ mã hóa admin_pass (tên đăng nhập lưu thường). Khóa KHÔNG có trong repo —
// anh tự tạo bằng `openssl rand -base64 32` rồi dán vào Cloudflare (secret).
// Thiếu khóa hoặc khóa sai → API trả lỗi rõ, KHÔNG BAO GIỜ lưu mật khẩu dạng thường.
// Giá trị lưu trong D1: base64(iv 12 byte || ciphertext + tag GCM 16 byte).
// TUYỆT ĐỐI không ghi giá trị mật khẩu hay khóa vào log.
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class CredentialError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Khóa import 1 lần / isolate (đổi secret thì import lại theo giá trị mới).
let cachedKey = null;
let cachedRaw = '';

async function getKey(env) {
  const raw = String(env.CRED_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw new CredentialError(
      'KEY_MISSING',
      'Chưa cấu hình CRED_ENCRYPTION_KEY trên Cloudflare — không lưu được mật khẩu admin. Anh thêm secret này (tạo bằng `openssl rand -base64 32`) rồi thử lại.',
    );
  }
  if (raw === cachedRaw && cachedKey) return cachedKey;
  let bytes;
  try {
    bytes = unb64(raw);
  } catch {
    throw new CredentialError('KEY_INVALID', 'CRED_ENCRYPTION_KEY không phải base64 hợp lệ — kiểm tra lại secret trên Cloudflare.');
  }
  if (bytes.length !== 32) {
    throw new CredentialError('KEY_INVALID', 'CRED_ENCRYPTION_KEY phải là 32 byte (base64 của `openssl rand -base64 32`).');
  }
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  cachedRaw = raw;
  cachedKey = key;
  return key;
}

export async function encryptAdminPass(env, plaintext) {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return b64(out);
}

export async function decryptAdminPass(env, enc) {
  const key = await getKey(env);
  let bytes;
  try {
    bytes = unb64(String(enc || ''));
  } catch {
    throw new CredentialError('DECRYPT_FAILED', 'Mật khẩu đã lưu không giải mã được.');
  }
  if (bytes.length <= 12) {
    throw new CredentialError('DECRYPT_FAILED', 'Mật khẩu đã lưu không giải mã được.');
  }
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    throw new CredentialError('DECRYPT_FAILED', 'Mật khẩu đã lưu không giải mã được (sai khóa mã hóa?).');
  }
}
