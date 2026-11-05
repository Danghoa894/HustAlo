# HUSTALO — Trạng thái dự án

- **Ngày kiểm tra:** 2026-11-04 (đóng M5, M6, M6.5 phần file; xong phần tự động của M7)
- **Nhánh:** `main`. M5/M6/M6.5 đã push (`6d8023a..95f1ec8`). M7 gồm 4 commit tiếp theo: `1cceb60`, `9f64807`, `6169685` và commit Đợt 4.
- **Giấy phép:** GPL-3.0-only (theo thư viện Signal D-12; chủ dự án duyệt ngày 2026-11-04). Xem `LICENSE` và `docs/SIGNAL_LIBRARY_REVIEW.md`.
- **Môi trường:** Windows 11, Docker Desktop (Mongo rs0, Redis, coturn local), Node 22.14.
- Chi tiết vấn đề đã biết: `docs/KNOWN_ISSUES.md` (KI-01…KI-13).

## 1. Tổng quan milestone

| Milestone         | Trạng thái                 | Test ID có test (`trace:check --strict`) | Ghi chú                                                                                                               |
| ----------------- | -------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| M0–M4             | Xong                       | đủ                                       | Unit + integration xanh; E2E chạy lại trong Gate M6                                                                   |
| M5 — Cuộc gọi 1-1 | **Xong phần tự động**      | 74/74                                    | Còn test tay §6.2 (Chrome, Safari 17 — bỏ Firefox theo quyết định 2026-11-04) và TC-CALL-NET-001 trên điện thoại thật |
| M6 — Hardening    | **Xong phần tự động**      | 12/12                                    | Còn diễn tập backup trên staging thật và smoke 2 instance sau proxy sticky (cần hạ tầng)                              |
| M6.5 — Deploy     | **Xong phần file + image** | 2/2                                      | Chưa deploy: cần VM, domain, secret Docker Hub/GitHub                                                                 |
| M7 — E2EE         | **Xong phần tự động**      | 25/25                                    | Unit + integration + E2E 3 trình duyệt xanh; review thư viện R-04 xong (`docs/SIGNAL_LIBRARY_REVIEW.md`)              |

## 2. Kết quả kiểm tra (2026-11-04, sau M7)

| Lệnh / phép đo                                                        | Kết quả                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                   | ✅                                                                                                                                    |
| `npm run lint` (ESLint + Prettier + Redocly)                          | ✅                                                                                                                                    |
| `npm run test:unit`                                                   | ✅ scripts 6 · shared 51 · server 120 (+4 `deploy.test.ts` chỉ chạy khi có `E2E_BASE_URL`) · client 324                               |
| `npm run test:integration`                                            | ✅ 201/201 (20 file; `e2ee.int.test.ts` 22; +1 `mongo.int.test.ts` replica set có auth, user chỉ `readWrite`)                         |
| `npm run trace:check -- --strict`                                     | ✅ 251/251 Test ID; `--milestone M7` 25/25 (đã sửa regex để nhận `TC-E2EE-…`)                                                         |
| `npm run spec:check`                                                  | ✅ FR 58 · AC 102 · EC 106 · event 35 · endpoint 28 · hằng số 72                                                                      |
| `npm run test:coverage` (NFR-14)                                      | ✅ `server/src/modules/**` 98,4% dòng (unit + integration gộp), nhánh 93,7%; `e2ee.service.ts` 97,9%; `packages/shared` 91,2%         |
| `npm audit --omit=dev --audit-level=high` (NFR-13)                    | ✅ 0 high/critical (thêm thư viện Signal không tạo advisory mới); còn 2 moderate của `react-router`                                   |
| `npm run build`                                                       | ✅ bundle-secrets OK · JS khởi tạo 177,9 KB gzip (≤ 300 KB); thư viện Signal ở chunk tải lười 136,7 KB gzip                           |
| k6 `load/message-send.js` (NFR-01, TC-ARCH-012)                       | ✅ 50 user · 5 msg/s · 5 phút: p95 ACK 82 ms (k6), server histogram 1450/1450 mẫu ≤ 300 ms, 0 ACK lỗi — đo trên bản build (KI-08)     |
| k6 `load/sockets.js` (NFR-09)                                         | ✅ 1000/1000 socket, 200/200 cuộc gọi CONNECTED (setup p95 391 ms), RSS server 255 MB                                                 |
| Lighthouse CI 0.15.1 (NFR-05)                                         | ✅ LCP 2,16–2,25 s (mobile simulate, image client có gzip), perf 0,91–0,94, a11y 1 — sau khi tự host Inter (KI-06)                    |
| Smoke 2 instance `SOCKET_ADAPTER=redis-streams`                       | ✅ chat + cuộc gọi đủ vòng (invite → CONNECTED → ENDED) giữa user ở :4301 và :4302 (transport websocket, chưa qua proxy sticky)       |
| Diễn tập backup/restore (kiến trúc §9.7)                              | ✅ local: `mongodump --oplog --gzip` → restore sang DB khác → `db:indexes` → giải mã 100/100 tin mẫu. Chưa diễn tập trên staging thật |
| Docker image                                                          | ✅ `server` 295 MB (argon2 musl chạy đúng, uid 1000, không có `.env`), `client` 94,8 MB (gzip, `/assets` immutable, SPA fallback)     |
| `docker compose -f infra/docker-compose.prod.yml config` / `nginx -t` | ✅ (chứng chỉ tự ký để test cú pháp)                                                                                                  |
| E2E toàn bộ trên 3 project (gồm M7)                                   | ⚠️ 107/109 (lượt máy rảnh); 2 fail chập chờn (TC-AC-055 → KI-13 đã sửa, a11y Firefox), chạy lại riêng xanh — mục 3                    |

## 3. E2E (Playwright)

- **M7 `e2ee.spec.ts` (7 test):**
  - Chromium 7/7 (57 s), Firefox 7/7, WebKit 7/7.
  - Phủ AC-110, 111, 112, 113, 114, 117, 118, 120, 121, 122; TC-E2EE-001, 003, 004, 005, 006, 007, 008.
  - Mỗi device là một browser context riêng. Thư viện Signal chạy thật, server chỉ thấy bản mã. AC-114 sửa 1 ký tự base64 trong vùng MAC qua `routeWebSocket`.
- **Lượt chạy liền thứ hai, máy rảnh (109 test, 31,2 phút, sau khi sửa KI-10): 107 pass, 2 fail.**
  - `TC-AC-055` (Chromium): chạy lại riêng 3/3 pass. Nguyên nhân là race cache danh sách, đã sửa (KI-13). Sau khi sửa, `group.spec.ts` pass 30/30 trên Chromium (`--repeat-each=5`) và 24/24 trên Firefox + WebKit (`--repeat-each=2`).
  - Accessibility trang Cài đặt (Firefox): timeout 90 s; chạy lại riêng 2/2 pass.
  - Mọi test cuộc gọi `@media` và `e2ee.spec.ts` đều pass trong lượt này.
- Lượt chạy liền thứ nhất (máy bị tải nặng, 28,3 phút): 103/109, gồm 3 test cuộc gọi `@media` Chromium fail và 3 test không chạy. Chạy lại riêng: `call.spec.ts` 10/10, `call-network.spec.ts` 4/4.

- Chromium: `call.spec.ts` 10/10 (gồm p95 ACCEPTED → CONNECTED ≤ 5 s qua 20 lần), `call-network.spec.ts` 4/4, `smoke.spec.ts` (TC-ARCH-017, local) pass.
- Lượt chạy toàn bộ 3 project (`npm run test:e2e`, chromium + firefox + webkit, 88 test, 21,1 phút): **87 pass, 1 fail** — `TC-AC-033` trên WebKit hết timeout 90 s; chạy lại riêng 2/2 pass (KI-09, chập chờn). Firefox chạy cả `call.spec.ts` (gồm p95 và autoplay) và pass; `call-network.spec.ts` chỉ Chromium (KI-07); WebKit bỏ test `@media`.

## 4. Lỗi phát hiện và đã sửa trong phiên này

| Lỗi                                                                                                                                    | Phát hiện bởi            | Sửa                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Bấm gọi → app sập (`useRoutes` lồng dưới `/call/:callId`)                                                                              | E2E TC-AC-070            | `AppRoutes` ở cấp gốc (`routes/router.tsx`) + `router.test.tsx`                                                              |
| Thanh điều khiển cuộc gọi video bị đẩy ra ngoài màn hình                                                                               | E2E TC-AC-071            | `min-h-0 overflow-hidden` vùng video (`InCallScreen.tsx`)                                                                    |
| Tắt camera → bên kia không thấy avatar (track không `mute` với `replaceTrack(null)`)                                                   | E2E TC-AC-071            | `REMOTE_VIDEO_STALL_MS` + `PeerSession.onRemoteVideoStalled` (spec đã duyệt)                                                 |
| ICE restart tốn hết lượt khi đang offline; bên offline không thấy "Đang kết nối lại…"; relay `call:ice-restart` mất khi caller offline | E2E TC-AC-081            | hoãn restart tới `online`/socket nối lại, `localIceLost`, caller vẫn offer khi `CALL_INVALID_STATE` (FR-CALL-006 đã bổ sung) |
| `call:invite` trả `INTERNAL_ERROR` khi Redis down (spec: 503)                                                                          | integration TC-INFRA-002 | `toAppError` nhận diện lỗi kết nối ioredis                                                                                   |
| Histogram NFR-01 `hustalo_message_send_ack_seconds` không bao giờ được ghi                                                             | k6 + `/metrics`          | `withAck({ observe })` cho `message:send`                                                                                    |
| `packages/shared` dùng `zod` mà không khai báo dependency                                                                              | `docker build` client    | thêm `zod` vào `packages/shared/package.json`                                                                                |
| `cicd-docker.yml` YAML sai (`: ` trong chuỗi không quote)                                                                              | Prettier                 | block scalar                                                                                                                 |
| nginx (biên + client) không bật gzip                                                                                                   | Lighthouse               | `gzip on` ở cả hai                                                                                                           |
| LCP 3,6 s do Google Fonts chặn render                                                                                                  | Lighthouse               | Inter tự host, đăng ký sau FCP (`lib/fonts/fonts.ts`); CSP bỏ Google Fonts                                                   |

### M7 — lỗi phát hiện và đã sửa

| Lỗi                                                                                                                   | Phát hiện bởi                        | Sửa                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Sau `CONFLICT`, tải lại danh bạ device bị throttle 10 s → gửi lại vẫn thiếu device mới rồi FAILED                     | unit `envelope.test.ts` (AC-118/121) | `devicesOf(…, 'force')` cho CONFLICT; chỉ throttle khi gặp device lạ lúc nhận tin        |
| Device xóa IndexedDB (cùng `deviceId`) hiện "Không thể giải mã" cho tin cũ thay vì "…trước khi thiết bị này tham gia" | thiết kế E2E AC-113 / EC-E2EE-006    | giải mã thất bại và tin cũ hơn lúc sinh khóa → NOT_FOR_DEVICE                            |
| Safety number mất hàng chục giây (msrcrypto JS thuần) → E2E timeout                                                   | E2E AC-120                           | cùng thuật toán bằng `crypto.subtle.digest`; unit test trùng từng chữ số với thư viện    |
| Thư viện `console.warn` in cả object session (root/chain key) khi "no chain found"                                    | review R-04                          | lọc trong `signal-adapter.ts` (V-1 trong `docs/SIGNAL_LIBRARY_REVIEW.md`)                |
| Khóa đọc từ IndexedDB khác realm → "Invalid private key"                                                              | unit test                            | store lưu khóa dạng base64, tạo `ArrayBuffer` mới khi đọc                                |
| `trace:check` không nhận Test ID `TC-E2EE-…` (regex `[A-Z-]+`)                                                        | `trace:check --strict`               | regex `[A-Z0-9-]+` + test cho script                                                     |
| Bị xóa khỏi nhóm nhưng nhóm vẫn hiện lại trong danh sách (KI-13): phản hồi tải danh sách cũ về muộn ghi đè cache      | E2E TC-AC-055 (chập chờn)            | `dropFromList`: `cancelQueries` → `setQueryData` → `invalidateQueries` + `cache.test.ts` |

### M7 — spec đã sửa (đã duyệt 2026-11-04)

- Quyền P24 (PRD, api_spec): cần có SECRET chung, tức là hội thoại đã tạo bằng `POST /conversations`.
- Ma trận §5.2: e2ee → conversations/users đi qua port tiêm từ `main.ts`; e2ee → auth thêm `latestUserAgent`.
- Kiến trúc §9.3: store bản rõ cục bộ `messages` trong IndexedDB.
- Cây thư mục: thêm các file mới. DG M7: kết quả R-04 ghi vào `docs/SIGNAL_LIBRARY_REVIEW.md`.
- KI-10: thêm endpoint `GET /e2ee/users/{userId}/identities` (api_spec, kiến trúc §4.6/§7(h), PRD FR-E2EE-006/P24, DG Traceability). KI-11 và KI-12 được chấp nhận.

### CI/CD `cicd-docker` — run #3–#8 fail, đã sửa 2026-11-04

| Lỗi                                                                                                                                                                        | Phát hiện bởi                                               | Sửa                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Run #3–#6: `docker/login-action` "Username and password required"                                                                                                          | annotation GitHub Actions                                   | Chưa có secret `DOCKERHUB_*` (đã thêm trước run #7). Workflow giờ kiểm tra secret trước và báo tên secret thiếu                                |
| Run #7 (4 attempt): `dependency failed to start: container hustalo-prod-mongo-1 is unhealthy` — thiếu `infra/mongo/keyfile`, bind mount tạo thư mục rỗng                   | log job deploy + tái hiện trong DinD                        | `infra/deploy-prod.sh` tự tạo keyfile nếu thiếu, `chown 999:999` + `chmod 400` (T-23)                                                          |
| Server production crash-loop "MongoDB phải chạy replica set (rs0)…": `replSetGetStatus` cần `clusterMonitor`, user app chỉ `readWrite` (sẽ là lỗi kế tiếp)                 | DinD (stack prod thật) + integration test                   | `assertReplicaSet` dùng `hello` + `setName`; test replica set có auth (T-28)                                                                   |
| nginx không khởi động khi chưa có chứng chỉ, và workflow ghi đè `nginx.conf` nên không "tạm comment block 443" được                                                        | review + DinD                                               | `nginx.bootstrap.conf` (chỉ ACME cổng 80) tự chọn khi thiếu chứng chỉ; `verify` báo rõ cần chạy certbot                                        |
| `workflow_run` + `branches: [main]` khớp cả PR từ fork có nhánh tên `main`                                                                                                 | review bảo mật                                              | chỉ deploy khi `workflow_run.event == 'push'` và `head_repository` là repo này; `checkout@v7` cũng chặn                                        |
| Không có log chẩn đoán khi `up --wait` fail; secret dán CRLF; `DOCKERHUB_USERNAME` trong `PROD_INFRA_ENV` có thể lệch secret; host key SSH luôn TOFU                       | review                                                      | in `ps` + log 60 dòng khi fail; bỏ `                                                                                                           |
| `; workflow tự ghi `DOCKERHUB_USERNAME`/`IMAGE_TAG`; secret tùy chọn `DEPLOY_KNOWN_HOSTS`, `StrictHostKeyChecking yes`                                                     |
| Run #8 (sau merge PR #1): keyfile đã sửa nhưng container mongo cũ (tạo ở run #7, mount keyfile dạng thư mục) vẫn `Restarting` → `up --wait` báo `mongo is unhealthy`       | log run #8 (nhóm chẩn đoán) + DinD giữ nguyên trạng thái VM | `deploy-prod.sh` xóa container mongo/mongo-init hỏng (giữ volume) khi keyfile vừa đổi hoặc container không healthy                             |
| Run #11: `verify` smoke báo `No tests found` — script gốc `npm run test:e2e -w client` để npm lồng nuốt `--project`/`--grep`, Playwright chỉ nhận `@smoke` như bộ lọc file | log job verify run #11 + tái hiện local (`--list`)          | `"test:e2e": "npm run test:e2e -w client --"` (development_guide §2)                                                                           |
| Smoke production cần đăng ký tay 2 tài khoản trước                                                                                                                         | yêu cầu chủ dự án                                           | `smoke.spec.ts` `ensureSmokeUser`: register bằng `SMOKE_*` (201/409/429) rồi xác nhận login (§9.6)                                             |
| Cảnh báo Node 20 deprecated                                                                                                                                                | annotation                                                  | `checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `setup-buildx-action@v4`, `login-action@v4`, `build-push-action@v7` (đã đối chiếu input) |

Kiểm chứng: Docker-in-Docker giả lập VM — lệnh deploy cũ tái hiện đúng lỗi mongod `Unable to acquire security key[s]`; `deploy-prod.sh` với image server mới: mọi service healthy, index synced, `HUSTALO_TLS=bootstrap` (503 + ACME 200); thêm chứng chỉ tự ký → `HUSTALO_TLS=ready`, health `{"status":"ok","mongo":"up","redis":"up"}`, 301 → HTTPS, HSTS/CSP, SPA fallback, Socket.IO polling 200, register 201 / login 200 / `GET /conversations` 200. `actionlint` + `shellcheck` sạch. Spec đã sửa (đã duyệt 2026-11-04): development_guide §9.3/§9.5/§9.6 + T-23/T-28, database_schema §6.3, cây thư mục kiến trúc.

## 5. Việc còn lại

| #   | Mức  | Việc                                                                                                                                                                                           | Ghi chú                       |
| --- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 2   | Cao  | M6.5: chạy lại `cicd-docker` (deploy bootstrap) → chạy certbot trên VM (development_guide.md §9.6) → chạy lại; điền `SMOKE_*` (+ nên có `DEPLOY_KNOWN_HOSTS`); ghi URL + SHA đã deploy vào đây | Việc của chủ dự án            |
| 3   | TB   | Test tay M5 §6.2 (Chrome, Safari 17; bỏ Firefox) + TC-CALL-NET-001 trên điện thoại thật                                                                                                        | —                             |
| 4   | TB   | Diễn tập backup/restore trên staging thật; smoke 2 instance sau proxy sticky                                                                                                                   | Sau khi có hạ tầng            |
| 6   | Thấp | 2 lỗ hổng moderate `react-router` (cần v7, breaking)                                                                                                                                           | NFR-13 chỉ chặn high/critical |
| 7   | TB   | Chạy lại E2E liền 3 project khi máy rảnh để xác nhận xanh hoàn toàn sau M7                                                                                                                     | Lượt 2026-11-04 bị tải nặng   |
| 8   | Thấp | Smoke production: xác nhận CSP `script-src 'self'` không chặn chunk Signal (đã quét bundle: không có `eval`/`new Function`)                                                                    | Sau khi deploy (M6.5)         |
| 9   | Thấp | Gửi issue upstream cho V-1 (thư viện log session ra console)                                                                                                                                   | Đã chặn trong adapter         |
