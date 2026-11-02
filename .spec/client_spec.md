# HUSTALO — Client Specification (làm từ đầu)

| Thuộc tính | Giá trị |
|---|---|
| Version | 1.0.0 |
| Status | Draft — chờ review |
| Ngày | 2026-11-02 |
| Phạm vi | Toàn bộ workspace `client/`: cây thư mục, cấu hình build/test, phân lớp, trách nhiệm từng file, luồng dữ liệu, thứ tự xây dựng từ đầu theo milestone M0–M7, quy ước test, Gate phía client |
| Bản chất | **File tổng hợp.** Không thêm hợp đồng mới. Mọi enum, event, mã lỗi, hằng số, chuỗi UI đều lấy từ 6 file spec gốc. Nếu file này lệch file gốc → **file gốc thắng**, sửa file này. |

**File nguồn:**

| File | Phần dùng cho client |
|---|---|
| `system_architecture.md` | Cây `client/` §4.1, `packages/shared` §4.4, event §4.5, endpoint §4.6, xác thực §6.3, Socket.IO §6.4, luồng 7(a)–7(h), state machine `RTCPeerConnection` §8.4, ánh xạ cuộc gọi → UI §8.6, CSP §9.6 |
| `ui_ux_spec.md` | Design token §1, route + guard §2, màn hình §3, ma trận trạng thái §4, microcopy §5, a11y §6, responsive §7, file client bổ sung §8 |
| `product_requirements.md` | FR, AC (`TC-AC-*`), edge case (`EC-*`), NFR, DoD |
| `development_guide.md` | Script §2.4, `client/.env.example` §4.3, `vite.config.ts` §5.2, Playwright §6.6, milestone §7, ESLint §8.2 |
| `api_spec.yaml` | Hình dạng request/response REST mà `*.api.ts` gọi |
| `database_schema.md` | Trường hiển thị (`deletedAt`, `editedAt`, `system.kind`, cursor receipt) |

**Thuật ngữ:** `Q[key]` = TanStack Query key; `S.x` = Zustand store `stores/x.store.ts`; `E:event` = Socket.IO event; `[NEW]` = file do `ui_ux_spec.md` §8 hoặc `development_guide.md` bổ sung vào cây §4.1; `Mx` = milestone tạo file.

---

## 1. Nguyên tắc bất biến phía client

| # | Quy tắc | Nguồn |
|---|---|---|
| C-01 | Stack cố định: React 18 + Vite + TypeScript strict + Tailwind; Zustand; TanStack Query v5; React Router v6; `socket.io-client` v4. Không thêm framework state/router khác. | Kiến trúc §2 |
| C-02 | Enum, hằng số, `ErrorCode`, tên event, Zod schema **chỉ import từ `@hustalo/shared`**. Client không định nghĩa lại. | CLAUDE.md, AC-ARCH-002 |
| C-03 | Access token **chỉ trong RAM** (`S.auth`). Không ghi token vào `localStorage`/`sessionStorage`/IndexedDB. Refresh token là cookie HttpOnly — JS không đọc được. | Kiến trúc §6.3, ESLint §8.2 |
| C-04 | Cấm `dangerouslySetInnerHTML` (`react/no-danger: error`). Nội dung tin nhắn render dạng text, `dir="auto"` + `unicode-bidi: isolate`, không linkify. | CLAUDE.md, Kiến trúc §9.6, EC-MSG-003/004 |
| C-05 | Không hiển thị chuỗi "Mã hóa đầu-cuối" trước khi M7 đóng; sau M7 chỉ trong conversation `SECRET` đã có session. | CLAUDE.md, AC-122 |
| C-06 | Lịch sử tin nhắn phân trang bằng **cursor** `before`/`after`, không `skip`/offset. | CLAUDE.md, D-20 |
| C-07 | Không log token, nội dung tin nhắn, SDP, ICE candidate (`no-console: error`; log debug chỉ ghi loại sự kiện). | CLAUDE.md, Kiến trúc §11.3 |
| C-08 | Không có biến `VITE_*` mang secret. URL REST/Socket là **tương đối** (cùng origin). | DG §4.3, DG-09, AC-ARCH-011 |
| C-09 | Không inline script trong `index.html` (CSP `script-src 'self'`) → theme đặt bằng `public/theme-init.js`. | Kiến trúc §9.6 |
| C-10 | `client/**` không import `server/**`, `mongoose`, `ioredis`, `node:*` (trừ file config chạy trong Node: `vite.config.ts`, `playwright.config.ts`, `e2e/**`). | DG §8.2 |
| C-11 | Mọi chuỗi UI nằm ở `i18n/vi.ts`; ánh xạ `ErrorCode` → chuỗi ở `i18n/errors.ts`. Component không hard-code chuỗi. | UI §8 |
| C-12 | UI cuộc gọi render theo `S.call.status` (mirror `call:state` có `version` lớn nhất) + `localPhase` + `networkQuality`; không có trạng thái `OUTGOING`. | Kiến trúc §8.4, §8.6 |

---

## 2. Cây thư mục đầy đủ (đích cuối M7)

Cột chú thích: vai trò · milestone tạo file. Unit test `*.test.ts(x)` đặt **cạnh file nguồn** (không liệt kê hết); `src/test/` chỉ chứa setup dùng chung.

```text
client/
├── package.json                      # "@hustalo/client", scripts §3.1                                · M0
├── tsconfig.json                     # extends ../tsconfig.base.json, lib DOM, jsx react-jsx           · M0
├── vite.config.ts                    # HTTP mặc định; HTTPS khi VITE_HTTPS=1; proxy /api, /socket.io  · M0
├── vitest.config.ts                  # jsdom, setupFiles src/test/setup.ts                             · M0
├── tailwind.config.ts                # theme.extend từ ui_ux_spec.md §1.2                              · M0
├── postcss.config.js                 # tailwindcss + autoprefixer                                      · M0
├── playwright.config.ts              # chromium/firefox/webkit, fake media, webServer, E2E_BASE_URL    · M0 (khung) → M1 (đủ §6.6)
├── index.html                        # viewport §7 UI, <script src="/theme-init.js">, không inline JS   · M0
├── .env.example                      # VITE_API_URL, VITE_SOCKET_URL, VITE_HTTPS, E2E_BASE_URL          · M0
├── Dockerfile                        # [NEW] multi-stage: vite build → nginx:alpine non-root           · M6.5
├── public/
│   ├── favicon.svg                                                                                   · M0
│   ├── theme-init.js                 # [NEW] đặt data-theme trước khi React mount                      · M0
│   └── sounds/
│       ├── ringtone.mp3              # nhạc chuông cuộc gọi đến                                        · M5
│       └── ringback.mp3              # âm chờ cuộc gọi đi                                              · M5
├── e2e/
│   ├── fixtures.ts                   # loginAs, twoUsers, mockGetUserMediaError, setIcePolicyRelay, dockerCompose · M1
│   ├── auth.spec.ts                                                                                  · M1
│   ├── group.spec.ts                                                                                 · M2
│   ├── chat.spec.ts                                                                                  · M3
│   ├── presence.spec.ts                                                                              · M4
│   ├── call.spec.ts                                                                                  · M5
│   ├── call-network.spec.ts          # relay-only, offline/online context                              · M5
│   └── e2ee.spec.ts                                                                                  · M7
└── src/
    ├── main.tsx                      # createRoot, import styles/index.css                             · M0
    ├── App.tsx                       # QueryClientProvider, RouterProvider, ThemeProvider, CallOverlay · M0
    ├── vite-env.d.ts                 # khai báo ImportMetaEnv (VITE_API_URL, VITE_SOCKET_URL)          · M0
    ├── styles/
    │   └── index.css                 # @tailwind + CSS variables design tokens (UI §1.1)               · M0
    ├── routes/
    │   ├── router.tsx                # bảng route UI §2 + Routes thứ hai cho /call/:callId              · M0 → M5
    │   ├── NotFoundPage.tsx          # "Không tìm thấy trang" + "Về trang chính"                        · M0
    │   └── guards/
    │       ├── RequireAuth.tsx       # refresh 1 lần khi khởi động; 401 → /login?next=                  · M0
    │       ├── RedirectIfAuthed.tsx  # đã đăng nhập → next hợp lệ hoặc /chats                          · M0
    │       └── safe-next.ts          # chỉ nhận "/..." không bắt đầu "//" (chống open redirect)         · M0
    ├── lib/
    │   ├── api/
    │   │   ├── http.ts               # fetch wrapper: Bearer, X-CSRF-Token, ApiError, refresh 1 lần    · M0
    │   │   ├── refresh.ts            # navigator.locks 'hustalo-refresh' + retry khi 409 (D-19)         · M1
    │   │   └── queryClient.ts        # QueryClient mặc định (retry theo ErrorCode)                      · M0
    │   ├── socket/
    │   │   ├── socket.ts             # io(VITE_SOCKET_URL, opts §6.4), auth {token, deviceId, tabId}   · M1
    │   │   ├── emit.ts               # emitWithAck → envelope {requestId, payload}, SOCKET_ACK_TIMEOUT_MS · M1
    │   │   ├── event-dedupe.ts       # LRU eventId (CLIENT_EVENT_DEDUPE_SIZE)                           · M3
    │   │   └── sync.ts               # sau reconnect: luồng 7(c) bước 1–7                               · M3
    │   ├── outbox/
    │   │   ├── outbox.db.ts          # IndexedDB store "outbox" theo userId                             · M3
    │   │   └── outbox.ts             # enqueue, flush, backoff, FAILED sau OUTBOX_MAX_AGE_MS             · M3
    │   ├── webrtc/
    │   │   ├── support.ts            # isSecureContext, RTCPeerConnection, mediaDevices                · M5
    │   │   ├── media.ts              # acquireMedia(callType) + fallback voice + map DOMException       · M5
    │   │   ├── ice-servers.ts        # GET /calls/ice-servers, cache tới expiresAt - TURN_REFRESH_BEFORE_S · M5
    │   │   ├── candidate-queue.ts    # hàng đợi ICE trước setRemoteDescription, dedupe, lọc revision   · M5
    │   │   └── peer-session.ts       # class PeerSession: pc, offer/answer, ICE restart, getStats      · M5
    │   ├── e2ee/
    │   │   ├── signal-adapter.ts     # cô lập thư viện Signal (D-12, R-04), tải lười                    · M7
    │   │   ├── signal-store.ts       # IndexedDB: identity, prekeys, signed prekeys, sessions, known identities · M7
    │   │   ├── device-keys.ts        # sinh & đăng ký khóa; bổ sung prekey khi e2ee:prekeys-low         · M7
    │   │   ├── envelope.ts           # encryptFanout / decryptForThisDevice                             · M7
    │   │   └── safety-number.ts                                                                      · M7
    │   ├── device/
    │   │   └── device-id.ts          # getDeviceId() localStorage hustalo.deviceId; getTabId() sessionStorage hustalo.tabId · M0
    │   └── time/
    │       ├── server-clock.ts       # lệch giờ từ occurredAt (median 5 mẫu gần nhất)                   · M3
    │       └── format.ts             # định dạng giờ/ngày tiếng Việt, chuỗi lastSeen (UI §5.3)          · M3
    ├── i18n/
    │   ├── vi.ts                     # [NEW] toàn bộ chuỗi UI tiếng Việt                                · M0 (bổ sung dần)
    │   └── errors.ts                 # [NEW] ErrorCode → chuỗi; mã lạ → "Đã có lỗi xảy ra. Vui lòng thử lại." · M0
    ├── stores/
    │   ├── auth.store.ts             # accessToken (RAM), user, expiresAt                               · M0 (khung) → M1
    │   ├── ui.store.ts               # theme, toasts (tối đa 3), banners                                · M0
    │   ├── socket.store.ts           # connecting|connected|reconnecting|offline|expired                · M1
    │   ├── outbox.store.ts           # mirror outbox để render PENDING/FAILED                           · M3
    │   ├── presence.store.ts                                                                         · M4
    │   ├── typing.store.ts                                                                           · M4
    │   └── call.store.ts             # CallStatus (mirror server, theo version) + localPhase + media flags · M5
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.tsx          # khung 1/2 cột theo breakpoint (UI §2, §3.0)                      · M0
    │   │   ├── ConnectionBanner.tsx  # theo S.socket, hiện sau 2 s reconnecting (EC-NET-002)            · M1
    │   │   └── LiveRegions.tsx       # [NEW] vùng aria-live polite/assertive                            · M3
    │   └── ui/
    │       ├── Button.tsx · IconButton.tsx · Avatar.tsx · Modal.tsx · Toast.tsx                       · M0
    │       ├── Banner.tsx · Spinner.tsx · TextField.tsx                                               · M0
    │       ├── PasswordField.tsx     # [NEW]                                                            · M1
    │       ├── SegmentedTabs.tsx     # [NEW]                                                            · M1
    │       └── UnreadBadge.tsx       # [NEW] cap UNREAD_COUNT_CAP → "99+"                               · M3
    ├── features/
    │   ├── auth/
    │   │   ├── LoginPage.tsx · RegisterPage.tsx                                                       · M1
    │   │   ├── AuthCard.tsx          # [NEW]                                                            · M1
    │   │   ├── SessionModal.tsx      # [NEW] session:expired / session:revoked (UI §3.9)                · M1
    │   │   ├── auth.api.ts                                                                           · M1
    │   │   └── useSessionLifecycle.ts# refresh trước exp ACCESS_TOKEN_REFRESH_SKEW_S; xử lý session:*   · M1
    │   ├── conversations/
    │   │   ├── ChatListPane.tsx · ChatListHeader.tsx [NEW] · ConversationList.tsx [NEW]               · M2
    │   │   ├── ConversationListItem.tsx · ConversationSearch.tsx · NewChatDialog.tsx                  · M2
    │   │   ├── conversations.api.ts                                                                  · M2
    │   │   └── useConversationEvents.ts # message:new/status, conversation:* → setQueryData            · M2 → M3
    │   ├── chat/
    │   │   ├── EmptyRoomPlaceholder.tsx # [NEW] "Chọn một cuộc trò chuyện để bắt đầu nhắn tin"          · M0
    │   │   ├── ChatRoomPane.tsx · ChatHeader.tsx · RoomNotFound.tsx [NEW] · SystemMessage.tsx [NEW]   · M2
    │   │   ├── MessageList.tsx · MessageBubble.tsx · MessageStatusIcon.tsx · DateDivider.tsx          · M3
    │   │   ├── NewMessagesButton.tsx · Composer.tsx (CharCounter, EditingBar nội bộ)                  · M3
    │   │   ├── MessageActions.tsx [NEW] · MessageMeta.tsx [NEW] · ReadByIndicator.tsx [NEW]           · M3
    │   │   ├── BlockedComposerNotice.tsx [NEW] · RoomMenu.tsx [NEW]                                   · M3
    │   │   ├── messages.api.ts · useMessages.ts · useSendMessage.ts · useReadReceipts.ts              · M3
    │   │   ├── TypingIndicator.tsx                                                                   · M4
    │   │   └── E2eeBadge.tsx                                                                         · M7
    │   ├── groups/
    │   │   ├── CreateGroupDialog.tsx · MemberManagerDialog.tsx · groups.api.ts                        · M2
    │   │   └── UserPicker.tsx [NEW] · MemberRow.tsx [NEW] · TransferOwnerDialog.tsx [NEW]             · M2
    │   ├── presence/
    │   │   ├── OnlineDot.tsx · usePresence.ts                                                         · M4
    │   ├── calls/
    │   │   ├── CallOverlay.tsx       # route /call/:callId dạng overlay + CallRouteGuard                · M5
    │   │   ├── IncomingCallScreen.tsx · OutgoingCallScreen.tsx · InCallScreen.tsx                     · M5
    │   │   ├── CallControls.tsx · CallEndedNotice.tsx · CallHistoryList.tsx · calls.api.ts            · M5
    │   │   ├── CallTopBar.tsx [NEW] (NetworkQualityBadge nội bộ) · CallStatusText.tsx [NEW]           · M5
    │   │   ├── LocalVideo.tsx [NEW] · RemoteVideo.tsx [NEW] · RemoteAudio.tsx [NEW]                   · M5
    │   │   ├── AutoplayUnlockButton.tsx [NEW] · MediaErrorPanel.tsx [NEW]                             · M5
    │   │   ├── useCallController.ts  # điều phối PeerSession ↔ socket ↔ call.store                      · M5
    │   │   └── useRingtone.ts        # nhạc chuông, autoplay bị chặn → AutoplayUnlockButton             · M5
    │   ├── settings/
    │   │   ├── SettingsPage.tsx · SettingsNav.tsx [NEW] · ProfileSection.tsx · ThemeSection.tsx       · M1
    │   │   ├── BlockedSection.tsx [NEW] · SecuritySection.tsx [NEW] (đổi mật khẩu)                    · M1
    │   │   ├── PrivacySection.tsx                                                                    · M4
    │   │   ├── DevicesSection.tsx · SafetyNumberDialog.tsx                                           · M7
    │   └── e2ee/
    │       ├── useSecretSession.ts · IdentityChangedBanner.tsx                                       · M7
    └── test/
        └── setup.ts                  # @testing-library/jest-dom, fake-indexeddb/auto                   · M0
```

---

## 3. Cấu hình build và công cụ

### 3.1 `package.json`

```json
{
  "name": "@hustalo/client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit -p tsconfig.json && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run",
    "test:e2e": "playwright test"
  }
}
```

Phụ thuộc runtime: `@hustalo/shared` (`*`, workspace), `react`/`react-dom` 18, `react-router-dom` 6, `@tanstack/react-query` 5, `zustand` 5, `socket.io-client` 4.8, `lucide-react` (icon, UI §1.4). M3 thêm `idb` (outbox); M7 thêm thư viện Signal (khóa phiên bản, review mã nguồn — R-04). Phiên bản chính xác khóa trong `package-lock.json` gốc (exact version, `.npmrc` `save-exact`).

Dev: `vite`, `@vitejs/plugin-react`, `tailwindcss` 3, `postcss`, `autoprefixer`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom`, `fake-indexeddb`, `@playwright/test`, `@axe-core/playwright`, `@types/react`, `@types/react-dom`.

### 3.2 `tsconfig.json`

Kế thừa `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); `lib: ["ES2023","DOM","DOM.Iterable"]`, `jsx: "react-jsx"`, `types: ["vite/client"]`, `noEmit: true`; `include`: `src`, `e2e`, các file `*.config.ts`.

### 3.3 Biến môi trường — `client/.env.example`

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `VITE_API_URL` | `/api/v1` | Base REST, tương đối (DG-09) |
| `VITE_SOCKET_URL` | `/` | Origin Socket.IO; `path` cố định `/socket.io` |
| `VITE_HTTPS` | (trống) | `1` → dev server HTTPS bằng `infra/certs` (DG-01). Chỉ `vite.config.ts` đọc |
| `E2E_BASE_URL` | (trống) | Playwright đích; trống = `http://localhost:5173` và tự khởi `webServer` |

### 3.4 `vite.config.ts`

Đúng nguyên văn `development_guide.md` §5.2: `host: true`, `port: 5173`, `strictPort`; HTTPS chỉ khi `command === 'serve' && VITE_HTTPS === '1'` (thiếu chứng chỉ → throw thông báo `npm run certs`); proxy `/api` và `/socket.io` (`ws: true`) → `http://localhost:4000` với `changeOrigin: false`, `xfwd: true`; `preview.port 4173`; `build: { sourcemap: true, target: 'es2022' }`.

### 3.5 `vitest.config.ts`

Tách khỏi `vite.config.ts` (test không cần chứng chỉ): `environment: 'jsdom'`, `include: ['src/**/*.test.{ts,tsx}']`, `setupFiles: ['./src/test/setup.ts']`.

### 3.6 `tailwind.config.ts`, `styles/index.css`, `public/theme-init.js`, `index.html`

- `tailwind.config.ts` và token: **nguyên văn** `ui_ux_spec.md` §1.1–§1.3 (màu qua CSS variables, typography, spacing, radius, shadow, z-index).
- `theme-init.js`: đọc lựa chọn theme (`light|dark|system`) đã lưu, đặt `document.documentElement.dataset.theme` trước khi React mount (UI §1.5).
- `index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`, `<script src="/theme-init.js"></script>`, `<div id="root">`, `<script type="module" src="/src/main.tsx">`. Không có script inline.

### 3.7 `playwright.config.ts`

Nguyên văn `development_guide.md` §6.6: `testDir ./e2e`, `timeout 90s`, `workers 1`, 3 project (chromium fake media, firefox fake media prefs, webkit `grepInvert /@media/`), `webServer` `npm run dev` ở gốc repo khi không có `E2E_BASE_URL`.

---

## 4. Phân lớp và luồng phụ thuộc

```text
 routes/  ──▶ features/* ──▶ components/ui, components/layout
                 │
                 ├──▶ stores/*  (Zustand: trạng thái client-only, realtime ephemeral)
                 ├──▶ *.api.ts ──▶ lib/api/http.ts ──▶ fetch (REST /api/v1)
                 ├──▶ hooks use* ──▶ lib/socket/* ──▶ socket.io-client
                 └──▶ lib/outbox, lib/webrtc, lib/e2ee, lib/time, lib/device
 tất cả ──▶ @hustalo/shared (enum, hằng số, ErrorCode, EVENT, Zod schema, utils/text)
 tất cả ──▶ i18n/vi.ts, i18n/errors.ts
```

| Quy tắc | Chi tiết |
|---|---|
| L-01 | `lib/**` không import `features/**`, `components/**`, `routes/**`. |
| L-02 | `components/ui/**` thuần trình bày: không gọi API, không đọc store (trừ `Toast` đọc `S.ui`). |
| L-03 | Dữ liệu server (danh sách hội thoại, tin nhắn, hồ sơ, lịch sử gọi) ở **TanStack Query**; event realtime cập nhật bằng `queryClient.setQueryData`, không nhân bản vào Zustand. |
| L-04 | Zustand chỉ giữ trạng thái client-only hoặc ephemeral: token, kết nối socket, presence, typing, cuộc gọi, outbox mirror, theme/toast. |
| L-05 | Không vòng import (`import/no-cycle`, AC-ARCH-001). |
| L-06 | Payload socket nhận vào được validate bằng schema `@hustalo/shared` trước khi áp vào cache/store; sai schema → bỏ + log debug (không log nội dung). |

### 4.1 Query key chuẩn (UI §3)

| Query key | Endpoint | Cập nhật realtime |
|---|---|---|
| `['me']` | `GET /auth/me` | — |
| `['conversations']` (infinite) | `GET /conversations` | `message:new`, `message:status`, `message:edit`, `message:delete`, `conversation:updated`, `conversation:member-removed` |
| `['conversation', id]` | `GET /conversations/{id}` | `conversation:updated`, `conversation:member-removed`, `message:status` (GROUP_AGGREGATE) |
| `['messages', id]` (infinite, hai chiều) | `GET /conversations/{id}/messages` | `message:new`, `message:edit`, `message:delete`, `message:status` |
| `['users', 'search', q]` | `GET /users/search` | — (staleTime 30 s) |
| `['calls']` (infinite) | `GET /calls` | invalidate khi `call:state` terminal |
| `['e2ee', 'devices']` | `GET /e2ee/devices` | — |
| `['ice-servers']` | `GET /calls/ice-servers` | — (giữ tới `expiresAt - TURN_REFRESH_BEFORE_S`) |

---

## 5. Đặc tả từng khối

### 5.1 `lib/api`

| File | Hành vi bắt buộc | ID |
|---|---|---|
| `http.ts` | `request<T>(path, opts)`; gắn `Authorization: Bearer` từ `S.auth` (trừ `auth:false`); `X-CSRF-Token` = cookie `hustalo_csrf` khi `csrf:true` (`/auth/refresh`, `/auth/logout`); `credentials: 'same-origin'`; body JSON; lỗi server → `ApiError {status, code: ErrorCode, message, details, requestId}`; lỗi mạng → `NetworkError`; nhận `TOKEN_EXPIRED` → gọi refresher **một lần** rồi gửi lại, thất bại → ném lỗi gốc. Refresher được đăng ký qua `setTokenRefresher` (tránh vòng import). | FR-AUTH-003, FR-SEC-006 |
| `refresh.ts` | `navigator.locks.request('hustalo-refresh', …)` để chỉ 1 tab refresh; `409 CONFLICT` (tab khác vừa xoay) → retry 1 lần; `401` → xóa `S.auth`, về `/login`; thành công → cập nhật `S.auth`, `socket.disconnect().connect()`. Trình duyệt thiếu Web Locks → mutex trong tab. | D-19, AC-ARCH-013/014 |
| `queryClient.ts` | Không retry với `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `NOT_A_MEMBER`, `VALIDATION_ERROR`; retry tối đa 2 với `NetworkError`/`SERVICE_UNAVAILABLE`. | — |

### 5.2 `lib/socket`

| File | Hành vi bắt buộc | ID |
|---|---|---|
| `socket.ts` | `io(VITE_SOCKET_URL, { path: '/socket.io', autoConnect: false, transports: ['websocket','polling'], tryAllTransports: true, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 30000, randomizationFactor: 0.5, auth: cb → {token, deviceId, tabId} })`. `connect_error` `TOKEN_EXPIRED` → refresh rồi connect lại; `UNAUTHENTICATED` → `S.socket = 'expired'`. Gõ kiểu bằng `ClientToServerEvents`/`ServerToClientEvents` từ shared. | Kiến trúc §6.4, EC-NET-010 |
| `emit.ts` | `emitWithAck(event, payload)` bọc envelope `{ requestId: uuid, payload }`, `timeout(SOCKET_ACK_TIMEOUT_MS)`; trả `{ ok: true, data } \| { ok: false, error: {code} }`; timeout → lỗi cục bộ để outbox retry. | Kiến trúc §4.5 |
| `event-dedupe.ts` | LRU `eventId` kích thước `CLIENT_EVENT_DEDUPE_SIZE` (1000); event trùng bị bỏ. | EC-NET-005/006 |
| `sync.ts` | Sau mỗi `connect` (kể cả `recovered=true`), debounce 500 ms: (1) `syncGeneration++`, bỏ kết quả của generation cũ; (2) invalidate `['conversations']`; (3) hội thoại đang mở: `GET …/messages?after=<cursor>&limit=100` lặp tới khi trang < limit, hợp nhất theo `_id`, sắp `(createdAt,_id)`; (4) `message:delivered` cho hội thoại có tin mới; (5) `conversation:join` + `presence:subscribe` lại; (6) có cuộc gọi chưa kết thúc → `call:state`; (7) `outbox.flush()`. Phát hiện ngủ/thức: khoảng tick > `SOCKET_PING_INTERVAL_MS + SOCKET_PING_TIMEOUT_MS` → chủ động reconnect. | FR-CHAT-010, 7(c), EC-NET-002/003/007/009 |

### 5.3 `lib/outbox` + `stores/outbox.store.ts`

- IndexedDB (`idb`) store `outbox` theo `userId`; bản ghi: `clientMessageId` (UUID), `conversationId`, `content`, `createdLocalAt`, `attempts`, `status`.
- `enqueue` → bubble `PENDING` ngay; vượt `CLIENT_OUTBOX_MAX` (200) → từ chối gửi, toast lỗi.
- `flush`: tuần tự theo `createdLocalAt`, **tối đa 1 tin in-flight mỗi hội thoại**; chỉ chạy khi `S.socket = connected`; backoff `OUTBOX_RETRY_BACKOFF_MS` rồi nhân đôi tới `OUTBOX_RETRY_MAX_DELAY_MS`; flush ngay khi `visibilitychange → visible` và `online`.
- ACK ok hoặc `DUPLICATE_MESSAGE` → xóa khỏi outbox, thay bubble bằng tin server (dedupe theo `clientMessageId`). Lỗi không retry được (`VALIDATION_ERROR`, `FORBIDDEN`, `NOT_A_MEMBER`, `USER_BLOCKED`) hoặc tuổi > `OUTBOX_MAX_AGE_MS` → `FAILED` + "Gửi thất bại. Thử lại".
- Đăng xuất / refresh 401: **giữ** outbox theo userId; chỉ gửi lại khi đăng nhập lại cùng user.
- ID: FR-CHAT-002, FR-CHAT-006, EC-NET-008, TC-NET-001..010.

### 5.4 `lib/webrtc`

| File | Hành vi bắt buộc |
|---|---|
| `support.ts` | Kiểm `isSecureContext`, `RTCPeerConnection`, `navigator.mediaDevices.getUserMedia`; thiếu → ẩn/khóa nút gọi với chuỗi UI §4.4. |
| `media.ts` | `acquireMedia(callType)`; VIDEO lỗi camera → fallback voice (FR-CALL-009); map `DOMException.name` (`NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`, `AbortError`, `SecurityError`) → chuỗi `MediaErrorPanel`; lấy lại track khi `readyState === 'ended'` sau khi tab visible (EC-CALL-MEDIA-011). |
| `ice-servers.ts` | `GET /calls/ice-servers`, cache tới `expiresAt - TURN_REFRESH_BEFORE_S`; không log credential. |
| `candidate-queue.ts` | Xếp hàng candidate đến trước `setRemoteDescription` (tối đa `CALL_ICE_QUEUE_MAX`), dedupe, bỏ candidate thuộc `revision` cũ. |
| `peer-session.ts` | Theo §8.4 kiến trúc: theo dõi `connectionState` (dự phòng `iceConnectionState`); `disconnected ≥ ICE_DISCONNECTED_GRACE_MS` hoặc `failed` → ICE restart (≤ `CALL_MAX_ICE_RESTARTS`), hết lượt → `call:end {NETWORK_FAILURE}`; guard `signalingState` (EC-CALL-SIG-007); **callee không bao giờ tự tạo offer** (D-04); `getStats()` mỗi 2 s → `networkQuality` `poor` khi mất gói > 5% hoặc RTT > 400 ms trong 3 mẫu liên tiếp. Hook `window.__hustaloTest` chỉ gắn khi `DEV` hoặc `MODE==='test'`. |

### 5.5 `lib/e2ee` (M7)

`signal-adapter.ts` là điểm duy nhất import thư viện Signal và được **dynamic import** (NFR-05). `signal-store.ts` lưu khóa trong IndexedDB (chung mọi tab cùng device). `device-keys.ts` đăng ký thiết bị, bổ sung `E2EE_ONE_TIME_PREKEY_BATCH` khi nhận `e2ee:prekeys-low`. `envelope.ts`: `encryptFanout` theo từng device người nhận + device khác của chính mình; `decryptForThisDevice` → lỗi hiển thị chuỗi `E2EE_DECRYPT_FAILED`. `safety-number.ts` tính safety number. ID: FR-E2EE-001..008.

### 5.6 `lib/device`, `lib/time`

- `getDeviceId()`: UUID v4 trong `localStorage['hustalo.deviceId']`, dùng chung mọi tab; `getTabId()`: UUID v4 trong `sessionStorage['hustalo.tabId']`, giữ qua reload. Storage lỗi → sinh ID trong RAM.
- `server-clock.ts`: ước lệch giờ = median 5 mẫu `occurredAt - Date.now()`; dùng cho cửa sổ sửa/thu hồi `MESSAGE_EDIT_WINDOW_MS` và đồng hồ cuộc gọi.
- `format.ts`: giờ/ngày tiếng Việt, `DateDivider`, chuỗi lastSeen nguyên văn UI §5.3.

### 5.7 `stores/*`

| Store | State | Ghi chú |
|---|---|---|
| `auth.store` | `accessToken`, `user`, `expiresAt` | Chỉ RAM (C-03) |
| `socket.store` | `connectionState: connecting\|connected\|reconnecting\|offline\|expired` | Nguồn của `ConnectionBanner` |
| `ui.store` | `theme`, `toasts` (tối đa 3, mới nhất trên cùng; thời lượng success 4 s, warning/error 5 s, call 8 s), `banners` | UI §5.2 |
| `outbox.store` | map `clientMessageId → {status, attempts}` | Mirror IndexedDB |
| `presence.store` | `userId → {status, lastSeenAt}` | Subscribe tối đa `PRESENCE_SUBSCRIBE_MAX` |
| `typing.store` | `conversationId → userId[]`, TTL `TYPING_TTL_MS` | Hiển thị tối đa 2 tên (FR-CHAT-005) |
| `call.store` | `callId`, `status: CallStatus`, `version`, `localPhase: CallLocalPhase`, `role`, `callType`, media flags, `networkQuality`, `endReason` | Chỉ áp `call:state` khi `version` lớn hơn |

### 5.8 `routes/`

Bảng route và guard nguyên văn `ui_ux_spec.md` §2:

```text
/                         → Navigate /chats
/login, /register         RedirectIfAuthed → LoginPage / RegisterPage
/chats                    RequireAuth → AppShell [ChatListPane | EmptyRoomPlaceholder]
/chats/:conversationId    RequireAuth → AppShell [ChatListPane | ChatRoomPane]
/call/:callId             RequireAuth → CallOverlay (Routes thứ hai, state.backgroundLocation)
/settings[/:section]      RequireAuth → AppShell [SettingsPage]  (profile|privacy|devices|blocked|theme|security)
*                         → NotFoundPage
```

`conversationId` không khớp `^[a-f0-9]{24}$` hoặc `404` → `RoomNotFound`; `403 NOT_A_MEMBER` → "Bạn không còn là thành viên của cuộc trò chuyện này" (EC-SEC-001). Cuộc gọi đến **không** đổi route — `IncomingCallScreen` là lớp phủ trên mọi route.

### 5.9 `features/*` — trách nhiệm theo màn hình

| Feature | Màn hình (UI §3) | Hành vi chính | FR |
|---|---|---|---|
| `auth` | §3.1, §3.9 | Form đăng nhập/đăng ký validate bằng Zod shared; `useSessionLifecycle` refresh trước exp 60 s, `session:expired` → thử refresh, `session:revoked` → `SessionModal` + về `/login` | FR-AUTH-001..007 |
| `conversations` | §3.2 | Danh sách infinite, preview, sắp xếp, `UnreadBadge`, typing trong preview, tìm kiếm, tạo DIRECT idempotent | FR-CHAT-001, FR-CHAT-009, FR-USER-001 |
| `chat` | §3.3 | Lịch sử cursor hai chiều, bubble + trạng thái 🕒/✓/✓✓/✓✓ xanh/⚠, sửa/thu hồi trong 15 phút, SYSTEM message, read receipt theo visibility + focus + `IntersectionObserver` 0.5, nút "tin mới", composer đếm code point sau NFC+trim (`utils/text` shared, D-17), chặn trong 1-1 | FR-CHAT-002..011, FR-USER-003 |
| `groups` | §3.4 | Tạo nhóm, thêm (≤ `GROUP_ADD_BATCH_MAX`, tổng ≤ `GROUP_MAX_MEMBERS`), xóa, rời, chuyển OWNER, phân ADMIN, đổi tên (≤ `GROUP_TITLE_MAX`) | FR-GROUP-001..006 |
| `presence` | — | `OnlineDot`, `usePresence` subscribe theo danh sách đang hiển thị | FR-PRES-001..003, FR-USER-004 |
| `calls` | §3.5–§3.7 | `useCallController` điều phối invite/accept/reject/cancel/end, đa thiết bị (`call:answered-elsewhere`), glare, ICE restart; nhạc chuông + nhấp nháy tiêu đề; ẩn nút gọi trong GROUP (D-22); chuỗi trạng thái nguyên văn kiến trúc §8.6 | FR-CALL-001..011 |
| `settings` | §3.8 | Hồ sơ, quyền riêng tư lastSeen, danh sách chặn, theme, đổi mật khẩu (`VALIDATION_ERROR` field `currentPassword`), thiết bị E2EE | FR-USER-002..004, FR-AUTH-005, FR-E2EE-007 |
| `e2ee` | §4.5 | `useSecretSession` thiết lập X3DH, `IdentityChangedBanner`, chặn gửi khi identity đổi và đã xác minh | FR-E2EE-001..008 |

Trạng thái UI chi tiết (loading/empty/error/offline/blocked/…) theo **ma trận `ui_ux_spec.md` §4**; microcopy theo §5; a11y (phím tắt, ARIA, focus) theo §6; mobile theo §7.

---

## 6. Lộ trình xây dựng client từ đầu

Mỗi bước: viết test theo AC/EC trước → code → `npm run typecheck && npm run lint && npm test` (+ `npm run test:e2e` nếu Gate có tầng E) → `npm run trace:check -- --milestone Mx`.

| Bước | Milestone | Việc phía client | Test ID phía client tiêu biểu |
|---|---|---|---|
| 1 | M0 | Scaffold Vite + React + TS strict, Tailwind + token, `theme-init.js`, `index.html`, router + guards + `safe-next`, `NotFoundPage`, `AppShell`, `components/ui/*`, `i18n/*`, `lib/api/http.ts` + `queryClient.ts`, `lib/device/device-id.ts`, `stores/auth` (khung) + `ui`, `EmptyRoomPlaceholder`, `test/setup.ts`, `vitest.config.ts`, khung `playwright.config.ts` | `TC-ARCH-001/002` (không trùng định nghĩa, không vòng import), `TC-ARCH-011`, `TC-SEC-006` (bundle không chứa secret) |
| 2 | M1 | `features/auth/*`, `lib/api/refresh.ts`, `lib/socket/socket.ts` + `emit.ts`, `stores/socket` + `auth` đầy đủ, `ConnectionBanner`, `PasswordField`, `SegmentedTabs`, `features/settings` (Profile, Blocked, Security, Theme, Nav), `e2e/fixtures.ts` + `auth.spec.ts`, hoàn thiện `playwright.config.ts` | `TC-AC-001..013`, `TC-AC-018`, `TC-ARCH-013/014`, `TC-AUTH-001..008` (phần UI/E2E) |
| 3 | M2 | `features/conversations/*`, `features/groups/*`, khung `ChatRoomPane`, `RoomNotFound`, `SystemMessage`, `e2e/group.spec.ts` | `TC-AC-017`, `TC-AC-050..059`, `TC-GROUP-001..006`, `TC-SEC-001` |
| 4 | M3 | `features/chat/*` (list, bubble, composer, actions, receipts), `lib/outbox/*`, `stores/outbox`, `lib/socket/event-dedupe.ts` + `sync.ts`, `lib/time/*`, `LiveRegions`, `UnreadBadge`, `e2e/chat.spec.ts` | `TC-AC-020..043`, `TC-MSG-001..015`, `TC-NET-001..010`, `TC-GROUP-007` |
| 5 | M4 | `features/presence/*`, `stores/presence` + `typing`, `TypingIndicator`, typing trong preview, `PrivacySection`, `e2e/presence.spec.ts` | `TC-AC-014/016`, `TC-AC-026/027`, `TC-AC-060..063`, `TC-PRES-001..005` |
| 6 | M5 | `lib/webrtc/*`, `stores/call`, `features/calls/*`, overlay `/call/:callId` trong router, `public/sounds/*`, `e2e/call.spec.ts` + `call-network.spec.ts`; test tay Chrome/Firefox/Safari 17 (DG §6.2) | `TC-AC-070..093`, `TC-CALL-SIG-*`, `TC-CALL-MEDIA-*`, `TC-CALL-NET-*` |
| 7 | M6 | Lighthouse ≥ NFR-05, bundle khởi tạo ≤ 300 KB gzip (code-split route `calls`, `settings`), axe 0 vi phạm serious/critical (NFR-11), chạy lại toàn bộ Gate trên 3 project Playwright | `TC-AC-104/105`, `TC-SEC-006/007` |
| 8 | M6.5 | `client/Dockerfile` (multi-stage, nginx non-root phục vụ `dist`), `E2E_BASE_URL`, tag `@smoke` | `TC-ARCH-016/017` |
| 9 | M7 | `lib/e2ee/*`, `features/e2ee/*`, `E2eeBadge`, `DevicesSection`, `SafetyNumberDialog`, `e2e/e2ee.spec.ts`; **chỉ lúc này** bật chuỗi "Mã hóa đầu-cuối" | `TC-AC-110..122`, `TC-E2EE-001..008`, `TC-MSG-016/017` |

Danh sách Gate đầy đủ (gồm phần server) ở `development_guide.md` §7 — file này không thay thế.

---

## 7. Quy ước test client

| Tầng | Công cụ | Vị trí | Bắt buộc kiểm |
|---|---|---|---|
| U | Vitest + jsdom + Testing Library + `fake-indexeddb` | `*.test.ts(x)` cạnh file nguồn | `http.ts` (Bearer, CSRF, refresh 1 lần, map lỗi), `refresh.ts` (lock, 409), guards + `safe-next`, `device-id`, `i18n/errors` (đủ mọi `ErrorCode`), `emit.ts` (timeout), `event-dedupe`, `sync` (generation), `outbox` (backoff, 1 in-flight/hội thoại, FAILED theo tuổi), `candidate-queue`, `peer-session` (bảng §8.4, guard signaling), `media` (map DOMException), store `call` (bỏ version cũ) |
| E | Playwright + `@axe-core/playwright` | `client/e2e/*.spec.ts` | Tên test bắt đầu bằng Test ID + tag: `test('TC-AC-070 gọi thoại thành công @media', …)`; `@smoke` cho spec chạy trên môi trường deploy |

`trace:check` dò Test ID trong tên test; mỗi AC/EC có thành phần UI phải có ít nhất một test client mang ID đó.

---

## 8. Đối chiếu hiện trạng repo (2026-11-02)

| Hạng mục | Hiện trạng `client/` | Ghi chú |
|---|---|---|
| File M0 | Có: config, `public/favicon.svg`, `theme-init.js`, `App.tsx`, `main.tsx`, router + guards + `safe-next`, `NotFoundPage`, `AppShell`, 8 component `ui/*`, `i18n/*`, `lib/api/http.ts` + `queryClient.ts`, `lib/device/device-id.ts`, `stores/auth` (khung) + `ui`, `EmptyRoomPlaceholder`, `test/setup.ts` | Khớp bước 1 |
| `routes/PagePlaceholder.tsx` | **Thiếu** — `router.tsx` đang import nhưng file không có trong git | Cần thêm (placeholder tạm cho tới M1) hoặc bỏ import, nếu không `typecheck` fail |
| `routes/NotFoundPage.tsx`, `routes/guards/safe-next.ts`, `vite-env.d.ts` | Có trong repo, chưa có trong cây kiến trúc §4.1 | Đề xuất bổ sung vào §4.1 (đã ghi trong cây §2 file này) |
| `devDependencies.ioredis` | Có trong `client/package.json` | Kiến trúc cấm `client/**` dùng `ioredis` (DG §8.2); nếu chỉ dùng cho `e2e/fixtures.ts` cần ghi rõ ngoại lệ trong spec, không thì gỡ |
| M1 → M7 | Chưa có (`features/` chỉ có `chat/EmptyRoomPlaceholder.tsx`; chưa có `e2e/`, `public/sounds/`, `Dockerfile`) | Theo bảng §6 |

---

## Consistency Check

- [x] Không thêm/đổi enum, event, mã lỗi, hằng số; mọi tên lấy từ kiến trúc §4.4–§4.5.
- [x] Cây §2 = kiến trúc §4.1 ∪ file `[NEW]` của `ui_ux_spec.md` §8 ∪ `Dockerfile` M6.5 ∪ 3 file đã có trong repo (`NotFoundPage.tsx`, `safe-next.ts`, `vite-env.d.ts`).
- [x] Gán milestone theo checklist `development_guide.md` §7.
- [x] Cấu hình `vite.config.ts`, `playwright.config.ts`, `.env.example`, `socket.ts` tham chiếu nguyên văn file gốc.
- [x] Các điều cấm của `CLAUDE.md` có mặt ở §1 (C-03, C-04, C-05, C-06, C-07).
- [ ] Chờ duyệt: bổ sung 3 file repo vào kiến trúc §4.1; quyết định về `ioredis` trong `client/package.json`.
