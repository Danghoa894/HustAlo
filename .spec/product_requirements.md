# HUSTALO — Product Requirements

| Thuộc tính | Giá trị |
|---|---|
| Version | 1.0.0 |
| Status | Draft — chờ review (file 2/6) |
| Ngày | 2026-10-27 |
| Phụ thuộc | `system_architecture.md` v1.0.0 (nguồn sự thật cho hằng số, enum, mã lỗi, event, registry FR/EC) |

**File liên quan:**

| File | Quan hệ |
|---|---|
| `system_architecture.md` | Định nghĩa hằng số (§4.4.1), enum (§4.4.2), mã lỗi (§4.4.3), event (§4.5), endpoint (§4.6), luồng (§7), state machine cuộc gọi (§8), registry FR (Phụ lục B) và EC (Phụ lục C). File này **không** định nghĩa lại các hợp đồng đó, chỉ tham chiếu. |
| `database_schema.md` | Hiện thực hóa dữ liệu cho các FR; các trường nghiệp vụ mới nêu ở mục 3.9 file này phải có trong schema. |
| `ui_ux_spec.md` | Văn bản UI trong cột "Trạng thái UI" của ma trận edge case (mục 5) và ở §8.6 kiến trúc là chuỗi chính thức. |
| `api_spec.yaml` | Request/response cho mọi FR có REST/Socket. |
| `development_guide.md` | Milestone M0–M7 gán FR/AC/TC của file này. |

**Thuật ngữ bổ sung** (thuật ngữ chung xem `system_architecture.md`):

| Thuật ngữ | Nghĩa |
|---|---|
| Guest | Người chưa đăng nhập. |
| Member / Admin / Owner | Vai trò `MemberRole` trong một hội thoại GROUP. Trong DIRECT/SECRET, cả hai người tham gia có role `MEMBER` và không có thao tác quản trị. |
| Người tham gia | Thành viên hiện tại của hội thoại (`leftAt = null`). |
| Bubble | Một tin nhắn hiển thị trong phòng chat. |
| Placeholder thu hồi | Bubble của tin đã bị thu hồi, hiển thị đúng chuỗi "Tin nhắn đã bị thu hồi". |
| TC-* | Test ID. Quy ước: `TC-<NHÓM>-<số>` ứng 1-1 với `EC-<NHÓM>-<số>`; `TC-AC-<số>` ứng 1-1 với `AC-<số>`. |

---

## 1. Mục tiêu và phạm vi

### 1.1 Mục tiêu sản phẩm

| ID | Mục tiêu | Chỉ số thành công (MVP) |
|---|---|---|
| PG-01 | Nhắn tin realtime tin cậy như Zalo/Telegram | 100% tin đã ACK không mất; 0 tin trùng hiển thị; p95 ACK ≤ 300 ms (NFR-01) |
| PG-02 | Gọi thoại/video 1-1 trên trình duyệt | ≥ 95% cuộc gọi đã accept đạt CONNECTED trong môi trường test có TURN; p95 thiết lập ≤ 5 s khi có đường direct (NFR-03) |
| PG-03 | Trạng thái minh bạch | Hiển thị đúng ✓/✓✓/✓✓ xanh, online/offline, đang soạn tin |
| PG-04 | Bảo mật mặc định | Mọi kết nối TLS; nội dung tin lưu dạng AES-256-GCM; Secret Chat E2EE |
| PG-05 | Chịu lỗi mạng | Mất mạng, đổi mạng, reconnect không làm mất tin hay treo cuộc gọi |

### 1.2 Phạm vi MVP

- Tài khoản: đăng ký, đăng nhập, đăng xuất, đổi mật khẩu, phiên đa thiết bị.
- Hồ sơ: tên hiển thị, ảnh đại diện dạng URL, quyền riêng tư lastSeen, chặn người dùng.
- Hội thoại: DIRECT (1-1), GROUP (tối đa `GROUP_MAX_MEMBERS` = 100), SECRET (1-1 E2EE).
- Tin nhắn văn bản: gửi, lịch sử, receipt, typing, sửa/thu hồi trong `MESSAGE_EDIT_WINDOW_MS` (15 phút), SYSTEM message.
- Presence online/offline + lastSeen đa thiết bị.
- Gọi thoại và gọi video 1-1 (DIRECT và SECRET), đổ chuông đa thiết bị, lịch sử cuộc gọi.
- Bảo mật: TLS, AES-256-GCM lưu trữ, Argon2id, JWT + refresh xoay vòng, rate limit, CSRF, CSP.
- Secret Chat E2EE theo Signal Protocol (X3DH + Double Ratchet), safety number, thu hồi thiết bị.

### 1.3 Ngoài phạm vi MVP

| Hạng mục | Hành vi trong MVP |
|---|---|
| Gọi nhóm | `call:invite` trong GROUP → `VALIDATION_ERROR` "Cuộc gọi nhóm chưa được hỗ trợ"; UI ẩn nút gọi (FR-CALL-010) |
| Gửi file, ảnh, sticker, voice note | Không có UI, không có API |
| Tải ảnh đại diện lên server | Chỉ nhận `avatarUrl` dạng `https://` |
| Push notification / Service Worker | Không; cuộc gọi tới người offline chờ tối đa `CALL_RING_TIMEOUT_MS` (D-08) |
| Tìm kiếm full-text nội dung tin nhắn | Không (giới hạn của AES tầng ứng dụng) |
| SECRET GROUP, sửa tin trong SECRET | Không (D-16) |
| Chuyển voice ↔ video giữa cuộc gọi, chia sẻ màn hình | Không |
| Reaction, reply/quote, forward, ghim tin | Không |
| Xác minh email, quên mật khẩu qua email | Không (mật khẩu chỉ đổi khi đang đăng nhập) |
| Ứng dụng di động native | Không; chỉ mobile web |
| Đa ngôn ngữ | Chỉ tiếng Việt |

---

## 2. Vai trò và ma trận quyền

Ký hiệu: ✔ được phép; ✘ bị từ chối (kèm mã lỗi); — không áp dụng. Cột Member/Admin/Owner áp dụng cho GROUP; hành động trong DIRECT/SECRET áp dụng cho mọi người tham gia (cột Member).

| # | Hành động | Guest | Member | Admin | Owner | Mã lỗi khi bị từ chối | FR |
|---|---|---|---|---|---|---|---|
| P01 | Đăng ký / đăng nhập | ✔ | — | — | — | — | FR-AUTH-001/002 |
| P02 | Gọi REST/socket cần xác thực | ✘ | ✔ | ✔ | ✔ | UNAUTHENTICATED | FR-AUTH-002 |
| P03 | Tìm kiếm người dùng | ✘ | ✔ | ✔ | ✔ | UNAUTHENTICATED | FR-USER-001 |
| P04 | Chặn / bỏ chặn người khác | ✘ | ✔ | ✔ | ✔ | UNAUTHENTICATED | FR-USER-003 |
| P05 | Tạo DIRECT/SECRET/GROUP | ✘ | ✔ | ✔ | ✔ | UNAUTHENTICATED | FR-CHAT-001, FR-GROUP-001, FR-E2EE-004 |
| P06 | Xem hội thoại và lịch sử | ✘ | ✔ | ✔ | ✔ | NOT_FOUND (chưa từng là thành viên) / NOT_A_MEMBER (đã rời/bị xóa) | FR-CHAT-003, FR-SEC-008 |
| P07 | Gửi tin nhắn | ✘ | ✔ | ✔ | ✔ | NOT_A_MEMBER; USER_BLOCKED (DIRECT/SECRET) | FR-CHAT-002 |
| P08 | Sửa / thu hồi tin **của chính mình** trong 15 phút | ✘ | ✔ | ✔ | ✔ | FORBIDDEN | FR-CHAT-007/008 |
| P09 | Sửa / thu hồi tin của người khác | ✘ | ✘ | ✘ | ✘ | FORBIDDEN | FR-CHAT-007/008 |
| P10 | Gửi typing / receipt | ✘ | ✔ | ✔ | ✔ | NOT_A_MEMBER | FR-CHAT-004/005 |
| P11 | Đổi tên nhóm | ✘ | ✘ | ✔ | ✔ | FORBIDDEN | FR-GROUP-005 |
| P12 | Thêm thành viên | ✘ | ✘ | ✔ | ✔ | FORBIDDEN | FR-GROUP-002 |
| P13 | Xóa thành viên role MEMBER | ✘ | ✘ | ✔ | ✔ | FORBIDDEN | FR-GROUP-003 |
| P14 | Xóa thành viên role ADMIN | ✘ | ✘ | ✘ | ✔ | FORBIDDEN | FR-GROUP-003 |
| P15 | Xóa / hạ quyền OWNER | ✘ | ✘ | ✘ | — | FORBIDDEN | FR-GROUP-003/006 |
| P16 | Nâng MEMBER → ADMIN, hạ ADMIN → MEMBER | ✘ | ✘ | ✘ | ✔ | FORBIDDEN | FR-GROUP-006 |
| P17 | Chuyển quyền OWNER | ✘ | ✘ | ✘ | ✔ | FORBIDDEN | FR-GROUP-004 |
| P18 | Rời nhóm | ✘ | ✔ | ✔ | ✔ chỉ khi đã chuyển quyền hoặc là thành viên duy nhất | CONFLICT | FR-GROUP-004 |
| P19 | Gọi thoại/video | ✘ | ✔ DIRECT/SECRET; ✘ GROUP | ✘ GROUP | ✘ GROUP | VALIDATION_ERROR (GROUP); USER_BLOCKED | FR-CALL-001/002/010 |
| P20 | Gửi signaling của một cuộc gọi | ✘ | ✔ chỉ tab tham gia | — | — | CALL_NOT_FOUND / FORBIDDEN | FR-CALL-003, FR-SEC-008 |
| P21 | Xem lịch sử cuộc gọi của mình | ✘ | ✔ | ✔ | ✔ | UNAUTHENTICATED | FR-CALL-008 |
| P22 | Theo dõi presence người khác | ✘ | ✔ chỉ người có chung hội thoại, không chặn | ✔ | ✔ | (lọc im lặng) | FR-PRES-003 |
| P23 | Đăng ký khóa E2EE cho device | ✘ | ✔ chỉ device của token (`did`) | ✔ | ✔ | FORBIDDEN | FR-E2EE-001 |
| P24 | Lấy prekey bundle của user khác | ✘ | ✔ chỉ khi có chung SECRET hoặc đang tạo SECRET, không chặn | ✔ | ✔ | NOT_FOUND / USER_BLOCKED | FR-E2EE-002 |
| P25 | Thu hồi device E2EE | ✘ | ✔ chỉ device của chính mình | ✔ | ✔ | FORBIDDEN | FR-E2EE-007 |

---

## 3. Functional requirements

Mọi FR dùng hằng số trong `packages/shared/src/constants.ts` (kiến trúc §4.4.1). Mỗi FR liệt kê AC (mục 4) và EC (mục 5) liên quan.

### 3.1 Auth

#### FR-AUTH-001 — Đăng ký tài khoản
- **Mô tả:** Guest tạo tài khoản bằng `POST /auth/register`, được đăng nhập ngay.
- **Quy tắc:**
  - Body `{ email, username, password, displayName, deviceId }`.
  - `email`: định dạng email, tối đa 254 ký tự, chuẩn hóa `trim().toLowerCase()`, unique.
  - `username`: khớp `USERNAME_PATTERN` (`^[a-z0-9_.]{3,30}$`), unique; client tự chuyển chữ thường.
  - `password`: `PASSWORD_MIN`..`PASSWORD_MAX` (8..128) ký tự, có ít nhất 1 chữ cái và 1 chữ số; không được trùng `email` hoặc `username`.
  - `displayName`: sau NFC + trim dài 1..`DISPLAY_NAME_MAX` (80) code point, không chỉ khoảng trắng.
  - `deviceId`: UUID v4.
  - Hash mật khẩu Argon2id (FR-SEC-004). Tạo session family như FR-AUTH-002.
  - Trùng email hoặc username (kể cả hai request đua nhau) → `409 CONFLICT`, `details.field ∈ {'email','username'}`.
  - Rate limit `register` 3/phút/IP.
- **AC:** AC-001, AC-002. **EC:** EC-AUTH-001.

#### FR-AUTH-002 — Đăng nhập
- **Mô tả:** `POST /auth/login { email, password, deviceId }` trả `AuthResponse { accessToken, accessTokenExpiresAt, user }` và set cookie `hustalo_rt`, `hustalo_csrf` (kiến trúc §6.3).
- **Quy tắc:**
  - Sai email hoặc mật khẩu, hoặc tài khoản `LOCKED` → `401 UNAUTHENTICATED`, message duy nhất "Email hoặc mật khẩu không đúng" (không lộ tài khoản tồn tại hay bị khóa); không có user vẫn chạy verify với dummy hash.
  - Rate limit `login` 5/phút theo IP + email; Redis down → `503 SERVICE_UNAVAILABLE` (D-10).
  - Một device chỉ có một family ACTIVE: đăng nhập lại cùng `deviceId` thu hồi family cũ của device đó.
  - Access token TTL `ACCESS_TOKEN_TTL_S` (15 phút), lưu trong RAM client; refresh TTL `REFRESH_TOKEN_TTL_S` (30 ngày).
- **AC:** AC-003, AC-004. **EC:** EC-SEC-005.

#### FR-AUTH-003 — Refresh token xoay vòng
- **Mô tả:** `POST /auth/refresh` (cookie + `X-CSRF-Token`) cấp access token mới và refresh token mới, vô hiệu token cũ.
- **Quy tắc:** theo kiến trúc §7(a) trường hợp A–D:
  - Token hiện hành → xoay, 200.
  - Token vừa bị xoay trong `REFRESH_REUSE_GRACE_S` (10 s) và con của nó là token hiện hành → `409 CONFLICT`, không thu hồi; client đọc lại cookie và retry 1 lần.
  - Token cũ hơn hoặc ngoài grace → phát hiện tái sử dụng: thu hồi cả family, `session:revoked { reason: 'REFRESH_REUSE' }`, `401`.
  - Không hợp lệ/hết hạn → `401`, xóa cookie.
  - Client: refresh chủ động trước `exp` `ACCESS_TOKEN_REFRESH_SKEW_S` (60 s); chỉ một tab refresh tại một thời điểm (Web Locks `hustalo-refresh`).
  - Rate limit `refresh` 30/phút/IP.
- **AC:** AC-005, AC-006, AC-007. **EC:** EC-AUTH-003, EC-AUTH-004, EC-SEC-004.

#### FR-AUTH-004 — Đăng xuất
- **Mô tả:** `POST /auth/logout` thu hồi family hiện tại.
- **Quy tắc:** thu hồi family (`LOGOUT`), set `session:revoked:{sid}`, phát `session:revoked` tới mọi tab của session, kết thúc cuộc gọi của các tab đó với `endReason = LOGOUT` (T11, T27), xóa cookie, `204`. Client xóa access token, outbox của user **được giữ** trong IndexedDB (gửi lại khi cùng user đăng nhập lại), xóa cache TanStack Query, điều hướng `/login`.
- **AC:** AC-008. **EC:** EC-AUTH-007.

#### FR-AUTH-005 — Đổi mật khẩu
- **Mô tả:** `POST /auth/change-password { currentPassword, newPassword }`.
- **Quy tắc:** `currentPassword` sai → `401 UNAUTHENTICATED` "Mật khẩu hiện tại không đúng"; `newPassword` theo quy tắc FR-AUTH-001 và khác mật khẩu cũ (`VALIDATION_ERROR`). Thành công: thu hồi **mọi family khác** (`PASSWORD_CHANGED`), giữ session hiện tại, `204`. Rate limit theo rule `login` (khóa theo IP + email của user).
- **AC:** AC-009. **EC:** EC-AUTH-006.

#### FR-AUTH-006 — Khóa tài khoản
- **Mô tả:** Quản trị vận hành khóa tài khoản bằng script `npm run user:lock -w server -- <email>` (MVP không có UI quản trị); mở khóa bằng `npm run user:unlock -w server -- <email>`.
- **Quy tắc:** `users.status = LOCKED`; thu hồi mọi family (`ACCOUNT_LOCKED`); ngắt mọi socket của user; kết thúc mọi cuộc gọi (T27/T28, `LOGOUT`); mọi request sau đó `401 UNAUTHENTICATED`.
- **AC:** AC-010. **EC:** EC-AUTH-005.

#### FR-AUTH-007 — Hết hạn phiên socket
- **Mô tả:** Socket xác thực bằng access token trong `auth.token`; khi token hết hạn giữa phiên, server phát `session:expired` rồi ngắt.
- **Quy tắc:** server hẹn giờ tại `exp` → `session:expired` → sau `SESSION_EXPIRED_DISCONNECT_DELAY_MS` (5 s) `disconnect(true)`. Client nhận event → refresh (FR-AUTH-003) → reconnect với token mới → chạy sync (FR-CHAT-010). Refresh thất bại → về `/login`. Handshake với token hết hạn → `connect_error` `TOKEN_EXPIRED`.
- **AC:** AC-011. **EC:** EC-AUTH-002.

### 3.2 User

#### FR-USER-001 — Tìm kiếm người dùng
- **Mô tả:** `GET /users/search?q=` trả tối đa `USER_SEARCH_LIMIT` (20) `UserPublic`.
- **Quy tắc:**
  - `q` sau trim dài `USER_SEARCH_MIN_QUERY` (2) đến 100 ký tự, ngắn hơn → `VALIDATION_ERROR`.
  - Khớp: email **chính xác** (nếu `q` chứa `@`), hoặc tiền tố `username`, hoặc tiền tố `displayNameNormalized` (chữ thường, bỏ dấu tiếng Việt, `đ`→`d`).
  - Loại khỏi kết quả: chính mình, user `LOCKED`, user **đã chặn mình**. User mình đã chặn vẫn hiển thị (để bỏ chặn), kèm `blockedByMe: true`.
  - Sắp xếp: khớp username chính xác → tiền tố username → tiền tố displayName; cùng hạng theo `displayName` tăng dần.
- **AC:** AC-012.

#### FR-USER-002 — Cập nhật hồ sơ
- **Mô tả:** `PATCH /users/me { displayName?, avatarUrl?, privacy? }`.
- **Quy tắc:** `displayName` như FR-AUTH-001; `avatarUrl` là URL `https://`, tối đa 2048 ký tự, hoặc `null` để xóa; `privacy.showLastSeen: boolean`. Ít nhất một trường, ngược lại `VALIDATION_ERROR`. Thay đổi `displayName`/`avatarUrl` không phát event realtime ở MVP; client khác thấy khi tải lại dữ liệu.
- **AC:** AC-013.

#### FR-USER-003 — Chặn / bỏ chặn
- **Mô tả:** `POST /users/{userId}/block`, `DELETE /users/{userId}/block` (idempotent, `204`).
- **Quy tắc (D-21):**
  - Chặn chính mình → `VALIDATION_ERROR`; user không tồn tại → `NOT_FOUND`.
  - Khi A chặn B **hoặc** B chặn A: trong DIRECT/SECRET giữa A và B không ai gửi tin, typing hay gọi được (`USER_BLOCKED`); presence giữa hai người bị ẩn (không subscribe được); B không thấy A trong tìm kiếm nếu A chặn B.
  - Không ảnh hưởng GROUP chung đang có (vẫn gửi tin nhóm); nhưng không thể thêm vào nhóm người đã chặn mình (FR-GROUP-002).
  - Cuộc gọi đang diễn ra giữa A và B khi chặn: **không** bị cắt; lời mời mới bị từ chối.
  - `GET /auth/me` trả `blockedUserIds` (danh sách người mình đã chặn) để hiển thị trong Cài đặt.
  - `ConversationSummary` DIRECT/SECRET có `blockedByMe: boolean` và `canMessage: boolean` (`false` khi bị chặn bất kỳ chiều nào). Người bị chặn chỉ thấy `canMessage: false`, không biết chiều chặn.
- **AC:** AC-014, AC-015. **EC:** EC-MSG-011, EC-CALL-SIG-013, EC-GROUP-003.

#### FR-USER-004 — Quyền riêng tư lastSeen
- **Mô tả:** `privacy.showLastSeen` (mặc định `true`).
- **Quy tắc:** `false` → mọi người khác nhận `lastSeenAt: null` của user; có đi có lại: user đó cũng nhận `lastSeenAt: null` của mọi người. Trạng thái ONLINE/OFFLINE vẫn hiển thị.
- **AC:** AC-016. **EC:** EC-PRES-004.

### 3.3 Chat

#### FR-CHAT-001 — Tạo hội thoại DIRECT idempotent
- **Mô tả:** `POST /conversations { type: 'DIRECT', memberIds: [otherUserId] }` (header `Idempotency-Key` bắt buộc cho mọi `POST /conversations`, UUID v4).
- **Quy tắc:** Mỗi cặp user có đúng một DIRECT (unique theo `directKey = min(userId):max(userId)`). Đã tồn tại → `200` trả hội thoại cũ; tạo mới → `201`. Hai request đua nhau → cả hai nhận cùng `conversationId`. Không cho tạo với chính mình (`VALIDATION_ERROR`), user không tồn tại/LOCKED (`NOT_FOUND`), bị chặn bất kỳ chiều (`USER_BLOCKED` — chỉ khi chưa có DIRECT; DIRECT đã có vẫn trả về với `canMessage: false`). Tạo DIRECT không tạo SYSTEM message. Hội thoại chỉ hiện trong danh sách của người kia khi có tin đầu tiên (`lastMessage != null`); với người tạo hiện ngay.
- **AC:** AC-017. **EC:** —.

#### FR-CHAT-002 — Gửi tin nhắn realtime
- **Mô tả:** `message:send` theo kiến trúc §7(b).
- **Quy tắc:**
  - `content` NFC + trim (cả ký tự zero-width ở hai đầu), dài 1..`MESSAGE_MAX_LENGTH` (4000) code point (D-17); rỗng hoặc chỉ khoảng trắng → `VALIDATION_ERROR`.
  - `clientMessageId` UUID v4 do client sinh; idempotent theo `(conversationId, senderId, clientMessageId)`; gửi lại trả `duplicate: true` với bản đã lưu (`DUPLICATE_MESSAGE`, không phải lỗi).
  - `senderId`, `createdAt` do server gán; payload chứa trường thừa → `VALIDATION_ERROR`.
  - ACK chỉ sau khi transaction commit; fan-out `message:new` tới mọi tab của mọi người tham gia (kể cả các tab khác của người gửi).
  - DIRECT/SECRET bị chặn → `USER_BLOCKED`; không phải người tham gia → `NOT_A_MEMBER` / `NOT_FOUND`.
  - Rate limit `messageSend` 20/10 s/user.
  - Nội dung lưu dạng `contentEnc` AES-256-GCM (FR-SEC-002); SECRET theo FR-E2EE-004.
- **AC:** AC-020, AC-021, AC-029, AC-035, AC-036. **EC:** EC-MSG-001..006, EC-MSG-010, EC-MSG-012, EC-NET-004, EC-SEC-002.

#### FR-CHAT-003 — Lịch sử phân trang cursor
- **Mô tả:** `GET /conversations/{id}/messages?before=&after=&limit=`.
- **Quy tắc:** `limit` 1..`HISTORY_PAGE_MAX` (100), mặc định `HISTORY_PAGE_DEFAULT` (30). `before`/`after` là cursor base64url của `(createdAt, _id)`, loại trừ nhau (cả hai → `VALIDATION_ERROR`); không có cả hai = trang mới nhất. Kết quả `MessagePage { items (sắp tăng dần theo (createdAt,_id)), nextBefore: string|null, nextAfter: string|null }`. Không dùng `skip`. Tin thu hồi trả về với `deletedAt` và `content: null`. SECRET: `ciphertext.recipients` chỉ còn phần tử cho `did` của token (có thể rỗng — tin trước khi device tham gia).
- **AC:** AC-037. **EC:** EC-NET-007, EC-SEC-001.

#### FR-CHAT-004 — Receipt đã gửi / đã nhận / đã đọc
- **Mô tả:** Trạng thái client `PENDING → SENT → DELIVERED → READ`, hoặc `PENDING → FAILED`.
- **Quy tắc:**
  - SENT: nhận ACK thành công. DELIVERED: ít nhất một device của người nhận (DIRECT/SECRET) đã nhận tin (`message:delivered`). READ: người nhận đã xem (`message:read` hoặc `POST /conversations/{id}/read`).
  - Một chiều, không hạ cấp (kiến trúc §7(b).1); receipt chỉ do chính người nhận gửi.
  - Delivered gửi khi client nhận `message:new` hoặc sau sync danh sách hội thoại; read chỉ gửi khi tab visible + có focus + tin hiện ≥ 50% trong viewport.
  - GROUP: hiển thị "Đã xem bởi X/Y" cho tin cuối của mình, X = số thành viên khác có `lastReadMessage ≥ tin đó`, Y = số thành viên khác hiện tại. ✓✓ khi tất cả thành viên khác đã delivered; ✓✓ xanh khi tất cả đã đọc.
  - Đọc ở một device xóa badge chưa đọc trên mọi device của mình (`message:status` tới user room người đọc).
- **AC:** AC-022, AC-023, AC-024, AC-025, AC-042, AC-043. **EC:** EC-MSG-008, EC-MSG-009, EC-MSG-014, EC-SEC-003.

#### FR-CHAT-005 — Typing
- **Mô tả:** `typing:start`/`typing:stop` → `typing:update`.
- **Quy tắc:** client gửi `typing:start` khi người dùng gõ, throttle tối đa 1 lần / `TYPING_CLIENT_THROTTLE_MS` (3 s); gửi `typing:stop` khi gửi tin, xóa hết nội dung ô nhập, hoặc ô nhập mất focus. Người nhận tự ẩn chỉ báo sau `TYPING_TTL_MS` (5 s) không nhận `isTyping: true` mới. Hiển thị cả trong phòng chat và preview danh sách chat. GROUP: tối đa 2 tên ("An, Bình đang soạn tin…"), từ 3 người: "Nhiều người đang soạn tin…". Bị chặn → `USER_BLOCKED`. Rate limit `typing` 20/10 s/user. Lỗi typing không hiển thị cho người dùng.
- **AC:** AC-026. **EC:** —.

#### FR-CHAT-006 — Outbox và retry phía client
- **Mô tả:** Mọi tin gửi đi qua outbox IndexedDB trước.
- **Quy tắc:** tối đa `CLIENT_OUTBOX_MAX` (200) tin PENDING/FAILED mỗi user; đầy → không nhận tin mới, thông báo. Retry khi ACK timeout (`SOCKET_ACK_TIMEOUT_MS` 10 s), `SERVICE_UNAVAILABLE`, `RATE_LIMITED` hoặc mất kết nối, backoff `1s, 2s, 4s, 8s` rồi nhân đôi, trần `OUTBOX_RETRY_MAX_DELAY_MS` (30 s). Lỗi vĩnh viễn (`VALIDATION_ERROR`, `NOT_A_MEMBER`, `NOT_FOUND`, `USER_BLOCKED`, `FORBIDDEN`) → FAILED ngay. Quá `OUTBOX_MAX_AGE_MS` (24 h) → FAILED. FAILED: người dùng chọn "Thử lại" (cùng `clientMessageId`) hoặc "Xóa". Gửi tuần tự theo thứ tự tạo, tối đa 1 tin in-flight mỗi hội thoại. Outbox sống qua reload.
- **AC:** AC-040, AC-041. **EC:** EC-MSG-007, EC-NET-001, EC-INFRA-001.

#### FR-CHAT-007 — Sửa tin
- **Mô tả:** `message:edit { messageId, content }`.
- **Quy tắc:** chỉ người gửi; trong `MESSAGE_EDIT_WINDOW_MS` (15 phút) tính theo `createdAt` server; không áp dụng cho SYSTEM, tin đã thu hồi, tin SECRET (D-16); vi phạm → `FORBIDDEN`. `content` theo quy tắc FR-CHAT-002; nội dung giống hệt bản cũ → ACK ok, không phát event. Thành công: mã hóa lại (IV mới), set `editedAt`, phát `message:edit` tới mọi người tham gia; UI hiển thị nhãn "Đã chỉnh sửa". Không lưu lịch sử phiên bản. Sửa không đổi vị trí tin và không đổi receipt.
- **AC:** AC-030, AC-031. **EC:** EC-MSG-015, EC-MSG-017.

#### FR-CHAT-008 — Thu hồi tin
- **Mô tả:** `message:delete { messageId }` — thu hồi với mọi người.
- **Quy tắc:** chỉ người gửi; trong 15 phút; không áp dụng SYSTEM (`FORBIDDEN`). Áp dụng cả SECRET. Thành công: xóa `contentEnc`/`ciphertext`, set `deletedAt`, phát `message:delete`; mọi client hiển thị placeholder **"Tin nhắn đã bị thu hồi"** đúng vị trí cũ. Thu hồi lần hai → ACK ok trả bản hiện tại (idempotent). Nếu là tin cuối, preview danh sách chat hiển thị "Tin nhắn đã bị thu hồi". Không có "xóa phía tôi" ở MVP.
- **AC:** AC-032. **EC:** EC-MSG-015.

#### FR-CHAT-009 — Danh sách hội thoại
- **Mô tả:** `GET /conversations?cursor=&limit=` trả `ConversationSummary[]`.
- **Quy tắc:** `limit` 1..`CONVERSATION_PAGE_MAX` (50), mặc định `CONVERSATION_PAGE_DEFAULT` (20); sắp theo `lastMessageAt` giảm dần rồi `_id` giảm dần (cursor theo cặp đó). Mỗi summary: `id, type, title (GROUP) hoặc peer (DIRECT/SECRET), avatarUrl, lastMessage { id, senderId, type, preview, createdAt, deletedAt } | null, unreadCount, myLastDeliveredMessageId, myLastReadMessageId, memberCount, blockedByMe, canMessage`. `preview`: TEXT → tối đa 100 code point đầu đã giải mã; SECRET → "Tin nhắn được mã hóa"; SYSTEM → chuỗi mô tả sự kiện (FR-CHAT-011); thu hồi → "Tin nhắn đã bị thu hồi". `unreadCount` = số tin TEXT và SYSTEM `CALL_MISSED` của người khác, chưa thu hồi, sau read cursor của mình; đếm tối đa 100; UI hiển thị "99+" khi > `UNREAD_COUNT_CAP` (99). Cập nhật realtime qua `message:new`, `message:status`, `message:edit`, `message:delete`, `conversation:*`.
- **AC:** AC-039. **EC:** EC-MSG-014.

#### FR-CHAT-010 — Đồng bộ sau reconnect
- **Mô tả:** Theo kiến trúc §7(c); luôn sync qua REST kể cả khi `connectionStateRecovery` khôi phục được.
- **Quy tắc:** tải lại trang đầu danh sách hội thoại; hội thoại đang mở tải `after` cursor tin mới nhất đã biết tới khi trang < `limit`; gửi `message:delivered` cho hội thoại có tin mới; join lại room, subscribe lại presence; báo `call:state` nếu đang gọi; xả outbox. Dedupe theo `_id`/`eventId`; kết quả sync cũ bị bỏ khi đã có lần sync mới hơn. Banner "Đang kết nối lại…" chỉ hiện sau 2 s.
- **AC:** AC-028. **EC:** EC-NET-001..010.

#### FR-CHAT-011 — SYSTEM message `[NEW]`
- **Mô tả:** Server tạo tin `type: SYSTEM` cho sự kiện nhóm và cuộc gọi (`SystemEventKind`).
- **Quy tắc:** `system: { kind, actorId, targetUserIds?, title?, callId?, callType?, durationSec? }`, không có `content`. Chuỗi hiển thị (client dựng, tên lấy từ danh sách thành viên):

| `kind` | Chuỗi hiển thị |
|---|---|
| GROUP_CREATED | "{actor} đã tạo nhóm" |
| MEMBER_ADDED | "{actor} đã thêm {targets}" |
| MEMBER_REMOVED | "{actor} đã xóa {target} khỏi nhóm" |
| MEMBER_LEFT | "{actor} đã rời nhóm" |
| ROLE_CHANGED | "{actor} đã đặt {target} làm quản trị viên" / "{actor} đã gỡ quyền quản trị viên của {target}" |
| OWNER_TRANSFERRED | "{actor} đã chuyển quyền trưởng nhóm cho {target}" |
| TITLE_CHANGED | "{actor} đã đổi tên nhóm thành “{title}”" |
| CALL_MISSED | "Cuộc gọi thoại nhỡ" / "Cuộc gọi video nhỡ" |
| CALL_ENDED | "Cuộc gọi thoại · {mm:ss}" / "Cuộc gọi video · {mm:ss}" |

  SYSTEM không có receipt riêng, không sửa/thu hồi được, có tham gia sắp xếp và `lastMessage`.
- **AC:** AC-050, AC-091. **EC:** —.

### 3.4 Group

#### FR-GROUP-001 — Tạo nhóm
- **Mô tả:** `POST /conversations { type: 'GROUP', title, memberIds }` với `Idempotency-Key`.
- **Quy tắc:** `title` NFC + trim 1..`GROUP_TITLE_MAX` (100) code point; `memberIds` 1..99 ObjectId (khử trùng, bỏ chính mình). Người tạo là **OWNER**, người khác là MEMBER. Người không tồn tại/LOCKED hoặc đã chặn người tạo bị bỏ qua và trả trong `skipped` với lý do (`NOT_FOUND` / `USER_BLOCKED`). Sau lọc không còn ai → `VALIDATION_ERROR`. Tổng thành viên ≤ `GROUP_MAX_MEMBERS` (100), vượt → `CONVERSATION_FULL`. Tạo SYSTEM `GROUP_CREATED` và `MEMBER_ADDED`; phát `conversation:updated { change: 'CREATED' }` tới mọi thành viên. Cùng `Idempotency-Key` trong 24 h → trả lại nhóm đã tạo (`200`).
- **AC:** AC-050. **EC:** EC-GROUP-001, EC-GROUP-002, EC-GROUP-003.

#### FR-GROUP-002 — Thêm thành viên
- **Mô tả:** `POST /conversations/{id}/members { userIds }` (OWNER/ADMIN).
- **Quy tắc:** `userIds` 1..`GROUP_ADD_BATCH_MAX` (50), khử trùng. Người đã là thành viên → `skipped` (`CONFLICT`); không tồn tại/LOCKED → `skipped` (`NOT_FOUND`); đã chặn người thêm → `skipped` (`USER_BLOCKED`). Nếu `memberCount + số được thêm > 100` → `422 CONVERSATION_FULL`, **không thêm ai** (tất cả hoặc không). Kiểm tra và tăng `memberCount` trong một transaction với update có điều kiện để hai admin thêm đồng thời không vượt giới hạn. Người được thêm lại sau khi rời/bị xóa thấy lại toàn bộ lịch sử. Response `200 { added: Member[], skipped: [{ userId, code }] }`; SYSTEM `MEMBER_ADDED` nếu `added` không rỗng; `conversation:updated { change: 'MEMBERS' }`.
- **AC:** AC-051, AC-052, AC-058. **EC:** EC-GROUP-001, EC-GROUP-002, EC-GROUP-003, EC-GROUP-006.

#### FR-GROUP-003 — Xóa thành viên
- **Mô tả:** `DELETE /conversations/{id}/members/{userId}` với `userId ≠ me`.
- **Quy tắc:** quyền theo P13–P15; xóa OWNER → `FORBIDDEN`. Set `leftAt` trên bản ghi thành viên, giảm `memberCount`; server cho mọi socket của người bị xóa rời room `conv:{id}`, phát `conversation:member-removed { reason: 'REMOVED' }` tới thành viên còn lại **và** người bị xóa; SYSTEM `MEMBER_REMOVED`. Người bị xóa mất quyền truy cập (`NOT_A_MEMBER`), hội thoại biến khỏi danh sách của họ; tin họ đang gửi dở bị từ chối `NOT_A_MEMBER`. Cuộc gọi không bị ảnh hưởng (GROUP không có cuộc gọi). `204`.
- **AC:** AC-034, AC-057. **EC:** EC-GROUP-005, EC-GROUP-007, EC-MSG-010.

#### FR-GROUP-004 — Rời nhóm và chuyển quyền OWNER
- **Mô tả:** Rời: `DELETE /conversations/{id}/members/{me}`. Chuyển quyền: `PATCH /conversations/{id}/members/{userId} { role: 'OWNER' }`.
- **Quy tắc:**
  - MEMBER/ADMIN rời: như FR-GROUP-003 với `reason: 'LEFT'`, SYSTEM `MEMBER_LEFT`.
  - OWNER rời khi còn thành viên khác → `409 CONFLICT` "Bạn cần chuyển quyền trưởng nhóm trước khi rời nhóm" (D-23).
  - OWNER là thành viên duy nhất → được rời; hội thoại đánh dấu `deletedAt` (soft delete), không còn hiển thị với ai.
  - Chuyển quyền: chỉ OWNER; target phải là thành viên hiện tại (`NOT_A_MEMBER` nếu không); trong một transaction: target → OWNER, OWNER cũ → ADMIN; SYSTEM `OWNER_TRANSFERRED`; `conversation:updated { change: 'OWNER' }`.
- **AC:** AC-053, AC-054. **EC:** EC-GROUP-004.

#### FR-GROUP-005 — Đổi tên nhóm
- **Mô tả:** `PATCH /conversations/{id} { title }` (OWNER/ADMIN).
- **Quy tắc:** `title` như FR-GROUP-001; giống hệt tên cũ → `200`, không tạo SYSTEM; khác → SYSTEM `TITLE_CHANGED`, `conversation:updated { change: 'TITLE' }`. Áp dụng cho DIRECT/SECRET → `VALIDATION_ERROR`.
- **AC:** AC-056. **EC:** EC-GROUP-006.

#### FR-GROUP-006 — Phân quyền ADMIN
- **Mô tả:** `PATCH /conversations/{id}/members/{userId} { role: 'ADMIN' | 'MEMBER' }`.
- **Quy tắc:** chỉ OWNER (P16); target là OWNER → `FORBIDDEN`; OWNER tự đổi role của mình → `VALIDATION_ERROR` (dùng chuyển quyền). Role không đổi → `200` không SYSTEM. Thay đổi → SYSTEM `ROLE_CHANGED`, `conversation:updated { change: 'ROLE' }`. Không giới hạn số ADMIN.
- **AC:** AC-059. **EC:** EC-GROUP-005.

### 3.5 Presence

#### FR-PRES-001 — Online/offline đa thiết bị
- **Mô tả:** User ONLINE khi có ít nhất một socket còn lease; OFFLINE sau `PRESENCE_OFFLINE_GRACE_MS` (10 s) kể từ khi socket cuối ngắt (kiến trúc §7(d)).
- **Quy tắc:** lease `PRESENCE_LEASE_TTL_MS` (60 s), server gia hạn mỗi `PRESENCE_HEARTBEAT_MS` (20 s); crash → OFFLINE tối đa 60 s; chỉ phát `presence:update` khi số kết nối chuyển 0↔≥1. Redis không truy cập được → `degraded`, UI không hiển thị chấm online/lastSeen.
- **AC:** AC-027, AC-060, AC-061, AC-062. **EC:** EC-PRES-001, EC-PRES-002, EC-PRES-003, EC-PRES-005.

#### FR-PRES-002 — lastSeen
- **Mô tả:** Khi chuyển OFFLINE, server ghi `users.lastSeenAt` và phát kèm trong `presence:update`.
- **Quy tắc:** lọc theo FR-USER-004. UI: "Vừa mới truy cập" (< 1 phút), "Truy cập {n} phút trước" (< 60 phút), "Truy cập {n} giờ trước" (< 24 giờ), "Truy cập lúc HH:mm DD/MM" (còn lại); `null` → không hiển thị dòng lastSeen.
- **AC:** AC-061, AC-016. **EC:** EC-PRES-004.

#### FR-PRES-003 — Theo dõi presence
- **Mô tả:** `presence:subscribe { userIds }` (tối đa `PRESENCE_SUBSCRIBE_MAX` = 200) → `presence:snapshot`, sau đó `presence:update`.
- **Quy tắc:** chỉ chấp nhận user có chung ≥ 1 hội thoại (người tham gia hiện tại) và không bị chặn hai chiều; còn lại bị lọc im lặng (`accepted` không chứa). Rate limit `presenceSubscribe` 10/phút/user. Client subscribe user hiển thị trong danh sách chat và header phòng chat; subscribe lại sau reconnect.
- **AC:** AC-063. **EC:** EC-SEC-002.

### 3.6 Call

#### FR-CALL-001 — Gọi thoại 1-1
- **Mô tả:** Cuộc gọi `VOICE` trong DIRECT/SECRET theo kiến trúc §7(e) và state machine §8.
- **Quy tắc:** chỉ cần micro. Điều khiển: tắt/bật micro, bật/tắt loa ngoài (chỉ trình duyệt hỗ trợ `setSinkId`; không hỗ trợ thì ẩn nút), kết thúc. Thời lượng tính từ `connectedAt`. Rate limit `callInvite` 5/phút/user.
- **AC:** AC-070. **EC:** EC-CALL-SIG-014.

#### FR-CALL-002 — Gọi video 1-1
- **Mô tả:** Cuộc gọi `VIDEO`, video 1280×720 lý tưởng.
- **Quy tắc:** điều khiển thêm: tắt/bật camera (`track.enabled`), đổi camera trước/sau trên mobile (`facingMode`) nếu có ≥ 2 camera. Video local hiển thị PiP, mirror với camera trước. Tắt camera giữa cuộc gọi không đổi `callType`.
- **AC:** AC-071. **EC:** EC-CALL-MEDIA-002, EC-CALL-MEDIA-011.

#### FR-CALL-003 — Đổ chuông đa thiết bị, nghe ở thiết bị khác
- **Mô tả:** `call:incoming` tới mọi tab online của callee; tab trả lời đầu tiên thắng.
- **Quy tắc:** tab khác nhận `call:answered-elsewhere`, dừng chuông, toast "Đã trả lời trên thiết bị khác". Tab thứ hai accept → `CALL_ALREADY_ANSWERED`. Callee offline: cuộc gọi ở INITIATED, giao `call:incoming` khi callee kết nối trong `CALL_RING_TIMEOUT_MS` (45 s) (D-08). Signaling chỉ chấp nhận từ đúng 2 tab tham gia.
- **AC:** AC-076, AC-083, AC-088. **EC:** EC-CALL-SIG-001, EC-CALL-SIG-004, EC-CALL-SIG-011, EC-CALL-SIG-016.

#### FR-CALL-004 — Từ chối / hủy / hết giờ / bận
- **Mô tả:** Kết cục trước khi kết nối theo T02, T06–T08.
- **Quy tắc:** callee từ chối trên một tab → REJECTED cho mọi tab (D-07). Caller hủy → CANCELLED. Không ai trả lời trong 45 s → MISSED/TIMEOUT. Callee đang trong cuộc gọi khác (kể cả đang đổ chuông) → ACK `CALL_BUSY`, callee nhận `call:busy`. Accept sau khi đã MISSED → `CALL_TIMEOUT`; accept khi đã CANCELLED → `CALL_INVALID_STATE`; cancel khi đã ACCEPTED → xử lý như kết thúc (HANGUP). Sự kiện kết thúc lặp lại là idempotent.
- **AC:** AC-072, AC-073, AC-074, AC-075, AC-084, AC-089. **EC:** EC-CALL-SIG-002, EC-CALL-SIG-005, EC-CALL-SIG-006, EC-CALL-SIG-015.

#### FR-CALL-005 — Glare
- **Mô tả:** Hai người gọi nhau gần như cùng lúc (D-03, §7(g)).
- **Quy tắc:** server gộp lời mời thứ hai từ chính callee thành "nghe máy" cho cuộc gọi thứ nhất; giữ `callType` của cuộc gọi thứ nhất; ACK lời mời thứ hai `{ merged: true, status: 'ACCEPTED' }`. Luôn chỉ có một cuộc gọi.
- **AC:** AC-077. **EC:** EC-CALL-SIG-003.

#### FR-CALL-006 — Mất mạng, ICE restart, reconnect
- **Mô tả:** Theo §7(f), §8.4.
- **Quy tắc:** `disconnected` < `ICE_DISCONNECTED_GRACE_MS` (3 s) bỏ qua; dài hơn hoặc `failed` → báo `call:state`, server RECONNECTING, caller ICE restart (tối đa `CALL_MAX_ICE_RESTARTS` = 2). Không hồi phục trong `CALL_RECONNECT_GRACE_MS` (20 s) hoặc hết lượt → ENDED/NETWORK_FAILURE. Socket signaling rớt nhưng media còn → cuộc gọi tiếp tục; tab không quay lại trong 20 s → PEER_DISCONNECTED. Server restart giữa cuộc gọi → media tiếp tục, signaling reconcile (§8.5). Chất lượng kém (mất gói > 5% hoặc RTT > 400 ms trong 3 mẫu liên tiếp) → nhãn "Kết nối yếu".
- **AC:** AC-081, AC-082, AC-092. **EC:** EC-CALL-NET-001, EC-CALL-NET-002, EC-CALL-NET-007, EC-CALL-NET-008, EC-CALL-NET-009, EC-CALL-NET-010.

#### FR-CALL-007 — TURN credential ngắn hạn
- **Mô tả:** `GET /calls/ice-servers` (kiến trúc §9.5).
- **Quy tắc:** credential TTL `TURN_CREDENTIAL_TTL_S` (1 h), client làm mới khi còn < 5 phút và trước mỗi ICE restart; cache Redis `ICE_SERVERS_CACHE_TTL_S` (5 phút); Xirsys lỗi → fallback STUN + coturn (`source: 'FALLBACK'`); `ICE_TRANSPORT_POLICY=relay` ép relay. Secret Xirsys không bao giờ ở client. Gói free Xirsys có quota — kiểm tra trước production.
- **AC:** AC-085, AC-090. **EC:** EC-CALL-NET-003, EC-CALL-NET-004, EC-CALL-NET-005, EC-CALL-NET-006, EC-SEC-006.

#### FR-CALL-008 — Lịch sử cuộc gọi và SYSTEM message
- **Mô tả:** `GET /calls?cursor=&limit=` trả `CallRecord[]` của mình (caller hoặc callee), sắp `createdAt` giảm dần, `limit` mặc định 20, tối đa 50.
- **Quy tắc:** `CallRecord { id, conversationId, callType, direction: 'OUTGOING' | 'INCOMING' (tính theo người xem), peer: UserPublic, status, endReason, createdAt, connectedAt, endedAt, durationSec }`. SYSTEM `CALL_MISSED` khi MISSED/BUSY, `CALL_ENDED` khi ENDED có `connectedAt` (§8.2). `CALL_MISSED` tính vào `unreadCount` của callee.
- **AC:** AC-091. **EC:** —.

#### FR-CALL-009 — Lỗi media và fallback voice
- **Mô tả:** Xử lý lỗi `getUserMedia` và thiết bị giữa cuộc gọi.
- **Quy tắc:**
  - Kiểm tra trước: `isSecureContext`, `RTCPeerConnection`, `navigator.mediaDevices.getUserMedia`; thiếu → ẩn nút gọi, hiển thị lý do.
  - `NotAllowedError` → không gọi/không nghe được, hướng dẫn cấp quyền.
  - Không có micro (`NotFoundError` audio) hoặc micro bị chiếm (`NotReadableError` audio) → caller không gửi invite; callee gửi `call:end { MEDIA_FAILURE }`.
  - Cuộc gọi VIDEO mà camera lỗi (`NotFoundError`/`NotReadableError`/`OverconstrainedError` video) → tiếp tục chỉ audio, vẫn nhận video của người kia.
  - `OverconstrainedError` → thử lại với constraint `{ video: true }` trước khi fallback audio.
  - `devicechange` → nếu thiết bị đang dùng biến mất, lấy thiết bị mặc định và `replaceTrack`, toast "Đã chuyển sang {thiết bị}".
  - `track.onended` → lấy lại 1 lần; audio thất bại → `call:end { MEDIA_FAILURE }`; video thất bại → tắt camera.
  - Cuộc gọi kết thúc khi `getUserMedia` còn chờ → stop track ngay khi promise resolve.
  - Màn hình PREPARING_MEDIA luôn có nút "Hủy" (prompt quyền bị bỏ qua có thể treo promise).
- **AC:** AC-078, AC-079, AC-080. **EC:** EC-CALL-MEDIA-001..013.

#### FR-CALL-010 — Không hỗ trợ gọi nhóm
- **Mô tả:** `call:invite` với conversation GROUP → `VALIDATION_ERROR` "Cuộc gọi nhóm chưa được hỗ trợ" (D-22); UI ẩn nút gọi trong GROUP.
- **AC:** AC-086. **EC:** EC-CALL-SIG-012.

#### FR-CALL-011 — Âm báo cuộc gọi `[NEW]`
- **Mô tả:** Nhạc chuông cho callee (`/sounds/ringtone.mp3`, lặp), âm chờ cho caller (`/sounds/ringback.mp3`, lặp ở RINGING).
- **Quy tắc:** dừng ngay khi rời INITIATED/RINGING. Autoplay bị chặn → hiển thị nút "Chạm để bật âm thanh", màn hình cuộc gọi đến vẫn hiện; tiêu đề tab nhấp nháy "📞 Cuộc gọi đến" khi tab không visible. Âm thanh từ xa dùng `<audio autoplay playsinline>`; nếu `play()` bị từ chối thì cùng nút trên.
- **AC:** AC-093. **EC:** EC-CALL-MEDIA-010.

### 3.7 Security

#### FR-SEC-001 — Mã hóa đường truyền
- HTTPS/WSS bắt buộc (local dùng mkcert), HSTS ở production, media DTLS-SRTP, TURN hỗ trợ `turns:` 443 (kiến trúc §9.1). **AC:** AC-107. **EC:** EC-CALL-MEDIA-009.

#### FR-SEC-002 — Mã hóa lưu trữ AES-256-GCM
- `content` tin DIRECT/GROUP lưu dạng `contentEnc { v, keyId, iv, ct, tag }`, IV 12 byte ngẫu nhiên mỗi lần, AAD `conversationId:messageId` (kiến trúc §9.2). Giải mã lỗi → `content: null`, UI "Không thể hiển thị nội dung tin nhắn này". Giới hạn: server đọc được nội dung, không phải E2EE, không tìm kiếm full-text. **AC:** AC-100. **EC:** —.

#### FR-SEC-003 — Xoay khóa dữ liệu
- Thêm key, đổi `DATA_ENCRYPTION_ACTIVE_KEY_ID`, chạy `job:reencrypt`, gỡ key cũ khi đếm bằng 0 (kiến trúc §9.2.4). **AC:** AC-101. **EC:** —.

#### FR-SEC-004 — Lưu mật khẩu Argon2id
- Argon2id `memoryCost 19456 KiB, timeCost 2, parallelism 1`; rehash khi tham số đổi; `passwordHash` là `select: false`. **AC:** AC-108. **EC:** EC-SEC-005.

#### FR-SEC-005 — Rate limit
- Theo `RATE_LIMITS` (kiến trúc §4.4.1): login 5/60 s/IP+email, register 3/60 s/IP, refresh 30/60 s/IP, `message:send` 20/10 s/user, `call:invite` 5/60 s/user, `typing:*` 20/10 s/user, REST 100/60 s/user, signaling 100/10 s/socket, socket khác 60/10 s/socket, presence subscribe 10/60 s/user, bundle E2EE 10/60 s/user+target. REST vượt → `429` + `Retry-After`; socket → ACK `RATE_LIMITED`. Redis down: auth fail-closed, còn lại limiter bộ nhớ (D-10). **AC:** AC-004, AC-109. **EC:** EC-SEC-005, EC-SEC-008, EC-CALL-SIG-014, EC-INFRA-002.

#### FR-SEC-006 — CSRF, CORS, CSP, header
- Double-submit CSRF cho `/auth/refresh` và `/auth/logout`; cookie `SameSite=Strict`; CORS whitelist `CORS_ORIGINS`; helmet + CSP (kiến trúc §9.6); cấm `dangerouslySetInnerHTML` với dữ liệu người dùng. **AC:** AC-102, AC-106, AC-107. **EC:** EC-SEC-004, EC-MSG-003, EC-MSG-004.

#### FR-SEC-007 — Vệ sinh log
- Không log mật khẩu, token, cookie, nội dung/ciphertext tin nhắn, SDP, ICE candidate, credential TURN, khóa E2EE (pino redact, kiến trúc §11.3). **AC:** AC-104. **EC:** EC-SEC-007.

#### FR-SEC-008 — Phân quyền mọi điểm vào, chống dò ID
- `senderId/userId/deviceId` lấy từ token; mọi handler kiểm quyền (AUTHZ-1..8); người chưa từng là thành viên nhận `404 NOT_FOUND` như hội thoại không tồn tại; join room không cấp quyền đọc dữ liệu. Bí mật Xirsys không có trong bundle client. **AC:** AC-083, AC-103, AC-105. **EC:** EC-SEC-001, EC-SEC-002, EC-SEC-003, EC-SEC-006, EC-MSG-005, EC-GROUP-007.

### 3.8 E2EE (Secret Chat)

#### FR-E2EE-001 — Đăng ký thiết bị và khóa
- **Mô tả:** Sau khi đăng nhập, client (từ M7) tự động sinh khóa Signal và `PUT /e2ee/devices/{deviceId}/keys` nếu IndexedDB chưa có khóa cho user trên device.
- **Quy tắc:** identity key pair, `registrationId`, signed prekey (có chữ ký), `E2EE_ONE_TIME_PREKEY_BATCH` (100) one-time prekey. Khóa riêng chỉ ở IndexedDB, không bao giờ gửi lên server. `deviceId` path phải bằng `did` của token (`FORBIDDEN`). Tối đa `E2EE_MAX_DEVICES_PER_USER` (5) device ACTIVE; vượt → `409 CONFLICT`, UI Cài đặt yêu cầu thu hồi một thiết bị; device đó không dùng được Secret Chat nhưng chat thường vẫn bình thường. Signed prekey xoay mỗi 7 ngày.
- **AC:** AC-110. **EC:** EC-E2EE-006.

#### FR-E2EE-002 — Cấp prekey bundle, tiêu thụ nguyên tử
- **Mô tả:** `GET /e2ee/users/{userId}/bundles`.
- **Quy tắc:** trả bundle cho mọi device ACTIVE của user; mỗi bundle tiêu thụ đúng một one-time prekey bằng thao tác nguyên tử `findOneAndUpdate` (điều kiện `consumedAt: null`, set `consumedAt`), không bao giờ cấp cùng một prekey hai lần. Hết prekey → `oneTimePreKey: null` (X3DH vẫn chạy). Quyền P24; user không có device ACTIVE → `422 E2EE_KEYS_UNAVAILABLE`. Rate limit `e2eeBundle` 10/phút/user+target.
- **AC:** AC-111, AC-116. **EC:** EC-E2EE-001, EC-E2EE-002.

#### FR-E2EE-003 — Bổ sung prekey
- **Mô tả:** Khi số one-time prekey của device < `E2EE_PREKEY_LOW_THRESHOLD` (20), server phát `e2ee:prekeys-low { deviceId, remaining }` (tối đa 1 lần / `E2EE_PREKEYS_LOW_NOTIFY_COOLDOWN_S` = 1 h).
- **Quy tắc:** client sinh thêm 100 prekey (keyId tiếp nối) và `POST /e2ee/devices/{deviceId}/prekeys`; trùng `keyId` → `CONFLICT`. Client cũng kiểm tra số lượng (trả trong response đăng ký/bổ sung) mỗi lần khởi động.
- **AC:** AC-115. **EC:** EC-E2EE-002.

#### FR-E2EE-004 — Gửi/nhận fan-out theo thiết bị
- **Mô tả:** Tạo SECRET: `POST /conversations { type: 'SECRET', memberIds: [peer] }` (một SECRET cho mỗi cặp, D-11; peer không có device ACTIVE → `E2EE_KEYS_UNAVAILABLE`). Gửi: `message:send { kind: 'E2EE', ciphertext }` với envelope `{ v: 1, senderDeviceId, recipients: [{ deviceId, type, body }] }` (kiến trúc §7(h)).
- **Quy tắc:** recipients phải đúng bằng tập device ACTIVE của peer ∪ device ACTIVE khác của người gửi; lệch → `CONFLICT`, client tải lại bundle và mã hóa lại tự động (tối đa 2 lần, sau đó FAILED). Payload SECRET có `content` → `VALIDATION_ERROR`. Server lưu nguyên envelope, mỗi device chỉ nhận phần của mình. Device gửi bị thu hồi → `FORBIDDEN`. UI chỉ hiển thị "Mã hóa đầu-cuối" khi đã có session với ≥ 1 device của peer.
- **AC:** AC-111, AC-112, AC-119, AC-121, AC-122. **EC:** EC-E2EE-001, EC-E2EE-005, EC-E2EE-008, EC-MSG-016.

#### FR-E2EE-005 — Safety number
- **Mô tả:** Cài đặt → hội thoại SECRET → "Xác minh mã an toàn" hiển thị safety number 60 chữ số (12 nhóm 5 chữ số) cho từng device của peer.
- **Quy tắc:** hai bên thấy cùng chuỗi nếu identity key không bị thay thế. Người dùng bấm "Đánh dấu đã xác minh" → lưu trạng thái `verified` cục bộ (IndexedDB) cho cặp (peer device, identity key). MVP không có quét QR.
- **AC:** AC-120. **EC:** —.

#### FR-E2EE-006 — Cảnh báo đổi identity key
- **Mô tả:** Identity key của một device peer khác với bản đã biết.
- **Quy tắc:** hiển thị SYSTEM cục bộ (client-only, không lưu server) "Mã an toàn với {tên} đã thay đổi" và banner; nếu device đó đã `verified` → **chặn gửi** cho tới khi người dùng bấm "Chấp nhận"; nếu chưa verified → chỉ cảnh báo, vẫn gửi được. Chấp nhận cập nhật known identity và xóa `verified`.
- **AC:** AC-113. **EC:** EC-E2EE-003.

#### FR-E2EE-007 — Thu hồi thiết bị
- **Mô tả:** `DELETE /e2ee/devices/{deviceId}` từ Cài đặt → Thiết bị (chỉ device của mình; có thể thu hồi chính device hiện tại).
- **Quy tắc:** `status = REVOKED`, xóa one-time prekey của device, thu hồi session family của device (`DEVICE_REVOKED`), device đó bị đăng xuất. Tin gửi từ device đã thu hồi → `FORBIDDEN`; client nhận envelope từ device REVOKED (biết qua lần tải bundle gần nhất) hiển thị "Tin nhắn từ thiết bị đã bị thu hồi" thay vì nội dung. Peer phát hiện thay đổi ở lần gửi kế tiếp (`CONFLICT`).
- **AC:** AC-117. **EC:** EC-E2EE-005.

#### FR-E2EE-008 — Thiết bị mới không đọc lịch sử Secret Chat cũ (hành vi thiết kế)
- **Mô tả:** Tin SECRET chỉ được mã hóa cho các device ACTIVE tại thời điểm gửi.
- **Quy tắc:** device mới, hoặc device đã xóa IndexedDB (sinh khóa mới), không đọc được tin trước đó: bubble "Tin nhắn được gửi trước khi thiết bị này tham gia". Đây là **hành vi thiết kế**, không phải lỗi. Giải mã thất bại vì lý do khác → "Không thể giải mã tin nhắn này" (`E2EE_DECRYPT_FAILED`, chỉ phía client).
- **AC:** AC-114, AC-118. **EC:** EC-E2EE-004, EC-E2EE-006, EC-E2EE-007.

### 3.9 Trường dữ liệu nghiệp vụ mới phát sinh từ FR (bắt buộc có trong `database_schema.md`)

| Collection | Trường | Từ FR |
|---|---|---|
| `users` | `username` (unique), `displayNameNormalized`, `status: UserStatus`, `privacy.showLastSeen`, `lastSeenAt`, `avatarUrl` | FR-AUTH-001, FR-USER-001/002/004, FR-AUTH-006 |
| `conversations` | `directKey` (unique partial cho DIRECT và SECRET riêng: `type + directKey`), `memberCount`, `lastMessage`, `lastMessageAt`, `deletedAt`, `createdBy`, `idempotencyKey` | FR-CHAT-001, FR-GROUP-001/004 |
| `conversationMembers` | `role`, `joinedAt`, `leftAt`, `lastDeliveredMessageId/At`, `lastReadMessageId/At` | FR-GROUP-*, FR-CHAT-004 |
| `messages` | `clientMessageId`, `contentEnc`, `ciphertext`, `system`, `editedAt`, `deletedAt`, `senderDeviceId` | FR-CHAT-002/007/008/011, FR-E2EE-004 |
| `callHistory` | `callerTabId`, `acceptedDeviceId`, `acceptedTabId`, `endReason`, `connectedAt`, `endedAt`, `durationSec` | FR-CALL-* |
| `userDevices` | `signalDeviceId`, `registrationId`, `identityKey`, `signedPreKey`, `status: DeviceStatus`, `revokedAt` | FR-E2EE-001/007 |

---

## 4. Acceptance criteria

Định dạng: **Given** (tiền điều kiện) / **When** (hành động) / **Then** (kết quả kiểm chứng được). Test ID `TC-AC-<số>`; tầng test: U = unit (Vitest), I = integration (Supertest/socket + mongo-memory replset), E = E2E (Playwright). Người dùng mẫu: alice, bob, carol (seed).

### 4.1 Auth

| ID | FR | Given | When | Then | Tầng |
|---|---|---|---|---|---|
| AC-001 | FR-AUTH-001 | Email `dave@example.com` và username `dave` chưa tồn tại | `POST /auth/register` hợp lệ | `201`, body `AuthResponse`, cookie `hustalo_rt` có `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, cookie `hustalo_csrf` có `Path=/`; DB lưu `passwordHash` dạng `$argon2id$` | I |
| AC-002 | FR-AUTH-001 | Không có user `eve` | Hai request register cùng email gửi song song | Đúng một `201`, request còn lại `409 CONFLICT` với `details.field = 'email'`; DB có đúng 1 user | I |
| AC-003 | FR-AUTH-002 | alice tồn tại | Login sai mật khẩu; login email không tồn tại; login khi alice `LOCKED` | Cả ba trả `401 UNAUTHENTICATED` cùng message "Email hoặc mật khẩu không đúng"; chênh lệch thời gian phản hồi trung vị giữa "sai mật khẩu" và "không tồn tại" < 50 ms | I |
| AC-004 | FR-AUTH-002, FR-SEC-005 | Cùng IP | 6 lần login sai cho `alice@…` trong 60 s | Lần 6 trả `429 RATE_LIMITED` kèm `Retry-After`; login cho email khác cùng IP vẫn được xử lý | I |
| AC-005 | FR-AUTH-003 | alice đã login, có refresh token R1 | `POST /auth/refresh` với R1 + CSRF hợp lệ | `200`, access token mới, cookie R2 ≠ R1; dùng R2 refresh tiếp được | I |
| AC-006 | FR-AUTH-003 | R1 đã xoay thành R2, rồi R2 xoay thành R3; alice có socket đang mở | Gửi refresh với R1 | `401`; family bị thu hồi; R3 cũng không dùng được; socket của session nhận `session:revoked { reason: 'REFRESH_REUSE' }` | I |
| AC-007 | FR-AUTH-003 | alice mở 2 tab | Cả 2 tab gọi refresh trong vòng 1 s | Cả 2 tab có access token hợp lệ, family không bị thu hồi; nếu một request nhận `409 CONFLICT` thì client retry 1 lần và thành công | I, E |
| AC-008 | FR-AUTH-004 | alice đang trong cuộc gọi CONNECTED với bob | alice đăng xuất | `204`; cuộc gọi chuyển `ENDED` với `endReason = LOGOUT`; bob nhận `call:state ENDED`; tab alice về `/login`; outbox IndexedDB của alice còn nguyên | I, E |
| AC-009 | FR-AUTH-005 | alice đăng nhập trên 3 device | Đổi mật khẩu từ device 1 | `204`; device 2, 3 nhận `session:revoked { reason: 'PASSWORD_CHANGED' }` và refresh trả `401`; device 1 vẫn dùng được | I |
| AC-010 | FR-AUTH-006 | alice có 2 socket online | Chạy `user:lock` cho alice | Hai socket nhận `session:revoked { reason: 'ACCOUNT_LOCKED' }` và bị ngắt; REST với access token cũ trả `401`; reconnect bị `connect_error UNAUTHENTICATED` | I |
| AC-011 | FR-AUTH-007 | Socket alice kết nối với token còn 2 s (fake clock) | Tới `exp` | Socket nhận `session:expired`; bị ngắt sau 5 s nếu chưa reconnect; client refresh, reconnect, và tin bob gửi trong lúc đó xuất hiện sau sync | I, E |

### 4.2 User

| ID | FR | Given | When | Then | Tầng |
|---|---|---|---|---|---|
| AC-012 | FR-USER-001 | Có user displayName "Nguyễn Văn Bình", username `binh.nv`; carol đã chặn alice | alice tìm `q=binh`; `q=nguyen`; `q=c`; `q=carol` | Hai lần đầu trả Bình; `q=c` trả `400 VALIDATION_ERROR`; `q=carol` không trả carol | I |
| AC-013 | FR-USER-002 | alice đăng nhập | `PATCH /users/me { displayName: 81 ký tự }`; `{ avatarUrl: "http://x" }`; `{ displayName: "Alice Mới" }` | Hai lần đầu `400 VALIDATION_ERROR`; lần ba `200`, `GET /auth/me` trả tên mới | I |
| AC-014 | FR-USER-003 | DIRECT alice–bob; alice chặn bob | bob gửi `message:send`, `typing:start`, `call:invite`; alice gửi `message:send` | Cả bốn bị từ chối `USER_BLOCKED`; summary của bob có `canMessage: false`, không có `blockedByMe: true`; summary của alice có `blockedByMe: true` | I |
| AC-015 | FR-USER-003 | alice chặn bob, rồi bỏ chặn | bob gửi tin | Tin gửi thành công; `POST`/`DELETE block` lặp lại vẫn `204` | I |
| AC-016 | FR-USER-004 | bob `showLastSeen = false`; alice `true` | bob offline; alice và bob subscribe presence của nhau | alice nhận `lastSeenAt: null` của bob; bob nhận `lastSeenAt: null` của alice (có đi có lại); trạng thái OFFLINE vẫn hiển thị | I |

### 4.3 Chat

| ID | FR | Given | When | Then | Tầng |
|---|---|---|---|---|---|
| AC-017 | FR-CHAT-001 | Chưa có DIRECT alice–bob | alice và bob đồng thời `POST /conversations { type: 'DIRECT' }` cho nhau | Cả hai nhận cùng `conversationId` (một `201`, một `200`); DB có đúng 1 DIRECT | I |
| AC-020 | FR-CHAT-002 | alice và bob online, DIRECT có sẵn | alice gửi "Xin chào" | ACK `ok: true, duplicate: false` trong ≤ 300 ms; bubble alice ✓; bob nhận `message:new` với `senderId = alice`, `createdAt` của server; DB lưu `contentEnc`, không có `content` | I, E |
| AC-021 | FR-CHAT-002 | alice đã gửi tin với `clientMessageId = X`, server đã lưu nhưng ACK bị chặn (test drop ACK) | Client retry cùng X | ACK `duplicate: true` trả cùng `message.id`; DB có đúng 1 tin; bob thấy đúng 1 bubble; alice thấy đúng 1 bubble | I, E |
| AC-022 | FR-CHAT-004 | bob offline | alice gửi 3 tin; bob đăng nhập sau 1 phút | Trong lúc bob offline bubble alice ở ✓; khi bob mở app (sync danh sách) bob gửi `message:delivered` → alice nhận `message:status DELIVERED` cho cả 3 tin → ✓✓ | E |
| AC-023 | FR-CHAT-004 | bob online, tab ở nền | alice gửi tin | bob nhận `message:new`, gửi `message:delivered`; alice thấy ✓✓ (không xanh) | E |
| AC-024 | FR-CHAT-004 | bob có 5 tin chưa đọc từ alice | bob mở hội thoại, tab visible, 5 tin trong viewport | bob gửi `message:read { upToMessageId: tin thứ 5 }`; alice thấy ✓✓ xanh cho cả 5; `unreadCount` của bob = 0 | E |
| AC-025 | FR-CHAT-004 | Tin M đã READ | Client bob gửi `message:delivered` cho M (đến muộn) | ACK `advanced: false`; không phát `message:status`; alice vẫn thấy ✓✓ xanh (không hạ cấp) | I |
| AC-026 | FR-CHAT-005 | alice và bob ở DIRECT | alice gõ liên tục 10 s rồi dừng | Client alice gửi `typing:start` ≤ 4 lần; bob thấy "đang soạn tin…" trong phòng chat và trong preview danh sách; chỉ báo biến mất ≤ 5 s sau lần `typing:start` cuối hoặc ngay khi alice gửi tin | E |
| AC-027 | FR-PRES-001 | alice mở 2 tab (2 socket) | alice đóng tab 1 | bob vẫn thấy alice ONLINE, không nhận `presence:update` nào | I, E |
| AC-028 | FR-CHAT-010 | alice đang mở DIRECT với bob | Ngắt mạng alice 30 s, bob gửi 5 tin trong lúc đó, bật mạng | alice hiển thị banner "Đang kết nối lại…" (sau 2 s); sau reconnect 5 tin xuất hiện đúng thứ tự, không trùng; bob thấy ✓✓ cho 5 tin | E |
| AC-029 | FR-CHAT-002, FR-SEC-008 | carol không thuộc DIRECT alice–bob | carol gửi `message:send` tới conversation đó; carol `GET /conversations/{id}/messages` | Socket ACK `NOT_FOUND`; REST `404 NOT_FOUND` (không phân biệt với id không tồn tại) | I |
| AC-030 | FR-CHAT-007 | alice gửi tin M 5 phút trước | alice `message:edit { M, "Nội dung mới" }` | ACK ok; mọi người tham gia nhận `message:edit` với `editedAt`; UI hiển thị "Đã chỉnh sửa"; DB `contentEnc.iv` khác bản cũ | I, E |
| AC-031 | FR-CHAT-007, FR-CHAT-008 | Tin M của alice tạo 16 phút trước (theo đồng hồ server, đồng hồ client lệch -10 phút) | alice sửa M; alice thu hồi M; bob sửa M | Cả ba ACK `FORBIDDEN`; M không đổi | I |
| AC-032 | FR-CHAT-008 | alice gửi tin M 1 phút trước, M là tin cuối | alice `message:delete { M }`, rồi gửi lại lệnh đó | Lần 1 ACK ok, mọi client hiển thị "Tin nhắn đã bị thu hồi" ở đúng vị trí, preview danh sách chat cũng vậy, DB không còn `contentEnc`; lần 2 ACK ok trả cùng bản, không phát event | I, E |
| AC-033 | FR-USER-003 | DIRECT alice–bob; bob chặn alice; alice có tin PENDING trong outbox | alice online lại, outbox xả | ACK `USER_BLOCKED`; bubble alice → FAILED với ⚠, không retry tự động; composer alice hiển thị "Không thể gửi tin nhắn tới người này" | E |
| AC-034 | FR-GROUP-003 | Nhóm G có alice (OWNER), bob, carol | alice xóa carol trong lúc client carol đang gửi tin | Tin của carol bị từ chối `NOT_A_MEMBER` (FAILED); carol nhận `conversation:member-removed`, G biến khỏi danh sách carol; tin mới trong G không tới carol (kể cả socket carol còn kẹt room `conv:G`) | I, E |
| AC-035 | FR-CHAT-002 | — | Gửi `content` = `""`, `"   "`, `"​​"`, `"\n\t"` | Tất cả ACK `VALIDATION_ERROR`; client vô hiệu nút Gửi cho các giá trị đó | U, I |
| AC-036 | FR-CHAT-002 | — | Gửi 4000 code point emoji 👨‍👩‍👧 (mỗi emoji ZWJ nhiều code point, tổng ≤ 4000 code point); gửi 4001 code point | Lần 1 thành công, hiển thị nguyên vẹn; lần 2 `VALIDATION_ERROR`; client hiển thị bộ đếm khi còn ≤ 200 ký tự | U, I |
| AC-037 | FR-CHAT-003 | Hội thoại có 250 tin | Tải trang mới nhất (30), rồi `before` liên tục tới hết | Nhận đúng 250 tin không trùng, không thiếu, mỗi trang tăng dần theo `(createdAt,_id)`; trang cuối `nextBefore: null`; `limit=101` → `VALIDATION_ERROR`; có cả `before` và `after` → `VALIDATION_ERROR` | I |
| AC-039 | FR-CHAT-009 | alice có 3 hội thoại; bob gửi 120 tin chưa đọc trong DIRECT | alice `GET /conversations` | Sắp theo `lastMessageAt` giảm dần; DIRECT có `unreadCount = 100` (đếm tối đa), UI hiển thị "99+"; preview là 100 code point đầu tin cuối | I, E |
| AC-040 | FR-CHAT-006 | alice offline, outbox có 200 tin PENDING | alice gửi tin thứ 201 | Không thêm vào outbox; toast "Hàng đợi gửi đã đầy. Vui lòng chờ kết nối lại."; 200 tin cũ giữ nguyên | U, E |
| AC-041 | FR-CHAT-006, EC-INFRA-001 | MongoDB dừng | alice gửi tin | ACK `SERVICE_UNAVAILABLE`; bubble giữ PENDING; khi Mongo chạy lại, client retry theo backoff và tin được gửi đúng 1 lần | I, E |
| AC-042 | FR-CHAT-004 | bob mở hội thoại nhưng chuyển sang tab khác | alice gửi tin | bob gửi delivered nhưng **không** gửi read; khi bob quay lại tab (visible + focus) mới gửi read | E |
| AC-043 | FR-CHAT-004 | bob đăng nhập 2 device, có 3 tin chưa đọc | bob đọc ở device 1 | Device 2 nhận `message:status READ` với `byUserId = bob`, badge chưa đọc về 0 trong ≤ 1 s | E |

### 4.4 Group

| ID | FR | Given | When | Then | Tầng |
|---|---|---|---|---|---|
| AC-050 | FR-GROUP-001, FR-CHAT-011 | alice, bob, carol tồn tại | alice tạo nhóm "Dự án" với [bob, carol, bob] | `201`; alice OWNER, bob và carol MEMBER (bob không bị thêm hai lần); SYSTEM "alice đã tạo nhóm" và "alice đã thêm bob, carol"; bob và carol nhận `conversation:updated { change: 'CREATED' }` | I |
| AC-051 | FR-GROUP-002 | Nhóm có 98 thành viên | ADMIN thêm 3 người | `422 CONVERSATION_FULL`; không ai được thêm; `memberCount` = 98 | I |
| AC-052 | FR-GROUP-002 | dave đã chặn alice; bob đã trong nhóm | alice thêm [bob, dave, frank, frank] | `200`; `added` = [frank]; `skipped` = [{bob, CONFLICT}, {dave, USER_BLOCKED}] | I |
| AC-053 | FR-GROUP-004 | alice là OWNER nhóm có 3 thành viên | alice rời nhóm | `409 CONFLICT` "Bạn cần chuyển quyền trưởng nhóm trước khi rời nhóm"; alice vẫn là OWNER | I |
| AC-054 | FR-GROUP-004 | Như AC-053 | alice chuyển OWNER cho bob, rồi rời | bob OWNER, alice ADMIN rồi rời thành công; SYSTEM "alice đã chuyển quyền trưởng nhóm cho bob" và "alice đã rời nhóm" | I |
| AC-055 | FR-GROUP-003, FR-GROUP-006 | bob ADMIN, alice OWNER | bob xóa alice; bob `PATCH role MEMBER` cho alice; bob xóa ADMIN khác | Cả ba `403 FORBIDDEN` | I |
| AC-056 | FR-GROUP-005 | bob ADMIN | bob đổi tên thành chuỗi 101 ký tự; đổi thành "Nhóm mới"; carol (MEMBER) đổi tên | `400`; `200` + SYSTEM + `conversation:updated`; `403 FORBIDDEN` | I |
| AC-057 | FR-GROUP-003 | carol bị xóa khỏi G | carol `GET /conversations/G`, `conversation:join G`, `message:send` vào G | REST `403 NOT_A_MEMBER`; socket ACK `NOT_A_MEMBER`; carol không nhận `message:new` của G | I |
| AC-058 | FR-GROUP-002 | Nhóm có 97 thành viên; alice (OWNER) và bob (ADMIN) | Cùng lúc mỗi người thêm 2 người khác nhau | Đúng một request thành công (`memberCount` = 99), request còn lại `422 CONVERSATION_FULL`; không bao giờ `memberCount > 100` | I |
| AC-059 | FR-GROUP-006 | carol MEMBER | alice (OWNER) đặt carol ADMIN, rồi về MEMBER | Hai lần `200` + SYSTEM `ROLE_CHANGED`; bob (ADMIN) làm tương tự → `403` | I |

### 4.5 Presence

| ID | FR | Given | When | Then | Tầng |
|---|---|---|---|---|---|
| AC-060 | FR-PRES-001 | bob đã subscribe presence alice, alice offline | alice mở 2 tab gần như đồng thời | bob nhận đúng một `presence:update ONLINE` | I |
| AC-061 | FR-PRES-001, FR-PRES-002 | alice online 1 tab | alice đóng tab; mở lại sau 5 s; đóng lại và chờ 15 s | Lần mở lại trong 10 s: bob không nhận OFFLINE; lần sau: bob nhận OFFLINE trong 10–12 s, `lastSeenAt` xấp xỉ thời điểm đóng | I |
| AC-062 | FR-PRES-001 | alice online | Process client của alice bị kill (không disconnect sạch) | bob nhận OFFLINE trong ≤ 60 s | I |
| AC-063 | FR-PRES-003 | alice không có hội thoại chung với frank; bob chặn alice | alice subscribe [bob, carol, frank] (carol có chung nhóm) | `accepted` = [carol]; `presence:snapshot` chỉ chứa carol | I |

### 4.6 Call

| ID | FR | Given | When | Then | Tầng |
|---|---|---|---|---|---|
| AC-070 | FR-CALL-001 | alice và bob online, Chromium fake media | alice gọi thoại, bob trả lời | Trạng thái lần lượt INITIATED → RINGING → ACCEPTED → CONNECTING → CONNECTED ở cả hai; âm thanh hai chiều (`inbound-rtp` audio `bytesReceived` tăng ở cả hai); `callHistory` có `connectedAt`; kết thúc tạo SYSTEM "Cuộc gọi thoại · mm:ss" | E |
| AC-071 | FR-CALL-002 | Như AC-070 | alice gọi video | Cả hai nhận video (`framesDecoded > 0`), PiP local hiển thị; tắt camera → bên kia hiển thị avatar trong ≤ 2 s; p95 thời gian ACCEPTED → CONNECTED ≤ 5 s (20 lần chạy) | E |
| AC-072 | FR-CALL-004 | bob nhận `call:incoming` trên 2 tab | bob từ chối ở tab 1 | Cuộc gọi REJECTED; tab 2 dừng chuông; alice thấy "Người nhận đã từ chối cuộc gọi"; không tạo SYSTEM message | E |
| AC-073 | FR-CALL-004 | bob online không trả lời | Chờ 45 s | Cuộc gọi MISSED/TIMEOUT trong 45–47 s; alice thấy "Không có người trả lời"; bob thấy toast "Cuộc gọi nhỡ từ alice" và SYSTEM "Cuộc gọi … nhỡ" tính vào `unreadCount` | I, E |
| AC-074 | FR-CALL-004 | bob đang trong cuộc gọi với carol | alice gọi bob | ACK `CALL_BUSY`; alice thấy "Người nhận đang bận"; bob nhận `call:busy` (toast "alice vừa gọi cho bạn"); cuộc gọi bob–carol không bị ảnh hưởng | I, E |
| AC-075 | FR-CALL-004 | Cuộc gọi đang RINGING | alice hủy | CANCELLED; màn hình bob đóng, toast "Cuộc gọi nhỡ từ alice"; không tạo SYSTEM message | E |
| AC-076 | FR-CALL-003 | bob online 2 device | bob trả lời ở device 1 | Device 2 nhận `call:answered-elsewhere`, dừng chuông, toast "Đã trả lời trên thiết bị khác"; device 2 gửi `call:accept` → `CALL_ALREADY_ANSWERED`; offer/ICE chỉ tới device 1 | I, E |
| AC-077 | FR-CALL-005 | alice và bob online | Cả hai `call:invite` trong vòng 50 ms | Đúng một `callHistory`; một ACK `merged: false`, ACK kia `merged: true, status: 'ACCEPTED'`; cuộc gọi đạt CONNECTED mà không cần ai bấm trả lời | I, E |
| AC-078 | FR-CALL-009 | Trình duyệt alice không có micro (Playwright không cấp thiết bị audio) | alice bấm gọi thoại | Không gửi `call:invite`; hiển thị thông báo lỗi NotFoundError audio (văn bản theo `ui_ux_spec.md`) | E |
| AC-079 | FR-CALL-009 | alice có micro nhưng không có camera | alice gọi video | Cuộc gọi vẫn được thực hiện; `callType = VIDEO`; alice nhận video của bob; bob thấy avatar alice | E |
| AC-080 | FR-CALL-009 | Quyền camera/micro bị từ chối (`permissions: []`) | bob trả lời cuộc gọi | bob gửi `call:end { MEDIA_FAILURE }`; cuộc gọi FAILED/MEDIA_FAILURE; bob thấy hướng dẫn cấp quyền; alice thấy "Cuộc gọi kết thúc do lỗi thiết bị âm thanh/hình ảnh" | E |
| AC-081 | FR-CALL-006 | Cuộc gọi CONNECTED | Chặn mạng alice 8 s (Playwright `context.setOffline`) rồi mở lại | Cả hai thấy "Đang kết nối lại…" (RECONNECTING); sau khi mở lại, ICE restart (`call:ice-restart attempt 1`, offer revision 2) và về CONNECTED trong ≤ 10 s; không tạo cuộc gọi mới | E |
| AC-082 | FR-CALL-006 | Cuộc gọi CONNECTED | Chặn mạng alice 30 s | Server chuyển ENDED/NETWORK_FAILURE trong 20–22 s kể từ RECONNECTING; bob thấy "Cuộc gọi bị gián đoạn do mất kết nối"; khi alice có mạng lại, tab alice nhận trạng thái terminal và đóng pc | I, E |
| AC-083 | FR-CALL-003, FR-SEC-008 | Cuộc gọi alice–bob CONNECTED | carol gửi `call:offer`/`call:ice-candidate`/`call:end` với callId đó; tab thứ hai của bob gửi `call:ice-candidate` | carol: ACK `CALL_NOT_FOUND`; tab bob không tham gia: ACK `FORBIDDEN`; không có relay nào tới alice | I |
| AC-084 | FR-CALL-004 | Cuộc gọi đã ENDED | alice gửi `call:end` lần nữa; bob gửi `call:end` | Cả hai ACK ok trả `status: 'ENDED'` và `endReason` gốc; không phát thêm `call:state`; không tạo SYSTEM message thứ hai | I |
| AC-085 | FR-CALL-007 | `ICE_TRANSPORT_POLICY=relay`, coturn local chạy | alice gọi video bob | Cuộc gọi CONNECTED; `chrome://webrtc-internals`/`getStats` cho thấy cặp candidate được chọn có `candidateType = relay` ở ít nhất một phía | E |
| AC-086 | FR-CALL-010 | Nhóm G | Gửi `call:invite { conversationId: G }` | ACK `VALIDATION_ERROR` "Cuộc gọi nhóm chưa được hỗ trợ"; UI phòng chat nhóm không có nút gọi | I, E |
| AC-087 | FR-USER-003 | alice chặn bob | bob gọi alice; alice gọi bob | Cả hai ACK `USER_BLOCKED`; không có `callHistory` | I |
| AC-088 | FR-CALL-003 | bob offline | alice gọi; bob đăng nhập sau 15 s | alice thấy "Đang gọi…" (INITIATED); khi bob kết nối, bob nhận `call:incoming` và đổ chuông; trạng thái chuyển RINGING; trả lời được trước khi hết 45 s tính từ lúc alice gọi | I, E |
| AC-089 | FR-CALL-004 | Cuộc gọi đã MISSED | bob gửi `call:accept` | ACK `CALL_TIMEOUT`; bob thấy "Cuộc gọi đã kết thúc" | I |
| AC-090 | FR-CALL-007 | Xirsys trả lỗi 500 (mock) | `GET /calls/ice-servers` | `200`, `source: 'FALLBACK'`, `iceServers` chứa `STUN_URLS` và coturn; metric `hustalo_ice_servers_fallback_total` tăng; response không chứa `XIRSYS_SECRET` | I |
| AC-091 | FR-CALL-008 | alice và bob có 3 cuộc gọi (CONNECTED rồi ENDED, MISSED, REJECTED) | alice `GET /calls` | 3 record sắp mới nhất trước, `direction` đúng theo alice, `durationSec` chỉ có ở cuộc gọi đã kết nối; hội thoại có đúng 2 SYSTEM (`CALL_ENDED`, `CALL_MISSED`) | I |
| AC-092 | FR-CALL-006 | Cuộc gọi CONNECTED | Restart process server (Redis giữ nguyên) | Media không gián đoạn (`bytesReceived` tiếp tục tăng); sau khi socket reconnect và gửi `call:state`, trạng thái vẫn CONNECTED; kết thúc bình thường sau đó | E |
| AC-093 | FR-CALL-011 | Trình duyệt chặn autoplay (chưa có tương tác) | bob nhận `call:incoming` | Màn hình cuộc gọi đến hiển thị kèm nút "Chạm để bật âm thanh"; bấm nút → nhạc chuông phát; trả lời được không cần bấm nút đó | E |

### 4.7 Security

| ID | FR | Given | When | Then | Tầng |
|---|---|---|---|---|---|
| AC-100 | FR-SEC-002 | alice gửi tin DIRECT "bí mật 123" | Đọc document `messages` trực tiếp từ Mongo; đổi `conversationId` trong AAD khi giải mã | Không chuỗi "bí mật 123" trong document; có `contentEnc { v: 1, keyId, iv (16 ký tự base64 = 12 byte), ct, tag }`; giải mã với AAD sai ném lỗi | U, I |
| AC-101 | FR-SEC-003 | 1000 tin mã hóa bằng `k1` | Thêm `k2`, đặt active `k2`, chạy `job:reencrypt --from k1`, ngắt giữa chừng rồi chạy lại với `--after` | Sau job: 0 tin còn `keyId = k1`; mọi tin giải mã đúng; tin sửa trong lúc job chạy không bị ghi đè | I |
| AC-102 | FR-SEC-006 | alice có cookie hợp lệ | `POST /auth/refresh` không có `X-CSRF-Token` hoặc sai giá trị | `403 FORBIDDEN`; token không bị xoay | I |
| AC-103 | FR-SEC-008 | carol chưa từng thuộc conversation C; id ngẫu nhiên R không tồn tại | carol `GET /conversations/C` và `GET /conversations/R` | Cả hai `404 NOT_FOUND` với body giống nhau (trừ `requestId`) | I |
| AC-104 | FR-SEC-007 | Bật log capture | Chạy luồng register → login → gửi tin → gọi video → refresh | Log không chứa mật khẩu, access/refresh token, nội dung tin, chuỗi `a=fingerprint`/`candidate:` hay credential TURN | I |
| AC-105 | FR-SEC-008 | `.env` server có `XIRSYS_SECRET` | `npm run build` | `check-bundle-secrets.mjs` pass: `client/dist` không chứa giá trị secret server; nếu cố ý thêm `VITE_XIRSYS_SECRET` thì build fail | I |
| AC-106 | FR-SEC-006 | — | alice gửi `<img src=x onerror=alert(1)>` và chuỗi có U+202E | bob thấy nguyên văn dạng text, không chạy script, bố cục bubble không bị đảo chiều | E |
| AC-107 | FR-SEC-001, FR-SEC-006 | Server chạy | Gọi API từ origin không có trong `CORS_ORIGINS`; kiểm tra header response | Không có `Access-Control-Allow-Origin`; có `Content-Security-Policy` (HTML), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` | I |
| AC-108 | FR-SEC-004 | User tạo với tham số Argon2 cũ (`timeCost=1`) | User đăng nhập thành công | `passwordHash` được rehash với `timeCost=2`; `GET /auth/me` không bao giờ chứa `passwordHash` | I |
| AC-109 | FR-SEC-005 | Redis dừng | Login; gửi 25 tin trong 10 s | Login `503 SERVICE_UNAVAILABLE`; 20 tin đầu thành công, từ tin 21 `RATE_LIMITED` (limiter bộ nhớ) | I |

### 4.8 E2EE

| ID | FR | Given | When | Then | Tầng |
|---|---|---|---|---|---|
| AC-110 | FR-E2EE-001 | alice đăng nhập lần đầu trên device X (M7) | Client khởi tạo | `PUT /e2ee/devices/X/keys` với 100 one-time prekey; IndexedDB có khóa riêng; request không chứa trường private nào; gọi với `deviceId ≠ did` → `403 FORBIDDEN` | I, E |
| AC-111 | FR-E2EE-002, FR-E2EE-004 | alice (device X) và bob (device Y, Z) đã đăng ký khóa | alice tạo SECRET và gửi "chào" | bundles trả 2 device; mỗi one-time prekey đã cấp có `consumedAt` khác null và không bao giờ được cấp lại; envelope có 2 recipient type 3; Y và Z đều giải mã được "chào"; tin tiếp theo type 1; UI cả hai hiển thị "Mã hóa đầu-cuối" | E |
| AC-112 | FR-E2EE-004 | frank chưa có device ACTIVE | alice tạo SECRET với frank | `422 E2EE_KEYS_UNAVAILABLE`; UI "Người nhận chưa bật trò chuyện bí mật" | I, E |
| AC-113 | FR-E2EE-006 | alice đã xác minh safety number với device Y của bob | bob xóa IndexedDB trên Y và đăng ký lại (identity mới) | alice thấy "Mã an toàn với bob đã thay đổi"; nút gửi bị khóa tới khi alice bấm "Chấp nhận"; sau đó gửi được và trạng thái `verified` bị xóa | E |
| AC-114 | FR-E2EE-008 | Ciphertext bị sửa 1 byte (test hook) | bob nhận tin | bubble "Không thể giải mã tin nhắn này"; các tin khác không bị ảnh hưởng | U, E |
| AC-115 | FR-E2EE-003 | device Y còn 20 one-time prekey | 1 lần lấy bundle làm còn 19 | Y nhận `e2ee:prekeys-low { remaining: 19 }` đúng một lần trong 1 h; Y upload 100 prekey mới; tổng còn 119 | I |
| AC-116 | FR-E2EE-002 | device Y còn 0 one-time prekey | alice lấy bundle | `oneTimePreKey: null`; session vẫn thiết lập và giải mã thành công | I, E |
| AC-117 | FR-E2EE-007 | bob có device Y, Z | bob thu hồi Z từ Y | Z bị đăng xuất (`session:revoked { DEVICE_REVOKED }`); tin alice gửi tiếp theo đầu tiên nhận `CONFLICT`, client tự tải lại bundle và gửi thành công chỉ cho Y; tin giả lập gửi từ Z → `FORBIDDEN` | I, E |
| AC-118 | FR-E2EE-008 | Lịch sử SECRET có 10 tin | bob đăng nhập device W mới | W hiển thị 10 bubble "Tin nhắn được gửi trước khi thiết bị này tham gia"; tin mới sau khi W đăng ký khóa đọc được | E |
| AC-119 | FR-E2EE-004 | SECRET alice–bob | Gửi `message:send` kind `E2EE` có thêm `content`; gửi kind `PLAINTEXT` vào SECRET | Cả hai ACK `VALIDATION_ERROR` | I |
| AC-120 | FR-E2EE-005 | SECRET đã có session | alice và bob mở "Xác minh mã an toàn" | Hai bên hiển thị cùng 60 chữ số chia 12 nhóm 5; bấm "Đánh dấu đã xác minh" lưu trạng thái | E |
| AC-121 | FR-E2EE-004 | bob vừa đăng ký device mới V sau khi alice lấy bundle | alice gửi tin với envelope thiếu V | ACK `CONFLICT`; client alice tự tải lại bundle, gửi lại có V; bubble chỉ PENDING trong lúc đó | I, E |
| AC-122 | FR-E2EE-004 | SECRET vừa tạo, chưa gửi tin nào | alice mở hội thoại | Header hiển thị "Đang thiết lập mã hóa…", không hiển thị "Mã hóa đầu-cuối" cho tới khi session thiết lập với ≥ 1 device của bob | E |

---

## 5. Ma trận edge case

ID khớp registry `system_architecture.md` Phụ lục C (104 dòng, 11 nhóm). "Trạng thái UI" ghi chuỗi tiếng Việt chính hoặc tên thành phần UI; `ui_ux_spec.md` dùng đúng các chuỗi này. "—" ở cột Mã lỗi nghĩa là không trả lỗi.

### 5.1 AUTH

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-AUTH-001 | AUTH | Hai request đăng ký cùng email/username đua nhau | Unique index; request thua bắt `E11000` → 409 với `details.field` | Hiển thị lỗi tại trường tương ứng | "Email này đã được sử dụng" / "Tên người dùng đã tồn tại" | CONFLICT | TC-AUTH-001 |
| EC-AUTH-002 | AUTH | Access token hết hạn giữa phiên socket | Hẹn giờ `exp` → `session:expired` → ngắt sau 5 s | Refresh rồi reconnect, chạy sync | Không hiển thị gì nếu refresh thành công trong 2 s; ngược lại banner "Đang kết nối lại…" | TOKEN_EXPIRED | TC-AUTH-002 |
| EC-AUTH-003 | AUTH | Refresh đồng thời từ 2 tab | Token vừa xoay trong 10 s → 409, không thu hồi | Web Locks; nhận 409 → đọc cookie mới, retry 1 lần | Không hiển thị gì | CONFLICT | TC-AUTH-003 |
| EC-AUTH-004 | AUTH | Refresh token bị đánh cắp được dùng lại | Thu hồi cả family, `session:revoked REFRESH_REUSE`, kết thúc cuộc gọi của session | Xóa token, về `/login` | Modal "Phiên đăng nhập đã bị thu hồi vì lý do bảo mật. Vui lòng đăng nhập lại." | UNAUTHENTICATED | TC-AUTH-004 |
| EC-AUTH-005 | AUTH | Tài khoản bị khóa khi đang có socket | Thu hồi mọi family, ngắt socket, kết thúc cuộc gọi LOGOUT | Về `/login` | Modal "Tài khoản của bạn đã bị khóa." | UNAUTHENTICATED | TC-AUTH-005 |
| EC-AUTH-006 | AUTH | Đổi mật khẩu khi có phiên khác | Thu hồi mọi family khác `PASSWORD_CHANGED` | Phiên khác về `/login`; phiên hiện tại giữ nguyên | Phiên khác: modal "Mật khẩu đã được thay đổi. Vui lòng đăng nhập lại."; phiên hiện tại: toast "Đã đổi mật khẩu" | UNAUTHENTICATED (phiên khác) | TC-AUTH-006 |
| EC-AUTH-007 | AUTH | Logout khi đang gọi | Kết thúc cuộc gọi `LOGOUT` (ENDED hoặc CANCELLED), phát `call:state` | Đóng pc, stop track, về `/login` | Bên kia: "Cuộc gọi đã kết thúc" | — | TC-AUTH-007 |

### 5.2 NET

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-NET-001 | NET | Mất mạng đột ngột | Phát hiện qua ping timeout, drop presence lease | Tạm dừng outbox, tin mới PENDING, Socket.IO tự reconnect | Banner "Đang kết nối lại…" (sau 2 s); `navigator.onLine=false` → "Không có kết nối mạng" | — | TC-NET-001 |
| EC-NET-002 | NET | Reconnect liên tục (flapping) | Presence grace 10 s tránh nhấp nháy | Banner trễ 2 s; sync debounce 500 ms + generation counter | Banner không nhấp nháy | — | TC-NET-002 |
| EC-NET-003 | NET | Server restart | Tin đã ACK nằm trong Mongo; deadline cuộc gọi trong Redis | `recovered=false` → sync đầy đủ, xả outbox | Banner "Đang kết nối lại…" rồi ẩn | — | TC-NET-003 |
| EC-NET-004 | NET | ACK bị mất sau khi đã persist | Retry cùng `clientMessageId` → trả bản cũ, `duplicate: true` | Hợp nhất theo `clientMessageId`, không tạo bubble thứ hai | Bubble PENDING → ✓ | — (DUPLICATE_MESSAGE) | TC-NET-004 |
| EC-NET-005 | NET | Event đến sai thứ tự | Gắn `occurredAt`, `call:state.version` | Sắp tin theo `(createdAt,_id)`, receipt áp `max`, bỏ `call:state` có version cũ | Thứ tự hiển thị đúng | — | TC-NET-005 |
| EC-NET-006 | NET | Event trùng | Mỗi event có `eventId` duy nhất | LRU dedupe 1000 `eventId`, dedupe tin theo `_id` | Không có bubble trùng | — | TC-NET-006 |
| EC-NET-007 | NET | Reconnect trong lúc đang fetch lịch sử | Phục vụ bình thường | Kết quả của generation cũ bị bỏ, fetch lại | Spinner tải lịch sử | — | TC-NET-007 |
| EC-NET-008 | NET | Tab chạy nền bị throttle timer | Lease presence do server gia hạn | Flush outbox khi `visibilitychange → visible` và sự kiện `online` | Vẫn ONLINE với người khác | — | TC-NET-008 |
| EC-NET-009 | NET | Máy ngủ rồi thức | Socket cũ đã bị drop | Phát hiện khoảng trống thời gian > 45 s → `disconnect().connect()`, sync | Banner "Đang kết nối lại…" ngắn | — | TC-NET-009 |
| EC-NET-010 | NET | Proxy chặn WebSocket | Phục vụ HTTP long-polling cùng path | `transports: ['websocket','polling']`, `tryAllTransports` | Hoạt động bình thường | — | TC-NET-010 |

### 5.3 MSG

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-MSG-001 | MSG | Tin rỗng hoặc chỉ khoảng trắng/zero-width | Zod `normalizedText` từ chối | Vô hiệu nút Gửi, Enter không làm gì | Nút Gửi mờ | VALIDATION_ERROR | TC-MSG-001 |
| EC-MSG-002 | MSG | Vượt 4000 code point | Từ chối | Bộ đếm hiện khi còn ≤ 200; vượt → vô hiệu nút Gửi | "{n}/4000" màu danger | VALIDATION_ERROR | TC-MSG-002 |
| EC-MSG-003 | MSG | Emoji ZWJ, Unicode tổ hợp, zero-width giữa chuỗi, RTL override | NFC, đếm code point, lưu nguyên | `dir="auto"`, `unicode-bidi: isolate` | Hiển thị đúng, không đảo bố cục | — | TC-MSG-003 |
| EC-MSG-004 | MSG | Payload XSS | Lưu nguyên văn | Render text node, cấm `dangerouslySetInnerHTML` | Hiển thị nguyên chuỗi | — | TC-MSG-004 |
| EC-MSG-005 | MSG | Payload chứa `senderId`/`createdAt` giả | `.strict()` từ chối | Client không bao giờ gửi các trường này | — | VALIDATION_ERROR | TC-MSG-005 |
| EC-MSG-006 | MSG | `clientMessageId` không phải UUID v4 | Từ chối | Luôn sinh bằng `crypto.randomUUID()` | Bubble FAILED nếu xảy ra | VALIDATION_ERROR | TC-MSG-006 |
| EC-MSG-007 | MSG | Outbox đầy 200 tin | — | Không enqueue tin mới | Toast "Hàng đợi gửi đã đầy. Vui lòng chờ kết nối lại." | — | TC-MSG-007 |
| EC-MSG-008 | MSG | `message:status` đến trước `message:new` | Phát bình thường | Lưu pending receipt (≤ 500, 60 s), áp khi tin đến | Tin hiện ngay với trạng thái đúng | — | TC-MSG-008 |
| EC-MSG-009 | MSG | Read receipt khi tab không hiển thị | Chỉ nhận receipt do client gửi | Chỉ gửi read khi visible + focus + trong viewport ≥ 50% | Người gửi thấy ✓✓ (chưa xanh) | — | TC-MSG-009 |
| EC-MSG-010 | MSG | Bị xóa khỏi nhóm khi đang gửi dở | Re-check member trong transaction → abort | Bubble FAILED, không retry | ⚠ "Bạn không còn là thành viên của nhóm này" | NOT_A_MEMBER | TC-MSG-010 |
| EC-MSG-011 | MSG | Gửi tới người đã chặn mình (DIRECT/SECRET) | Từ chối | Bubble FAILED; composer bị khóa | "Không thể gửi tin nhắn tới người này" | USER_BLOCKED | TC-MSG-011 |
| EC-MSG-012 | MSG | Lệch đồng hồ giữa thiết bị | Gán `createdAt` server, cửa sổ sửa theo giờ server | Hiển thị giờ server; ẩn nút sửa theo ước lượng `server-clock.ts` | Thứ tự đúng giữa các thiết bị | — | TC-MSG-012 |
| EC-MSG-013 | MSG | Đang cuộn lên khi có tin mới | — | Không tự cuộn; đếm tin mới | Nút "Tin mới ↓" kèm số lượng | — | TC-MSG-013 |
| EC-MSG-014 | MSG | Cùng hội thoại mở trên nhiều thiết bị | Fan-out tới mọi tab; `message:status` READ tới user room người đọc | Đồng bộ badge chưa đọc | Badge về 0 trên mọi thiết bị | — | TC-MSG-014 |
| EC-MSG-015 | MSG | Sửa/thu hồi sau 15 phút | Từ chối theo `createdAt` server | Ẩn mục "Sửa"/"Thu hồi" sau 15 phút | Toast "Chỉ có thể sửa hoặc thu hồi tin trong 15 phút" | FORBIDDEN | TC-MSG-015 |
| EC-MSG-016 | MSG | SECRET có `content`, hoặc DIRECT/GROUP có `ciphertext` | Từ chối | Client luôn chọn `kind` theo loại hội thoại | Bubble FAILED | VALIDATION_ERROR | TC-MSG-016 |
| EC-MSG-017 | MSG | Sửa tin trong SECRET | Từ chối (D-16) | Không hiển thị mục "Sửa" trong SECRET | — | FORBIDDEN | TC-MSG-017 |

### 5.4 GROUP

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-GROUP-001 | GROUP | Thêm vượt 100 thành viên | Không thêm ai | Chặn chọn quá số chỗ còn lại | "Nhóm đã đạt tối đa 100 thành viên" | CONVERSATION_FULL | TC-GROUP-001 |
| EC-GROUP-002 | GROUP | Danh sách thêm có trùng hoặc đã là thành viên | Khử trùng; thành viên cũ vào `skipped` | Lọc trùng trước khi gửi | Toast "Đã thêm {n} thành viên" (+ "{m} người đã có trong nhóm") | — | TC-GROUP-002 |
| EC-GROUP-003 | GROUP | Thêm người đã chặn mình | Người đó vào `skipped` với `USER_BLOCKED` | Hiển thị danh sách bỏ qua | "Không thể thêm {tên}" | — (từng mục: USER_BLOCKED) | TC-GROUP-003 |
| EC-GROUP-004 | GROUP | OWNER rời nhóm khi còn thành viên khác | Từ chối | Mở hộp thoại chọn trưởng nhóm mới | "Bạn cần chuyển quyền trưởng nhóm trước khi rời nhóm" | CONFLICT | TC-GROUP-004 |
| EC-GROUP-005 | GROUP | ADMIN xóa hoặc hạ quyền OWNER | Từ chối | Không hiển thị thao tác đó cho ADMIN | — | FORBIDDEN | TC-GROUP-005 |
| EC-GROUP-006 | GROUP | Hai admin thao tác cùng lúc | Transaction + update có điều kiện `memberCount`; mọi thay đổi có `conversation:updated` | Áp dữ liệu mới nhất theo event | Danh sách thành viên nhất quán | CONVERSATION_FULL (nếu vượt) | TC-GROUP-006 |
| EC-GROUP-007 | GROUP | Thành viên bị xóa vẫn còn trong socket room | `socketsLeave`, fan-out theo DB, mọi handler kiểm AUTHZ-2 | Nhận `conversation:member-removed` → xóa khỏi danh sách, đóng phòng chat | "Bạn đã bị xóa khỏi nhóm {tên}" | NOT_A_MEMBER | TC-GROUP-007 |

### 5.5 PRES

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-PRES-001 | PRES | Một user mở nhiều tab | Lease riêng mỗi socket; chỉ phát khi 0↔≥1 | — | Chấm xanh ổn định | — | TC-PRES-001 |
| EC-PRES-002 | PRES | Một tab đóng, tab khác còn mở | Còn lease → không phát OFFLINE | — | Vẫn ONLINE | — | TC-PRES-002 |
| EC-PRES-003 | PRES | Client crash không gửi disconnect | Ping timeout ≤ 45 s hoặc lease hết hạn ≤ 60 s → OFFLINE | — | OFFLINE trong ≤ 60 s | — | TC-PRES-003 |
| EC-PRES-004 | PRES | Ẩn lastSeen | `lastSeenAt: null`, có đi có lại | Không hiển thị dòng lastSeen | Chỉ "Đang hoạt động" hoặc không gì | — | TC-PRES-004 |
| EC-PRES-005 | PRES | Redis mất dữ liệu / không truy cập được | Mất dữ liệu: tự phục hồi ≤ 20 s; không truy cập được: `degraded: true` | Ẩn chấm online khi `degraded` | Không hiển thị trạng thái hoạt động | — | TC-PRES-005 |

### 5.6 CALL-SIG

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-CALL-SIG-001 | CALL-SIG | Gọi người đang offline | INITIATED; giao `call:incoming` khi callee online trong 45 s; hết giờ → MISSED | Caller chờ | "Đang gọi…" → "Không có người trả lời" | — | TC-CALL-SIG-001 |
| EC-CALL-SIG-002 | CALL-SIG | Gọi người đang bận | Ghi BUSY, `call:busy` tới callee, SYSTEM `CALL_MISSED` | Caller dừng, giải phóng media | Caller: "Người nhận đang bận"; callee: toast "{tên} vừa gọi cho bạn" | CALL_BUSY | TC-CALL-SIG-002 |
| EC-CALL-SIG-003 | CALL-SIG | Glare | Gộp thành một cuộc gọi, ACK `merged: true` | Bên nhận `merged` chuyển thẳng vào cuộc gọi đó | "Đang kết nối…" | — | TC-CALL-SIG-003 |
| EC-CALL-SIG-004 | CALL-SIG | Đổ chuông trên nhiều thiết bị | `call:incoming` tới mọi tab callee | Tất cả đổ chuông | Màn hình cuộc gọi đến trên mọi tab | — | TC-CALL-SIG-004 |
| EC-CALL-SIG-005 | CALL-SIG | Accept và cancel đến cùng lúc | CAS: cái đến trước thắng; cancel sau accept → HANGUP | Bên thua nhận trạng thái terminal | "Cuộc gọi đã kết thúc" | CALL_INVALID_STATE (accept thua) | TC-CALL-SIG-005 |
| EC-CALL-SIG-006 | CALL-SIG | Accept sau khi đã hết giờ | Từ chối | Đóng màn hình, stop track | "Cuộc gọi đã kết thúc" | CALL_TIMEOUT | TC-CALL-SIG-006 |
| EC-CALL-SIG-007 | CALL-SIG | Offer đến khi `signalingState` không phù hợp | Server kiểm `revision` | Guard theo `signalingState` và revision, bỏ offer/answer cũ | Không đổi | CALL_INVALID_STATE (revision sai) | TC-CALL-SIG-007 |
| EC-CALL-SIG-008 | CALL-SIG | ICE candidate đến trước remote description | Relay bình thường | Đưa vào hàng đợi (≤ 200), xả sau `setRemoteDescription` | Không đổi | — | TC-CALL-SIG-008 |
| EC-CALL-SIG-009 | CALL-SIG | Candidate trùng | Relay bình thường | Dedupe theo chuỗi candidate | Không đổi | — | TC-CALL-SIG-009 |
| EC-CALL-SIG-010 | CALL-SIG | Replay signaling của cuộc gọi cũ | callId không còn → từ chối; revision cũ → từ chối | Bỏ qua event của callId không phải cuộc gọi hiện tại | Không đổi | CALL_NOT_FOUND / CALL_INVALID_STATE | TC-CALL-SIG-010 |
| EC-CALL-SIG-011 | CALL-SIG | Người không tham gia gửi signaling | Không relay | — | — | CALL_NOT_FOUND (không phải caller/callee) / FORBIDDEN (sai tab) | TC-CALL-SIG-011 |
| EC-CALL-SIG-012 | CALL-SIG | Gọi trong hội thoại GROUP | Từ chối | Ẩn nút gọi | — | VALIDATION_ERROR | TC-CALL-SIG-012 |
| EC-CALL-SIG-013 | CALL-SIG | Gọi người đã chặn mình hoặc mình đã chặn | Từ chối, không tạo record | Vô hiệu nút gọi khi `canMessage = false` | "Không thể gọi cho người này" | USER_BLOCKED | TC-CALL-SIG-013 |
| EC-CALL-SIG-014 | CALL-SIG | Spam lời mời | Rate limit `callInvite` 5/phút/user | Vô hiệu nút gọi tới hết `Retry-After` ước lượng 60 s | "Bạn thao tác quá nhanh, vui lòng thử lại sau" | RATE_LIMITED | TC-CALL-SIG-014 |
| EC-CALL-SIG-015 | CALL-SIG | Sự kiện kết thúc trùng | Idempotent, trả trạng thái hiện tại, không phát lại | Bỏ qua | Không đổi | — | TC-CALL-SIG-015 |
| EC-CALL-SIG-016 | CALL-SIG | Thiết bị thứ hai accept sau thiết bị đầu | Từ chối | Đóng màn hình | "Đã trả lời trên thiết bị khác" | CALL_ALREADY_ANSWERED | TC-CALL-SIG-016 |

### 5.7 CALL-MEDIA

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-CALL-MEDIA-001 | CALL-MEDIA | Không có micro | Callee: FAILED/MEDIA_FAILURE (T09) | Caller không gửi invite; callee gửi `call:end MEDIA_FAILURE` | "Không tìm thấy micro. Hãy kết nối micro và thử lại." | — | TC-CALL-MEDIA-001 |
| EC-CALL-MEDIA-002 | CALL-MEDIA | Không có camera trong cuộc gọi video | Không đổi `callType` | Lấy audio-only, transceiver video `recvonly` | Toast "Không tìm thấy camera, tiếp tục với âm thanh" | — | TC-CALL-MEDIA-002 |
| EC-CALL-MEDIA-003 | CALL-MEDIA | Từ chối quyền (`NotAllowedError`) | Callee: FAILED/MEDIA_FAILURE | Dừng, hướng dẫn mở quyền | "HUSTALO cần quyền dùng micro/camera. Hãy cấp quyền trong cài đặt trình duyệt." | — | TC-CALL-MEDIA-003 |
| EC-CALL-MEDIA-004 | CALL-MEDIA | Người dùng đóng/bỏ qua prompt quyền | Không có invite cho tới khi media sẵn sàng; callee để hết giờ → MISSED | Giữ PREPARING_MEDIA với nút "Hủy" luôn bấm được | "Đang chờ cấp quyền micro/camera…" | — | TC-CALL-MEDIA-004 |
| EC-CALL-MEDIA-005 | CALL-MEDIA | Thiết bị đang bị app khác dùng (`NotReadableError`) | Như 001 nếu là micro | Video → fallback audio; audio → dừng | "Micro hoặc camera đang được ứng dụng khác sử dụng." | — | TC-CALL-MEDIA-005 |
| EC-CALL-MEDIA-006 | CALL-MEDIA | Rút tai nghe/Bluetooth (`devicechange`) | — | Lấy thiết bị mặc định, `replaceTrack` | Toast "Đã chuyển sang {tên thiết bị}" | — | TC-CALL-MEDIA-006 |
| EC-CALL-MEDIA-007 | CALL-MEDIA | `track.onended` giữa cuộc gọi | Audio thất bại → T16/T22 | Lấy lại 1 lần; audio thất bại → `call:end MEDIA_FAILURE`; video thất bại → tắt camera | "Cuộc gọi kết thúc do lỗi thiết bị âm thanh/hình ảnh" (audio) | — | TC-CALL-MEDIA-007 |
| EC-CALL-MEDIA-008 | CALL-MEDIA | Trình duyệt không hỗ trợ WebRTC | — | Ẩn nút gọi | Tooltip "Trình duyệt không hỗ trợ gọi điện" | — | TC-CALL-MEDIA-008 |
| EC-CALL-MEDIA-009 | CALL-MEDIA | Insecure context (HTTP qua LAN) | — | Ẩn nút gọi | Tooltip "Cần kết nối HTTPS để gọi điện" | — | TC-CALL-MEDIA-009 |
| EC-CALL-MEDIA-010 | CALL-MEDIA | Autoplay bị chặn | — | Bắt lỗi `play()`, hiển thị nút | "Chạm để bật âm thanh" | — | TC-CALL-MEDIA-010 |
| EC-CALL-MEDIA-011 | CALL-MEDIA | Mobile tắt camera khi chuyển app | — | Track `mute` → peer hiển thị avatar; `unmute` → hiện lại video | Peer: avatar + "Camera đang tạm dừng" | — | TC-CALL-MEDIA-011 |
| EC-CALL-MEDIA-012 | CALL-MEDIA | Cuộc gọi kết thúc khi `getUserMedia` còn chờ | Trạng thái terminal đã chốt | Khi promise resolve: stop mọi track ngay | Đèn camera tắt | — | TC-CALL-MEDIA-012 |
| EC-CALL-MEDIA-013 | CALL-MEDIA | `OverconstrainedError` | — | Thử lại `{ video: true }`, rồi fallback audio | Không thông báo nếu thử lại thành công | — | TC-CALL-MEDIA-013 |

### 5.8 CALL-NET

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-CALL-NET-001 | CALL-NET | Đổi Wi-Fi sang 4G | CONNECTED → RECONNECTING, relay `call:ice-restart` và offer mới | Caller ICE restart (≤ 2 lần) | "Đang kết nối lại…" | — | TC-CALL-NET-001 |
| EC-CALL-NET-002 | CALL-NET | `disconnected` thoáng qua so với `failed` | Chỉ đổi trạng thái khi nhận báo cáo | Chờ 3 s với `disconnected`; `failed` restart ngay | Không đổi nếu hồi phục < 3 s | — | TC-CALL-NET-002 |
| EC-CALL-NET-003 | CALL-NET | NAT đối xứng cần TURN | Cấp TURN credential | Dùng relay candidate | Bình thường | — | TC-CALL-NET-003 |
| EC-CALL-NET-004 | CALL-NET | UDP bị chặn | Cấp URL `turn:?transport=tcp` và `turns:443` | ICE chọn TCP/TLS | Bình thường | — | TC-CALL-NET-004 |
| EC-CALL-NET-005 | CALL-NET | TURN credential hết hạn | Cấp credential mới | Làm mới trước 5 phút, `setConfiguration` trước ICE restart | Bình thường | — | TC-CALL-NET-005 |
| EC-CALL-NET-006 | CALL-NET | Xirsys API lỗi | Fallback STUN + coturn, `source: 'FALLBACK'`, không cache | Dùng bình thường | Bình thường | — | TC-CALL-NET-006 |
| EC-CALL-NET-007 | CALL-NET | Hai bên hồi phục lệch thời điểm | Xử lý báo cáo theo thứ tự nhận | Mỗi bên báo trạng thái riêng | "Đang kết nối lại…" rồi đồng hồ | — | TC-CALL-NET-007 |
| EC-CALL-NET-008 | CALL-NET | Một bên đã kết thúc, bên kia còn reconnect | Trạng thái terminal thắng; `call:state` từ bên kia nhận terminal | Dừng ICE restart, đóng pc | "Cuộc gọi đã kết thúc" | — | TC-CALL-NET-008 |
| EC-CALL-NET-009 | CALL-NET | Server restart giữa cuộc gọi | Deadline/state Redis còn → tiếp tục; mất state → T29 SERVER_RESTART | Reconnect, gửi `call:state` | Không đổi; hoặc "Cuộc gọi đã kết thúc do sự cố máy chủ" | — | TC-CALL-NET-009 |
| EC-CALL-NET-010 | CALL-NET | Hết lượt ICE restart hoặc hết 20 s grace | ENDED/NETWORK_FAILURE | Gửi `call:end NETWORK_FAILURE` khi hết lượt | "Cuộc gọi bị gián đoạn do mất kết nối" | CALL_INVALID_STATE (restart lần 3) | TC-CALL-NET-010 |

### 5.9 INFRA

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-INFRA-001 | INFRA | MongoDB down | NACK, REST 503, `/health` degraded | Giữ tin trong outbox, retry backoff | Bubble PENDING; thao tác REST: toast "Máy chủ đang bận, vui lòng thử lại" | SERVICE_UNAVAILABLE | TC-INFRA-001 |
| EC-INFRA-002 | INFRA | Redis down | Auth fail-closed; rate limit khác dùng bộ nhớ; presence `degraded`; `call:invite` 503 | Ẩn presence; báo lỗi khi gọi | Gọi: "Không thể thực hiện cuộc gọi lúc này" | SERVICE_UNAVAILABLE | TC-INFRA-002 |
| EC-INFRA-003 | INFRA | Transaction bị abort tạm thời | Retry ≤ 3 lần rồi 503 | Retry như EC-INFRA-001 | Bubble PENDING | SERVICE_UNAVAILABLE (sau 3 lần) | TC-INFRA-003 |

### 5.10 SEC

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-SEC-001 | SEC | Dò `conversationId` | 404 giống hệt id không tồn tại cho người chưa từng là thành viên | Route `/chats/:id` không hợp lệ → trang lỗi | "Không tìm thấy cuộc trò chuyện" | NOT_FOUND | TC-SEC-001 |
| EC-SEC-002 | SEC | Cố join room không có quyền | `conversation:join` kiểm AUTHZ-2; room không cấp dữ liệu | — | — | NOT_FOUND / NOT_A_MEMBER | TC-SEC-002 |
| EC-SEC-003 | SEC | Receipt giả mạo cho người khác | `userId` lấy từ token; chỉ nâng cursor của chính mình | — | — | VALIDATION_ERROR (trường thừa) | TC-SEC-003 |
| EC-SEC-004 | SEC | CSRF vào `/auth/refresh`, `/auth/logout` | Thiếu/sai `X-CSRF-Token` → từ chối | Luôn gửi header từ cookie `hustalo_csrf` | — | FORBIDDEN | TC-SEC-004 |
| EC-SEC-005 | SEC | Brute-force login | 5/phút/IP+email, fail-closed khi Redis down | Vô hiệu nút đăng nhập trong `Retry-After` | "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau {n} giây." | RATE_LIMITED | TC-SEC-005 |
| EC-SEC-006 | SEC | Secret lọt vào bundle | Build fail nếu `client/dist` chứa giá trị secret | Chỉ dùng biến `VITE_*` công khai | — | — | TC-SEC-006 |
| EC-SEC-007 | SEC | Log lộ token/nội dung | pino redact | Client không `console.log` token/nội dung ở production | — | — | TC-SEC-007 |
| EC-SEC-008 | SEC | Spam lời mời gọi diện rộng | Rate limit `callInvite` theo user, metric cảnh báo | Như EC-CALL-SIG-014 | "Bạn thao tác quá nhanh, vui lòng thử lại sau" | RATE_LIMITED | TC-SEC-008 |

### 5.11 E2EE

| ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID |
|---|---|---|---|---|---|---|---|
| EC-E2EE-001 | E2EE | Người nhận chưa đăng ký thiết bị | Từ chối tạo SECRET / gửi | Không tạo hội thoại | "Người nhận chưa bật trò chuyện bí mật" | E2EE_KEYS_UNAVAILABLE | TC-E2EE-001 |
| EC-E2EE-002 | E2EE | Hết one-time prekey | Trả bundle `oneTimePreKey: null`, phát `e2ee:prekeys-low` | Thiết lập X3DH không OTPK; device thiếu prekey tự bổ sung | Bình thường | — | TC-E2EE-002 |
| EC-E2EE-003 | E2EE | Identity key thay đổi | Lưu identity mới của device | Cảnh báo; chặn gửi nếu đã xác minh | Banner "Mã an toàn với {tên} đã thay đổi" + nút "Chấp nhận" | — | TC-E2EE-003 |
| EC-E2EE-004 | E2EE | Giải mã thất bại | — | Placeholder; không chặn tin khác | "Không thể giải mã tin nhắn này" | E2EE_DECRYPT_FAILED (client) | TC-E2EE-004 |
| EC-E2EE-005 | E2EE | Tin đến từ thiết bị đã thu hồi | Từ chối `message:send` từ device REVOKED | Bỏ envelope từ device REVOKED | "Tin nhắn từ thiết bị đã bị thu hồi" | FORBIDDEN | TC-E2EE-005 |
| EC-E2EE-006 | E2EE | Người dùng xóa IndexedDB | Nhận đăng ký khóa mới cho cùng `deviceId` | Sinh khóa mới, đăng ký lại; lịch sử SECRET cũ không đọc được | "Tin nhắn được gửi trước khi thiết bị này tham gia" | — | TC-E2EE-006 |
| EC-E2EE-007 | E2EE | Đăng nhập thiết bị mới | Tin cũ không có recipient cho device mới | Hiển thị placeholder (hành vi thiết kế) | "Tin nhắn được gửi trước khi thiết bị này tham gia" | — | TC-E2EE-007 |
| EC-E2EE-008 | E2EE | Danh sách thiết bị đổi giữa lúc gửi | Recipients lệch → từ chối | Tải lại bundle, mã hóa lại (≤ 2 lần) | Bubble PENDING; quá 2 lần → FAILED | CONFLICT | TC-E2EE-008 |

---

## 6. Non-functional requirements

Các con số khớp `system_architecture.md` §1.2 (NFR-ARCH-*). Môi trường test chuẩn: 1 instance server, MongoDB rs0 + Redis local qua Docker Compose, máy 4 vCPU / 8 GB RAM.

| ID | Loại | Yêu cầu đo được | Cách đo | Liên kết |
|---|---|---|---|---|
| NFR-01 | Hiệu năng | p95 thời gian ACK `message:send` ≤ 300 ms với 50 user đồng thời, tổng 5 msg/s, trong 5 phút | Histogram `hustalo_message_send_ack_seconds`, load test k6 (M6) | NFR-ARCH-01, AC-ARCH-012 |
| NFR-02 | Hiệu năng | p95 từ commit tới khi người nhận nhận `message:new` ≤ 500 ms | Playwright đo `occurredAt` so với thời điểm nhận | NFR-ARCH-02 |
| NFR-03 | Hiệu năng | p95 thời gian thiết lập cuộc gọi (ACCEPTED → CONNECTED) ≤ 5 s khi có đường direct (host/srflx) | `hustalo_call_setup_seconds`, 20 lần chạy AC-071 | NFR-ARCH-03 |
| NFR-04 | Hiệu năng | `GET /conversations` (20 mục) và `GET /messages` (30 tin) p95 ≤ 200 ms với 10.000 tin/hội thoại | `hustalo_http_request_duration_seconds` | — |
| NFR-05 | Hiệu năng | Tải trang đầu (LCP) ≤ 2,5 s trên kết nối "Fast 3G" của Lighthouse; bundle JS khởi tạo ≤ 300 KB gzip (thư viện Signal tải lười khi mở SECRET) | Lighthouse CI | — |
| NFR-06 | Tin cậy | 0 tin mất sau ACK, 0 bubble trùng trong bộ test mạng (EC-NET-*) | TC-NET-001..010 | NFR-ARCH-05 |
| NFR-07 | Tin cậy | Phát hiện offline ≤ 60 s khi crash, ≤ 11 s khi đóng sạch | AC-061, AC-062 | NFR-ARCH-04 |
| NFR-08 | Tin cậy | Restart server không để cuộc gọi treo ở trạng thái active quá `CALL_RECONNECT_GRACE_MS` + 5 s khi không còn ai | AC-ARCH-007, TC-CALL-NET-009 | NFR-ARCH-05 |
| NFR-09 | Dung lượng | 1.000 socket đồng thời / instance; 200 cuộc gọi signaling đồng thời; RAM server ≤ 1 GB | k6 + socket.io-client load (M6) | NFR-ARCH-06 |
| NFR-10 | Tương thích | Chrome, Edge, Firefox: 2 phiên bản ổn định gần nhất; Safari 17+ (macOS, iOS); mobile web Chrome Android và Safari iOS | Playwright projects chromium/firefox/webkit + test tay Safari iOS trước release | NFR-ARCH-07 |
| NFR-11 | Accessibility | WCAG 2.1 AA cho luồng đăng nhập, đăng ký, danh sách chat, phòng chat, cuộc gọi đến/đi/đang gọi: 0 vi phạm mức serious/critical của axe-core; tương phản văn bản ≥ 4,5:1; điều khiển hoàn toàn bằng bàn phím | `@axe-core/playwright` trong E2E | NFR-ARCH-09 |
| NFR-12 | Bảo mật | 0 secret server trong `client/dist`; 0 log chứa token/mật khẩu/nội dung/SDP/ICE; mọi endpoint (trừ `/auth/register`, `/auth/login`, `/auth/refresh`, `/health`) trả 401 khi thiếu token | AC-104, AC-105, test quét route | NFR-ARCH-08 |
| NFR-13 | Bảo mật | `npm audit --omit=dev` không có lỗ hổng mức high/critical tại thời điểm release | CI | — |
| NFR-14 | Bảo trì | Coverage unit + integration ≥ 80% dòng cho `server/src/modules/**` và `packages/shared/src/**`; `call.state-machine.ts` 100% nhánh | Vitest coverage (v8) | AC-ARCH-008 |
| NFR-15 | Bản địa hóa | 100% chuỗi UI tiếng Việt có dấu; định dạng giờ `HH:mm`, ngày `DD/MM/YYYY`, múi giờ theo trình duyệt | Review + snapshot test | — |
| NFR-16 | Khả quan sát | Mọi request/event có `requestId` trong log; metric §11.1 kiến trúc có mặt tại `/metrics` | Integration test `/metrics` | — |

---

## 7. Definition of Done

Một FR/milestone chỉ được coi là xong khi **tất cả** điều kiện sau đúng:

1. **Spec:** mọi hành vi đã có trong `.spec/`; nếu đổi hợp đồng (enum, event, mã lỗi, hằng số, endpoint, schema) thì spec được cập nhật và duyệt **trước** khi code (CLAUDE.md).
2. **Hợp đồng chung:** enum, hằng số, Zod schema, kiểu event chỉ định nghĩa trong `packages/shared`; không có bản sao ở `server/` hay `client/`.
3. **Test:** mọi AC (`TC-AC-*`) và EC (`TC-*`) gán cho FR đó có test tự động ở đúng tầng ghi trong mục 4/5 và pass; test viết trước code (CLAUDE.md quy trình bước 3).
4. **Chất lượng:** `npm run typecheck && npm run lint && npm test` xanh; không có `any` ngầm, `@ts-ignore` hay `eslint-disable` không kèm lý do.
5. **Bảo mật:** kiểm quyền theo bảng AUTHZ (kiến trúc §6.2) ở mọi điểm vào mới; không log dữ liệu cấm (§11.3); không dùng `dangerouslySetInnerHTML` với dữ liệu người dùng; không phân trang bằng `skip`.
6. **UI:** mọi trạng thái loading/empty/error và chuỗi tiếng Việt trong `ui_ux_spec.md` được hiện thực; axe-core không có vi phạm serious/critical; hoạt động ở 375 px và 1280 px.
7. **Hiệu năng:** không làm vượt ngưỡng NFR-01..05 (đo ở M6 và trước release).
8. **Observability:** metric và log có cấu trúc cho luồng mới.
9. **Traceability:** Traceability Matrix (cuối `development_guide.md`) được cập nhật khi thêm/đổi hành vi.
10. **E2EE:** chỉ hiển thị "Mã hóa đầu-cuối" khi M7 hoàn thành và session đã thiết lập (CLAUDE.md).
11. **Review:** PR mô tả FR/AC/EC đã phủ, đính kèm kết quả test; được người review duyệt.

---

## Consistency Check

- [x] **Enum, event, mã lỗi, hằng số khớp mục 2 và 3 của yêu cầu gốc và `system_architecture.md`:**
  - Dùng đúng `ConversationType`, `MemberRole` (người tạo nhóm là OWNER), `MessageType`, `MessageClientStatus`, `CallType`, `CallStatus`, `CallEndReason`, `PresenceStatus`, và enum `[NEW]` `SystemEventKind`, `UserStatus`, `DeviceStatus`, `SessionRevokeReason` của kiến trúc §4.4.2. Không có trạng thái `OUTGOING` trong `CallStatus`; `direction: 'OUTGOING' | 'INCOMING'` của `CallRecord` là trường DTO tính theo người xem, không phải trạng thái.
  - Mọi mã lỗi trong FR, AC, ma trận thuộc 20 mã chuẩn; `DUPLICATE_MESSAGE` thể hiện qua `duplicate: true`, không phải lỗi; `E2EE_DECRYPT_FAILED` chỉ phía client.
  - Event dùng đúng tên §4.5 kiến trúc; không có `message:ack`, `call:initiate`.
  - Hằng số: `MESSAGE_MAX_LENGTH` 4000, `MESSAGE_EDIT_WINDOW_MS` 15 phút, `GROUP_MAX_MEMBERS` 100, `GROUP_TITLE_MAX` 100, `DISPLAY_NAME_MAX` 80, `HISTORY_PAGE_DEFAULT/MAX` 30/100, `CONVERSATION_PAGE_DEFAULT/MAX` 20/50, `UNREAD_COUNT_CAP` 99, token 15 phút/30 ngày, `REFRESH_REUSE_GRACE_S` 10, presence 60/20/10 s, typing 5/3 s, call 45/30/20 s + 2 ICE restart, `ICE_DISCONNECTED_GRACE_MS` 3 s, TURN 1 h/5 phút, outbox 200/1-2-4-8 s/30 s/24 h, `GROUP_ADD_BATCH_MAX` 50, E2EE 100/20/5 thiết bị/7 ngày, rate limit đúng `RATE_LIMITS`.
- [x] **FR/AC tham chiếu bằng ID:** 56 FR của registry kiến trúc (Phụ lục B) đều có mục ở §3, cộng 2 FR mới được phép bổ sung: `FR-CHAT-011` (SYSTEM message) và `FR-CALL-011` (âm báo cuộc gọi). Mỗi FR liệt kê AC và EC; 101 AC (AC-001..AC-122, có khoảng trống đánh số để chèn sau) đều chỉ ra FR gốc; Test ID `TC-AC-<số>`.
- [x] **Edge case có ID trong ma trận:** ma trận §5 có đúng 104 dòng, trùng 1-1 với registry kiến trúc Phụ lục C (AUTH 7, NET 10, MSG 17, GROUP 7, PRES 5, CALL-SIG 16, CALL-MEDIA 13, CALL-NET 10, INFRA 3, SEC 8, E2EE 8); mỗi dòng có hành vi server/client, trạng thái UI, mã lỗi, Test ID `TC-*`. Các yêu cầu AC tối thiểu (chat 13 trường hợp, call 16, E2EE 4) đều có AC tương ứng.
- [x] **Không có secret thật, không chỗ trống:** không có giá trị secret; email/user ví dụ là dữ liệu seed; không có "TODO" hay "tương tự như trên".
- [x] **Không mâu thuẫn với `system_architecture.md` — các điểm đã đối chiếu:**
  - D-03 glare gộp (FR-CALL-005, AC-077); D-04 caller là offerer (FR-CALL-006); D-06 đang đổ chuông tính là bận (FR-CALL-004); D-07 từ chối một tab là từ chối tất cả (AC-072); D-08 gọi người offline (AC-088); D-10 rate limit khi Redis down (AC-109); D-11 một SECRET mỗi cặp (FR-E2EE-004); D-16 không sửa tin SECRET (EC-MSG-017); D-17 đếm code point (AC-036); D-19 grace refresh (AC-007); D-21 chặn hai chiều (FR-USER-003); D-22 không gọi nhóm (AC-086); D-23 OWNER rời nhóm (AC-053).
  - State machine T01–T36 (§8.2) khớp kết cục trong FR-CALL-004/006/009 và AC-070..092; chuỗi UI §8.6 dùng lại nguyên văn trong ma trận §5.
  - Endpoint dùng đúng §4.6 kể cả 4 endpoint `[NEW]` (`/auth/change-password`, `PATCH /conversations/{id}/members/{userId}`, `GET /e2ee/devices`, `DELETE /e2ee/devices/{deviceId}`).
  - **Bổ sung so với kiến trúc (không mâu thuẫn, các file sau phải phản ánh):** `GET /auth/me` trả `blockedUserIds`; `ConversationSummary` có `blockedByMe`, `canMessage`, `myLastDeliveredMessageId`, `myLastReadMessageId`; `UserPublic` trong kết quả tìm kiếm có `blockedByMe`; `CallRecord` có `direction`; nhóm có OWNER duy nhất rời thì `conversations.deletedAt`; script `user:lock`/`user:unlock`; các trường dữ liệu ở §3.9.
