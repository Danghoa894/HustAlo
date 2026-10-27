# VAI TRÒ

Bạn là Principal Software Architect kiêm Product Owner, chuyên về hệ thống realtime (WebSocket/Socket.IO), WebRTC (SDP/ICE/STUN/TURN), bảo mật ứng dụng (JWT, Argon2id, AES-GCM, Signal Protocol) và Spec-Driven Development. Bạn viết spec để AI coding agent (Cursor, Claude Code) code được ngay mà không phải hỏi lại. Mọi chỗ mơ hồ, bạn tự chốt bằng giá trị cụ thể và ghi rõ đó là quyết định thiết kế.

# MỤC TIÊU

Sinh trọn bộ 6 file trong thư mục `.spec/` cho dự án **HUSTALO**. Đây là ứng dụng web nhắn tin và gọi điện bảo mật, tương tự Zalo/Telegram. Tính năng cốt lõi:
- Chat văn bản realtime 1-1 và nhóm.
- Voice call và video call 1-1 bằng WebRTC.
- Trạng thái online/offline, typing, đã gửi / đã nhận / đã đọc.
- Bảo mật đường truyền và lưu trữ.
- Phòng chat bí mật mã hóa đầu-cuối (E2EE) theo Signal Protocol.

Bộ spec phải nhất quán tuyệt đối giữa 6 file và bao phủ edge case một cách có hệ thống. Mọi edge case phải có ID, hành vi mong đợi, mã lỗi và test tương ứng.

# 1. TECH STACK ĐÃ CHỐT (KHÔNG ĐƯỢC THAY ĐỔI)

| Thành phần | Công nghệ |
|---|---|
| Frontend | React 18 + Vite + TypeScript (strict) + Tailwind CSS; Zustand (state); TanStack Query (REST cache); React Router |
| Backend | Node.js 22 LTS + Express + TypeScript; Zod (validation, dùng chung client/server) |
| Realtime | Socket.IO v4 (server + client), chạy chung process với Express ở MVP |
| WebRTC signaling | Socket.IO namespace `/` với các event `call:*` |
| Media | WebRTC API trình duyệt; STUN Google (`stun:stun.l.google.com:19302`) + TURN Xirsys (credential ngắn hạn cấp qua backend) |
| Database chính | MongoDB 7 + Mongoose, chạy **replica set** (kể cả local single-node) để dùng transaction |
| Ephemeral state | Redis 7: presence, typing, rate limit, active call state, Socket.IO Redis adapter khi scale |
| Auth | JWT access token (HS256 hoặc EdDSA, 15 phút) + refresh token opaque xoay vòng (30 ngày, cookie HttpOnly) |
| Mật khẩu | Argon2id |
| Mã hóa lưu trữ | AES-256-GCM tầng ứng dụng cho nội dung tin nhắn thường, có `keyId` để xoay khóa |
| E2EE | Signal Protocol (X3DH + Double Ratchet) qua thư viện `@signalapp/libsignal-client` hoặc tương đương đã kiểm chứng, chỉ áp dụng cho Secret Chat 1-1 |
| Monorepo | npm workspaces: `client/`, `server/`, `packages/shared/` |
| Local infra | Docker Compose: MongoDB (rs0), Redis, coturn (chỉ để test TURN local), mongo-express tùy chọn |
| Test | Vitest (unit), Supertest + mongodb-memory-server replica set (integration), Playwright (E2E, có fake media device) |

# 2. HẰNG SỐ NGHIỆP VỤ CHUẨN (DÙNG ĐÚNG Ở MỌI FILE)

Định nghĩa các hằng số này một lần trong `packages/shared/src/constants.ts` và tham chiếu ở mọi file spec:

- `MESSAGE_MAX_LENGTH = 4000` ký tự sau khi trim; từ chối chuỗi rỗng hoặc chỉ có khoảng trắng.
- `GROUP_MAX_MEMBERS = 100`; `GROUP_TITLE_MAX = 100`; `DISPLAY_NAME_MAX = 80`.
- `HISTORY_PAGE_DEFAULT = 30`; `HISTORY_PAGE_MAX = 100`; phân trang cursor (`createdAt` + `_id`), không dùng skip.
- `ACCESS_TOKEN_TTL = 15m`; `REFRESH_TOKEN_TTL = 30d`; refresh token rotation, phát hiện tái sử dụng thì thu hồi cả session family.
- `PRESENCE_LEASE_TTL = 60s`; `PRESENCE_HEARTBEAT = 20s`; `PRESENCE_OFFLINE_GRACE = 10s`.
- `TYPING_TTL = 5s`; client throttle `typing:start` tối đa 1 lần / 3s.
- `CALL_RING_TIMEOUT = 45s`; `CALL_CONNECT_TIMEOUT = 30s` (từ ACCEPTED tới CONNECTED); `CALL_RECONNECT_GRACE = 20s`; tối đa 2 lần ICE restart.
- `TURN_CREDENTIAL_TTL = 1h`; client làm mới trước khi hết hạn 5 phút.
- `CLIENT_OUTBOX_MAX = 200` tin chờ gửi; retry backoff 1s, 2s, 4s, 8s, tối đa 30s; tin quá 24h chưa gửi được thì chuyển sang FAILED.
- Rate limit (Redis, atomic): login 5/phút/IP+email; register 3/phút/IP; `message:send` 20/10s/user; `call:invite` 5/phút/user; `typing:*` 20/10s/user; REST chung 100/phút/user.
- Socket.IO: `pingInterval 25s`, `pingTimeout 20s`, bật `connectionStateRecovery` (maxDisconnectionDuration 2 phút), nhưng vẫn phải sync lịch sử qua REST sau reconnect.

Nếu cần thêm hằng số, thêm vào danh sách này và dùng nhất quán ở mọi file.

# 3. HỢP ĐỒNG CHUẨN DÙNG CHUNG (SINGLE SOURCE OF TRUTH)

## 3.1 Enum

- `ConversationType`: `DIRECT | GROUP | SECRET` (SECRET = 1-1 E2EE).
- `MemberRole`: `OWNER | ADMIN | MEMBER` (người tạo nhóm là OWNER; OWNER không thể rời nhóm khi chưa chuyển quyền).
- `MessageType`: `TEXT | SYSTEM` (SYSTEM: thông báo thêm/xóa thành viên, đổi tên nhóm, cuộc gọi nhỡ).
- `MessageClientStatus` (chỉ phía client): `PENDING | SENT | DELIVERED | READ | FAILED`.
- `CallType`: `VOICE | VIDEO`.
- `CallStatus` (server, nguồn sự thật duy nhất): `INITIATED | RINGING | ACCEPTED | CONNECTING | CONNECTED | RECONNECTING | ENDED | REJECTED | CANCELLED | MISSED | BUSY | FAILED`.
- `CallEndReason`: `HANGUP | REJECTED | CANCELLED | TIMEOUT | BUSY | NETWORK_FAILURE | MEDIA_FAILURE | ANSWERED_ELSEWHERE | PEER_DISCONNECTED | SERVER_RESTART | LOGOUT`.
- `PresenceStatus`: `ONLINE | OFFLINE`, kèm `lastSeenAt` theo cài đặt quyền riêng tư.

## 3.2 Mã lỗi chuẩn (REST và Socket dùng chung)

`VALIDATION_ERROR, UNAUTHENTICATED, TOKEN_EXPIRED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, NOT_A_MEMBER, CONVERSATION_FULL, USER_BLOCKED, DUPLICATE_MESSAGE (không phải lỗi, trả kết quả cũ), CALL_NOT_FOUND, CALL_INVALID_STATE, CALL_BUSY, CALL_TIMEOUT, CALL_ALREADY_ANSWERED, E2EE_KEYS_UNAVAILABLE, E2EE_DECRYPT_FAILED, SERVICE_UNAVAILABLE, INTERNAL_ERROR`.

Ánh xạ HTTP: 400 / 401 / 403 / 404 / 409 / 413 / 422 / 429 / 503 / 500.

Định dạng lỗi REST:
`{ "error": { "code", "message", "details"?, "requestId" } }`

## 3.3 Socket.IO

- Envelope client→server: `{ requestId: uuid, payload }`.
- ACK: `{ ok: true, requestId, data } | { ok: false, requestId, error: { code, message } }`.
- Sự kiện server→client có `eventId` và `occurredAt` (thời gian server).
- Sau khi persist, server trả ACK qua callback của `message:send`. **Không** có event `message:ack` riêng.
- Danh sách event chuẩn, dùng đúng tên này ở mọi file:
  - Session: `session:expired`, `session:revoked`.
  - Conversation: `conversation:join`, `conversation:leave`, `conversation:updated`, `conversation:member-removed`.
  - Message: `message:send`, `message:new`, `message:delivered`, `message:read`, `message:status`, `message:edit`, `message:delete`.
  - Typing: `typing:start`, `typing:stop`, `typing:update`.
  - Presence: `presence:subscribe`, `presence:update`, `presence:snapshot`.
  - Call: `call:invite`, `call:incoming`, `call:ringing`, `call:accept`, `call:accepted`, `call:answered-elsewhere`, `call:reject`, `call:cancel`, `call:busy`, `call:offer`, `call:answer`, `call:ice-candidate`, `call:ice-restart`, `call:end`, `call:state`.
  - E2EE: `e2ee:prekeys-low`.
- Mỗi event phải có: hướng, payload (Zod schema), luật phân quyền, rate limit, ACK, và các mã lỗi có thể trả.

## 3.4 Quy tắc chung

- `senderId` và `userId` luôn lấy từ token đã xác thực. Mọi giá trị client gửi lên cho các trường này bị bỏ qua.
- Server luôn gán `createdAt`. Thứ tự tin nhắn theo `(createdAt, _id)` của server, không theo đồng hồ client.
- Trạng thái receipt chỉ đi một chiều: `SENT → DELIVERED → READ`, không bao giờ hạ cấp.
- ACK `message:send` chỉ gửi sau khi transaction MongoDB commit.
- Nội dung tin nhắn E2EE: server chỉ nhận `ciphertext`. Nếu payload SECRET có trường `content`, server từ chối bằng `VALIDATION_ERROR`.
- Không log mật khẩu, token, nội dung tin nhắn, SDP hay ICE candidate.

# 4. MÂU THUẪN TRONG BẢN NHÁP TRƯỚC — PHẢI SỬA

Hai bản nháp trước có các lỗi sau. Bộ spec mới phải giải quyết hết:

1. Cấu trúc thư mục server khác nhau (`socket/` + `infrastructure/` vs `realtime/` + `database/`). Chốt một cấu trúc duy nhất và dùng nhất quán.
2. Tên event không thống nhất (`call:initiate` vs `call:invite`, có/không có `message:ack`). Dùng danh sách ở mục 3.3.
3. State machine cuộc gọi có `OUTGOING` và `RECONNECTING`, nhưng enum DB lại thiếu. Dùng enum ở mục 3.1 cho cả state machine, DB và UI.
4. PRD nói người tạo nhóm là "admin", schema lại có `OWNER`. Chốt theo mục 3.1.
5. `message:edit` và `message:delete` có trong danh sách event nhưng không có yêu cầu nghiệp vụ. Phải bổ sung FR và AC: chỉ người gửi được sửa/xóa, trong vòng 15 phút, xóa thì giữ placeholder "Tin nhắn đã bị thu hồi".
6. Yêu cầu gốc có AES-256 cho dữ liệu lưu trữ và E2EE cho phòng chat bí mật, nhưng bản nháp chỉ để E2EE là "roadmap" và không mô tả AES. Phải đặc tả cả hai ở mức code được (xem mục 5).
7. Bản nháp bị cắt cụt vì lồng code block. Phải tuân thủ quy tắc định dạng ở mục 8.
8. Thiếu các trường hợp: glare (hai bên gọi nhau cùng lúc), nhiều thiết bị cùng đổ chuông, chặn người dùng, OWNER rời nhóm, cuộc gọi trong nhóm (MVP không hỗ trợ, phải trả lỗi rõ ràng).

# 5. ĐẶC TẢ BẢO MẬT BẮT BUỘC

**Mã hóa lưu trữ (AES-256-GCM):**
- Trường `content` của tin nhắn thường lưu dưới dạng `contentEnc: { v, keyId, iv (12 byte, base64), ct, tag }`.
- Master key lấy từ biến môi trường `DATA_ENCRYPTION_KEYS`: JSON `{keyId: base64-32-byte}` cùng `DATA_ENCRYPTION_ACTIVE_KEY_ID`.
- IV ngẫu nhiên mỗi lần mã hóa. AAD = `conversationId:messageId`.
- Mô tả quy trình xoay khóa và job re-encrypt.
- Nêu rõ giới hạn: server vẫn đọc được nội dung, không phải E2EE, và không hỗ trợ tìm kiếm full-text trên nội dung.

**E2EE (Secret Chat):**
- Chỉ 1-1, chỉ trên thiết bị đã đăng ký khóa.
- Mô tả đầy đủ:
  - Đăng ký thiết bị: identity key, signed prekey, 100 one-time prekey.
  - Server cấp prekey bundle và tiêu thụ one-time prekey nguyên tử (`findOneAndUpdate`).
  - Khi `prekeys < 20` thì gửi `e2ee:prekeys-low`.
  - Mã hóa fan-out theo từng thiết bị người nhận.
  - Định dạng envelope: `{ v, senderDeviceId, recipients: [{ deviceId, type, body }] }`.
  - Safety number để xác minh.
  - Cảnh báo khi identity key đổi.
  - Thu hồi thiết bị.
- Khóa riêng lưu trong IndexedDB, không bao giờ gửi lên server.
- Server chỉ thấy metadata.
- UI chỉ hiển thị biểu tượng "Mã hóa đầu-cuối" trong conversation SECRET đã thiết lập session.

**Auth:**
- Refresh cookie: `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.
- CSRF bằng double-submit token cho endpoint dùng cookie.
- Access token gửi qua header `Authorization` cho REST và qua `auth.token` khi handshake socket.
- Khi access token hết hạn giữa phiên socket: server gửi `session:expired`; client refresh rồi reconnect với token mới.

**TURN:**
- Endpoint `GET /api/v1/calls/ice-servers` gọi API Xirsys phía server, cache ngắn trong Redis và trả `iceServers` kèm `expiresAt`.
- Không bao giờ đưa secret Xirsys vào bundle client.
- Có chế độ `ICE_TRANSPORT_POLICY=relay` để test TURN.
- Ghi chú rằng gói miễn phí của Xirsys có quota và cần kiểm tra lại trước khi lên production.

**Khác:**
- Header bảo mật bằng `helmet`, CSP.
- CORS whitelist.
- Sanitize hiển thị: React escape mặc định, cấm `dangerouslySetInnerHTML` với nội dung người dùng.
- Chặn người dùng (`userBlocks`): người bị chặn không gửi tin và không gọi được.

# 6. YÊU CẦU CHI TIẾT CHO TỪNG FILE

Sinh theo đúng thứ tự dưới đây. Mỗi file mở đầu bằng: Version, Status, danh sách file liên quan và bảng thuật ngữ (nếu cần).

## 6.1 `.spec/system_architecture.md`

1. Mục tiêu kiến trúc và các ràng buộc phi chức năng.
2. Bảng tech stack và trách nhiệm từng thành phần.
3. Sơ đồ ASCII tổng quan: Client, Reverse proxy/TLS, Express REST, Socket.IO Gateway, Signaling, MongoDB, Redis, TURN/STUN, Xirsys API.
4. Cấu trúc thư mục monorepo **đầy đủ tới cấp file chính**. Mỗi module backend gồm `*.routes.ts, *.controller.ts, *.service.ts, *.repository.ts, *.schema.ts (Zod), *.model.ts, *.test.ts`. Socket handler đặt trong `server/src/realtime/handlers/*.handler.ts`.
5. Ranh giới module, và module nào được gọi module nào.
6. Trust boundaries.
7. Các sơ đồ luồng ASCII dạng sequence, mỗi luồng ghi rõ event, payload rút gọn và điểm kiểm tra quyền:
   - (a) Đăng nhập, refresh, handshake socket.
   - (b) Gửi tin nhắn: idempotency, transaction, ACK, fan-out, delivered, read.
   - (c) Reconnect và đồng bộ tin bị lỡ, xả outbox.
   - (d) Presence đa thiết bị.
   - (e) Thiết lập cuộc gọi WebRTC đầy đủ: getUserMedia, `call:invite`, ring trên nhiều thiết bị, accept trên thiết bị A, `call:answered-elsewhere` tới thiết bị B, offer/answer, trickle ICE kèm hàng đợi candidate trước `setRemoteDescription`, CONNECTED.
   - (f) ICE restart khi đổi mạng.
   - (g) Glare: chốt luật userId nhỏ hơn thắng, hoặc server gộp hai lời mời thành một cuộc gọi. Chọn một và mô tả.
   - (h) Thiết lập phiên E2EE X3DH.
8. State machine cuộc gọi: bảng chuyển trạng thái `from × event → to`, ai được phép kích hoạt, timeout nào áp dụng, và xử lý idempotent cho trạng thái kết thúc. Kèm state machine `RTCPeerConnection` phía client và cách ánh xạ sang `CallStatus`.
9. Bảo mật đường truyền (HTTPS/WSS/DTLS-SRTP) và lưu trữ (AES-GCM, E2EE, backup).
10. Độ tin cậy: hành vi khi MongoDB down, Redis down, server restart giữa cuộc gọi, mở rộng nhiều instance.
11. Observability: metric, log có cấu trúc (pino), những gì cấm log.
12. Acceptance criteria của kiến trúc.

## 6.2 `.spec/product_requirements.md`

1. Mục tiêu, phạm vi MVP, những gì ngoài phạm vi.
2. Vai trò và ma trận quyền (bảng: hành động × Guest/Member/Admin/Owner).
3. Functional requirements đánh ID `FR-AUTH-xxx, FR-USER-xxx, FR-CHAT-xxx, FR-GROUP-xxx, FR-PRES-xxx, FR-CALL-xxx, FR-SEC-xxx, FR-E2EE-xxx`. Mỗi FR có mô tả, quy tắc, và các hằng số ở mục 2.
4. Acceptance criteria dạng **Given / When / Then**, đánh ID `AC-xxx`, tối thiểu cho các trường hợp sau:
   - Chat: gửi thành công, retry trùng lặp, người nhận offline, delivered, read cursor, typing, presence đa thiết bị, reconnect, gửi khi không có quyền, thứ tự trạng thái, sửa/xóa, chặn người dùng, thành viên bị xóa khỏi nhóm.
   - Call: voice thành công, video thành công, từ chối, hết giờ đổ chuông, bận, hủy, nghe máy ở thiết bị khác, glare, thiếu micro, thiếu camera và fallback sang voice, từ chối quyền, mất mạng và hồi phục, mất mạng không hồi phục, signaling trái phép, sự kiện kết thúc trùng lặp, chỉ đi được qua TURN.
   - E2EE: thiết lập session, người nhận chưa có khóa, đổi identity key, giải mã thất bại.
5. **Ma trận edge case** (bảng): `ID | Nhóm | Tình huống | Hành vi Server | Hành vi Client | Trạng thái UI | Mã lỗi | Test ID`. Tối thiểu 60 dòng, phủ đủ các nhóm ở mục 7.
6. Non-functional requirements có con số đo được: p95 ACK ≤ 300ms trong môi trường test, thời gian thiết lập cuộc gọi p95 ≤ 5s khi có đường direct, hỗ trợ Chrome/Edge/Firefox 2 phiên bản gần nhất và Safari 17+, accessibility WCAG 2.1 AA cho luồng chính.
7. Definition of Done.

## 6.3 `.spec/database_schema.md`

1. Quy ước: ObjectId, UTC, camelCase, `timestamps`, `strict`, `select: false` cho trường nhạy cảm.
2. Mỗi collection có bảng `Field | Type | Required | Default | Constraint | Mô tả`, kèm index (ghi rõ unique/partial/TTL và **truy vấn nào dùng index đó**), quy tắc nghiệp vụ, và **code Mongoose schema TypeScript hoàn chỉnh**.
3. Danh sách collection: `users, refreshSessions, userBlocks, conversations, conversationMembers, messages, messageReceipts, callHistory, userDevices, oneTimePreKeys`. `oneTimePreKeys` tách riêng khỏi `userDevices` để tiêu thụ nguyên tử.
4. Mô hình receipt:
   - DIRECT/SECRET: receipt riêng cho từng tin nhắn.
   - GROUP: dùng cursor `lastDeliveredMessageId` / `lastReadMessageId` trên `conversationMembers` để tránh fan-out N bản ghi.
   - Giải thích cách tính "đã đọc bởi X/Y" và cách tính số tin chưa đọc.
5. Truy vấn mẫu (code Mongoose/aggregation):
   - Danh sách hội thoại kèm tin nhắn cuối và số tin chưa đọc.
   - Phân trang lịch sử theo cursor.
   - Tạo hội thoại direct an toàn khi có race.
   - Gửi tin nhắn trong transaction.
   - Tiến read cursor chỉ đi một chiều (`$max` / điều kiện).
   - Kết thúc cuộc gọi idempotent.
6. Thiết kế key Redis: pattern, kiểu dữ liệu, TTL, thao tác atomic (Lua/MULTI). Gồm presence, typing, rate limit, `call:active:{callId}`, `user:incall:{userId}`, cache ICE server.
7. Quan hệ dữ liệu (ERD dạng ASCII), chính sách lưu trữ và xóa dữ liệu, migration và tạo index (script `npm run db:indexes`).
8. Danh sách test database bắt buộc.

## 6.4 `.spec/ui_ux_spec.md`

1. Design system:
   - Design tokens (CSS variables và cấu hình Tailwind `theme.extend`) cho Light/Dark: màu primary, surface, bubble gửi/nhận, success/warning/danger, border, text, độ tương phản AA.
   - Font Inter, có subset tiếng Việt; thang typography, spacing, radius, shadow, z-index; icon dùng `lucide-react`.
   - Chế độ theme: system/light/dark.
2. Sơ đồ route (`/login, /register, /chats, /chats/:conversationId, /call/:callId` dạng overlay, `/settings`) và route guard.
3. Từng màn hình: wireframe ASCII cho desktop (≥1024px, 2 cột) và mobile (<768px, 1 cột); cây component (tên file/component cụ thể); nguồn dữ liệu (query/store/socket event); tương tác; các trạng thái loading/empty/error. Bắt buộc có:
   - Đăng nhập/Đăng ký.
   - Danh sách chat (tìm kiếm, badge chưa đọc, chấm online, preview, typing trong preview).
   - Phòng chat (gom nhóm bubble, ngăn ngày, chỉ báo trạng thái ✓ / ✓✓ / ✓✓ xanh / ⚠ thử lại, typing, nút "tin mới ↓" khi đang cuộn lên, khóa E2EE).
   - Tạo nhóm và quản lý thành viên.
   - Cuộc gọi đến (toàn màn hình + nhạc chuông).
   - Cuộc gọi đi.
   - Đang gọi voice/video (PiP video local, các nút điều khiển).
   - Cài đặt (thiết bị, quyền riêng tư, xác minh safety number).
4. **Ma trận trạng thái UI** (bảng: Trạng thái | Điều kiện kích hoạt | Hiển thị | Hành động khả dụng | Văn bản tiếng Việt chính xác | Thoát khi). Tối thiểu gồm:
   - Socket: connecting, reconnecting, offline, session hết hạn.
   - Tin nhắn: pending, failed.
   - Cuộc gọi: ringing (đi/đến), connecting, connected, reconnecting, poor network, kết thúc với từng lý do.
   - Lỗi media: `NotAllowedError`, `NotFoundError`, `NotReadableError` (thiết bị đang bị app khác dùng), `OverconstrainedError`, insecure context, trình duyệt không hỗ trợ.
   - Autoplay bị chặn (cần chạm để phát âm thanh).
5. Hướng dẫn microcopy tiếng Việt, toast/banner/modal dùng khi nào.
6. Accessibility: phím tắt (Enter gửi, Shift+Enter xuống dòng, Esc), `aria-label` cho nút cuộc gọi, `aria-live` cho tin mới và trạng thái cuộc gọi, quản lý focus khi có cuộc gọi đến.
7. Responsive và mobile web: xử lý bàn phím ảo, safe-area, khóa cuộn khi đang gọi, tab chạy nền (dùng `visibilitychange` để quyết định khi nào gửi read receipt).

## 6.5 `.spec/api_spec.yaml`

- OpenAPI **3.0.3** hợp lệ, phải qua được `@redocly/cli lint`.
- `servers`: local `http://localhost:4000/api/v1`.
- `securitySchemes`: `bearerAuth` và `refreshCookie`.
- Endpoint tối thiểu:
  - Auth: `POST /auth/register, /auth/login, /auth/refresh, /auth/logout`; `GET /auth/me`.
  - User: `GET /users/search?q=`; `PATCH /users/me`; `POST/DELETE /users/{userId}/block`.
  - Conversation: `GET /conversations` (cursor); `POST /conversations` (direct/group/secret, idempotent cho direct); `GET /conversations/{id}`; `PATCH /conversations/{id}`; `POST /conversations/{id}/members`; `DELETE /conversations/{id}/members/{userId}`.
  - Message: `GET /conversations/{id}/messages` (cursor `before/after`, `limit`); `POST /conversations/{id}/read`.
  - Call: `GET /calls` (lịch sử); `GET /calls/ice-servers`.
  - E2EE: `PUT /e2ee/devices/{deviceId}/keys`; `GET /e2ee/users/{userId}/bundles`; `POST /e2ee/devices/{deviceId}/prekeys`.
  - Health: `GET /health`.
- Mỗi endpoint có: `operationId`, tag, request schema với ràng buộc (`minLength`, `maxLength`, `pattern`, `format`), **example** request/response, và response 200/201, 400, 401 (bắt buộc), cùng 403/404/409/422/429 khi áp dụng. Mọi response lỗi dùng `$ref` tới `ErrorResponse`.
- `components/schemas` định nghĩa đầy đủ enum ở mục 3.1 và DTO: `UserPublic, AuthResponse, Conversation, ConversationSummary, Member, Message, MessagePage, CallRecord, IceServersResponse, PreKeyBundle, ErrorResponse`.
- Header `X-Request-Id` (response) và `Idempotency-Key` cho `POST /conversations`.
- Thêm `x-socket-events` ở gốc file: liệt kê event, payload `$ref` và ACK, để Agent sinh type cho socket.

## 6.6 `.spec/development_guide.md`

1. Yêu cầu: Node 22, npm 10, Docker, mkcert. Giải thích vì sao cần HTTPS khi test `getUserMedia` từ điện thoại trong mạng LAN.
2. Clone, `npm install`, cấu trúc workspace, `package.json` gốc với scripts đầy đủ: `dev, dev:client, dev:server, build, test, test:unit, test:integration, test:e2e, lint, typecheck, db:indexes, db:seed, infra:up, infra:down`.
3. **Nội dung `infra/docker-compose.yml` hoàn chỉnh**: MongoDB khởi tạo replica set `rs0` bằng healthcheck/init script; Redis có mật khẩu; coturn với cấu hình test; volume và healthcheck.
4. **Nội dung `.env.example` hoàn chỉnh** cho server và client (biến client có tiền tố `VITE_`), mỗi biến có chú thích. Gồm: PORT, CORS_ORIGINS, MONGODB_URI, REDIS_URL, JWT_ACCESS_SECRET, JWT_ISSUER, JWT_AUDIENCE, REFRESH_TOKEN_PEPPER, COOKIE_SECURE, DATA_ENCRYPTION_KEYS, DATA_ENCRYPTION_ACTIVE_KEY_ID, SOCKET_PATH, SOCKET_PING_INTERVAL, SOCKET_PING_TIMEOUT, STUN_URLS, XIRSYS_IDENT, XIRSYS_SECRET, XIRSYS_CHANNEL, XIRSYS_API_URL, TURN_FALLBACK_URLS/USERNAME/CREDENTIAL (coturn local), ICE_TRANSPORT_POLICY, CALL_RING_TIMEOUT_MS, LOG_LEVEL, VITE_API_URL, VITE_SOCKET_URL. Kèm lệnh sinh secret.
5. Quy trình chạy nhanh: `npm run infra:up`, `npm run db:indexes`, `npm run db:seed` (tạo 3 user mẫu: alice, bob, carol với mật khẩu dev), `npm run dev`. Ghi rõ URL và cổng.
6. Cách test cuộc gọi: hai trình duyệt hoặc hai profile; Chrome flag `--use-fake-device-for-media-stream`; ép relay để kiểm tra TURN; kiểm tra qua `chrome://webrtc-internals`.
7. Thứ tự triển khai theo milestone (M0 Nền tảng → M1 Auth → M2 Conversations → M3 Messages + receipts → M4 Presence/Typing → M5 Calls → M6 Hardening → M7 E2EE). Mỗi milestone có checklist và các AC/test phải pass.
8. Quy ước code: ESLint + Prettier, commit convention, cách tổ chức shared types, quy tắc "cập nhật spec trước khi đổi hợp đồng".
9. Troubleshooting: replica set chưa khởi tạo, CORS/cookie với SameSite, socket không kết nối, ICE failed, camera bị chiếm, mixed content.

# 7. NHÓM EDGE CASE BẮT BUỘC PHẢI PHỦ

Ma trận edge case (mục 6.2) và các AC phải phủ đủ các nhóm sau. Mỗi tình huống có ID `EC-<NHÓM>-<số>`.

- **AUTH**: đăng ký trùng (đua nhau); token hết hạn giữa phiên socket; refresh đồng thời từ 2 tab (cần lock hoặc grace window chống phát hiện reuse sai); tái sử dụng refresh token bị đánh cắp; tài khoản bị khóa khi đang có socket; đổi mật khẩu thì thu hồi phiên khác; logout khi đang gọi.
- **NET** (mạng/socket): mất mạng đột ngột; reconnect liên tục (flapping); server restart; ACK bị mất sau khi đã persist; event đến sai thứ tự; event trùng; reconnect trong lúc đang fetch lịch sử; tab chạy nền bị throttle timer; máy ngủ/thức dậy; proxy chặn WebSocket nên phải fallback polling.
- **MSG**: tin rỗng hoặc chỉ khoảng trắng; vượt độ dài; emoji/Unicode tổ hợp/zero-width/RTL; payload XSS; giả mạo `senderId`; `clientMessageId` không phải UUID; outbox đầy; receipt đến trước tin nhắn; read receipt khi tab không hiển thị; người dùng bị xóa khỏi nhóm khi đang gửi dở; gửi tới người đã chặn mình; lệch đồng hồ giữa thiết bị; cuộn lên trong lúc tin mới đến; cùng một hội thoại mở trên nhiều thiết bị; sửa/xóa sau 15 phút.
- **GROUP**: thêm vượt `GROUP_MAX_MEMBERS`; danh sách thêm có trùng; thêm người đã chặn; OWNER rời nhóm; ADMIN xóa OWNER; hai admin thao tác cùng lúc; thành viên bị xóa vẫn còn trong socket room.
- **PRES**: nhiều tab; một tab đóng nhưng tab khác còn mở; crash không gửi disconnect; quyền riêng tư ẩn lastSeen; Redis mất dữ liệu.
- **CALL-SIG** (signaling): gọi người đang offline; gọi người đang bận; glare; đổ chuông trên nhiều thiết bị; accept và cancel đến cùng lúc; accept sau timeout; offer đến khi `signalingState` không phù hợp; ICE candidate đến trước remote description; candidate trùng; replay signaling của cuộc gọi cũ; người không tham gia gửi signaling; gọi trong hội thoại GROUP (MVP từ chối); gọi người đã chặn; spam lời mời.
- **CALL-MEDIA**: không có micro; không có camera thì fallback voice; từ chối quyền; người dùng tắt prompt quyền; thiết bị đang bị app khác dùng; rút tai nghe hoặc Bluetooth giữa cuộc gọi (`devicechange`); `track.onended`; trình duyệt không hỗ trợ WebRTC; insecure context; autoplay bị chặn; mobile tắt camera khi chuyển app; cuộc gọi kết thúc khi `getUserMedia` còn đang chờ (phải stop track muộn).
- **CALL-NET**: đổi Wi-Fi sang 4G (ICE restart); `disconnected` thoáng qua so với `failed`; NAT đối xứng cần TURN; UDP bị chặn nên dùng TURN over TCP/TLS 443; TURN credential hết hạn; Xirsys API lỗi nên fallback STUN + coturn; hai bên hồi phục lệch thời điểm; một bên đã end nhưng bên kia còn reconnect; server restart giữa cuộc gọi (media P2P vẫn chạy, signaling mất, phải reconcile trạng thái).
- **INFRA**: MongoDB down (NACK `SERVICE_UNAVAILABLE`, tin giữ trong outbox); Redis down (degrade: presence không xác định, rate limit fail-closed hoặc fail-open, chốt một lựa chọn và ghi rõ); transaction bị abort phải retry.
- **SEC**: liệt kê dò `conversationId`; vượt quyền join room; receipt giả mạo; CSRF; brute-force login; secret lọt vào bundle; log lộ token; lời mời gọi spam.
- **E2EE**: người nhận chưa đăng ký thiết bị; hết one-time prekey; identity key thay đổi; giải mã thất bại; tin đến từ thiết bị đã thu hồi; người dùng xóa IndexedDB; đăng nhập trên thiết bị mới thì không đọc được lịch sử Secret Chat cũ (ghi rõ đây là hành vi thiết kế).

# 8. QUY TẮC ĐỊNH DẠNG ĐẦU RA (BẮT BUỘC)

1. Viết bằng **tiếng Việt**. Tên định danh, enum, event, field, đường dẫn và code giữ nguyên tiếng Anh.
2. Ghi trực tiếp nội dung vào file `.spec/<tên>` bằng công cụ ghi file, không in toàn bộ nội dung ra chat.
3. Mỗi lượt chỉ sinh 1 file, theo thứ tự ở mục 6. Nếu được truyền tham số thì sinh đúng file đó: $ARGUMENTS
   Sau khi ghi xong, tóm tắt 5 dòng và dừng lại chờ tôi review.
4. Không viết "...", "tương tự như trên", "TODO", hay "tùy chọn triển khai" thay cho nội dung. Mọi bảng, schema và ví dụ phải đầy đủ.
5. Không bịa phiên bản thư viện hay API của nhà cung cấp mà bạn không chắc. Khi cần, ghi `// Xác minh với tài liệu chính thức của <nhà cung cấp>` kèm giả định đang dùng.

# 9. TỰ KIỂM TRA TRƯỚC KHI KẾT THÚC MỖI FILE

Cuối mỗi file, thêm mục `## Consistency Check` dạng checklist, xác nhận:
- [ ] Mọi enum, event, mã lỗi và hằng số khớp mục 2 và 3.
- [ ] Mọi FR/AC liên quan được tham chiếu bằng ID.
- [ ] Mọi edge case liên quan file này có ID trong ma trận.
- [ ] Không có secret thật, không có chỗ để trống.
- [ ] Không mâu thuẫn với các file đã sinh trước đó (liệt kê các điểm đã đối chiếu).

Sau file thứ 6, sinh thêm `## Traceability Matrix`: bảng `FR → AC → Edge case → API/Event → Collection → Màn hình UI → Test ID`, phủ toàn bộ FR.

Bắt đầu ngay với file 1/6: `.spec/system_architecture.md`.