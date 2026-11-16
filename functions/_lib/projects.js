// Dự án seed + lịch đăng bài — Thống kê theo dự án (Yêu cầu 31).
// Lịch lấy từ bộ nhớ/Muse của anh Dy (lịch thật của 4 web, KHÔNG bịa thêm).
// Cấu trúc mở: thêm dự án sau (v2) chỉ cần thêm 1 mục vào PROJECTS —
// code tính toán (gom nhiệm vụ, tính bài theo lịch) KHÔNG khóa cứng tên nào.
//
// Quy ước tuần: ISO week, chuỗi 'YYYY-Www' (vd '2026-W47'), tuần bắt đầu
// thứ Hai. Mọi tính toán tuần dùng giờ Việt Nam (+7).
export const PROJECTS = [
  {
    slug: 'bluemax',
    name: 'BlueMax E10',
    domain: 'bluemax.vn',
    kind: 'article',
    // Lịch thật: bài web T2-T4-T6 ~07:54, kết thúc 27/11/2026.
    days: [1, 3, 5], // getDay(): 1=T2, 3=T4, 5=T6
    time: '07:54',
    endDate: '2026-11-27',
  },
  {
    slug: 'binhminh',
    name: 'Bình Minh Panel',
    domain: 'cachnhietbinhminh.com',
    kind: 'article',
    // Lịch thật: bài web T2-T6 ~08:54, 5 bài/tuần, kết thúc 27/11/2026.
    days: [1, 2, 3, 4, 5],
    time: '08:54',
    endDate: '2026-11-27',
  },
  {
    slug: 'khanhnghi',
    name: 'Khánh Nghi Audio',
    domain: 'khanhnghi.com',
    kind: 'article',
    // Lịch thật: bài Tin tức T3+T7 ~09:54 (đăng thẳng, không cần duyệt).
    days: [2, 6],
    time: '09:54',
    endDate: null,
  },
  {
    slug: 'inox',
    name: 'Inox Bảo Khang',
    domain: 'inoxbaokhang.vn',
    kind: 'article',
    // Lịch thật: bài Tin tức T3+T6 ~10:54 (đăng hiển thị luôn).
    days: [2, 5],
    time: '10:54',
    endDate: null,
  },
];

export const PROJECT_SLUGS = PROJECTS.map((p) => p.slug);
export const STAT_KINDS = ['article', 'page', 'web'];
export const TASK_STATUS_KEYS = ['running', 'completed', 'waiting', 'scheduled', 'error', 'luna', 'review'];
export const UNASSIGNED = 'unassigned';

export function projectBySlug(slug) {
  return PROJECTS.find((p) => p.slug === slug) || null;
}

export function isValidProjectSlug(slug) {
  return PROJECT_SLUGS.indexOf(slug) !== -1;
}

export function isValidKind(kind) {
  return STAT_KINDS.indexOf(kind) !== -1;
}

// '2026-W47' — đúng 1 tuần ISO (W01..W53).
export function isValidPeriod(period) {
  return /^20\d\d-W(0[1-9]|[1-4][0-9]|5[0-3])$/.test(String(period || ''));
}

// Bỏ dấu tiếng Việt + thường hoá để so khớp tên dự án/site trong payload.
export function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

// Đoán dự án của một nhiệm vụ từ text gộp (title + lines + customer + meta).
// Khớp tên hoặc domain (không dấu). Không khớp → 'unassigned' (gom riêng,
// KHÔNG bỏ mất — nhiệm vụ vẫn được đếm ở "Chưa gắn dự án").
export function matchProjectSlug(text) {
  const t = ' ' + normText(text) + ' ';
  for (const p of PROJECTS) {
    if (t.indexOf(' ' + normText(p.domain) + ' ') !== -1) return p.slug;
    if (t.indexOf(' ' + normText(p.name) + ' ') !== -1) return p.slug;
  }
  return UNASSIGNED;
}

// ---------- Tuần ISO (giờ Việt Nam) ----------
// Trả khóa 'YYYY-Www' cho 1 Date (mốc UTC — gọi với Date đã cộng +7h).
export function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // 1=T2..7=CN
  date.setUTCDate(date.getUTCDate() + 4 - day); // thứ Năm của tuần ISO
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

// Khóa tuần ISO hiện tại (giờ Việt Nam).
export function currentWeekKey(now = new Date()) {
  return isoWeekKey(new Date(now.getTime() + 7 * 60 * 60 * 1000));
}

// Ngày thứ Hai (YYYY-MM-DD) của 1 tuần ISO.
export function weekMonday(period) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(period || ''));
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  // Thứ Hai tuần 1 = thứ Hai của tuần chứa 4/1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

// Số ngày trong tuần ISO (vd '16–22/11/2026') — phục vụ nhãn ô chọn tuần.
export function weekLabel(period) {
  const monday = weekMonday(period);
  if (!monday) return period;
  const d0 = new Date(monday + 'T00:00:00Z');
  const d1 = new Date(d0);
  d1.setUTCDate(d0.getUTCDate() + 6);
  const fmt = (d) => d.getUTCDate() + '/' + (d.getUTCMonth() + 1);
  const y = d1.getUTCFullYear();
  return `Tuần ${period.slice(5)} (${fmt(d0)}–${fmt(d1)}/${y})`;
}

// Số bài theo lịch của 1 dự án trong 1 tuần ISO: đếm ngày hẹn trong tuần,
// bỏ ngày sau endDate (lịch kết thúc, vd BlueMax/Bình Minh hết 27/11/2026).
export function scheduledInWeek(project, period) {
  const monday = weekMonday(period);
  if (!monday) return 0;
  const d0 = new Date(monday + 'T00:00:00Z');
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(d0);
    d.setUTCDate(d0.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (project.endDate && iso > project.endDate) continue;
    if (project.days.indexOf(d.getUTCDay()) !== -1) n++;
  }
  return n;
}

// Danh sách dự án gửi về client (chỉ trường hiển thị + lịch, không secret).
export function publicProjects() {
  return PROJECTS.map((p) => ({
    slug: p.slug,
    name: p.name,
    domain: p.domain,
    kind: p.kind,
    days: p.days,
    time: p.time,
    endDate: p.endDate,
  }));
}
