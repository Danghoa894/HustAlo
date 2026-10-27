# HUSTALO — System Architecture

| Thuộc tính | Giá trị |
|---|---|
| Version | 1.0.0 |
| Status | Draft — chờ review (file 1/6) |
| Ngày | 2026-10-27 |
| Phạm vi | Kiến trúc tổng thể MVP: Chat realtime 1-1/nhóm, Voice/Video call 1-1 (WebRTC), Presence/Typing/Receipts, mã hóa lưu trữ AES-256-GCM, Secret Chat E2EE (Signal Protocol) |

**File liên quan (bộ spec `.spec/`):**

| File | Vai trò | Quan hệ với file này |
|---|---|---|
| `system_architecture.md` | (file này) Kiến trúc, cấu trúc mã nguồn, luồng, state machine, hợp đồng chung | Nguồn sự thật cho hằng số, enum, mã lỗi, tên event, cấu trúc thư mục, registry ID |
| `product_requirements.md` | FR, AC, ma trận edge case, NFR, DoD | Phải dùng đúng FR/EC ID đã cấp ở Phụ lục B, C |
| `database_schema.md` | Collection, index, Mongoose schema, Redis keys | Phải khớp mục 9, 10 và Phụ lục A (Redis key) |
| `ui_ux_spec.md` | Design system, màn hình, ma trận trạng thái UI | Phải khớp mục 8.6 (ánh xạ trạng thái cuộc gọi → UI) và cây thư mục `client/` |
| `api_spec.yaml` | OpenAPI 3.0.3 + `x-socket-events` | Phải khớp mục 4.5 (danh mục event) và mục 4.6 (danh mục endpoint) |
| `development_guide.md` | Cài đặt, docker-compose, env, milestone | Phải khớp mục 4.1 (cây thư mục), mục 11 (biến môi trường bổ sung) |

**Bảng thuật ngữ:**

| Thuật ngữ | Nghĩa trong HUSTALO |
|---|---|
| Device / `deviceId` | Một trình duyệt/profile cụ thể. Client sinh UUID v4 lần đầu chạy, lưu ở `localStorage` key `hustalo.deviceId`, gửi khi login và khi handshake socket. Một user có nhiều device. |
| Session family / `sid` | Chuỗi refresh token sinh ra từ một lần đăng nhập trên một device. `sid` nằm trong access token. Thu hồi family = đăng xuất device đó. |
| Fan-out | Server phát một sự kiện tới nhiều socket (mọi device của mọi thành viên). |
| Outbox | Hàng đợi tin chờ gửi phía client, lưu trong IndexedDB, chịu được reload/mất mạng. |
| Receipt | Trạng thái DELIVERED / READ của tin nhắn. |
| Cursor (receipt) | Con trỏ `(messageCreatedAt, messageId)` đánh dấu "đã nhận/đã đọc tới tin này". |
| Cursor (phân trang) | Chuỗi base64url mã hóa `(createdAt, _id)` dùng cho `before`/`after`. |
| Signaling | Trao đổi SDP/ICE qua Socket.IO để thiết lập WebRTC. Media không đi qua server ứng dụng. |
| Glare | Hai người gọi nhau gần như cùng lúc. |
| ICE restart | Tạo lại ICE candidates (offer với `iceRestart: true`) khi mạng đổi/đứt. |
| Lease | Bản ghi presence có hạn trong Redis, phải được gia hạn định kỳ. |
| Deadline | Mốc timeout của cuộc gọi lưu trong Redis ZSET `call:deadlines`, được sweeper xử lý (sống sót qua restart). |
| Key ring | Tập master key AES định danh bằng `keyId` dùng cho mã hóa lưu trữ. |
| Bundle | Prekey bundle Signal: `identityKey + signedPreKey + oneTimePreKey?` của một device. |
| Envelope (E2EE) | `{ v, senderDeviceId, recipients: [{ deviceId, type, body }] }` — ciphertext fan-out theo device. |
| Safety number | Chuỗi 60 chữ số suy ra từ identity key hai bên để xác minh ngoài kênh. |
| MVP | Phạm vi milestone M0–M7 trong `development_guide.md`. |

---

## 1. Mục tiêu kiến trúc và ràng buộc phi chức năng

### 1.1 Mục tiêu kiến trúc

| ID | Mục tiêu | Hệ quả thiết kế |
|---|---|---|
| G-01 | **Server là nguồn sự thật duy nhất** cho thứ tự tin nhắn, receipt, trạng thái cuộc gọi | Server gán `createdAt`, `_id`; `CallStatus` chỉ đổi qua state machine phía server (Lua atomic); client chỉ phản chiếu. |
| G-02 | **Không mất tin, không nhân đôi tin** | Outbox client + `clientMessageId` (UUID v4) + unique index `(conversationId, senderId, clientMessageId)`; ACK chỉ sau commit. |
| G-03 | **Chịu lỗi mạng như trạng thái bình thường** | Reconnect + `connectionStateRecovery` + sync qua REST; idempotent mọi thao tác ghi; dedupe `eventId` phía client. |
| G-04 | **Bảo mật theo lớp** | TLS mọi kết nối; AES-256-GCM tầng ứng dụng cho `content`; E2EE cho SECRET; JWT ngắn hạn + refresh xoay vòng; phân quyền ở mọi handler. |
| G-05 | **Một process ở MVP, scale ngang được về sau** | Mọi trạng thái tạm (presence, typing, call, rate limit, deadline) nằm ở Redis, không ở RAM process; Socket.IO adapter Redis Streams khi chạy nhiều instance. |
| G-06 | **Hợp đồng dùng chung** | Enum, hằng số, Zod schema, tên event ở `packages/shared`; client và server import cùng một nguồn. |
| G-07 | **Code được ngay bởi AI agent** | Cấu trúc thư mục cố định tới cấp file, mỗi luồng có sequence + điểm kiểm tra quyền + mã lỗi. |

### 1.2 Ràng buộc phi chức năng (NFR mức kiến trúc)

Các con số dưới đây là mục tiêu đo được; `product_requirements.md` mục NFR dùng lại đúng các số này.

| ID | Thuộc tính | Mục tiêu | Cách đo |
|---|---|---|---|
| NFR-ARCH-01 | Độ trễ ACK `message:send` | p95 ≤ 300 ms (môi trường test: 1 instance, Mongo/Redis local, 50 user đồng thời, 5 msg/s tổng) | Histogram `hustalo_message_send_ack_seconds` |
| NFR-ARCH-02 | Độ trễ fan-out `message:new` | p95 ≤ 500 ms từ lúc commit tới lúc socket người nhận nhận event | Playwright đo `occurredAt` vs thời điểm nhận (cùng máy) |
| NFR-ARCH-03 | Thiết lập cuộc gọi | p95 ≤ 5 s từ `call:accept` tới `CONNECTED` khi có đường direct (host/srflx) | Histogram `hustalo_call_setup_seconds` |
| NFR-ARCH-04 | Phát hiện offline | ≤ `PRESENCE_LEASE_TTL_MS` (60 s) khi crash; ≤ `PRESENCE_OFFLINE_GRACE_MS` (10 s) + 1 s khi disconnect sạch | Integration test presence |
| NFR-ARCH-05 | Khả dụng MVP | 1 instance; restart không làm mất tin đã ACK, không làm treo trạng thái cuộc gọi quá `CALL_RECONNECT_GRACE_MS` + 5 s | Test EC-NET-003, EC-CALL-NET-009 |
| NFR-ARCH-06 | Tải MVP | 1.000 socket đồng thời / instance, 200 cuộc gọi signaling đồng thời | Load test k6 (M6) |
| NFR-ARCH-07 | Trình duyệt | Chrome/Edge/Firefox 2 phiên bản gần nhất, Safari 17+ | Ma trận Playwright (Chromium, Firefox, WebKit) |
| NFR-ARCH-08 | Bảo mật | 0 secret trong bundle client; 0 log chứa token/nội dung/SDP/ICE | Test SEC: quét `dist/` và log capture |
| NFR-ARCH-09 | Accessibility | WCAG 2.1 AA cho luồng login, chat, cuộc gọi | axe-core trong Playwright |

### 1.3 Ràng buộc cố định

- Tech stack ở mục 2 **không được thay đổi**.
- Gọi nhóm (group call), gửi file/ảnh, push notification, tìm kiếm full-text nội dung tin nhắn: **ngoài phạm vi MVP**.
- Secret Chat chỉ 1-1, không có SECRET GROUP.
- Media WebRTC là P2P (có thể relay qua TURN); **không có SFU/MCU** ở MVP.

---

## 2. Tech stack và trách nhiệm từng thành phần

| Thành phần | Công nghệ | Trách nhiệm | Không chịu trách nhiệm |
|---|---|---|---|
| Frontend | React 18 + Vite + TypeScript strict + Tailwind CSS | Render UI, quản lý media, RTCPeerConnection, outbox, khóa E2EE | Quyết định thứ tự tin, trạng thái cuộc gọi chính thức |
| State client | Zustand | Trạng thái realtime: auth, socket, presence, typing, call, outbox | Cache dữ liệu REST |
| REST cache | TanStack Query | Cache danh sách hội thoại, lịch sử tin (infinite query), lịch sử cuộc gọi | Event realtime (được ghi vào cache qua `queryClient.setQueryData`) |
| Routing | React Router | Route + guard (mục 4.1 `client/src/routes`) | — |
| Backend HTTP | Node.js 22 LTS + Express + TypeScript | REST `/api/v1`, auth, cookie, CSRF, validation | Realtime |
| Validation | Zod (shared) | Validate mọi input REST/Socket; suy ra TypeScript type | — |
| Realtime | Socket.IO v4 (cùng process với Express) | Gateway: auth handshake, room, ACK, fan-out, signaling | Lưu trữ lâu dài |
| Signaling | Socket.IO namespace `/`, event `call:*` | Chuyển tiếp SDP/ICE giữa đúng 2 device tham gia, áp state machine | Media |
| Media | WebRTC trình duyệt; STUN `stun:stun.l.google.com:19302`; TURN Xirsys (credential ngắn hạn qua backend) | Truyền audio/video mã hóa DTLS-SRTP | — |
| DB chính | MongoDB 7 + Mongoose, **replica set `rs0`** (kể cả local single-node) | Dữ liệu bền: user, session, hội thoại, tin, receipt, lịch sử gọi, khóa công khai E2EE | Trạng thái tạm |
| Ephemeral | Redis 7 | Presence lease, typing, rate limit, active call state, deadline, cache ICE, danh sách session bị thu hồi, adapter Socket.IO khi scale | Dữ liệu cần bền |
| Auth | JWT access **HS256** 15 phút (thư viện `jose`) + refresh opaque xoay vòng 30 ngày (cookie HttpOnly) | Xác thực REST/socket | — |
| Mật khẩu | Argon2id (thư viện `argon2`) | Hash/verify | — |
| Mã hóa lưu trữ | AES-256-GCM (`node:crypto`) có `keyId` | Mã hóa `content` tin DIRECT/GROUP | Tin SECRET (đã là ciphertext E2EE) |
| E2EE | Signal Protocol (X3DH + Double Ratchet) — xem quyết định D-12 | Mã hóa đầu-cuối Secret Chat 1-1 phía client | Server không giải mã |
| Monorepo | npm workspaces: `client/`, `server/`, `packages/shared/` | — | — |
| Local infra | Docker Compose: MongoDB (rs0), Redis (có mật khẩu), coturn (test TURN local), mongo-express (tùy chọn bật bằng profile) | — | — |
| Test | Vitest (unit), Supertest + mongodb-memory-server replica set (integration), Playwright có fake media device (E2E) | — | — |
| Log | pino + pino-http | Log JSON có cấu trúc, redact | — |
| Metric | prom-client | Endpoint `/metrics` trên cổng nội bộ `METRICS_PORT` | — |
| Bảo mật HTTP | helmet, cors (whitelist), cookie-parser | Header, CORS, đọc cookie | — |
| Rate limit | `rate-limiter-flexible` trên Redis (atomic) + limiter bộ nhớ dự phòng | Mục 10.2 | — |

### 2.1 Quyết định thiết kế đã chốt

| ID | Quyết định | Lý do |
|---|---|---|
| D-01 | Server dùng cấu trúc `src/modules/*` (nghiệp vụ) + `src/realtime/*` (Socket.IO) + `src/infra/*` (Mongo, Redis, crypto, logger, TURN) + `src/http/*` (middleware Express). Không dùng tên `socket/`, `infrastructure/`, `database/`. | Sửa mâu thuẫn #1 của bản nháp. |
| D-02 | JWT ký **HS256** với `JWT_ACCESS_SECRET` ≥ 32 byte. EdDSA để dành khi tách service. | Một service duy nhất ký và verify; đơn giản. |
| D-03 | **Glare: server gộp hai lời mời thành một cuộc gọi** (không dùng luật userId nhỏ thắng). | Redis Lua serialize mọi `call:invite`; lời mời thứ hai từ chính người được gọi được hiểu là "nghe máy". Xem mục 7(g). |
| D-04 | Người gọi (`callerDeviceId`) **luôn là bên tạo offer**, kể cả khi ICE restart. Người nghe chỉ answer; muốn restart thì gửi `call:ice-restart` để yêu cầu. | Loại bỏ glare SDP, không cần perfect negotiation. |
| D-05 | Timeout cuộc gọi lưu dạng **deadline trong Redis ZSET `call:deadlines`**, sweeper mỗi `CALL_DEADLINE_SWEEP_INTERVAL_MS` (1 s). Không dùng `setTimeout` trong RAM làm nguồn sự thật. | Sống sót qua restart, đúng khi nhiều instance. |
| D-06 | Đang đổ chuông cũng tính là bận: `user:incall:{userId}` được set cho cả caller và callee ngay khi `call:invite` thành công. | Tránh một người đổ chuông 2 cuộc gọi; điều kiện cần cho D-03. |
| D-07 | Từ chối trên **một** thiết bị bất kỳ của callee → cuộc gọi `REJECTED` cho mọi thiết bị. | Hành vi giống Zalo/Telegram. |
| D-08 | Gọi người đang offline: cuộc gọi ở `INITIATED` tối đa `CALL_RING_TIMEOUT_MS`; nếu callee online trong khoảng đó, server đẩy `call:incoming` ngay khi socket kết nối; hết giờ → `MISSED`. | Không có push notification ở MVP nhưng vẫn bắt được trường hợp reconnect nhanh. |
| D-09 | Fan-out `message:new`, `message:edit`, `message:delete`, `typing:update`, `conversation:*` gửi tới room `user:{memberId}` của **thành viên hiện tại đọc từ DB**, không dựa vào room hội thoại. Room `conv:{conversationId}` chỉ dùng cho cập nhật receipt nhóm tần suất cao (`message:status` loại GROUP_AGGREGATE). | Thành viên bị xóa không nhận gì dù còn kẹt trong room (EC-GROUP-007); preview typing ở danh sách chat vẫn hoạt động. |
| D-10 | Rate limit khi Redis down: **auth (login/register/refresh) fail-closed** (503 `SERVICE_UNAVAILABLE`); mọi rule khác **fail-open có kiểm soát** sang limiter bộ nhớ per-instance cùng hạn mức. | Chống brute-force tuyệt đối; không làm sập chat vì Redis. |
| D-11 | Một conversation SECRET duy nhất cho mỗi cặp user (idempotent như DIRECT). | Đơn giản hóa UI và key routing. |
| D-12 | Client E2EE dùng **`@privacyresearch/libsignal-protocol-typescript`** (bản port TypeScript của libsignal chạy trên trình duyệt). `@signalapp/libsignal-client` là native Node addon, không có bản build chính thức cho trình duyệt nên không dùng ở client; server không cần thư viện Signal (chỉ lưu khóa công khai). | Ràng buộc "hoặc tương đương đã kiểm chứng" ở tech stack. `// Xác minh với tài liệu chính thức của @privacyresearch/libsignal-protocol-typescript: giả định cung cấp SessionBuilder, SessionCipher, KeyHelper, SignalProtocolAddress, store interface tùy biến, và chưa hỗ trợ PQXDH/Kyber.` Rủi ro: bản port cộng đồng, chưa được Signal audit — ghi vào rủi ro R-04. |
| D-13 | Socket.IO khi scale dùng **`@socket.io/redis-streams-adapter`** (không dùng `@socket.io/redis-adapter` kiểu pub/sub). | `connectionStateRecovery` chỉ tương thích adapter có lưu trữ (Redis Streams). `// Xác minh với tài liệu chính thức của Socket.IO: danh sách adapter tương thích connectionStateRecovery.` |
| D-14 | `connectionStateRecovery.skipMiddlewares = false`. | Middleware auth luôn chạy lại khi recover, token hết hạn/bị thu hồi không được "lách" qua recovery. `// Xác minh với tài liệu chính thức của Socket.IO: mặc định skipMiddlewares là true.` |
| D-15 | Delivered và read đều gửi lên dạng **cursor** `{ conversationId, upToMessageId }` cho mọi loại hội thoại. Lưu trữ: DIRECT/SECRET → `messageReceipts` từng tin; GROUP → cursor trên `conversationMembers`. | Một API cho client, hai mô hình lưu trữ theo yêu cầu. |
| D-16 | Tin SECRET hỗ trợ **thu hồi** (`message:delete`) nhưng **không hỗ trợ sửa** ở MVP (`message:edit` → `FORBIDDEN`). | Sửa ciphertext đa thiết bị phức tạp; ngoài phạm vi. |
| D-17 | Độ dài tin nhắn đếm theo **Unicode code point** (`Array.from(s).length`) sau khi chuẩn hóa NFC và trim (trim cả khoảng trắng Unicode và ký tự zero-width U+200B–U+200D, U+2060, U+FEFF ở hai đầu). | Nhất quán client/server; emoji không bị đếm đôi theo UTF-16. |
| D-18 | Session socket hết hạn: server hẹn giờ theo `exp` của access token → phát `session:expired`, sau `SESSION_EXPIRED_DISCONNECT_DELAY_MS` (5 s) thì `disconnect(true)`. Client chủ động refresh trước `exp` `ACCESS_TOKEN_REFRESH_SKEW_S` (60 s) và reconnect với token mới. | Giữ đúng hợp đồng `session:expired` + reconnect. |
| D-19 | Refresh đồng thời nhiều tab: client dùng **Web Locks API** (`navigator.locks.request('hustalo-refresh', …)`); server có cửa sổ ân hạn `REFRESH_REUSE_GRACE_S` (10 s): token **vừa bị xoay** được dùng lại trong 10 s trả `409 CONFLICT` (không thu hồi); ngoài cửa sổ hoặc token cũ hơn → thu hồi cả family. | Tránh báo động giả reuse (EC-AUTH-003) mà vẫn bắt token bị đánh cắp (EC-AUTH-004). |
| D-20 | Thứ tự hiển thị, phân trang và so sánh cursor luôn theo cặp `(createdAt, _id)` do server sinh. | Không phụ thuộc đồng hồ client (EC-MSG-012). |
| D-21 | Chặn người dùng (`userBlocks`) có hiệu lực **hai chiều** cho DIRECT/SECRET và cuộc gọi: nếu A chặn B **hoặc** B chặn A thì không ai gửi tin/gọi được trong hội thoại 1-1 → `USER_BLOCKED`. Trong GROUP, chặn không ngăn gửi tin nhóm; nhưng không thể thêm vào nhóm người đã chặn mình. | Giống Zalo; tránh rò rỉ "ai chặn ai" qua mã lỗi (cùng một mã). |
| D-22 | Gọi trong conversation `GROUP` bị từ chối bằng `VALIDATION_ERROR` với message `"Cuộc gọi nhóm chưa được hỗ trợ"`. UI ẩn nút gọi trong nhóm. | Sửa thiếu sót #8. |
| D-23 | OWNER rời nhóm khi chưa chuyển quyền → `CONFLICT` (409). ADMIN xóa/hạ quyền OWNER → `FORBIDDEN`. | Sửa mâu thuẫn #4/#8. |

### 2.2 Rủi ro đã biết

| ID | Rủi ro | Giảm thiểu |
|---|---|---|
| R-01 | Gói miễn phí Xirsys có quota băng thông/kết nối | Kiểm tra lại quota trước production; fallback coturn tự host (`TURN_FALLBACK_URLS`). `// Xác minh với tài liệu chính thức của Xirsys: giới hạn gói free.` |
| R-02 | Safari có khác biệt WebRTC (autoplay, `devicechange`, H.264 ưu tiên) | Ma trận Playwright WebKit + test tay Safari 17 trước release. |
| R-03 | Server vẫn đọc được nội dung tin thường (AES tầng ứng dụng không phải E2EE) | Ghi rõ trong UI/PRD; chỉ hiển thị "Mã hóa đầu-cuối" cho SECRET đã có session. |
| R-04 | Thư viện Signal phía trình duyệt là bản port cộng đồng | Khóa phiên bản trong `package-lock.json`; review mã nguồn trước M7; cô lập sau interface `client/src/lib/e2ee/signal-adapter.ts` để thay thế được. |
| R-05 | Mỗi 15 phút socket reconnect do xoay access token | `connectionStateRecovery` + presence grace 10 s + call không đổi trạng thái chỉ vì socket rớt (mục 8.4). |

---

## 3. Sơ đồ tổng quan

```text
                                   Internet (TLS 1.2+ bắt buộc)
 ┌────────────────────────────────────────────────────────────────────────────────────────────┐
 │  Browser (React SPA)                                                                       │
 │  ┌──────────────┐ ┌───────────────┐ ┌────────────────┐ ┌──────────────┐ ┌───────────────┐  │
 │  │ UI (React)   │ │ Zustand stores│ │ TanStack Query │ │ Outbox (IDB) │ │ Signal store  │  │
 │  └──────┬───────┘ └──────┬────────┘ └───────┬────────┘ └──────┬───────┘ │ (IDB, private │  │
 │         │                │                  │                 │         │  keys local)  │  │
 │  ┌──────┴────────────────┴───┐   ┌──────────┴─────────────────┴─┐       └───────────────┘  │
 │  │ socket.io-client (WSS,    │   │ fetch wrapper (HTTPS,        │   ┌───────────────────┐  │
 │  │ fallback HTTP long-poll)  │   │ Bearer + CSRF + cookie)      │   │ RTCPeerConnection │  │
 │  └────────────┬──────────────┘   └──────────────┬───────────────┘   └───┬───────┬───────┘  │
 └───────────────┼─────────────────────────────────┼───────────────────────┼───────┼──────────┘
                 │ wss://host/socket.io            │ https://host/api/v1   │ DTLS- │ STUN
                 ▼                                 ▼                       │ SRTP  │ (UDP 19302)
 ┌──────────────────────────────────────────────────────────┐              │       ▼
 │ Reverse proxy / TLS termination                          │              │  ┌──────────────────┐
 │  Prod: Nginx/Caddy (HSTS, CSP, phục vụ client/dist)      │              │  │ stun.l.google.com│
 │  Local: Vite dev server HTTPS (mkcert) proxy /api,       │              │  └──────────────────┘
 │         /socket.io → http://localhost:4000               │              │
 └───────────────────────────┬──────────────────────────────┘              │  ┌──────────────────────┐
                             │ HTTP nội bộ (cùng host/VPC)                 └─▶│ TURN (Xirsys)        │
                             ▼                                    media relay │ udp/tcp 3478,        │
 ┌──────────────────────────────────────────────────────────────────────┐    │ tls 443 (turns:)     │
 │ server process (Node 22)                                             │    │ Local test: coturn   │
 │ ┌───────────────────────────────┐  ┌───────────────────────────────┐ │    └──────────────────────┘
 │ │ Express REST /api/v1          │  │ Socket.IO Gateway (ns "/")    │ │               ▲
 │ │ helmet · cors · requestId ·   │  │ socket-auth mw · rate-limit · │ │               │ HTTPS PUT
 │ │ auth mw · csrf · validate     │  │ envelope/ACK wrapper          │ │               │ (ident/secret
 │ │ routes → controller → service │  │ handlers/*.handler.ts         │ │               │  chỉ ở server)
 │ └──────────────┬────────────────┘  └───────┬───────────┬───────────┘ │    ┌──────────┴───────────┐
 │                │                           │           │ Signaling   │    │ Xirsys REST API      │
 │                ▼                           ▼           ▼ (call:*)    │    │ (cấp TURN credential)│
 │ ┌──────────────────────────────────────────────────────────────────┐ │    └──────────────────────┘
 │ │ modules/* services (auth, users, conversations, messages,        │ │               ▲
 │ │ presence, calls, e2ee, health)  — business rules, authorization  │─┼───────────────┘
 │ └───────┬──────────────────────────────────────┬───────────────────┘ │  iceServers.service.ts
 │         │ repositories (Mongoose)              │ repositories (ioredis, Lua)
 │ ┌───────┴──────────────┐            ┌──────────┴──────────────┐      │
 │ │ infra/crypto AES-GCM │            │ jobs: call deadline     │      │
 │ │ key ring, argon2, jwt│            │ sweeper, presence       │      │
 │ └──────────────────────┘            │ sweeper, reencrypt      │      │
 │                                     └─────────────────────────┘      │
 └─────────┬──────────────────────────────────────────┬─────────────────┘
           │ mongodb:// (auth, replicaSet=rs0)        │ redis:// (requirepass)
           ▼                                          ▼
 ┌───────────────────────────┐            ┌─────────────────────────────────────────┐
 │ MongoDB 7 replica set rs0 │            │ Redis 7                                 │
 │ users, refreshSessions,   │            │ presence:*, typing:*, rl:*, call:*,     │
 │ userBlocks, conversations,│            │ user:incall:*, ice:*, session:revoked:*,│
 │ conversationMembers,      │            │ socket.io streams (khi scale)           │
 │ messages, messageReceipts,│            └─────────────────────────────────────────┘
 │ callHistory, userDevices, │
 │ oneTimePreKeys            │
 └───────────────────────────┘
```

**Cổng mặc định (local):**

| Dịch vụ | Cổng | Ghi chú |
|---|---|---|
| Client (Vite, HTTPS mkcert) | 5173 | `https://localhost:5173`, hoặc `https://<LAN-IP>:5173` từ điện thoại |
| Server (Express + Socket.IO) | 4000 | `http://localhost:4000/api/v1`, socket path `/socket.io` |
| Metrics | 9464 | `http://localhost:9464/metrics`, chỉ bind `127.0.0.1` |
| MongoDB | 27017 | replica set `rs0` |
| Redis | 6379 | có `requirepass` |
| coturn | 3478 (udp+tcp), 5349 (tls) | chỉ dùng test TURN local |
| mongo-express | 8081 | chỉ bật khi `docker compose --profile tools up` |

---

## 4. Cấu trúc monorepo

### 4.1 Cây thư mục đầy đủ

Quy ước: mỗi module backend trong `server/src/modules/<module>/` có bộ file `<module>.routes.ts, <module>.controller.ts, <module>.service.ts, <module>.repository.ts, <module>.schema.ts, <entity>.model.ts, <module>.test.ts`. Ngoại lệ được liệt kê rõ (module không có REST hoặc không có collection). `*.schema.ts` trong server chỉ **re-export và ghép** schema từ `@hustalo/shared` (không định nghĩa lại hợp đồng).

```text
hustalo/
├── package.json                      # npm workspaces + scripts gốc (development_guide.md mục 2)
├── package-lock.json
├── tsconfig.base.json                # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
├── eslint.config.js                  # flat config: typescript-eslint, react-hooks, import, no-restricted-syntax
├── .prettierrc.json
├── .editorconfig
├── .gitignore                        # node_modules/, .env*, !.env.example, infra/certs/, **/dist, coverage
├── .nvmrc                            # 22
├── .redocly.yaml                     # [NEW] cấu hình redocly lint cho .spec/api_spec.yaml
├── .redocly.lint-ignore.yaml         # [NEW] ngoại lệ có chủ đích (GET /health không có 4xx)
├── CLAUDE.md
├── .spec/
│   ├── system_architecture.md
│   ├── product_requirements.md
│   ├── database_schema.md
│   ├── ui_ux_spec.md
│   ├── api_spec.yaml
│   └── development_guide.md
├── infra/
│   ├── docker-compose.yml            # mongo (rs0), redis, coturn, mongo-express (profile tools)
│   ├── mongo/
│   │   └── init-replica.js           # rs.initiate({_id:"rs0", members:[{_id:0, host:"mongo:27017"}]})
│   ├── coturn/
│   │   └── turnserver.conf           # cấu hình test, user tĩnh từ TURN_FALLBACK_*
│   └── certs/                        # mkcert output (gitignored): localhost+lan.pem, localhost+lan-key.pem
├── scripts/
│   ├── gen-secrets.mjs               # in ra JWT_ACCESS_SECRET, REFRESH_TOKEN_PEPPER, DATA_ENCRYPTION_KEYS
│   ├── check-bundle-secrets.mjs      # quét client/dist tìm chuỗi XIRSYS_/SECRET/PEPPER (EC-SEC-006)
│   └── spec-check.mjs                # [NEW] đối chiếu chéo .spec/ (npm run spec:check)
├── packages/
│   └── shared/
│       ├── package.json              # name "@hustalo/shared", exports trỏ tới src/index.ts (TS source)
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── index.ts              # re-export toàn bộ
│           ├── constants.ts          # mục 4.4.1
│           ├── enums.ts              # mục 4.4.2
│           ├── errors.ts             # mục 4.4.3: ErrorCode, ERROR_HTTP_STATUS, ErrorResponse, AckError
│           ├── schemas/
│           │   ├── common.schema.ts        # objectId, uuidV4, isoDate, pageCursor, normalizedText
│           │   ├── auth.schema.ts          # register/login/changePassword body, AuthResponse
│           │   ├── user.schema.ts          # UserPublic, updateMe, searchQuery, privacy
│           │   ├── conversation.schema.ts  # create/update/addMembers/updateMemberRole, Conversation, ConversationSummary, Member
│           │   ├── message.schema.ts       # Message DTO, MessagePage, history query, read body
│           │   ├── call.schema.ts          # CallRecord, IceServersResponse
│           │   ├── e2ee.schema.ts          # device keys, prekey upload, PreKeyBundle, E2eeEnvelope
│           │   └── socket.schema.ts        # envelope, ACK, payload từng event (mục 4.5)
│           ├── events/
│           │   ├── event-names.ts          # const EVENTS: đủ 35 tên event mục 4.5, ví dụ MESSAGE_SEND: 'message:send'
│           │   └── socket-types.ts         # ClientToServerEvents, ServerToClientEvents (typed Socket.IO)
│           ├── utils/
│           │   ├── text.ts                 # normalizeMessageText(), countCodePoints() (D-17)
│           │   ├── cursor.ts               # encodeCursor({createdAt,_id}) / decodeCursor() base64url
│           │   └── compare.ts              # compareMessageOrder(a,b) theo (createdAt,_id)
│           └── __tests__/
│               ├── text.test.ts
│               ├── cursor.test.ts
│               └── schemas.test.ts
├── server/
│   ├── package.json                  # name "@hustalo/server"; dev: tsx watch; build: tsup (bundle @hustalo/shared)
│   ├── tsconfig.json
│   ├── tsup.config.ts
│   ├── vitest.config.ts              # unit: src/**/*.test.ts trừ *.int.test.ts
│   ├── vitest.integration.config.ts  # integration: src/**/*.int.test.ts, globalSetup mongo-memory replset
│   ├── .env.example
│   └── src/
│       ├── main.ts                   # bootstrap: env → logger → mongo → redis → app → gateway → jobs → listen; SIGTERM
│       ├── app.ts                    # createApp(deps): express + middleware + router + error handler
│       ├── config/
│       │   └── env.ts                # Zod parse process.env, fail-fast; export const env
│       ├── infra/
│       │   ├── db/
│       │   │   ├── mongo.ts                # connect (replicaSet bắt buộc), health ping
│       │   │   ├── transaction.ts          # withTxn(fn): session.withTransaction, retry MONGO_TXN_MAX_RETRIES
│       │   │   ├── indexes.ts              # entry `npm run db:indexes`: Model.syncIndexes() cho mọi model
│       │   │   └── seed.ts                 # entry `npm run db:seed`: alice, bob, carol
│       │   ├── redis/
│       │   │   ├── redis.ts                # ioredis client chính; cờ healthy theo event ready/error/end
│       │   │   ├── keys.ts                 # hàm tạo key (Phụ lục A) — cấm nối chuỗi key ở nơi khác
│       │   │   └── scripts/
│       │   │       ├── call-invite.lua         # kiểm tra bận/glare + tạo call:active + user:incall (atomic)
│       │   │       ├── call-transition.lua     # CAS trạng thái: expectedFrom[] → to, tăng version
│       │   │       ├── call-deadlines-claim.lua# ZRANGEBYSCORE ≤ now LIMIT n + ZREM (claim nguyên tử)
│       │   │       ├── presence-touch.lua      # ZADD lease + ZREMRANGEBYSCORE hết hạn + trả trạng thái chuyển
│       │   │       └── presence-drop.lua       # ZREM connection, nếu 0 lease sống → ZADD offline-pending
│       │   ├── crypto/
│       │   │   ├── key-ring.ts             # parse DATA_ENCRYPTION_KEYS / DATA_ENCRYPTION_ACTIVE_KEY_ID
│       │   │   ├── aes-gcm.ts              # encryptField / decryptField (mục 9.2)
│       │   │   ├── password.ts             # argon2id hash/verify + dummy hash chống timing
│       │   │   └── random.ts               # randomToken(32), hmacSha256(pepper, value), timingSafeEqual
│       │   ├── jwt/
│       │   │   └── jwt.ts                  # signAccessToken / verifyAccessToken (jose, HS256)
│       │   ├── logger/
│       │   │   └── logger.ts               # pino + redact (mục 11.3)
│       │   ├── metrics/
│       │   │   └── metrics.ts              # prom-client registry + metric mục 11.1 + server /metrics
│       │   ├── rate-limit/
│       │   │   └── rate-limiter.ts         # factory theo RATE_LIMITS; insurance limiter bộ nhớ (D-10)
│       │   └── turn/
│       │       └── xirsys.client.ts        # gọi Xirsys REST, timeout XIRSYS_TIMEOUT_MS
│       ├── http/
│       │   ├── router.ts                   # mount /api/v1/* từ modules/*/routes
│       │   ├── errors/
│       │   │   └── app-error.ts            # class AppError(code, message, details?)
│       │   └── middleware/
│       │       ├── request-id.ts           # X-Request-Id (nhận UUID hợp lệ từ client hoặc sinh mới)
│       │       ├── security.ts             # helmet, cors whitelist, body limit REST_BODY_LIMIT_BYTES
│       │       ├── authenticate.ts         # Bearer JWT → req.auth {userId, sid, deviceId}; check revoked
│       │       ├── csrf.ts                 # double-submit cho /auth/refresh, /auth/logout
│       │       ├── rate-limit.ts           # middleware theo rule
│       │       ├── validate.ts             # validate({body, query, params}) bằng Zod
│       │       └── error-handler.ts        # AppError/ZodError/Mongo error → ErrorResponse
│       ├── realtime/
│       │   ├── gateway.ts                  # new Server(httpServer, opts mục 6.4), adapter, middleware, register handlers
│       │   ├── rooms.ts                    # userRoom, deviceRoom, tabRoom, sessionRoom, convRoom, presenceRoom
│       │   ├── emitter.ts                  # emitToUser/Device/Session/Conv: tự gắn eventId (uuid) + occurredAt
│       │   ├── with-ack.ts                 # wrap(handler, {schema, rateRule}): parse envelope, rate limit, map lỗi → ACK
│       │   ├── middleware/
│       │   │   ├── socket-auth.ts          # verify auth.token, auth.deviceId, auth.tabId; join rooms; hẹn giờ session:expired
│       │   │   └── socket-rate-limit.ts    # limiter theo socket/user cho từng event
│       │   └── handlers/
│       │       ├── session.handler.ts      # connection/disconnect lifecycle, đẩy call:incoming đang chờ khi online
│       │       ├── conversation.handler.ts # conversation:join, conversation:leave
│       │       ├── message.handler.ts      # message:send, message:delivered, message:read, message:edit, message:delete
│       │       ├── typing.handler.ts       # typing:start, typing:stop
│       │       ├── presence.handler.ts     # presence:subscribe
│       │       └── call.handler.ts         # call:invite, accept, reject, cancel, offer, answer, ice-candidate, ice-restart, end, state
│       ├── modules/
│       │   ├── auth/
│       │   │   ├── auth.routes.ts          # /auth/register, login, refresh, logout, me, change-password
│       │   │   ├── auth.controller.ts
│       │   │   ├── auth.service.ts         # register, login, rotateRefresh, logout, changePassword, revokeFamily, lockUser
│       │   │   ├── auth.repository.ts      # refreshSessions CRUD
│       │   │   ├── auth.schema.ts
│       │   │   ├── refreshSession.model.ts
│       │   │   ├── auth.test.ts            # unit: rotation/reuse logic
│       │   │   └── auth.int.test.ts        # integration Supertest
│       │   ├── users/
│       │   │   ├── users.routes.ts         # /users/search, /users/me, /users/{userId}/block
│       │   │   ├── users.controller.ts
│       │   │   ├── users.service.ts        # search, updateMe, block/unblock, isBlockedEitherWay
│       │   │   ├── users.repository.ts
│       │   │   ├── users.schema.ts
│       │   │   ├── user.model.ts
│       │   │   ├── userBlock.model.ts
│       │   │   ├── users.test.ts
│       │   │   └── users.int.test.ts
│       │   ├── conversations/
│       │   │   ├── conversations.routes.ts # /conversations, /{id}, /{id}/members, /{id}/members/{userId}
│       │   │   ├── conversations.controller.ts
│       │   │   ├── conversations.service.ts# createDirect/Secret (idempotent), createGroup, update, add/remove/role, assertMember
│       │   │   ├── conversations.repository.ts
│       │   │   ├── conversations.schema.ts
│       │   │   ├── conversation.model.ts
│       │   │   ├── conversationMember.model.ts
│       │   │   ├── conversations.test.ts
│       │   │   └── conversations.int.test.ts
│       │   ├── messages/
│       │   │   ├── messages.routes.ts      # GET /conversations/{id}/messages, POST /conversations/{id}/read
│       │   │   ├── messages.controller.ts
│       │   │   ├── messages.service.ts     # send (txn), history, edit, delete, toDTO (decrypt), createSystemMessage
│       │   │   ├── receipts.service.ts     # markDelivered, markRead (cursor, một chiều), unreadCount
│       │   │   ├── messages.repository.ts
│       │   │   ├── messages.schema.ts
│       │   │   ├── message.model.ts
│       │   │   ├── messageReceipt.model.ts
│       │   │   ├── message.crypto.ts       # encryptContent/decryptContent với AAD conversationId:messageId
│       │   │   ├── messages.test.ts
│       │   │   └── messages.int.test.ts
│       │   ├── presence/                   # NGOẠI LỆ: không routes/controller/model (chỉ Redis + socket)
│       │   │   ├── presence.service.ts     # connect/disconnect/heartbeat, snapshot, privacy filter
│       │   │   ├── presence.repository.ts  # Redis presence:* (Lua)
│       │   │   ├── presence.sweeper.ts     # xử lý presence:offline-pending → OFFLINE + lastSeenAt
│       │   │   ├── typing.service.ts       # typing:{conversationId}:{userId}
│       │   │   ├── presence.schema.ts
│       │   │   ├── presence.test.ts
│       │   │   └── presence.int.test.ts
│       │   ├── calls/
│       │   │   ├── calls.routes.ts         # GET /calls, GET /calls/ice-servers
│       │   │   ├── calls.controller.ts
│       │   │   ├── calls.service.ts        # invite/accept/reject/cancel/end/report/relay (gọi state machine)
│       │   │   ├── call.state-machine.ts   # bảng chuyển trạng thái mục 8.2 (hàm thuần, không I/O)
│       │   │   ├── callState.repository.ts # Redis call:active, user:incall, call:deadlines (Lua)
│       │   │   ├── calls.repository.ts     # Mongo callHistory
│       │   │   ├── call.sweeper.ts         # xử lý deadline mỗi CALL_DEADLINE_SWEEP_INTERVAL_MS
│       │   │   ├── iceServers.service.ts   # Xirsys + cache + fallback (mục 9.5)
│       │   │   ├── calls.schema.ts
│       │   │   ├── callHistory.model.ts
│       │   │   ├── call.state-machine.test.ts
│       │   │   ├── calls.test.ts
│       │   │   └── calls.int.test.ts
│       │   ├── e2ee/
│       │   │   ├── e2ee.routes.ts          # /e2ee/devices, /e2ee/devices/{deviceId}/keys|prekeys, /e2ee/users/{userId}/bundles
│       │   │   ├── e2ee.controller.ts
│       │   │   ├── e2ee.service.ts         # registerDevice, uploadPrekeys, getBundles (consume atomic), revokeDevice, assertEnvelope
│       │   │   ├── e2ee.repository.ts
│       │   │   ├── e2ee.schema.ts
│       │   │   ├── userDevice.model.ts
│       │   │   ├── oneTimePreKey.model.ts
│       │   │   ├── e2ee.test.ts
│       │   │   └── e2ee.int.test.ts
│       │   └── health/                     # NGOẠI LỆ: không repository/model
│       │       ├── health.routes.ts        # GET /health
│       │       ├── health.controller.ts
│       │       ├── health.service.ts       # ping mongo + redis, trạng thái degraded
│       │       ├── health.schema.ts
│       │       └── health.test.ts
│       ├── jobs/
│       │   ├── reencrypt-messages.ts       # job xoay khóa (mục 9.2.4): npm run job:reencrypt -w server
│       │   └── reconcile-calls.ts          # chạy lúc boot: callHistory non-terminal mồ côi → FAILED/SERVER_RESTART
│       └── test/
│           ├── global-setup.ts             # MongoMemoryReplSet (1 node), REDIS_URL_TEST
│           ├── factories.ts                # createUser, createConversation, loginAs
│           ├── socket-client.ts            # connectAs(user, deviceId) → typed client + emitWithAck
│           └── fake-clock.ts
└── client/
    ├── package.json                  # name "@hustalo/client"
    ├── tsconfig.json
    ├── vite.config.ts                # https mkcert, proxy /api + /socket.io → :4000 (ws: true)
    ├── tailwind.config.ts            # theme.extend từ ui_ux_spec.md
    ├── postcss.config.js
    ├── playwright.config.ts          # projects chromium/firefox/webkit; launch args fake media
    ├── index.html
    ├── .env.example
    ├── public/
    │   ├── sounds/ringtone.mp3       # nhạc chuông cuộc gọi đến
    │   ├── sounds/ringback.mp3       # âm chờ cuộc gọi đi
    │   └── favicon.svg
    ├── e2e/
    │   ├── fixtures.ts               # login nhanh qua API, 2 context (alice/bob)
    │   ├── auth.spec.ts
    │   ├── chat.spec.ts
    │   ├── group.spec.ts
    │   ├── presence.spec.ts
    │   ├── call.spec.ts
    │   ├── call-network.spec.ts      # relay-only, offline/online context
    │   └── e2ee.spec.ts
    └── src/
        ├── main.tsx
        ├── App.tsx                   # providers: QueryClientProvider, Router, ThemeProvider, CallOverlay
        ├── styles/
        │   └── index.css             # Tailwind + CSS variables design tokens
        ├── routes/
        │   ├── router.tsx            # /login, /register, /chats, /chats/:conversationId, /call/:callId, /settings
        │   └── guards/
        │       ├── RequireAuth.tsx
        │       └── RedirectIfAuthed.tsx
        ├── lib/
        │   ├── api/
        │   │   ├── http.ts           # fetch wrapper: Bearer, X-CSRF-Token, refresh 1 lần khi TOKEN_EXPIRED
        │   │   ├── refresh.ts        # Web Locks + retry khi 409 (D-19)
        │   │   └── queryClient.ts
        │   ├── socket/
        │   │   ├── socket.ts         # io(VITE_SOCKET_URL, opts mục 6.4), auth {token, deviceId}
        │   │   ├── emit.ts           # emitWithAck(event, payload) → envelope {requestId, payload}, timeout SOCKET_ACK_TIMEOUT_MS
        │   │   ├── event-dedupe.ts   # LRU eventId (CLIENT_EVENT_DEDUPE_SIZE)
        │   │   └── sync.ts           # sau reconnect: invalidate queries, fetch after-cursor, xả outbox
        │   ├── outbox/
        │   │   ├── outbox.db.ts      # IndexedDB (idb) store "outbox" theo userId
        │   │   └── outbox.ts         # enqueue, flush, backoff, FAILED sau OUTBOX_MAX_AGE_MS
        │   ├── webrtc/
        │   │   ├── support.ts        # isSecureContext, RTCPeerConnection, mediaDevices
        │   │   ├── media.ts          # acquireMedia(callType) + fallback voice + map lỗi DOMException
        │   │   ├── ice-servers.ts    # GET /calls/ice-servers, cache tới expiresAt - TURN_REFRESH_BEFORE_S
        │   │   ├── candidate-queue.ts# hàng đợi ICE trước setRemoteDescription, dedupe, lọc theo revision
        │   │   └── peer-session.ts   # class PeerSession: tạo pc, offer/answer, ICE restart, stats
        │   ├── e2ee/
        │   │   ├── signal-adapter.ts # bọc thư viện Signal (D-12)
        │   │   ├── signal-store.ts   # IndexedDB: identity, prekeys, signed prekeys, sessions, known identities
        │   │   ├── device-keys.ts    # sinh & đăng ký khóa, bổ sung prekey khi e2ee:prekeys-low
        │   │   ├── envelope.ts       # encryptFanout / decryptForThisDevice
        │   │   └── safety-number.ts
        │   ├── device/
        │   │   └── device-id.ts      # getDeviceId() (localStorage hustalo.deviceId), getTabId() (sessionStorage hustalo.tabId)
        │   └── time/
        │       ├── server-clock.ts   # ước lượng lệch giờ từ occurredAt (median 5 mẫu gần nhất)
        │       └── format.ts         # định dạng giờ/ngày tiếng Việt
        ├── stores/
        │   ├── auth.store.ts         # accessToken (chỉ RAM), user, expiresAt
        │   ├── socket.store.ts       # connectionState: connecting|connected|reconnecting|offline|expired
        │   ├── presence.store.ts
        │   ├── typing.store.ts
        │   ├── call.store.ts         # CallStatus (mirror server) + localPhase + media flags
        │   ├── outbox.store.ts       # mirror trạng thái outbox để render bubble PENDING/FAILED
        │   └── ui.store.ts           # theme, toasts, banners
        ├── features/
        │   ├── auth/
        │   │   ├── LoginPage.tsx
        │   │   ├── RegisterPage.tsx
        │   │   ├── auth.api.ts
        │   │   └── useSessionLifecycle.ts   # refresh trước exp, xử lý session:expired/revoked
        │   ├── conversations/
        │   │   ├── ChatListPane.tsx
        │   │   ├── ConversationListItem.tsx
        │   │   ├── ConversationSearch.tsx
        │   │   ├── NewChatDialog.tsx
        │   │   ├── conversations.api.ts
        │   │   └── useConversationEvents.ts # message:new/status, conversation:* → setQueryData
        │   ├── chat/
        │   │   ├── ChatRoomPane.tsx
        │   │   ├── ChatHeader.tsx
        │   │   ├── MessageList.tsx
        │   │   ├── MessageBubble.tsx
        │   │   ├── MessageStatusIcon.tsx
        │   │   ├── DateDivider.tsx
        │   │   ├── TypingIndicator.tsx
        │   │   ├── NewMessagesButton.tsx
        │   │   ├── Composer.tsx
        │   │   ├── E2eeBadge.tsx
        │   │   ├── messages.api.ts
        │   │   ├── useMessages.ts           # infinite query before/after cursor
        │   │   ├── useSendMessage.ts        # outbox enqueue + emit
        │   │   └── useReadReceipts.ts       # visibilitychange + IntersectionObserver
        │   ├── groups/
        │   │   ├── CreateGroupDialog.tsx
        │   │   ├── MemberManagerDialog.tsx
        │   │   └── groups.api.ts
        │   ├── presence/
        │   │   ├── OnlineDot.tsx
        │   │   └── usePresence.ts
        │   ├── calls/
        │   │   ├── CallOverlay.tsx           # route /call/:callId dạng overlay
        │   │   ├── IncomingCallScreen.tsx
        │   │   ├── OutgoingCallScreen.tsx
        │   │   ├── InCallScreen.tsx
        │   │   ├── CallControls.tsx
        │   │   ├── CallEndedNotice.tsx
        │   │   ├── useCallController.ts      # điều phối PeerSession ↔ socket ↔ call.store
        │   │   ├── useRingtone.ts            # phát nhạc chuông, xử lý autoplay bị chặn
        │   │   ├── calls.api.ts
        │   │   └── CallHistoryList.tsx
        │   ├── settings/
        │   │   ├── SettingsPage.tsx
        │   │   ├── ProfileSection.tsx
        │   │   ├── PrivacySection.tsx
        │   │   ├── DevicesSection.tsx
        │   │   ├── ThemeSection.tsx
        │   │   └── SafetyNumberDialog.tsx
        │   └── e2ee/
        │       ├── useSecretSession.ts
        │       └── IdentityChangedBanner.tsx
        ├── components/
        │   ├── layout/
        │   │   ├── AppShell.tsx
        │   │   └── ConnectionBanner.tsx
        │   └── ui/
        │       ├── Button.tsx
        │       ├── IconButton.tsx
        │       ├── Avatar.tsx
        │       ├── Modal.tsx
        │       ├── Toast.tsx
        │       ├── Banner.tsx
        │       ├── Spinner.tsx
        │       └── TextField.tsx
        └── test/
            └── setup.ts               # vitest jsdom, fake-indexeddb
```

### 4.2 Quy ước file

| Loại file | Trách nhiệm | Được phép import |
|---|---|---|
| `*.routes.ts` | Khai báo route Express, gắn middleware (`authenticate`, `rateLimit`, `validate`, `csrf`) | controller, middleware, schema |
| `*.controller.ts` | Lấy `req.auth`, gọi service, chuyển DTO → response, đặt status code | service |
| `*.service.ts` | Quy tắc nghiệp vụ, phân quyền, transaction, phát event realtime qua `realtime/emitter.ts` | repository của chính module, service module khác theo bảng 5.2, infra |
| `*.repository.ts` | Truy vấn Mongoose/Redis, không có quy tắc nghiệp vụ | model, `infra/db`, `infra/redis` |
| `*.schema.ts` | Re-export/ghép Zod schema từ `@hustalo/shared` | `@hustalo/shared` |
| `*.model.ts` | Mongoose schema + model (chi tiết ở `database_schema.md`) | mongoose |
| `*.handler.ts` | Nhận event socket, bọc bằng `withAck`, gọi service | service, realtime helpers |
| `*.test.ts` | Unit test (Vitest), mock repository | mọi thứ |
| `*.int.test.ts` | Integration test (Supertest/socket thật, mongo-memory replset, Redis test) | mọi thứ |

### 4.3 Cấu hình workspace

- `packages/shared/package.json`: `"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }`. Server dev chạy bằng `tsx` (đọc TS trực tiếp), build bằng `tsup` với `noExternal: ['@hustalo/shared']`. Client dùng Vite (đọc TS trực tiếp).
- Không đặt logic I/O trong `packages/shared` (không import `mongoose`, `ioredis`, DOM API).

### 4.4 Nội dung chuẩn của `packages/shared`

#### 4.4.1 `packages/shared/src/constants.ts`

Đây là danh sách hằng số **duy nhất**. Hằng số của yêu cầu gốc giữ nguyên giá trị; hằng số đánh dấu `[NEW]` là bổ sung trong file này và các file sau phải dùng đúng tên, đúng giá trị.

```ts
// packages/shared/src/constants.ts
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---- Tin nhắn ----
export const MESSAGE_MAX_LENGTH = 4000;                // code point, sau NFC + trim (D-17)
export const MESSAGE_EDIT_WINDOW_MS = 15 * MINUTE;     // [NEW] sửa/thu hồi trong 15 phút kể từ createdAt server
export const HISTORY_PAGE_DEFAULT = 30;
export const HISTORY_PAGE_MAX = 100;
export const CONVERSATION_PAGE_DEFAULT = 20;           // [NEW] GET /conversations
export const CONVERSATION_PAGE_MAX = 50;               // [NEW]
export const UNREAD_COUNT_CAP = 99;                    // [NEW] server đếm tối đa 100, UI hiển thị "99+"

// ---- Người dùng / nhóm ----
export const GROUP_MAX_MEMBERS = 100;
export const GROUP_TITLE_MAX = 100;
export const DISPLAY_NAME_MAX = 80;
export const USERNAME_MIN = 3;                         // [NEW]
export const USERNAME_MAX = 30;                        // [NEW]
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;  // [NEW]
export const PASSWORD_MIN = 8;                         // [NEW]
export const PASSWORD_MAX = 128;                       // [NEW]
export const USER_SEARCH_MIN_QUERY = 2;                // [NEW]
export const USER_SEARCH_LIMIT = 20;                   // [NEW]
export const USER_SEARCH_MAX_QUERY = 100;              // [NEW] độ dài tối đa q sau trim
export const BLOCKED_LIST_MAX = 1000;                  // [NEW] số blockedUserIds tối đa trả trong GET /auth/me
export const GROUP_ADD_BATCH_MAX = 50;                 // [NEW] số userId tối đa mỗi lần POST members

// ---- Auth ----
export const ACCESS_TOKEN_TTL_S = 15 * 60;             // 15m
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;  // 30d
export const REFRESH_REUSE_GRACE_S = 10;               // [NEW] D-19
export const ACCESS_TOKEN_REFRESH_SKEW_S = 60;         // [NEW] client refresh trước exp 60s
export const SESSION_EXPIRED_DISCONNECT_DELAY_MS = 5 * SECOND; // [NEW] D-18

// ---- Presence / typing ----
export const PRESENCE_LEASE_TTL_MS = 60 * SECOND;
export const PRESENCE_HEARTBEAT_MS = 20 * SECOND;
export const PRESENCE_OFFLINE_GRACE_MS = 10 * SECOND;
export const PRESENCE_SUBSCRIBE_MAX = 200;             // [NEW] userId tối đa mỗi presence:subscribe
export const PRESENCE_SWEEP_INTERVAL_MS = 1 * SECOND;  // [NEW]
export const TYPING_TTL_MS = 5 * SECOND;
export const TYPING_CLIENT_THROTTLE_MS = 3 * SECOND;

// ---- Cuộc gọi ----
export const CALL_RING_TIMEOUT_MS = 45 * SECOND;
export const CALL_CONNECT_TIMEOUT_MS = 30 * SECOND;    // ACCEPTED → CONNECTED
export const CALL_RECONNECT_GRACE_MS = 20 * SECOND;
export const CALL_MAX_ICE_RESTARTS = 2;               // kiểm trong state machine (T30), KHÔNG ở Zod
export const CALL_INCOMING_ACK_TIMEOUT_MS = 5 * SECOND; // [NEW] chờ device ack call:incoming
export const ICE_DISCONNECTED_GRACE_MS = 3 * SECOND;   // [NEW] 'disconnected' kéo dài > 3s mới coi là mất
export const CALL_STATE_TTL_S = 6 * 60 * 60;           // [NEW] TTL tối đa call:active / user:incall
export const CALL_DEADLINE_SWEEP_INTERVAL_MS = 1 * SECOND; // [NEW] D-05
export const CALL_SDP_MAX_LENGTH = 20000;              // [NEW] ký tự
export const CALL_ICE_CANDIDATE_MAX_LENGTH = 1024;     // [NEW]
export const CALL_ICE_QUEUE_MAX = 200;                 // [NEW] candidate chờ remote description
export const TURN_CREDENTIAL_TTL_S = 60 * 60;          // 1h
export const TURN_REFRESH_BEFORE_S = 5 * 60;           // làm mới trước hết hạn 5 phút
export const ICE_SERVERS_CACHE_TTL_S = 5 * 60;         // [NEW] cache Xirsys trong Redis
export const XIRSYS_TIMEOUT_MS = 3 * SECOND;           // [NEW]
export const CALL_PAGE_DEFAULT = 20;                   // [NEW] GET /calls
export const CALL_PAGE_MAX = 50;                       // [NEW]

// ---- Client outbox / socket ----
export const CLIENT_OUTBOX_MAX = 200;
export const OUTBOX_RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000] as const; // sau đó nhân đôi, chặn trần
export const OUTBOX_RETRY_MAX_DELAY_MS = 30 * SECOND;
export const OUTBOX_MAX_AGE_MS = 24 * HOUR;
export const SOCKET_ACK_TIMEOUT_MS = 10 * SECOND;      // [NEW]
export const SOCKET_PING_INTERVAL_MS = 25 * SECOND;
export const SOCKET_PING_TIMEOUT_MS = 20 * SECOND;
export const SOCKET_RECOVERY_MAX_DISCONNECT_MS = 2 * MINUTE;
export const SOCKET_MAX_PAYLOAD_BYTES = 256 * 1024;    // [NEW] maxHttpBufferSize
export const REST_BODY_LIMIT_BYTES = 256 * 1024;       // [NEW] vượt → 413 VALIDATION_ERROR
export const CLIENT_EVENT_DEDUPE_SIZE = 1000;          // [NEW]
export const CLIENT_PENDING_RECEIPTS_MAX = 500;        // [NEW] receipt đến trước tin (EC-MSG-008)
export const CLIENT_PENDING_RECEIPT_TTL_MS = 60 * SECOND; // [NEW]

// ---- Mã hóa ----
export const DATA_ENCRYPTION_VERSION = 1;              // [NEW] contentEnc.v
export const E2EE_ENVELOPE_VERSION = 1;                // [NEW] envelope.v
export const E2EE_ONE_TIME_PREKEY_BATCH = 100;         // [NEW]
export const E2EE_PREKEY_LOW_THRESHOLD = 20;           // [NEW]
export const E2EE_MAX_DEVICES_PER_USER = 5;            // [NEW]
export const E2EE_SIGNED_PREKEY_ROTATION_MS = 7 * DAY; // [NEW]
export const E2EE_PREKEYS_LOW_NOTIFY_COOLDOWN_S = 60 * 60; // [NEW] chống spam e2ee:prekeys-low

// ---- DB ----
export const MONGO_TXN_MAX_RETRIES = 3;                // [NEW]

// ---- Rate limit (Redis atomic) ----
export const RATE_LIMITS = {
  login:             { points: 5,   windowSec: 60, key: 'ip+email' },
  register:          { points: 3,   windowSec: 60, key: 'ip' },
  refresh:           { points: 30,  windowSec: 60, key: 'ip' },          // [NEW]
  messageSend:       { points: 20,  windowSec: 10, key: 'user' },
  callInvite:        { points: 5,   windowSec: 60, key: 'user' },
  typing:            { points: 20,  windowSec: 10, key: 'user' },
  rest:              { points: 100, windowSec: 60, key: 'user' },
  callSignal:        { points: 100, windowSec: 10, key: 'socket' },      // [NEW] offer/answer/ice/ice-restart/state
  socketGeneric:     { points: 60,  windowSec: 10, key: 'socket' },      // [NEW] join/leave/delivered/read/edit/delete/accept/reject/cancel/end
  presenceSubscribe: { points: 10,  windowSec: 60, key: 'user' },        // [NEW]
  e2eeBundle:        { points: 10,  windowSec: 60, key: 'user+target' }, // [NEW] chống rút cạn one-time prekey
  changePassword:    { points: 5,   windowSec: 15 * 60, key: 'user' }, // [NEW] POST /auth/change-password, Redis down → fail-closed như auth
} as const;
```

#### 4.4.2 `packages/shared/src/enums.ts`

```ts
// packages/shared/src/enums.ts
export const ConversationType = { DIRECT: 'DIRECT', GROUP: 'GROUP', SECRET: 'SECRET' } as const;
export type ConversationType = (typeof ConversationType)[keyof typeof ConversationType];

export const MemberRole = { OWNER: 'OWNER', ADMIN: 'ADMIN', MEMBER: 'MEMBER' } as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export const MessageType = { TEXT: 'TEXT', SYSTEM: 'SYSTEM' } as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// Chỉ phía client
export const MessageClientStatus = {
  PENDING: 'PENDING', SENT: 'SENT', DELIVERED: 'DELIVERED', READ: 'READ', FAILED: 'FAILED',
} as const;
export type MessageClientStatus = (typeof MessageClientStatus)[keyof typeof MessageClientStatus];

export const CallType = { VOICE: 'VOICE', VIDEO: 'VIDEO' } as const;
export type CallType = (typeof CallType)[keyof typeof CallType];

export const CallStatus = {
  INITIATED: 'INITIATED', RINGING: 'RINGING', ACCEPTED: 'ACCEPTED', CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED', RECONNECTING: 'RECONNECTING', ENDED: 'ENDED', REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED', MISSED: 'MISSED', BUSY: 'BUSY', FAILED: 'FAILED',
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];
export const CALL_TERMINAL_STATUSES: readonly CallStatus[] =
  ['ENDED', 'REJECTED', 'CANCELLED', 'MISSED', 'BUSY', 'FAILED'];
export const CALL_ACTIVE_STATUSES: readonly CallStatus[] =
  ['INITIATED', 'RINGING', 'ACCEPTED', 'CONNECTING', 'CONNECTED', 'RECONNECTING'];

export const CallEndReason = {
  HANGUP: 'HANGUP', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', TIMEOUT: 'TIMEOUT', BUSY: 'BUSY',
  NETWORK_FAILURE: 'NETWORK_FAILURE', MEDIA_FAILURE: 'MEDIA_FAILURE',
  ANSWERED_ELSEWHERE: 'ANSWERED_ELSEWHERE', PEER_DISCONNECTED: 'PEER_DISCONNECTED',
  SERVER_RESTART: 'SERVER_RESTART', LOGOUT: 'LOGOUT',
} as const;
export type CallEndReason = (typeof CallEndReason)[keyof typeof CallEndReason];
// Lý do client được phép gửi trong call:end
export const CLIENT_CALL_END_REASONS = ['HANGUP', 'NETWORK_FAILURE', 'MEDIA_FAILURE'] as const;

export const PresenceStatus = { ONLINE: 'ONLINE', OFFLINE: 'OFFLINE' } as const;
export type PresenceStatus = (typeof PresenceStatus)[keyof typeof PresenceStatus];

// [NEW] báo cáo trạng thái kết nối media trong call:state (client → server)
export const MediaConnectionReport = { CONNECTED: 'connected', DISCONNECTED: 'disconnected', FAILED: 'failed' } as const;
export type MediaConnectionReport = (typeof MediaConnectionReport)[keyof typeof MediaConnectionReport];

// [NEW] client-only, KHÔNG phải CallStatus: pha cục bộ trước khi có callId / sau khi kết thúc
export const CallLocalPhase = { IDLE: 'IDLE', PREPARING_MEDIA: 'PREPARING_MEDIA', IN_CALL: 'IN_CALL' } as const;
export type CallLocalPhase = (typeof CallLocalPhase)[keyof typeof CallLocalPhase];

// [NEW] phạm vi cập nhật trong message:status
export const ReceiptScope = { MESSAGE: 'MESSAGE', GROUP_AGGREGATE: 'GROUP_AGGREGATE' } as const;
export type ReceiptScope = (typeof ReceiptScope)[keyof typeof ReceiptScope];

// [NEW] loại sự kiện của SYSTEM message
export const SystemEventKind = {
  GROUP_CREATED: 'GROUP_CREATED', MEMBER_ADDED: 'MEMBER_ADDED', MEMBER_REMOVED: 'MEMBER_REMOVED',
  MEMBER_LEFT: 'MEMBER_LEFT', ROLE_CHANGED: 'ROLE_CHANGED', OWNER_TRANSFERRED: 'OWNER_TRANSFERRED',
  TITLE_CHANGED: 'TITLE_CHANGED', CALL_MISSED: 'CALL_MISSED', CALL_ENDED: 'CALL_ENDED',
} as const;
export type SystemEventKind = (typeof SystemEventKind)[keyof typeof SystemEventKind];

// [NEW] trạng thái tài khoản và thiết bị E2EE
export const UserStatus = { ACTIVE: 'ACTIVE', LOCKED: 'LOCKED' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const DeviceStatus = { ACTIVE: 'ACTIVE', REVOKED: 'REVOKED' } as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

// [NEW] loại ciphertext Signal trong envelope.recipients[].type
export const SignalMessageType = { WHISPER: 1, PREKEY: 3 } as const;
export type SignalMessageType = (typeof SignalMessageType)[keyof typeof SignalMessageType];

// [NEW] lý do session:revoked
export const SessionRevokeReason = {
  LOGOUT: 'LOGOUT', PASSWORD_CHANGED: 'PASSWORD_CHANGED', REFRESH_REUSE: 'REFRESH_REUSE',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED', DEVICE_REVOKED: 'DEVICE_REVOKED',
} as const;
export type SessionRevokeReason = (typeof SessionRevokeReason)[keyof typeof SessionRevokeReason];
```

#### 4.4.3 `packages/shared/src/errors.ts`

```ts
// packages/shared/src/errors.ts
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR', UNAUTHENTICATED: 'UNAUTHENTICATED', TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', CONFLICT: 'CONFLICT', RATE_LIMITED: 'RATE_LIMITED',
  NOT_A_MEMBER: 'NOT_A_MEMBER', CONVERSATION_FULL: 'CONVERSATION_FULL', USER_BLOCKED: 'USER_BLOCKED',
  DUPLICATE_MESSAGE: 'DUPLICATE_MESSAGE', CALL_NOT_FOUND: 'CALL_NOT_FOUND',
  CALL_INVALID_STATE: 'CALL_INVALID_STATE', CALL_BUSY: 'CALL_BUSY', CALL_TIMEOUT: 'CALL_TIMEOUT',
  CALL_ALREADY_ANSWERED: 'CALL_ALREADY_ANSWERED', E2EE_KEYS_UNAVAILABLE: 'E2EE_KEYS_UNAVAILABLE',
  E2EE_DECRYPT_FAILED: 'E2EE_DECRYPT_FAILED', SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,        // ngoại lệ cùng code: 413 khi body > REST_BODY_LIMIT_BYTES; 422 khi currentPassword sai (POST /auth/change-password)
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_A_MEMBER: 403,
  USER_BLOCKED: 403,
  NOT_FOUND: 404,
  CALL_NOT_FOUND: 404,
  CONFLICT: 409,
  CALL_INVALID_STATE: 409,
  CALL_BUSY: 409,
  CALL_TIMEOUT: 409,
  CALL_ALREADY_ANSWERED: 409,
  CONVERSATION_FULL: 422,
  E2EE_KEYS_UNAVAILABLE: 422,
  E2EE_DECRYPT_FAILED: 422,     // chỉ phát sinh phía client; giữ ánh xạ để thống nhất
  DUPLICATE_MESSAGE: 200,       // KHÔNG phải lỗi: trả kết quả cũ
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export interface ErrorBody { code: ErrorCode; message: string; details?: unknown; requestId: string }
export interface ErrorResponse { error: ErrorBody }            // REST
export interface AckError { code: ErrorCode; message: string } // Socket ACK
```

Quy tắc ánh xạ lỗi hệ thống:

| Nguồn lỗi | Mã |
|---|---|
| `ZodError` | `VALIDATION_ERROR` (REST: `details` = mảng `{ path, message }`) |
| Body vượt `REST_BODY_LIMIT_BYTES` | `VALIDATION_ERROR`, HTTP 413 |
| `currentPassword` sai ở `POST /auth/change-password` | `VALIDATION_ERROR`, HTTP 422, `details: [{ field: 'currentPassword', reason: 'INVALID' }]` (không dùng 401 để client không nhầm với lỗi phiên) |
| JWT hết hạn (`exp`) | `TOKEN_EXPIRED` |
| JWT sai chữ ký / thiếu / `iss`,`aud` sai / `sid` bị thu hồi / user `LOCKED` | `UNAUTHENTICATED` |
| Mongo `E11000` ngoài các luồng idempotent | `CONFLICT` |
| Mongo mất kết nối / `MongoServerSelectionError` / transaction hết `MONGO_TXN_MAX_RETRIES` | `SERVICE_UNAVAILABLE` |
| Redis lỗi trên luồng bắt buộc Redis (call, auth rate limit) | `SERVICE_UNAVAILABLE` |
| Không xác định | `INTERNAL_ERROR` (message chung `"Đã có lỗi xảy ra"`, không lộ stack) |
| Rate limit | `RATE_LIMITED`; REST thêm header `Retry-After` (giây) |

`message` của lỗi là tiếng Việt, ngắn; client **phải** quyết định hiển thị dựa trên `code`, không parse `message`. Văn bản UI chính xác nằm ở `ui_ux_spec.md`.

### 4.5 Danh mục Socket.IO event (hợp đồng chuẩn)

**Envelope và ACK** (`packages/shared/src/schemas/socket.schema.ts`):

```ts
import { z } from 'zod';
import { ErrorCode } from '../errors';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const clientEnvelope = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({ requestId: z.string().uuid(), payload }).strict();

export const ackOk = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ ok: z.literal(true), requestId: z.string().uuid(), data });

export const ackErr = z.object({
  ok: z.literal(false),
  requestId: z.string().uuid(), // = requestId của envelope; envelope hỏng không đọc được requestId → NIL_UUID
  error: z.object({
    code: z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
  }),
});

// Mọi event server → client có thêm 2 trường
export const serverEventMeta = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(), // ISO-8601 UTC, đồng hồ server
});
```

Quy tắc:
- Client→server luôn gửi `{ requestId, payload }` kèm callback ACK; client dùng `socket.timeout(SOCKET_ACK_TIMEOUT_MS).emitWithAck(event, envelope)`.
- Server→client: payload là object phẳng gồm `eventId`, `occurredAt` và các trường liệt kê bên dưới. Không có ACK, trừ `call:incoming` (mục 7(e)).
- Envelope sai schema → ACK `VALIDATION_ERROR`. Event C→S không kèm callback → server bỏ qua, log `warn` `{ event, reason: 'NO_ACK_CALLBACK' }`, không xử lý ghi.
- Mọi event C→S yêu cầu socket đã xác thực (middleware `socket-auth`); `userId`, `deviceId`, `senderId` luôn lấy từ `socket.data.auth`, mọi giá trị client gửi cho các trường này bị bỏ qua (schema `.strict()` làm chúng thành `VALIDATION_ERROR` nếu đặt trong payload).
- Cùng `requestId` gửi lại trong 2 phút: với `message:send` idempotency dựa trên `clientMessageId` (không phải `requestId`); các event khác tự idempotent theo ngữ nghĩa (cursor một chiều, state machine).

**Payload Zod** (định nghĩa trong `socket.schema.ts`; `normalizedText` ở `common.schema.ts` áp D-17):

```ts
import { z } from 'zod';
import {
  CALL_ICE_CANDIDATE_MAX_LENGTH, CALL_SDP_MAX_LENGTH,
  E2EE_MAX_DEVICES_PER_USER, PRESENCE_SUBSCRIBE_MAX,
} from '../constants';
import { CLIENT_CALL_END_REASONS } from '../enums';
import { normalizedText, objectId } from './common.schema';

const uuid = z.string().uuid();

// ---- Conversation ----
export const ConversationJoinPayload = z.object({ conversationId: objectId }).strict();
export const ConversationLeavePayload = ConversationJoinPayload;

// ---- E2EE envelope ----
export const E2eeEnvelope = z.object({
  v: z.literal(1),
  senderDeviceId: uuid,
  recipients: z.array(z.object({
    deviceId: uuid,
    type: z.union([z.literal(1), z.literal(3)]),          // SignalMessageType
    body: z.string().min(1).max(16384).regex(/^[A-Za-z0-9+/]+={0,2}$/), // base64
  }).strict()).min(1).max(2 * E2EE_MAX_DEVICES_PER_USER),
}).strict();

// ---- Message ----
export const MessageSendPayload = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('PLAINTEXT'),               // DIRECT, GROUP
    conversationId: objectId,
    clientMessageId: uuid,
    content: normalizedText,                    // 1..MESSAGE_MAX_LENGTH code point
  }).strict(),
  z.object({
    kind: z.literal('E2EE'),                    // SECRET
    conversationId: objectId,
    clientMessageId: uuid,
    ciphertext: E2eeEnvelope,                   // .strict(): có trường content → VALIDATION_ERROR
  }).strict(),
]);
export const ReceiptCursorPayload = z.object({ conversationId: objectId, upToMessageId: objectId }).strict();
export const MessageEditPayload = z.object({ messageId: objectId, content: normalizedText }).strict();
export const MessageDeletePayload = z.object({ messageId: objectId }).strict();

// ---- Typing / presence ----
export const TypingPayload = z.object({ conversationId: objectId }).strict();
export const PresenceSubscribePayload = z.object({
  userIds: z.array(objectId).min(1).max(PRESENCE_SUBSCRIBE_MAX),
}).strict();

// ---- Call ----
export const CallInvitePayload = z.object({ conversationId: objectId, callType: z.enum(['VOICE', 'VIDEO']) }).strict();
export const CallIdPayload = z.object({ callId: objectId }).strict();      // accept, reject, cancel
export const CallSdpPayload = z.object({                                     // offer, answer
  callId: objectId,
  revision: z.number().int().min(1),
  sdp: z.string().min(1).max(CALL_SDP_MAX_LENGTH),
}).strict();
export const CallIcePayload = z.object({
  callId: objectId,
  revision: z.number().int().min(1),
  candidate: z.object({
    candidate: z.string().max(CALL_ICE_CANDIDATE_MAX_LENGTH),  // "" = end-of-candidates
    sdpMid: z.string().max(64).nullable(),
    sdpMLineIndex: z.number().int().min(0).max(16).nullable(),
    usernameFragment: z.string().max(256).nullable(),
  }).strict(),
}).strict();
export const CallIceRestartPayload = z.object({
  callId: objectId,
  attempt: z.number().int().min(1), // giới hạn CALL_MAX_ICE_RESTARTS kiểm ở state machine (T30) → CALL_INVALID_STATE
}).strict();
export const CallEndPayload = z.object({ callId: objectId, reason: z.enum(CLIENT_CALL_END_REASONS) }).strict();
export const CallStateReportPayload = z.object({
  callId: objectId,
  connectionState: z.enum(['connected', 'disconnected', 'failed']), // MediaConnectionReport
}).strict();
```

**Bảng event** (C→S = client gửi server; S→C = server gửi client):

| Event | Hướng | Payload | Phân quyền | Rate limit | ACK `data` | Mã lỗi có thể trả |
|---|---|---|---|---|---|---|
| `session:expired` | S→C (room `session:{sid}`) | `{ reason: 'TOKEN_EXPIRED', expiredAt }` | — | — | — | — |
| `session:revoked` | S→C (room `session:{sid}`) | `{ reason: SessionRevokeReason }` | — | — | — | — |
| `conversation:join` | C→S | `ConversationJoinPayload` | Là thành viên hiện tại | socketGeneric | `{ conversation: Conversation, unreadCount: number, typingUserIds: string[] }` | VALIDATION_ERROR, NOT_FOUND, NOT_A_MEMBER, RATE_LIMITED, SERVICE_UNAVAILABLE |
| `conversation:leave` | C→S | `ConversationLeavePayload` | Bất kỳ (chỉ rời room `conv:{id}`, không đổi membership) | socketGeneric | `{}` | VALIDATION_ERROR, RATE_LIMITED |
| `conversation:updated` | S→C (user rooms của mọi thành viên) | `{ conversation: Conversation, change: 'CREATED' \| 'TITLE' \| 'MEMBERS' \| 'ROLE' \| 'OWNER' }` | — | — | — | — |
| `conversation:member-removed` | S→C (user rooms của thành viên còn lại + người bị xóa) | `{ conversationId, userId, removedBy, reason: 'REMOVED' \| 'LEFT' }` | — | — | — | — |
| `message:send` | C→S | `MessageSendPayload` | Thành viên; DIRECT/SECRET không bị chặn hai chiều; `kind` khớp loại hội thoại (PLAINTEXT↔DIRECT/GROUP, E2EE↔SECRET, sai → VALIDATION_ERROR); SECRET: device gửi ACTIVE và `recipients` khớp đúng tập device ACTIVE | messageSend | `{ message: Message, duplicate: boolean }` — `duplicate=true` tương ứng `DUPLICATE_MESSAGE`, trả bản đã lưu | VALIDATION_ERROR, NOT_FOUND, NOT_A_MEMBER, USER_BLOCKED, FORBIDDEN, CONFLICT, E2EE_KEYS_UNAVAILABLE, RATE_LIMITED, SERVICE_UNAVAILABLE |
| `message:new` | S→C (user rooms; SECRET: device rooms) | `{ message: Message }` (SECRET: `message.ciphertext.recipients` chỉ còn phần tử của device nhận) | — | — | — | — |
| `message:delivered` | C→S | `ReceiptCursorPayload` | Thành viên; message thuộc hội thoại | socketGeneric | `{ advanced: boolean }` | VALIDATION_ERROR, NOT_FOUND, NOT_A_MEMBER, RATE_LIMITED, SERVICE_UNAVAILABLE |
| `message:read` | C→S | `ReceiptCursorPayload` | Như trên | socketGeneric | `{ advanced: boolean, unreadCount: number }` | VALIDATION_ERROR, NOT_FOUND, NOT_A_MEMBER, RATE_LIMITED, SERVICE_UNAVAILABLE |
| `message:status` | S→C | Scope `MESSAGE` (DIRECT/SECRET): `{ conversationId, scope: 'MESSAGE', messageIds: string[], status: 'DELIVERED' \| 'READ', byUserId, at }` tới user room người gửi và user room `byUserId`. Scope `GROUP_AGGREGATE` (GROUP): `{ conversationId, scope: 'GROUP_AGGREGATE', userId, lastDeliveredMessageId: string \| null, lastReadMessageId: string \| null }` tới room `conv:{id}` và user room `userId` | — | — | — | — |
| `message:edit` | C→S và S→C | C→S `MessageEditPayload`; S→C `{ message: Message }` tới user rooms thành viên | Người gửi; trong `MESSAGE_EDIT_WINDOW_MS`; không phải SECRET (D-16); không phải SYSTEM; chưa thu hồi | socketGeneric | `{ message: Message }` | VALIDATION_ERROR, NOT_FOUND, NOT_A_MEMBER, FORBIDDEN, RATE_LIMITED, SERVICE_UNAVAILABLE |
| `message:delete` | C→S và S→C | C→S `MessageDeletePayload`; S→C `{ message: Message }` (có `deletedAt`, không nội dung) | Người gửi; trong `MESSAGE_EDIT_WINDOW_MS`; đã thu hồi → ACK ok trả bản hiện tại (idempotent) | socketGeneric | `{ message: Message }` | VALIDATION_ERROR, NOT_FOUND, NOT_A_MEMBER, FORBIDDEN, RATE_LIMITED, SERVICE_UNAVAILABLE |
| `typing:start` | C→S | `TypingPayload` | Thành viên; DIRECT/SECRET không bị chặn | typing | `{}` | VALIDATION_ERROR, NOT_FOUND, NOT_A_MEMBER, USER_BLOCKED, RATE_LIMITED |
| `typing:stop` | C→S | `TypingPayload` | Thành viên | typing | `{}` | VALIDATION_ERROR, NOT_FOUND, NOT_A_MEMBER, RATE_LIMITED |
| `typing:update` | S→C (user rooms thành viên trừ người gõ) | `{ conversationId, userId, isTyping: boolean }` | — | — | — | — |
| `presence:subscribe` | C→S | `PresenceSubscribePayload` | Chỉ userId có chung ≥ 1 hội thoại và không bị chặn hai chiều; userId khác bị lọc im lặng (không lộ tồn tại) | presenceSubscribe | `{ accepted: string[] }` | VALIDATION_ERROR, RATE_LIMITED |
| `presence:snapshot` | S→C (socket vừa subscribe) | `{ users: [{ userId, status: PresenceStatus, lastSeenAt: string \| null }], degraded: boolean }` | — | — | — | — |
| `presence:update` | S→C (room `presence:{userId}`) | `{ userId, status: PresenceStatus, lastSeenAt: string \| null }` | — | — | — | — |
| `call:invite` | C→S | `CallInvitePayload` | Thành viên DIRECT/SECRET; không bị chặn hai chiều; caller không trong cuộc gọi khác; GROUP → VALIDATION_ERROR (D-22) | callInvite | `{ callId, status: CallStatus, merged: boolean, callType: CallType }` | VALIDATION_ERROR, NOT_FOUND, NOT_A_MEMBER, USER_BLOCKED, CALL_BUSY, CALL_INVALID_STATE, RATE_LIMITED, SERVICE_UNAVAILABLE |
| `call:incoming` | S→C (mọi tab online của callee, room `user:{calleeId}`) **có ACK** | `{ callId, conversationId, callType, caller: UserPublic, ringExpiresAt }` (`ringExpiresAt` = thời điểm hết đổ chuông theo deadline `RING` của server; client đếm ngược theo trường này, không đọc hằng số); device trả ACK `{ ok: true }` | — | — | — | — |
| `call:ringing` | S→C (room `tab:{callerTabId}`) | `{ callId, ringExpiresAt }` | — | — | — | — |
| `call:accept` | C→S | `CallIdPayload` | Là callee; status ∈ {INITIATED, RINGING} | socketGeneric | `{ callId, status: 'ACCEPTED' }` | VALIDATION_ERROR, CALL_NOT_FOUND, FORBIDDEN, CALL_ALREADY_ANSWERED, CALL_TIMEOUT, CALL_INVALID_STATE, RATE_LIMITED, SERVICE_UNAVAILABLE |
| `call:accepted` | S→C (room `tab:{callerTabId}` + `tab:{acceptedTabId}`) | `{ callId, acceptedDeviceId, acceptedTabId }` | — | — | — | — |
| `call:answered-elsewhere` | S→C (mọi tab khác của callee) | `{ callId, reason: 'ANSWERED_ELSEWHERE' }` | — | — | — | — |
| `call:reject` | C→S | `CallIdPayload` | Là callee; status ∈ {INITIATED, RINGING} | socketGeneric | `{ callId, status: 'REJECTED' }` | VALIDATION_ERROR, CALL_NOT_FOUND, FORBIDDEN, CALL_INVALID_STATE, RATE_LIMITED |
| `call:cancel` | C→S | `CallIdPayload` | Là tab caller (`callerTabId`). Status ∈ {INITIATED, RINGING} → CANCELLED; status ∈ {ACCEPTED, CONNECTING, CONNECTED, RECONNECTING} → xử lý như `call:end` HANGUP; terminal → ACK ok trạng thái hiện tại | socketGeneric | `{ callId, status: CallStatus }` | VALIDATION_ERROR, CALL_NOT_FOUND, FORBIDDEN, RATE_LIMITED |
| `call:busy` | S→C (room `user:{calleeId}`) | `{ callId, caller: UserPublic, callType }` — thông báo "có người vừa gọi khi bạn đang bận" | — | — | — | — |
| `call:offer` | C→S và S→C | `CallSdpPayload` | Chỉ tab caller (`callerTabId`); status ∈ {ACCEPTED, CONNECTING, CONNECTED, RECONNECTING}; `revision` = `offerRevision` hiện tại + 1 | callSignal | `{ revision }` | VALIDATION_ERROR, CALL_NOT_FOUND, FORBIDDEN, CALL_INVALID_STATE, RATE_LIMITED |
| `call:answer` | C→S và S→C | `CallSdpPayload` | Chỉ tab đã accept (`acceptedTabId`); `revision` == `offerRevision`; chưa có answer cho revision đó | callSignal | `{ revision }` | VALIDATION_ERROR, CALL_NOT_FOUND, FORBIDDEN, CALL_INVALID_STATE, RATE_LIMITED |
| `call:ice-candidate` | C→S và S→C | `CallIcePayload` | Chỉ 2 tab tham gia; status không terminal; `revision` == `offerRevision` | callSignal | `{}` | VALIDATION_ERROR, CALL_NOT_FOUND, FORBIDDEN, CALL_INVALID_STATE, RATE_LIMITED |
| `call:ice-restart` | C→S và S→C | `CallIceRestartPayload` | 2 tab tham gia; status ∈ {CONNECTING, CONNECTED, RECONNECTING}; `attempt` = `iceRestarts` + 1 ≤ `CALL_MAX_ICE_RESTARTS` | callSignal | `{ attempt }` | VALIDATION_ERROR, CALL_NOT_FOUND, FORBIDDEN, CALL_INVALID_STATE, RATE_LIMITED |
| `call:end` | C→S | `CallEndPayload` | 2 tab tham gia sau ACCEPTED; tab caller trước ACCEPTED (như cancel); tab bất kỳ của callee ở INITIATED/RINGING chỉ với `MEDIA_FAILURE`; terminal → ACK ok trạng thái hiện tại (idempotent, không phát lại) | socketGeneric | `{ callId, status: CallStatus, endReason: CallEndReason }` | VALIDATION_ERROR, CALL_NOT_FOUND, FORBIDDEN, RATE_LIMITED |
| `call:state` | C→S (báo cáo media) và S→C (trạng thái chính thức) | C→S `CallStateReportPayload` (chỉ 2 tab tham gia). S→C `CallStateEvent` = `{ callId, conversationId, status, endReason: CallEndReason \| null, callType, callerId, calleeId, acceptedDeviceId: string \| null, acceptedTabId: string \| null, connectedAt: string \| null, endedAt: string \| null, version: number }` tới user rooms của caller và callee | callSignal | `{ status, version }`. callId không còn trạng thái live trong Redis → ACK trả trạng thái cuối trong `callHistory` (nếu record chưa terminal thì server chốt theo T29 trước: ENDED nếu có `connectedAt`, ngược lại FAILED, `endReason = SERVER_RESTART`) và phát `call:state` kết thúc tới socket đó | VALIDATION_ERROR, CALL_NOT_FOUND, FORBIDDEN, RATE_LIMITED |
| `e2ee:prekeys-low` | S→C (device room) | `{ deviceId, remaining: number }` | — | — | — | — |

Ghi chú:
- Server không bao giờ log `sdp`, `candidate`, `content`, `ciphertext`.
- `call:offer/answer/ice-candidate/ice-restart` S→C chỉ gửi tới **tab room** của bên kia (`tab:{tabId}`), không gửi user room, payload giữ nguyên trừ thêm `eventId/occurredAt`.
- Sau mỗi chuyển trạng thái, server phát `call:state` cho user room của **cả hai** user (mọi tab biết user đang trong cuộc gọi), cộng event chuyên biệt (`call:ringing`, `call:accepted`, `call:answered-elsewhere`, `call:busy`).
- `call:ringing` chỉ phát **một lần** cho mỗi cuộc gọi (khi INITIATED → RINGING).

### 4.6 Danh mục REST endpoint (base `/api/v1`)

Chi tiết schema ở `api_spec.yaml`. Endpoint đánh dấu `[NEW]` là bổ sung so với danh sách tối thiểu và bắt buộc có trong `api_spec.yaml`.

| Method | Path | Auth | Rate limit | Mô tả |
|---|---|---|---|---|
| POST | `/auth/register` | — | register | Body `{ email, username, password, displayName, deviceId }`; trả `AuthResponse` + set cookie |
| POST | `/auth/login` | — | login | Body `{ email, password, deviceId }` |
| POST | `/auth/refresh` | refreshCookie + CSRF | refresh | Xoay refresh token (D-19) |
| POST | `/auth/logout` | refreshCookie + CSRF | refresh | Thu hồi family hiện tại, kết thúc cuộc gọi của device (`LOGOUT`) |
| GET | `/auth/me` | bearer | rest | `UserPublic` + privacy |
| POST | `/auth/change-password` `[NEW]` | bearer | changePassword | Đổi mật khẩu; thu hồi mọi family khác (EC-AUTH-006); `currentPassword` sai → 422 `VALIDATION_ERROR` (EC-AUTH-008) |
| GET | `/users/search?q=` | bearer | rest | Theo tiền tố username/displayName hoặc email chính xác; tối đa `USER_SEARCH_LIMIT` |
| PATCH | `/users/me` | bearer | rest | `displayName`, `avatarUrl`, `privacy.showLastSeen` |
| POST | `/users/{userId}/block` | bearer | rest | Idempotent; 204 |
| DELETE | `/users/{userId}/block` | bearer | rest | Idempotent; 204 |
| GET | `/conversations?cursor=&limit=` | bearer | rest | `ConversationSummary[]` theo `lastMessageAt` giảm dần |
| POST | `/conversations` | bearer + `Idempotency-Key` | rest | DIRECT/SECRET idempotent theo cặp user; GROUP idempotent theo `Idempotency-Key` |
| GET | `/conversations/{id}` | bearer | rest | Chi tiết + members |
| PATCH | `/conversations/{id}` | bearer | rest | Đổi `title` (GROUP, OWNER/ADMIN) |
| POST | `/conversations/{id}/members` | bearer | rest | Thêm tối đa `GROUP_ADD_BATCH_MAX` user; trả `{ added, skipped }` |
| PATCH | `/conversations/{id}/members/{userId}` `[NEW]` | bearer | rest | Đổi role: OWNER đặt ADMIN/MEMBER; OWNER chuyển OWNER |
| DELETE | `/conversations/{id}/members/{userId}` | bearer | rest | Xóa thành viên hoặc tự rời (`userId` = mình) |
| GET | `/conversations/{id}/messages?before=&after=&limit=` | bearer | rest | Phân trang cursor; `before` và `after` loại trừ nhau |
| POST | `/conversations/{id}/read` | bearer | rest | Body `{ upToMessageId }` — tương đương `message:read` |
| GET | `/calls?cursor=&limit=` | bearer | rest | Lịch sử cuộc gọi của mình |
| GET | `/calls/ice-servers` | bearer | rest | `IceServersResponse` |
| GET | `/e2ee/devices` `[NEW]` | bearer | rest | Danh sách device E2EE của mình |
| PUT | `/e2ee/devices/{deviceId}/keys` | bearer (`did` = deviceId) | rest | Đăng ký/cập nhật identity key, signed prekey, one-time prekeys |
| POST | `/e2ee/devices/{deviceId}/prekeys` | bearer (`did` = deviceId) | rest | Bổ sung one-time prekeys |
| DELETE | `/e2ee/devices/{deviceId}` `[NEW]` | bearer (device thuộc mình) | rest | Thu hồi device |
| GET | `/e2ee/users/{userId}/bundles` | bearer | e2eeBundle | Bundle cho mọi device ACTIVE của user (tiêu thụ one-time prekey nguyên tử) |
| GET | `/health` | — | — | `{ status: 'ok' \| 'degraded' \| 'draining', mongo: 'up' \| 'down', redis: 'up' \| 'down' }`; 503 khi mongo down hoặc đang draining (§10.3) |

---

## 5. Ranh giới module

### 5.1 Trách nhiệm

| Module | Sở hữu dữ liệu | Trách nhiệm chính | Event/REST |
|---|---|---|---|
| `auth` | `refreshSessions`, Redis `session:revoked:*` | Đăng ký, đăng nhập, xoay refresh, logout, đổi mật khẩu, khóa tài khoản, thu hồi family | `/auth/*`, `session:*` |
| `users` | `users`, `userBlocks` | Hồ sơ, tìm kiếm, chặn, quyền riêng tư; `isBlockedEitherWay(a,b)` | `/users/*` |
| `conversations` | `conversations`, `conversationMembers` (trừ trường cursor receipt) | Tạo/sửa hội thoại, thành viên, role; `assertMember`, `listMemberIds` | `/conversations` (trừ messages/read), `conversation:*` |
| `messages` | `messages`, `messageReceipts`, trường `lastDelivered*/lastRead*` trên `conversationMembers` | Gửi (transaction), lịch sử, sửa/thu hồi, receipts, unread, SYSTEM message | `/conversations/{id}/messages`, `/conversations/{id}/read`, `message:*` |
| `presence` | Redis `presence:*`, `typing:*`; ghi `users.lastSeenAt` qua `users.service` | Online/offline đa thiết bị, typing | `presence:*`, `typing:*` |
| `calls` | `callHistory`, Redis `call:*`, `user:incall:*`, `ice:*` | State machine cuộc gọi, relay signaling, ICE servers, lịch sử | `/calls/*`, `call:*` |
| `e2ee` | `userDevices`, `oneTimePreKeys`, Redis `e2ee:lowsent:*` | Đăng ký khóa, bundle, prekey, thu hồi device, kiểm tra envelope | `/e2ee/*`, `e2ee:prekeys-low` |
| `health` | — | Kiểm tra phụ thuộc | `/health` |

### 5.2 Ma trận phụ thuộc (hàng được phép gọi cột)

Chỉ gọi qua **service** của module khác, không bao giờ gọi repository/model của module khác.

| Gọi → | auth | users | conversations | messages | presence | calls | e2ee |
|---|---|---|---|---|---|---|---|
| **auth** | — | ✔ (findByEmail, create, setPassword, lock) | ✘ | ✘ | ✘ | ✔ (endCallsForDevice/User LOGOUT) | ✘ |
| **users** | ✘ | — | ✔ (shareConversation để lọc search/presence) | ✘ | ✘ | ✘ | ✘ |
| **conversations** | ✘ | ✔ (isBlockedEitherWay, getPublic) | — | ✔ (createSystemMessage) | ✘ | ✘ | ✔ (hasActiveDevice khi tạo SECRET) |
| **messages** | ✘ | ✔ (isBlockedEitherWay) | ✔ (assertMember, listMemberIds, getType) | — | ✘ | ✘ | ✔ (assertEnvelopeRecipients, isDeviceActive) |
| **presence** | ✘ | ✔ (getPrivacy, setLastSeen) | ✔ (shareConversation, listMemberIds) | ✘ | — | ✘ | ✘ |
| **calls** | ✘ | ✔ (isBlockedEitherWay, getPublic) | ✔ (assertMember, getType, getOtherMember) | ✔ (createSystemMessage CALL_MISSED/CALL_ENDED) | ✔ (listOnlineDevices) | — | ✘ |
| **e2ee** | ✔ (revokeFamilyByDevice khi thu hồi device) | ✘ | ✘ | ✘ | ✘ | ✘ | — |

Quy tắc chống vòng lặp: `messages` không gọi `calls`; `calls` gọi `messages` chỉ qua `createSystemMessage` (không gọi ngược lại). `auth → calls` và `e2ee → auth` là phụ thuộc một chiều. Import vòng được ESLint `import/no-cycle` chặn.

Các lớp khác:
- `realtime/handlers/*` chỉ gọi service; không truy cập model.
- `realtime/emitter.ts` được mọi service dùng để phát event (inject qua `deps` khi khởi tạo, để unit test mock).
- `infra/*` không import `modules/*`.
- `packages/shared` không import gì từ `server`/`client`.

---

## 6. Trust boundaries

### 6.1 Ranh giới tin cậy

| ID | Ranh giới | Bên ngoài (không tin) | Bên trong | Kiểm soát |
|---|---|---|---|---|
| TB-1 | Trình duyệt ↔ Reverse proxy | Mọi request/frame từ Internet | Proxy | TLS 1.2+, HSTS, chỉ cổng 443; WSS bắt buộc; CSP do proxy phát cho SPA |
| TB-2 | Proxy ↔ Server process | Header `X-Forwarded-*` chỉ tin khi từ proxy | Express/Socket.IO | `app.set('trust proxy', 1)` (một hop); IP lấy từ `req.ip` cho rate limit |
| TB-3 | Dữ liệu client ↔ Business logic | Mọi payload REST/socket | Service | Zod `.strict()` ở mọi điểm vào; `userId/senderId/deviceId` lấy từ token; kiểm quyền trong service (không tin room membership) |
| TB-4 | Server ↔ MongoDB/Redis | — | Mạng nội bộ | Mongo có user/password, Redis `requirepass`; không mở cổng ra Internet ở production; TLS nội bộ khuyến nghị ở production |
| TB-5 | Server ↔ Xirsys API | Response Xirsys (validate bằng Zod) | Server giữ `XIRSYS_SECRET` | HTTPS, timeout `XIRSYS_TIMEOUT_MS`, secret chỉ ở env server |
| TB-6 | Peer ↔ Peer (media) | Peer kia (có thể độc hại) | Trình duyệt | DTLS-SRTP bắt buộc (WebRTC mặc định); SDP từ peer chỉ đi tới `setRemoteDescription`, không render; giới hạn độ dài SDP/candidate |
| TB-7 | TURN relay | Xirsys/coturn thấy metadata IP + gói SRTP đã mã hóa | — | Credential ngắn hạn; không gửi dữ liệu ứng dụng qua TURN ngoài media/DataChannel (MVP không dùng DataChannel) |
| TB-8 | Client storage ↔ Server | Server không bao giờ thấy private key | IndexedDB trên device | Khóa riêng Signal chỉ ở IndexedDB; access token chỉ ở RAM; refresh token chỉ ở cookie HttpOnly |
| TB-9 | Nội dung người dùng ↔ DOM | Mọi chuỗi từ người dùng khác | React render | Chỉ render text node (React escape); cấm `dangerouslySetInnerHTML` (ESLint `react/no-danger` = error); `dir="auto"` cho bubble |

### 6.2 Điểm kiểm tra quyền chuẩn

Mọi luồng ở mục 7 đánh dấu điểm kiểm tra bằng `[AUTHZ-n]`:

| Mã | Kiểm tra | Nơi thực hiện | Lỗi |
|---|---|---|---|
| AUTHZ-1 | Token hợp lệ, chưa hết hạn, `sid` chưa bị thu hồi, user `ACTIVE` | `authenticate.ts`, `socket-auth.ts` | UNAUTHENTICATED / TOKEN_EXPIRED |
| AUTHZ-2 | Là thành viên hiện tại của conversation (`conversationMembers` tồn tại, `leftAt = null`) | `conversations.service.assertMember` | Conversation không tồn tại hoặc user **chưa từng** là thành viên → **NOT_FOUND** cho mọi thao tác đọc/ghi, REST và socket (chống dò ID); user **đã từng** là thành viên (đã rời/bị xóa) → NOT_A_MEMBER |
| AUTHZ-3 | Không bị chặn hai chiều (DIRECT/SECRET, call) | `users.service.isBlockedEitherWay` | USER_BLOCKED |
| AUTHZ-4 | Role đủ quyền (OWNER/ADMIN) cho thao tác nhóm | `conversations.service` | FORBIDDEN |
| AUTHZ-5 | Là người gửi tin + trong cửa sổ 15 phút | `messages.service.edit/delete` | FORBIDDEN |
| AUTHZ-6 | Là tab tham gia cuộc gọi đúng vai trò cho event (`socket.data.tabId` = `callerTabId`/`acceptedTabId`) | `calls.service` | FORBIDDEN (callId không tồn tại hoặc user không phải caller/callee → CALL_NOT_FOUND) |
| AUTHZ-7 | `deviceId` trong path = `did` trong token; device thuộc user và ACTIVE | `e2ee.service` | FORBIDDEN (`PUT keys`/`POST prekeys` với `deviceId ≠ did`: ràng buộc token, không phải dò ID); `DELETE /e2ee/devices/{deviceId}` với device không thuộc mình → **NOT_FOUND** |
| AUTHZ-8 | CSRF double-submit khớp | `csrf.ts` | FORBIDDEN |

Quy tắc chống liệt kê (EC-SEC-001, FR-SEC-008): **mọi** truy cập tài nguyên theo ID (conversation, message, call, device, user) mà người gọi không có quyền **thấy** trả `404 NOT_FOUND` (socket: ACK `NOT_FOUND`; cuộc gọi: `CALL_NOT_FOUND`) với body giống hệt tài nguyên không tồn tại. Ngoại lệ có chủ đích: (1) người **đã bị xóa/đã rời** nhận `403 NOT_A_MEMBER` (họ đã biết hội thoại tồn tại); (2) tài nguyên thấy được nhưng không đủ quyền thao tác (role, không phải người gửi, sai tab, `deviceId ≠ did`, CSRF) → `403 FORBIDDEN`; (3) chặn người dùng → `USER_BLOCKED` theo D-21.

### 6.3 Cấu hình xác thực

**Access token (JWT HS256, `jose`):**

| Claim | Giá trị |
|---|---|
| `sub` | userId (ObjectId hex) |
| `sid` | session family id (ObjectId hex của `refreshSessions.familyId`) |
| `did` | deviceId (UUID v4) |
| `iss` / `aud` | `JWT_ISSUER` / `JWT_AUDIENCE` |
| `iat` / `exp` | `exp = iat + ACCESS_TOKEN_TTL_S` |
| `jti` | UUID v4 (để log tương quan, không lưu) |

**Refresh token:** 32 byte ngẫu nhiên, base64url (43 ký tự). DB lưu `tokenHash = HMAC-SHA256(REFRESH_TOKEN_PEPPER, token)` (hex). Cookie:

```text
Set-Cookie: hustalo_rt=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000
Set-Cookie: hustalo_csrf=<random 32 byte base64url>; Secure; SameSite=Strict; Path=/; Max-Age=2592000
```

- `COOKIE_SECURE=false` chỉ cho phép khi `NODE_ENV=development` và origin `http://localhost` (dev mặc định vẫn dùng HTTPS mkcert, nên khuyến nghị `true`).
- CSRF: `POST /auth/refresh` và `POST /auth/logout` yêu cầu header `X-CSRF-Token` bằng giá trị cookie `hustalo_csrf` (so sánh `timingSafeEqual`). Endpoint dùng Bearer không cần CSRF (Bearer không tự gửi theo trình duyệt).
- Access token lưu **chỉ trong RAM** (`auth.store.ts`). Reload trang → gọi `/auth/refresh` để lấy lại.

### 6.4 Cấu hình Socket.IO

```ts
// server/src/realtime/gateway.ts (trích)
const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(httpServer, {
  path: env.SOCKET_PATH,                                  // mặc định '/socket.io'
  pingInterval: env.SOCKET_PING_INTERVAL,                 // 25000
  pingTimeout: env.SOCKET_PING_TIMEOUT,                   // 20000
  maxHttpBufferSize: SOCKET_MAX_PAYLOAD_BYTES,
  cors: { origin: env.CORS_ORIGINS, credentials: true },
  transports: ['websocket', 'polling'],
  connectionStateRecovery: {
    maxDisconnectionDuration: SOCKET_RECOVERY_MAX_DISCONNECT_MS, // 2 phút
    skipMiddlewares: false,                                       // D-14
  },
});
```

```ts
// client/src/lib/socket/socket.ts (trích)
export const socket = io(import.meta.env.VITE_SOCKET_URL, {
  path: '/socket.io',
  autoConnect: false,
  transports: ['websocket', 'polling'],  // WS trước; WS bị proxy chặn → polling (EC-NET-010)
  tryAllTransports: true,                // Xác minh với tài liệu chính thức của Socket.IO client: tùy chọn có từ v4.8
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
  auth: (cb) => cb({ token: authStore.getState().accessToken, deviceId: getDeviceId(), tabId: getTabId() }),
});
```

Handshake `auth` gồm `{ token, deviceId, tabId }`:
- `deviceId`: UUID v4 trong `localStorage` (`hustalo.deviceId`), dùng chung mọi tab của cùng profile trình duyệt — là đơn vị của presence đa thiết bị, E2EE và session.
- `tabId` `[NEW]`: UUID v4 trong `sessionStorage` (`hustalo.tabId`), riêng từng tab, giữ nguyên khi reload cùng tab — là đơn vị định tuyến **signaling cuộc gọi**. `deviceId` phải khớp claim `did` trong token, sai → `UNAUTHENTICATED`.

Rooms mỗi socket tham gia khi handshake thành công: `user:{userId}`, `device:{deviceId}`, `tab:{tabId}`, `session:{sid}`. Room động: `conv:{conversationId}` (qua `conversation:join`), `presence:{userId}` (qua `presence:subscribe`).

**Quyết định nhiều tab:** mỗi tab có socket riêng và lease presence riêng. Cuộc gọi gắn với **một tab**: call state lưu `callerDeviceId` + `callerTabId` và `acceptedDeviceId` + `acceptedTabId`; `call:offer/answer/ice-candidate/ice-restart` S→C gửi vào room `tab:{tabId}` của bên kia; mọi tab khác (kể cả tab khác cùng device) chỉ nhận `call:state` / `call:answered-elsewhere`. Event E2EE (`message:new` SECRET, `e2ee:prekeys-low`) gửi vào room `device:{deviceId}` (mọi tab cùng device dùng chung IndexedDB khóa).

---

## 7. Sơ đồ luồng (sequence)

Ký hiệu: `[AUTHZ-n]` điểm kiểm tra quyền (mục 6.2); `[RL:rule]` rate limit theo `RATE_LIMITS`; `{…}` payload rút gọn; `ACK✔ / ACK✘` ACK thành công/thất bại; `⟂` điểm có thể lỗi kèm mã.

### 7(a) Đăng nhập, refresh, handshake socket

```text
Browser(tab)               Express /api/v1                Mongo                 Redis
    |  POST /auth/login {email,password,deviceId}
    |------------------------->| [RL:login ip+email] ──────────────────────────────>| INCR rl:login:{ip}:{emailHash}
    |                          |   ⟂ quá 5/60s → 429 RATE_LIMITED (Retry-After)
    |                          |   ⟂ Redis down → 503 SERVICE_UNAVAILABLE (D-10 fail-closed)
    |                          |-- users.findByEmail(lower(email)) -->|
    |                          |   không có user → argon2.verify(DUMMY_HASH) (cân bằng thời gian)
    |                          |   ⟂ sai mật khẩu / không có user → 401 UNAUTHENTICATED "Email hoặc mật khẩu không đúng"
    |                          |   ⟂ user.status = LOCKED → 401 UNAUTHENTICATED (cùng message, không lộ trạng thái)
    |                          |-- insert refreshSessions {familyId=new, userId, deviceId,
    |                          |      tokenHash=HMAC(pepper,rt), parentHash:null, expiresAt=+30d} -->|
    |                          |   (nếu đã có family ACTIVE cùng userId+deviceId → revoke family cũ, reason LOGOUT)
    |<-------------------------| 200 { accessToken, accessTokenExpiresAt, user }
    |   Set-Cookie hustalo_rt (HttpOnly, Path=/api/v1/auth), hustalo_csrf (Path=/)
    |
    |  io.connect  auth:{ token, deviceId, tabId }                      Socket.IO Gateway
    |---------------------------------------------------------------->| socket-auth mw [AUTHZ-1]
    |                          verify JWT (iss,aud,exp) ⟂ hết hạn → connect_error {message:"TOKEN_EXPIRED"}
    |                          ⟂ sai/thiếu → connect_error {message:"UNAUTHENTICATED"}
    |                          deviceId == did ⟂ khác → UNAUTHENTICATED
    |                          EXISTS session:revoked:{sid} ──────────────────────>| ⟂ có → UNAUTHENTICATED
    |                          (Redis lỗi → tra refreshSessions.revokedAt của family trong Mongo)
    |                          socket.data.auth = {userId, sid, deviceId, tabId, exp}
    |                          join user:{u}, device:{d}, tab:{t}, session:{sid}
    |                          presence.connect() (mục 7(d)); deliver pending call:incoming (D-08)
    |                          hẹn giờ tại exp: emit session:expired → sau 5s disconnect(true)
    |<----------------------------------------------------------------| "connect"
    |
    |  Trước exp 60s (ACCESS_TOKEN_REFRESH_SKEW_S) hoặc khi REST trả TOKEN_EXPIRED:
    |  navigator.locks.request('hustalo-refresh')  (chỉ 1 tab refresh tại một thời điểm)
    |  POST /auth/refresh  Cookie: hustalo_rt, hustalo_csrf ; Header X-CSRF-Token
    |------------------------->| [RL:refresh ip] [AUTHZ-8 CSRF] ⟂ thiếu/sai → 403 FORBIDDEN
    |                          |-- find refreshSessions by tokenHash -->|
    |                          | Trường hợp:
    |                          |  A. token hiện hành (replacedAt=null, revokedAt=null, chưa hết hạn)
    |                          |     → TXN: set replacedAt=now trên bản cũ; insert bản mới {parentHash=cũ}
    |                          |     → 200 {accessToken mới} + Set-Cookie hustalo_rt mới
    |                          |  B. token đã bị xoay, now - replacedAt ≤ REFRESH_REUSE_GRACE_S,
    |                          |     và bản con của nó là token hiện hành → 409 CONFLICT (không thu hồi)
    |                          |     client đọc lại cookie (tab khác đã cập nhật) và retry 1 lần
    |                          |  C. token đã bị xoay ngoài grace, hoặc là tổ tiên xa hơn → REUSE:
    |                          |     revoke cả family (revokedAt, reason REFRESH_REUSE),
    |                          |     SET session:revoked:{sid} EX ACCESS_TOKEN_TTL_S,
    |                          |     emit session:revoked {reason:'REFRESH_REUSE'} → room session:{sid},
    |                          |     calls.endCallsForSession(sid, LOGOUT) → 401 UNAUTHENTICATED + xóa cookie
    |                          |  D. không tìm thấy / hết hạn / family revoked → 401 UNAUTHENTICATED + xóa cookie
    |<-------------------------|
    |  socket.disconnect(); socket.connect()  (auth callback đọc token mới)
```

Đổi mật khẩu (EC-AUTH-006): `POST /auth/change-password {currentPassword, newPassword}` → rate limit `changePassword` (5/15 phút/user) → verify (sai → 422 `VALIDATION_ERROR` `details: [{ field: 'currentPassword', reason: 'INVALID' }]`, EC-AUTH-008) → hash mới → revoke **mọi family khác** `sid` hiện tại (reason `PASSWORD_CHANGED`), set `session:revoked:{sid}` cho từng family, emit `session:revoked` vào từng `session:{sid}`, kết thúc cuộc gọi của các session đó với `LOGOUT`.

Khóa tài khoản (EC-AUTH-005, thao tác vận hành qua script `npm run user:lock -w server -- <email>`): set `users.status = LOCKED`, revoke mọi family (reason `ACCOUNT_LOCKED`), emit `session:revoked`, `disconnectSockets(true)` cho room `user:{userId}`, kết thúc mọi cuộc gọi với `LOGOUT`.

Logout (EC-AUTH-007): `POST /auth/logout` → revoke family hiện tại (reason `LOGOUT`) → `calls.endCallsForSession(sid, LOGOUT)` (cuộc gọi đang diễn ra của các tab thuộc session này chuyển `ENDED`/`CANCELLED` với `endReason = LOGOUT`, bên kia nhận `call:state`) → emit `session:revoked` → xóa cookie → 204.

### 7(b) Gửi tin nhắn: idempotency, transaction, ACK, fan-out, delivered, read

```text
Sender tab A1          Gateway/message.handler         messages.service          Mongo (txn)        Recipient B (tab B1, B2)
   | user bấm Gửi
   | outbox.enqueue {clientMessageId=uuidv4, conversationId, content, status:PENDING, createdLocalAt}
   |   ⟂ outbox đầy (200) → không enqueue, UI "Hàng đợi gửi đã đầy" (EC-MSG-007)
   | emitWithAck('message:send', {requestId, payload:{kind:'PLAINTEXT', conversationId, clientMessageId, content}})
   |------------------------>| withAck: Zod envelope+payload ⟂ VALIDATION_ERROR
   |                         |   (rỗng/khoảng trắng/zero-width, > 4000 code point, clientMessageId không UUID,
   |                         |    có senderId/createdAt trong payload → .strict() reject)
   |                         | [RL:messageSend user] ⟂ RATE_LIMITED
   |                         |------------------------->| [AUTHZ-2] assertMember ⟂ NOT_FOUND / NOT_A_MEMBER
   |                         |                          | kind khớp type ⟂ VALIDATION_ERROR (SECRET có content)
   |                         |                          | DIRECT/SECRET: [AUTHZ-3] isBlockedEitherWay ⟂ USER_BLOCKED
   |                         |                          | _id = new ObjectId(); createdAt = new Date() (server)
   |                         |                          | contentEnc = AES-GCM(content, AAD=`${conversationId}:${_id}`)
   |                         |                          |---- withTxn ------------------------->|
   |                         |                          |  1. insert messages {_id, conversationId, senderId,
   |                         |                          |     clientMessageId, type:TEXT, contentEnc, createdAt}
   |                         |                          |     ⟂ E11000 (conversationId,senderId,clientMessageId)
   |                         |                          |       → abort, đọc bản cũ → ACK✔ {message:cũ, duplicate:true}
   |                         |                          |  2. re-check member trong txn (đọc conversationMembers với session)
   |                         |                          |     ⟂ đã bị xóa giữa chừng → abort → NOT_A_MEMBER (EC-MSG-010)
   |                         |                          |  3. update conversations {lastMessage:{messageId,senderId,type,createdAt},
   |                         |                          |     lastMessageAt: createdAt}  (chỉ khi createdAt mới hơn)
   |                         |                          |  4. DIRECT/SECRET: insert messageReceipts {messageId, conversationId,
   |                         |                          |     userId: recipient, deliveredAt:null, readAt:null}
   |                         |                          |  5. update member(sender) cursor read/delivered = message (người gửi đã đọc)
   |                         |                          |  commit ⟂ TransientTransactionError → retry ≤ 3 → SERVICE_UNAVAILABLE
   |                         |                          |<--------------------------------------|
   |<------------------------| ACK✔ {ok:true, requestId, data:{message, duplicate:false}}   (CHỈ sau commit)
   | outbox.remove(clientMessageId); bubble PENDING → SENT (✓); chèn theo (createdAt,_id) server
   |                         | fan-out: emitter.toUsers(memberIds, 'message:new', {eventId, occurredAt, message})
   |                         |   (memberIds đọc trong txn; gồm các tab khác của sender; SECRET: theo device room)
   |                         |---------------------------------------------------------------------------------->| B1, B2
   |                                                                                  B1: dedupe eventId, chèn vào cache
   |                                                                                  B1 emit message:delivered {conversationId, upToMessageId}
   |                         |<----------------------------------------------------------------------------------|
   |                         | [AUTHZ-2] receipts.markDelivered (một chiều, mục 7(b).1) → ACK✔ {advanced}
   |<------------------------| message:status {scope:'MESSAGE', messageIds:[…], status:'DELIVERED', byUserId:B}
   | ✓ → ✓✓ (không hạ cấp nếu đã READ)
   |                                                                                  B1 mở hội thoại, tab visible,
   |                                                                                  tin nằm trong viewport (IntersectionObserver)
   |                                                                                  emit message:read {conversationId, upToMessageId}
   |                         |<----------------------------------------------------------------------------------|
   |                         | receipts.markRead → ACK✔ {advanced, unreadCount}
   |<------------------------| message:status {status:'READ', byUserId:B}      → user:{A}
   |                         | message:status {status:'READ', byUserId:B}      → user:{B} (B2 xóa badge chưa đọc)
   | ✓✓ → ✓✓ xanh
```

Nhánh lỗi và retry:
- **ACK mất sau khi persist (EC-NET-004):** client timeout `SOCKET_ACK_TIMEOUT_MS` → giữ PENDING, retry theo backoff `1s, 2s, 4s, 8s, 16s, 30s, 30s…` với **cùng** `clientMessageId` → server trả `duplicate: true` với bản đã lưu → client hợp nhất theo `clientMessageId`. Nếu `message:new` của chính tin đó (từ tab khác/fan-out) đến trước ACK, client hợp nhất theo `clientMessageId` + `senderId`.
- **Mongo down (EC-INFRA-001):** ACK✘ `SERVICE_UNAVAILABLE` → tin ở lại outbox, retry backoff.
- **Lỗi vĩnh viễn** (`VALIDATION_ERROR`, `NOT_A_MEMBER`, `NOT_FOUND`, `USER_BLOCKED`, `FORBIDDEN`): bubble → FAILED ngay, không retry tự động; UI cho "Thử lại" (gửi lại cùng `clientMessageId`) hoặc "Xóa".
- **`RATE_LIMITED`:** retry sau backoff, không tính là FAILED.
- **Quá `OUTBOX_MAX_AGE_MS` (24h) chưa gửi được** → FAILED.

#### 7(b).1 Quy tắc receipt một chiều

- Client gửi cursor `upToMessageId`. Server tra message đó (phải thuộc `conversationId`, ⟂ `NOT_FOUND`), lấy `(createdAt, _id)`.
- **DIRECT/SECRET:** `updateMany` `messageReceipts` của `userId = me`, `conversationId`, `messageCreatedAt ≤ cursor`, `deliveredAt = null` → `deliveredAt = now` (read: `readAt = null` → `readAt = now` và `deliveredAt = coalesce(deliveredAt, now)`). Chỉ tin của người khác có receipt nên tin của chính mình không bị ảnh hưởng. Danh sách `messageIds` thực sự đổi được trả về trong `message:status`. Không có bản ghi nào đổi → `advanced: false`, không phát event.
- **GROUP:** cập nhật `conversationMembers(me)` với điều kiện cursor mới lớn hơn cursor cũ theo `(createdAt, _id)` (read cũng nâng delivered nếu delivered < read). Không thỏa → `advanced: false`.
- Không có API nào hạ cấp receipt. Receipt chỉ gửi bởi chính người nhận (`userId` từ token) — không thể giả mạo receipt cho người khác (EC-SEC-003).
- Read receipt chỉ được client gửi khi `document.visibilityState === 'visible'` **và** cửa sổ có focus **và** tin hiện trong viewport ≥ 50% (EC-MSG-009). Delivered không cần visible.

### 7(c) Reconnect, đồng bộ tin bị lỡ, xả outbox

```text
Client tab                                   Gateway                            REST
  | mạng rớt → socket "disconnect" (reason transport close / ping timeout)
  | socket.store = 'reconnecting'; ConnectionBanner "Đang kết nối lại…"
  | outbox tạm dừng flush; bubble mới vẫn PENDING
  | Socket.IO tự reconnect (1s → 30s, jitter 0.5)
  |   ⟂ token hết hạn trong lúc offline → connect_error TOKEN_EXPIRED → refresh (7(a)) → connect lại
  |   ⟂ refresh 401 → về /login (giữ outbox trong IndexedDB theo userId, gửi lại khi đăng nhập lại cùng user)
  |------------------------------------------>| socket-auth chạy lại (skipMiddlewares=false)
  |<------------------------------------------| connect; socket.recovered = true|false
  | sync.ts (LUÔN chạy, kể cả recovered=true):
  |  1. syncGeneration++ ; mọi request sync thuộc generation cũ bị bỏ kết quả (EC-NET-007)
  |  2. invalidate ['conversations'] → GET /conversations (trang đầu) ─────────────────>|
  |  3. với hội thoại đang mở: GET /conversations/{id}/messages?after=<cursor tin mới nhất đã biết>&limit=100
  |     lặp tới khi trang < limit ───────────────────────────────────────────────────>|
  |     hợp nhất theo _id (dedupe), sắp theo (createdAt,_id)
  |  4. với mỗi hội thoại có lastMessage mới hơn myLastDeliveredAt và senderId ≠ me:
  |     emit message:delivered {conversationId, upToMessageId: lastMessage.messageId}
  |  5. conversation:join lại hội thoại đang mở; presence:subscribe lại danh sách đang hiển thị
  |  6. nếu call.store có cuộc gọi chưa kết thúc: emit call:state {callId, connectionState hiện tại}
  |     → server trả trạng thái chính thức (mục 8.5)
  |  7. outbox.flush(): gửi tuần tự theo createdLocalAt, tối đa 1 tin in-flight / hội thoại
  | socket.store = 'connected'; banner ẩn
```

- **Flapping (EC-NET-002):** banner chỉ hiện sau 2 s ở trạng thái reconnecting (tránh nhấp nháy); sync có debounce 500 ms và generation counter; presence không nhấp nháy nhờ `PRESENCE_OFFLINE_GRACE_MS`.
- **Event sai thứ tự / trùng (EC-NET-005, EC-NET-006):** client dedupe `eventId` (LRU 1000); tin chèn theo `(createdAt,_id)`; receipt áp theo `max`; `call:state` áp chỉ khi `version` lớn hơn version đang giữ.
- **Tab nền bị throttle timer (EC-NET-008):** không dựa vào `setInterval` phía client cho presence (server tự gia hạn lease, mục 7(d)); outbox backoff dùng `setTimeout` nhưng cũng flush ngay khi `visibilitychange → visible` và khi `online` event.
- **Máy ngủ/thức (EC-NET-009):** khi thức, `socket.connected` có thể còn `true` nhưng đã chết; client lắng nghe `visibilitychange`/`online` và nếu khoảng thời gian thực trôi qua giữa 2 lần tick > `SOCKET_PING_INTERVAL_MS + SOCKET_PING_TIMEOUT_MS` thì chủ động `socket.disconnect().connect()` rồi chạy sync.
- **Server restart (EC-NET-003):** mọi socket rớt; `connectionStateRecovery` không khôi phục được (state trong RAM mất ở 1 instance) → `recovered=false` → sync đầy đủ như trên.
- **Fallback polling (EC-NET-010):** WebSocket bị chặn → Socket.IO dùng HTTP long-polling qua cùng `path`; chức năng không đổi; khi nhiều instance cần sticky session ở proxy (mục 10.4).

### 7(d) Presence đa thiết bị

```text
Alice tab1(dev X)   Alice tab2(dev Y)     Gateway / presence.service           Redis                       Bob (subscriber)
   | connect                                 | presence-touch.lua:
   |---------------------------------------->|  ZADD presence:conns:{alice} {connId=inst:sock} now+60s
   |                                         |  ZREMRANGEBYSCORE presence:conns:{alice} -inf now (dọn lease hết hạn)
   |                                         |  ZREM presence:offline-pending alice
   |                                         |  trả wasOnline (ZCOUNT trước khi thêm > 0)
   |                                         |  wasOnline=false → publish presence:update ONLINE ─────────────>| presence:{alice}
   |                     | connect           |  ZADD conn thứ 2; wasOnline=true → KHÔNG phát event
   |                     |------------------>|
   |                                         | mỗi PRESENCE_HEARTBEAT_MS (20s) mỗi instance:
   |                                         |  pipeline ZADD presence:conns:{u} {connId} now+60s cho mọi socket local
   | đóng tab1 (disconnect)                  | presence-drop.lua: ZREM conn tab1; ZCOUNT(now,+inf) = 1 → không làm gì
   |                                         |
   |                     | đóng tab2         | ZREM conn tab2; ZCOUNT = 0 → ZADD presence:offline-pending alice now+10s
   |                                         | presence.sweeper (1s): ZRANGEBYSCORE offline-pending ≤ now (claim + ZREM)
   |                                         |  re-check ZCOUNT(conns, now, +inf) = 0
   |                                         |   → users.setLastSeen(alice, now) (Mongo)
   |                                         |   → publish presence:update {OFFLINE, lastSeenAt (lọc privacy)} ─>| 
   |                                         |  nếu trong 10s alice kết nối lại → offline-pending đã bị ZREM → không phát
   | crash / mất điện (không có disconnect): socket server phát hiện qua ping timeout (≤ 45s) → drop như trên;
   |   instance chết: lease không được gia hạn → hết hạn ≤ 60s; sweeper của instance khác: quét
   |   presence:conns:* có score max < now (ZSET presence:users theo dõi hạn lease lớn nhất của từng user, xem Phụ lục A)
```

- **Subscribe:** `presence:subscribe {userIds}` → lọc [AUTHZ: chung hội thoại, không chặn] → join `presence:{userId}` cho từng id được chấp nhận → emit `presence:snapshot` cho socket đó. Client subscribe các user đang hiển thị trong danh sách chat và header phòng chat; gọi lại sau reconnect.
- **Privacy (EC-PRES-004):** `users.privacy.showLastSeen = false` → mọi người khác nhận `lastSeenAt: null`; **có đi có lại**: user ẩn lastSeen của mình cũng nhận `lastSeenAt: null` của người khác. Trạng thái ONLINE/OFFLINE vẫn hiển thị.
- **Redis mất dữ liệu (EC-PRES-005):** mọi user hiển thị OFFLINE cho tới heartbeat kế tiếp (≤ 20 s) khi các instance ZADD lại lease cho socket local → tự phục hồi; server phát `presence:update ONLINE` khi `wasOnline=false`. Redis **không truy cập được**: `presence:snapshot.degraded = true`, client hiển thị trạng thái "không xác định" (không chấm xanh, không lastSeen).

### 7(e) Thiết lập cuộc gọi WebRTC đầy đủ (multi-device ring, answered elsewhere, trickle ICE)

```text
Caller A (tab A1)          Gateway/calls.service            Redis                    Callee B tab B1 (accept)   Callee B tab B2
 | bấm "Gọi video"
 | support.ts: isSecureContext && RTCPeerConnection && mediaDevices ⟂ EC-CALL-MEDIA-008/009
 | localPhase=PREPARING_MEDIA; getUserMedia({audio:true, video:{width:1280,height:720}})
 |   ⟂ NotFoundError(video)/NotReadableError(video)/OverconstrainedError → thử lại {audio:true} → tiếp tục, cờ localVideo=false
 |   ⟂ NotAllowedError / NotFoundError(audio) → dừng, không gửi invite, UI lỗi media (ui_ux_spec)
 | GET /calls/ice-servers (cache tới expiresAt-5') → iceServers
 | emitWithAck call:invite {conversationId, callType:'VIDEO'}
 |------------------------->| [RL:callInvite] [AUTHZ-2] type DIRECT|SECRET (GROUP ⟂ VALIDATION_ERROR)
 |                          | [AUTHZ-3] ⟂ USER_BLOCKED; callee = thành viên còn lại
 |                          | callId = new ObjectId()
 |                          | EVAL call-invite.lua ------------>| user:incall:{A} tồn tại ⟂ CALL_INVALID_STATE
 |                          |                                   | user:incall:{B} = X:
 |                          |                                   |   X là call B→A ở INITIATED/RINGING → GLARE (7(g))
 |                          |                                   |   khác → BUSY
 |                          |                                   | không: HSET call:active:{callId} {status:INITIATED,…, version:1}
 |                          |                                   |   SET user:incall:{A}, user:incall:{B} = callId EX 6h
 |                          |                                   |   ZADD call:deadlines now+45s "{callId}:RING"
 |                          | insert callHistory {_id:callId, status:INITIATED, …} (Mongo)
 |<-------------------------| ACK✔ {callId, status:'INITIATED', merged:false, callType:'VIDEO'}
 | UI "Đang gọi…" + ringback | BUSY: insert callHistory BUSY/BUSY, SYSTEM message CALL_MISSED, emit call:busy → user:{B}
 |                          |       ACK✘ CALL_BUSY → UI "Người nhận đang bận"
 |                          | emit call:incoming {callId, caller, callType, ringExpiresAt} → user:{B}, timeout 5s, chờ ACK
 |                          |-------------------------------------------------------->| B1 ring     | B2 ring
 |                          |<-------------------------------------------- ACK {ok:true} từ ≥1 tab
 |                          | call-transition INITIATED→RINGING (CAS)
 |<-------------------------| call:ringing {callId, ringExpiresAt} → tab:{A1};  call:state RINGING → user:{A}, user:{B}
 | UI "Đang đổ chuông…"     |  (không tab nào ACK trong 5s hoặc B offline: giữ INITIATED; khi B kết nối → gửi lại call:incoming)
 |                          |
 |                          |                                    B1 bấm "Trả lời": getUserMedia trước
 |                          |                                    ⟂ thất bại hoàn toàn (không mic) → call:end {MEDIA_FAILURE} → FAILED
 |                          |<--------------------------------------------- call:accept {callId}
 |                          | [AUTHZ-6] B là callee; CAS {INITIATED,RINGING}→ACCEPTED, set acceptedDeviceId/TabId
 |                          |   ⟂ đã ACCEPTED bởi tab khác → CALL_ALREADY_ANSWERED (EC-CALL-SIG-016)
 |                          |   ⟂ đã MISSED (quá 45s) → CALL_TIMEOUT (EC-CALL-SIG-006)
 |                          |   ⟂ đã CANCELLED → CALL_INVALID_STATE (EC-CALL-SIG-005)
 |                          | ZREM RING deadline; ZADD now+30s "{callId}:CONNECT"
 |                          |----------------------------------------------> ACK✔ {status:'ACCEPTED'}
 |<-------------------------| call:accepted {acceptedDeviceId, acceptedTabId} → tab:{A1}, tab:{B1}
 |                          | call:answered-elsewhere → mọi tab khác của B ------------------------------------>| B2 dừng chuông
 |                          | call:state ACCEPTED → user:{A}, user:{B}                                           | ẩn màn hình
 | pc = new RTCPeerConnection({iceServers, iceTransportPolicy})
 | addTrack(audio[,video]); nếu không có video local trong cuộc gọi VIDEO: addTransceiver('video',{direction:'recvonly'})
 | offer = createOffer(); setLocalDescription(offer)
 | call:offer {callId, revision:1, sdp}
 |------------------------->| [AUTHZ-6 tab caller] revision = offerRevision+1 ⟂ CALL_INVALID_STATE
 |                          | HSET offerRevision=1; CAS ACCEPTED→CONNECTING
 |                          | relay call:offer → tab:{B1} ---------------------->| setRemoteDescription(offer)
 |                          |                                                    | xả hàng đợi ICE (revision 1)
 |                          |                                                    | answer = createAnswer(); setLocalDescription
 |                          |<---------------------------------------------------| call:answer {callId, revision:1, sdp}
 |<-------------------------| relay call:answer → tab:{A1}
 | setRemoteDescription(answer); xả hàng đợi ICE
 | onicecandidate → call:ice-candidate {revision:1, candidate} (trickle, cả hai chiều)
 |<=========================|===================================================>| relay tới tab bên kia
 |   Bên nhận: nếu pc.remoteDescription == null hoặc revision > revision hiện tại của remote description
 |             → đẩy vào candidate-queue (tối đa 200, dedupe theo chuỗi candidate); ngược lại addIceCandidate
 |             candidate revision < hiện tại → bỏ (EC-CALL-SIG-009/010)
 | pc.connectionState = 'connected' (ICE + DTLS xong)                               | 'connected'
 | call:state {callId, connectionState:'connected'}  (cả hai tab đều báo)
 |------------------------->| CAS {ACCEPTED,CONNECTING,RECONNECTING}→CONNECTED (lần đầu set connectedAt)
 |                          | ZREM CONNECT deadline; update callHistory {status:CONNECTED, connectedAt}
 |<-------------------------| call:state CONNECTED → user:{A}, user:{B}
 | UI "Đang gọi 00:00"      |                                                    | UI "Đang gọi 00:00"
 |
 | bấm "Kết thúc": call:end {reason:'HANGUP'} → CAS →ENDED/HANGUP, DEL user:incall:*, ZREM deadlines,
 |   update callHistory {status:ENDED, endReason, endedAt, durationSec}, SYSTEM message CALL_ENDED (thời lượng),
 |   call:state ENDED → user:{A}, user:{B}; cả hai: pc.close(), stop mọi track, giải phóng camera/mic
```

- **Kết thúc khi `getUserMedia` còn chờ (EC-CALL-MEDIA-012):** `media.ts` giữ token hủy; nếu cuộc gọi kết thúc (nhận `call:state` terminal, `call:answered-elsewhere`, ACK lỗi) trong lúc promise `getUserMedia` chưa resolve, khi resolve phải `stream.getTracks().forEach(t => t.stop())` ngay và không gắn vào pc.
- **Hết giờ đổ chuông:** sweeper claim `{callId}:RING` → CAS {INITIATED, RINGING}→MISSED/TIMEOUT → callHistory, SYSTEM message `CALL_MISSED` trong hội thoại, `call:state MISSED` cho cả hai.
- **Thiếu camera trong VIDEO call:** callType giữ `VIDEO` trong record; phía peer không nhận video track → UI hiển thị avatar. Không có event riêng.

### 7(f) ICE restart khi đổi mạng

```text
Caller A1 (offerer)                Gateway                         Callee B1
 | Wi-Fi → 4G: iceConnectionState 'disconnected'
 | chờ ICE_DISCONNECTED_GRACE_MS (3s): tự hồi phục → không làm gì (EC-CALL-NET-002)
 | vẫn 'disconnected' sau 3s, hoặc 'failed' ngay:
 | call:state {connectionState:'disconnected'|'failed'}
 |--------------------------------->| CAS CONNECTED→RECONNECTING; ZADD now+20s "{callId}:RECONNECT"
 |<---------------------------------| call:state RECONNECTING → user:{A}, user:{B}    UI "Đang kết nối lại…"
 | ice-servers.ts: credential còn < 5' → GET /calls/ice-servers mới; pc.setConfiguration({iceServers})
 | call:ice-restart {callId, attempt:1}
 |--------------------------------->| [AUTHZ-6] attempt == iceRestarts+1 ≤ 2 ⟂ CALL_INVALID_STATE; HINCRBY iceRestarts
 |                                  | relay call:ice-restart → tab:{B1} (B1 chuẩn bị nhận offer mới)
 | offer = createOffer({iceRestart:true}); setLocalDescription
 | call:offer {revision:2, sdp}  ─────> relay ────────────────────────────────────> setRemoteDescription;
 |                                                                                 candidate-queue.reset(revision 2)
 | <──────────────────────────────── relay ─────────────────────────────────────── call:answer {revision:2}
 | trickle ICE revision 2 (candidate revision 1 đến muộn bị bỏ)
 | 'connected' → call:state {connected} → CAS RECONNECTING→CONNECTED; ZREM RECONNECT deadline
 |
 | Nếu callee phát hiện mất kết nối trước: B1 gửi call:state {disconnected} như trên và
 |   call:ice-restart {attempt:n} → relay tới A1 → A1 (offerer duy nhất, D-04) tạo offer iceRestart.
 |   Nếu cả hai cùng gửi call:ice-restart với cùng attempt: server chấp nhận cái đến trước,
 |   cái sau ⟂ CALL_INVALID_STATE (client bỏ qua lỗi này nếu đã nhận relay của bên kia).
 | Hết 2 lần restart vẫn không 'connected' → tab bất kỳ gửi call:end {reason:'NETWORK_FAILURE'} → ENDED/NETWORK_FAILURE
 | Hoặc deadline RECONNECT (20s) tới trước → sweeper: CAS RECONNECTING→ENDED/NETWORK_FAILURE (EC-CALL-NET-010)
```

- **Hai bên hồi phục lệch thời điểm (EC-CALL-NET-007):** server chỉ chuyển `RECONNECTING → CONNECTED` khi nhận `connected` từ ít nhất một tab; báo cáo `disconnected` của tab còn lại đến **sau** (theo thời điểm server nhận) mới đưa lại về `RECONNECTING`. Vì `connected` của ICE là trạng thái chung của cặp, lệch chỉ là độ trễ báo cáo.
- **Một bên đã end, bên kia còn reconnect (EC-CALL-NET-008):** `call:end` → terminal; bên kia nhận `call:state ENDED` (nếu socket còn) hoặc khi socket reconnect và gửi `call:state` → server trả trạng thái terminal → client dừng ICE restart, đóng pc.
- **Socket signaling rớt nhưng media còn chạy:** trạng thái cuộc gọi **không** đổi chỉ vì socket rớt. Server đặt deadline `{callId}:PEER:{tabId}` = now + `CALL_RECONNECT_GRACE_MS` khi socket của tab tham gia disconnect; tab đó reconnect (cùng `tabId`) và gửi `call:state` → ZREM deadline. Hết hạn → `ENDED/PEER_DISCONNECTED` (trước ACCEPTED: tab caller → `CANCELLED/PEER_DISCONNECTED`).

### 7(g) Glare — server gộp hai lời mời (D-03)

```text
Alice A1                       Gateway / call-invite.lua (atomic, serialize trên Redis)        Bob B1
 | call:invite {conv, VIDEO}  ─────>|                                               |<───── call:invite {conv, VOICE}
 |                                  | Lua chạy tuần tự. Giả sử invite của Alice tới trước:
 |                                  | (1) Alice: không ai incall → tạo call C1 (A→B, VIDEO), SET incall A,B = C1
 |<─────────────────────────────────| ACK✔ {callId:C1, status:INITIATED, merged:false}
 |                                  | (2) Bob: user:incall:{bob} = C1; C1.callerId = alice, C1.calleeId = bob,
 |                                  |     C1.status ∈ {INITIATED, RINGING} → GLARE → MERGE:
 |                                  |     CAS C1 → ACCEPTED với acceptedDeviceId/TabId = tab B1 của Bob
 |                                  |     (giữ callType của C1 = VIDEO; không tạo call mới; không tính rate limit lần 2)
 |                                  |─────────────────────────────────────────────>| ACK✔ {callId:C1, status:'ACCEPTED',
 |                                  |                                               |       merged:true, callType:'VIDEO'}
 |<─────────────────────────────────| call:accepted {callId:C1, acceptedTabId:B1} → tab:{A1}, tab:{B1}
 |                                  | call:answered-elsewhere → tab khác của Bob; call:state ACCEPTED → cả hai
 | (Alice là offerer — D-04)        |                                               | Bob: bỏ chuông call:incoming C1 nếu đã hiện,
 | createOffer → call:offer (7(e))  |                                               | dùng media đã lấy (VOICE → bật thêm camera nếu
 |                                  |                                               |  có quyền; không có → recvonly video)
```

Quy tắc:
- Gộp chỉ khi lời mời thứ hai đến từ **chính callee** của cuộc gọi đang ở `INITIATED`/`RINGING` và cùng conversation. Mọi trường hợp khác khi callee đã có `user:incall` → `CALL_BUSY`.
- Nếu Bob gửi `call:invite` sau khi C1 đã `ACCEPTED` trở đi → `CALL_INVALID_STATE` (Bob đã ở trong cuộc gọi).
- Client Bob đã nhận `call:incoming C1` trước ACK: khi ACK `merged: true` → chuyển thẳng sang màn hình đang kết nối của C1.
- Kết quả xác định: luôn đúng một cuộc gọi; người có lời mời đến server trước là caller/offerer.

### 7(h) Thiết lập phiên E2EE (X3DH) cho Secret Chat

```text
Alice device X (đã đăng ký khóa)        REST /e2ee                    Mongo                         Bob device Y, Z
 | Đăng ký thiết bị (lần đầu bật Secret Chat trên device, hoặc khi login nếu IndexedDB chưa có khóa):
 |   KeyHelper: identityKeyPair, registrationId, signedPreKey(keyId, sig), 100 oneTimePreKeys
 |   private key → IndexedDB (signal-store), KHÔNG rời device
 | PUT /e2ee/devices/{X}/keys {registrationId, identityKey, signedPreKey{keyId,publicKey,signature}, oneTimePreKeys[100]}
 |---------------------------->| [AUTHZ-7] did == X; số device ACTIVE < 5 ⟂ CONFLICT
 |                             | upsert userDevices {userId, deviceId:X, signalDeviceId (int, cấp tăng dần), identityKey,…}
 |                             | insertMany oneTimePreKeys {userId, deviceId, keyId, publicKey}
 |<----------------------------| 200 {deviceId, signalDeviceId, oneTimePreKeyCount}
 |
 | Tạo Secret Chat: POST /conversations {type:'SECRET', memberIds:[bob]} → idempotent theo cặp (D-11)
 |   ⟂ Bob không có device ACTIVE → 422 E2EE_KEYS_UNAVAILABLE "Người nhận chưa bật trò chuyện bí mật" (EC-E2EE-001)
 |
 | Gửi tin đầu tiên:
 | GET /e2ee/users/{bob}/bundles ───>| [RL:e2eeBundle] [chung hội thoại SECRET, không chặn]
 |                             | với mỗi device ACTIVE của Bob (Y, Z):
 |                             |  findOneAndUpdate oneTimePreKeys {userId:bob, deviceId, consumedAt:null} → set consumedAt, sort keyId asc (nguyên tử)
 |                             |  không còn → oneTimePreKey:null (X3DH vẫn chạy không OTPK — EC-E2EE-002)
 |                             |  đếm còn lại < 20 và chưa gửi trong 1h → e2ee:prekeys-low → device:{Y|Z} ──────────> bổ sung
 |<----------------------------| 200 {bundles:[{deviceId, signalDeviceId, registrationId, identityKey, signedPreKey, oneTimePreKey|null}]}
 | GET /e2ee/users/{alice}/bundles (các device khác của Alice, trừ X) để chúng đọc được tin của chính mình
 | Với mỗi bundle: so identityKey với known identity trong IndexedDB:
 |   khác → đánh dấu identity đổi, hiện IdentityChangedBanner, CHẶN gửi tới khi user xác nhận (EC-E2EE-003)
 |   SessionBuilder.processPreKey(bundle) (thư viện verify chữ ký signedPreKey; sai → bỏ device đó, báo lỗi)
 | SessionCipher.encrypt(plaintext) cho từng device → recipients[{deviceId, type:3 (PREKEY), body}]
 | message:send {kind:'E2EE', conversationId, clientMessageId, ciphertext:{v:1, senderDeviceId:X, recipients}}
 |---------------------------->| Gateway: [AUTHZ-2][AUTHZ-3]; device X ACTIVE ⟂ FORBIDDEN (EC-E2EE-005)
 |                             | e2ee.assertEnvelopeRecipients: tập deviceId == (device ACTIVE của Bob) ∪ (device ACTIVE của Alice \ {X})
 |                             |   ⟂ thiếu/thừa → CONFLICT "Danh sách thiết bị đã thay đổi" → client tải lại bundles, mã hóa lại
 |                             |   ⟂ Bob không còn device ACTIVE → E2EE_KEYS_UNAVAILABLE
 |                             | lưu messages {ciphertext: envelope, contentEnc: none} (không AES lớp 2)
 |                             | fan-out message:new tới device:{Y}, device:{Z}, device:{alice khác}: mỗi device chỉ nhận recipient của mình
 |                             |-------------------------------------------------------------------------------------> Y, Z
 |                                                                       SessionCipher.decryptPreKeyWhisperMessage → session lập
 |                                                                       ⟂ lỗi → bubble "Không thể giải mã tin nhắn này" (E2EE_DECRYPT_FAILED, EC-E2EE-004)
 | Các tin sau: type:1 (WHISPER) Double Ratchet. UI hiện E2eeBadge "Mã hóa đầu-cuối" khi có session với ≥ 1 device của peer.
```

- **Safety number:** `safety-number.ts` tính từ `(userId, identityKey)` của cả hai bên theo thuật toán fingerprint của thư viện (60 chữ số, 12 nhóm 5 số); khi user có nhiều device, mỗi device có identity riêng → hiển thị safety number theo từng device của peer. `// Xác minh với tài liệu chính thức của @privacyresearch/libsignal-protocol-typescript: API FingerprintGenerator; nếu không có, cài đặt theo NumericFingerprint của Signal (SHA-512 lặp 5200 lần).`
- **Thu hồi device (`DELETE /e2ee/devices/{deviceId}`):** `userDevices.status = REVOKED`, xóa mọi `oneTimePreKeys` của device, revoke mọi session family của device đó (reason `DEVICE_REVOKED`) và phát `session:revoked` vào các room `session:{sid}` tương ứng; server không phát event riêng cho peer — các peer phát hiện thay đổi ở lần `message:send` tiếp theo (CONFLICT → tải lại bundles). Tin đến từ device đã thu hồi bị server chặn (`FORBIDDEN`).
- **Xóa IndexedDB / device mới (EC-E2EE-006, EC-E2EE-007):** device sinh khóa mới → đăng ký lại (identity đổi với peer → cảnh báo phía peer). **Lịch sử Secret Chat cũ không đọc được trên device mới hoặc sau khi xóa IndexedDB — đây là hành vi thiết kế**; REST lịch sử trả các tin không có recipient cho device hiện tại → UI hiển thị "Tin nhắn được gửi trước khi thiết bị này tham gia".

---

## 8. State machine cuộc gọi

### 8.1 Nguyên tắc

- `CallStatus` (mục 4.4.2) là enum **duy nhất** cho state machine server, collection `callHistory.status` và UI (`call.store.status`). Không có trạng thái `OUTGOING`/`INCOMING` riêng: "cuộc gọi đi/đến" là `INITIATED`/`RINGING` + vai trò (`callerId === me`).
- Nguồn sự thật live: Redis hash `call:active:{callId}`. Nguồn sự thật bền: `callHistory` (ghi sau **mỗi** chuyển trạng thái thành công, bằng update có điều kiện `status ∉ terminal`).
- Mọi chuyển trạng thái đi qua `call-transition.lua` (compare-and-set): input `callId, expectedFrom[], to, endReason?, fields{}`; nếu `status` hiện tại ∉ `expectedFrom` → trả `{ ok: 0, status, version }`, không đổi gì. Thành công → `version += 1`, khi `to` là terminal: `DEL user:incall:{callerId}` và `user:incall:{calleeId}` **chỉ khi** giá trị vẫn bằng `callId`, `ZREM` mọi deadline của call, `EXPIRE call:active:{callId} 300` (giữ 5 phút để trả lời idempotent rồi tự xóa).
- Hàm thuần `call.state-machine.ts` export `transition(state, event, actor): { to, endReason } | { error: ErrorCode } | { noop: true }` — dùng cho unit test bảng 8.2 và để handler quyết định `expectedFrom`.

### 8.2 Bảng chuyển trạng thái

Actor: `CALLER_TAB` (tab `callerTabId`), `CALLEE_ANY` (bất kỳ tab nào của callee), `CALLEE_TAB` (tab `acceptedTabId`), `PARTICIPANT` (CALLER_TAB hoặc CALLEE_TAB), `SERVER` (sweeper/gateway).

| # | From | Event | Actor | To | `endReason` | Timeout/deadline áp dụng sau chuyển | Ghi chú / lỗi khi không hợp lệ |
|---|---|---|---|---|---|---|---|
| T01 | (không có) | `call:invite` hợp lệ | caller (tab) | INITIATED | — | đặt `RING` = now + `CALL_RING_TIMEOUT_MS` | `callerTabId` = tab gửi |
| T02 | (không có) | `call:invite`, callee đang trong cuộc gọi khác | caller | BUSY (chỉ ghi `callHistory`, không tạo `call:active`) | BUSY | — | ACK✘ `CALL_BUSY`; `call:busy` tới callee; SYSTEM `CALL_MISSED` |
| T03 | INITIATED | ≥ 1 tab callee ACK `call:incoming` | SERVER | RINGING | — | giữ `RING` | `call:ringing` tới caller |
| T04 | INITIATED, RINGING | `call:accept` | CALLEE_ANY | ACCEPTED | — | xóa `RING`; đặt `CONNECT` = now + `CALL_CONNECT_TIMEOUT_MS` | set `acceptedDeviceId/TabId`; `call:accepted`, `call:answered-elsewhere` |
| T05 | INITIATED, RINGING | `call:invite` từ callee (glare) | callee (tab) | ACCEPTED | — | như T04 | D-03; ACK `merged: true` |
| T06 | INITIATED, RINGING | `call:reject` | CALLEE_ANY | REJECTED | REJECTED | xóa `RING` | D-07 |
| T07 | INITIATED, RINGING | `call:cancel` hoặc `call:end{HANGUP}` | CALLER_TAB | CANCELLED | CANCELLED | xóa `RING` | |
| T08 | INITIATED, RINGING | deadline `RING` | SERVER | MISSED | TIMEOUT | — | SYSTEM `CALL_MISSED` |
| T09 | INITIATED, RINGING | `call:end{MEDIA_FAILURE}` | CALLER_TAB hoặc CALLEE_ANY | FAILED | MEDIA_FAILURE | xóa `RING` | |
| T10 | INITIATED, RINGING | deadline `PEER:{callerTabId}` (socket caller mất > `CALL_RECONNECT_GRACE_MS`) | SERVER | CANCELLED | PEER_DISCONNECTED | — | Socket callee rớt **không** làm đổi trạng thái (tab khác/thiết bị khác vẫn có thể nghe) |
| T11 | INITIATED, RINGING | logout session chứa `callerTabId` | SERVER | CANCELLED | LOGOUT | — | Logout của callee không đổi trạng thái |
| T12 | ACCEPTED | `call:offer` revision 1 | CALLER_TAB | CONNECTING | — | giữ `CONNECT` | relay offer |
| T13 | ACCEPTED, CONNECTING | `call:state{connected}` | PARTICIPANT | CONNECTED | — | xóa `CONNECT` | set `connectedAt` (lần đầu) |
| T14 | ACCEPTED, CONNECTING | deadline `CONNECT` | SERVER | FAILED | NETWORK_FAILURE | — | |
| T15 | ACCEPTED, CONNECTING | `call:end{HANGUP}` hoặc `call:cancel` | PARTICIPANT | ENDED | HANGUP | xóa `CONNECT` | |
| T16 | ACCEPTED, CONNECTING | `call:end{MEDIA_FAILURE}` | PARTICIPANT | FAILED | MEDIA_FAILURE | xóa `CONNECT` | |
| T17 | ACCEPTED, CONNECTING | `call:end{NETWORK_FAILURE}` | PARTICIPANT | FAILED | NETWORK_FAILURE | xóa `CONNECT` | |
| T18 | ACCEPTED, CONNECTING | `call:state{disconnected\|failed}` | PARTICIPANT | (giữ nguyên) | — | `CONNECT` vẫn chạy | noop, ACK trả trạng thái hiện tại |
| T19 | CONNECTED | `call:state{disconnected\|failed}` | PARTICIPANT | RECONNECTING | — | đặt `RECONNECT` = now + `CALL_RECONNECT_GRACE_MS` | |
| T20 | RECONNECTING | `call:state{connected}` | PARTICIPANT | CONNECTED | — | xóa `RECONNECT` | |
| T21 | CONNECTED, RECONNECTING | `call:end{HANGUP}` hoặc `call:cancel` | PARTICIPANT | ENDED | HANGUP | xóa `RECONNECT` | SYSTEM `CALL_ENDED` (thời lượng) |
| T22 | CONNECTED, RECONNECTING | `call:end{MEDIA_FAILURE}` | PARTICIPANT | ENDED | MEDIA_FAILURE | xóa `RECONNECT` | |
| T23 | CONNECTED, RECONNECTING | `call:end{NETWORK_FAILURE}` | PARTICIPANT | ENDED | NETWORK_FAILURE | xóa `RECONNECT` | ICE restart đã hết lượt |
| T24 | RECONNECTING | deadline `RECONNECT` | SERVER | ENDED | NETWORK_FAILURE | — | |
| T25 | ACCEPTED, CONNECTING | deadline `PEER:{tabId}` của tab tham gia | SERVER | FAILED | PEER_DISCONNECTED | — | |
| T26 | CONNECTED, RECONNECTING | deadline `PEER:{tabId}` của tab tham gia | SERVER | ENDED | PEER_DISCONNECTED | — | |
| T27 | ACCEPTED, CONNECTING, CONNECTED, RECONNECTING | logout/khóa tài khoản/thu hồi device của session chứa tab tham gia | SERVER | ENDED | LOGOUT | — | |
| T28 | INITIATED, RINGING | khóa tài khoản callee hoặc caller | SERVER | FAILED | LOGOUT | — | |
| T29 | bất kỳ active, state Redis đã mất | `call:state` từ participant, `callHistory` chưa terminal | SERVER | `connectedAt != null` → ENDED, ngược lại FAILED | SERVER_RESTART | — | Mục 8.5 |
| T30 | CONNECTING, CONNECTED, RECONNECTING | `call:ice-restart` hợp lệ | PARTICIPANT | (giữ nguyên) | — | — | `iceRestarts += 1`; vượt `CALL_MAX_ICE_RESTARTS` → `CALL_INVALID_STATE` |
| T31 | CONNECTED, RECONNECTING | `call:offer` revision n+1 (ICE restart) | CALLER_TAB | (giữ nguyên) | — | — | relay |
| T32 | terminal (ENDED, REJECTED, CANCELLED, MISSED, BUSY, FAILED) | `call:end`, `call:cancel`, `call:reject`, `call:state` | bất kỳ participant | (giữ nguyên) | (giữ nguyên) | — | **Idempotent**: ACK✔ trả `{status, endReason}` hiện tại, không phát lại event (EC-CALL-SIG-015) |
| T33 | terminal | `call:accept` | CALLEE_ANY | (giữ nguyên) | — | — | MISSED → `CALL_TIMEOUT`; ACCEPTED-by-other không áp dụng (không terminal); còn lại → `CALL_INVALID_STATE` |
| T34 | ACCEPTED, CONNECTING, CONNECTED, RECONNECTING | `call:accept` | CALLEE_ANY | (giữ nguyên) | — | — | Tab khác `acceptedTabId` → `CALL_ALREADY_ANSWERED`; chính `acceptedTabId` → ACK✔ (idempotent) |
| T35 | bất kỳ | `call:offer/answer/ice-candidate/ice-restart` với revision/role sai hoặc status không cho phép | — | (giữ nguyên) | — | — | `CALL_INVALID_STATE` (sai role → `FORBIDDEN`; không phải caller/callee → `CALL_NOT_FOUND`) |
| T36 | bất kỳ | event signaling cho `callId` không tồn tại (cả Redis lẫn Mongo) hoặc của cuộc gọi cũ đã hết hạn key | — | — | — | — | `CALL_NOT_FOUND` (replay cuộc gọi cũ, EC-CALL-SIG-010) |

Hành vi đi kèm mỗi chuyển thành công: (1) update `callHistory` có điều kiện, (2) phát `call:state` tới `user:{callerId}` và `user:{calleeId}`, (3) event chuyên biệt nếu có, (4) khi terminal tạo SYSTEM message trong hội thoại: `CALL_MISSED` cho MISSED và BUSY; `CALL_ENDED` (kèm thời lượng) cho ENDED có `connectedAt`; REJECTED, CANCELLED, FAILED và ENDED không có `connectedAt` không tạo SYSTEM message, (5) metric `hustalo_call_transitions_total{from,to}`.

### 8.3 Deadline

| Deadline | Member ZSET `call:deadlines` | Đặt ở | Xóa ở | Khi tới hạn |
|---|---|---|---|---|
| RING | `{callId}:RING` | T01 | T04–T07, T09 | T08 |
| CONNECT | `{callId}:CONNECT` | T04, T05 | T13–T17 | T14 |
| RECONNECT | `{callId}:RECONNECT` | T19 | T20–T23 | T24 |
| PEER | `{callId}:PEER:{tabId}` | socket của tab tham gia disconnect khi call active | tab đó reconnect và gửi `call:state`, hoặc call terminal | T10, T25, T26 |

Sweeper (`call.sweeper.ts`) mỗi `CALL_DEADLINE_SWEEP_INTERVAL_MS`: `call-deadlines-claim.lua` lấy tối đa 50 member có score ≤ now và `ZREM` trong cùng script (mỗi deadline chỉ một instance xử lý), rồi gọi `calls.service.onDeadline(member)` → CAS với `expectedFrom` của hàng tương ứng; CAS thất bại = deadline cũ, bỏ qua. Độ trễ tối đa của timeout = 1 s + thời gian xử lý.

### 8.4 State machine `RTCPeerConnection` phía client và ánh xạ

`PeerSession` (client) theo dõi `pc.connectionState` (dùng `iceConnectionState` làm dự phòng cho trình duyệt thiếu `connectionState`) và `pc.signalingState`:

```text
            createPC
 (none) ──────────────▶ new ──(setLocal/RemoteDescription, ICE checking)──▶ connecting
                                                                              │
                                     ┌───────────── 'connected' ◀────────────┘
                                     ▼
                                 connected ──'disconnected'──▶ disconnected ──(3s ICE_DISCONNECTED_GRACE)──▶ [lost]
                                     ▲                              │ tự hồi phục < 3s                         │
                                     │                              └────────────▶ connected                    │
                                     │                                                                          ▼
                                     └──── 'connected' ◀── ICE restart (≤ 2) ◀── 'failed' / [lost] ─────────── failed
                                                                  │ hết lượt hoặc call:state terminal
                                                                  ▼
                                                               closed (pc.close(), stop tracks)
```

| `pc.connectionState` (client) | Hành động client | Báo cáo `call:state` | `CallStatus` server kỳ vọng |
|---|---|---|---|
| `new` | Chờ offer/answer | — | ACCEPTED |
| `connecting` | Trickle ICE | — | CONNECTING |
| `connected` | Hủy timer mất kết nối; reset `localReconnecting` | `connected` (mỗi lần chuyển vào) | CONNECTED |
| `disconnected` < 3 s | Chờ | — | CONNECTED |
| `disconnected` ≥ 3 s | Bắt đầu ICE restart | `disconnected` | RECONNECTING |
| `failed` | ICE restart ngay (nếu còn lượt) | `failed` | RECONNECTING |
| `failed` hết lượt | `call:end{NETWORK_FAILURE}` | — | ENDED/FAILED + NETWORK_FAILURE |
| `closed` | Giải phóng tài nguyên | — | terminal |

`signalingState` guard (EC-CALL-SIG-007):
- Callee nhận `call:offer`: nếu `signalingState === 'stable'` → xử lý; nếu `'have-remote-offer'` và revision mới hơn → `setRemoteDescription` (trình duyệt tự rollback offer cũ — implicit rollback); revision cũ hơn hoặc bằng revision đã xử lý → bỏ.
- Caller nhận `call:answer`: chỉ xử lý khi `signalingState === 'have-local-offer'` và `revision` = revision offer đang chờ; ngược lại bỏ và log `debug` (không log SDP).
- Callee **không bao giờ** tự tạo offer (D-04).

UI luôn render theo `call.store.status` (mirror `call:state` có `version` lớn nhất) cộng `call.store.localPhase` (`PREPARING_MEDIA` khi chưa có callId) và cờ `networkQuality` ('good' | 'poor' từ `getStats()` mỗi 2 s: `packetsLost` tỷ lệ > 5% hoặc `roundTripTime` > 400 ms trong 3 mẫu liên tiếp → 'poor'). Trạng thái `poor network` là lớp phủ trên CONNECTED, không phải `CallStatus`.

### 8.5 Reconcile khi server restart / mất state

1. Boot: `jobs/reconcile-calls.ts` tìm `callHistory` có `status ∈ CALL_ACTIVE_STATUSES` mà `call:active:{id}` không tồn tại trong Redis và `updatedAt < now - (CALL_RING_TIMEOUT_MS + CALL_CONNECT_TIMEOUT_MS)` → chốt T29 (ENDED hoặc FAILED / `SERVER_RESTART`).
2. Redis vẫn còn (restart process thường gặp): `call:active` và `call:deadlines` còn nguyên → sweeper của process mới tiếp tục; socket client reconnect, gửi `call:state` → server hủy deadline PEER tương ứng → cuộc gọi tiếp tục. Media P2P không bị ảnh hưởng trong lúc signaling mất (EC-CALL-NET-009).
3. Redis mất dữ liệu: client gửi `call:state` → không có `call:active` → tra Mongo → chốt T29 → ACK trạng thái terminal + phát `call:state` terminal → client đóng pc, UI "Cuộc gọi đã kết thúc do sự cố máy chủ".

### 8.6 Ánh xạ trạng thái cuộc gọi → UI

Văn bản dưới đây là chuỗi chính; `ui_ux_spec.md` dùng đúng các chuỗi này trong ma trận trạng thái UI.

| `CallStatus` / pha | Vai trò | Màn hình | Văn bản chính |
|---|---|---|---|
| `localPhase=PREPARING_MEDIA` | caller | OutgoingCallScreen | "Đang chuẩn bị micro/camera…" |
| INITIATED | caller | OutgoingCallScreen | "Đang gọi…" |
| RINGING | caller | OutgoingCallScreen | "Đang đổ chuông…" |
| INITIATED, RINGING | callee | IncomingCallScreen | "Cuộc gọi thoại đến" / "Cuộc gọi video đến" |
| ACCEPTED, CONNECTING | cả hai | InCallScreen | "Đang kết nối…" |
| CONNECTED | cả hai | InCallScreen | đồng hồ `mm:ss` |
| CONNECTED + `networkQuality=poor` | cả hai | InCallScreen | "Kết nối yếu" |
| RECONNECTING | cả hai | InCallScreen | "Đang kết nối lại…" |
| ENDED / HANGUP | cả hai | CallEndedNotice | "Cuộc gọi đã kết thúc" |
| ENDED, FAILED / NETWORK_FAILURE | cả hai | CallEndedNotice | "Cuộc gọi bị gián đoạn do mất kết nối" |
| ENDED, FAILED / MEDIA_FAILURE | cả hai | CallEndedNotice | "Cuộc gọi kết thúc do lỗi thiết bị âm thanh/hình ảnh" |
| ENDED, FAILED / PEER_DISCONNECTED | cả hai | CallEndedNotice | "Người kia đã mất kết nối" |
| ENDED, FAILED / SERVER_RESTART | cả hai | CallEndedNotice | "Cuộc gọi đã kết thúc do sự cố máy chủ" |
| ENDED, CANCELLED, FAILED / LOGOUT | cả hai | CallEndedNotice | "Cuộc gọi đã kết thúc" |
| REJECTED | caller | CallEndedNotice | "Người nhận đã từ chối cuộc gọi" |
| REJECTED | callee | (đóng màn hình) | — |
| CANCELLED / CANCELLED, PEER_DISCONNECTED | callee | (đóng màn hình, toast) | "Cuộc gọi nhỡ từ {tên}" |
| MISSED | caller | CallEndedNotice | "Không có người trả lời" |
| MISSED | callee | (đóng màn hình, toast) | "Cuộc gọi nhỡ từ {tên}" |
| BUSY (ACK `CALL_BUSY`) | caller | CallEndedNotice | "Người nhận đang bận" |
| `call:busy` | callee | toast | "{tên} vừa gọi cho bạn" |
| `call:answered-elsewhere` | callee (tab khác) | (đóng màn hình) | "Đã trả lời trên thiết bị khác" |

---

## 9. Bảo mật đường truyền và lưu trữ

### 9.1 Đường truyền

| Kênh | Bảo vệ | Ghi chú |
|---|---|---|
| REST | HTTPS (TLS 1.2+), HSTS `max-age=31536000; includeSubDomains` ở production | Local: Vite HTTPS bằng mkcert; server Express HTTP sau proxy Vite |
| Socket.IO | WSS (hoặc HTTPS long-polling) | Cùng origin với SPA qua proxy; `CORS_ORIGINS` whitelist |
| Media | DTLS-SRTP (bắt buộc bởi WebRTC) | Không tắt được; fingerprint DTLS nằm trong SDP đi qua signaling WSS |
| TURN | `turn:` (UDP/TCP 3478) và `turns:` (TLS 443) | Media vẫn là SRTP đã mã hóa; TURN chỉ thấy metadata |
| Mongo/Redis | Mạng nội bộ + xác thực; TLS nội bộ ở production | Không bind ra Internet |
| Xirsys API | HTTPS | Basic auth `XIRSYS_IDENT:XIRSYS_SECRET` chỉ ở server |

`getUserMedia` chỉ chạy trong **secure context** (HTTPS hoặc `http://localhost`) — đây là lý do bắt buộc HTTPS khi test từ điện thoại trong LAN (EC-CALL-MEDIA-009).

### 9.2 Mã hóa lưu trữ AES-256-GCM (tin DIRECT/GROUP)

#### 9.2.1 Định dạng

```ts
// lưu trong messages.contentEnc
interface EncryptedField {
  v: 1;            // DATA_ENCRYPTION_VERSION
  keyId: string;   // khóa trong DATA_ENCRYPTION_KEYS, ví dụ "k2026a"
  iv: string;      // base64 của 12 byte ngẫu nhiên, MỚI cho mỗi lần mã hóa (kể cả khi sửa tin)
  ct: string;      // base64 ciphertext
  tag: string;     // base64 auth tag 16 byte
}
```

- `DATA_ENCRYPTION_KEYS` = JSON `{"<keyId1>":"<base64 32 byte>","<keyId2>":"<base64 32 byte>"}` (một hoặc nhiều key); `DATA_ENCRYPTION_ACTIVE_KEY_ID` phải là một key trong đó. `key-ring.ts` validate lúc boot (mỗi key decode đúng 32 byte, `keyId` khớp `^[A-Za-z0-9_-]{1,32}$`), sai → process thoát với lỗi rõ ràng (không log giá trị key).
- AAD = `${conversationId}:${messageId}` (UTF-8). Ciphertext bị chép sang tin/hội thoại khác sẽ giải mã thất bại.
- Chỉ trường `content` được mã hóa. Không mã hóa: metadata (`senderId`, `createdAt`, `conversationId`), `conversations.title`, `users.displayName` — ghi rõ là giới hạn.

#### 9.2.2 Code chuẩn

```ts
// server/src/infra/crypto/aes-gcm.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DATA_ENCRYPTION_VERSION } from '@hustalo/shared';
import { keyRing } from './key-ring';

export interface EncryptedField { v: 1; keyId: string; iv: string; ct: string; tag: string }

export function encryptField(plaintext: string, aad: string): EncryptedField {
  const { keyId, key } = keyRing.active();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: DATA_ENCRYPTION_VERSION,
    keyId,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptField(field: EncryptedField, aad: string): string {
  if (field.v !== DATA_ENCRYPTION_VERSION) throw new Error(`Unsupported contentEnc.v=${field.v}`);
  const key = keyRing.get(field.keyId); // throw nếu keyId không có trong key ring
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(field.iv, 'base64'), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(field.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(field.ct, 'base64')), decipher.final()]).toString('utf8');
}
```

- `messages.service.toDTO`: giải mã thất bại (tag sai, key thiếu) → `content: null`, log `error { messageId, keyId, err: 'DECRYPT_FAILED' }` (không log ct), tăng `hustalo_content_decrypt_failures_total`. UI hiển thị "Không thể hiển thị nội dung tin nhắn này".
- Tin thu hồi: `$unset contentEnc`, set `deletedAt` → không còn dữ liệu để giải mã.

#### 9.2.3 Giới hạn (ghi rõ)

- **Không phải E2EE**: process server (và ai có `DATA_ENCRYPTION_KEYS` + DB) đọc được nội dung. Mục tiêu là chống lộ dữ liệu khi rò rỉ DB/backup/snapshot đĩa mà không rò rỉ key.
- **Không hỗ trợ tìm kiếm full-text** trên nội dung tin nhắn (ngoài phạm vi MVP).
- Preview tin cuối ở danh sách chat được giải mã lúc đọc (`GET /conversations` join tin cuối), không lưu preview plaintext.

#### 9.2.4 Xoay khóa và job re-encrypt

1. Sinh key mới: `node scripts/gen-secrets.mjs --data-key` → thêm `"<keyIdMới>":"<base64>"` vào `DATA_ENCRYPTION_KEYS` (giữ key cũ).
2. Đổi `DATA_ENCRYPTION_ACTIVE_KEY_ID=<keyIdMới>`, restart server → mọi lần ghi mới (gửi, sửa) dùng key mới; tin cũ vẫn đọc được bằng key cũ.
3. Chạy `npm run job:reencrypt -w server -- --from <keyIdCũ> [--after <messageId>] [--batch 500]`:
   - Lặp `messages.find({ 'contentEnc.keyId': from, _id: { $gt: after } }).sort({ _id: 1 }).limit(batch)`.
   - Mỗi tin: giải mã bằng key cũ, mã hóa bằng key active (IV mới, cùng AAD), `updateOne({ _id, 'contentEnc.keyId': from, 'contentEnc.iv': ivCũ }, { $set: { contentEnc: mới } })` — điều kiện `iv` cũ chống ghi đè bản vừa được sửa đồng thời.
   - In tiến độ `{ processed, lastId }` (không in nội dung) để chạy tiếp bằng `--after` khi bị ngắt; idempotent.
4. Khi `messages.countDocuments({ 'contentEnc.keyId': from }) === 0` → xóa key cũ khỏi `DATA_ENCRYPTION_KEYS`, restart.
5. Key bị lộ: làm như trên ngay, đồng thời xoay mọi backup (backup cũ chứa ciphertext key cũ phải bị hủy hoặc giữ key cũ trong kho lạnh theo chính sách lưu trữ).

### 9.3 E2EE (Secret Chat)

| Dữ liệu | Nơi lưu | Server thấy |
|---|---|---|
| Identity key pair, signed prekey private, one-time prekey private, session state, known identities | IndexedDB trên device (`signal-store.ts`, DB `hustalo-signal-{userId}`) | Không |
| Identity public key, signed prekey public + chữ ký, `registrationId`, `signalDeviceId` | `userDevices` | Có (công khai) |
| One-time prekey public | `oneTimePreKeys` (đánh dấu `consumedAt` khi cấp phát, TTL xóa sau 7 ngày) | Có (công khai) |
| Ciphertext envelope | `messages.ciphertext` | Có (không giải mã được) |
| Metadata: ai gửi ai, lúc nào, kích thước, deviceId | `messages`, log | Có — giới hạn đã biết |

Quy tắc:
- Server **từ chối** payload SECRET có `content` (`VALIDATION_ERROR`) và payload DIRECT/GROUP có `ciphertext`.
- Tin SECRET không có `contentEnc` (không mã hóa AES lớp 2; ciphertext đã an toàn).
- UI chỉ hiển thị "Mã hóa đầu-cuối" trong conversation SECRET **đã có session** với ít nhất một device của peer; trước đó hiển thị "Đang thiết lập mã hóa…". (Ràng buộc CLAUDE.md: chỉ bật sau M7.)
- Typing và receipt trong SECRET vẫn đi plaintext metadata qua server (giới hạn đã biết).
- Signed prekey xoay mỗi `E2EE_SIGNED_PREKEY_ROTATION_MS` (7 ngày) qua `PUT /e2ee/devices/{deviceId}/keys` (chỉ trường `signedPreKey`); client giữ signed prekey cũ thêm 7 ngày để giải mã PreKey message đến muộn.

### 9.4 Mật khẩu

- Argon2id, tham số: `memoryCost = 19456` KiB (19 MiB), `timeCost = 2`, `parallelism = 1`, salt 16 byte (thư viện tự sinh), hash dạng PHC string. (Theo khuyến nghị OWASP Password Storage Cheat Sheet. `// Xác minh với tài liệu chính thức của OWASP: tham số tối thiểu hiện hành.`)
- `argon2.needsRehash` khi đăng nhập thành công → rehash nếu tham số thay đổi.
- Email chuẩn hóa `trim().toLowerCase()` trước khi lưu/tra cứu.

### 9.5 TURN / ICE servers

`GET /api/v1/calls/ice-servers` (`iceServers.service.ts`):

1. Đọc cache Redis `ice:servers:xirsys` (TTL `ICE_SERVERS_CACHE_TTL_S` = 5 phút). Có → trả.
2. Không có → gọi Xirsys:

```text
PUT {XIRSYS_API_URL}/_turn/{XIRSYS_CHANNEL}
Authorization: Basic base64(XIRSYS_IDENT:XIRSYS_SECRET)
Content-Type: application/json
Body: {"format":"urls","expire":3600}
Kỳ vọng response: { "s": "ok", "v": { "iceServers": { "username": "<u>", "credential": "<c>", "urls": ["stun:<host>","turn:<host>:3478?transport=udp","turn:<host>:3478?transport=tcp","turns:<host>:443?transport=tcp"] } } }
// Xác minh với tài liệu chính thức của Xirsys: đường dẫn /_turn/{channel}, tham số "format" và "expire",
// và cấu trúc "v.iceServers" (có thể là object hoặc mảng tùy phiên bản API). Parse bằng Zod chấp nhận cả hai dạng.
```

   Timeout `XIRSYS_TIMEOUT_MS`; parse Zod; thành công → `SET ice:servers:xirsys <json> EX 300` kèm `fetchedAt`.
3. Xirsys lỗi/timeout/parse sai (EC-CALL-NET-006) → fallback: `STUN_URLS` + (`TURN_FALLBACK_URLS`, `TURN_FALLBACK_USERNAME`, `TURN_FALLBACK_CREDENTIAL` nếu cấu hình) → log `warn { provider: 'xirsys', err }`, metric `hustalo_ice_servers_fallback_total`. Không cache fallback.
4. Response:

```json
{
  "iceServers": [
    { "urls": ["stun:stun.l.google.com:19302"] },
    { "urls": ["turn:tr.example.net:3478?transport=udp", "turn:tr.example.net:3478?transport=tcp", "turns:tr.example.net:443?transport=tcp"],
      "username": "<ngắn hạn>", "credential": "<ngắn hạn>" }
  ],
  "iceTransportPolicy": "all",
  "expiresAt": "2026-10-27T11:00:00.000Z",
  "source": "XIRSYS"
}
```

   `expiresAt = fetchedAt + TURN_CREDENTIAL_TTL_S`; `source ∈ { 'XIRSYS', 'FALLBACK' }`; `iceTransportPolicy` lấy từ `ICE_TRANSPORT_POLICY` (`all` | `relay`; `relay` để test TURN, EC-CALL-NET-003/004).
- Client làm mới khi còn < `TURN_REFRESH_BEFORE_S` (5 phút) và **trước mỗi ICE restart** gọi `pc.setConfiguration({ iceServers })` với credential mới (EC-CALL-NET-005). Allocation TURN đang chạy được trình duyệt tự refresh bằng credential cũ; nếu TURN từ chối (credential hết hạn) thì ICE chuyển `failed` → ICE restart với credential mới.
- **Không bao giờ** đưa `XIRSYS_SECRET`/`XIRSYS_IDENT` vào biến `VITE_*`. `scripts/check-bundle-secrets.mjs` chạy trong `npm run build` và fail nếu `client/dist` chứa chuỗi giá trị của bất kỳ biến server nào (EC-SEC-006).
- Gói miễn phí Xirsys có quota — kiểm tra lại trước production (R-01).

### 9.6 HTTP headers, CORS, CSP, hiển thị

- `helmet()` mặc định cho API + `helmet.contentSecurityPolicy` cho response HTML (production do proxy phục vụ SPA, cùng chính sách):

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob:;
media-src 'self' blob:;
connect-src 'self' wss://<host> https://<host>;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none'
```

  (`style-src 'unsafe-inline'` cần cho style động của video PiP; nếu dùng font tự host thì bỏ hai domain Google Fonts.)
- `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(self), microphone=(self), geolocation=()`.
- CORS: `origin` ∈ `CORS_ORIGINS` (danh sách phân tách bằng dấu phẩy), `credentials: true`, methods `GET,POST,PATCH,PUT,DELETE`, headers `Authorization, Content-Type, X-CSRF-Token, X-Request-Id, Idempotency-Key`. Origin khác → không set header CORS (trình duyệt chặn); Socket.IO dùng cùng whitelist.
- Hiển thị: React escape mặc định; ESLint `react/no-danger: error`; link trong tin nhắn hiển thị dạng text (MVP không tự động linkify). Bubble dùng `dir="auto"` và CSS `unicode-bidi: isolate` chống ký tự điều khiển RTL làm đảo giao diện (EC-MSG-003); payload XSS hiển thị nguyên văn (EC-MSG-004).

### 9.7 Backup

- `mongodump --oplog --gzip` hằng ngày (production), mã hóa file backup bằng khóa backup riêng (không dùng `DATA_ENCRYPTION_KEYS`), lưu ở kho khác vùng; giữ 30 ngày.
- Backup chứa `contentEnc` (ciphertext) và envelope E2EE; **không** chứa `DATA_ENCRYPTION_KEYS` (nằm ở secret manager). Khôi phục cần cả backup + key ring tương ứng.
- Redis không backup (dữ liệu tạm); mất Redis chấp nhận được theo mục 10.2.
- Diễn tập khôi phục mỗi quý: restore vào môi trường staging, chạy `npm run db:indexes`, kiểm tra giải mã mẫu 100 tin.

---

## 10. Độ tin cậy

### 10.1 MongoDB down (EC-INFRA-001)

| Chức năng | Hành vi |
|---|---|
| `message:send` | ACK✘ `SERVICE_UNAVAILABLE`; client giữ tin trong outbox, retry backoff |
| REST đọc/ghi | 503 `SERVICE_UNAVAILABLE` |
| Login/refresh | 503; client đã đăng nhập giữ access token tới hết hạn |
| Socket handshake | Vẫn chạy nếu Redis ổn (JWT tự chứa); handler cần Mongo trả `SERVICE_UNAVAILABLE` |
| Presence | Hoạt động (Redis); `setLastSeen` lỗi → log `warn`, bỏ qua |
| Cuộc gọi | Signaling hoạt động (Redis); ghi `callHistory` lỗi → đẩy vào hàng đợi trong RAM `pendingCallHistory` (tối đa 1000 bản ghi) và retry mỗi 5 s; process restart trước khi ghi được → reconcile ở 8.5 |
| `/health` | 503 `{ status: 'degraded', mongo: 'down' }` |

Transaction bị abort (`TransientTransactionError`, `UnknownTransactionCommitResult`, EC-INFRA-003): `withTxn` dùng `session.withTransaction()` và tự retry tối đa `MONGO_TXN_MAX_RETRIES` (3) lần; hết lượt → `SERVICE_UNAVAILABLE`. Mọi thao tác trong transaction phải idempotent khi chạy lại (insert có unique key, update có điều kiện).

### 10.2 Redis down (EC-INFRA-002)

| Chức năng | Hành vi (chốt) |
|---|---|
| Rate limit login/register/refresh | **Fail-closed**: 503 `SERVICE_UNAVAILABLE` |
| Rate limit khác | **Fail-open có kiểm soát**: limiter bộ nhớ per-instance cùng hạn mức (`insuranceLimiter` của `rate-limiter-flexible`; `// Xác minh với tài liệu chính thức của rate-limiter-flexible: tùy chọn insuranceLimiter của RateLimiterRedis.`) |
| Kiểm tra `session:revoked` | Fallback tra `refreshSessions` (family `revokedAt`) trong Mongo |
| Presence | `presence:snapshot.degraded = true`, không phát `presence:update`; UI "không xác định" |
| Typing | ACK✘ `SERVICE_UNAVAILABLE`; client bỏ qua im lặng |
| `call:invite` | ACK✘ `SERVICE_UNAVAILABLE` |
| Cuộc gọi đang diễn ra | Signaling relay cần đọc `call:active` để kiểm quyền → ACK✘ `SERVICE_UNAVAILABLE`, không relay; media P2P vẫn chạy; Redis trở lại còn dữ liệu → tiếp tục, mất dữ liệu → reconcile 8.5 |
| ICE servers | Bỏ cache, gọi Xirsys trực tiếp |
| `e2ee:prekeys-low` cooldown | Bỏ qua cooldown, vẫn phát event |
| Chat (gửi/nhận/receipt) | **Vẫn hoạt động** (MVP 1 instance, adapter in-memory) |
| `/health` | 200 `{ status: 'degraded', redis: 'down' }` |

### 10.3 Server restart

- Tin đã ACK nằm trong Mongo (ACK chỉ sau commit) → không mất. Tin chưa ACK nằm trong outbox client → gửi lại idempotent.
- Socket: client reconnect + sync (7(c)).
- Presence: lease của process cũ hết hạn ≤ 60 s nếu không được gia hạn; client reconnect tạo lease mới ngay → thường không ai thấy OFFLINE nhờ grace 10 s (lease cũ còn hạn trong lúc restart).
- Cuộc gọi: mục 8.5. Media P2P tiếp tục; signaling khôi phục khi socket reconnect.
- Graceful shutdown (`SIGTERM`): (1) `/health` trả 503 `draining`, (2) dừng sweeper, (3) ngừng nhận kết nối mới, (4) `io.disconnectSockets(true)` (client reconnect), (5) chờ request HTTP đang chạy tối đa 10 s, (6) đóng Mongo/Redis. **Không** kết thúc cuộc gọi khi shutdown (deadline nằm ở Redis).

### 10.4 Mở rộng nhiều instance

- Bật `@socket.io/redis-streams-adapter` (D-13) khi `SOCKET_ADAPTER=redis-streams` `[NEW env]`; mặc định `memory`.
- Proxy cần **sticky session** (theo cookie `io` hoặc IP hash) nếu cho phép long-polling; nếu chỉ WebSocket thì không bắt buộc.
- Mọi trạng thái chia sẻ ở Redis (presence lease có `instanceId` trong member, deadline claim nguyên tử, rate limit Redis).
- Timer `session:expired` và heartbeat lease là per-socket/per-instance (đúng khi socket sống ở instance đó).
- `instanceId` = `${hostname}-${pid}-${random4}` sinh lúc boot.

---

## 11. Observability

### 11.1 Metric (prom-client, `GET :METRICS_PORT/metrics`, bind `127.0.0.1`)

| Metric | Loại | Label | Ý nghĩa |
|---|---|---|---|
| `hustalo_http_request_duration_seconds` | histogram | `method, route, status` | Độ trễ REST (route template, không chứa id) |
| `hustalo_socket_connections` | gauge | — | Socket đang kết nối |
| `hustalo_socket_events_total` | counter | `event, result(ok\|error), code` | Số event C→S |
| `hustalo_message_send_ack_seconds` | histogram | `type` | NFR-ARCH-01 |
| `hustalo_message_fanout_recipients` | histogram | `type` | Số user nhận fan-out |
| `hustalo_message_duplicates_total` | counter | — | Số lần `DUPLICATE_MESSAGE` |
| `hustalo_content_decrypt_failures_total` | counter | `keyId` | Giải mã AES thất bại |
| `hustalo_call_transitions_total` | counter | `from, to, endReason` | Chuyển trạng thái cuộc gọi |
| `hustalo_call_setup_seconds` | histogram | `callType` | ACCEPTED → CONNECTED (NFR-ARCH-03) |
| `hustalo_call_ice_restarts_total` | counter | `result` | ICE restart |
| `hustalo_ice_servers_fallback_total` | counter | `reason` | Xirsys lỗi |
| `hustalo_rate_limited_total` | counter | `rule` | Bị rate limit |
| `hustalo_presence_online_users` | gauge | — | User online (ước lượng từ ZSET `presence:users`) |
| `hustalo_dependency_up` | gauge | `dep(mongo\|redis\|xirsys)` | 1/0 |
| `hustalo_refresh_reuse_detected_total` | counter | — | Phát hiện tái sử dụng refresh token (EC-AUTH-004) |
| `hustalo_txn_retries_total` | counter | `op` | Retry transaction |

### 11.2 Log có cấu trúc (pino)

- JSON một dòng; trường chuẩn: `time, level, msg, instanceId, requestId, userId, deviceId, sid, event, conversationId, callId, durationMs, code`.
- REST: `pino-http` gắn `requestId` (= header `X-Request-Id`, trả lại trong response và trong `error.requestId`).
- Socket: mỗi event C→S log `info` một dòng `{ event, requestId, userId, durationMs, ok, code }`; lỗi `INTERNAL_ERROR` log `error` kèm stack.
- Mức log theo `LOG_LEVEL` (mặc định `info`; test `silent`).

### 11.3 Cấm log (redact bắt buộc)

Cấu hình `redact` của pino (censor `"[REDACTED]"`):

```ts
redact: {
  paths: [
    'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]',
    '*.password', '*.currentPassword', '*.newPassword', '*.passwordHash',
    '*.accessToken', '*.refreshToken', '*.token', '*.tokenHash',
    '*.content', '*.contentEnc', '*.ciphertext', '*.body',
    '*.sdp', '*.candidate', '*.iceServers', '*.credential', '*.username',
    '*.identityKey', '*.signedPreKey', '*.oneTimePreKeys',
    'payload.content', 'payload.ciphertext', 'payload.sdp', 'payload.candidate',
  ],
  censor: '[REDACTED]',
}
```

- Cấm log: mật khẩu, access/refresh token, cookie, CSRF token, nội dung tin nhắn (plaintext hoặc ciphertext), SDP, ICE candidate (chứa IP), credential TURN, secret env, khóa E2EE.
- Không log toàn bộ `req.body` hay payload socket; chỉ log các trường id.
- Test `logger.test.ts` (EC-SEC-007): ghi log object chứa các trường trên → output không chứa giá trị gốc.

---

## 12. Acceptance criteria của kiến trúc

| ID | Given / When / Then |
|---|---|
| AC-ARCH-001 | **Given** repo sạch, **When** chạy `npm run typecheck && npm run lint`, **Then** cây thư mục đúng mục 4.1, không có import vòng (`import/no-cycle`), không module nào import repository/model của module khác (rule `no-restricted-imports`). |
| AC-ARCH-002 | **Given** `packages/shared`, **When** tìm định nghĩa enum/hằng số/mã lỗi/tên event trong `server/` và `client/`, **Then** không có bản định nghĩa trùng; mọi nơi import từ `@hustalo/shared`. |
| AC-ARCH-003 | **Given** MongoDB không chạy replica set, **When** server khởi động, **Then** process thoát với thông báo "MongoDB phải chạy replica set (rs0) để dùng transaction". |
| AC-ARCH-004 | **Given** `DATA_ENCRYPTION_ACTIVE_KEY_ID` không có trong `DATA_ENCRYPTION_KEYS` hoặc key không đủ 32 byte, **When** khởi động, **Then** process thoát, log không chứa giá trị key. |
| AC-ARCH-005 | **Given** tin DIRECT đã gửi, **When** đọc document trong Mongo, **Then** không có trường `content` plaintext, có `contentEnc{v,keyId,iv,ct,tag}`, và giải mã với AAD sai thất bại. |
| AC-ARCH-006 | **Given** client gửi `message:send`, **When** ACK trả về, **Then** document đã commit (đọc được từ session khác ngay sau ACK). |
| AC-ARCH-007 | **Given** cuộc gọi ở RINGING, **When** restart process server (Redis giữ nguyên) và chờ quá `CALL_RING_TIMEOUT_MS`, **Then** cuộc gọi chuyển MISSED/TIMEOUT (deadline sống sót restart). |
| AC-ARCH-008 | **Given** mọi chuyển trạng thái ở bảng 8.2, **When** chạy `call.state-machine.test.ts`, **Then** mỗi hàng T01–T36 có ít nhất một test và mọi cặp (status, event) không có trong bảng trả lỗi hoặc noop đúng quy định. |
| AC-ARCH-009 | **Given** Redis dừng, **When** gửi tin nhắn và đăng nhập, **Then** gửi tin thành công; đăng nhập trả 503 `SERVICE_UNAVAILABLE`; `/health` trả `degraded`. |
| AC-ARCH-010 | **Given** log capture trong integration test chạy toàn bộ luồng login → chat → call, **When** quét log, **Then** không có chuỗi token, mật khẩu, nội dung tin, SDP, candidate. |
| AC-ARCH-011 | **Given** `npm run build`, **When** `check-bundle-secrets.mjs` chạy, **Then** `client/dist` không chứa giá trị `XIRSYS_SECRET`, `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `DATA_ENCRYPTION_KEYS`. |
| AC-ARCH-012 | **Given** 50 user đồng thời gửi tổng 5 msg/s trong 5 phút (môi trường test), **When** đo `hustalo_message_send_ack_seconds`, **Then** p95 ≤ 300 ms. |
| AC-ARCH-013 | **Given** hai tab của cùng user cùng gọi `/auth/refresh` trong 1 s, **When** hoàn tất, **Then** cả hai tab có access token hợp lệ và family **không** bị thu hồi (D-19). |
| AC-ARCH-014 | **Given** socket kết nối với token hết hạn trong 1 phút, **When** tới `exp`, **Then** client nhận `session:expired`, socket bị ngắt sau 5 s nếu chưa reconnect, client refresh và reconnect thành công, không mất event `message:new` (sync REST bù). |
| AC-ARCH-015 | **Given** hai user gọi nhau cùng lúc (glare), **When** cả hai `call:invite` tới server trong vòng 50 ms, **Then** chỉ tồn tại đúng một `callHistory` cho cặp đó ở trạng thái ACCEPTED rồi CONNECTED. |

---

## Phụ lục A — Redis key (tóm tắt; chi tiết thao tác ở `database_schema.md`)

Mọi key tạo qua `server/src/infra/redis/keys.ts`. Tiền tố toàn cục `REDIS_KEY_PREFIX` `[NEW env]` (mặc định `hustalo:`) để dùng chung Redis giữa môi trường.

| Pattern | Kiểu | TTL | Ghi | Đọc |
|---|---|---|---|---|
| `presence:conns:{userId}` | ZSET member `{instanceId}:{socketId}` score `leaseExpiresAt` (ms) | `PRESENCE_LEASE_TTL_MS` (PEXPIRE gia hạn mỗi touch) | connect, heartbeat 20 s, disconnect | online? = `ZCOUNT key now +inf > 0` |
| `presence:users` | ZSET member `userId` score = hạn lease lớn nhất | không | `presence-touch.lua` (`ZADD GT`) | sweeper phát hiện instance chết |
| `presence:offline-pending` | ZSET member `userId` score `dueAt` | không | `presence-drop.lua` | `presence.sweeper` |
| `typing:{conversationId}:{userId}` | STRING `1` | `TYPING_TTL_MS` | `typing:start` (SET PX), `typing:stop` (DEL) | `conversation:join` snapshot |
| `rl:{rule}:{subject}` | do `rate-limiter-flexible` quản lý (counter) | `windowSec` | mọi request/event | — |
| `session:revoked:{sid}` | STRING `reason` | `ACCESS_TOKEN_TTL_S` | revoke family | `authenticate`, `socket-auth` |
| `call:active:{callId}` | HASH `status, version, callType, conversationId, callerId, callerDeviceId, callerTabId, calleeId, acceptedDeviceId, acceptedTabId, offerRevision, answeredRevision, iceRestarts, createdAt, acceptedAt, connectedAt, endReason` | `CALL_STATE_TTL_S`; terminal → 300 s | Lua invite/transition | mọi handler `call:*` |
| `user:incall:{userId}` | STRING `callId` | `CALL_STATE_TTL_S` | `call-invite.lua`; xóa khi terminal (chỉ khi giá trị = callId) | invite (bận/glare) |
| `call:deadlines` | ZSET member `{callId}:{RING\|CONNECT\|RECONNECT\|PEER:{tabId}}` score `dueAt` (ms) | không | mục 8.3 | `call.sweeper` |
| `call:pending:{calleeId}` | SET `callId` | `CALL_RING_TIMEOUT_MS` | invite khi callee chưa ACK | `session.handler` khi callee kết nối (D-08) |
| `ice:servers:xirsys` | STRING JSON `{iceServers, fetchedAt}` | `ICE_SERVERS_CACHE_TTL_S` | `iceServers.service` | `GET /calls/ice-servers` |
| `e2ee:lowsent:{deviceId}` | STRING `1` | `E2EE_PREKEYS_LOW_NOTIFY_COOLDOWN_S` | khi phát `e2ee:prekeys-low` | trước khi phát |
| `idem:conv:{userId}:{idempotencyKey}` | STRING `conversationId` | 24 h | `POST /conversations` (GROUP) | `POST /conversations` |
| `ops:user-locked` | Kênh Pub/Sub (không phải key), message JSON `{ userId }` | — | `jobs/user-lock.ts` (PUBLISH) | `session.handler` mọi instance (SUBSCRIBE → `disconnectSockets(true)` room `user:{userId}`) |

---

## Phụ lục B — Registry FR ID (cấp phát cho `product_requirements.md`)

`product_requirements.md` phải định nghĩa đầy đủ mô tả, quy tắc và AC cho **đúng** các ID dưới đây (được thêm ID mới, không được đổi nghĩa ID đã cấp).

| FR ID | Chủ đề | Mục kiến trúc liên quan |
|---|---|---|
| FR-AUTH-001 | Đăng ký tài khoản | 7(a), 4.6 |
| FR-AUTH-002 | Đăng nhập (Argon2id, chống dò tài khoản) | 7(a), 9.4 |
| FR-AUTH-003 | Refresh token xoay vòng + phát hiện tái sử dụng + grace đa tab | 7(a), D-19 |
| FR-AUTH-004 | Đăng xuất (thu hồi family, kết thúc cuộc gọi) | 7(a) |
| FR-AUTH-005 | Đổi mật khẩu, thu hồi phiên khác | 7(a) |
| FR-AUTH-006 | Khóa tài khoản, ngắt socket | 7(a) |
| FR-AUTH-007 | Hết hạn phiên socket (`session:expired`) | D-18 |
| FR-USER-001 | Tìm kiếm người dùng | 4.6 |
| FR-USER-002 | Cập nhật hồ sơ | 4.6 |
| FR-USER-003 | Chặn / bỏ chặn | D-21 |
| FR-USER-004 | Quyền riêng tư lastSeen | 7(d) |
| FR-CHAT-001 | Tạo hội thoại DIRECT idempotent | 4.6 |
| FR-CHAT-002 | Gửi tin realtime (idempotent, ACK sau commit, fan-out) | 7(b) |
| FR-CHAT-003 | Lịch sử phân trang cursor | 4.6, D-20 |
| FR-CHAT-004 | Receipt đã gửi/đã nhận/đã đọc (một chiều) | 7(b).1, D-15 |
| FR-CHAT-005 | Typing | 4.5 |
| FR-CHAT-006 | Outbox & retry phía client | 7(b), 7(c) |
| FR-CHAT-007 | Sửa tin (người gửi, 15 phút) | 4.5, D-16 |
| FR-CHAT-008 | Thu hồi tin (người gửi, 15 phút, placeholder "Tin nhắn đã bị thu hồi") | 4.5 |
| FR-CHAT-009 | Danh sách hội thoại + số chưa đọc + preview | 9.2.3 |
| FR-CHAT-010 | Đồng bộ sau reconnect | 7(c) |
| FR-GROUP-001 | Tạo nhóm (người tạo là OWNER) | 4.6 |
| FR-GROUP-002 | Thêm thành viên (giới hạn 100, khử trùng, chặn) | D-21 |
| FR-GROUP-003 | Xóa thành viên | D-09 |
| FR-GROUP-004 | Rời nhóm & chuyển quyền OWNER | D-23 |
| FR-GROUP-005 | Đổi tên nhóm | 4.6 |
| FR-GROUP-006 | Phân quyền ADMIN | 4.6 |
| FR-PRES-001 | Online/offline đa thiết bị | 7(d) |
| FR-PRES-002 | lastSeen | 7(d) |
| FR-PRES-003 | Đăng ký theo dõi presence (lọc quyền) | 4.5 |
| FR-CALL-001 | Voice call 1-1 | 7(e) |
| FR-CALL-002 | Video call 1-1 | 7(e) |
| FR-CALL-003 | Đổ chuông đa thiết bị, nghe ở thiết bị khác | 7(e) |
| FR-CALL-004 | Từ chối / hủy / hết giờ / bận | 8.2 |
| FR-CALL-005 | Glare (gộp lời mời) | 7(g) |
| FR-CALL-006 | Mất mạng, ICE restart, reconnect | 7(f) |
| FR-CALL-007 | TURN credential ngắn hạn | 9.5 |
| FR-CALL-008 | Lịch sử cuộc gọi & SYSTEM message cuộc gọi | 8.2 |
| FR-CALL-009 | Lỗi media & fallback voice | 7(e) |
| FR-CALL-010 | Không hỗ trợ gọi nhóm | D-22 |
| FR-SEC-001 | Mã hóa đường truyền | 9.1 |
| FR-SEC-002 | Mã hóa lưu trữ AES-256-GCM | 9.2 |
| FR-SEC-003 | Xoay khóa dữ liệu | 9.2.4 |
| FR-SEC-004 | Lưu mật khẩu Argon2id | 9.4 |
| FR-SEC-005 | Rate limit | 4.4.1, D-10 |
| FR-SEC-006 | CSRF / CORS / CSP / header | 6.3, 9.6 |
| FR-SEC-007 | Vệ sinh log | 11.3 |
| FR-SEC-008 | Phân quyền mọi điểm vào, chống dò ID | 6.2 |
| FR-E2EE-001 | Đăng ký thiết bị & khóa | 7(h) |
| FR-E2EE-002 | Cấp prekey bundle, tiêu thụ nguyên tử | 7(h) |
| FR-E2EE-003 | Bổ sung prekey (`e2ee:prekeys-low`) | 7(h) |
| FR-E2EE-004 | Gửi/nhận fan-out theo thiết bị | 7(h) |
| FR-E2EE-005 | Safety number | 7(h) |
| FR-E2EE-006 | Cảnh báo đổi identity key | 7(h) |
| FR-E2EE-007 | Thu hồi thiết bị | 7(h) |
| FR-E2EE-008 | Thiết bị mới không đọc lịch sử cũ (thiết kế) | 7(h) |

---

## Phụ lục C — Registry Edge Case ID

Ma trận edge case trong `product_requirements.md` phải chứa **đúng** các ID sau với hành vi đã chốt (được bổ sung ID mới ở cuối mỗi nhóm). Quy ước Test ID: `TC-<NHÓM>-<số>` tương ứng 1-1 với `EC-<NHÓM>-<số>` (ví dụ `EC-CALL-SIG-003` → `TC-CALL-SIG-003`); `TC-AC-<số>` ↔ `AC-<số>` do PRD cấp; `TC-ARCH-<số>` ↔ `AC-ARCH-<số>` (mục 12); `TC-DB-<số>` do `database_schema.md` §7 cấp.

### AUTH

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-AUTH-001 | Đăng ký trùng email/username đồng thời | Unique index; request thua → 409 `CONFLICT` | 7(a) |
| EC-AUTH-002 | Access token hết hạn giữa phiên socket | `session:expired` → disconnect sau 5 s → refresh → reconnect | D-18 |
| EC-AUTH-003 | Refresh đồng thời từ 2 tab | Web Locks + grace 10 s trả 409, không thu hồi | D-19 |
| EC-AUTH-004 | Tái sử dụng refresh token bị đánh cắp | Thu hồi cả family, `session:revoked{REFRESH_REUSE}` | 7(a) |
| EC-AUTH-005 | Tài khoản bị khóa khi đang có socket | Revoke mọi family, ngắt socket, kết thúc cuộc gọi LOGOUT | 7(a) |
| EC-AUTH-006 | Đổi mật khẩu | Thu hồi mọi phiên khác `PASSWORD_CHANGED` | 7(a) |
| EC-AUTH-007 | Logout khi đang gọi | Cuộc gọi ENDED/CANCELLED với `LOGOUT` | 7(a), T11, T27 |
| EC-AUTH-008 | Đổi mật khẩu với `currentPassword` sai / dò mật khẩu qua phiên đã đăng nhập | 422 `VALIDATION_ERROR` `details[{field:'currentPassword',reason:'INVALID'}]`; rate limit `changePassword` 5/15 phút/user → `RATE_LIMITED` | 7(a), 4.4.1 |

### NET

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-NET-001 | Mất mạng đột ngột | reconnecting banner, outbox giữ tin | 7(c) |
| EC-NET-002 | Reconnect liên tục (flapping) | Banner trễ 2 s, sync debounce 500 ms + generation | 7(c) |
| EC-NET-003 | Server restart | Sync đầy đủ, không mất tin đã ACK | 10.3 |
| EC-NET-004 | ACK mất sau khi đã persist | Retry cùng `clientMessageId` → `duplicate:true` | 7(b) |
| EC-NET-005 | Event đến sai thứ tự | Sắp `(createdAt,_id)`, receipt `max`, `call:state.version` | 7(c) |
| EC-NET-006 | Event trùng | Dedupe `eventId` LRU 1000 | 7(c) |
| EC-NET-007 | Reconnect trong lúc đang fetch lịch sử | Generation counter bỏ kết quả cũ | 7(c) |
| EC-NET-008 | Tab nền bị throttle timer | Lease do server gia hạn; flush khi visible/online | 7(c) |
| EC-NET-009 | Máy ngủ/thức dậy | Phát hiện khoảng trống thời gian → reconnect chủ động | 7(c) |
| EC-NET-010 | Proxy chặn WebSocket | Fallback long-polling | 6.4 |

### MSG

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-MSG-001 | Tin rỗng/chỉ khoảng trắng/zero-width | `VALIDATION_ERROR`; client chặn nút gửi | D-17 |
| EC-MSG-002 | Vượt 4000 code point | `VALIDATION_ERROR`; client đếm ký tự | D-17 |
| EC-MSG-003 | Emoji/Unicode tổ hợp/zero-width/RTL | NFC, đếm code point, `dir="auto"` + `unicode-bidi: isolate` | 9.6 |
| EC-MSG-004 | Payload XSS | Lưu nguyên văn, hiển thị text | 9.6 |
| EC-MSG-005 | Giả mạo `senderId` | Schema `.strict()` → `VALIDATION_ERROR`; sender luôn từ token | 4.5 |
| EC-MSG-006 | `clientMessageId` không phải UUID | `VALIDATION_ERROR` | 4.5 |
| EC-MSG-007 | Outbox đầy (200) | Không nhận thêm, thông báo | 7(b) |
| EC-MSG-008 | Receipt đến trước tin nhắn | Giữ pending receipt (500, 60 s) rồi áp khi tin đến | 4.4.1 |
| EC-MSG-009 | Read receipt khi tab không hiển thị | Không gửi read cho tới khi visible + focus + trong viewport | 7(b).1 |
| EC-MSG-010 | Bị xóa khỏi nhóm khi đang gửi dở | Re-check trong txn → `NOT_A_MEMBER`, bubble FAILED | 7(b) |
| EC-MSG-011 | Gửi tới người đã chặn mình | `USER_BLOCKED` (không phân biệt chiều) | D-21 |
| EC-MSG-012 | Lệch đồng hồ giữa thiết bị | Thứ tự & cửa sổ sửa theo giờ server | D-20 |
| EC-MSG-013 | Cuộn lên trong lúc tin mới đến | Không tự cuộn; nút "Tin mới ↓" | (ui_ux_spec) |
| EC-MSG-014 | Cùng hội thoại mở trên nhiều thiết bị | Fan-out tới mọi tab; read ở một nơi xóa badge mọi nơi | 7(b) |
| EC-MSG-015 | Sửa/thu hồi sau 15 phút | `FORBIDDEN` | 4.5 |
| EC-MSG-016 | Payload SECRET có `content` / DIRECT có `ciphertext` | `VALIDATION_ERROR` | 9.3 |
| EC-MSG-017 | Sửa tin trong SECRET | `FORBIDDEN` (D-16) | 4.5 |

### GROUP

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-GROUP-001 | Thêm vượt `GROUP_MAX_MEMBERS` | `CONVERSATION_FULL` (422), không thêm ai | 4.6 |
| EC-GROUP-002 | Danh sách thêm có trùng / đã là thành viên | Khử trùng; người đã là thành viên vào `skipped` | 4.6 |
| EC-GROUP-003 | Thêm người đã chặn mình | Người đó vào `skipped` với lý do `USER_BLOCKED` | D-21 |
| EC-GROUP-004 | OWNER rời nhóm khi chưa chuyển quyền | `CONFLICT` | D-23 |
| EC-GROUP-005 | ADMIN xóa/hạ quyền OWNER | `FORBIDDEN` | D-23 |
| EC-GROUP-006 | Hai admin thao tác cùng lúc | Transaction + update có điều kiện `memberCount` | 10.1 |
| EC-GROUP-007 | Thành viên bị xóa vẫn còn trong socket room | `socketsLeave(conv)` + fan-out theo DB + check mọi handler | D-09 |

### PRES

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-PRES-001 | Nhiều tab | Lease riêng mỗi socket, chỉ phát khi chuyển 0↔1 | 7(d) |
| EC-PRES-002 | Một tab đóng, tab khác còn mở | Vẫn ONLINE | 7(d) |
| EC-PRES-003 | Crash không gửi disconnect | OFFLINE ≤ 60 s (ping timeout / lease) | 7(d) |
| EC-PRES-004 | Ẩn lastSeen | `lastSeenAt: null`, có đi có lại | 7(d) |
| EC-PRES-005 | Redis mất dữ liệu | Tự phục hồi trong ≤ 20 s; Redis down → `degraded` | 7(d) |

### CALL-SIG

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-CALL-SIG-001 | Gọi người đang offline | INITIATED tới 45 s, giao lại khi online, rồi MISSED | D-08 |
| EC-CALL-SIG-002 | Gọi người đang bận | `CALL_BUSY` + `call:busy` cho callee | T02 |
| EC-CALL-SIG-003 | Glare | Gộp thành một cuộc gọi | 7(g) |
| EC-CALL-SIG-004 | Đổ chuông trên nhiều thiết bị | `call:incoming` tới mọi tab callee | 7(e) |
| EC-CALL-SIG-005 | Accept và cancel đến cùng lúc | CAS: cái đến trước thắng; cancel sau accept = HANGUP | T07, T15 |
| EC-CALL-SIG-006 | Accept sau timeout | `CALL_TIMEOUT` | T33 |
| EC-CALL-SIG-007 | Offer đến khi `signalingState` không phù hợp | Guard theo revision | 8.4 |
| EC-CALL-SIG-008 | ICE candidate đến trước remote description | Hàng đợi tối đa 200 | 7(e) |
| EC-CALL-SIG-009 | Candidate trùng | Dedupe theo chuỗi candidate | 7(e) |
| EC-CALL-SIG-010 | Replay signaling của cuộc gọi cũ | `CALL_NOT_FOUND` / revision cũ bị bỏ | T36 |
| EC-CALL-SIG-011 | Người không tham gia gửi signaling | `CALL_NOT_FOUND` (không phải caller/callee) hoặc `FORBIDDEN` (sai tab) | T35 |
| EC-CALL-SIG-012 | Gọi trong hội thoại GROUP | `VALIDATION_ERROR` | D-22 |
| EC-CALL-SIG-013 | Gọi người đã chặn / bị chặn | `USER_BLOCKED` | D-21 |
| EC-CALL-SIG-014 | Spam lời mời tới một người | Rate limit `callInvite` 5/phút → `RATE_LIMITED` | 4.4.1 |
| EC-CALL-SIG-015 | Sự kiện kết thúc trùng lặp | Idempotent, không phát lại | T32 |
| EC-CALL-SIG-016 | Thiết bị thứ hai accept sau thiết bị thứ nhất | `CALL_ALREADY_ANSWERED` | T34 |

### CALL-MEDIA

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-CALL-MEDIA-001 | Không có micro | Không gửi invite / callee `call:end{MEDIA_FAILURE}` | 7(e) |
| EC-CALL-MEDIA-002 | Không có camera → fallback voice | Lấy audio-only, giữ VIDEO, recvonly video | 7(e) |
| EC-CALL-MEDIA-003 | Từ chối quyền (`NotAllowedError`) | Dừng, hướng dẫn cấp quyền | 7(e) |
| EC-CALL-MEDIA-004 | Người dùng đóng prompt quyền | Như NotAllowedError (Chrome) hoặc promise treo → nút "Hủy" luôn khả dụng ở PREPARING_MEDIA | 7(e) |
| EC-CALL-MEDIA-005 | Thiết bị bị app khác dùng (`NotReadableError`) | Video → fallback audio; audio → lỗi | 7(e) |
| EC-CALL-MEDIA-006 | Rút tai nghe/Bluetooth (`devicechange`) | Chọn lại thiết bị mặc định, `replaceTrack` | (ui_ux_spec) |
| EC-CALL-MEDIA-007 | `track.onended` | Thử lấy lại track cùng loại 1 lần, `replaceTrack`; thất bại audio → `call:end{MEDIA_FAILURE}` | 8.2 T16/T22 |
| EC-CALL-MEDIA-008 | Trình duyệt không hỗ trợ WebRTC | Ẩn nút gọi, thông báo | 7(e) |
| EC-CALL-MEDIA-009 | Insecure context | Ẩn nút gọi, thông báo cần HTTPS | 9.1 |
| EC-CALL-MEDIA-010 | Autoplay bị chặn | Nút "Chạm để bật âm thanh" | (ui_ux_spec) |
| EC-CALL-MEDIA-011 | Mobile tắt camera khi chuyển app | `track.muted` → peer hiển thị avatar; khôi phục khi `unmute` | (ui_ux_spec) |
| EC-CALL-MEDIA-012 | Cuộc gọi kết thúc khi `getUserMedia` còn chờ | Stop track muộn | 7(e) |
| EC-CALL-MEDIA-013 | `OverconstrainedError` | Thử lại với constraint tối thiểu, rồi fallback audio | 7(e) |

### CALL-NET

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-CALL-NET-001 | Đổi Wi-Fi sang 4G | ICE restart | 7(f) |
| EC-CALL-NET-002 | `disconnected` thoáng qua so với `failed` | Chờ 3 s với disconnected; failed restart ngay | 8.4 |
| EC-CALL-NET-003 | NAT đối xứng cần TURN | Relay candidate từ Xirsys | 9.5 |
| EC-CALL-NET-004 | UDP bị chặn | TURN over TCP / TLS 443 (`turns:`) | 9.5 |
| EC-CALL-NET-005 | TURN credential hết hạn | Làm mới trước 5 phút, `setConfiguration` trước ICE restart | 9.5 |
| EC-CALL-NET-006 | Xirsys API lỗi | Fallback STUN + coturn | 9.5 |
| EC-CALL-NET-007 | Hai bên hồi phục lệch thời điểm | Báo cáo theo thứ tự server nhận | 7(f) |
| EC-CALL-NET-008 | Một bên đã end, bên kia còn reconnect | Terminal thắng, client dừng restart | 7(f) |
| EC-CALL-NET-009 | Server restart giữa cuộc gọi | Media tiếp tục, reconcile signaling | 8.5 |
| EC-CALL-NET-010 | Hết lượt ICE restart / hết grace | ENDED/NETWORK_FAILURE | T23, T24 |

### INFRA

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-INFRA-001 | MongoDB down | NACK `SERVICE_UNAVAILABLE`, tin giữ trong outbox | 10.1 |
| EC-INFRA-002 | Redis down | Auth fail-closed; còn lại fail-open bộ nhớ; presence degraded | 10.2 |
| EC-INFRA-003 | Transaction bị abort | Retry ≤ 3 | 10.1 |

### SEC

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-SEC-001 | Liệt kê dò `conversationId` | 404 cho người chưa từng là thành viên | 6.2 |
| EC-SEC-002 | Vượt quyền join room | `conversation:join` kiểm AUTHZ-2; room không cấp dữ liệu nhạy cảm | D-09 |
| EC-SEC-003 | Receipt giả mạo | `userId` từ token; chỉ nâng cursor của chính mình | 7(b).1 |
| EC-SEC-004 | CSRF | Double-submit + SameSite=Strict | 6.3 |
| EC-SEC-005 | Brute-force login | 5/phút/IP+email, fail-closed | 4.4.1 |
| EC-SEC-006 | Secret lọt vào bundle | `check-bundle-secrets.mjs` trong build | 9.5 |
| EC-SEC-007 | Log lộ token | pino redact + test | 11.3 |
| EC-SEC-008 | Lời mời gọi spam diện rộng | `callInvite` theo user + metric cảnh báo `hustalo_rate_limited_total{rule="callInvite"}` | 4.4.1 |

### E2EE

| ID | Tình huống | Quyết định chốt | Mục |
|---|---|---|---|
| EC-E2EE-001 | Người nhận chưa đăng ký thiết bị | `E2EE_KEYS_UNAVAILABLE` | 7(h) |
| EC-E2EE-002 | Hết one-time prekey | Bundle không OTPK, vẫn thiết lập được; `e2ee:prekeys-low` | 7(h) |
| EC-E2EE-003 | Identity key thay đổi | Cảnh báo, chặn gửi tới khi xác nhận | 7(h) |
| EC-E2EE-004 | Giải mã thất bại | Placeholder "Không thể giải mã tin nhắn này" | 7(h) |
| EC-E2EE-005 | Tin đến từ thiết bị đã thu hồi | Server chặn `FORBIDDEN`; client bỏ envelope từ device REVOKED | 7(h) |
| EC-E2EE-006 | Người dùng xóa IndexedDB | Sinh khóa mới, đăng ký lại, mất lịch sử SECRET cũ trên device | 7(h) |
| EC-E2EE-007 | Đăng nhập thiết bị mới không đọc lịch sử SECRET cũ | Hành vi thiết kế | 7(h) |
| EC-E2EE-008 | Danh sách thiết bị đổi giữa lúc gửi | `CONFLICT` → tải lại bundle, mã hóa lại | 7(h) |

Tổng: 105 edge case.

---

## Phụ lục D — Biến môi trường bổ sung

Ngoài danh sách biến trong yêu cầu gốc, `development_guide.md` (`.env.example`) phải có thêm:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `METRICS_PORT` | `9464` | Cổng `/metrics` (bind 127.0.0.1) |
| `REDIS_KEY_PREFIX` | `hustalo:` | Tiền tố key Redis |
| `REDIS_URL_TEST` | `redis://:<pass>@localhost:6379/15` | Redis cho integration test |
| `SOCKET_ADAPTER` | `memory` | `memory` \| `redis-streams` (10.4) |
| `TRUST_PROXY` | `1` | Số hop proxy tin cậy |
| `DEV_CALL_RING_TIMEOUT_MS` | (không đặt) | Chỉ có hiệu lực khi `NODE_ENV != production`: thay `CALL_RING_TIMEOUT_MS` cho deadline `RING` khi test tay; production bỏ qua. Client không đọc biến này mà đếm ngược theo `ringExpiresAt` |

Giá trị nhạy cảm (`JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `DATA_ENCRYPTION_KEYS`, `XIRSYS_SECRET`) chỉ sinh bằng `scripts/gen-secrets.mjs`; file này không chứa giá trị thật.

---

## Consistency Check

- [x] **Enum, event, mã lỗi, hằng số khớp mục 2 và 3 của yêu cầu gốc:**
  - Enum `ConversationType, MemberRole, MessageType, MessageClientStatus, CallType, CallStatus, CallEndReason, PresenceStatus` giữ nguyên giá trị (4.4.2); enum bổ sung đều đánh dấu `[NEW]` và là client-only hoặc phụ trợ, không thay thế `CallStatus`.
  - 20 mã lỗi khớp danh sách gốc (4.4.3); ánh xạ HTTP chỉ dùng 400/401/403/404/409/413/422/429/503/500 (và 200 cho `DUPLICATE_MESSAGE` vốn không phải lỗi).
  - 35 event khớp danh sách 3.3 gốc; không có `message:ack`, không có `call:initiate` (4.5). ACK `message:send` qua callback.
  - Mọi hằng số gốc giữ giá trị: `MESSAGE_MAX_LENGTH=4000`, `GROUP_MAX_MEMBERS=100`, `GROUP_TITLE_MAX=100`, `DISPLAY_NAME_MAX=80`, `HISTORY_PAGE_DEFAULT=30`, `HISTORY_PAGE_MAX=100`, access 15m, refresh 30d, presence 60s/20s/10s, typing 5s/3s, call 45s/30s/20s/2 restart, TURN 1h/5', outbox 200/backoff/30s/24h, rate limit 6 rule gốc, Socket.IO 25s/20s/2'.
- [x] **FR/AC được tham chiếu bằng ID:** Registry FR (Phụ lục B) cấp sẵn 56 FR ID cho PRD; AC kiến trúc `AC-ARCH-001..015` (mục 12); AC nghiệp vụ `AC-xxx` do PRD cấp.
- [x] **Edge case có ID:** 105 EC ID ở Phụ lục C phủ đủ 11 nhóm của mục 7 yêu cầu gốc (AUTH, NET, MSG, GROUP, PRES, CALL-SIG, CALL-MEDIA, CALL-NET, INFRA, SEC, E2EE); mỗi EC có quyết định chốt và mục tham chiếu; Test ID theo quy ước `TC-*`.
- [x] **Không có secret thật, không chỗ trống:** ví dụ dùng `<ngắn hạn>`, `tr.example.net`, `<host>`; không có "TODO"/"..." thay nội dung; các điểm chưa chắc chắn về API bên thứ ba đều ghi `// Xác minh với tài liệu chính thức của …` kèm giả định (Socket.IO `skipMiddlewares`/`tryAllTransports`/adapter, Xirsys API, libsignal TS, rate-limiter-flexible, OWASP Argon2).
- [x] **Sửa 8 mâu thuẫn của bản nháp:** (1) cấu trúc server chốt `modules/ realtime/ infra/ http/` (D-01); (2) tên event theo 3.3; (3) một enum `CallStatus` cho state machine/DB/UI (8.1); (4) người tạo nhóm là OWNER; (5) `message:edit/delete` có quy tắc 15 phút, chỉ người gửi, placeholder thu hồi (FR-CHAT-007/008); (6) AES-256-GCM (9.2) và E2EE (7(h), 9.3) đặc tả mức code; (7) không lồng code block; (8) glare, đổ chuông đa thiết bị, chặn người dùng, OWNER rời nhóm, gọi nhóm bị từ chối đều có quyết định (D-03, D-07, D-21, D-22, D-23).
- [x] **Không mâu thuẫn với file đã sinh trước:** đây là file đầu tiên (1/6). Các điểm các file sau phải đối chiếu: cây thư mục 4.1 (`development_guide.md`, `ui_ux_spec.md`), endpoint 4.6 gồm 4 endpoint `[NEW]` (`api_spec.yaml`), payload event 4.5 (`api_spec.yaml` `x-socket-events`), Redis key Phụ lục A và collection list (`database_schema.md`), chuỗi UI 8.6 (`ui_ux_spec.md`), FR/EC registry (`product_requirements.md`), biến môi trường Phụ lục D (`development_guide.md`).
