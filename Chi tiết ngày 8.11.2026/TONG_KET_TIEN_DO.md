# HUSTALO — Tổng kết tiến độ ngày 08/11/2026

- **Commit được kiểm tra:** `b398d2c` (`main`, đã đồng bộ với `origin/main`), 85 commit kể từ ngày 27/10/2026.
- **Giấy phép:** GPL-3.0-only (do dùng thư viện Signal, D-12).
- **Môi trường kiểm tra:** Windows 11, Node 22. Docker Desktop **không chạy** trong lượt này, nên không chạy được integration test và E2E local (mục 3).
- **Tài liệu chi tiết:** `docs/STATUS.md` (cập nhật lần cuối 04/11), `docs/KNOWN_ISSUES.md`, `docs/proposals/tach-repo-client.md`.

## 1. Tóm tắt

- **Đã làm xong M0 đến M7.** Phần tự động hóa của toàn bộ milestone đã xong: auth, hội thoại/nhóm, tin nhắn, presence, gọi voice/video 1-1, hardening, deploy và Secret Chat (E2EE). Cả 251/251 Test ID trong Traceability Matrix đều đã có test.
- **Production đã chạy (05/11/2026).** Workflow `cicd-docker` (run `42031698099`) build image, deploy, rồi verify, và cả 3 job đều xanh. Commit deploy là `b398d2c`, chứng chỉ TLS đã có (`HUSTALO_TLS=ready`), các container mongo, redis, server, client, nginx đều healthy. Kiểm tra sau deploy: TC-ARCH-016 pass 4/4, smoke TC-ARCH-017 (2 user nhắn tin realtime qua `wss://`) pass 1/1.
- **Việc mới từ 05/11: tách client sang repo `HustAlo-client`.** Spec đã được duyệt (D-24, D-25, R-06) và `@hustalo/shared` v1.0.0 đã phát hành. Còn lại bước 2–6 (mục 5).
- **Việc còn lại chủ yếu là việc thủ công và việc cần hạ tầng.** Gồm test tay cuộc gọi trên thiết bị thật, diễn tập backup trên staging, và thử 2 instance sau proxy sticky. Ngoài ra còn 4 vấn đề test chập chờn đang chờ quyết định cách xử lý.

## 2. Tiến độ theo milestone

| Milestone                    | Nội dung chính                                                                                      | Trạng thái                          | Test ID | Còn lại                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------- | ------- | --------------------------------------------------------------------------- |
| M0 — Nền tảng                | Monorepo, hợp đồng chung (35 event, enum, mã lỗi), Mongo rs0, Redis, crypto, health, CI             | ✅ Xong                             | 14/14   | —                                                                           |
| M1 — Auth & hồ sơ            | Đăng ký/đăng nhập, refresh token, phiên, hồ sơ, bảo mật                                             | ✅ Xong                             | 30/30   | —                                                                           |
| M2 — Hội thoại & nhóm        | Danh sách chat, tìm kiếm, DIRECT, nhóm (tạo, đổi tên, vai trò, thêm/xóa thành viên)                 | ✅ Xong                             | 20/20   | —                                                                           |
| M3 — Tin nhắn & receipt      | Gửi (outbox, idempotency), lịch sử cursor, đã nhận/đã xem, sửa/thu hồi, chặn, đồng bộ khi nối lại   | ✅ Xong                             | 70/70   | —                                                                           |
| M4 — Presence & typing       | Online/lastSeen, đang gõ, quyền riêng tư                                                            | ✅ Xong                             | 15/15   | —                                                                           |
| M5 — Cuộc gọi 1-1            | State machine, signaling, ICE/TURN, màn hình gọi, PiP, đổi camera, ICE restart, lịch sử cuộc gọi    | ✅ Xong phần tự động                | 74/74   | Test tay §6.2 (Chrome, Safari 17) và TC-CALL-NET-001 trên điện thoại thật   |
| M6 — Hardening               | Tải (k6), Lighthouse, audit, coverage, backup/restore, 2 instance `redis-streams`                   | ✅ Xong phần tự động                | 12/12   | Diễn tập backup trên staging thật; thử 2 instance sau proxy sticky          |
| M6.5 — Deploy                | Docker image, compose prod, nginx + TLS, workflow `cicd-docker`                                     | ✅ **Đã deploy production (05/11)** | 2/2     | Nên thêm secret `DEPLOY_KNOWN_HOSTS` nếu chưa có                            |
| M7 — E2EE (Secret Chat)      | Signal (X3DH + Double Ratchet), device key, prekey bundle, safety number, IndexedDB, UI Secret Chat | ✅ Xong phần tự động                | 25/25   | Gửi issue upstream V-1 (thư viện log session ra console, đã chặn ở adapter) |
| Tách repo client (D-24/D-25) | Client chuyển sang `HustAlo-client`, shared phát hành bằng tarball có phiên bản                     | 🟡 Đang làm (2/7 bước)              | —       | Bước 2–6 (mục 5)                                                            |

## 3. Kết quả kiểm tra hôm nay (08/11/2026)

| Lệnh / nguồn                                 | Kết quả                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                          | ✅ Xanh                                                                                                                     |
| `npm run lint` (ESLint + Prettier + Redocly) | ✅ Xanh                                                                                                                     |
| `npm run test:unit`                          | ✅ scripts 13/13 · shared 51/51 · server 120/120 (+4 test `deploy.test.ts` chỉ chạy khi có `E2E_BASE_URL`) · client 325/325 |
| `npm run trace:check -- --strict`            | ✅ 251/251 Test ID có test                                                                                                  |
| `npm run spec:check`                         | ✅ FR 58 · AC 102 · EC 106 · event 35 · endpoint 29 · hằng số 72                                                            |
| `npm audit --omit=dev --audit-level=high`    | ✅ 0 high/critical; còn 2 lỗ hổng moderate ở `react-router` (muốn sửa phải lên v7, có breaking change)                      |
| `npm run test:integration`                   | ⏸ Không chạy vì Docker tắt. Lần gần nhất (04/11): 201/201                                                                   |
| E2E Playwright local                         | ⏸ Không chạy vì Docker tắt. Lần gần nhất (04/11): 107/109, 2 test chập chờn chạy lại riêng thì pass                         |
| GitHub Actions `ci` trên `main` (05/11)      | ✅ Xanh (khoảng 23 phút, gồm E2E)                                                                                           |
| GitHub Actions `cicd-docker` (05/11)         | ✅ build-push · deploy · verify đều xanh                                                                                    |
| GitHub Actions `release-shared` (05/11)      | ✅ Phát hành `@hustalo/shared` 1.0.0 (tag `shared-v1.0.0`)                                                                  |

### Chỉ số phi chức năng (đo ngày 04/11, chưa có thay đổi code ảnh hưởng)

| NFR    | Ngưỡng                    | Kết quả                                                                     |
| ------ | ------------------------- | --------------------------------------------------------------------------- |
| NFR-01 | p95 ACK tin nhắn ≤ 300 ms | 82 ms (k6: 50 user, 5 tin/s, 5 phút, 0 lỗi; đo trên bản build)              |
| NFR-05 | LCP ≤ 2,5 s; JS ≤ 300 KB  | LCP 2,16–2,25 s; perf 0,91–0,94; a11y 1; JS khởi tạo 177,9 KB gzip          |
| NFR-09 | 1000 socket đồng thời     | 1000/1000 socket, 200/200 cuộc gọi CONNECTED (p95 setup 391 ms), RSS 255 MB |
| NFR-13 | 0 lỗ hổng high/critical   | Đạt                                                                         |
| NFR-14 | Coverage module server    | 98,4% dòng, 93,7% nhánh; `packages/shared` 91,2%                            |

## 4. Quy mô mã nguồn (file `.ts`/`.tsx` đã commit)

| Thư mục               | Số file | Số dòng    | File test |
| --------------------- | ------- | ---------- | --------- |
| `packages/shared/src` | 26      | 1.914      | 8         |
| `server/src`          | 142     | 15.094     | 36        |
| `client/src`          | 205     | 17.408     | 43        |
| `client/e2e`          | 10      | 2.274      | 8         |
| **Tổng**              | **383** | **36.690** | **95**    |

Server có 8 module: `auth`, `users`, `conversations`, `messages`, `presence`, `calls`, `e2ee`, `health`.

## 5. Tách client sang repo `HustAlo-client`

Chủ dự án đề xuất tách để làm riêng phần client. Đề xuất đã được duyệt theo khuyến nghị ngày 05/11 (chi tiết ở `docs/proposals/tach-repo-client.md`). Tên event, enum, mã lỗi, hằng số, API và hành vi người dùng đều giữ nguyên.

| Bước | Việc                                                                                                                | Trạng thái                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Sửa spec (kiến trúc D-24, D-25, R-06, §4; development_guide §2, §4–§9; CLAUDE.md)                                   | ✅ Đã merge (PR #4)                                                                                                                                            |
| 1    | Đóng gói shared ra `dist/`, workflow `release-shared.yml`, phát hành `shared-v1.0.0`                                | ✅ Đã merge (PR #6), đã có Release                                                                                                                             |
| 2    | `infra/client.version`, `CLIENT_IMAGE_TAG`, `cicd-docker` dùng image client đã ghim, `trace:check` quét repo client | ⬜ Chưa làm (chưa có `infra/client.version`)                                                                                                                   |
| 3    | `git subtree split --prefix=client` sang repo mới, đổi `@hustalo/shared` sang tarball, Dockerfile mới               | ⬜ Chưa làm. Repo `HustAlo-client` hiện chứa một dự án Vite + React 19 khác (`figma-make-app`, 2 commit ngày 25/10 và 01/11), không phải bản tách từ `client/` |
| 4    | CI và workflow Docker của repo client                                                                               | ⬜ Chưa làm                                                                                                                                                    |
| 5    | Ghim phiên bản client trong monorepo, rồi deploy                                                                    | ⬜ Chưa làm                                                                                                                                                    |
| 6    | Xóa `client/` khỏi monorepo                                                                                         | ⬜ Chưa làm (chỉ làm sau khi repo client xanh và đã deploy được một lần)                                                                                       |

> Trước bước 3, cần chủ dự án quyết định: giữ, thay thế hay gộp phần code đang có trong `HustAlo-client` với bản tách từ `client/`.

## 6. Dòng thời gian

| Ngày        | Nội dung                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27/10       | Thêm `.spec/`, review spec. M0: monorepo, shared (35 event), server hạ tầng, khung client, CI                                                                     |
| 28/10       | M1: auth và users (server và client), E2E auth trên 3 trình duyệt                                                                                                 |
| 29/10       | M2: hội thoại và nhóm. Bắt đầu M3 phía server                                                                                                                     |
| 30/10       | M3 client (outbox, receipt, sửa/thu hồi, chặn). M4: presence, lastSeen, typing                                                                                    |
| 01/11–02/11 | Spec M5. M5 server (state machine, Lua, sweeper, ICE) và client (WebRTC, màn hình gọi, PiP, wake lock)                                                            |
| 03/11       | Đóng M1–M6                                                                                                                                                        |
| 04/11       | M5 phát hiện video bị dừng khi bên kia tắt camera. M6 tự host Inter, nâng zod. M7 (4 đợt) E2EE và review thư viện Signal. Sửa KI-10, KI-13. Sửa CI/CD (PR #1, #2) |
| 05/11       | Smoke production tự tạo tài khoản (PR #3). **Deploy production thành công.** Spec tách repo client (PR #4), phát hành shared 1.0.0 (PR #6)                        |
| 06/11–08/11 | Chưa có commit mới                                                                                                                                                |

## 7. Vấn đề đã biết (`docs/KNOWN_ISSUES.md`)

| Nhóm                          | Mục                                                                                                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cần quyết định cách xử lý** | KI-01 `TC-AC-003` (chênh lệch thời gian đăng nhập dưới tải) · KI-02 `TC-AC-061` (grace của presence) · KI-03 test unit client timeout 5 s khi máy tải nặng · KI-09 `TC-AC-033` WebKit timeout. Cả 4 đều là test chập chờn do máy dev bị tải nặng, chưa thấy lỗi logic |
| Đã chấp nhận                  | KI-04 rate limit gọi +1 khi glare · KI-05 đổi `tabId` để lách rate limit theo tab · KI-07 E2E mạng cuộc gọi chỉ chạy Chromium · KI-08 đo NFR trên bản build · KI-11 vượt giới hạn 5 device khi đăng ký đồng thời · KI-12 bản rõ tin SECRET trong IndexedDB            |
| Đã sửa                        | KI-06 LCP do Google Fonts · KI-10 mở SECRET tiêu thụ prekey · KI-13 race cache danh sách nhóm                                                                                                                                                                         |

## 8. Việc còn lại

| #   | Mức  | Việc                                                                                                                                     | Người làm / điều kiện           |
| --- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | Cao  | Quyết định xử lý code đang có trong `HustAlo-client`, rồi làm bước 2–6 của việc tách repo (mục 5)                                        | Chủ dự án quyết định, agent làm |
| 2   | Cao  | Cập nhật `docs/STATUS.md`: tài liệu này vẫn ghi M6.5 "chưa deploy", nhưng production đã chạy từ 05/11 tại `b398d2c`                      | Agent                           |
| 3   | TB   | Test tay M5 §6.2 (Chrome, Safari 17) và TC-CALL-NET-001 trên điện thoại thật                                                             | Chủ dự án                       |
| 4   | TB   | Diễn tập backup/restore trên staging thật; thử 2 instance sau proxy sticky                                                               | Cần hạ tầng                     |
| 5   | TB   | Chạy lại toàn bộ integration test và E2E 3 trình duyệt khi máy rảnh (cần bật Docker)                                                     | Agent                           |
| 6   | TB   | Quyết định cách xử lý 4 test chập chờn KI-01, KI-02, KI-03, KI-09                                                                        | Chủ dự án duyệt                 |
| 7   | Thấp | Trên production: xác nhận CSP `script-src 'self'` không chặn chunk thư viện Signal. Smoke hiện chỉ thử chat thường, chưa thử Secret Chat | Agent                           |
| 8   | Thấp | 2 lỗ hổng moderate của `react-router` (cần lên v7)                                                                                       | Có thể làm khi tách repo client |
| 9   | Thấp | Thêm secret `DEPLOY_KNOWN_HOSTS` (nếu chưa có) để không phải tin host key SSH ở lần kết nối đầu (TOFU)                                   | Chủ dự án                       |
| 10  | Thấp | Gửi issue upstream V-1 cho thư viện Signal                                                                                               | Chủ dự án                       |
