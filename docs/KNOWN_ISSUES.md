# HUSTALO — Vấn đề đã biết

Ghi nhận hiện tượng, chưa sửa. Mỗi mục cần quyết định (sửa test, sửa code hay cập nhật spec) trước khi đóng.

## KI-01 — `TC-AC-003` chập chờn (M1, chênh lệch thời gian đăng nhập)

- **Test:** `server/src/modules/auth/auth.int.test.ts` › `POST /auth/login (FR-AUTH-002)` › `TC-AC-003 sai mật khẩu / email không tồn tại / LOCKED → 401 cùng message; chênh lệch trung vị < 50 ms`.
- **Hiện tượng:** 2026-11-01 fail 2/3 lần chạy (lần gần nhất `AssertionError: expected 78.95249999999942 to be less than 50`), pass ở lượt chạy toàn bộ sau đó. Máy dev Windows, Docker Desktop vừa khởi động, nhiều tiến trình test chạy song song.
- **Nghi nguyên nhân:** argon2id tốn CPU; khi máy tải nặng, độ lệch trung vị giữa nhánh "user tồn tại" và "dummy hash" vượt ngưỡng dù code chống timing vẫn đúng (`infra/crypto/password.ts`).
- **Ràng buộc:** KHÔNG nới ngưỡng 50 ms khi chưa cập nhật spec (PRD AC-003 / EC-AUTH-*).
- **Hướng xử lý cần duyệt:** tăng số mẫu / bỏ mẫu ngoại lai, hoặc chạy test này tuần tự (không song song với file khác), hoặc sửa spec nêu điều kiện đo.

## KI-02 — `TC-AC-061` chập chờn (M4, grace presence)

- **Test:** `server/src/modules/presence/presence.int.test.ts` › `TC-AC-061 đóng tab rồi mở lại trong grace → không OFFLINE; đóng hẳn → OFFLINE sau grace, lastSeenAt ≈ lúc đóng`.
- **Hiện tượng:** 2026-11-01 fail 1 lần khi chạy cả bộ integration ngay sau khi bật Docker; pass 2/2 khi chạy lại riêng file và pass ở các lượt chạy toàn bộ sau đó.
- **Nghi nguyên nhân:** test dùng thời gian rút ngắn (`graceMs` 500, `sweepMs` 50); dưới tải, độ trễ event lớn hơn biên của khẳng định `lastSeenAt ≈ lúc đóng`.
- **Hướng xử lý cần duyệt:** nới biên thời gian _trong test_ theo tỉ lệ với `TIMING` (không đổi hằng số spec), hoặc chạy file presence tuần tự.

## KI-03 — Test unit client hết thời gian chờ 5 s khi máy tải nặng

- **Hiện tượng:** khi `npm run test:unit` chạy cùng lúc với lint/integration, 1–8 test client (khác nhau giữa các lần: `LoginPage`, `RegisterPage`, `MessageRoom`, `ChatListPane`, `groups` › `TC-GROUP-001`, `SecuritySection`, `ProfileSection`, `ChatRoomPane`) báo `Test timed out in 5000ms`; vitest báo `environment` ~1170 s. Chạy riêng các file đó: 50/50 pass, mỗi test ~2 s.
- **Nghi nguyên nhân:** jsdom + nhiều worker song song trên máy dev; biên 5 s chỉ gấp ~2,5 lần thời gian thật của test chậm nhất.
- **Hướng xử lý cần duyệt:** giới hạn số worker cho client (`poolOptions`), tăng `testTimeout` cho các test tương tác dài, hoặc tối ưu các test dùng `findBy*` chuỗi dài.

## KI-04 — Rate limit `callInvite` có thể vượt +1 khi glare đua (chấp nhận)

- **Hiện tượng:** `calls.service.invite` kiểm khả năng glare trước rồi mới tăng bộ đếm `callInvite` (kiến trúc §7(g)). Nếu cuộc gọi ngược chiều kết thúc đúng giữa lúc kiểm và lúc `call-invite.lua` chạy, lời mời được tính bù sau khi đã tạo cuộc gọi, nên giới hạn 5 lời mời / 60 s có thể bị vượt tối đa +1 trong cửa sổ.
- **Quyết định (2026-11-02):** chấp nhận, không sửa; không chuyển rate limit vào Lua ở M5. Ghi chú ở `database_schema.md` §5.4.

## KI-05 — Rate limit theo tab có thể bị lách bằng cách đổi `tabId`

- **Hiện tượng:** rule có `key: 'socket'` (`callSignal`, `socketGeneric`) tính theo `${userId}:${tabId}` (DB §5.2). Reconnect cùng tab không reset bộ đếm, nhưng client tự sinh `tabId` mới (UUID v4 hợp lệ) cho mỗi kết nối thì được bucket mới.
- **Quyết định (2026-11-02):** ghi nhận; xem xét thêm giới hạn tổng theo `userId` sau, KHÔNG làm ở lượt này. Test `calls.int.test.ts` › "tab reconnect (cùng tabId) không reset bộ đếm callSignal; tab khác có bộ đếm riêng" ghi lại hành vi hiện tại.

## KI-06 — NFR-05: LCP 3,6 s do Google Fonts chặn render (M6) — ĐÃ SỬA 2026-11-04

- **Đo (2026-11-03):** Lighthouse CI 0.15.1 (mobile, simulate: RTT 150 ms, 1,6 Mbps, CPU ×4) trên image client có gzip: LCP 3,61–3,66 s (ngưỡng 2,5 s), perf 0,81–0,82, a11y 1. Bundle khởi tạo 167,9 KB gzip (đạt ≤ 300 KB).
- **Nguyên nhân:** `@import` Google Fonts CSS2 (ui_ux_spec.md §1) chặn render ~865 ms (thêm origin mới `fonts.googleapis.com` → `fonts.gstatic.com`, 3 file woff2 ~144 KB). Chặn Google Fonts khi đo: LCP 2,30–2,32 s (đạt).
- **Đã sửa (duyệt 2026-11-03):** Inter tự host (`client/public/fonts/`), đăng ký bằng `FontFace` sau `first-contentful-paint` (`client/src/lib/fonts/fonts.ts`); bỏ Google Fonts khỏi CSP (server helmet + nginx); bật gzip ở nginx. Chỉ tự host với `@font-face` trong CSS vẫn 3,0 s (font nằm trên đường găng FCP). Kết quả: LCP 2,16–2,25 s, performance 0,91–0,94, a11y 1.

## KI-07 — E2E mạng cuộc gọi chỉ chạy Chromium (M5, chấp nhận)

- **Hiện tượng:** Firefox không nối được cuộc gọi relay qua coturn local: địa chỉ relay là `127.0.0.1` (`TURN_EXTERNAL_IP`), Firefox mặc định loại candidate loopback; thêm `media.peerconnection.ice.loopback` + tắt IPv6 vẫn chưa nối được.
- **Quyết định (2026-11-03):** không test Firefox cho `call-network.spec.ts` (`testIgnore` ở project firefox). Firefox vẫn chạy `call.spec.ts` (không relay).

## KI-08 — Mốc đo NFR-01 phải dùng bản build production

- **Hiện tượng:** cùng kịch bản k6 (`load/message-send.js`), dev server (`tsx watch`, `LOG_LEVEL=debug`, chung với Vite dev) cho p95 ACK 756 ms, max 12,4 s, 1 ACK lỗi; bản build `node dist/main.js` `LOG_LEVEL=info` cho p95 82 ms, 0 lỗi.
- **Quy ước:** đo NFR-01/NFR-09 luôn trên bản build (`npm run build -w server`, `node --env-file=.env dist/main.js`), không trên `npm run dev`.

## KI-09 — `TC-AC-033` (WebKit) chập chờn khi chạy toàn bộ E2E (M3)

- **Hiện tượng (2026-11-03):** lượt chạy toàn bộ 3 project (88 test, 21 phút) fail 1 lần `Test timeout of 90000ms exceeded`; chạy lại riêng trên WebKit: 2/2 pass (~42 s mỗi lần).
- **Nghi nguyên nhân:** test dài (offline → outbox → chặn → online lại) chiếm gần nửa biên 90 s; cuối lượt chạy dài máy dev chậm hơn.
- **Hướng xử lý cần duyệt:** `test.setTimeout(150_000)` riêng cho test này (không đổi hằng số spec), hoặc rút ngắn các bước chờ cố định trong test.

## KI-10 — Mở hội thoại SECRET tiêu thụ one-time prekey của peer (M7) — ĐÃ SỬA 2026-11-04

- **Hiện tượng (trước khi sửa):** lần đầu mở mỗi hội thoại SECRET trong một lần tải trang, client gọi `GET /e2ee/users/{peer}/bundles` để phát hiện identity của peer đã đổi. Mỗi lần gọi tiêu thụ 1 one-time prekey cho mỗi device của peer.
- **Sửa (spec đã duyệt):**
  - Thêm endpoint chỉ đọc `GET /e2ee/users/{userId}/identities` (`listIdentityKeys`). Endpoint dùng quyền P24, rate limit `rest`, không tiêu thụ prekey.
  - `useSecretSession` gọi `SecretCrypto.checkIdentities` thay cho tải bundle.
  - Cờ "cần X3DH lại" (`needsRebuild`) chuyển từ RAM sang IndexedDB. Trước đây, nếu tải lại trang giữa lúc phát hiện identity đổi và lúc gửi, tin sẽ bị mã hóa bằng session cũ.
- **Test:** integration `FR-E2EE-006 identity key chỉ đọc` (không có prekey nào có `consumedAt`); unit `checkIdentities` (không tiêu thụ prekey, cờ X3DH lại còn sau reload).

## KI-11 — Giới hạn 5 device có thể bị vượt khi đăng ký đồng thời (M7, chấp nhận — đã duyệt 2026-11-04)

- **Hiện tượng:** `registerDevice` đếm số device ACTIVE trong transaction snapshot. Hai device mới đăng ký đúng cùng lúc khi user đang có 4 có thể cùng thấy 4 (write skew), nên cả hai đều được tạo thành 6 device.
- **Ảnh hưởng:** chỉ xảy ra khi đúng một người dùng đăng nhập hai thiết bị mới trong cùng vài mili giây. Cấp `signalDeviceId` vẫn không bị trùng (unique index + retry).
- **Hướng xử lý nếu cần:** khóa theo user (cập nhật một document đếm trong cùng transaction) trước khi đếm.

## KI-12 — Bản rõ tin SECRET lưu không mã hóa trong IndexedDB (M7, theo thiết kế — đã duyệt 2026-11-04)

- **Hiện tượng:** store `messages` của `hustalo-signal-{userId}` giữ bản rõ đã gửi hoặc đã giải mã (kiến trúc §9.3). Store này có cùng mức bảo vệ với khóa riêng Signal trong cùng DB.
- **Ảnh hưởng:** ai đọc được profile trình duyệt sẽ đọc được lịch sử SECRET của device đó, giống các ứng dụng Signal trên web và desktop không đặt passphrase.

## KI-13 — `TC-AC-055` (Chromium) chập chờn khi chạy toàn bộ E2E (M2) — ĐÃ SỬA 2026-11-04

- **Hiện tượng (2026-11-04, lượt 3 project liền sau M7):** bob bị xóa khỏi nhóm, đóng modal và về `/chats`, nhưng dòng "Nhóm QL" vẫn còn trong danh sách sau 10 s. Chạy lại riêng: 3/3 pass.
- **Đã loại trừ:** luồng xóa thành viên chỉ phát `conversation:member-removed`, không phát `message:new`. Vì vậy phần giải mã bất đồng bộ của M7 trong chat-runtime không nằm trên đường đi này.
- **Nghi nguyên nhân:** một lần tải lại danh sách hội thoại khởi chạy trước khi xóa (sau sự kiện đổi vai trò), nhưng trả về sau lần làm mới do `member-removed`.
- **Nguyên nhân (xác nhận bằng unit test):** `dropFromList` đã bỏ hội thoại bằng `setQueryData`, nhưng không hủy lần tải `Q['conversations']` đang bay. Lần tải này khởi chạy trước khi bị xóa (ví dụ sau `conversation:updated` ROLE), nên phản hồi về muộn vẫn còn hội thoại và ghi đè cache.
- **Sửa (đã duyệt):** `dropFromList` giờ `cancelQueries` danh sách → `setQueryData` bỏ hội thoại → `invalidateQueries` tải lại từ server. Server xóa thành viên trước khi phát event, nên lần tải lại không còn hội thoại. Áp dụng cho cả bị xóa (`useConversationEvents`) và tự rời nhóm (`useLeaveGroup`).
- **Test:** unit `cache.test.ts` (`TC-AC-055` — phản hồi cũ về muộn không ghi đè; không có bản sửa → nhận `['g1','d1']`).
