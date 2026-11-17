# Yêu cầu 38 — Tối ưu Chăm sóc web/page: mặc định giao Thư Ký Mỹ Linh + lưu tài khoản admin mã hóa để Luna đăng bài hộ
Ngày: 17/11/2026. Anh Dy chốt 09:20 17/11 ("ok em").

## Vấn đề
1. Nhiệm vụ Chăm sóc web/page tạo mới không viết bài: cầu nối Telegram chỉ chạy khi ô
   "AI phụ trách" chọn "Thư Ký Mỹ Linh", nhưng mặc định web/page là Gemini nên
   nhiệm vụ chỉ chạy tiến độ giả, không viết, không gửi Telegram. (Backend viết bài
   bằng Gemini chưa từng được nối; chỉ Thiết kế hình ảnh có AI thật qua Pollinations.)
2. Form "Thêm website mới" bắt nhập Link admin / ID / Pass nhưng nút Lưu không đọc,
   không lưu, không gửi 3 ô đó đi đâu — bấm Lưu xong là mất. Vì vậy nhân viên nhận
   bài xong vẫn phải tự đăng lên web khách, app mất giá trị.
3. Tài khoản admin web khách hiện không có đường nào tới Luna một cách an toàn,
   nên Luna không thể đăng bài hộ nhân viên (kind 'posted' chỉ dùng cho dự án của anh).

## Thay đổi
1. **Mặc định AI web/page → Thư Ký Mỹ Linh**: `config/config.json`
   (cham-soc-web, cham-soc-page: `ai_primary` "gemini" → "mylinh") +
   `index.html` (`FEATURE_AI`, `APP_CONFIG`, option `selected` trong 2 select,
   tên/trạng thái/ghi chú hiển thị mặc định theo chế độ trực tiếp). Nhân viên vẫn
   đổi lại sang Gemini được nếu muốn; chọn Gemini thì nhiệm vụ chạy mô phỏng như cũ.
2. **Bảng `websites` (migration 006, chạy trên D1 live TRƯỚC khi deploy code mới)**:
   `id, user_id REFERENCES users(id) ON DELETE CASCADE, name, address, admin_url,
   admin_user, admin_pass_enc, created_at, updated_at`, `UNIQUE(user_id, name)`.
   Thêm cùng bảng vào `schema.sql` (cho setup mới). File migration KHÔNG có
   PRAGMA/BEGIN/COMMIT (D1 Console từ chối BEGIN).
3. **Mã hóa (`functions/_lib/credentials.js`)**: AES-256-GCM qua WebCrypto,
   khóa từ secret `CRED_ENCRYPTION_KEY` (base64, 32 byte, anh tự tạo bằng
   `openssl rand -base64 32` rồi dán vào Cloudflare). Chỉ mã hóa `admin_pass`
   (tên đăng nhập lưu thường). Thiếu khóa → API trả lỗi rõ, không lưu mật khẩu
   dạng thường bao giờ.
4. **API websites**: `GET /api/websites` (chỉ website của mình; admin thấy tất cả;
   KHÔNG trả mật khẩu, chỉ trả `has_creds`), `POST /api/websites`
   `{name, address?, admin_url?, admin_user?, admin_pass?}` (mã hóa pass rồi lưu),
   `GET/DELETE /api/websites/:id` (chủ sở hữu hoặc admin).
5. **Endpoint Luna**: `GET /api/luna/tasks/:id/credentials` (xác thực bằng header
   `X-Luna-Secret` như `/api/luna/delivery`). Tra nhiệm vụ → chủ nhiệm vụ →
   `payload.lines.Website` → dòng websites tương ứng → giải mã `admin_pass` →
   trả `{website, admin_url, admin_user, admin_pass}`. 404 khi không có website
   hoặc không có mật khẩu đã lưu. Không ghi giá trị vào log, không đưa vào brief
   Telegram bao giờ.
6. **Frontend (`index.html`)**: nút Lưu dự án mới — sau khi thêm option vào danh
   sách, nếu có nhập admin thì `POST /api/websites` (lỗi thì toast rõ, website
   vẫn thêm local, mật khẩu chưa lưu). Lúc mở app: `GET /api/websites` rồi thêm
   option vào select dự án web/page (bỏ trùng). Sửa dòng ghi chú dưới 3 ô admin
   thành: "Mật khẩu được mã hóa trước khi lưu trên server, chỉ Thư Ký Mỹ Linh
   dùng để đăng bài hộ — không hiện lại trong giao diện."
7. **Cầu nối Luna (`tools/luna-bridge.py`)**: thêm lệnh `creds <task-id>` — gọi
   endpoint trên, in credential ra stdout (chỉ để Luna dùng lúc làm việc, không
   gửi Telegram, không ghi log). Cập nhật docstring.
8. **Luồng mới**: nhân viên giao việc (mặc định Mỹ Linh) → brief sang Telegram →
   Luna viết bài → lấy credential qua endpoint Luna → tự đăng lên web khách →
   trả `kind: 'posted'` + link (như dự án của anh) → chờ anh duyệt → 'completed'.
   Không có credential thì Luna trả `kind: 'content'` như cũ.

## Bảo mật
- Mật khẩu admin chỉ tồn tại dạng mã hóa trong D1; khóa mã hóa chỉ nằm trên
  Cloudflare (secret), không có trong repo, không có trong brief Telegram.
- Nhân viên chỉ thấy website của mình; admin thấy tất cả. Xóa website khi nhân
  viên nghỉ / đổi mật khẩu web khách.
- Phạm vi: web Nasani trước (đa số khách); CMS khác tính sau khi gặp.

## Kiểm chứng trước khi giao
- `node --check` (qua bản sao .mjs) cho mọi file JS mới/sửa; rà SQL migration.
- Sau push: chạy migration 006 trên D1 live, thêm secret `CRED_ENCRYPTION_KEY`,
  redeploy, rồi test 1 nhiệm vụ web thật từ tạo → brief → Luna đăng → duyệt.

## Bổ sung 09:27 17/11/2026 — Chăm sóc page CHỈ ADMIN dùng (anh Dy chốt)
- Nhân viên KHÔNG được thấy tính năng Chăm sóc page. Lý do: Luna chỉ viết/đăng
  được trên page của anh (qua facebook-cli), không đăng được lên page của nhân viên.
- Frontend: ẩn hoàn toàn với tài khoản không phải admin — không hiện trong
  menu/sidebar, tabbar mobile, dòng "Tiến độ theo tính năng" trên Dashboard,
  nút tính năng ở Bảng tín hiệu (dùng đúng mẫu `data-admin-only` sẵn có);
  không vào được màn hình tính năng (`go("page")` chặn về Dashboard + toast).
- Backend: chặn nhân viên tạo/dùng nhiệm vụ page ở phía server — endpoint tạo
  nhiệm vụ và các endpoint liên quan page trả 403 cho tài khoản không phải admin
  khi feature là page. Không chỉ ẩn ở giao diện.
- Chăm sóc web vẫn giữ nguyên cho nhân viên (luồng YC38 trên). Đổi mặc định AI
  của cham-soc-page sang Mỹ Linh vẫn làm như spec (admin dùng).
- Hệ quả: dòng `kind: 'content'` cho page nhân viên ở YC30 không còn áp dụng —
  page nhân viên không tồn tại nữa; mọi nhiệm vụ page đều là page của anh và
  Luna đăng được (`kind: 'posted'`).

## Trạng thái (cập nhật khi làm xong)
- [ ] Code local + QA (đang làm) — commit local khi xong.
- [ ] CHƯA PUSH — cần anh tạo PAT tạm trên Chrome (Luna push rồi thu hồi ngay).
- [ ] Sau push, anh làm 3 việc: chạy migration 006 trên D1 console, tự tạo key
  bằng `openssl rand -base64 32` rồi dán vào Cloudflare làm secret
  `CRED_ENCRYPTION_KEY`, redeploy — rồi test 1 nhiệm vụ web thật từ tạo →
  brief → Luna lấy credential → đăng → duyệt.

---

# Yêu cầu 39 — Đấu nối Google Search Console (GSC) vào app theo từng dự án
Ngày: 17/11/2026. Anh Dy giao 13:01 17/11 ("đấu nối toàn bộ các GSC vào app theo từng dự án"). CHỈ khảo sát + viết spec — chưa triển khai, chưa sửa code, chưa tạo secret, chưa đổi gì trên live.

Tài liệu Google tra cứu 17/11/2026 (developers.google.com):
- API Reference: `developers.google.com/webmaster-tools/v1/api_reference_index` — 4 dịch vụ: Search Analytics, Sitemaps, Sites, URL Inspection.
- Usage Limits: `developers.google.com/webmaster-tools/limits` (cập nhật 2025-08-28).
- OAuth 2.0 tổng quan: `developers.google.com/identity/protocols/oauth2`; server-to-server: `developers.google.com/identity/protocols/oauth2/service-account`.
- URL Inspection API: `developers.google.com/search/blog/2022/01/url-inspection-api`.

## Mục tiêu
1. App tự lấy số liệu hiệu quả tìm kiếm của từng dự án (click, hiển thị, CTR, vị trí trung bình 28 ngày) và trạng thái index của bài mới, hiển thị trong khối "Thống kê theo dự án" trên Dashboard (YC31) — không phải mở Search Console tay từng web nữa.
2. Kiểm tra index tự động cho bài mới đăng (thay cho việc bấm tay từng URL, hay kẹt xác minh như các lần xin index 16/11).
3. 6 dự án: BlueMax, Bình Minh, Trần Vũ, Khánh Nghi, Nhất Linh, Bảo Khang.

## Map dự án → slug trong app → domain → GSC property
| Dự án | Slug trong app | Domain | GSC property (ghi khi triển khai) | Seed YC31? |
|---|---|---|---|---|
| BlueMax E10 | `bluemax` | bluemax.vn | | Có |
| Bình Minh Panel | `binhminh` | cachnhietbinhminh.com | | Có |
| Trần Vũ Furniture | `tranvu` (mới) | noithattranvu.com | | CHƯA — thêm mới |
| Khánh Nghi Audio | `khanhnghi` | khanhnghi.com | | Có |
| Nhất Linh Detailing | `nhatlinh` (mới) | nhatlinhdetailing.com | | CHƯA — thêm mới |
| Inox Bảo Khang | `inox` (giữ nguyên) | inoxbaokhang.vn | | Có (slug `inox` = Bảo Khang) |

- GSC property của mỗi web có 2 loại: URL-prefix (`https://bluemax.vn/`) hoặc Domain (`sc-domain:bluemax.vn`). Khi triển khai, ghi đúng identifier của từng property vào bảng `gsc_properties` (xem dưới); gọi sai identifier thì API trả rỗng hoặc 404. Nếu chưa rõ loại nào thì lấy từ `sites.list`.
- Thêm `tranvu` + `nhatlinh` vào `PROJECTS` trong `functions/_lib/projects.js` (mở rộng seed, không sửa 4 mục cũ). Hai dự án này không có lịch đăng bài cố định qua app → để `days: []`, `time: null`, `endDate: null` (số bài theo lịch = 0, chỉ hiện số liệu GSC); `matchProjectSlug` sẽ tự đoán dự án từ tên/domain trong nhiệm vụ như 4 dự án cũ.
- `config/config.json` đã có sẵn mục `ais.gsc` (key_status `not_started`, "Chưa nối", vai trò "Kiểm tra index, hiệu quả SEO") và `cham-soc-web.ai_backup` đã là `"gsc"` — triển khai xong thì cập nhật `key_status` → `connected` ở đó.

## GSC API làm được gì — và KHÔNG làm được gì
Làm được (miễn phí, API chính thức của Google):
- `searchAnalytics.query` (`POST /sites/{siteUrl}/searchAnalytics/query`, host `www.googleapis.com/webmasters/v3`): click, hiển thị, CTR, vị trí TB theo ngày / trang / từ khóa / thiết bị / quốc gia. Dữ liệu 16 tháng gần nhất; tối đa 25.000 dòng/request (mặc định 1.000); tối đa 50.000 dòng/ngày/search type/property.
- `urlInspection.index.inspect` (`POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`): trạng thái index của 1 URL, canonical Google chọn, lần crawl cuối, lỗi coverage, rich results.
- `sitemaps.list/get/submit/delete`: xem, nộp, xóa sitemap.
- `sites.list/add/get/delete`: danh sách property tài khoản có quyền.
KHÔNG làm được (ghi rõ để khỏi kỳ vọng sai):
- **Không có endpoint xin index.** Nút "Request indexing" trên giao diện KHÔNG có API tương đương; `index.inspect` chỉ đọc trạng thái bản đã index, không test live URL. Muốn xin index vẫn phải bấm tay trên giao diện (đúng bước hay kẹt xác minh). API Indexing riêng của Google chỉ nhận trang JobPosting/BroadcastEvent — web của mình không thuộc diện đó.
- Không có báo cáo Page indexing, Links, Core Web Vitals, không có dữ liệu backlink.
- Dữ liệu trễ 2–3 ngày, ngày tính theo giờ Pacific (không phải giờ VN); từ khóa hiếm bị Google ẩn vì riêng tư nên tổng theo từ khóa luôn nhỏ hơn tổng toàn property.
- Chỉ đọc được property mà tài khoản/service account đã được cấp quyền — chưa cấp quyền thì 403.

## So sánh 2 phương án xác thực (chưa chọn — chờ anh Dy chốt)
Google bắt buộc OAuth 2.0 cho Search Console API; không có đường API key. Hai scope: `https://www.googleapis.com/auth/webmasters.readonly` (chỉ đọc — đủ cho YC39) và `https://www.googleapis.com/auth/webmasters` (đọc + ghi — chỉ cần nếu muốn nộp sitemap qua API). **Luôn xin scope readonly trước; chỉ xin scope ghi khi anh chốt thêm nộp sitemap.**

### Phương án A — OAuth 2.0 web-server (anh đăng nhập Google một lần)
- Cách làm: tạo OAuth Client ID loại "Web application" trong Google Cloud → redirect URI `https://ung-dung-dieu-khien-ai.pages.dev/api/gsc/oauth/callback` → admin bấm "Kết nối Google" trong app → đăng nhập tài khoản Google của anh → cấp quyền `webmasters.readonly` → app đổi code lấy access token + refresh token, lưu refresh token đã mã hóa vào D1; access token hết hạn sau ~1 giờ thì tự refresh.
- Ưu: dùng đúng tài khoản Google của anh (đã có quyền trên các property), không cần thêm tài khoản lạ vào property khách; đổi tài khoản chỉ cần nối lại; không cần tạo service account.
- Nhược: **bẫy lớn nhất — OAuth consent screen ở chế độ Testing thì refresh token hết hạn sau 7 ngày** (job đồng bộ chết lặng sau 1 tuần). Phải đưa consent screen sang Production (đăng app) thì refresh token mới sống lâu; scope `webmasters.readonly` là scope nhạy cảm nên màn hình đồng ý sẽ hiện cảnh báo app chưa xác minh (vẫn dùng được cho tài khoản của anh; xác minh Google chỉ cần nếu muốn gỡ cảnh báo). Nếu 6 property nằm ở nhiều tài khoản Google khác nhau thì phải nối từng tài khoản (1 refresh token / tài khoản).
- Cần secret trên Cloudflare: `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`.

### Phương án B — Service account (tài khoản kỹ thuật của app)
- Cách làm: tạo service account trong Google Cloud, bật Search Console API → lấy email dạng `...@....iam.gserviceaccount.com` + private key → **thêm email đó làm user vào từng property trong Search Console (Settings → Users and permissions; chỉ owner của property mới thêm được; không có bước bulk, làm tay 6 lần)** → app tự ký JWT RS256 bằng private key (WebCrypto, vì Workers không có google-auth-library), đổi lấy access token tại `oauth2.googleapis.com/token`, cache token đến khi hết hạn.
- Ưu: chạy nền hoàn toàn (đồng bộ theo lịch không cần người, không lo refresh token hết hạn); không phụ thuộc tài khoản cá nhân của anh; 1 credential cho cả 6 property.
- Nhược: phải thêm tay email service account vào từng property (6 lần); ai là owner của từng property mới thêm được — property nào anh không phải owner thì phải nhờ owner đó thêm; private key là secret nhạy cảm (lưu làm secret Cloudflare, không vào repo/D1 dạng thường). Lỗi hay gặp nhất: tạo service account xong quên bước thêm user → mọi call 403 nhìn như lỗi auth.
- Cần secret trên Cloudflare: `GSC_SA_EMAIL`, `GSC_SA_PRIVATE_KEY` (PEM; hoặc 1 secret JSON key — để lúc triển khai quyết, nhưng KHÔNG lưu file JSON key trong repo).

### Đề xuất (điều kiện, không chốt thay anh)
- Nếu anh muốn "cắm là chạy nền, không động vào nữa" và anh là owner (hoặc nhờ được owner thêm tay) trên cả 6 property → **phương án B**.
- Nếu anh muốn dùng đúng tài khoản Google hiện có, không thêm tài khoản lạ vào property khách → **phương án A** (nhớ đưa consent screen sang Production để refresh token không chết sau 7 ngày).
- Triển khai viết code sao cho đổi phương án chỉ cần đổi secret + 1 cờ cấu hình, không sửa lại endpoint/DB (cả hai phương án đều ra access token rồi gọi cùng các endpoint GSC).

## Các bước phía Google (làm 1 lần, trước khi code xong cũng được)
Chung cả 2 phương án: tạo Google Cloud project (dùng project sẵn có của anh hoặc tạo mới) → bật **Search Console API** trong APIs & Services → ghi lại project dùng cho app.
- Phương án A: tạo OAuth Client ID (Web application) → redirect URI như trên → đưa OAuth consent screen sang Production.
- Phương án B: tạo service account → tạo key JSON (giữ file như mật khẩu, không gửi qua chat) → thêm email service account làm user vào từng property (Settings → Users and permissions; quyền Restricted đủ cho đọc, Full chỉ khi cần nộp sitemap).
- Sau đó đối chiếu: tài khoản/service account có thấy đủ 6 property qua `sites.list` không — chưa thấy property nào thì dừng ở đó, không code tiếp.

## Thiết kế backend
- Lib mới `functions/_lib/gsc.js`: gọi Google API bằng `fetch` (host `www.googleapis.com/webmasters/v3` cho Search Analytics/Sitemaps/Sites; `searchconsole.googleapis.com/v1` cho URL Inspection); lấy access token theo phương án đã chọn; map lỗi Google → lỗi rõ cho app (401 → refresh token, 403 → "chưa có quyền trên property này", 429 → quota, ghi rõ số còn lại nếu có); retry 1 lần với backoff khi 429/5xx.
- Token/secret: **tái dùng mã hóa AES-256-GCM của YC38** (`functions/_lib/credentials.js`, khóa `CRED_ENCRYPTION_KEY` đã có trên Cloudflare) — mở rộng lib thêm 2 hàm generic `encryptSecret/decryptSecret` (cùng khóa, cùng định dạng base64 iv+ciphertext) để mã hóa refresh token (phương án A) lưu trong D1. Không tạo khóa mã hóa thứ hai. Access token chỉ giữ trong bộ nhớ lúc gọi, không lưu D1, không ghi log.
- Bảng D1 (migration 007 `007-gsc.sql`, thêm vào `schema.sql`; KHÔNG có PRAGMA/BEGIN/COMMIT như migration 006):
  - `gsc_connections` (id, method `oauth`|`service_account`, account_label, refresh_token_enc NULL, scope, created_at, updated_at) — 1 dòng / tài khoản Google đã nối (phương án A) hoặc 1 dòng service account (phương án B).
  - `gsc_properties` (id, project TEXT UNIQUE, site_url TEXT NOT NULL, connection_id, status `ok`|`no_access`|`not_found`, last_sync_at, last_error, created_at, updated_at) — map slug dự án ↔ GSC property.
  - `gsc_daily` (id, project, date TEXT, clicks, impressions, ctr, position, UNIQUE(project, date)) — số liệu ngày, cache 28 ngày gần nhất (đồng bộ chỉ lấy đến hôm kia vì dữ liệu trễ 2–3 ngày).
  - `gsc_top_queries` (id, project, period TEXT, query, clicks, impressions, ctr, position) — top từ khóa theo kỳ, cap 50 dòng/dự án/kỳ (xóa cũ khi đồng bộ kỳ mới).
  - `gsc_url_status` (id, project, url TEXT, verdict TEXT, coverage_state, last_crawl, canonical, checked_at, UNIQUE(project, url)) — trạng thái index từng URL bài mới; cache 7 ngày, không inspect lại URL đã kiểm trong 24h.
  - `gsc_sync_log` (id, project, started_at, finished_at, status, error, rows_synced).
- Endpoints (Pages Functions, theo mẫu `functions/api/` hiện có; admin-only, trừ khi ghi khác):
  - `GET /api/gsc/status` — trạng thái nối của từng dự án (đã nối/chưa, lần đồng bộ cuối, lỗi cuối).
  - `POST /api/gsc/sync` (body `{project?}`) — đồng bộ 1 dự án hoặc tất cả: 28 ngày Search Analytics (3 query: tổng theo ngày; top trang; top từ khóa) + inspect URL bài mới (lấy URL từ `project_stats.details.articles` hoặc nhiệm vụ `completed` gần nhất). Cooldown 15 phút/dự án (trả 429 rõ nếu bấm liên tục).
  - `GET /api/gsc/summary?project=&period=` — số liệu đã cache trong D1 cho Dashboard (không gọi Google trực tiếp khi mở trang).
  - `POST /api/gsc/properties` — admin map project ↔ site_url (ghi vào `gsc_properties`).
  - OAuth (chỉ phương án A): `GET /api/gsc/oauth/start` (tạo state chống CSRF, redirect sang Google) + `GET /api/gsc/oauth/callback` (đổi code lấy token, mã hóa refresh token rồi lưu; state sai → từ chối).
  - Tùy chọn v2: `GET /api/luna/gsc/summary` (header `X-Luna-Secret`) để Luna/cron lấy số liệu; đồng bộ theo lịch bằng cron của Luna gọi `POST /api/gsc/sync` (Pages Functions **không có Cron Trigger** — không đặt lịch trong Cloudflare Pages được; 2 đường: cron Luna đã có sẵn, hoặc Worker cron riêng sau này).
- Nối với YC31: kết quả URL Inspection cập nhật trường `indexed` trong `project_stats.details.articles` (bài nào đã index thì cột Index trên Dashboard chuyển xanh mà không cần bấm tay kiểm tra nữa).

## Thiết kế frontend
- Mở rộng khối "Thống kê theo dự án" trên Dashboard (`#projectStatsBlock`, đã admin-only) — **không làm màn riêng ở v1** (hỏi lại anh ở mục Câu hỏi nếu anh muốn màn riêng):
  - Hàng số liệu GSC 28 ngày theo dự án đang chọn: Click / Hiển thị / CTR / Vị trí TB (lấy từ `gsc_daily` qua `GET /api/gsc/summary`); ghi rõ "Số liệu Google Search Console, cập nhật lần cuối …" (dữ liệu trễ 2–3 ngày).
  - Bảng bài viết hiện có thêm cột trạng thái Index từ GSC (Đã index / Chưa index / Lỗi / Chưa kiểm) — dữ liệu từ `gsc_url_status`.
  - Nút "Đồng bộ GSC" (admin) + dòng trạng thái (đang đồng bộ / xong lúc … / lỗi …).
  - Màn "Kết nối Google" (admin, trong mục cài đặt/quản lý tài khoản): hiện trạng thái nối từng dự án (đã nối/chưa, tài khoản nào), nút nối/ngắt; lỗi 403 hiện rõ "Tài khoản này chưa có quyền trên property — thêm quyền trong Search Console rồi đồng bộ lại".
- Quyền xem: **chỉ admin** (như khối thống kê hiện tại) — nhân viên không thấy số liệu GSC (dữ liệu của khách). Nếu anh muốn nhân viên xem số liệu dự án của mình thì làm v2 (hỏi ở mục Câu hỏi).
- `config/config.json`: `ais.gsc.key_status` `not_started` → `connected` khi nối xong; `cham-soc-web.ai_backup` đã là `"gsc"` từ trước (flow "Kiểm tra qua GSC API / PageSpeed") — YC39 làm phần GSC trong flow đó thành thật.

## Quotas và cách tránh vượt quota
Số liệu chính thức (developers.google.com/webmaster-tools/limits, 2025-08-28):
- Search Analytics: 1.200 QPM/site, 1.200 QPM/user, 30.000.000 QPD + 40.000 QPM/project; thêm **load quota** (10 phút ngắn hạn + 1 ngày dài hạn) — query càng đắt khi group/filter theo cả page VÀ query, và khi khoảng ngày càng dài.
- URL Inspection: 2.000 QPD + 600 QPM/site; 10.000.000 QPD + 15.000 QPM/project.
- Các resource khác: 20 QPS + 200 QPM/user; 100.000.000 QPD/project.
- Cách tránh vượt (bắt buộc trong code, không trông chờ vào may mắn):
  - Đồng bộ mỗi dự án tối đa 1 lần/ngày (on-demand + cooldown 15 phút); mỗi lần đồng bộ chỉ 3 query Search Analytics/dự án (tổng theo ngày 28 ngày; top trang; top từ khóa) — 6 dự án = 18 query/ngày, không đáng kể so với quota.
  - URL Inspection chỉ kiểm URL bài mới/chưa có verdict, tối đa 100 URL/ngày/dự án, cache verdict 7 ngày, không inspect lại trong 24h; hết quota ngày thì dừng và báo rõ, đồng bộ tiếp vào hôm sau.
  - Không group/filter đồng thời page + query trong 1 query (đắt load quota nhất); khoảng ngày mỗi query ≤ 28 ngày; không query lại dữ liệu cũ (đọc từ D1).
  - Mọi lỗi quota (429) đều trả về app dòng lỗi rõ + thời gian thử lại, không retry vòng lặp vô hạn.

## Bảo mật
- Refresh token (A) / private key (B) không bao giờ vào repo, không vào brief Telegram, không vào log; refresh token chỉ lưu dạng mã hóa AES-GCM trong D1 (khóa `CRED_ENCRYPTION_KEY` đã có); private key service account chỉ nằm trên Cloudflare secret.
- Chỉ admin được nối/ngắt Google, map property, bấm đồng bộ, xem số liệu GSC. Endpoint GSC kiểm tra role admin ở server (như YC38 đã làm với page), không chỉ ẩn nút ở giao diện.
- Scope xin tối thiểu: `webmasters.readonly` trước; chỉ thêm `webmasters` (ghi) khi anh chốt nộp sitemap qua API.
- Xoá kết nối (ngắt Google) thì xóa refresh token/private key khỏi D1/secret và xóa cache GSC của dự án đó; nhân viên nghỉ không ảnh hưởng (họ không thấy GSC).

## Kiểm chứng trước khi giao (kế hoạch QA)
- Backend mock: `wrangler dev` + D1 local; fixture JSON giả lập response Google (không đốt quota thật): token hết hạn → tự refresh; 403 → trạng thái `no_access` rõ; 429 → backoff + lỗi rõ; sync 1 dự án → đủ 3 bảng `gsc_daily`/`gsc_top_queries`/`gsc_url_status`.
- `node --check` (qua bản sao .mjs) mọi file JS mới/sửa; rà SQL migration 007 (không PRAGMA/BEGIN).
- Frontend Chromium thật 390/768/1440 (luật bàn giao): admin thấy số liệu GSC + nút Đồng bộ; nhân viên không thấy khối GSC; không lỗi console, không tràn ngang.
- Live theo từng bước: nối 1 dự án trước (BlueMax) → đối chiếu số liệu Dashboard với giao diện Search Console (click/hiển thị/CTR/vị trí 28 ngày phải khớp) → kiểm URL Inspection của 2–3 bài mới → rồi mở rộng 5 dự án còn lại. Không nối ồ ạt 6 dự án cùng lúc rồi mới kiểm.
- Sau live: kiểm tra refresh token/service account vẫn sống sau 7 ngày (bẫy hết hạn của phương án A) và sau 30 ngày.

## Câu hỏi còn mở — cần anh Dy trả lời trước khi triển khai
1. **Tài khoản Google nào đang giữ quyền Search Console của từng web?** (BlueMax, Bình Minh, Trần Vũ, Khánh Nghi, Nhất Linh, Bảo Khang — liệt kê theo từng web.) Riêng Bình Minh: hồ sơ GA4/GBP trước đây ở tài khoản nina (báo "Thiếu quyền") — GSC của Bình Minh có nằm ở tài khoản nina không, hay ở tài khoản nguyenduy.nasani@gmail.com của anh? Web nào anh không phải owner?
2. **Chọn phương án xác thực nào: A (OAuth — đăng nhập Google của anh một lần) hay B (service account — thêm email kỹ thuật vào từng property)?** (Spec chưa chọn thay anh; xem bảng so sánh ở trên.)
3. **Xem số liệu ở đâu: trong khối "Thống kê theo dự án" trên Dashboard (đề xuất v1) hay một màn riêng?**
4. **Nhân viên có được xem số liệu GSC không, hay chỉ admin?** (Đề xuất: chỉ admin.)
5. **Đồng bộ bao lâu một lần: mỗi ngày 1 lần tự động, hay chỉ khi admin bấm nút "Đồng bộ GSC"?**
6. **GSC property của mỗi web là loại Domain (`sc-domain:`) hay URL-prefix (`https://...`)?** (Nếu anh chưa rõ thì lúc triển khai tự lấy từ `sites.list`, không cần anh trả lời.)
7. **Có muốn nộp sitemap qua API không?** (Nếu có thì xin thêm scope ghi `webmasters`; nếu không thì chỉ xin scope đọc.)

## Trạng thái
- [x] Spec YC39 xong (17/11/2026).
- [x] Anh trả lời câu 1 + 2 (14:01–14:02 17/11): Search Console cả 6 web đều ở tài khoản Google của anh; CHỐT phương án B (service account).
- [x] ĐÍNH CHÍNH 14:05 17/11: Search Console cả 6 web nằm ở tài khoản **nguyenduyit.nina@gmail.com** — KHÔNG phải nguyenduy.nasani@gmail.com. Cloud project + service account phải tạo dưới tài khoản nina. KẸT 14:03 17/11: Google Cloud chặn truy cập vì tài khoản chưa bật xác minh 2 bước (MFA) — anh cần tự bật 2FA rồi mới làm tiếp phía Google.
- [x] ĐÃ XONG 14:12 17/11 (tài khoản nina): project 'App Dieu Khien AI GSC' (ID app-dieu-khien-ai-gsc), Search Console API đã bật, service account luna-gsc@app-dieu-khien-ai-gsc.iam.gserviceaccount.com (không cấp role, chưa có key). Đổi sang nina thì Cloud Console mở bình thường, không bị chặn MFA như tài khoản nasani.
- [x] PHẦN 2 ĐÃ XONG 14:18 17/11 (tài khoản nina): key JSON đã tạo cho luna-gsc (file app-dieu-khien-ai-gsc-9d79e9c55798.json, chưa dán lên Cloudflare); email SA đã thêm quyền Full vào 5/6 property (bluemax.vn, cachnhietbinhminh.com, noithattranvu.com, khanhnghi.com, inoxbaokhang.vn — đều dạng URL-prefix); RIÊNG nhatlinhdetailing.com CHƯA thêm được vì tài khoản nina không có quyền truy cập property nào của web này (không có trong 16 property của nina) — cần chủ sở hữu property cấp quyền cho nina hoặc xác minh quyền sở hữu cho nina thì mới thêm được.
- [x] Code local + QA XONG 17/11 (commit local, xem dưới) — backend E2E 73/73 PASS (gồm Phase 3 key dạng escape + mock verify chữ ký JWT), unit test normalize 7/7 PASS, control A/B 5/5 PASS, frontend Chromium thật 49/49 PASS. Bổ sung 17/11: `normalizePrivateKeyPem()` chuẩn hoá `GSC_SA_PRIVATE_KEY` dạng escape `"\n"` (paste từ file JSON) thành xuống dòng thật trước khi ký JWT.
- [ ] CHƯA PUSH — cần anh tạo PAT tạm trên Chrome (Luna push rồi thu hồi ngay).
- [ ] Sau push, anh làm nốt phía Google/Cloudflare (tài khoản nina): dán 2 secret `GSC_SA_EMAIL` (= luna-gsc@app-dieu-khien-ai-gsc.iam.gserviceaccount.com) + `GSC_SA_PRIVATE_KEY` (lấy từ file JSON app-dieu-khien-ai-gsc-9d79e9c55798.json — dán NGUYÊN giá trị `private_key` kể cả dạng escape `"\n"`, code đã tự chuẩn hoá) lên Cloudflare → chạy migration 007 trên D1 console → redeploy → nối thử BlueMax (đối chiếu số liệu với giao diện Search Console) → mở rộng 4 dự án còn lại đã có quyền (Bình Minh, Trần Vũ, Khánh Nghi, Bảo Khang). RIÊNG Nhất Linh: xử lý quyền property trước (xem trên) rồi mới nối.
