# HUSTALO — Trạng thái dự án

- **Ngày kiểm tra:** 2026-10-30 (sau khi hoàn thành M4)
- **Nhánh:** `main` (chưa push)
- **Commit:** M4 commit theo phần: spec → server → client → test/e2e → docs
- **Phạm vi:** kết quả lệnh tự động ở mục 2 là số chạy thật trên working tree trùng với HEAD sau các commit này. Cột "% checklist" chưa audit lại toàn bộ (chi tiết audit ở `docs/SPEC_CONFORMANCE.md`).

## 1. Tổng quan milestone

| Milestone               | Trạng thái                                | % checklist                                          | Test Gate có test pass / tổng            | Ghi chú                                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0 — Nền tảng           | **Đang làm** (chưa đạt DoD)               | 7/7 (mục `infra:up`: 3 container healthy)            | 14/14                                    | Gate thêm `TC-SEC-009` (EC-SEC-009). typecheck, lint, unit, integration xanh; `TC-ARCH-003` pass 3/3 lần chạy                                                                                                                                                            |
| M1 — Auth & hồ sơ       | **Xong phần code** (chờ DoD chung với M0) | 3/3 (`BlockedSection` chuyển sang M3, spec đã duyệt) | 30/30 (U/I) + E2E 8 test × 3 trình duyệt | Auth, refresh Web Locks, socket, `SessionModal`, `ConnectionBanner`, Settings (Hồ sơ, Bảo mật, Đăng xuất)                                                                                                                                                                |
| M2 — Hội thoại & nhóm   | **Xong phần code** (chờ DoD chung)        | 2/2                                                  | 20/20 (I) + E2E 6 test × 3 trình duyệt   | DIRECT idempotent (không transaction, DB §4.3), nhóm, SYSTEM, danh sách hội thoại, `conversation:join/leave`, RoomNotFound; `unreadCount` thật từ M3                                                                                                                     |
| M3 — Tin nhắn & receipt | **Xong phần code** (chờ DoD chung)        | 2/2                                                  | 70/70 (U/I) + E2E 6 test × 3 trình duyệt | Gửi qua outbox (IndexedDB), ACK sau commit, AES-GCM + job re-encrypt, lịch sử cursor, delivered/read một chiều (read chỉ khi visible + focus + ≥ 50% viewport), sửa/thu hồi 15 phút, reconnect + sync debounce, chặn 1-1, `BlockedSection`, `LiveRegions`, `UnreadBadge` |
| M4 — Presence & typing  | **Xong phần code** (chờ DoD chung)        | 2/2                                                  | 15/15 (U/I) + E2E 3 test × 3 trình duyệt | Lease mỗi socket (Lua `presence-touch`/`presence-drop`), grace 10 s, heartbeat 20 s, sweeper 1 s, lastSeen + quyền riêng tư có đi có lại (room `presence-nols`), `degraded` khi Redis lỗi, typing (throttle 3 s, TTL 5 s) trong phòng và preview, `PrivacySection`       |
| M5 — Cuộc gọi 1-1       | Chưa bắt đầu                              | 0/3                                                  | 0/74                                     |                                                                                                                                                                                                                                                                          |
| M6 — Hardening          | Chưa bắt đầu                              | 0/7                                                  | 3/12                                     | `TC-AC-107`, `TC-ARCH-011`, `TC-SEC-006`                                                                                                                                                                                                                                 |
| M6.5 — Deploy           | Chưa bắt đầu (spec mới)                   | 0/5                                                  | 0/2                                      | `TC-ARCH-016`, `TC-ARCH-017`; xem development_guide.md §9                                                                                                                                                                                                                |
| M7 — E2EE               | Chưa bắt đầu                              | 0/4                                                  | 0/25                                     |                                                                                                                                                                                                                                                                          |

> "Test Gate có test pass" = số Test ID trong Gate có test (theo `trace:check`) và mọi test đó pass trong lần chạy ở mục 2 (unit và integration lần này không có test skip/todo). `trace:check` tự nó chỉ kiểm có tên test, không kiểm pass.

## 2. Kết quả kiểm tra tự động

| Lệnh                                  | Kết quả           | Chi tiết                                                                                                                           |
| ------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                   | ✅ PASS           | 0 lỗi (shared, server, client)                                                                                                     |
| `npm run lint`                        | ✅ PASS           | ESLint 0 lỗi/0 cảnh báo · Prettier sạch · Redocly valid (1 ngoại lệ có chủ đích)                                                   |
| `npm run test:unit`                   | ✅ PASS           | scripts 5/5 (node:test) · shared 41/41 · server 48/48 · client 178/178                                                             |
| `npm run test:integration`            | ✅ PASS           | 16/16 file · 126/126 test, 0 skip (cần Redis của `infra:up`; Mongo là replica set bộ nhớ)                                          |
| `npm run test:e2e`                    | ✅ PASS           | 69/69: `auth` 8 + `group` 6 + `message` 6 + `presence` 3, × chromium, firefox, webkit (14.6 phút)                                  |
| `npm run spec:check`                  | ✅ PASS           | `FR 58 · AC 102 · EC 106 · event 35 · endpoint 28 · hằng số 71`                                                                    |
| `trace:check --milestone M0 --strict` | ✅                | 14/14 ID có test                                                                                                                   |
| `trace:check --milestone M1 --strict` | ✅                | 30/30 ID có test                                                                                                                   |
| `trace:check --milestone M2 --strict` | ✅                | 20/20 ID có test                                                                                                                   |
| `trace:check --milestone M3 --strict` | ✅                | 70/70 ID có test                                                                                                                   |
| `trace:check --milestone M4 --strict` | ✅                | 15/15 ID có test                                                                                                                   |
| `trace:check` M5..M7 (không strict)   | ❌ (đúng kỳ vọng) | M5 1/74 · M6 3/12 · M6.5 0/2 · M7 1/25                                                                                             |
| `npm run build`                       | ✅ PASS           | server tsup OK (chép `infra/redis/scripts/*.lua` → `dist/scripts`) · client vite 142.54 kB gzip JS · bundle-secrets OK (6 giá trị) |
| Vite dev (DG-01)                      | ✅                | Không có `VITE_HTTPS` → phục vụ `http://localhost` (HTTP 200), không cần chứng chỉ                                                 |

Docker: `hustalo-redis-1`, `hustalo-mongo-1`, `hustalo-coturn-1` đều healthy. Trước E2E đã chạy `npm run db:indexes` và `npm run db:seed` (DG §2: điều kiện của `test:e2e`; DB dev trước đó chưa có unique index `email_unique`/`username_unique`).

Console trình duyệt ở `/login`, `/register`, `/chats`: không còn cảnh báo future flag của React Router (bật đủ 6 flag v7).

## 3. Việc cần làm tiếp

> 2026-10-30 (M4): đã duyệt và sửa spec — ma trận §5.2 `presence → users.isBlockedEitherWay`, `presence → conversations.assertMember/getType/activeMemberIds`; handler ghép nhiều service (`typingUserIds` trong ACK `conversation:join`); room `presence-nols:{userId}` cho quy tắc lastSeen có đi có lại; `PrivacySection` lưu ngay khi bật/tắt. Chi tiết hiện thực ngoài văn bản spec: khi socket cuối ngắt, service bỏ user khỏi `presence:users` để lease hết hạn sau đó không phát OFFLINE lần hai; preview typing GROUP ở danh sách chỉ có tên khi `Q['conversation', id]` đã tải.
>
> 2026-10-30 (M3): đã duyệt và sửa spec — `withTxn` tự start/commit/abort (≤ 3 lần + backoff, DB §1/§4), `getOrCreatePair` không transaction (DB §4.3), ma trận §5.2 `messages → conversations` thêm `activeMemberIds/touchLastMessage/advanceCursors/memberCursors/groupReadStats`. Lỗi thật tìm ra khi làm M3: Express gắn sau Socket.IO làm long-polling 404 (đã sửa ở `main.ts`); `session.withTransaction` vượt giới hạn retry.
>
> 2026-10-29 (sau M2): đã duyệt — `LastMessagePreview.sender { id, displayName }` (đã làm luôn ở M2) và endpoint `GET /users/blocked` cho `BlockedSection` (làm ở M3).
>
> 2026-10-29: spec M2 đã duyệt và sửa — preview SYSTEM có `lastMessage.system` (kèm tên), `system.role` cho ROLE_CHANGED, `RoomMenu`/`RenameGroupDialog` ở M2, SECRET trả 422 tới M7, ma trận §5.2 cho `conversations` gọi `messages.previewsFor/countUnread`.
>
> 2026-10-29 (trước M2): đã duyệt và sửa spec — `BlockedSection` chuyển sang checklist M3; bổ sung 7 chuỗi UI mới vào `ui_ux_spec.md`; đoạn `webServer` trong DG §6.6 khớp `client/playwright.config.ts`.

| #   | Mức      | Việc                                                                                                                                                                                                        | File liên quan                                | ID spec                         |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------- |
| 4   | **TB**   | Subject rate-limit `ip+email` dùng `sha256(email).slice(0,32)`, spec quy định `slice(0,16)`                                                                                                                 | `server/src/http/middleware/rate-limit.ts:17` | DB §5.2, FR-SEC-005             |
| 5   | **TB**   | Thiếu `server/src/modules/users/users.test.ts` (quy ước `<module>.test.ts`); `npm run db:seed` đã xác minh chạy được (tạo 3 user)                                                                           | `server/src/modules/users/`                   | Kiến trúc §4.1, Checklist M1 #1 |
| 6   | **Thấp** | Dọn worktree mồ côi `.claude/worktrees/spec-review-fixes`, nhánh `worktree-spec-review-fixes`, `feat/m1-auth` (gitlink `2feaef8` chưa merge)                                                                | `.claude/worktrees/`, các nhánh cục bộ        | —                               |
| 7   | **Thấp** | `trace:check` đếm cả `it.skip`/`it.todo` là "có test" → nên kiểm thêm pass                                                                                                                                  | `scripts/check-traceability.mjs`              | DG §8.8                         |
| 8   | **TB**   | E2E còn thiếu: AC-011 tầng E (hết hạn token giữa phiên — cần fake clock/TTL ngắn, phần sync ở M3), khóa tài khoản (EC-AUTH-005) và REFRESH_REUSE (EC-AUTH-004) mới có unit test client + integration server | `client/e2e/`                                 | AC-011, EC-AUTH-004/005         |
| 9   | **TB**   | `npm audit`: 5 lỗ hổng có sẵn từ trước (vitest/tinypool, react-router open redirect qua `\`, zod, esbuild dev server Windows); `safeNext` đã chặn `/\`. Nâng version cần duyệt (không tự đổi tech stack)    | `package-lock.json`                           | —                               |
| 10  | **Sau**  | M6.5 Deploy: Dockerfile, compose prod, nginx, `cicd-docker.yml`, VM + domain                                                                                                                                | development_guide.md §9                       | AC-ARCH-016, AC-ARCH-017        |
