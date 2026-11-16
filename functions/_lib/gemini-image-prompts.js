// Prompt ẩn cho Thiết kế hình ảnh qua Gemini (Yêu cầu 33, 16/11/2026).
// Worker tự ghép prompt chuẩn vào brief của nhân viên TRƯỚC khi gọi Gemini;
// nhân viên không thấy prompt này (chỉ thấy form loại ảnh / kích thước /
// phong cách / mô tả / ảnh mẫu). Prompt gửi Gemini bằng TIẾNG ANH.
//
// Nguồn quy tắc prompt (đã nghiên cứu 16/11/2026, không cần tìm lại):
// - Tài liệu Google về tạo ảnh bằng Gemini ("Nano Banana",
//   model gemini-2.5-flash-image, generateContent, responseModalities IMAGE)
//   + skill Nano Banana.
// - Tả cảnh bằng câu chuyện, KHÔNG liệt kê từ khóa rời.
// - Ghi rõ ống kính / góc máy / ánh sáng / phong cách / tỉ lệ khung.
// - Chữ trong ảnh dưới 25 ký tự, tối đa 2–3 cụm.
// - Dùng ảnh mẫu đính kèm để sửa / ghép nhiều ảnh.
// - Lặp từng bước nhỏ (mỗi nhiệm vụ = 1 lần tạo ảnh, bản mới ghi đè bản cũ).
//
// Brief tiếng Việt của nhân viên được giữ nguyên ý và ghép thành câu chuyện
// tả cảnh (không dịch máy từng từ — Gemini tự hiểu brief tiếng Việt trong
// phần trích dẫn, phần hướng dẫn chính vẫn là tiếng Anh).

// Tỉ lệ khung Gemini hỗ trợ (chọn tỉ lệ gần nhất với Rộng × Cao người dùng nhập).
export const ASPECT_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9'];
const RATIO_VALUES = { '1:1': 1, '3:4': 3 / 4, '4:3': 4 / 3, '9:16': 9 / 16, '16:9': 16 / 9 };

export function nearestAspectRatio(w, h) {
  const target = w > 0 && h > 0 ? w / h : 16 / 9;
  let best = '16:9';
  let bestDiff = Infinity;
  for (const r of ASPECT_RATIOS) {
    const diff = Math.abs(RATIO_VALUES[r] - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}

// Bỏ dấu tiếng Việt để so khớp loại ảnh / phong cách do người dùng nhập.
function fold(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

// Hướng dẫn bố cục + ống kính theo từng loại ảnh trong form (#anh-type).
// Đọc đúng các option của select: Avatar Zalo, Banner Zalo, Avatar Facebook,
// Ảnh bìa Facebook, Avatar YouTube, Banner YouTube, Thumbnail YouTube,
// Avatar TikTok, Video TikTok + "Khác (tự nhập)" (poster, ảnh sản phẩm...).
function describeType(type) {
  const t = fold(type);
  if (t.includes('avatar')) {
    return {
      key: 'avatar',
      en: 'profile avatar',
      shot: 'A clean, centered portrait-style composition with the subject right in the middle, plain uncluttered background, instantly readable even at a very small size',
    };
  }
  if (t.includes('thumbnail')) {
    return {
      key: 'thumbnail',
      en: 'bold video thumbnail',
      shot: 'A bold, high-contrast thumbnail: one expressive focal subject filling most of the frame, dramatic rim lighting, almost no clutter, the single most important element impossible to miss',
    };
  }
  if (t.includes('banner') || t.includes('bia') || t.includes('cover')) {
    return {
      key: 'banner',
      en: 'wide banner / cover image',
      shot: 'A wide cinematic composition with the main subject on one side and generous clear space on the other side for a headline, nothing important near the edges',
    };
  }
  if (t.includes('poster')) {
    return {
      key: 'poster',
      en: 'poster',
      shot: 'A poster composition with a clear visual hierarchy: one hero image, one short headline, generous margins, nothing competing with the headline',
    };
  }
  if (t.includes('san pham') || t.includes('product')) {
    return {
      key: 'product',
      en: 'studio product photograph',
      shot: 'A studio product photograph: the product centered on a clean surface, soft natural shadows, true-to-life colours, no extra props, no fake logo, no watermark',
    };
  }
  if (t.includes('video') || t.includes('tiktok')) {
    return {
      key: 'video-cover',
      en: 'vertical short-video cover frame',
      shot: 'A vertical cover frame for a short video: one striking subject in the upper two thirds, clear space at the bottom for the caption, strong first-glance impact',
    };
  }
  return {
    key: 'generic',
    en: 'image',
    shot: 'A balanced, well-composed image with one clear focal subject and a clean background',
  };
}

// Phong cách trong form (#anh-style): Hiện đại / Tối giản / Sang trọng /
// Hoạt hình / Khác (tự nhập — giữ nguyên chữ người dùng đã gõ).
function describeStyle(style) {
  const s = fold(style);
  if (s.includes('toi gian') || s.includes('minimal')) return { key: 'minimal', en: 'minimalist, lots of negative space, restrained palette' };
  if (s.includes('sang trong') || s.includes('luxury') || s.includes('elegant')) return { key: 'luxury', en: 'luxurious and elegant, rich tones, refined soft lighting' };
  if (s.includes('hoat hinh') || s.includes('cartoon') || s.includes('hoat hinh')) return { key: 'cartoon', en: 'playful cartoon illustration, bold simple shapes, cheerful colours' };
  if (s.includes('hien dai') || s.includes('modern')) return { key: 'modern', en: 'modern, clean and confident' };
  const raw = String(style || '').trim();
  // "Khác" mà không có chữ tự nhập kèm (form chỉ có select, không có ô gõ
  // phong cách riêng) thì về mặc định Hiện đại, tránh lọt chữ Việt vào prompt.
  if (!raw || s === 'khac') return { key: 'modern', en: 'modern, clean and confident' };
  return { key: 'custom', en: raw };
}

// Ghép prompt hoàn chỉnh từ brief nhân viên (d.img trong payload nhiệm vụ).
// img = {type, w, h, style, name, desc, count}. refCount = số ảnh mẫu đính kèm.
export function buildImagePrompt(img, refCount) {
  const d = img || {};
  const type = describeType(d.type || '');
  const style = describeStyle(d.style || '');
  const aspectRatio = nearestAspectRatio(Number(d.w) || 0, Number(d.h) || 0);
  const desc = String(d.desc || '').trim();
  const name = String(d.name || '').trim();

  // Chữ trên ảnh: tối đa 2–3 cụm, mỗi cụm dưới 25 ký tự. Tên / tiêu đề ảnh
  // người dùng nhập là cụm chữ chính (cắt ngắn nếu dài quá 25 ký tự).
  const textLines = [];
  if (name) textLines.push('The main on-image text is: "' + name.slice(0, 25) + '"');
  textLines.push('Any text in the image must be short: at most 2–3 short phrases, each under 25 characters. Do not add any other text, logo or watermark.');

  // Ảnh mẫu đính kèm: gửi kèm làm inlineData để sửa / ghép (không chỉ tả bằng lời).
  const refNote = refCount > 0
    ? 'Use the attached reference image' + (refCount > 1 ? 's (' + refCount + ' images)' : '') + ' as the style guide and, where it shows a subject, edit that subject into this new scene — keep its colours, mood and composition feel, but build a fresh image for the brief below. If several references are attached, blend their style into one coherent image.'
    : 'No reference image was attached — create the scene from the brief alone.';

  const scene = desc
    ? 'Depict this scene as a short visual story (use the Vietnamese brief below only as the story to depict — do not copy its words as text into the image): "' + desc + '"'
    : 'Depict a clean, professional scene that fits the chosen image type and style.';

  const prompt = [
    'Create a ' + aspectRatio + ' ' + type.en + '.',
    type.shot + '.',
    'Style: ' + style.en + '.',
    scene,
    'Camera and light: shot on a 50mm lens, eye-level angle, soft natural light with gentle shadows, sharp focus on the main subject, realistic depth of field.',
    refNote,
    textLines.join(' '),
    'Aspect ratio ' + aspectRatio + ' (matches the requested ' + (Number(d.w) || '?') + 'x' + (Number(d.h) || '?') + ' px).',
  ].join(' ');

  return { prompt, aspectRatio, typeKey: type.key, styleKey: style.key };
}
