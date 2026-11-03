# HUSTALO — Trạng thái dự án

- **Ngày kiểm tra:** 2026-11-04 (đóng M5, M6; chuẩn bị M6.5)
- **Nhánh:** `main`, nối tiếp `6d8023a` (= `origin/main` lúc bắt đầu) bằng các commit M5/M6/M6.5 của ngày 2026-11-04 (chưa push). Commit `e08f525` của remote cũ (`chore(client): m1 deps…`) không còn trên `main`, chỉ ở nhánh `origin/claude/trusting-meitner-8cdcoc`.
- **Môi trường:** Windows 11, Docker Desktop (Mongo rs0, Redis, coturn local), Node 22.14.
- Chi tiết vấn đề đã biết: `docs/KNOWN_ISSUES.md` (KI-01…KI-08).

## 1. Tổng quan milestone

| Milestone         | Trạng thái                 | Test ID có test (`trace:check --strict`) | Ghi chú                                                                                  |
| ----------------- | -------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| M0–M4             | Xong                       | đủ                                       | Unit + integration xanh; E2E chạy lại trong Gate M6                                      |
| M5 — Cuộc gọi 1-1 | **Xong phần tự động**      | 74/74                                    | Còn test tay §6.2 (Chrome/Firefox/Safari 17) và TC-CALL-NET-001 trên điện thoại thật     |
| M6 — Hardening    | **Xong phần tự động**      | 12/12                                    | Còn diễn tập backup trên staging thật và smoke 2 instance sau proxy sticky (cần hạ tầng) |
| M6.5 — Deploy     | **Xong phần file + image** | 2/2                                      | Chưa deploy: cần VM, domain, secret Docker Hub/GitHub                                    |
| M7 — E2EE         | Chưa bắt đầu               | 1/25                                     | —                                                                                        |

## 2. Kết quả kiểm tra (2026-11-03)

| Lệnh / phép đo                                                        | Kết quả                                                                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                   | ✅                                                                                                                                       |
| `npm run lint` (ESLint + Prettier + Redocly)                          | ✅                                                                                                                                       |
| `npm run test:unit`                                                   | ✅ scripts 5 · shared 47 · server 115 (+4 `deploy.test.ts` chỉ chạy khi có `E2E_BASE_URL`) · client 288                                  |
| `npm run test:integration`                                            | ✅ 177/177 (19 file)                                                                                                                     |
| `npm run spec:check`                                                  | ✅ FR 58 · AC 102 · EC 106 · event 35 · endpoint 28 · hằng số 72                                                                         |
| `npm run test:coverage` (NFR-14)                                      | ✅ `server/src/modules/**` 98,3% dòng (unit + integration gộp), nhánh 93,5%; `packages/shared` 90,7%; `call.state-machine.ts` 100% nhánh |
| `npm audit --omit=dev --audit-level=high` (NFR-13)                    | ✅ 0 high/critical (sau khi nâng zod 4.6.7); còn 2 moderate của `react-router`                                                           |
| `npm run build`                                                       | ✅ bundle-secrets OK · JS khởi tạo 167,9 KB gzip (≤ 300 KB)                                                                              |
| k6 `load/message-send.js` (NFR-01, TC-ARCH-012)                       | ✅ 50 user · 5 msg/s · 5 phút: p95 ACK 82 ms (k6), server histogram 1450/1450 mẫu ≤ 300 ms, 0 ACK lỗi — đo trên bản build (KI-08)        |
| k6 `load/sockets.js` (NFR-09)                                         | ✅ 1000/1000 socket, 200/200 cuộc gọi CONNECTED (setup p95 391 ms), RSS server 255 MB                                                    |
| Lighthouse CI 0.15.1 (NFR-05)                                         | ✅ LCP 2,16–2,25 s (mobile simulate, image client có gzip), perf 0,91–0,94, a11y 1 — sau khi tự host Inter (KI-06)                       |
| Smoke 2 instance `SOCKET_ADAPTER=redis-streams`                       | ✅ chat + cuộc gọi đủ vòng (invite → CONNECTED → ENDED) giữa user ở :4301 và :4302 (transport websocket, chưa qua proxy sticky)          |
| Diễn tập backup/restore (kiến trúc §9.7)                              | ✅ local: `mongodump --oplog --gzip` → restore sang DB khác → `db:indexes` → giải mã 100/100 tin mẫu. Chưa diễn tập trên staging thật    |
| Docker image                                                          | ✅ `server` 295 MB (argon2 musl chạy đúng, uid 1000, không có `.env`), `client` 94,8 MB (gzip, `/assets` immutable, SPA fallback)        |
| `docker compose -f infra/docker-compose.prod.yml config` / `nginx -t` | ✅ (chứng chỉ tự ký để test cú pháp)                                                                                                     |
| E2E Gate M0–M5 trên 3 project                                         | ⚠️ 87/88 (1 chập chờn, KI-09) — mục 3                                                                                                    |

## 3. E2E (Playwright)

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

## 5. Việc còn lại

| #   | Mức  | Việc                                                                                                                                                             | Ghi chú                       |
| --- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 2   | Cao  | M6.5: tạo VM + domain + Let's Encrypt, điền GitHub Secrets (`DOCKERHUB_*`, `DEPLOY_*`, `PROD_*`, `SMOKE_*`), chạy `cicd-docker`, ghi URL + SHA đã deploy vào đây | Việc của chủ dự án            |
| 3   | TB   | Test tay M5 §6.2 (Chrome/Firefox/Safari 17) + TC-CALL-NET-001 trên điện thoại thật                                                                               | —                             |
| 4   | TB   | Diễn tập backup/restore trên staging thật; smoke 2 instance sau proxy sticky                                                                                     | Sau khi có hạ tầng            |
| 6   | Thấp | 2 lỗ hổng moderate `react-router` (cần v7, breaking)                                                                                                             | NFR-13 chỉ chặn high/critical |
| 7   | —    | M7 — E2EE                                                                                                                                                        | Chưa bắt đầu                  |
