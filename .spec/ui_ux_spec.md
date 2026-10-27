# HUSTALO — UI/UX Specification

| Thuộc tính | Giá trị |
|---|---|
| Version | 1.0.0 |
| Status | Draft — chờ review (file 4/6) |
| Ngày | 2026-10-27 |
| Phụ thuộc | `system_architecture.md` v1.0.0, `product_requirements.md` v1.0.0, `database_schema.md` v1.0.0 |

**File liên quan:**

| File | Quan hệ |
|---|---|
| `system_architecture.md` | Cây thư mục `client/` (§4.1), event (§4.5), luồng cuộc gọi (§7(e)–(g)), ánh xạ `CallStatus` → UI (§8.6, chuỗi dùng nguyên văn ở đây). |
| `product_requirements.md` | FR/AC/EC; cột "Trạng thái UI" của ma trận edge case (§5) là chuỗi chính thức — file này dùng nguyên văn. |
| `database_schema.md` | Nguồn dữ liệu của DTO hiển thị (cursor receipt, `system`, `deletedAt`, `editedAt`). |
| `api_spec.yaml` | Query key TanStack Query ứng với endpoint. |
| `development_guide.md` | Milestone gán màn hình; test E2E Playwright. |

**Thuật ngữ:**

| Thuật ngữ | Nghĩa |
|---|---|
| Pane | Một cột của bố cục 2 cột desktop: `ChatListPane` (trái) và `ChatRoomPane` (phải). |
| Overlay | Lớp phủ toàn màn hình trên route nền (cuộc gọi `/call/:callId`). |
| Toast | Thông báo ngắn tự ẩn ở góc. |
| Banner | Dải thông báo cố định dưới header, tồn tại tới khi điều kiện hết. |
| Modal | Hộp thoại chặn tương tác, cần người dùng xác nhận. |
| Bubble group | Chuỗi tin liên tiếp của cùng người gửi cách nhau ≤ 5 phút, không bị ngắt bởi ngăn ngày hoặc SYSTEM. |
| `t()` | Hàm lấy chuỗi từ `client/src/i18n/vi.ts` (mục 6). |

---

## 1. Design system

### 1.1 Design tokens — màu

Token định nghĩa dạng kênh RGB trong CSS variables để Tailwind dùng được độ trong suốt. Tỷ lệ tương phản tính theo WCAG 2.1 (văn bản thường cần ≥ 4,5:1, thành phần không phải chữ ≥ 3:1).

| Token | Light | Dark | Dùng cho | Tương phản (đo trên nền dùng) |
|---|---|---|---|---|
| `--color-primary` | `0 104 255` (#0068FF) | `76 154 255` (#4C9AFF) | Nút chính, link, ✓✓ đã đọc, focus ring | Light 4,74:1 trên `surface`; Dark 6,3:1 trên `surface` |
| `--color-primary-hover` | `0 86 214` (#0056D6) | `110 174 255` (#6EAEFF) | Hover nút chính | ≥ 4,5:1 |
| `--color-on-primary` | `255 255 255` | `15 23 42` (#0F172A) | Chữ trên nút chính | Light 4,74:1; Dark 6,3:1 |
| `--color-surface` | `255 255 255` | `15 23 42` (#0F172A) | Nền chính, nền phòng chat | — |
| `--color-surface-2` | `247 248 250` (#F7F8FA) | `30 41 59` (#1E293B) | Danh sách chat, header, composer | — |
| `--color-surface-3` | `236 239 243` (#ECEFF3) | `51 65 85` (#334155) | Hover dòng, item được chọn | — |
| `--color-bubble-out` | `0 104 255` (#0068FF) | `29 78 216` (#1D4ED8) | Bubble tin gửi đi | Chữ `on-bubble-out` 4,74:1 / 6,7:1 |
| `--color-on-bubble-out` | `255 255 255` | `255 255 255` | Chữ trong bubble gửi | — |
| `--color-bubble-in` | `241 243 245` (#F1F3F5) | `30 41 59` (#1E293B) | Bubble tin nhận | Chữ `text` 15,6:1 / 14,1:1 |
| `--color-text` | `17 24 39` (#111827) | `241 245 249` (#F1F5F9) | Chữ chính | 17,7:1 / 16,3:1 |
| `--color-text-secondary` | `75 85 99` (#4B5563) | `203 213 225` (#CBD5E1) | Giờ, preview, lastSeen | 7,6:1 / 11,6:1 |
| `--color-border` | `229 231 235` (#E5E7EB) | `51 65 85` (#334155) | Đường phân cách trang trí | (trang trí, không yêu cầu) |
| `--color-border-strong` | `107 114 128` (#6B7280) | `148 163 184` (#94A3B8) | Viền ô nhập, checkbox | 4,8:1 / 6,9:1 (≥ 3:1) |
| `--color-success` | `4 120 87` (#047857) | `52 211 153` (#34D399) | Thông báo thành công | 5,5:1 / 9,3:1 |
| `--color-online` | `22 163 74` (#16A34A) | `74 222 128` (#4ADE80) | Chấm online | 3,2:1 / 10,9:1 (≥ 3:1) |
| `--color-warning` | `180 83 9` (#B45309) | `251 191 36` (#FBBF24) | "Kết nối yếu", cảnh báo identity | 5,0:1 / 10,7:1 |
| `--color-danger` | `220 38 38` (#DC2626) | `248 113 113` (#F87171) | Lỗi, ⚠, nút kết thúc cuộc gọi | 4,8:1 / 6,5:1 |
| `--color-on-danger` | `255 255 255` | `15 23 42` | Chữ/icon trên nền danger | 4,8:1 / 6,5:1 |
| `--color-overlay` | `0 0 0` (dùng alpha 0,6) | `0 0 0` (alpha 0,7) | Nền modal | — |
| `--color-call-bg` | `17 24 39` (#111827) | `2 6 23` (#020617) | Nền màn hình cuộc gọi (luôn tối cả hai theme) | Chữ trắng 17,7:1 |

```css
/* client/src/styles/index.css */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-primary: 0 104 255;
  --color-primary-hover: 0 86 214;
  --color-on-primary: 255 255 255;
  --color-surface: 255 255 255;
  --color-surface-2: 247 248 250;
  --color-surface-3: 236 239 243;
  --color-bubble-out: 0 104 255;
  --color-on-bubble-out: 255 255 255;
  --color-bubble-in: 241 243 245;
  --color-text: 17 24 39;
  --color-text-secondary: 75 85 99;
  --color-border: 229 231 235;
  --color-border-strong: 107 114 128;
  --color-success: 4 120 87;
  --color-online: 22 163 74;
  --color-warning: 180 83 9;
  --color-danger: 220 38 38;
  --color-on-danger: 255 255 255;
  --color-overlay: 0 0 0;
  --color-call-bg: 17 24 39;
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  color-scheme: light;
}

:root[data-theme='dark'] {
  --color-primary: 76 154 255;
  --color-primary-hover: 110 174 255;
  --color-on-primary: 15 23 42;
  --color-surface: 15 23 42;
  --color-surface-2: 30 41 59;
  --color-surface-3: 51 65 85;
  --color-bubble-out: 29 78 216;
  --color-on-bubble-out: 255 255 255;
  --color-bubble-in: 30 41 59;
  --color-text: 241 245 249;
  --color-text-secondary: 203 213 225;
  --color-border: 51 65 85;
  --color-border-strong: 148 163 184;
  --color-success: 52 211 153;
  --color-online: 74 222 128;
  --color-warning: 251 191 36;
  --color-danger: 248 113 113;
  --color-on-danger: 15 23 42;
  --color-overlay: 0 0 0;
  --color-call-bg: 2 6 23;
  color-scheme: dark;
}

html, body, #root { height: 100%; }
body {
  background: rgb(var(--color-surface));
  color: rgb(var(--color-text));
  font-family: theme('fontFamily.sans');
  -webkit-font-smoothing: antialiased;
}
.bubble-text { white-space: pre-wrap; overflow-wrap: anywhere; unicode-bidi: isolate; } /* EC-MSG-003 */
:focus-visible { outline: 2px solid rgb(var(--color-primary)); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

Font Inter tải qua Google Fonts CSS2: API này trả các `@font-face` theo `unicode-range`, trong đó có dải tiếng Việt, nên trình duyệt chỉ tải subset cần dùng. Domain đã có trong CSP của kiến trúc §9.6. `// Xác minh với tài liệu chính thức của Google Fonts: CSS2 API tự phục vụ subset vietnamese theo unicode-range.` Fallback: `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`.

### 1.2 Cấu hình Tailwind

```ts
// client/tailwind.config.ts
import type { Config } from 'tailwindcss';

const c = (v: string) => `rgb(var(--color-${v}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  // Xác minh với tài liệu chính thức của Tailwind CSS: cú pháp darkMode 'selector' (v3.4+); bản cũ dùng ['class', '[data-theme="dark"]'].
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: c('primary'), hover: c('primary-hover'), on: c('on-primary') },
        surface: { DEFAULT: c('surface'), 2: c('surface-2'), 3: c('surface-3') },
        bubble: { out: c('bubble-out'), 'on-out': c('on-bubble-out'), in: c('bubble-in') },
        text: { DEFAULT: c('text'), secondary: c('text-secondary') },
        border: { DEFAULT: c('border'), strong: c('border-strong') },
        success: c('success'),
        online: c('online'),
        warning: c('warning'),
        danger: { DEFAULT: c('danger'), on: c('on-danger') },
        overlay: c('overlay'),
        call: c('call-bg'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['15px', { lineHeight: '22px' }],
        md: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '28px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['24px', { lineHeight: '32px' }],
        '3xl': ['30px', { lineHeight: '36px' }],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '14px', bubble: '18px', pill: '9999px' },
      boxShadow: {
        sm: '0 1px 2px rgb(0 0 0 / 0.06)',
        md: '0 4px 12px rgb(0 0 0 / 0.10)',
        lg: '0 12px 32px rgb(0 0 0 / 0.18)',
        pip: '0 8px 24px rgb(0 0 0 / 0.40)',
      },
      zIndex: {
        base: '0', sticky: '10', dropdown: '30', banner: '40', modal: '50',
        toast: '60', call: '70', incoming: '80', skiplink: '90',
      },
      spacing: { 'safe-t': 'var(--safe-top)', 'safe-b': 'var(--safe-bottom)' },
      screens: { md: '768px', lg: '1024px', xl: '1280px' },
      keyframes: {
        'typing-dot': { '0%,80%,100%': { opacity: '0.3' }, '40%': { opacity: '1' } },
        'ring-pulse': { '0%': { transform: 'scale(1)', opacity: '0.6' }, '100%': { transform: 'scale(1.6)', opacity: '0' } },
      },
      animation: { 'typing-dot': 'typing-dot 1.2s infinite', 'ring-pulse': 'ring-pulse 1.5s ease-out infinite' },
    },
  },
  plugins: [],
} satisfies Config;
```

### 1.3 Typography, spacing, radius, shadow, z-index

| Vai trò | Class | Kích thước / line-height | Weight |
|---|---|---|---|
| Tiêu đề trang (Đăng nhập, Cài đặt) | `text-2xl font-semibold` | 24/32 | 600 |
| Tên trong header phòng chat | `text-md font-semibold` | 16/24 | 600 |
| Tên trong danh sách chat | `text-base font-medium` (chưa đọc: `font-semibold`) | 15/22 | 500/600 |
| Nội dung tin nhắn | `text-base` | 15/22 | 400 |
| Preview, giờ, lastSeen, nhãn phụ | `text-sm text-text-secondary` / `text-xs` | 14/20, 12/16 | 400 |
| Tên trong màn hình cuộc gọi | `text-3xl font-semibold` | 30/36 | 600 |
| Trạng thái cuộc gọi | `text-md` | 16/24 | 400 |

- Spacing: thang Tailwind mặc định (bội số 4 px). Lề ngang khung chat 16 px (`px-4`); khoảng cách giữa bubble cùng nhóm 2 px (`mt-0.5`), giữa nhóm 12 px (`mt-3`).
- Radius: input/nút `rounded-md` (10 px); bubble `rounded-bubble` (18 px), góc phía người gửi của bubble không phải cuối nhóm thu về 6 px; avatar `rounded-pill`.
- Shadow: modal `shadow-lg`; dropdown `shadow-md`; PiP video `shadow-pip`.
- z-index (thứ tự chồng lớp, từ thấp tới cao): nội dung `base` < header/composer dính `sticky` < menu `dropdown` < `ConnectionBanner` `banner` < `Modal` `modal` < `Toast` `toast` < `CallOverlay` `call` < `IncomingCallScreen` `incoming` < skip link `skiplink`. Cuộc gọi đến luôn nằm trên mọi thứ, kể cả modal đang mở.
- Kích thước vùng chạm tối thiểu 44×44 px cho mọi nút trên mobile; nút cuộc gọi 56×56 px (nút kết thúc 64×64 px).

### 1.4 Icon

Dùng `lucide-react`, cỡ mặc định 20 px (`size={20}`), `strokeWidth={2}`, icon trang trí có `aria-hidden="true"`; icon là nội dung duy nhất của nút thì nút phải có `aria-label`.

| Ý nghĩa | Icon lucide |
|---|---|
| Gửi | `SendHorizontal` |
| ✓ đã gửi | `Check` |
| ✓✓ đã nhận / đã đọc | `CheckCheck` (đã đọc: màu `primary`) |
| ⚠ thất bại | `AlertCircle` (màu `danger`) |
| Đang gửi | `Clock` |
| Gọi thoại / video | `Phone` / `Video` |
| Trả lời / từ chối / kết thúc | `Phone` (nền success) / `PhoneOff` (nền danger) / `PhoneOff` |
| Micro bật / tắt | `Mic` / `MicOff` |
| Camera bật / tắt | `Video` / `VideoOff` |
| Đổi camera | `SwitchCamera` |
| Loa ngoài | `Volume2` |
| Mã hóa đầu-cuối | `Lock` |
| Cảnh báo identity | `ShieldAlert` |
| Đã xác minh | `ShieldCheck` |
| Tìm kiếm / tạo chat / tạo nhóm | `Search` / `SquarePen` / `Users` |
| Cài đặt / đăng xuất | `Settings` / `LogOut` |
| Quay lại (mobile) | `ArrowLeft` |
| Tin mới ↓ | `ArrowDown` |
| Thêm thành viên / xóa | `UserPlus` / `UserMinus` |
| Menu tin nhắn | `MoreHorizontal` |
| Chặn | `Ban` |

### 1.5 Chế độ theme

- Ba lựa chọn: `system` (mặc định), `light`, `dark`, lưu `localStorage['hustalo.theme']`.
- `ThemeProvider` (trong `App.tsx`) đặt `document.documentElement.dataset.theme = 'light' | 'dark'`; với `system` lắng nghe `matchMedia('(prefers-color-scheme: dark)')` và cập nhật khi thay đổi.
- Script nhỏ inline trong `index.html` đặt `data-theme` trước khi React render, tránh nhấp nháy. CSP kiến trúc §9.6 cấm inline script, nên đoạn này đặt thành file `client/public/theme-init.js` `[NEW]` và nạp bằng `<script src="/theme-init.js">` đồng bộ trong `<head>`.
- Màn hình cuộc gọi luôn dùng nền `call` tối và chữ trắng ở cả hai theme.
- Cập nhật `<meta name="theme-color">` theo `surface-2` của theme hiện tại.

---

## 2. Route và route guard

```text
/                         → Navigate /chats
/login                    RedirectIfAuthed → LoginPage
/register                 RedirectIfAuthed → RegisterPage
/chats                    RequireAuth → AppShell [ChatListPane | EmptyRoomPlaceholder]
/chats/:conversationId    RequireAuth → AppShell [ChatListPane | ChatRoomPane]
/call/:callId             RequireAuth → CallOverlay (overlay trên route nền)
/settings                 RequireAuth → AppShell [SettingsPage]
/settings/:section        RequireAuth → AppShell [SettingsPage] (section ∈ profile|privacy|devices|blocked|theme|security)
*                         → NotFoundPage "Không tìm thấy trang" + nút "Về trang chính"
```

| Guard | File | Hành vi |
|---|---|---|
| `RequireAuth` | `client/src/routes/guards/RequireAuth.tsx` | Có access token trong `auth.store` → render. Không có → gọi `/auth/refresh` một lần (khởi động app) và hiển thị `Spinner` toàn trang "Đang tải…"; thành công → render; `401` → `Navigate /login?next=<đường dẫn hiện tại>` (chỉ nhận `next` bắt đầu bằng `/` và không bắt đầu bằng `//`, chống open redirect). |
| `RedirectIfAuthed` | `client/src/routes/guards/RedirectIfAuthed.tsx` | Đã đăng nhập → `Navigate` tới `next` hợp lệ hoặc `/chats`. |
| `CallRouteGuard` `[NEW]` | `client/src/features/calls/CallOverlay.tsx` (logic trong component) | `call.store` không có cuộc gọi trùng `callId` → `Navigate /chats` (replace) + toast "Cuộc gọi đã kết thúc". |
| Conversation id | `ChatRoomPane` | `conversationId` không khớp `^[a-f0-9]{24}$` hoặc API trả `404` → `RoomNotFound` "Không tìm thấy cuộc trò chuyện" (EC-SEC-001); `403 NOT_A_MEMBER` → "Bạn không còn là thành viên của cuộc trò chuyện này". |

**Overlay cuộc gọi:** khi bắt đầu/nhận cuộc gọi, `useCallController` gọi `navigate('/call/' + callId, { state: { backgroundLocation: location } })`. `router.tsx` render `<Routes location={state?.backgroundLocation ?? location}>` cho nền và một `<Routes>` thứ hai cho `/call/:callId`. Kết thúc cuộc gọi → `navigate(-1)` nếu có `backgroundLocation`, ngược lại `navigate('/chats', { replace: true })`. Cuộc gọi đến (INITIATED/RINGING phía callee) **không** đổi route: `IncomingCallScreen` render như lớp `incoming` trên mọi route; chỉ khi trả lời mới điều hướng tới `/call/:callId`.

**Bố cục theo breakpoint:**

| Breakpoint | `/chats` | `/chats/:id` | `/settings` |
|---|---|---|---|
| Mobile `< 768px` | Chỉ `ChatListPane` | Chỉ `ChatRoomPane` (nút ← về `/chats`) | Chỉ `SettingsPage` |
| Tablet `768–1023px` | 2 cột: list 320 px + `EmptyRoomPlaceholder` | 2 cột: list 320 px + room | 2 cột: menu cài đặt 280 px + nội dung |
| Desktop `≥ 1024px` | 2 cột: list 360 px + `EmptyRoomPlaceholder` | 2 cột: list 360 px + room | 2 cột: menu cài đặt 280 px + nội dung |

`EmptyRoomPlaceholder` `[NEW]` (`client/src/features/chat/EmptyRoomPlaceholder.tsx`): "Chọn một cuộc trò chuyện để bắt đầu nhắn tin".

---

## 3. Màn hình

Quy ước nguồn dữ liệu: `Q[key]` = TanStack Query key; `S.x` = Zustand store `stores/x.store.ts`; `E:event` = Socket.IO event. Query key chuẩn:

| Query key | Endpoint | Cập nhật realtime |
|---|---|---|
| `['me']` | `GET /auth/me` | — |
| `['conversations']` (infinite) | `GET /conversations` | `E:message:new`, `E:message:status`, `E:message:edit`, `E:message:delete`, `E:conversation:updated`, `E:conversation:member-removed` qua `setQueryData` |
| `['conversation', id]` | `GET /conversations/{id}` | `E:conversation:updated`, `E:conversation:member-removed`, `E:message:status` (GROUP_AGGREGATE) |
| `['messages', id]` (infinite, hai chiều) | `GET /conversations/{id}/messages` | `E:message:new`, `E:message:edit`, `E:message:delete`, `E:message:status` |
| `['users', 'search', q]` | `GET /users/search` | — (staleTime 30 s) |
| `['calls']` (infinite) | `GET /calls` | invalidate khi nhận `E:call:state` terminal |
| `['e2ee', 'devices']` | `GET /e2ee/devices` | — |
| `['ice-servers']` | `GET /calls/ice-servers` | — (giữ tới `expiresAt - TURN_REFRESH_BEFORE_S`) |

### 3.0 Khung ứng dụng (`AppShell`) và `ConnectionBanner`

```text
Desktop ≥1024px
┌──────────────────────────────┬──────────────────────────────────────────────────────┐
│ ChatListPane (360px)         │ ConnectionBanner (khi có)  "Đang kết nối lại…"        │
│                              ├──────────────────────────────────────────────────────┤
│                              │ ChatRoomPane / EmptyRoomPlaceholder / SettingsPage   │
│                              │                                                      │
└──────────────────────────────┴──────────────────────────────────────────────────────┘
Toast: góc dưới phải (desktop), dưới cùng giữa phía trên safe-area (mobile)
```

Cây component:

```text
App.tsx
├── ThemeProvider
├── QueryClientProvider
├── RouterProvider (routes/router.tsx)
│   └── AppShell (components/layout/AppShell.tsx)
│       ├── SkipLink "Bỏ qua tới nội dung chính"
│       ├── ChatListPane | SettingsNav
│       ├── ConnectionBanner (components/layout/ConnectionBanner.tsx)
│       └── <Outlet/> (ChatRoomPane | EmptyRoomPlaceholder | SettingsPage)
├── IncomingCallScreen (features/calls/IncomingCallScreen.tsx) — render khi S.call có cuộc gọi đến
├── ToastViewport (components/ui/Toast.tsx)
├── SessionModal [NEW] (features/auth/SessionModal.tsx) — session:revoked / account locked
└── LiveRegions [NEW] (components/layout/LiveRegions.tsx) — vùng aria-live polite + assertive
```

`ConnectionBanner` đọc `S.socket.connectionState` và `navigator.onLine`:

| `connectionState` | Hiển thị |
|---|---|
| `connecting` (lần đầu, < 2 s) | Không hiển thị |
| `connecting` (≥ 2 s) / `reconnecting` (≥ 2 s) | Banner `warning` "Đang kết nối lại…" + `Spinner` |
| `offline` (`navigator.onLine = false`) | Banner `danger` "Không có kết nối mạng" |
| `expired` | Không hiển thị banner (đang refresh); refresh lỗi → về `/login` |
| `connected` | Ẩn |

### 3.1 Đăng nhập / Đăng ký

```text
Desktop ≥1024px                                      Mobile <768px
┌──────────────────────────────────────────────┐     ┌────────────────────────┐
│                                              │     │  [logo] HUSTALO        │
│            ┌──────────────────────┐          │     │                        │
│            │  [logo] HUSTALO      │          │     │  Đăng nhập             │
│            │  Đăng nhập           │          │     │  Email                 │
│            │  Email               │          │     │  [____________________]│
│            │  [__________________]│          │     │  Mật khẩu              │
│            │  Mật khẩu        [👁]│          │     │  [________________][👁]│
│            │  [__________________]│          │     │  ⚠ lỗi (aria-live)     │
│            │  ⚠ Email hoặc mật    │          │     │  [     Đăng nhập      ]│
│            │    khẩu không đúng   │          │     │                        │
│            │  [    Đăng nhập     ]│          │     │  Chưa có tài khoản?    │
│            │  Chưa có tài khoản?  │          │     │  Đăng ký               │
│            │  Đăng ký             │          │     └────────────────────────┘
│            └──────────────────────┘ (420px)  │
└──────────────────────────────────────────────┘
```

Cây component:

```text
features/auth/LoginPage.tsx
├── AuthCard [NEW] (features/auth/AuthCard.tsx) — logo + tiêu đề + children, max-w 420px
├── TextField (email, autocomplete="email", inputMode="email")
├── PasswordField [NEW] (components/ui/PasswordField.tsx) — TextField + nút hiện/ẩn (aria-label "Hiện mật khẩu"/"Ẩn mật khẩu")
├── FormError (role="alert")
└── Button "Đăng nhập" (type="submit", loading)
features/auth/RegisterPage.tsx
├── AuthCard
├── TextField email | TextField username (tự chuyển chữ thường, gợi ý "3–30 ký tự: a–z, 0–9, dấu chấm, gạch dưới")
├── TextField displayName (đếm ký tự khi còn ≤ 20 / 80)
├── PasswordField password (gợi ý "Ít nhất 8 ký tự, gồm chữ và số") | PasswordField confirm
└── Button "Tạo tài khoản"
```

- **Nguồn dữ liệu:** `POST /auth/login`, `POST /auth/register` (mutation); thành công → `S.auth.setSession(accessToken, expiresAt, user)` → `socket.connect()` → `navigate(next ?? '/chats')`. `deviceId` lấy từ `getDeviceId()`.
- **Validate client** dùng chính Zod schema `auth.schema.ts` của `@hustalo/shared`; lỗi hiển thị dưới từng trường khi blur hoặc khi submit.
- **Tương tác:** Enter trong form = submit; nút submit disabled khi đang gửi; focus vào trường lỗi đầu tiên sau submit thất bại.
- **Trạng thái:**

| Trạng thái | Hiển thị |
|---|---|
| Loading | Nút hiển thị `Spinner` + "Đang đăng nhập…" / "Đang tạo tài khoản…", form `aria-busy="true"` |
| `401 UNAUTHENTICATED` (login) | `FormError` "Email hoặc mật khẩu không đúng" |
| `409 CONFLICT` field email | Lỗi dưới trường email "Email này đã được sử dụng" (EC-AUTH-001) |
| `409 CONFLICT` field username | "Tên người dùng đã tồn tại" |
| `429 RATE_LIMITED` | `FormError` "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau {n} giây." với `n` = `Retry-After`, đếm ngược; nút disabled tới hết (EC-SEC-005) |
| `503 SERVICE_UNAVAILABLE` | `FormError` "Máy chủ đang bận, vui lòng thử lại" |
| Mạng lỗi | `FormError` "Không có kết nối mạng" |

### 3.2 Danh sách chat (`ChatListPane`)

```text
Desktop (cột trái 360px)                         Mobile <768px (toàn màn hình)
┌────────────────────────────────────┐           ┌──────────────────────────────┐
│ [Avatar me]  HUSTALO   [✎] [⚙]     │           │ HUSTALO          [✎] [⚙]     │
│ [🔍 Tìm kiếm                    ]  │           │ [🔍 Tìm kiếm              ]  │
│ ( Trò chuyện | Cuộc gọi )          │           │ ( Trò chuyện | Cuộc gọi )    │
├────────────────────────────────────┤           ├──────────────────────────────┤
│ (●)Bob Trần               10:24    │           │ (●)Bob Trần          10:24   │
│    đang soạn tin…            [3]   │           │    đang soạn tin…       [3]  │
│ ( )Nhóm HUSTALO           Hôm qua  │           │ ( )Nhóm HUSTALO      Hôm qua │
│    Carol: Hẹn mai nhé ✓✓           │           │    Carol: Hẹn mai nhé        │
│ (🔒)Bob Trần              T2       │           │ (🔒)Bob Trần         T2      │
│    Tin nhắn được mã hóa            │           │    Tin nhắn được mã hóa      │
│ ( )Carol Lê              20/10     │           │ (cuộn vô hạn, tải thêm)      │
│    Bạn: Tin nhắn đã bị thu hồi     │           │                              │
│ [Spinner tải thêm]                 │           │                              │
└────────────────────────────────────┘           └──────────────────────────────┘
(●) chấm online xanh ở góc dưới phải avatar; [3] badge chưa đọc; (🔒) icon Lock cạnh tên SECRET
```

Cây component:

```text
features/conversations/ChatListPane.tsx
├── ChatListHeader [NEW] (features/conversations/ChatListHeader.tsx)
│   ├── Avatar (me) → /settings/profile
│   ├── IconButton SquarePen aria-label "Trò chuyện mới" → NewChatDialog
│   └── IconButton Settings aria-label "Cài đặt" → /settings
├── ConversationSearch (features/conversations/ConversationSearch.tsx)
├── SegmentedTabs [NEW] (components/ui/SegmentedTabs.tsx) "Trò chuyện" | "Cuộc gọi" (role="tablist")
├── ConversationList [NEW] (features/conversations/ConversationList.tsx) — role="list", virtual khi > 100 mục
│   └── ConversationListItem (features/conversations/ConversationListItem.tsx) × n
│       ├── Avatar + OnlineDot (features/presence/OnlineDot.tsx)
│       ├── Tên (+ Lock nếu SECRET) | Thời gian
│       └── Preview / TypingPreview | UnreadBadge [NEW] (components/ui/UnreadBadge.tsx)
├── CallHistoryList (features/calls/CallHistoryList.tsx) — tab "Cuộc gọi"
└── NewChatDialog (features/conversations/NewChatDialog.tsx) — tìm user, "Nhắn tin", "Trò chuyện bí mật", "Tạo nhóm"
```

**Nguồn dữ liệu:** `Q['conversations']`, `S.presence` (sau `E:presence:subscribe` cho peer của các mục đang hiển thị, tối đa 200), `S.typing` (`E:typing:update`), `Q['users','search',q]`, `Q['calls']`.

**Quy tắc hiển thị một dòng:**

| Thành phần | Quy tắc |
|---|---|
| Tên | GROUP: `title`; DIRECT/SECRET: `peer.displayName`; SECRET thêm icon `Lock` (aria-label "Trò chuyện bí mật") |
| Thời gian | Cùng ngày: `HH:mm`; hôm qua: "Hôm qua"; trong 7 ngày: "T2"…"T7", "CN"; cùng năm: `DD/MM`; khác năm: `DD/MM/YYYY` |
| Preview | Ưu tiên: đang có người gõ → "đang soạn tin…" (DIRECT/SECRET) hoặc "{tên} đang soạn tin…" / "{A}, {B} đang soạn tin…" / "Nhiều người đang soạn tin…" (GROUP), màu `primary`, nghiêng; ngược lại `lastMessage.preview` (tiền tố "Bạn: " nếu do mình gửi; GROUP thêm "{tên}: " cho người khác); thu hồi → "Tin nhắn đã bị thu hồi"; SECRET → "Tin nhắn được mã hóa"; chưa có tin → "Chưa có tin nhắn" |
| Badge | `unreadCount > 0` → số; `> 99` → "99+"; tên và preview đậm khi có badge |
| Chấm online | DIRECT/SECRET khi `S.presence[peer].status = ONLINE` và không `degraded`; GROUP không có |
| Trạng thái tin cuối của mình | DIRECT: icon `Check`/`CheckCheck` nhỏ trước preview |
| Bị chặn | Nếu `canMessage = false`: preview thay bằng "Không thể gửi tin nhắn tới người này" (người bị chặn) hoặc "Bạn đã chặn người này" (`blockedByMe = true`) |

**Tìm kiếm:** gõ ≥ 2 ký tự (debounce 300 ms) → hiển thị 2 nhóm kết quả "Cuộc trò chuyện" (lọc cục bộ theo tên đã tải, bỏ dấu) và "Người dùng" (`/users/search`). Chọn người dùng → `POST /conversations {type:'DIRECT'}` → điều hướng. Esc xóa ô tìm kiếm.

**Tương tác:** click/Enter mở `/chats/:id`; mục đang mở có nền `surface-3` và `aria-current="page"`; ↑/↓ di chuyển giữa các mục khi focus trong danh sách; cuộn tới cuối → tải trang tiếp (`IntersectionObserver`).

**Trạng thái:**

| Trạng thái | Hiển thị |
|---|---|
| Loading lần đầu | 8 dòng skeleton (avatar tròn + 2 thanh) |
| Empty | Minh họa + "Chưa có cuộc trò chuyện nào" + nút "Bắt đầu trò chuyện" (mở `NewChatDialog`) |
| Lỗi tải | "Không tải được danh sách trò chuyện" + nút "Thử lại" |
| Tìm kiếm không có kết quả | "Không tìm thấy kết quả cho “{q}”" |
| Tab Cuộc gọi empty | "Chưa có cuộc gọi nào" |

**Dòng lịch sử cuộc gọi (`CallHistoryList`):** icon `PhoneIncoming`/`PhoneOutgoing`/`PhoneMissed` (màu `danger` cho MISSED/BUSY phía callee), tên peer, "Cuộc gọi thoại"/"Cuộc gọi video", thời lượng `mm:ss` hoặc nhãn kết cục ("Nhỡ", "Đã từ chối", "Đã hủy", "Bận", "Không thành công"), thời gian; nút gọi lại (`aria-label` "Gọi lại cho {tên}").

### 3.3 Phòng chat (`ChatRoomPane`)

```text
Desktop (cột phải)
┌──────────────────────────────────────────────────────────────────────────┐
│ [Avatar] Bob Trần  🔒 Mã hóa đầu-cuối            [📞] [🎥] [⋯]           │
│          Đang hoạt động                                                  │
├──────────────────────────────────────────────────────────────────────────┤
│ ⚠ Mã an toàn với Bob Trần đã thay đổi            [Xem] [Chấp nhận]       │ ← IdentityChangedBanner (SECRET)
├──────────────────────────────────────────────────────────────────────────┤
│                        ──── Hôm qua ────                                 │
│ (B) ┌───────────────────┐                                                │
│     │ Chào bạn          │                                                │
│     └───────────────────┘                                                │
│     ┌──────────────────────────┐                                         │
│     │ Mai đi cafe không?       │  21:04                                  │
│     └──────────────────────────┘                                         │
│                        ──── Hôm nay ────                                 │
│               alice đã thêm carol  (SYSTEM, giữa, chữ nhỏ)               │
│                                        ┌───────────────────────┐         │
│                                        │ Ok, 9h nhé            │         │
│                                        └───────────────────────┘ ✓✓ 09:12│
│                                        ┌───────────────────────┐         │
│                                        │ Đang gửi…             │ 🕒      │
│                                        └───────────────────────┘         │
│                                        ┌───────────────────────┐         │
│                                        │ Lỗi rồi               │ ⚠ Thử lại│
│                                        └───────────────────────┘         │
│ (B) ● ● ●  (TypingIndicator)                         [ Tin mới ↓ (2) ]   │
├──────────────────────────────────────────────────────────────────────────┤
│ [ Nhập tin nhắn…                                             ] [➤]      │
│                                                         3990/4000       │
└──────────────────────────────────────────────────────────────────────────┘

Mobile <768px
┌──────────────────────────────┐
│ [←] [Av] Bob Trần    [📞][🎥]│
│         Truy cập 5 phút trước│
├──────────────────────────────┤
│        ── Hôm nay ──         │
│ (B)┌──────────────┐          │
│    │ Chào bạn     │          │
│    └──────────────┘          │
│          ┌──────────────┐    │
│          │ Ok, 9h nhé   │✓✓  │
│          └──────────────┘    │
│              [Tin mới ↓ (2)] │
├──────────────────────────────┤
│ [Nhập tin nhắn…        ] [➤] │ ← dính trên bàn phím ảo
└──────────────────────────────┘ + safe-area-bottom
```

Cây component:

```text
features/chat/ChatRoomPane.tsx
├── ChatHeader (features/chat/ChatHeader.tsx)
│   ├── IconButton ArrowLeft (mobile) aria-label "Quay lại danh sách"
│   ├── Avatar + OnlineDot | Tên | dòng phụ: presence/lastSeen (DIRECT/SECRET) hoặc "{n} thành viên" (GROUP)
│   ├── E2eeBadge (features/chat/E2eeBadge.tsx) — chỉ SECRET
│   ├── IconButton Phone aria-label "Gọi thoại cho {tên}" (ẩn với GROUP — D-22)
│   ├── IconButton Video aria-label "Gọi video cho {tên}" (ẩn với GROUP)
│   └── RoomMenu [NEW] (features/chat/RoomMenu.tsx): GROUP: "Quản lý thành viên", "Đổi tên nhóm", "Rời nhóm"; DIRECT: "Chặn"/"Bỏ chặn", "Trò chuyện bí mật"; SECRET: "Xác minh mã an toàn"
├── IdentityChangedBanner (features/e2ee/IdentityChangedBanner.tsx) — chỉ SECRET khi có identity đổi
├── MessageList (features/chat/MessageList.tsx) — role="log", aria-label "Tin nhắn"
│   ├── DateDivider (features/chat/DateDivider.tsx) — "Hôm nay" / "Hôm qua" / "Thứ Hai, 20/10/2026"
│   ├── SystemMessage [NEW] (features/chat/SystemMessage.tsx) — chuỗi FR-CHAT-011
│   ├── MessageBubble (features/chat/MessageBubble.tsx) × n
│   │   ├── nội dung `bubble-text` dir="auto" | placeholder
│   │   ├── MessageMeta [NEW] (features/chat/MessageMeta.tsx) — giờ, "Đã chỉnh sửa"
│   │   ├── MessageStatusIcon (features/chat/MessageStatusIcon.tsx) — chỉ tin của mình, chỉ tin cuối mỗi nhóm
│   │   └── MessageActions [NEW] (features/chat/MessageActions.tsx) — menu "Sao chép", "Sửa", "Thu hồi"
│   ├── ReadByIndicator [NEW] (features/chat/ReadByIndicator.tsx) — GROUP: "Đã xem bởi X/Y" dưới tin cuối của mình
│   ├── TypingIndicator (features/chat/TypingIndicator.tsx)
│   └── NewMessagesButton (features/chat/NewMessagesButton.tsx)
├── Composer (features/chat/Composer.tsx)
│   ├── textarea tự giãn 1–6 dòng, aria-label "Nhập tin nhắn"
│   ├── CharCounter [NEW] (hiện khi còn ≤ 200 ký tự)
│   ├── EditingBar [NEW] — "Đang sửa tin nhắn" + nút "Hủy" (khi sửa)
│   ├── BlockedComposerNotice [NEW] (features/chat/BlockedComposerNotice.tsx) — thay Composer khi canMessage = false
│   └── IconButton SendHorizontal aria-label "Gửi"
└── RoomNotFound [NEW] (features/chat/RoomNotFound.tsx)
```

**Nguồn dữ liệu:** `Q['conversation', id]`, `Q['messages', id]`, `S.outbox` (bubble PENDING/FAILED trộn vào danh sách theo thời gian tạo cục bộ, luôn nằm sau tin đã có `createdAt` server), `S.presence`, `S.typing`; mở phòng: `E:conversation:join` (ACK trả `unreadCount`, `typingUserIds`); rời phòng: `E:conversation:leave`. Gửi: `useSendMessage` → outbox → `E:message:send`. Đọc: `useReadReceipts` → `E:message:read`.

**Gom nhóm bubble:** cùng `senderId`, cách nhau ≤ 5 phút, không có `DateDivider`/SYSTEM ở giữa. Chỉ bubble đầu nhóm của người khác trong GROUP hiển thị tên người gửi (trên bubble, `text-xs font-medium`); avatar người khác chỉ ở bubble cuối nhóm (DIRECT/SECRET và GROUP). Giờ hiển thị ở bubble cuối nhóm; hover/focus bubble bất kỳ hiện giờ của nó (tooltip).

**Ngăn ngày:** theo múi giờ trình duyệt, dựa trên `createdAt` server: "Hôm nay", "Hôm qua", còn lại "Thứ Hai, 20/10/2026" (ngày trong tuần tiếng Việt: "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật").

**Chỉ báo trạng thái (`MessageStatusIcon`, chỉ tin của mình):**

| `MessageClientStatus` | Icon | Màu | `aria-label` |
|---|---|---|---|
| PENDING | `Clock` 14 px | `text-secondary` | "Đang gửi" |
| SENT | `Check` (✓) | `text-secondary` | "Đã gửi" |
| DELIVERED | `CheckCheck` (✓✓) | `text-secondary` | "Đã nhận" |
| READ | `CheckCheck` (✓✓ xanh) | `primary` | "Đã xem" |
| FAILED | `AlertCircle` (⚠) + nút "Thử lại" | `danger` | "Gửi thất bại. Thử lại" |

GROUP: ✓✓ khi mọi thành viên khác đã nhận, ✓✓ xanh khi mọi thành viên khác đã đọc (PRD FR-CHAT-004); thêm `ReadByIndicator` "Đã xem bởi X/Y" dưới tin cuối của mình.

**Nội dung đặc biệt của bubble:**

| Điều kiện | Hiển thị (chữ nghiêng, `text-secondary`) |
|---|---|
| `deletedAt != null` | "Tin nhắn đã bị thu hồi" (icon `Ban` 14 px) |
| TEXT, không thu hồi, `content = null`, DIRECT/GROUP | "Không thể hiển thị nội dung tin nhắn này" |
| SECRET, không có recipient cho device này | "Tin nhắn được gửi trước khi thiết bị này tham gia" (EC-E2EE-006/007) |
| SECRET, giải mã thất bại | "Không thể giải mã tin nhắn này" (EC-E2EE-004) |
| SECRET, từ device REVOKED | "Tin nhắn từ thiết bị đã bị thu hồi" (EC-E2EE-005) |
| `editedAt != null` | Nội dung + nhãn "Đã chỉnh sửa" trong `MessageMeta` |

**Typing (`TypingIndicator`):** 3 chấm `animate-typing-dot` + avatar người gõ; GROUP hiển thị chữ "{tên} đang soạn tin…" / "{A}, {B} đang soạn tin…" / "Nhiều người đang soạn tin…"; tự ẩn sau `TYPING_TTL_MS` (5 s) không có cập nhật. Không đẩy nội dung danh sách khi đang cuộn lên (nằm trong vùng dính cuối danh sách).

**Cuộn và "Tin mới ↓" (EC-MSG-013):**
- Mở phòng: cuộn tới tin chưa đọc đầu tiên nếu có (kèm `DateDivider` đặc biệt "Tin nhắn chưa đọc"), ngược lại cuộn cuối.
- "Ở cuối" = khoảng cách tới đáy ≤ 120 px. Đang ở cuối khi tin mới tới → tự cuộn mượt tới cuối. Không ở cuối → không cuộn, hiển thị `NewMessagesButton` "Tin mới ↓" kèm số tin mới (`aria-label` "Có {n} tin nhắn mới, cuộn xuống"); bấm → cuộn cuối và ẩn nút.
- Cuộn lên gần đỉnh (≤ 200 px) → tải trang `before`, giữ nguyên vị trí nhìn (bù `scrollHeight` chênh lệch).
- Tin do chính mình gửi luôn cuộn tới cuối.

**Composer:**

| Hành vi | Quy tắc |
|---|---|
| Enter | Gửi (khi không đang IME composition `e.nativeEvent.isComposing` — bắt buộc cho bộ gõ tiếng Việt) |
| Shift+Enter | Xuống dòng |
| Esc | Đang sửa → hủy sửa; ngược lại bỏ focus |
| ↑ khi ô trống | Sửa tin cuối của mình nếu còn trong 15 phút (không áp dụng SECRET) |
| Nút Gửi | Disabled khi nội dung sau chuẩn hóa rỗng (EC-MSG-001) hoặc > 4000 code point (EC-MSG-002) |
| Bộ đếm | Hiện khi còn ≤ 200 ký tự: "{n}/4000", vượt → màu `danger` |
| Typing | `typing:start` throttle 3 s khi gõ; `typing:stop` khi gửi, xóa hết hoặc blur |
| Nháp | Lưu `sessionStorage['hustalo.draft.{conversationId}']`, khôi phục khi mở lại |
| Bị chặn | `BlockedComposerNotice`: "Bạn đã chặn người này" + nút "Bỏ chặn" (`blockedByMe`), hoặc "Không thể gửi tin nhắn tới người này" |
| SECRET chưa thiết lập | Gửi được (tin đầu thiết lập session); header hiển thị "Đang thiết lập mã hóa…" |
| SECRET identity đổi và đã xác minh | Composer disabled, placeholder "Hãy xác nhận mã an toàn mới để tiếp tục" |

**Menu tin nhắn (`MessageActions`):** mở bằng hover nút `MoreHorizontal`, chuột phải, nhấn giữ 500 ms (mobile) hoặc phím `Shift+F10`/`ContextMenu` khi bubble focus.
- "Sao chép" (mọi tin có nội dung).
- "Sửa" — tin của mình, TEXT, không SECRET, chưa thu hồi, `now(serverClock) - createdAt < 15 phút`.
- "Thu hồi" — tin của mình, chưa thu hồi, trong 15 phút → modal xác nhận "Thu hồi tin nhắn này với mọi người?" [Hủy] [Thu hồi].
- Quá 15 phút → mục ẩn; nếu server vẫn trả `FORBIDDEN` → toast "Chỉ có thể sửa hoặc thu hồi tin trong 15 phút".

**E2EE (`E2eeBadge`):** SECRET có session với ≥ 1 device của peer → `Lock` + "Mã hóa đầu-cuối" (màu `success`); SECRET chưa có session → `Lock` + "Đang thiết lập mã hóa…" (màu `text-secondary`); DIRECT/GROUP → không hiển thị gì. Chỉ bật từ M7 (CLAUDE.md).

**Trạng thái:**

| Trạng thái | Hiển thị |
|---|---|
| Loading | Header skeleton + 6 bubble skeleton xen kẽ trái/phải |
| Empty (chưa có tin) | Giữa khung: avatar peer + tên + "Hãy gửi lời chào đến {tên}" |
| Lỗi tải trang lịch sử | Dòng trong danh sách "Không tải được tin nhắn" + nút "Thử lại" |
| Đang tải trang cũ | `Spinner` nhỏ ở đỉnh danh sách |
| Hết lịch sử | Ở đỉnh: "Đây là đầu cuộc trò chuyện" |
| Không tìm thấy / không có quyền | `RoomNotFound` (xem mục 2) |
| Bị xóa khỏi nhóm khi đang mở | Modal "Bạn đã bị xóa khỏi nhóm {tên}" [Đóng] → `/chats` (EC-GROUP-007) |

### 3.4 Tạo nhóm và quản lý thành viên

```text
CreateGroupDialog (desktop: modal 480px; mobile: toàn màn hình)
┌────────────────────────────────────────────┐
│ Tạo nhóm                               [✕] │
│ Tên nhóm                                   │
│ [Dự án HUSTALO_________________]  12/100   │
│ Thêm thành viên                            │
│ [🔍 Tìm theo tên, username, email    ]     │
│ [Bob ✕] [Carol ✕]                          │ ← chip đã chọn
│ ( ) Dave Phạm   @dave                      │
│ (✓) Bob Trần    @bob                       │
│ Đã chọn 2 / 99                             │
│                     [Hủy] [Tạo nhóm]       │
└────────────────────────────────────────────┘

MemberManagerDialog
┌────────────────────────────────────────────┐
│ Thành viên (3/100)                     [✕] │
│ [+ Thêm thành viên]                        │ ← chỉ OWNER/ADMIN
│ (A) Alice Nguyễn (Bạn)   Trưởng nhóm       │
│ (B) Bob Trần             Quản trị viên [⋯] │ ← menu theo quyền
│ (C) Carol Lê             Thành viên    [⋯] │
│ ───────────────────────────────────────── │
│ [ Rời nhóm ]  (màu danger)                 │
└────────────────────────────────────────────┘
```

Cây component:

```text
features/groups/CreateGroupDialog.tsx
├── Modal (components/ui/Modal.tsx)
├── TextField title (đếm "{n}/100")
├── UserPicker [NEW] (features/groups/UserPicker.tsx) — dùng Q['users','search',q], chip đã chọn
└── Button "Tạo nhóm"
features/groups/MemberManagerDialog.tsx
├── Modal
├── Button "Thêm thành viên" → UserPicker (chế độ thêm, tối đa min(50, 100 - memberCount))
├── MemberRow [NEW] (features/groups/MemberRow.tsx) × n — Avatar, tên, nhãn vai trò, menu
├── TransferOwnerDialog [NEW] (features/groups/TransferOwnerDialog.tsx)
└── Button "Rời nhóm"
```

- **Nguồn dữ liệu:** `Q['conversation', id]` (members + role), `POST /conversations {type:'GROUP'}` (header `Idempotency-Key` sinh một lần khi mở dialog), `POST /conversations/{id}/members`, `PATCH /conversations/{id}/members/{userId}`, `DELETE /conversations/{id}/members/{userId}`, `PATCH /conversations/{id}`; realtime `E:conversation:updated`, `E:conversation:member-removed`.
- **Nhãn vai trò:** OWNER "Trưởng nhóm", ADMIN "Quản trị viên", MEMBER "Thành viên".
- **Menu theo quyền** (PRD §2 P13–P17): OWNER xem ADMIN: "Gỡ quyền quản trị viên", "Chuyển quyền trưởng nhóm", "Xóa khỏi nhóm"; OWNER xem MEMBER: "Đặt làm quản trị viên", "Chuyển quyền trưởng nhóm", "Xóa khỏi nhóm"; ADMIN xem MEMBER: "Xóa khỏi nhóm"; còn lại không có menu.
- **Xác nhận:** xóa thành viên → modal "Xóa {tên} khỏi nhóm?" [Hủy] [Xóa]; chuyển quyền → "Chuyển quyền trưởng nhóm cho {tên}? Bạn sẽ trở thành quản trị viên." [Hủy] [Chuyển quyền]; rời nhóm → "Rời nhóm {tên nhóm}?" [Hủy] [Rời nhóm].
- **OWNER rời nhóm khi còn thành viên khác** (EC-GROUP-004): không gửi request; mở `TransferOwnerDialog` với tiêu đề "Bạn cần chuyển quyền trưởng nhóm trước khi rời nhóm" và danh sách thành viên để chọn; chọn xong → chuyển quyền rồi rời. Nếu server vẫn trả `409` → toast cùng chuỗi.
- **Kết quả thêm:** `added.length > 0` → toast "Đã thêm {n} thành viên"; có `skipped` mã `CONFLICT` → nối ". {m} người đã có trong nhóm"; mỗi mục `skipped` mã `USER_BLOCKED` hoặc `NOT_FOUND` → toast "Không thể thêm {tên}" (EC-GROUP-002/003). `422 CONVERSATION_FULL` → lỗi trong dialog "Nhóm đã đạt tối đa 100 thành viên" (EC-GROUP-001); UserPicker chặn chọn khi đạt số chỗ còn lại.
- **Trạng thái:** loading danh sách → skeleton 5 dòng; lỗi → "Không tải được danh sách thành viên" + "Thử lại"; `403 FORBIDDEN` → toast "Bạn không có quyền thực hiện thao tác này".

### 3.5 Cuộc gọi đến (`IncomingCallScreen`)

```text
Desktop: lớp toàn màn hình z-incoming, nền call (tối), nội dung giữa   Mobile: toàn màn hình + safe-area
┌──────────────────────────────────────────────────────────┐           ┌──────────────────────────┐
│                                                          │           │                          │
│                     ◯◯◯ (ring-pulse)                     │           │        ◯◯◯               │
│                     [  Avatar 120px  ]                   │           │      [Avatar 96]         │
│                        Bob Trần                          │           │       Bob Trần           │
│                  Cuộc gọi video đến                      │           │   Cuộc gọi video đến     │
│                                                          │           │                          │
│            [ 🔇 Chạm để bật âm thanh ]  (khi autoplay bị chặn)        │ [Chạm để bật âm thanh]   │
│                                                          │           │                          │
│        ( PhoneOff )                      ( Phone )       │           │  (PhoneOff)     (Phone)  │
│         Từ chối                          Trả lời         │           │   Từ chối       Trả lời  │
│                                  ( Mic ) Trả lời bằng âm thanh       │  [Trả lời bằng âm thanh] │
└──────────────────────────────────────────────────────────┘           └──────────────────────────┘
```

Cây component:

```text
features/calls/IncomingCallScreen.tsx (role="alertdialog", aria-modal="true", aria-labelledby, aria-describedby)
├── Avatar (size 120 desktop / 96 mobile) + vòng ring-pulse (tắt khi prefers-reduced-motion)
├── Tên caller | nhãn "Cuộc gọi thoại đến" / "Cuộc gọi video đến"
├── AutoplayUnlockButton [NEW] (features/calls/AutoplayUnlockButton.tsx) — "Chạm để bật âm thanh"
├── IconButton PhoneOff (danger, 64px) aria-label "Từ chối cuộc gọi từ {tên}"
├── IconButton Phone (success, 64px) aria-label "Trả lời cuộc gọi từ {tên}"
└── Button "Trả lời bằng âm thanh" — chỉ khi callType = VIDEO (aria-label "Trả lời chỉ bằng âm thanh")
hook: features/calls/useRingtone.ts — phát /sounds/ringtone.mp3 lặp
```

- **Nguồn dữ liệu:** `E:call:incoming` (ACK `{ ok: true }` ngay khi nhận) → `S.call.incoming = { callId, conversationId, callType, caller, ringExpiresAt }` (thời gian đổ chuông còn lại tính từ `ringExpiresAt` theo `server-clock.ts`, không đọc `CALL_RING_TIMEOUT_MS`; caller dùng `ringExpiresAt` của `call:ringing`); `E:call:state`, `E:call:answered-elsewhere`, `E:call:accepted`.
- **Hiển thị khi đang có cuộc gọi khác ở tab này:** không xảy ra (server trả `CALL_BUSY` cho caller — D-06).
- **Tương tác:**
  - "Trả lời" → `localPhase = PREPARING_MEDIA` (nút chuyển `Spinner`, chữ "Đang chuẩn bị micro/camera…") → `getUserMedia` (fallback theo FR-CALL-009) → `E:call:accept` → điều hướng `/call/:callId` → `InCallScreen`.
  - "Trả lời bằng âm thanh" → `getUserMedia({ audio: true })`, video `recvonly`.
  - "Từ chối" → `E:call:reject` → đóng màn hình.
  - Không có phím tắt chấp nhận/từ chối; Esc không làm gì (tránh vô tình từ chối).
- **Thoát khi:** `call:state` terminal → đóng + toast theo §8.6 kiến trúc ("Cuộc gọi nhỡ từ {tên}" với MISSED/CANCELLED); `call:answered-elsewhere` → đóng + toast "Đã trả lời trên thiết bị khác"; ACK `CALL_ALREADY_ANSWERED` → như trên; ACK `CALL_TIMEOUT` hoặc `CALL_INVALID_STATE` → đóng + toast "Cuộc gọi đã kết thúc", stop track đã lấy (EC-CALL-MEDIA-012).
- **Tab không hiển thị:** tiêu đề tab nhấp nháy luân phiên "📞 Cuộc gọi đến" / "HUSTALO" mỗi 1 s; dừng khi tab visible hoặc cuộc gọi rời INITIATED/RINGING.

### 3.6 Cuộc gọi đi (`OutgoingCallScreen`)

```text
Desktop / Mobile (overlay /call/:callId, nền call)
┌──────────────────────────────────────────────┐
│                                              │
│      [ Video local full màn (VIDEO) hoặc     │
│        Avatar callee 120px (VOICE) ]         │
│                 Bob Trần                     │
│        Đang chuẩn bị micro/camera… |         │
│        Đang gọi… | Đang đổ chuông…           │
│                                              │
│     ( MicOff )   ( VideoOff )   ( PhoneOff ) │
│      Tắt micro    Tắt camera      Hủy        │
└──────────────────────────────────────────────┘
```

Cây component:

```text
features/calls/CallOverlay.tsx (route /call/:callId; khóa cuộn body)
└── OutgoingCallScreen (features/calls/OutgoingCallScreen.tsx)
    ├── LocalVideo [NEW] (features/calls/LocalVideo.tsx) — <video muted playsInline autoPlay>, mirror camera trước
    ├── Avatar + tên callee
    ├── CallStatusText [NEW] (features/calls/CallStatusText.tsx) — aria-live="assertive"
    ├── CallControls (features/calls/CallControls.tsx) — mic, camera (VIDEO), nút "Hủy" (PhoneOff, danger) aria-label "Hủy cuộc gọi"
    └── MediaErrorPanel [NEW] (features/calls/MediaErrorPanel.tsx) — khi getUserMedia lỗi
hook: useRingtone (ringback.mp3 khi RINGING)
```

- **Luồng:** bấm gọi trong `ChatHeader` → kiểm tra hỗ trợ (EC-CALL-MEDIA-008/009, nút đã ẩn nếu thiếu) → mở overlay với `localPhase = PREPARING_MEDIA` ("Đang chuẩn bị micro/camera…"; sau 3 s chưa có kết quả đổi thành "Đang chờ cấp quyền micro/camera…" — EC-CALL-MEDIA-004) → media sẵn sàng → `E:call:invite` → INITIATED "Đang gọi…" → `E:call:ringing` → RINGING "Đang đổ chuông…" + ringback.
- **Nút "Hủy"** luôn bấm được ở mọi pha: PREPARING_MEDIA → hủy promise, stop track muộn, đóng overlay; INITIATED/RINGING → `E:call:cancel`.
- **ACK lỗi `call:invite`:**

| Mã | Hiển thị (`CallEndedNotice`) |
|---|---|
| `CALL_BUSY` | "Người nhận đang bận" |
| `USER_BLOCKED` | "Không thể gọi cho người này" |
| `RATE_LIMITED` | "Bạn thao tác quá nhanh, vui lòng thử lại sau" |
| `SERVICE_UNAVAILABLE` | "Không thể thực hiện cuộc gọi lúc này" |
| `VALIDATION_ERROR` (GROUP) | "Cuộc gọi nhóm chưa được hỗ trợ" |
| `CALL_INVALID_STATE` (đang trong cuộc gọi khác) | "Bạn đang trong một cuộc gọi khác" |

- **Glare** (ACK `merged: true`): chuyển thẳng sang `InCallScreen` "Đang kết nối…" (EC-CALL-SIG-003).

### 3.7 Đang gọi (`InCallScreen`)

```text
Video — Desktop                                                  Video — Mobile
┌──────────────────────────────────────────────────────────┐     ┌──────────────────────────┐
│ Bob Trần · 03:12              [Kết nối yếu]  (warning)   │     │ Bob Trần · 03:12         │
│                                                          │     │                          │
│                 [ Video remote toàn khung ]              │     │   [Video remote          │
│                 (object-fit: contain)                    │     │    object-fit: cover]    │
│     "Đang kết nối lại…" (giữa, nền mờ, khi RECONNECTING) │     │                          │
│                                         ┌──────────────┐ │     │              ┌────────┐  │
│                                         │ PiP local    │ │     │              │PiP 96× │  │
│                                         │ 240×135      │ │     │              │ 128    │  │
│                                         └──────────────┘ │     │              └────────┘  │
│  ( Mic ) ( Video ) ( SwitchCamera ) ( Volume2 ) (PhoneOff)│     │ (Mic)(Video)(Sw)(PhoneOff)│
└──────────────────────────────────────────────────────────┘     └──────────────────────────┘

Voice (cả hai)
┌──────────────────────────────┐
│        [Avatar 120px]        │
│          Bob Trần            │
│     03:12 | Đang kết nối…    │
│ ( Mic ) ( Volume2 ) (PhoneOff)│
└──────────────────────────────┘
```

Cây component:

```text
features/calls/InCallScreen.tsx
├── CallTopBar [NEW] (features/calls/CallTopBar.tsx) — tên, đồng hồ mm:ss (từ connectedAt server), NetworkQualityBadge [NEW]
├── RemoteVideo [NEW] (features/calls/RemoteVideo.tsx) — <video autoPlay playsInline>; không có track video / track muted → Avatar + "Camera đang tạm dừng" (EC-CALL-MEDIA-011)
├── RemoteAudio [NEW] (features/calls/RemoteAudio.tsx) — <audio autoPlay>; play() bị từ chối → AutoplayUnlockButton
├── LocalVideo (PiP, kéo thả được tới 4 góc, mặc định dưới phải; double-click/chạm 2 lần đổi chỗ với remote)
├── CallStatusText — "Đang kết nối…" / "Đang kết nối lại…" (aria-live assertive)
├── CallControls
│   ├── Toggle Mic / MicOff — aria-label "Tắt micro" / "Bật micro", aria-pressed, phím M
│   ├── Toggle Video / VideoOff — chỉ VIDEO; aria-label "Tắt camera" / "Bật camera", phím V
│   ├── IconButton SwitchCamera — chỉ khi ≥ 2 camera; aria-label "Đổi camera"
│   ├── IconButton Volume2 — chỉ khi hỗ trợ setSinkId; aria-label "Chọn loa"
│   └── IconButton PhoneOff (danger 64px) — aria-label "Kết thúc cuộc gọi"
├── DeviceToast — toast "Đã chuyển sang {tên thiết bị}" (EC-CALL-MEDIA-006)
└── CallEndedNotice (features/calls/CallEndedNotice.tsx) — hiển thị 2 s rồi đóng overlay
```

- **Nguồn dữ liệu:** `S.call` (`status` theo `E:call:state` có `version` lớn nhất, `localPhase`, `micEnabled`, `camEnabled`, `networkQuality`), `PeerSession` (`lib/webrtc/peer-session.ts`) cho stream; `E:call:offer/answer/ice-candidate/ice-restart` do `useCallController` xử lý.
- **Đồng hồ:** `mm:ss` (≥ 1 giờ: `h:mm:ss`) tính từ `connectedAt` của `call:state`, cộng bù lệch giờ server.
- **Ẩn điều khiển:** VIDEO trên mobile tự ẩn thanh điều khiển sau 4 s không chạm; chạm màn hình hiện lại. Desktop luôn hiện. Không bao giờ ẩn khi focus nằm trong thanh điều khiển.
- **Kết thúc:** `E:call:end { reason: 'HANGUP' }` → `CallEndedNotice` với chuỗi theo §8.6 kiến trúc → sau 2 s đóng overlay, stop mọi track, `pc.close()`.
- **Wake lock:** cuộc gọi VIDEO gọi `navigator.wakeLock.request('screen')` khi CONNECTED (nếu hỗ trợ), nhả khi kết thúc hoặc tab ẩn.

### 3.8 Cài đặt (`SettingsPage`)

```text
Desktop                                                      Mobile
┌──────────────────────┬─────────────────────────────────┐   ┌───────────────────────────┐
│ Cài đặt              │ Thiết bị                        │   │ [←] Cài đặt               │
│ > Hồ sơ              │ Thiết bị này                    │   │ Hồ sơ                  >  │
│ > Quyền riêng tư     │  Chrome trên Windows · Đang dùng│   │ Quyền riêng tư         >  │
│ > Thiết bị           │  ✓ Sẵn sàng trò chuyện bí mật   │   │ Thiết bị               >  │
│ > Người đã chặn      │ Thiết bị khác                   │   │ Người đã chặn          >  │
│ > Giao diện          │  Safari trên iPhone · 2 ngày    │   │ Giao diện              >  │
│ > Bảo mật            │   trước       [Thu hồi]         │   │ Bảo mật                >  │
│ [Đăng xuất]          │                                 │   │ [Đăng xuất]               │
└──────────────────────┴─────────────────────────────────┘   └───────────────────────────┘
```

Cây component:

```text
features/settings/SettingsPage.tsx
├── SettingsNav [NEW] (features/settings/SettingsNav.tsx) — role="navigation"
├── ProfileSection (features/settings/ProfileSection.tsx) — displayName (đếm /80), avatarUrl, username (chỉ đọc), email (chỉ đọc)
├── PrivacySection (features/settings/PrivacySection.tsx) — Switch "Hiển thị lần truy cập gần nhất" + mô tả "Nếu tắt, bạn cũng sẽ không thấy lần truy cập của người khác."
├── DevicesSection (features/settings/DevicesSection.tsx) — Q['e2ee','devices'], nút "Thu hồi" (DELETE /e2ee/devices/{deviceId})
├── BlockedSection [NEW] (features/settings/BlockedSection.tsx) — từ Q['me'].blockedUserIds, nút "Bỏ chặn"
├── ThemeSection (features/settings/ThemeSection.tsx) — radio "Theo hệ thống" / "Sáng" / "Tối"
├── SecuritySection [NEW] (features/settings/SecuritySection.tsx) — đổi mật khẩu (POST /auth/change-password)
└── SafetyNumberDialog (features/settings/SafetyNumberDialog.tsx) — mở từ RoomMenu của SECRET
```

- **Thiết bị:** mỗi dòng: tên dựng từ `userAgent` ("Chrome trên Windows"), "Đang dùng" cho device hiện tại, trạng thái E2EE ("Sẵn sàng trò chuyện bí mật" / "Đã thu hồi"), thời điểm đăng ký. Thu hồi → modal "Thu hồi thiết bị này? Thiết bị sẽ bị đăng xuất và không đọc được tin nhắn bí mật mới." [Hủy] [Thu hồi]. Device hiện tại không đăng ký được do đủ 5 → banner "Thiết bị này chưa thể dùng trò chuyện bí mật. Hãy thu hồi một thiết bị khác (tối đa 5)." (FR-E2EE-001).
- **Safety number (`SafetyNumberDialog`):** tiêu đề "Xác minh mã an toàn với {tên}"; với mỗi device của peer: 60 chữ số chia 12 nhóm 5 số, font `tabular-nums`, 3 hàng × 4 nhóm; mô tả "So sánh dãy số này với {tên} qua gặp mặt hoặc kênh tin cậy khác. Nếu trùng khớp, cuộc trò chuyện được mã hóa đầu-cuối an toàn."; nút "Đánh dấu đã xác minh" → `ShieldCheck` + "Đã xác minh"; nút "Sao chép".
- **Đổi mật khẩu:** trường "Mật khẩu hiện tại", "Mật khẩu mới", "Nhập lại mật khẩu mới"; `422 VALIDATION_ERROR` với `details[].field = 'currentPassword'` → lỗi inline tại trường "Mật khẩu hiện tại": "Mật khẩu hiện tại không đúng" (không chạy luồng refresh/đăng xuất, EC-AUTH-008); `429` → "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau {n} giây." với `n` = `Retry-After`, nút disabled tới hết; thành công → toast "Đã đổi mật khẩu" + "Các thiết bị khác đã được đăng xuất." (EC-AUTH-006).
- **Đăng xuất:** đang trong cuộc gọi → modal "Đăng xuất sẽ kết thúc cuộc gọi hiện tại. Tiếp tục?" [Hủy] [Đăng xuất] (EC-AUTH-007).
- **Trạng thái:** mỗi section có loading skeleton; lưu → nút "Lưu" loading, thành công toast "Đã lưu thay đổi", lỗi `VALIDATION_ERROR` hiển thị dưới trường.

### 3.9 Hộp thoại phiên (`SessionModal`)

Modal không đóng được bằng Esc/nền; một nút "Đăng nhập lại" → xóa dữ liệu phiên → `/login`.

| Lý do | Văn bản |
|---|---|
| `session:revoked { REFRESH_REUSE }` | "Phiên đăng nhập đã bị thu hồi vì lý do bảo mật. Vui lòng đăng nhập lại." |
| `session:revoked { ACCOUNT_LOCKED }` | "Tài khoản của bạn đã bị khóa." |
| `session:revoked { PASSWORD_CHANGED }` | "Mật khẩu đã được thay đổi. Vui lòng đăng nhập lại." |
| `session:revoked { DEVICE_REVOKED }` | "Thiết bị này đã bị thu hồi. Vui lòng đăng nhập lại." |
| `session:revoked { LOGOUT }` (đăng xuất từ tab khác) | Không modal: chuyển thẳng `/login` |
| Refresh `401` sau `session:expired` | "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." |

---

## 4. Ma trận trạng thái UI

Chuỗi trong cột "Văn bản tiếng Việt chính xác" là khóa `t()` trong `client/src/i18n/vi.ts`; khớp nguyên văn `system_architecture.md` §8.6 và cột "Trạng thái UI" ma trận edge case PRD §5.

### 4.1 Kết nối và phiên

| Trạng thái | Điều kiện kích hoạt | Hiển thị | Hành động khả dụng | Văn bản tiếng Việt chính xác | Thoát khi |
|---|---|---|---|---|---|
| Socket connecting | `socket.connect()` lần đầu sau đăng nhập/tải trang | Không gì trong 2 s đầu; sau 2 s banner `warning` + Spinner | Đọc dữ liệu đã cache; soạn tin (vào outbox) | "Đang kết nối lại…" (chỉ sau 2 s) | Sự kiện `connect` |
| Socket reconnecting | `disconnect` không do người dùng, `navigator.onLine = true` | Banner `warning` + Spinner sau 2 s (EC-NET-002) | Mọi thao tác đọc; gửi tin → PENDING trong outbox; nút gọi disabled với tooltip "Đang kết nối lại…" | "Đang kết nối lại…" | `connect` + sync xong (FR-CHAT-010) |
| Offline | Sự kiện `offline` hoặc `navigator.onLine = false` | Banner `danger` | Như reconnecting | "Không có kết nối mạng" | Sự kiện `online` → chuyển reconnecting |
| Session hết hạn | `E:session:expired` hoặc `connect_error TOKEN_EXPIRED` | Không hiển thị nếu refresh xong trong 2 s; ngược lại banner reconnecting | Như reconnecting | "Đang kết nối lại…" | Refresh thành công + reconnect; refresh `401` → `SessionModal` "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." |
| Session bị thu hồi | `E:session:revoked` (trừ `LOGOUT`) | `SessionModal` (mục 3.9) | Chỉ nút "Đăng nhập lại" | Theo bảng mục 3.9 | Bấm "Đăng nhập lại" |
| Presence không xác định | `presence:snapshot.degraded = true` | Ẩn chấm online và dòng lastSeen | — | (không hiển thị chữ) | Snapshot/update mới với `degraded = false` |
| Máy chủ bận (REST) | REST trả `503` | Toast `danger` | Thử lại thao tác | "Máy chủ đang bận, vui lòng thử lại" | Toast tự ẩn sau 5 s |

### 4.2 Tin nhắn

| Trạng thái | Điều kiện kích hoạt | Hiển thị | Hành động khả dụng | Văn bản tiếng Việt chính xác | Thoát khi |
|---|---|---|---|---|---|
| PENDING | Đã vào outbox, chưa ACK (kể cả đang retry, `SERVICE_UNAVAILABLE`, `RATE_LIMITED`, `CONFLICT` E2EE) | Bubble mờ 70%, icon `Clock` | Sao chép | `aria-label` "Đang gửi" | ACK ok → SENT; lỗi vĩnh viễn hoặc quá 24 h → FAILED |
| SENT | ACK `ok: true` | Icon ✓ | Sao chép, Sửa, Thu hồi (≤ 15 phút) | `aria-label` "Đã gửi" | `message:status DELIVERED/READ` |
| DELIVERED | `message:status DELIVERED` | Icon ✓✓ xám | Như SENT | `aria-label` "Đã nhận" | `message:status READ` |
| READ | `message:status READ` | Icon ✓✓ màu `primary` | Như SENT | `aria-label` "Đã xem" | — (không hạ cấp) |
| FAILED (chung) | `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, quá `OUTBOX_MAX_AGE_MS` | Icon ⚠ `danger` + nút | "Thử lại" (cùng `clientMessageId`), "Xóa" | "Gửi thất bại. Thử lại" | Thử lại thành công hoặc xóa |
| FAILED — không còn là thành viên | ACK `NOT_A_MEMBER` | ⚠ + chú thích dưới bubble | "Xóa" | "Bạn không còn là thành viên của nhóm này" | Xóa |
| FAILED — bị chặn | ACK `USER_BLOCKED` | ⚠ + `BlockedComposerNotice` thay composer | "Xóa" | "Không thể gửi tin nhắn tới người này" | Bỏ chặn (nếu `blockedByMe`) |
| Outbox đầy | Outbox có 200 tin | Toast `warning`, tin mới không được thêm, nội dung giữ trong ô nhập | Chờ | "Hàng đợi gửi đã đầy. Vui lòng chờ kết nối lại." | Outbox < 200 |
| Đang sửa | Chọn "Sửa" | `EditingBar` trên composer, bubble gốc viền `primary` | "Hủy", Enter lưu | "Đang sửa tin nhắn" | Lưu xong / "Hủy" / Esc |
| Đã chỉnh sửa | `editedAt != null` | Nhãn trong meta | — | "Đã chỉnh sửa" | — |
| Đã thu hồi | `deletedAt != null` | Placeholder nghiêng | — | "Tin nhắn đã bị thu hồi" | — |
| Hết hạn sửa/thu hồi | ACK `FORBIDDEN` khi sửa/thu hồi | Toast | — | "Chỉ có thể sửa hoặc thu hồi tin trong 15 phút" | Tự ẩn 5 s |
| Tin mới khi cuộn lên | `message:new` khi không ở cuối danh sách | `NewMessagesButton` kèm số | Bấm → cuộn cuối | "Tin mới ↓" | Cuộn tới cuối |
| Typing | `typing:update isTyping:true` | 3 chấm (+ tên trong GROUP) | — | "đang soạn tin…" / "{tên} đang soạn tin…" / "{A}, {B} đang soạn tin…" / "Nhiều người đang soạn tin…" | `isTyping:false` / 5 s không cập nhật / tin mới từ người đó |
| Gần giới hạn độ dài | Còn ≤ 200 code point | Bộ đếm (vượt: `danger`, nút Gửi disabled) | Sửa nội dung | "{n}/4000" | Còn > 200 |
| Không hiển thị được nội dung | DTO `content = null`, không thu hồi | Placeholder | — | "Không thể hiển thị nội dung tin nhắn này" | — |

### 4.3 Cuộc gọi

| Trạng thái | Điều kiện kích hoạt | Hiển thị | Hành động khả dụng | Văn bản tiếng Việt chính xác | Thoát khi |
|---|---|---|---|---|---|
| Chuẩn bị media (đi) | `localPhase = PREPARING_MEDIA` | `OutgoingCallScreen` + Spinner | "Hủy" | "Đang chuẩn bị micro/camera…" | Media sẵn sàng → gửi invite; lỗi → lỗi media (4.4) |
| Chờ cấp quyền | PREPARING_MEDIA quá 3 s | Như trên | "Hủy" | "Đang chờ cấp quyền micro/camera…" | Như trên |
| Đi — INITIATED | ACK `call:invite` status INITIATED | Avatar/LocalVideo + trạng thái | Mic, Camera, "Hủy" | "Đang gọi…" | `call:ringing` / `call:accepted` / `call:state` terminal |
| Đi — RINGING | `call:ringing` | Như trên + ringback | Như trên | "Đang đổ chuông…" | `call:accepted` / terminal |
| Đến — ringing | `call:incoming`, status INITIATED/RINGING | `IncomingCallScreen` + nhạc chuông | "Trả lời", "Trả lời bằng âm thanh" (VIDEO), "Từ chối" | "Cuộc gọi thoại đến" / "Cuộc gọi video đến" | Trả lời / từ chối / terminal / `call:answered-elsewhere` |
| Connecting | Status ACCEPTED hoặc CONNECTING | `InCallScreen` với trạng thái giữa màn | Mic, Camera, Kết thúc | "Đang kết nối…" | CONNECTED / FAILED |
| Connected | Status CONNECTED | Đồng hồ `mm:ss`, video | Mic, Camera, Đổi camera, Loa, Kết thúc | (đồng hồ `mm:ss`) | RECONNECTING / terminal |
| Poor network | CONNECTED + `networkQuality = 'poor'` (§8.4 kiến trúc) | Badge `warning` ở `CallTopBar` | Như connected | "Kết nối yếu" | 3 mẫu liên tiếp tốt |
| Reconnecting | Status RECONNECTING | Lớp mờ trên video + Spinner; đồng hồ tiếp tục | Mic, Camera, Kết thúc | "Đang kết nối lại…" | CONNECTED / ENDED |
| Kết thúc — HANGUP | ENDED/HANGUP | `CallEndedNotice` 2 s | — | "Cuộc gọi đã kết thúc" | Tự đóng 2 s |
| Kết thúc — mất mạng | ENDED hoặc FAILED / NETWORK_FAILURE | `CallEndedNotice` + nút "Gọi lại" | "Gọi lại" | "Cuộc gọi bị gián đoạn do mất kết nối" | Tự đóng 4 s hoặc bấm |
| Kết thúc — lỗi thiết bị | ENDED hoặc FAILED / MEDIA_FAILURE | `CallEndedNotice` | — | "Cuộc gọi kết thúc do lỗi thiết bị âm thanh/hình ảnh" | Tự đóng 4 s |
| Kết thúc — người kia mất kết nối | ENDED hoặc FAILED / PEER_DISCONNECTED | `CallEndedNotice` | "Gọi lại" | "Người kia đã mất kết nối" | Tự đóng 4 s |
| Kết thúc — sự cố máy chủ | ENDED hoặc FAILED / SERVER_RESTART | `CallEndedNotice` | "Gọi lại" | "Cuộc gọi đã kết thúc do sự cố máy chủ" | Tự đóng 4 s |
| Kết thúc — đăng xuất | ENDED, CANCELLED, FAILED / LOGOUT | `CallEndedNotice` | — | "Cuộc gọi đã kết thúc" | Tự đóng 2 s |
| Bị từ chối (caller) | REJECTED | `CallEndedNotice` | — | "Người nhận đã từ chối cuộc gọi" | Tự đóng 3 s |
| Không trả lời (caller) | MISSED | `CallEndedNotice` + "Gọi lại" | "Gọi lại" | "Không có người trả lời" | Tự đóng 4 s |
| Nhỡ (callee) | MISSED, hoặc CANCELLED (kể cả PEER_DISCONNECTED) phía callee | Đóng `IncomingCallScreen`, toast | Bấm toast → mở hội thoại | "Cuộc gọi nhỡ từ {tên}" | Toast tự ẩn 8 s |
| Bận (caller) | ACK `CALL_BUSY` | `CallEndedNotice` | — | "Người nhận đang bận" | Tự đóng 3 s |
| Có người gọi khi bận (callee) | `call:busy` | Toast (không ngắt cuộc gọi hiện tại) | — | "{tên} vừa gọi cho bạn" | Tự ẩn 8 s |
| Trả lời ở thiết bị khác | `call:answered-elsewhere` hoặc ACK `CALL_ALREADY_ANSWERED` | Đóng `IncomingCallScreen`, toast | — | "Đã trả lời trên thiết bị khác" | Tự ẩn 5 s |
| Trả lời quá muộn | ACK `CALL_TIMEOUT` / `CALL_INVALID_STATE` khi accept | Đóng màn hình, toast | — | "Cuộc gọi đã kết thúc" | Tự ẩn 5 s |
| Không gọi được (chặn) | ACK `USER_BLOCKED`; hoặc `canMessage = false` | Nút gọi disabled (tooltip) / `CallEndedNotice` | — | "Không thể gọi cho người này" | — |
| Gọi quá nhanh | ACK `RATE_LIMITED` | `CallEndedNotice`; nút gọi disabled 60 s | — | "Bạn thao tác quá nhanh, vui lòng thử lại sau" | Hết 60 s |
| Hạ tầng lỗi | ACK `SERVICE_UNAVAILABLE` | `CallEndedNotice` | — | "Không thể thực hiện cuộc gọi lúc này" | Tự đóng 3 s |
| Camera người kia tạm dừng | Remote video track `mute` hoặc không có | Avatar + chú thích ở `RemoteVideo` | — | "Camera đang tạm dừng" | Track `unmute` |
| Đổi thiết bị âm thanh | `devicechange` làm mất thiết bị đang dùng | Toast | — | "Đã chuyển sang {tên thiết bị}" | Tự ẩn 4 s |

### 4.4 Lỗi media và hỗ trợ trình duyệt

Ánh xạ lỗi trong `client/src/lib/webrtc/media.ts`:

```ts
export type MediaErrorKind =
  | 'PERMISSION_DENIED' | 'MIC_NOT_FOUND' | 'CAMERA_NOT_FOUND' | 'MIC_IN_USE' | 'CAMERA_IN_USE'
  | 'OVERCONSTRAINED' | 'INSECURE_CONTEXT' | 'UNSUPPORTED' | 'ABORTED';

export function mapMediaError(err: unknown, requested: 'audio' | 'video'): MediaErrorKind {
  if (!window.isSecureContext) return 'INSECURE_CONTEXT';
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') return 'UNSUPPORTED';
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError': case 'SecurityError': return 'PERMISSION_DENIED';
    case 'NotFoundError': case 'DevicesNotFoundError': return requested === 'audio' ? 'MIC_NOT_FOUND' : 'CAMERA_NOT_FOUND';
    case 'NotReadableError': case 'TrackStartError': return requested === 'audio' ? 'MIC_IN_USE' : 'CAMERA_IN_USE';
    case 'OverconstrainedError': return 'OVERCONSTRAINED';
    case 'AbortError': return 'ABORTED';
    default: return requested === 'audio' ? 'MIC_IN_USE' : 'CAMERA_IN_USE';
  }
}
// Tên lỗi cũ (DevicesNotFoundError, TrackStartError) của Chrome đời trước vẫn được ánh xạ để an toàn.
```

| Trạng thái | Điều kiện kích hoạt | Hiển thị | Hành động khả dụng | Văn bản tiếng Việt chính xác | Thoát khi |
|---|---|---|---|---|---|
| `NotAllowedError` | Người dùng/chính sách từ chối quyền | `MediaErrorPanel` trong overlay (caller) hoặc trên `IncomingCallScreen` (callee, sau khi đã gửi `call:end MEDIA_FAILURE`) | "Hướng dẫn cấp quyền" (mở mô tả theo trình duyệt), "Đóng" | "HUSTALO cần quyền dùng micro/camera. Hãy cấp quyền trong cài đặt trình duyệt." | "Đóng" |
| `NotFoundError` — micro | Không có thiết bị audio | `MediaErrorPanel` | "Thử lại", "Đóng" | "Không tìm thấy micro. Hãy kết nối micro và thử lại." | Thử lại thành công / "Đóng" |
| `NotFoundError` — camera (VIDEO) | Không có camera | Toast, tiếp tục bằng âm thanh | — | "Không tìm thấy camera, tiếp tục với âm thanh" | Tự ẩn 4 s |
| `NotReadableError` — micro | Micro bị app khác giữ | `MediaErrorPanel` | "Thử lại", "Đóng" | "Micro hoặc camera đang được ứng dụng khác sử dụng." | Thử lại thành công / "Đóng" |
| `NotReadableError` — camera (VIDEO) | Camera bị app khác giữ | Toast, tiếp tục bằng âm thanh; nút camera có thể bấm để thử lại | Bật camera (thử lại) | "Micro hoặc camera đang được ứng dụng khác sử dụng." | Tự ẩn 4 s |
| `OverconstrainedError` | Constraint 1280×720 không đáp ứng | Không hiển thị; thử lại `{ video: true }`; vẫn lỗi → như "camera NotFound" | — | (không hiển thị nếu thử lại thành công) | — |
| Insecure context | `isSecureContext = false` | Nút gọi disabled + tooltip; nếu vào thẳng `/call` → panel | — | "Cần kết nối HTTPS để gọi điện" | — |
| Trình duyệt không hỗ trợ | Thiếu `RTCPeerConnection` hoặc `getUserMedia` | Nút gọi disabled + tooltip | — | "Trình duyệt không hỗ trợ gọi điện" | — |
| Autoplay bị chặn | `audio.play()` / `video.play()` reject `NotAllowedError` | `AutoplayUnlockButton` nổi bật (giữa màn hình cuộc gọi đến, dưới tên khi đang gọi) | Bấm nút → gọi lại `play()` cho mọi phần tử đang chờ | "Chạm để bật âm thanh" | `play()` thành công |
| Track kết thúc bất ngờ | `track.onended` | Thử lấy lại 1 lần; audio thất bại → kết thúc cuộc gọi | — | "Cuộc gọi kết thúc do lỗi thiết bị âm thanh/hình ảnh" (audio) | — |

### 4.5 E2EE

| Trạng thái | Điều kiện kích hoạt | Hiển thị | Hành động khả dụng | Văn bản tiếng Việt chính xác | Thoát khi |
|---|---|---|---|---|---|
| Đang thiết lập | SECRET chưa có session với device nào của peer | `E2eeBadge` xám | Gửi tin | "Đang thiết lập mã hóa…" | Session thiết lập |
| Đã mã hóa | Có session với ≥ 1 device của peer | `E2eeBadge` `success` + `Lock` | Bấm badge → `SafetyNumberDialog` | "Mã hóa đầu-cuối" | — |
| Đã xác minh | Người dùng đánh dấu cho mọi device peer | Badge + `ShieldCheck` | — | "Đã xác minh" | Identity đổi |
| Identity đổi | Identity key device peer khác bản đã biết | `IdentityChangedBanner` `warning` + SYSTEM cục bộ | "Xem" (mở safety number), "Chấp nhận" | "Mã an toàn với {tên} đã thay đổi" | "Chấp nhận" |
| Identity đổi + đã xác minh trước đó | Như trên và device từng `verified` | Banner + composer disabled | "Xem", "Chấp nhận" | "Hãy xác nhận mã an toàn mới để tiếp tục" | "Chấp nhận" |
| Người nhận chưa có khóa | `422 E2EE_KEYS_UNAVAILABLE` khi tạo SECRET | Lỗi trong `NewChatDialog` | "Đóng" | "Người nhận chưa bật trò chuyện bí mật" | "Đóng" |
| Device này chưa dùng được | Đăng ký khóa trả `409` (đủ 5 thiết bị) | Banner trong `DevicesSection` và khi mở SECRET | "Quản lý thiết bị" | "Thiết bị này chưa thể dùng trò chuyện bí mật. Hãy thu hồi một thiết bị khác (tối đa 5)." | Đăng ký thành công |

---

## 5. Microcopy và loại thông báo

### 5.1 Nguyên tắc viết

1. Tiếng Việt có dấu, câu ngắn, xưng "bạn"; không dùng thuật ngữ kỹ thuật (không "socket", "ICE", "token", "HTTP 503").
2. Nói điều đã xảy ra và việc người dùng có thể làm: "Không tìm thấy micro. Hãy kết nối micro và thử lại."
3. Không đổ lỗi cho người dùng; không dùng chữ in hoa toàn bộ; không dùng dấu chấm than trong thông báo lỗi.
4. Trạng thái đang diễn ra kết thúc bằng dấu "…" (một ký tự U+2026): "Đang kết nối…". Câu hoàn chỉnh có dấu chấm; nhãn nút và toast ngắn không có dấu chấm.
5. Nhãn nút là động từ: "Gửi", "Trả lời", "Từ chối", "Thử lại", "Thu hồi", "Chấp nhận".
6. Không hiển thị `error.message` của server trực tiếp; luôn ánh xạ từ `code` qua `client/src/i18n/errors.ts` `[NEW]`; mã không biết → "Đã có lỗi xảy ra. Vui lòng thử lại."
7. Số đếm dùng chữ số; thời gian theo `HH:mm`, ngày `DD/MM/YYYY`.
8. Placeholder `{tên}` là `displayName` hiện tại; trong GROUP người dùng hiện tại hiển thị "Bạn".

### 5.2 Khi nào dùng toast / banner / modal / inline

| Loại | Dùng khi | Ví dụ | Hành vi |
|---|---|---|---|
| Inline (dưới trường / trong bubble) | Lỗi gắn với một trường hoặc một tin cụ thể | "Email này đã được sử dụng", ⚠ "Gửi thất bại. Thử lại" | Hiển thị tới khi sửa; `aria-describedby` trỏ tới lỗi |
| Toast | Kết quả thao tác hoặc sự kiện không cần quyết định | "Đã thêm {n} thành viên", "Cuộc gọi nhỡ từ {tên}", "Đã chuyển sang {tên thiết bị}" | Tự ẩn: thành công 4 s, cảnh báo/lỗi 5 s, sự kiện cuộc gọi 8 s; tối đa 3 toast cùng lúc, mới nhất trên cùng; có nút đóng; `role="status"` (lỗi: `role="alert"`) |
| Banner | Trạng thái kéo dài ảnh hưởng toàn trang hoặc toàn phòng | "Đang kết nối lại…", "Không có kết nối mạng", "Mã an toàn với {tên} đã thay đổi" | Tồn tại tới khi điều kiện hết; không tự ẩn |
| Modal | Cần xác nhận hành động không hoàn tác được hoặc chặn tiếp tục | Thu hồi tin, xóa thành viên, rời nhóm, thu hồi thiết bị, `SessionModal` | Focus trap; Esc = hủy (trừ `SessionModal`); nút nguy hiểm màu `danger` đặt bên phải |
| Màn hình toàn phần | Cuộc gọi | `IncomingCallScreen`, `CallOverlay` | Khóa cuộn trang nền |

### 5.3 Chuỗi SYSTEM message và lastSeen `[NEW]`

`SystemMessage` (FR-CHAT-011) dựng chuỗi ở client từ `message.system`; `{actor}`, `{target}`, `{targets}` là `displayName` lấy từ `Conversation.members`; `{targets}` nối bằng ", ". Chuỗi chính thức (nguyên văn PRD FR-CHAT-011):

| `system.kind` | Chuỗi hiển thị |
|---|---|
| `GROUP_CREATED` | "{actor} đã tạo nhóm" |
| `MEMBER_ADDED` | "{actor} đã thêm {targets}" |
| `MEMBER_REMOVED` | "{actor} đã xóa {target} khỏi nhóm" |
| `MEMBER_LEFT` | "{actor} đã rời nhóm" |
| `ROLE_CHANGED` | "{actor} đã đặt {target} làm quản trị viên" (target thành ADMIN) / "{actor} đã gỡ quyền quản trị viên của {target}" (target thành MEMBER) |
| `OWNER_TRANSFERRED` | "{actor} đã chuyển quyền trưởng nhóm cho {target}" |
| `TITLE_CHANGED` | "{actor} đã đổi tên nhóm thành “{title}”" |
| `CALL_MISSED` | "Cuộc gọi thoại nhỡ" / "Cuộc gọi video nhỡ" (theo `callType`) |
| `CALL_ENDED` | "Cuộc gọi thoại · {mm:ss}" / "Cuộc gọi video · {mm:ss}" (`durationSec`) |

Dòng lastSeen (FR-PRES-002) trong `ChatHeader` và `ConversationItem` khi OFFLINE; `lastSeenAt = null` → không hiển thị dòng:

| Khoảng cách tới hiện tại (theo `server-clock.ts`) | Chuỗi |
|---|---|
| < 1 phút | "Vừa mới truy cập" |
| < 60 phút | "Truy cập {n} phút trước" |
| < 24 giờ | "Truy cập {n} giờ trước" |
| Còn lại | "Truy cập lúc HH:mm DD/MM" |

---

## 6. Accessibility

Mục tiêu WCAG 2.1 AA cho luồng chính (NFR-11); kiểm bằng `@axe-core/playwright` trong mọi spec E2E.

### 6.1 Phím tắt

| Phím | Ngữ cảnh | Hành động |
|---|---|---|
| Enter | Composer, không IME composition | Gửi tin |
| Shift+Enter | Composer | Xuống dòng |
| Esc | Modal / dialog | Đóng (hủy) |
| Esc | Composer đang sửa | Hủy sửa |
| Esc | Ô tìm kiếm | Xóa nội dung tìm kiếm |
| ↑ | Composer trống | Sửa tin cuối của mình (≤ 15 phút, không SECRET) |
| Ctrl+K / ⌘+K | Toàn ứng dụng | Focus ô tìm kiếm |
| ↑ / ↓ | Danh sách chat có focus | Chuyển mục |
| Shift+F10 / ContextMenu | Bubble có focus | Mở menu tin nhắn |
| M | Đang gọi, focus không ở ô nhập | Bật/tắt micro (`aria-keyshortcuts="M"`) |
| V | Đang gọi VIDEO, focus không ở ô nhập | Bật/tắt camera (`aria-keyshortcuts="V"`) |

Không có phím tắt trả lời/từ chối cuộc gọi (tránh thao tác nhầm khi đang gõ).

### 6.2 ARIA

| Thành phần | Thuộc tính |
|---|---|
| `MessageList` | `role="log"`, `aria-label="Tin nhắn"`, `aria-live="off"` (thông báo qua `LiveRegions` để tránh đọc lại khi tải lịch sử) |
| `LiveRegions` polite | Tin mới từ người khác trong phòng đang mở: "Tin nhắn mới từ {tên}: {100 ký tự đầu}"; tin mới ở phòng khác: "{tên} đã gửi tin nhắn mới"; kết quả toast |
| `LiveRegions` assertive | Thay đổi trạng thái cuộc gọi (chuỗi §4.3), cuộc gọi đến "Cuộc gọi video đến từ {tên}", mất kết nối "Không có kết nối mạng" |
| `MessageBubble` | `role="article"`, `aria-label="{tên người gửi}, {giờ}"`; trạng thái qua `MessageStatusIcon` `aria-label` |
| `ConversationListItem` | `role="listitem"` chứa link; `aria-label="{tên}, {n} tin chưa đọc, {preview}"`; `aria-current="page"` khi đang mở |
| `UnreadBadge` | `aria-hidden="true"` (số đã có trong `aria-label` của dòng) |
| `OnlineDot` | `aria-label="Đang hoạt động"` khi online; ẩn khi offline |
| Nút cuộc gọi trong header | `aria-label="Gọi thoại cho {tên}"`, `aria-label="Gọi video cho {tên}"`; disabled kèm `aria-disabled="true"` + tooltip lý do |
| `CallControls` | Toggle dùng `aria-pressed`; nhãn đổi theo trạng thái ("Tắt micro" / "Bật micro", "Tắt camera" / "Bật camera"); "Kết thúc cuộc gọi" |
| `IncomingCallScreen` | `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby` (tên), `aria-describedby` (loại cuộc gọi) |
| `TypingIndicator` | `aria-live="polite"` riêng, nội dung chữ ("{tên} đang soạn tin…"), không đọc lại quá 1 lần / 5 s |
| `ConnectionBanner` | `role="status"` |
| `SegmentedTabs` | `role="tablist"` / `role="tab"` + `aria-selected` |

### 6.3 Quản lý focus

- **Cuộc gọi đến:** nếu `document.activeElement` là ô nhập (`input`, `textarea`, `contenteditable`) thì **không** chuyển focus (tránh Enter đang gõ thành thao tác cuộc gọi); thông báo qua `LiveRegions` assertive. Ngược lại focus vào container `IncomingCallScreen` (`tabIndex={-1}`); Tab lần lượt "Từ chối" → "Trả lời" → "Trả lời bằng âm thanh". Focus trap bên trong. Khi đóng, trả focus về phần tử trước đó.
- **Overlay cuộc gọi:** mở → focus nút "Tắt micro"; đóng → trả focus về nút gọi trong `ChatHeader` (nếu còn) hoặc ô Composer.
- **Modal:** focus phần tử đầu tiên tương tác được (nút hủy với modal nguy hiểm); focus trap; đóng → trả focus.
- **Đổi phòng chat:** focus vào Composer (desktop); mobile focus vào tiêu đề `ChatHeader` (không mở bàn phím ảo tự động).
- **Gửi tin:** focus giữ ở Composer.
- **Skip link:** "Bỏ qua tới nội dung chính" trỏ tới `ChatRoomPane`.
- Focus ring luôn hiển thị với `:focus-visible` (mục 1.1).

### 6.4 Khác

- Không truyền thông tin chỉ bằng màu: ✓✓ đã đọc có `aria-label`, ⚠ có chữ "Thử lại", chấm online có nhãn.
- Hỗ trợ zoom 200% không mất chức năng; bố cục dùng `rem`/Tailwind.
- `prefers-reduced-motion`: tắt `ring-pulse`, typing dots đứng yên, cuộn tức thời thay vì mượt.
- Ngôn ngữ trang `<html lang="vi">`.

---

## 7. Responsive và mobile web

| Vấn đề | Giải pháp |
|---|---|
| Chiều cao viewport | Khung app dùng `height: 100dvh` (fallback `100vh`); không dùng `100vh` cố định trên mobile |
| Bàn phím ảo | `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`; lắng nghe `window.visualViewport` `resize` để giữ Composer ngay trên bàn phím và cuộn danh sách xuống cuối nếu đang ở cuối. `// Xác minh với tài liệu chính thức của MDN: hỗ trợ interactive-widget trên Safari iOS; Safari dùng nhánh visualViewport.` |
| Safe-area | Header `pt-[var(--safe-top)]`, Composer và `CallControls` `pb-[max(12px,var(--safe-bottom))]`, `IncomingCallScreen` dùng cả 4 inset |
| Khóa cuộn khi gọi | `CallOverlay`/`IncomingCallScreen` mở → `document.body.style.overflow = 'hidden'`, `overscroll-behavior: contain` trên overlay; trả lại khi đóng |
| Kéo để làm mới | Tắt `overscroll-behavior-y: contain` trên `MessageList` để tránh pull-to-refresh của trình duyệt khi cuộn lên |
| Vùng chạm | ≥ 44×44 px; nút cuộc gọi 56/64 px; khoảng cách giữa nút ≥ 8 px |
| Nhấn giữ bubble | 500 ms mở `MessageActions`; tắt chọn văn bản mặc định trên bubble (`user-select: none` trong lúc nhấn giữ), vẫn có "Sao chép" |
| Tab chạy nền và read receipt | `useReadReceipts` chỉ gửi `message:read` khi `document.visibilityState === 'visible'` **và** `document.hasFocus()` **và** tin hiển thị ≥ 50% (`IntersectionObserver`, threshold 0.5); khi `visibilitychange → visible` gửi read cho tin cuối đang hiển thị (EC-MSG-009). Delivered không phụ thuộc visibility |
| Tab nền — tiêu đề | `document.title = "({n}) HUSTALO"` với n = tổng chưa đọc (> 99 → "99+"); cuộc gọi đến: nhấp nháy "📞 Cuộc gọi đến" |
| Tab nền — outbox | Flush khi `visibilitychange → visible` và sự kiện `online` (EC-NET-008) |
| Mobile chuyển app khi gọi video | Track local có thể bị `mute`; khi `visibilitychange → visible` kiểm tra `track.readyState`, `ended` → lấy lại camera và `replaceTrack` (EC-CALL-MEDIA-011) |
| Xoay màn hình | Video remote `object-fit: cover` (mobile dọc), `contain` (ngang/desktop); PiP giữ góc đã chọn |
| Âm thanh iOS | Mọi `<audio>`/`<video>` có `playsInline`; nhạc chuông chỉ phát sau một tương tác của người dùng trong phiên (nếu không → `AutoplayUnlockButton`) |
| Ảnh nền thấp băng thông | Avatar `loading="lazy"`, kích thước 40/48/96/120 px, chữ cái đầu khi không có ảnh |

---

## 8. File client bổ sung so với cây kiến trúc §4.1

Các file đánh dấu `[NEW]` trong file này bổ sung vào cây `client/` của `system_architecture.md` §4.1 (không đổi cấu trúc hiện có):

| File | Vai trò |
|---|---|
| `client/public/theme-init.js` | Đặt `data-theme` trước render (tuân CSP) |
| `client/src/i18n/vi.ts` | Toàn bộ chuỗi UI tiếng Việt |
| `client/src/i18n/errors.ts` | Ánh xạ `ErrorCode` → chuỗi |
| `client/src/components/layout/LiveRegions.tsx` | Vùng `aria-live` |
| `client/src/components/ui/PasswordField.tsx`, `SegmentedTabs.tsx`, `UnreadBadge.tsx` | UI chung |
| `client/src/features/auth/AuthCard.tsx`, `SessionModal.tsx` | Đăng nhập / phiên |
| `client/src/features/conversations/ChatListHeader.tsx`, `ConversationList.tsx` | Danh sách chat |
| `client/src/features/chat/EmptyRoomPlaceholder.tsx`, `RoomMenu.tsx`, `SystemMessage.tsx`, `MessageMeta.tsx`, `MessageActions.tsx`, `ReadByIndicator.tsx`, `BlockedComposerNotice.tsx`, `RoomNotFound.tsx` | Phòng chat (CharCounter, EditingBar là component nội bộ của `Composer.tsx`) |
| `client/src/features/groups/UserPicker.tsx`, `MemberRow.tsx`, `TransferOwnerDialog.tsx` | Nhóm |
| `client/src/features/calls/AutoplayUnlockButton.tsx`, `LocalVideo.tsx`, `RemoteVideo.tsx`, `RemoteAudio.tsx`, `CallStatusText.tsx`, `CallTopBar.tsx`, `MediaErrorPanel.tsx` | Cuộc gọi (NetworkQualityBadge, DeviceToast nội bộ trong `CallTopBar.tsx` / `InCallScreen.tsx`) |
| `client/src/features/settings/SettingsNav.tsx`, `BlockedSection.tsx`, `SecuritySection.tsx` | Cài đặt |

---

## Consistency Check

- [x] **Enum, event, mã lỗi, hằng số khớp mục 2 và 3:**
  - UI cuộc gọi render theo `CallStatus` (12 giá trị) + `CallLocalPhase` client-only + cờ `networkQuality`; không có trạng thái `OUTGOING` (sửa mâu thuẫn #3). Lý do kết thúc đủ 11 `CallEndReason` (ANSWERED_ELSEWHERE qua `call:answered-elsewhere`, BUSY qua ACK `CALL_BUSY`, TIMEOUT qua MISSED, CANCELLED/REJECTED theo vai trò).
  - `MessageClientStatus` PENDING/SENT/DELIVERED/READ/FAILED ↔ 🕒/✓/✓✓/✓✓ xanh/⚠ thử lại.
  - Event dùng đúng tên kiến trúc §4.5 (`conversation:join/leave`, `message:*`, `typing:*`, `presence:*`, `call:*`, `session:*`).
  - Mã lỗi ánh xạ UI: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `NOT_A_MEMBER`, `CONVERSATION_FULL`, `USER_BLOCKED`, `CALL_BUSY`, `CALL_TIMEOUT`, `CALL_ALREADY_ANSWERED`, `CALL_INVALID_STATE`, `E2EE_KEYS_UNAVAILABLE`, `E2EE_DECRYPT_FAILED`, `SERVICE_UNAVAILABLE`; mã khác → "Đã có lỗi xảy ra. Vui lòng thử lại."
  - Hằng số: `MESSAGE_MAX_LENGTH` 4000 (bộ đếm), `MESSAGE_EDIT_WINDOW_MS` 15 phút, `GROUP_MAX_MEMBERS` 100, `GROUP_TITLE_MAX` 100, `DISPLAY_NAME_MAX` 80, `GROUP_ADD_BATCH_MAX` 50, `UNREAD_COUNT_CAP` 99 ("99+"), `TYPING_TTL_MS` 5 s, `TYPING_CLIENT_THROTTLE_MS` 3 s, `CLIENT_OUTBOX_MAX` 200, `OUTBOX_MAX_AGE_MS` 24 h, `PRESENCE_SUBSCRIBE_MAX` 200, `TURN_REFRESH_BEFORE_S`, `E2EE_MAX_DEVICES_PER_USER` 5.
- [x] **FR/AC tham chiếu bằng ID:** màn hình phục vụ FR-AUTH-001..005/007, FR-USER-001..004, FR-CHAT-001..011, FR-GROUP-001..006, FR-PRES-001..003, FR-CALL-001..011, FR-SEC-006, FR-E2EE-001/004..008; AC E2E liên quan: AC-007, AC-008, AC-011, AC-020..AC-028, AC-030..AC-036, AC-039..AC-043, AC-070..AC-082, AC-085, AC-086, AC-088, AC-092, AC-093, AC-106, AC-111..AC-114, AC-118, AC-120, AC-122.
- [x] **Edge case có ID:** chuỗi UI của toàn bộ EC có thành phần UI trong ma trận PRD §5 được dùng nguyên văn (đã đối chiếu tự động danh sách chuỗi); nêu rõ EC-AUTH-001/006/007, EC-NET-002/008, EC-MSG-001/002/003/009/013, EC-GROUP-001..004/007, EC-CALL-SIG-003, EC-CALL-MEDIA-004/006/008/009/011/012, EC-E2EE-004..007, EC-SEC-001/005.
- [x] **Không có secret thật, không chỗ trống:** không có giá trị bí mật; không "TODO"/"tương tự như trên"; các điểm phụ thuộc hỗ trợ trình duyệt/nhà cung cấp đánh dấu `// Xác minh với tài liệu chính thức của …` (Google Fonts subset, Tailwind `darkMode`, `interactive-widget`).
- [x] **Không mâu thuẫn với các file trước — điểm đã đối chiếu:**
  - Kiến trúc §4.1: dùng đúng tên component/hook/store đã có; file mới liệt kê ở mục 8.
  - Kiến trúc §8.6: chuỗi trạng thái cuộc gọi dùng nguyên văn (mục 4.3).
  - Kiến trúc §6.4: nhiều tab = nhiều socket; cuộc gọi đến hiển thị trên mọi tab, signaling chỉ ở tab đã trả lời.
  - Kiến trúc §9.6: không inline script (theme-init.js), font từ domain đã cho phép trong CSP; React escape, không `dangerouslySetInnerHTML`, `dir="auto"` + `unicode-bidi: isolate`.
  - PRD: FR-CHAT-005 (typing tối đa 2 tên), FR-CHAT-011 (chuỗi SYSTEM), FR-PRES-002 (chuỗi lastSeen dùng ở `ChatHeader`), FR-USER-003 (`blockedByMe`/`canMessage`), FR-E2EE-006 (chặn gửi khi identity đổi và đã xác minh), FR-CALL-011 (nhạc chuông, nhấp nháy tiêu đề), D-22 (ẩn nút gọi trong GROUP).
  - DB: hiển thị dựa trên `deletedAt`, `editedAt`, `system.kind`, cursor receipt (`ReadByIndicator` theo §3.2 DB).
  - **Chuỗi mới do file này bổ sung** (không mâu thuẫn, `development_guide.md`/test dùng): "Đang sửa tin nhắn", "Gửi thất bại. Thử lại", "Hãy xác nhận mã an toàn mới để tiếp tục", "Thiết bị này đã bị thu hồi. Vui lòng đăng nhập lại.", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", "Bạn đang trong một cuộc gọi khác", "Cuộc gọi nhóm chưa được hỗ trợ" (từ D-22), "Bạn đã chặn người này", "Chọn một cuộc trò chuyện để bắt đầu nhắn tin", "Đã có lỗi xảy ra. Vui lòng thử lại.".
