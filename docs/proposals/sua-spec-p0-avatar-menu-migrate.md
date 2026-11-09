# Đề xuất sửa spec — Ảnh đại diện, menu tin nhắn trên thiết bị cảm ứng, `db:migrate`

- **Trạng thái:** ĐÃ DUYỆT 2026-11-09, chọn **phương án C** cho ảnh đại diện. Spec đã sửa (bước 1 mục 5): kiến trúc D-26, §4.1, §9.6, Phụ lục C; PRD §1.2, §1.3, FR-USER-002, FR-CHAT-007/008, EC-MSG-018; DB §6.4, §7 (TC-DB-027); UI §3.3, §7, §8, `ProfileSection`; DG §2, §9.6 bước 5a–5c, Gate M3/M6.5, Traceability. `spec:check` xanh. Bước 2 (migrate) xong 2026-11-09: `server/src/infra/db/migrate.ts`, `migrations/index.ts`, entry tsup, `infra/deploy-prod.sh` bước 5a, TC-DB-027 (6 test integration). Bước 3 (menu) xong 2026-11-09: `client/src/features/chat/useMessageMenuTrigger.ts`, `Menu` mở được từ ngoài và đóng theo `pointerdown`, TC-MSG-018 (9 test unit). Bước 4 (avatar, PA C) xong 2026-11-09: `ProfileSection` bỏ ô `avatarUrl`, bỏ 2 chuỗi trong `vi.ts`, ghi chú D-26 ở `Avatar.tsx`; server không đổi. Còn bước 5 (`docs/STATUS.md`).
- **Ngày:** 2026-11-08
- **Nguồn:** đợt kiểm tra chỉ đọc ngày 08/11/2026 trên commit `b398d2c` (typecheck, lint, unit, integration 201/201, build xanh; E2E Chromium 39/41, 2 test chập chờn chạy lại pass).
- **Lý do:** ba lỗi nhóm P0 của đợt kiểm tra. Theo `CLAUDE.md`, chỗ nào spec sai hoặc thiếu thì phải duyệt spec trước khi code.

| #   | Vấn đề                                                 | Cần sửa spec?                                          | Mức độ sửa                                     |
| --- | ------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------- |
| 1   | `avatarUrl` lưu được nhưng không bao giờ hiển thị      | **Có** — spec tự mâu thuẫn (URL `https://` ↔ CSP)      | Quyết định D-26 + sửa PRD, kiến trúc, UI       |
| 2   | Menu tin nhắn không mở được bằng nhấn giữ / chuột phải | **Không** về hành vi; **nên** làm rõ + thêm Test ID    | Làm rõ cách xử lý sự kiện; thêm EC-MSG-018     |
| 3   | `npm run db:migrate` trỏ tới file không tồn tại        | **Có** — spec không chỉ cách chạy migrate ở production | Sửa thứ tự deploy, entry build, thêm TC-DB-027 |

Không đổi: tech stack, tên event, enum, mã lỗi, hằng số, REST API, schema Zod của `@hustalo/shared`. Vì vậy **không cần phát hành `shared-v*` mới**.

---

## 1. Ảnh đại diện (`avatarUrl`)

### 1.1 Hiện trạng (đã kiểm chứng)

| Chỗ                                                                                | Nội dung                                                                                                         |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| PRD §1.2, §1.3, FR-USER-002; DB `users.avatarUrl`; api_spec                        | Hồ sơ có "ảnh đại diện dạng URL"; chỉ nhận `https://`, ≤ 2048 ký tự                                              |
| `ui_ux_spec.md` dòng 844, 1121                                                     | `ProfileSection` có ô `avatarUrl`; "Avatar `loading="lazy"` … chữ cái đầu khi không có ảnh" → ngụ ý hiển thị ảnh |
| Kiến trúc §9.6; `server/src/http/middleware/security.ts`; `infra/nginx/nginx.conf` | CSP `img-src 'self' data: blob:` → **chặn mọi ảnh `https://` bên ngoài**                                         |
| `client/src/components/ui/Avatar.tsx`                                              | Chỉ vẽ chữ cái đầu, không có prop URL; 14 chỗ dùng `<Avatar>` đều không truyền ảnh                               |
| `client/src/features/settings/ProfileSection.tsx`                                  | Có ô nhập "Ảnh đại diện (URL)": người dùng nhập, bấm lưu, thấy "Đã lưu thay đổi" nhưng không có gì thay đổi      |

Spec không thể đáp ứng cùng lúc "hiển thị ảnh từ URL người dùng nhập" và "CSP `img-src 'self'`". Code hiện tại đứng về phía CSP nhưng vẫn giữ ô nhập, nên người dùng hiểu sai.

### 1.2 Rủi ro nếu hiển thị ảnh từ URL tùy ý

Người dùng X đặt `avatarUrl` trỏ về máy chủ do X kiểm soát. Mỗi lần trình duyệt của người khác tải avatar đó (danh sách chat, phòng nhóm, danh sách chặn, màn hình cuộc gọi), máy chủ của X nhận được **IP thật và thời điểm**. X có thể trả `Cache-Control: no-store` để mỗi lần render là một lần truy cập.

Hệ quả:

- **Vô hiệu FR-USER-004:** dù nạn nhân tắt "Hiển thị lần truy cập gần nhất", X vẫn suy ra được lúc nạn nhân mở ứng dụng.
- **Vô hiệu một phần chặn (D-21):** người đã chặn X vẫn thấy X trong "Đã chặn" → avatar của X vẫn được tải → X vẫn theo dõi được người đã chặn mình.
- Lộ IP thành viên nhóm cho bất kỳ thành viên nào.

Điều này đi ngược PG-04 "Bảo mật mặc định".

### 1.3 Phương án

| PA                              | Nội dung                                                                                                                           | Ưu                                                   | Nhược                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| A. Nới CSP                      | `img-src 'self' data: blob: https:`; `<img loading="lazy" referrerpolicy="no-referrer">`, lỗi tải → chữ cái đầu                    | Ít việc nhất (~0,5 ngày), đúng ý dòng 1121           | Toàn bộ rủi ro mục 1.2; mở CSP cho mọi host                                                                                             |
| B. Proxy ảnh qua server         | `GET /users/{id}/avatar`: server tải URL, kiểm `image/*`, ≤ 1 MB, cache; client chỉ tải từ `'self'`                                | Ẩn IP người xem; CSP giữ nguyên                      | Thêm endpoint (đổi api_spec, shared), rủi ro **SSRF** (phải chặn IP nội bộ, DNS rebinding, redirect), cache, băng thông; ~3–5 ngày      |
| C. **Không hiển thị ảnh ở MVP** | Avatar chỉ là chữ cái đầu; bỏ ô nhập `avatarUrl` khỏi `ProfileSection`; API **giữ nguyên** trường `avatarUrl` (không đổi hợp đồng) | Không rủi ro riêng tư; khớp code hiện tại; ~0,5 ngày | Không có ảnh đại diện cho tới khi làm "tải ảnh lên server" (đang ngoài phạm vi §1.3)                                                    |
| D. Danh sách host cho phép      | Chỉ nhận URL thuộc `AVATAR_ALLOWED_HOSTS` (vd. Gravatar); CSP `img-src` thêm đúng các host đó                                      | Không có host do kẻ xấu kiểm soát                    | Vẫn lộ IP cho bên thứ ba; thêm biến môi trường; **đổi validation** `avatarUrl` (AC-013) → đổi shared; ít người dùng có ảnh trên host đó |

**Khuyến nghị: C.** Đây là cách duy nhất giữ đúng FR-USER-004 và D-21 mà không thêm bề mặt tấn công. Ảnh đại diện thật nên làm cùng với "tải ảnh đại diện lên server" (B hoặc lưu file tự host), sau MVP.

### 1.4 Spec phải sửa (nếu chọn C)

| File                      | Mục                         | Nội dung sửa                                                                                                                                                       |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `system_architecture.md`  | §2.1                        | Thêm **D-26**: MVP không hiển thị ảnh đại diện từ URL người dùng nhập (lý do: mục 1.2). API giữ trường `avatarUrl` để không đổi hợp đồng; CSP `img-src` giữ nguyên |
|                           | §9.6                        | Thêm một câu dưới khối CSP: "`img-src` không có host ngoài (D-26)"                                                                                                 |
| `product_requirements.md` | §1.2                        | "Hồ sơ: tên hiển thị, quyền riêng tư lastSeen, chặn người dùng. Ảnh đại diện: chỉ chữ cái đầu (D-26)"                                                              |
|                           | §1.3                        | Dòng "Tải ảnh đại diện lên server" đổi thành "Ảnh đại diện (tải lên hoặc từ URL) — Không hiển thị; API vẫn nhận/trả `avatarUrl` `https://` (D-26)"                 |
|                           | FR-USER-002                 | Thêm: "Client MVP không có ô nhập và không hiển thị `avatarUrl` (D-26)". AC-013 giữ nguyên (kiểm ở tầng API)                                                       |
| `ui_ux_spec.md`           | dòng 844 (`ProfileSection`) | Bỏ `avatarUrl` khỏi danh sách trường                                                                                                                               |
|                           | dòng 1121                   | "Avatar: chữ cái đầu (D-26), kích thước 40/48/96/120 px"                                                                                                           |
|                           | Bảng chuỗi                  | Bỏ "Ảnh đại diện (URL)", "Ảnh đại diện phải là URL https://" khỏi chuỗi hiển thị (nếu có liệt kê)                                                                  |
| `api_spec.yaml`           | —                           | Không đổi                                                                                                                                                          |
| `database_schema.md`      | —                           | Không đổi                                                                                                                                                          |

### 1.5 Việc code sau khi duyệt (C)

- `client/src/features/settings/ProfileSection.tsx`: bỏ ô `avatarUrl` và nhánh validate tương ứng; `client/src/i18n/vi.ts`: bỏ 2 chuỗi avatar.
- Cập nhật `ProfileSection.test.tsx`: không còn ô avatar; lưu chỉ gửi `displayName`.
- Server giữ nguyên (AC-013 integration vẫn xanh).

---

## 2. Menu tin nhắn trên thiết bị cảm ứng

### 2.1 Hiện trạng (đã kiểm chứng)

- `ui_ux_spec.md` dòng 611: menu mở bằng "hover nút `MoreHorizontal`, chuột phải, nhấn giữ 500 ms (mobile) hoặc phím `Shift+F10`/`ContextMenu` khi bubble focus". Dòng 1114: nhấn giữ 500 ms, `user-select: none` trong lúc giữ.
- Code (`client/src/features/chat/MessageActions.tsx`, `MessageBubble.tsx`): **chỉ có** nút `opacity-0` hiện khi hover hoặc focus. Không xử lý `contextmenu`, nhấn giữ hay `Shift+F10`. Bubble đã có `tabIndex={0}`.
- Không có AC, EC hay Test ID nào cho các cách mở menu này, nên `trace:check` không phát hiện được thiếu sót.

**Hành vi đã đủ trong spec, không cần quyết định mới.** Chỉ đề xuất làm rõ để tránh lỗi khi cài đặt và thêm Test ID để có gate.

### 2.2 Làm rõ đề xuất thêm vào `ui_ux_spec.md` (dòng 611 hoặc 1114)

| Tình huống                                        | Quy định đề xuất                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chuột phải (desktop)                              | `contextmenu` trên bubble → `preventDefault()` + mở menu tại bubble                                                                                               |
| Nhấn giữ (cảm ứng)                                | `pointerdown` với `pointerType === 'touch'` hẹn 500 ms; **hủy** khi `pointerup`/`pointercancel` hoặc ngón tay di chuyển > 10 px (đang cuộn). Hết 500 ms → mở menu |
| Android Chrome phát `contextmenu` khi giữ         | Trong lúc đang nhấn giữ cảm ứng: `contextmenu` chỉ `preventDefault()`, không mở lần hai                                                                           |
| iOS Safari                                        | Bubble có `-webkit-touch-callout: none` để không hiện menu hệ thống; "Sao chép" vẫn có trong `MessageActions`                                                     |
| Bàn phím                                          | `Shift+F10` hoặc `ContextMenu` khi bubble đang focus → mở menu, focus mục đầu (đã có trong `Menu.tsx`)                                                            |
| Nút `MoreHorizontal`                              | Giữ như hiện tại (hiện khi hover/focus). Trên thiết bị `(hover: none)` không bắt buộc hiện; nhấn giữ là cách chính                                                |
| Tin không có mục nào (của người khác, đã thu hồi) | Không mở menu, không chặn hành vi mặc định                                                                                                                        |

### 2.3 Test ID đề xuất

| File                      | Mục                                   | Nội dung                                                                                                                                                                                 |
| ------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product_requirements.md` | Ma trận EC, nhóm MSG                  | **EC-MSG-018** — Thiết bị không có hover / chỉ có bàn phím → mở `MessageActions` bằng nhấn giữ 500 ms, chuột phải, `Shift+F10`/`ContextMenu`; cuộn không mở menu. Tầng U. **TC-MSG-018** |
| `development_guide.md`    | Traceability FR-CHAT-007, FR-CHAT-008 | Thêm `TC-MSG-018`                                                                                                                                                                        |
|                           | Gate M3                               | Thêm `TC-MSG-018`                                                                                                                                                                        |

Test (unit, Vitest + Testing Library, fake timer):

1. Nhấn giữ 500 ms → menu mở.
2. Thả trước 500 ms → không mở.
3. Di chuyển 20 px → không mở.
4. `contextmenu` → mở một lần, không bị nhân đôi khi đang nhấn giữ.
5. `Shift+F10` trên bubble đang focus → mở menu.

E2E mobile để ở P1 (cần thêm project Playwright `hasTouch`).

### 2.4 Việc code sau khi duyệt

- Hook mới `client/src/features/chat/useMessageMenuTrigger.ts` (pointer, contextmenu, keydown) gắn vào `MessageBubble.tsx`.
- `MessageActions.tsx` nhận `open`/`onOpenChange` để mở từ bên ngoài, thay vì chỉ mở qua nút.
- Thêm file mới vào cây §8 của `ui_ux_spec.md` (file client bổ sung).

---

## 3. `npm run db:migrate`

### 3.1 Hiện trạng (đã kiểm chứng)

- `database_schema.md` §6.4 mô tả đầy đủ runner: `server/src/infra/db/migrate.ts`, thư mục `migrations/NNN-<tên>.ts`, collection `_migrations`, idempotent, không có down, "MVP v1.0.0 không có migration nào". `development_guide.md` dòng 214, 224 yêu cầu có file.
- Code: `server/package.json` có script `db:migrate` nhưng **không có** `migrate.ts` hay `migrations/` → lệnh lỗi "Cannot find module".
- **Spec thiếu cách chạy ở production:**
  - Image server chỉ có `dist/` build bằng tsup, không có `tsx` (devDependency). `tsup.config.ts` chỉ build `main.ts` và `indexes.ts`.
  - DB §6.4 yêu cầu thứ tự `db:migrate → db:indexes → khởi động server mới`. Nhưng DG §9.6 bước 5 và `infra/deploy-prod.sh` chạy `up -d` (server mới đã chạy) rồi mới `exec … indexes.js`, và không có bước migrate.
- Không có Test ID nào cho runner (TC-DB-001..026 không có).

### 3.2 Spec phải sửa

| File                     | Mục                              | Nội dung sửa                                                                                                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database_schema.md`     | §6.4                             | Thêm: production chạy `node dist/infra/db/migrate.js` (tsup build thêm entry `src/infra/db/migrate.ts`). Runner dùng `isMainModule` (DG-02, như `indexes.ts`); exit code ≠ 0 khi một migration lỗi và **không** ghi `_migrations` cho migration đó. Không có migration nào → in "0 migration" và thoát 0        |
|                          | §7                               | Thêm **TC-DB-027** (I): (a) `_migrations` rỗng + 2 migration giả → chạy theo thứ tự tên, ghi 2 bản ghi; (b) chạy lần hai → không chạy lại; (c) migration thứ hai throw → bản ghi thứ nhất còn, thứ hai không có, exit ≠ 0                                                                                       |
| `development_guide.md`   | §2 (script server)               | Giữ `db:migrate` (tsx, dev). Ghi chú bản production ở §9.6                                                                                                                                                                                                                                                      |
|                          | §9.6 bước 5                      | Đổi thành: (5a) `docker compose … run --rm server node dist/infra/db/migrate.js` (Compose tự khởi động mongo, mongo-init, redis theo `depends_on`); (5b) `up -d --wait --wait-timeout 300 --remove-orphans`; (5c) `exec -T server node dist/infra/db/indexes.js`. Migrate lỗi → dừng deploy, server cũ vẫn chạy |
|                          | Traceability / Gate M0 hoặc M6.5 | Thêm `TC-DB-027`                                                                                                                                                                                                                                                                                                |
| `system_architecture.md` | §4.1 cây thư mục                 | `server/src/infra/db/migrate.ts`, `server/src/infra/db/migrations/` (đã nêu ở DB dòng 1685, bổ sung vào cây cho khớp); `tsup.config.ts` có 3 entry                                                                                                                                                              |

Ghi chú: giữ thứ tự "index sau khi server mới chạy" như hiện tại. Index idempotent và Mongo tạo index online, nên không bắt buộc đổi thành "index trước server mới". Nếu muốn khớp hoàn toàn DB §6.4 thì chạy `indexes.js` bằng `run --rm` ở bước 5a, ngay sau migrate.

### 3.3 Việc code sau khi duyệt

- `server/src/infra/db/migrate.ts` (runner), `server/src/infra/db/migrations/` (rỗng, có `.gitkeep` hoặc `index.ts` liệt kê migration).
- `server/tsup.config.ts`: thêm entry `src/infra/db/migrate.ts`.
- `infra/deploy-prod.sh`: bước 5a.
- `server/src/infra/db/migrate.int.test.ts`: TC-DB-027.
- `server/src/__tests__/deploy.test.ts` (nếu cần): kiểm `dist/infra/db/migrate.js` có trong image.

---

## 4. Mục P0/P1 khác — không cần sửa spec

| Mục                                              | Lý do                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chốt client chính (`client/` ↔ `HustAlo-client`) | D-24/D-25 và `docs/proposals/tach-repo-client.md` đã quy định. Chỉ cần chủ dự án quyết định bước 3 (giữ, thay hay gộp code đang có ở `HustAlo-client`) |
| Mục Cài đặt → Giao diện (theme)                  | Đã có trong spec (`ui_ux_spec.md` dòng 267, §1.5). Chỉ thiếu code                                                                                      |
| Tiêu đề tab "(n) HUSTALO"                        | Đã có trong spec (`ui_ux_spec.md` dòng 1116). Chỉ thiếu code                                                                                           |

Hai mục cuối có thể code ngay theo spec hiện có, nhưng nên thêm Test ID khi làm (tương tự mục 2.3).

## 5. Kế hoạch thực hiện (sau khi duyệt)

| Bước | Việc                                                                 | Xong khi                                                               |
| ---- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0    | Chủ dự án chọn phương án mục 1.3 và duyệt các bảng 1.4, 2.2–2.3, 3.2 | Ghi "ĐÃ DUYỆT" + ngày vào đầu file này                                 |
| 1    | PR sửa `.spec/` theo các bảng trên                                   | `npm run spec:check` xanh; Redocly xanh                                |
| 2    | Code mục 3 (migrate) — viết TC-DB-027 trước                          | `typecheck && lint && npm test` xanh; `trace:check --strict` đủ ID mới |
| 3    | Code mục 2 (menu) — viết TC-MSG-018 trước                            | Như trên                                                               |
| 4    | Code mục 1 (avatar theo PA đã chọn)                                  | Như trên; E2E `auth.spec.ts` (TC-AC-013) xanh                          |
| 5    | Cập nhật `docs/STATUS.md`                                            | —                                                                      |

Code client ở bước 3–4 làm ở `client/` của monorepo hay ở `HustAlo-client` tùy quyết định mục 4 dòng đầu.
