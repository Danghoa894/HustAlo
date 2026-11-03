# HUSTALO — Đối chiếu code với spec

- **Ngày:** 2026-11-01 · **Nhánh:** `main` · **HEAD:** `809387b` · **Phạm vi:** M0–M7 (chi tiết M0–M4; M5–M7 kiểm sự tồn tại)
- Chế độ chỉ đọc: chỉ sửa `docs/STATUS.md` và file này. Không in giá trị secret.
- Script đối chiếu tạm (không nằm trong repo) dùng để so khối code trong spec với code thật: so hằng số/enum/mã lỗi bằng cách eval khối `ts` của kiến trúc §4.4.1–4.4.3 rồi so với export của `@hustalo/shared`; so field + `.index(...)` của khối model trong `database_schema.md` §2 với file `*.model.ts`; so nguyên văn `.env.example`, `docker-compose.yml`, `ci.yml`, `package.json` gốc với khối tương ứng trong `development_guide.md`.

---

## A. Trạng thái repo (bước 1)

| Kiểm tra                     | Kết quả                                                                                                                                                                       | Cảnh báo    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `git branch --show-current`  | `main`                                                                                                                                                                        |             |
| Đồng bộ remote               | `Your branch and 'origin/main' have diverged, and have 29 and 1 different commits each` — remote có `e08f525 chore(client): m1 deps, playwright config…`                      | ⚠           |
| Thay đổi chưa commit         | Staged: `.claude/commands/audit.md`, `docs/SPEC_CONFORMANCE.md`, `docs/testcases/Testcase_HustALo.xlsx`. Modified: `.claude/commands/gen-spec.md`. Untracked: `.vscode/`      | ⚠           |
| `git worktree list`          | Chỉ `D:/Project/HustAlo 809387b [main]` — không còn worktree đăng ký ngoài gốc. Còn thư mục rỗng `.claude/worktrees/spec-review-fixes` (mồ côi)                               | Thấp        |
| Nhánh cục bộ cũ              | `feat/m1-auth`, `m0/foundation`, `m1/auth`, `worktree-spec-review-fixes`                                                                                                      | Thấp        |
| `.env` so với `.env.example` | `infra/.env`, `server/.env`, `client/.env` đều có. Khác biệt duy nhất là biến tùy chọn đang comment trong example: `DEV_CALL_RING_TIMEOUT_MS` (server), `VITE_HTTPS` (client) | OK          |
| Docker                       | Không chạy (`dockerDesktopLinuxEngine` pipe không tồn tại)                                                                                                                    | ⚠ Chặn test |

## B. Kiểm tra tự động (bước 2) — chi tiết lỗi

### B.1 lint

```
Checking formatting...
[warn] .vscode/settings.json
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```

ESLint `--max-warnings 0` qua. `.prettierignore` hiện có `**/node_modules`, `CLAUDE.md`, `.claude` — không có `.vscode`. Redocly (bị `&&` bỏ qua) chạy riêng: `Your API description is valid`, 1 problem ignored.

### B.2 test:unit — 1 fail

`client/src/features/groups/groups.test.tsx:87` — `TC-GROUP-001 422 CONVERSATION_FULL → lỗi trong dialog; thử lại dùng cùng Idempotency-Key` → `Error: Test timed out in 5000ms` (5593 ms). Lần chạy đó: `environment 952.14s`, máy đang tải nặng. Chạy riêng `npx vitest run src/features/groups/groups.test.tsx` hai lần: 8/8 pass, test này 2096 ms và 2047 ms → **chập chờn theo tải**, biên an toàn ~2.5×.

### B.3 test:integration (3 lần, không có Redis)

| Lần | File       | Test                        | Fail thật (ngoài lỗi kết nối Redis)                                                                                                                                                      |
| --- | ---------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 11 ✗ / 5 ✓ | 1 ✗ · 22 ✓ · 103 skip (126) | `src/infra/db/mongo.int.test.ts:17` TC-ARCH-003: kỳ vọng `"MongoDB phải chạy replica set (rs0)…"`, nhận `Can't call openUri() on an active connection with different connection strings` |
| 2   | 10 ✗ / 6 ✓ | 23 ✓ · 103 skip             | — (TC-ARCH-003 pass)                                                                                                                                                                     |
| 3   | 10 ✗ / 6 ✓ | 23 ✓ · 103 skip             | —                                                                                                                                                                                        |

10 file lỗi ở `beforeAll` (`Error: Connection is closed.`, `TypeError: Cannot read properties of undefined (reading 'close')`) nên các test của file bị skip: auth 20, users 10, conversations 24, messages 17, receipts 10, presence 11, socket-auth 5, user-lock 2, send-txn 1, rate-limiter 3. Lệnh vẫn exit 1 nên không "xanh giả". TC-ARCH-003 chập chờn 1/3 trong điều kiện này.

### B.4 trace:check

M0 14/14 · M1 30/30 · M2 20/20 · M3 70/70 · M4 15/15 · M5 1/74 · M6 3/12 · M6.5 0/2 · M7 1/25. Regex ở `scripts/check-traceability.mjs:57` chấp nhận `.skip`/`.todo` là "có test". Grep `(it|test|describe)\.(skip|todo|only)\(` trong `server client packages scripts`: **không có** → con số M0–M4 hiện không bị thổi phồng.

---

## C. Đối chiếu code với spec (bước 3)

### 3.1 system_architecture.md

| Hạng mục                                                      | Spec nói gì                                                                                                                                      | Code thực tế                                                                                                                                                                                                                                      | Trạng thái                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cây `packages/shared`                                         | §4.1 dòng 283–312                                                                                                                                | Đủ; thêm `schemas/{auth,user,conversation,message}.schema.ts` đúng cây; thiếu `call.schema.ts`, `e2ee.schema.ts` (M5/M7)                                                                                                                          | Khớp                                                                                                                                                                                                                                                                       |
| Module `auth`, `users`, `conversations`, `messages`, `health` | §4.1 dòng 390–468: `*.routes/controller/service/repository/schema/model.ts` + `<module>.test.ts` + `.int.test.ts`                                | Có đủ routes/controller/service/repository/schema/model. **Thiếu** `users/users.test.ts`, `conversations/conversations.test.ts`, `messages/messages.test.ts`                                                                                      | Thiếu                                                                                                                                                                                                                                                                      |
| Module `presence`                                             | §4.1 dòng 431–438: `presence.service/repository/sweeper/schema.ts`, `typing.service.ts`                                                          | Có service, repository, typing.service, test. **Không có** `presence.sweeper.ts` (logic ở `presence.service.ts:101` `sweep()`, chạy `setInterval` dòng 170) và `presence.schema.ts`                                                               | Lệch                                                                                                                                                                                                                                                                       |
| Lua                                                           | `infra/redis/scripts/presence-touch.lua`, `presence-drop.lua`, `call-*.lua`                                                                      | `presence-touch.lua`, `presence-drop.lua`, `call-deadlines-claim.lua` có; `call-invite.lua`, `call-transition.lua` chưa (M5)                                                                                                                      | Khớp (M0–M4)                                                                                                                                                                                                                                                               |
| Handler socket                                                | `realtime/handlers/{session,conversation,message,typing,presence,call}.handler.ts`                                                               | Có 5/6, thiếu `call.handler.ts` (M5)                                                                                                                                                                                                              | Khớp (M0–M4)                                                                                                                                                                                                                                                               |
| File ngoài cây                                                | —                                                                                                                                                | `infra/redis/scripts.ts` (loader Lua), `test/chat.ts`, `test/db.ts` không có trong spec; `schema-options.ts`, `tuple.ts` có trong DB spec; `scripts/ci-env.mjs` có trong DG                                                                       | Thừa (nhẹ)                                                                                                                                                                                                                                                                 |
| E2E                                                           | §4.1 dòng 496–504: `auth, chat, group, presence, call, call-network, e2ee .spec.ts`                                                              | `auth, group, message, presence .spec.ts` — `message.spec.ts` thay cho `chat.spec.ts`                                                                                                                                                             | Lệch tên                                                                                                                                                                                                                                                                   |
| Ranh giới: model/repository chéo module                       | §5.2 dòng 1133: chỉ gọi service của module khác                                                                                                  | Grep `from '../<module>/…(model                                                                                                                                                                                                                   | repository)'`trong`modules/`(trừ test): **không có**. Import chéo duy nhất:`auth.service → users.service`, `conversations.service → users.service, messages.service`. `messages`, `presence` dùng port inject (`messages.service.ts:109-135`, `presence.service.ts:26-48`) | Khớp                                                                 |
| Ma trận §5.2 — tên method                                     | auth→users: `findByEmail, create, setPassword, lock`; conversations→users: `isBlockedEitherWay, getPublic`; messages→users: `isBlockedEitherWay` | auth dùng `create, findByEmailWithHash, findByIdWithHash, getMe, setPassword, setStatus`; conversations dùng `isBlockedEitherWay, blockedByMeAmong, blockersOf, getPublicMany`; messages port có thêm `getPublicMany` (`messages.service.ts:129`) | Lệch (nhẹ)                                                                                                                                                                                                                                                                 |
| `infra/*` không import `modules/*`                            | §5.2 dòng 1151                                                                                                                                   | `infra/db/indexes.ts:8-14` import 7 model; `infra/db/seed.ts:5` import `UserModel` (cây §4.1 dòng 334–335 đặt 2 file này trong `infra/db`)                                                                                                        | Lệch (spec tự mâu thuẫn, xem F.1)                                                                                                                                                                                                                                          |
| `jobs/*`, `main.ts` dùng repository                           | Không quy định                                                                                                                                   | `jobs/reencrypt-messages.ts:12`, `jobs/user-lock.ts:10`, `main.ts:14,18`                                                                                                                                                                          | Chưa quy định                                                                                                                                                                                                                                                              |
| Handler không truy cập model                                  | §5.2 dòng 1149                                                                                                                                   | Grep `model` trong `realtime/handlers`: không có                                                                                                                                                                                                  | Khớp                                                                                                                                                                                                                                                                       |
| `senderId` từ token                                           | §4.5 dòng 948                                                                                                                                    | `message.handler.ts:27-34` lấy `socket.data.auth.userId/deviceId`                                                                                                                                                                                 | Khớp                                                                                                                                                                                                                                                                       |
| ACK sau commit                                                | §7(b)                                                                                                                                            | `messages.service.ts:270-316`: `withTxn` (insert + re-check member + touchLastMessage + receipt + cursor) → sau commit mới `fanOut` và trả ACK                                                                                                    | Khớp                                                                                                                                                                                                                                                                       |
| Không log token/nội dung/SDP                                  | §11.3                                                                                                                                            | `logger.ts:10-37` redact authorization, cookie, csrf, password*, token*, content, contentEnc, ciphertext, body, sdp, candidate, iceServers, credential… Grep `logger.(info                                                                        | warn                                                                                                                                                                                                                                                                       | …)`có token/content/sdp: không có;`console.*` trong server: không có | Khớp |
| State machine cuộc gọi                                        | §8.2                                                                                                                                             | Chưa có (`modules/calls` không tồn tại)                                                                                                                                                                                                           | Thiếu (M5)                                                                                                                                                                                                                                                                 |
| `eslint-disable`/`@ts-ignore`/`any`                           | PRD §7.4                                                                                                                                         | 1 `eslint-disable-next-line` có lý do (`gateway.ts:29`); không có `@ts-ignore`, `@ts-expect-error`, `: any`, `as any` ngoài test                                                                                                                  | Khớp                                                                                                                                                                                                                                                                       |

### 3.2 packages/shared vs spec

| Hạng mục                     | Spec                                                      | Code                                                                                                                                    | Trạng thái             |
| ---------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Hằng số                      | §4.4.1: 71 export                                         | `constants.ts`: 71/71 cùng tên, cùng giá trị (kể cả `RATE_LIMITS`, `OUTBOX_RETRY_BACKOFF_MS`, `USERNAME_PATTERN`); không có export thừa | Khớp                   |
| Enum                         | §4.4.2: 19 export                                         | 19/19 khớp giá trị                                                                                                                      | Khớp                   |
| Mã lỗi + `ERROR_HTTP_STATUS` | §4.4.3: 20 mã + bảng HTTP                                 | Khớp hoàn toàn                                                                                                                          | Khớp                   |
| Socket event                 | §4.5: 35 event                                            | `EVENTS` có 35 giá trị; không có `message:ack`, `call:initiate`; mọi tên event nhắc trong kiến trúc đều có trong `EVENTS`               | Khớp                   |
| `IDEMPOTENCY_TTL_S`          | DB §5.2: `idem:conv` TTL 86400 s (không có hằng số chung) | Hằng cục bộ `conversations.service.ts:38` = `24*60*60`                                                                                  | Khớp giá trị (xem F.6) |

### 3.3 api_spec.yaml

| Path (spec)                                                                                                      | Code                            | Trạng thái    |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------- |
| `POST /auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/change-password`, `GET /auth/me`           | `auth.routes.ts:15-37`          | Đã làm        |
| `GET /users/search`, `PATCH /users/me`, `GET /users/blocked`, `POST/DELETE /users/{userId}/block`                | `users.routes.ts:15-19`         | Đã làm        |
| `GET/POST /conversations`, `GET/PATCH /conversations/{id}`, `POST …/members`, `PATCH/DELETE …/members/{userId}`  | `conversations.routes.ts:27-49` | Đã làm        |
| `GET …/messages`, `POST …/read`                                                                                  | `messages.routes.ts:21-32`      | Đã làm        |
| `GET /health`                                                                                                    | `health.routes.ts:8`            | Đã làm        |
| `GET /calls`, `GET /calls/ice-servers`                                                                           | —                               | Chưa làm (M5) |
| `GET /e2ee/devices`, `DELETE /e2ee/devices/{id}`, `PUT …/keys`, `POST …/prekeys`, `GET /e2ee/users/{id}/bundles` | —                               | Chưa làm (M7) |
| Route có trong code nhưng không có trong spec                                                                    | Không có                        | —             |

20/28 endpoint đã làm. Rate limit theo `x-rate-limit`: register→`register`, login→`login` (subject `ipEmail`), refresh & logout→`refresh`, me→`rest`, change-password→`changePassword` (`auth.routes.ts:15-37`) — khớp. Subject `ip+email`: xem **Lệch** ở 3.4.

Schema Zod request: định nghĩa trong `packages/shared/src/schemas/*` và được `spec:check` đối chiếu chéo với YAML (`endpoint 28`, `hằng số 71`). Không đối chiếu lại từng ràng buộc bằng tay trong lần audit này.

`x-socket-events` vs handler đăng ký (C→S): `conversation:join/leave`, `message:send/delivered/read/edit/delete`, `typing:start/stop`, `presence:subscribe` — đủ cho M0–M4. 10 event C→S `call:*` chỉ có ánh xạ rate-limit (`socket-rate-limit.ts:17-…`), chưa có handler (M5). S→C đã phát: `session:expired/revoked`, `conversation:updated/member-removed`, `message:new/status`, `typing:update`, `presence:snapshot/update`. Chưa phát: `call:incoming/ringing/accepted/answered-elsewhere/busy/…`, `e2ee:prekeys-low` (M5/M7).

### 3.4 database_schema.md

| Collection                      | Model                                               | Field (so với khối code §2) | Index                                                              | Trạng thái   |
| ------------------------------- | --------------------------------------------------- | --------------------------- | ------------------------------------------------------------------ | ------------ |
| `users`                         | `modules/users/user.model.ts`                       | Khớp                        | 3/3 khớp (`email_unique`, `username_unique`, `displayName_search`) | Khớp         |
| `refreshSessions`               | `modules/auth/refreshSession.model.ts`              | Khớp                        | 4/4 khớp                                                           | Khớp         |
| `userBlocks`                    | `modules/users/userBlock.model.ts`                  | Khớp                        | 2/2 khớp                                                           | Khớp         |
| `conversations`                 | `modules/conversations/conversation.model.ts`       | Khớp                        | 3/3 khớp                                                           | Khớp         |
| `conversationMembers`           | `modules/conversations/conversationMember.model.ts` | Khớp                        | 3/3 khớp                                                           | Khớp         |
| `messages`                      | `modules/messages/message.model.ts`                 | Khớp                        | 3/3 khớp                                                           | Khớp         |
| `messageReceipts`               | `modules/messages/messageReceipt.model.ts`          | Khớp                        | 2/2 khớp                                                           | Khớp         |
| `callHistory`                   | —                                                   | —                           | —                                                                  | Chưa có (M5) |
| `userDevices`, `oneTimePreKeys` | —                                                   | —                           | —                                                                  | Chưa có (M7) |

So field bằng các dòng khai báo cấp cao nhất của schema (bao gồm `select: false`, `default`, `required`); so index bằng toàn văn đối số `.index(...)` (gồm `unique`, `partialFilterExpression`, `expireAfterSeconds`, `name`).

**Key Redis** (`infra/redis/keys.ts` vs DB §5.2): đủ 14 pattern, cùng tên. TTL kiểm được: `session:revoked` `EX ACCESS_TOKEN_TTL_S` (`auth.repository.ts:79`), `typing` `PX TYPING_TTL_MS` (`presence.repository.ts:48`, `typing.service.ts:26`), `idem:conv` `EX 86400 NX` (`conversations.service.ts:280`), `presence:conns` `PEXPIRE` (`presence-touch.lua:9`) — khớp. Không nối chuỗi key ngoài `keys.ts` (SCAN dùng `keys.typing(conv,'')` làm prefix, `presence.repository.ts:56-60`).

| Hạng mục           | Spec                                                    | Code                                                | Trạng thái |
| ------------------ | ------------------------------------------------------- | --------------------------------------------------- | ---------- |
| Subject `ip+email` | DB §5.2 dòng 1351: `${ip}:${sha256(email).slice(0,16)}` | `http/middleware/rate-limit.ts:17`: `.slice(0, 32)` | **Lệch**   |

### 3.5 product_requirements.md

- FR M0–M4: mọi file checklist tồn tại (mục D) và `trace:check --strict` M0–M4 đủ 149/149 Test ID có test.
- Pass/fail lần này: unit shared/server/scripts xanh; client 177/178 (TC-GROUP-001 chập chờn). Toàn bộ Test ID tầng I cần Redis (TC-AC-001..018, TC-AUTH-_, TC-GROUP-_, TC-MSG-_, TC-NET-_, TC-PRES-*, TC-DB-0xx…) **không chạy được** → không xác nhận pass.
- Test hời hợt: quét 185 test mang `TC-` trong `server/src`, `client/src`, `client/e2e`, `packages/shared/src`, đánh dấu test không có `expect` nào ngoài `.status`. Kết quả 2 test (`key-ring.test.ts:19,23`) — **dương tính giả**: assertion nằm trong helper `expectFailWithoutValue` (dòng 7–16, kiểm loại lỗi và không lộ key). Không tìm thấy test chỉ kiểm status. (Heuristic, không thay thế review thủ công.)

### 3.6 ui_ux_spec.md

| Hạng mục          | Spec                                                                                                                        | Code                                                                                                                                                                                                                                                                                                                                                         | Trạng thái                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Route             | §2: `/`, `/login`, `/register`, `/chats`, `/chats/:conversationId`, `/call/:callId`, `/settings`, `/settings/:section`, `*` | `router.tsx:54-93`: đủ trừ `/call/:callId`                                                                                                                                                                                                                                                                                                                   | Khớp (thiếu `/call` — M5) |
| Guard             | `RequireAuth`, `RedirectIfAuthed`                                                                                           | `routes/guards/*`, dùng ở `router.tsx:56-86`                                                                                                                                                                                                                                                                                                                 | Khớp                      |
| Section cài đặt   | §2 dòng 268: `profile                                                                                                       | privacy                                                                                                                                                                                                                                                                                                                                                      | devices                   | blocked | theme | security` | `SettingsNav.tsx:15`: `profile, privacy, blocked, security` | Thiếu `devices` (M7), **`theme`** (không thuộc milestone nào — F.5) |
| Microcopy         | §3–§5                                                                                                                       | Quét 205 chuỗi tiếng Việt trong ngoặc kép (bỏ §3.5–3.7, §4.3–4.5 là cuộc gọi/E2EE): 51 chuỗi không thấy nguyên văn trong `client/src`; trừ chuỗi M5/M7 và chuỗi dựng từ template (`Nhóm đã đạt tối đa ${GROUP_MAX_MEMBERS} thành viên` `vi.ts:151`, `Truy cập lúc ${hhmm} ${ddmm}` `vi.ts:205`), chỉ còn `"Theo hệ thống"`, `"Sáng"` (ThemeSection) là thiếu | Thiếu (ThemeSection)      |
| "Mã hóa đầu-cuối" | Chỉ sau M7                                                                                                                  | Không xuất hiện trong `client/src`, `server/src`, `packages`                                                                                                                                                                                                                                                                                                 | Khớp                      |
| Design tokens     | §1.1–1.2                                                                                                                    | `styles/index.css`, `tailwind.config.ts` có; không đối chiếu lại từng giá trị lần này (audit trước đã khớp)                                                                                                                                                                                                                                                  | Chưa kiểm lại             |

### 3.7 development_guide.md

| Hạng mục                   | Spec                                  | Code                                                                                                                                                                      | Trạng thái     |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Script `package.json` gốc  | §2.3                                  | Toàn bộ `scripts`, `engines`, `workspaces` khớp nguyên văn; spec không ghi `devDependencies` (code có 15 gói ghim phiên bản)                                              | Khớp           |
| `infra/.env.example`       | §4.1 (6 biến)                         | Khớp nguyên văn                                                                                                                                                           | Khớp           |
| `server/.env.example`      | §4.2 (32 biến)                        | Khớp nguyên văn                                                                                                                                                           | Khớp           |
| `client/.env.example`      | §4.3 (4 biến)                         | Cùng biến; khác 1 dòng comment: `(development_guide.md §9.7)` vs `(mục 9.7)`                                                                                              | Khớp (comment) |
| `infra/docker-compose.yml` | §3.2                                  | Chỉ khác kiểu nháy `'` vs `"` (Prettier); service mongo (`--replSet rs0`, healthcheck `init-replica.js`), redis, coturn, mongo-express (profile tools) đều có healthcheck | Khớp           |
| `.github/workflows/ci.yml` | §8.7                                  | Khớp (bỏ qua khoảng trắng và kiểu nháy)                                                                                                                                   | Khớp           |
| `db:migrate`               | §2.4: `tsx … src/infra/db/migrate.ts` | Script có (`server/package.json:14`) nhưng **file không tồn tại**                                                                                                         | Thiếu          |

---

## D. Tiến độ theo checklist (bước 4)

### M0 — 6/7 Xong, 1 chưa xác minh

| Mục                                | Trạng thái             | Bằng chứng                                              |
| ---------------------------------- | ---------------------- | ------------------------------------------------------- |
| File gốc (10 file)                 | Xong                   | Đủ 10 file                                              |
| `infra/*` + `infra:up` healthy     | **Dở (chưa xác minh)** | File đủ; Docker không chạy nên không kiểm được healthy  |
| `scripts/*` (4 file)               | Xong                   | Đủ                                                      |
| `packages/shared` (10 file + test) | Xong                   | Đủ; `__tests__/{text,cursor,compare,schemas,…}.test.ts` |
| Server M0 (25 mục)                 | Xong                   | Đủ, kể cả `modules/health/*`                            |
| Client M0 (11 mục)                 | Xong                   | Đủ                                                      |
| CI `ci.yml`                        | Xong                   | Khớp §8.7                                               |

### M1 — 3/3 Xong

Server: `auth/*`, `refreshSession.model.ts`, `users/*` (+ 2 model), `password.ts`, `jwt.ts`, `authenticate.ts`, `csrf.ts`, `rate-limit.ts`, `socket-auth.ts`, `socket-rate-limit.ts`, `session.handler.ts`, `jobs/user-lock.ts` — đủ. Client: `features/auth/{LoginPage,RegisterPage,AuthCard,SessionModal,useSessionLifecycle}`, `lib/api/refresh.ts`, `lib/socket/{socket,emit}.ts`, `stores/{auth,socket}.store.ts`, `ConnectionBanner.tsx`, `ProfileSection.tsx`, `SecuritySection.tsx` — đủ. `db:seed`: `infra/db/seed.ts` có (không chạy lại được vì không có Mongo).

### M2 — 2/2 Xong

Server: `conversations/*` + 2 model, `message.model.ts`, `conversation.handler.ts` — đủ. Client: 7 file `features/conversations/*`, 6 file `features/groups/*` (kể cả `RenameGroupDialog`), `ChatRoomPane.tsx`, `RoomNotFound.tsx`, `SystemMessage.tsx`, `RoomMenu.tsx` — đủ.

### M3 — 2/2 Xong

Server: `messages/*` (service, `receipts.service.ts`, repository, `messageReceipt.model.ts`, `message.crypto.ts`), `message.handler.ts`, `jobs/reencrypt-messages.ts` — đủ. Client: 18 component/hook `features/chat/*`, `lib/outbox/`, `outbox.store.ts`, `event-dedupe.ts`, `sync.ts`, `lib/time/`, `LiveRegions.tsx`, `UnreadBadge.tsx`, `BlockedSection.tsx` — đủ.

### M4 — 2/2 Xong (có lệch tên file)

`modules/presence/{presence.service,presence.repository,typing.service}.ts`, `presence-touch.lua`, `presence-drop.lua`, `presence.handler.ts`, `typing.handler.ts`; client `features/presence/{OnlineDot.tsx,usePresence.ts}`, `presence.store.ts`, `typing.store.ts`, `TypingIndicator.tsx`, `PrivacySection.tsx`. Checklist ghi "sweeper" — có dưới dạng hàm `sweep()` trong `presence.service.ts:101`, không phải file `presence.sweeper.ts`.

### M5–M7

| Milestone | Checklist | Bằng chứng                                                                                                                                                                 |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M5        | 0/3       | Không có `server/src/modules/calls`, `realtime/handlers/call.handler.ts`, `infra/turn/xirsys.client.ts`, `client/src/lib/webrtc`, `features/calls`, `stores/call.store.ts` |
| M6        | 0/7       | Không có `load/`; Lighthouse/coverage/audit chưa chạy                                                                                                                      |
| M6.5      | 0/5       | Không có `server/Dockerfile`, `client/Dockerfile`, `.dockerignore`, `infra/docker-compose.prod.yml`, `infra/nginx/nginx.conf`, `.github/workflows/cicd-docker.yml`         |
| M7        | 0/4       | Không có `modules/e2ee`, `lib/e2ee`, `E2eeBadge.tsx`, `DevicesSection.tsx`                                                                                                 |

**Kết luận DoD:** không milestone nào đạt DoD trong lần audit này (lint đỏ; integration/E2E không xác minh được; TC-GROUP-001 và TC-ARCH-003 chập chờn).

---

## E. Rủi ro bảo mật nhanh (bước 5)

| Kiểm tra                   | Kết quả                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Secret hardcode            | Không tìm thấy secret thật (`git grep` cho `secret                                                         | password | XIRSYS_                      | JWT_ … = '<≥8 ký tự>'`ngoài`.md/.yaml/.example`). Chỉ có nhãn UI ở `vi.ts` và giá trị giả trong test (`**tests**/bundle-secrets.test.ts:13` `fake-jwt-secret-value-…`) |
| `mongodb://user:pass@`     | Không tìm thấy                                                                                             |
| `.env` bị git theo dõi     | Không — `git ls-files` chỉ có 3 `.env.example`; `git log --all -- server/.env infra/.env client/.env` rỗng |
| `dangerouslySetInnerHTML`  | Không dùng (chỉ xuất hiện trong comment `MessageBubble.tsx:2` ghi rõ không dùng)                           |
| Phân trang bằng `skip`     | Không tìm thấy (`\.skip\(                                                                                  | \$skip   | skip:` rỗng trong code chạy) |
| "Mã hóa đầu-cuối" trước M7 | Không tìm thấy                                                                                             |
| Bundle secret              | `check-bundle-secrets` OK (6 giá trị) trong `npm run build`                                                |
| `npm audit`                | Chưa chạy lại lần này (audit trước: 5 lỗ hổng, cần duyệt nâng version)                                     |

---

## F. Đề xuất sửa spec (KHÔNG tự sửa — chờ duyệt)

1. **(Còn tồn) Mâu thuẫn `infra` ↔ `modules`.** Kiến trúc §5.2 dòng 1151 cấm `infra/*` import `modules/*`, nhưng cây §4.1 dòng 334–335 đặt `indexes.ts`/`seed.ts` trong `infra/db` và DB §6.3 yêu cầu chúng import model. Đề xuất: ghi ngoại lệ cho 2 file này (composition root) hoặc chuyển sang `server/src/jobs/`.
2. **(Mới) Ma trận §5.2 liệt kê tên method lệch với code.** Ví dụ `auth → users (findByEmail, create, setPassword, lock)` trong khi code dùng `findByEmailWithHash, findByIdWithHash, getMe, setStatus`; `conversations → users` dùng thêm `blockedByMeAmong, blockersOf, getPublicMany`. Đề xuất: cập nhật danh sách method trong ma trận (hoặc chỉ giữ cột ✔/✘, bỏ tên method).
3. **(Mới) `presence.sweeper.ts`, `presence.schema.ts`, `<module>.test.ts`, `chat.spec.ts`.** Cây §4.1 bắt buộc các file này; code gộp sweeper vào service, không có schema riêng (payload presence nằm ở `socket.schema.ts` của shared), test unit của 3 module thay bằng integration, E2E đặt tên `message.spec.ts`. Cần quyết định: tách file theo spec, hay sửa cây §4.1 cho khớp thực tế.
4. **(Còn tồn) Subject rate-limit `slice(0,16)`** vs code `slice(0,32)`: nếu 32 hex được chấp nhận (giảm va chạm) thì sửa DB §5.2 dòng 1351; nếu không thì sửa code.
5. **(Mới) `ThemeSection` không thuộc checklist milestone nào.** UI §2 dòng 268 và §3.8 dòng 849 yêu cầu section `theme` với radio "Theo hệ thống"/"Sáng"/"Tối", nhưng DG §7 không giao cho milestone nào. Đề xuất thêm vào checklist M6 (hoặc M1 phần Settings).
6. **(Mới) `IDEMPOTENCY_TTL_S`** được dùng như hằng số (`conversations.service.ts:38`) nhưng không có trong `constants.ts` (§4.4.1). Theo CLAUDE.md hằng số dùng chung nằm trong `packages/shared`; nếu chỉ dùng ở server thì ghi rõ trong spec là hằng cục bộ được phép.
7. **(Còn tồn) `trace:check` không kiểm pass** (DG §8.8, `check-traceability.mjs:57` chấp nhận `.skip/.todo`). Đề xuất: Gate yêu cầu kết quả reporter (JSON) cho Test ID, hoặc cấm `.skip/.todo` cho Test ID thuộc Gate.
8. **(Còn tồn) Integration cần Redis có mật khẩu** nhưng `server/src/test/global-setup.ts:8` mặc định `redis://127.0.0.1:6379/15` không mật khẩu; khi Redis vắng, 10 file lỗi `beforeAll` và 103 test bị skip. Đề xuất DG §6.7 yêu cầu `globalSetup` fail-fast với thông báo rõ ("Cần npm run infra:up") thay vì lỗi kết nối rải rác.
9. **(Còn tồn) `db:migrate`** (DG §2.4, DB §6.4) trỏ tới `src/infra/db/migrate.ts` nhưng không milestone nào yêu cầu tạo file. Đề xuất thêm vào checklist M0 hoặc M6.
10. **(Còn tồn) Chuỗi lỗi mặc định theo `ErrorCode`** chưa có bảng nguyên văn trong UI §5 (UI §5.1 yêu cầu ánh xạ qua `i18n/errors.ts`).
11. **(Mới) `.prettierignore`** không được spec quy định (DG §8.3). File cá nhân của IDE (`.vscode/`) làm `npm run lint` đỏ. Đề xuất DG §8.3 liệt kê nội dung `.prettierignore` (có `.vscode`) hoặc thêm `.vscode/` vào `.gitignore`.
