# HUSTALO — Trạng thái dự án

- **Ngày kiểm tra:** 2026-10-28 (chạy lại sau commit `515da1f`)
- **Nhánh:** `main` (ahead 2 so với `origin/main`, chưa push)
- **Commit cuối:** `515da1f fix: align env and dev https with spec (DG-01, EC-SEC-009)` (trước đó `4ed6d70 spec: add deployment (M6.5) and sync folder tree`)
- **Phạm vi:** kết quả lệnh tự động ở mục 2 là số chạy thật. Cột "% checklist" chưa audit lại toàn bộ (chi tiết audit ở `docs/SPEC_CONFORMANCE.md`).

> ⚠️ Các lệnh ở mục 2 chạy trên **working tree**, gồm cả thay đổi **chưa commit** có sẵn (server M1: `auth.*`, `users.*`, `socket-auth.ts`, `password.ts`, `main.ts`, `test/factories.ts`, `test/socket-client.ts`, `test/db.ts`, `vitest.integration.config.ts`, `user.schema.ts`…). Kết quả xanh phụ thuộc vào các thay đổi này; HEAD đã commit chưa được kiểm riêng.

## 1. Tổng quan milestone

| Milestone               | Trạng thái                  | % checklist                               | Test Gate có test pass / tổng | Ghi chú                                                                                                       |
| ----------------------- | --------------------------- | ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| M0 — Nền tảng           | **Đang làm** (chưa đạt DoD) | 7/7 (mục `infra:up`: 3 container healthy) | 14/14                         | Gate thêm `TC-SEC-009` (EC-SEC-009). typecheck, lint, unit, integration xanh; `TC-ARCH-003` pass 3/3 lần chạy |
| M1 — Auth & hồ sơ       | **Đang làm**                | server gần đủ, client chưa có             | 30/30 (tầng U/I)              | Server M1 còn **chưa commit**. Client M1 chưa có (`client/src/features/` chỉ có `chat/`), chưa có E2E         |
| M2 — Hội thoại & nhóm   | Chưa bắt đầu                | 0/2                                       | 0/20                          |                                                                                                               |
| M3 — Tin nhắn & receipt | Chưa bắt đầu                | 0/2                                       | 5/70                          | Các phần U làm sẵn từ M0                                                                                      |
| M4 — Presence & typing  | Chưa bắt đầu                | 0/2                                       | 0/15                          |                                                                                                               |
| M5 — Cuộc gọi 1-1       | Chưa bắt đầu                | 0/3                                       | 0/74                          |                                                                                                               |
| M6 — Hardening          | Chưa bắt đầu                | 0/7                                       | 3/12                          | `TC-AC-107`, `TC-ARCH-011`, `TC-SEC-006`                                                                      |
| M6.5 — Deploy           | Chưa bắt đầu (spec mới)     | 0/5                                       | 0/2                           | `TC-ARCH-016`, `TC-ARCH-017`; xem development_guide.md §9                                                     |
| M7 — E2EE               | Chưa bắt đầu                | 0/4                                       | 0/25                          |                                                                                                               |

> "Test Gate có test pass" = số Test ID trong Gate có test (theo `trace:check`) và mọi test đó pass trong lần chạy ở mục 2 (unit và integration lần này không có test skip/todo). `trace:check` tự nó chỉ kiểm có tên test, không kiểm pass.

## 2. Kết quả kiểm tra tự động

| Lệnh                                  | Kết quả           | Chi tiết                                                                           |
| ------------------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `npm run typecheck`                   | ✅ PASS           | 0 lỗi (shared, server, client)                                                     |
| `npm run lint`                        | ✅ PASS           | ESLint 0 lỗi/0 cảnh báo · Prettier sạch · Redocly valid (1 ngoại lệ có chủ đích)   |
| `npm run test:unit`                   | ✅ PASS           | scripts 5/5 (node:test) · shared 25/25 · server 45/45 · client 14/14               |
| `npm run test:integration` lần 1      | ✅ PASS           | 9/9 file · 59/59 test, 0 skip                                                      |
| `npm run test:integration` lần 2      | ✅ PASS           | 9/9 file · 59/59 test                                                              |
| `npm run test:integration` lần 3      | ✅ PASS           | 9/9 file · 59/59 test                                                              |
| `npm run spec:check`                  | ✅ PASS           | `FR 58 · AC 102 · EC 106 · event 35 · endpoint 27 · hằng số 71`                    |
| `trace:check --milestone M0 --strict` | ✅                | 14/14 ID có test                                                                   |
| `trace:check --milestone M1 --strict` | ✅                | 30/30 ID có test                                                                   |
| `trace:check` M2..M7 (không strict)   | ❌ (đúng kỳ vọng) | M2 0/20 · M3 5/70 · M4 0/15 · M5 0/74 · M6 3/12 · M6.5 0/2 · M7 0/25               |
| `npm run build`                       | ✅ PASS           | server tsup OK · client vite 77.27 kB gzip JS · bundle-secrets OK (6 giá trị)      |
| Vite dev (DG-01)                      | ✅                | Không có `VITE_HTTPS` → phục vụ `http://localhost` (HTTP 200), không cần chứng chỉ |

Docker: `hustalo-redis-1`, `hustalo-mongo-1`, `hustalo-coturn-1` đều healthy.

## 3. Việc cần làm tiếp

| #   | Mức      | Việc                                                                                                                                                | File liên quan                                                 | ID spec                                             |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| 1   | **Cao**  | Review và commit phần server M1 đang chưa commit (kết quả xanh ở mục 2 phụ thuộc vào nó); sau đó chạy lại bộ lệnh trên HEAD                         | `server/src/modules/auth/*`, `users/*`, `realtime/*`, `test/*` | Gate M0/M1                                          |
| 2   | **Cao**  | Client M1: `features/auth/*`, `lib/api/refresh.ts`, `lib/socket/*`, `stores/socket.store.ts`, `ConnectionBanner.tsx`, `features/settings/*`; E2E M1 | `client/src/...`, `client/e2e/`                                | FR-AUTH-001..007, FR-USER-001..003, Checklist M1 #2 |
| 3   | **Cao**  | Hoàn thiện `client/playwright.config.ts` theo §6.6 (fake media, `webServer`) khi có E2E đầu tiên                                                    | `client/playwright.config.ts`                                  | DG §6.6                                             |
| 4   | **TB**   | Subject rate-limit `ip+email` dùng `sha256(email).slice(0,32)`, spec quy định `slice(0,16)`                                                         | `server/src/http/middleware/rate-limit.ts:17`                  | DB §5.2, FR-SEC-005                                 |
| 5   | **TB**   | Thiếu `server/src/modules/users/users.test.ts` (quy ước `<module>.test.ts`); xác minh `npm run db:seed` chạy được                                   | `server/src/modules/users/`, `server/src/infra/db/seed.ts`     | Kiến trúc §4.1, Checklist M1 #1, #3                 |
| 6   | **Thấp** | Dọn worktree mồ côi `.claude/worktrees/spec-review-fixes`, nhánh `worktree-spec-review-fixes`, `feat/m1-auth` (gitlink `2feaef8` chưa merge)        | `.claude/worktrees/`, các nhánh cục bộ                         | —                                                   |
| 7   | **Thấp** | `trace:check` đếm cả `it.skip`/`it.todo` là "có test" → nên kiểm thêm pass                                                                          | `scripts/check-traceability.mjs`                               | DG §8.8                                             |
| 8   | **Sau**  | M6.5 Deploy: Dockerfile, compose prod, nginx, `cicd-docker.yml`, VM + domain                                                                        | development_guide.md §9                                        | AC-ARCH-016, AC-ARCH-017                            |
