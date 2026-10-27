# HUSTALO — Development Guide

| Thuộc tính | Giá trị |
|---|---|
| Version | 1.0.0 |
| Status | Draft — chờ review (file 6/6) |
| Ngày | 2026-10-27 |
| Phạm vi | Môi trường phát triển, hạ tầng local, biến môi trường, quy trình chạy và test, lộ trình milestone M0–M7, quy ước code, troubleshooting, Traceability Matrix toàn bộ FR |

**File liên quan:**

| File | Quan hệ với file này |
|---|---|
| `system_architecture.md` | Cây thư mục §4.1 (file nào nằm ở đâu), cổng §3, cấu hình Socket.IO §6.4, TURN §9.5, độ tin cậy §10, biến môi trường Phụ lục D, AC kiến trúc `AC-ARCH-001..015` §12 |
| `product_requirements.md` | FR, AC (`TC-AC-*`), ma trận edge case (`TC-<NHÓM>-*`), NFR §6, Definition of Done §7 — dùng làm gate của từng milestone |
| `database_schema.md` | `npm run db:indexes` §6.3, `db:migrate` §6.4, `db:seed` §6.5, test database `TC-DB-001..026` §7 |
| `ui_ux_spec.md` | Màn hình và chuỗi UI kiểm tra trong E2E; file client bổ sung §8 |
| `api_spec.yaml` | Lint bằng `@redocly/cli` trong `npm run lint`; `operationId` dùng trong Traceability Matrix |
| `CLAUDE.md` | Quy trình mỗi tác vụ, các điều cấm, lệnh chuẩn |

**Thuật ngữ:**

| Thuật ngữ | Nghĩa |
|---|---|
| Gate | Danh sách Test ID phải có test tự động và pass trước khi đóng một milestone |
| Test ID | Mã test cố định: `TC-AC-xxx` (theo AC của PRD), `TC-<NHÓM>-xxx` (theo EC), `TC-DB-xxx` (test database), `TC-ARCH-xxx` (theo `AC-ARCH-xxx`) |
| Tầng U / I / E | Unit (Vitest) / Integration (Supertest + socket thật + MongoMemoryReplSet + Redis test) / E2E (Playwright) |
| LAN-IP | Địa chỉ IPv4 của máy dev trong mạng nội bộ, ví dụ `192.168.1.23` — dùng khi test từ điện thoại |
| `[NEW]` | File, script hoặc biến môi trường do file này bổ sung vào cây kiến trúc §4.1 (không đổi cấu trúc đã chốt) |

Quy ước Test ID cho AC kiến trúc `[NEW]`: `AC-ARCH-0NN` ↔ `TC-ARCH-0NN` (cùng số).

---

## 1. Yêu cầu môi trường

### 1.1 Phần mềm bắt buộc

| Công cụ | Phiên bản | Kiểm tra | Ghi chú |
|---|---|---|---|
| Node.js | 22 LTS (`.nvmrc` = `22`) | `node -v` → `v22.x` | Cần `--env-file`, `process.loadEnvFile`, Web Crypto, `fetch` có sẵn |
| npm | 10.x | `npm -v` | Đi kèm Node 22; workspaces |
| Docker | Docker Engine 24+ hoặc Docker Desktop (Windows dùng backend WSL2), có Compose v2 | `docker compose version` | Cần lệnh `docker compose up --wait` |
| mkcert | bản ổn định mới nhất | `mkcert -version` | Sinh chứng chỉ HTTPS tin cậy cho `localhost` và LAN-IP |
| Git | 2.40+ | `git --version` | Bật `core.autocrlf=false` trên Windows (xem 1.4) |
| Trình duyệt | Chrome/Edge, Firefox (2 bản ổn định gần nhất), Safari 17+ khi test tay | — | Theo NFR-10 |
| Playwright browsers | theo phiên bản `@playwright/test` trong lockfile | `npx playwright install --with-deps` (chạy trong `client/`) | Cho `npm run test:e2e` |
| k6 | bản ổn định mới nhất | `k6 version` | Chỉ cần từ M6 (đo NFR-01, NFR-09) |

Cài mkcert:

| Hệ điều hành | Lệnh |
|---|---|
| Windows | `winget install FiloSottile.mkcert` hoặc `choco install mkcert` |
| macOS | `brew install mkcert nss` |
| Ubuntu/Debian | `sudo apt install mkcert libnss3-tools` |

Sau khi cài: chạy `mkcert -install` **một lần** để thêm CA cục bộ vào kho tin cậy của hệ điều hành và Firefox.

### 1.2 Vì sao phải chạy HTTPS ngay cả ở local

`navigator.mediaDevices.getUserMedia` chỉ tồn tại trong **secure context**. Trình duyệt coi các origin sau là secure:

| Origin | Secure context? | Hệ quả |
|---|---|---|
| `https://localhost:5173` | Có | Gọi được |
| `http://localhost:5173` | Có (ngoại lệ của trình duyệt cho localhost) | Gọi được trên chính máy dev |
| `http://192.168.1.23:5173` (điện thoại vào máy dev qua LAN) | **Không** | `navigator.mediaDevices` là `undefined` → UI "Không gian không an toàn" (EC-CALL-MEDIA-009) |
| `https://192.168.1.23:5173` với chứng chỉ mkcert đã tin cậy | Có | Gọi được từ điện thoại |

Thêm lý do:
- Cookie refresh có cờ `Secure` và `SameSite=Strict` (kiến trúc §6.3). Chạy HTTPS ngay từ dev giúp hành vi cookie giống production, tránh lỗi "chỉ hỏng trên production".
- WebSocket đi qua cùng origin HTTPS (`wss://`), tránh lỗi mixed content.
- TURN over TLS (`turns:`) cần chứng chỉ; coturn local dùng lại chứng chỉ mkcert.

Quyết định thiết kế (DG-01): **dev mặc định chạy HTTPS** qua Vite (`https://localhost:5173`), Vite proxy `/api` và `/socket.io` tới Express `http://localhost:4000`. Trình duyệt chỉ thấy một origin nên không có vấn đề CORS hay cookie bên thứ ba.

### 1.3 Ghi chú cho Windows

- Dùng PowerShell 7 hoặc Git Bash. Mọi script npm trong repo là lệnh Node/`docker`/`tsx`, không dùng cú pháp shell riêng của bash.
- Docker Desktop: bật backend WSL2, cấp tối thiểu 4 GB RAM.
- Windows Firewall: khi test từ điện thoại, cho phép inbound TCP 5173, TCP/UDP 3478, TCP 5349, UDP 49160–49200 trên mạng **Private**.
- Entry script chạy trực tiếp bằng `tsx` **không được** dùng so sánh `import.meta.url === \`file://${process.argv[1]}\`` (sai trên Windows vì đường dẫn `D:\...`). Quy ước bắt buộc (DG-02): mọi entry script gọi `isMainModule(import.meta.url)` trong `server/src/infra/runtime/is-main.ts` `[NEW]`:

```ts
// server/src/infra/runtime/is-main.ts
import { pathToFileURL } from 'node:url';

export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && metaUrl === pathToFileURL(entry).href;
}
```

  Đoạn `if (import.meta.url === ...)` trong `database_schema.md` §6.3 phải đổi thành `if (isMainModule(import.meta.url))` — xem mục "Đề xuất sửa spec" trong Consistency Check.

### 1.4 Line ending

File `.gitattributes` `[NEW]` ở gốc repo:

```text
* text=auto eol=lf
*.png binary
*.jpg binary
*.mp3 binary
*.ico binary
*.pem binary
```

Lý do: script Lua (`server/src/infra/redis/scripts/*.lua`), `infra/mongo/init-replica.js` và `infra/coturn/turnserver.conf` được mount vào container Linux; CRLF làm hỏng cấu hình coturn và gây sai khác SHA khi `SCRIPT LOAD`.

---

## 2. Clone, cài đặt và cấu trúc workspace

### 2.1 Lệnh

```bash
git clone <repo-url> hustalo
cd hustalo
nvm use            # hoặc fnm use / Volta; đọc .nvmrc = 22
npm install        # cài cả 3 workspace, sinh một package-lock.json duy nhất ở gốc
```

`npm install` chỉ chạy ở thư mục gốc. Không chạy `npm install` bên trong `client/`, `server/` hay `packages/shared/` (sẽ tạo lockfile lạc). Thêm dependency cho một workspace: `npm install <pkg> -w server` (hoặc `-w client`, `-w packages/shared`).

### 2.2 Workspace

| Thư mục | Tên package | Vai trò | Chạy bằng |
|---|---|---|---|
| `packages/shared` | `@hustalo/shared` | Enum, hằng số, mã lỗi, Zod schema, tên event, kiểu socket, util thuần (kiến trúc §4.4) | Được `server` và `client` import trực tiếp từ TS source |
| `server` | `@hustalo/server` | Express + Socket.IO + job | `tsx` (dev), `tsup` (build) |
| `client` | `@hustalo/client` | React SPA | Vite |

Quy tắc phụ thuộc: `client` và `server` được import `@hustalo/shared`; `shared` không import gì từ hai package kia, không import `mongoose`, `ioredis`, DOM API (kiến trúc §4.3). `client` không bao giờ import từ `server` và ngược lại (ESLint chặn, mục 8.2).

### 2.3 `package.json` gốc

```json
{
  "name": "hustalo",
  "private": true,
  "type": "module",
  "workspaces": ["packages/shared", "server", "client"],
  "engines": { "node": ">=22 <23", "npm": ">=10" },
  "scripts": {
    "dev": "concurrently -k -n server,client -c blue,green \"npm:dev:server\" \"npm:dev:client\"",
    "dev:client": "npm run dev -w client",
    "dev:server": "npm run dev -w server",
    "build": "npm run build -w server && npm run build -w client && node scripts/check-bundle-secrets.mjs",
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "npm run test:unit --workspaces --if-present",
    "test:integration": "npm run test:integration -w server",
    "test:e2e": "npm run test:e2e -w client",
    "lint": "eslint . --max-warnings 0 && prettier --check . && redocly lint .spec/api_spec.yaml",
    "format": "prettier --write .",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "db:indexes": "npm run db:indexes -w server",
    "db:seed": "npm run db:seed -w server",
    "db:migrate": "npm run db:migrate -w server",
    "infra:up": "docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --wait",
    "infra:down": "docker compose --env-file infra/.env -f infra/docker-compose.yml down",
    "infra:reset": "docker compose --env-file infra/.env -f infra/docker-compose.yml down -v",
    "infra:tools": "docker compose --env-file infra/.env -f infra/docker-compose.yml --profile tools up -d --wait",
    "infra:logs": "docker compose --env-file infra/.env -f infra/docker-compose.yml logs -f --tail=100",
    "certs": "node scripts/make-certs.mjs",
    "secrets": "node scripts/gen-secrets.mjs",
    "trace:check": "node scripts/check-traceability.mjs"
  }
}
```

Ghi chú:
- 14 script bắt buộc: `dev, dev:client, dev:server, build, test, test:unit, test:integration, test:e2e, lint, typecheck, db:indexes, db:seed, infra:up, infra:down`. Các script còn lại là `[NEW]`.
- `npm test` = unit + integration (không gồm E2E) và là lệnh trong CLAUDE.md bước 4. Integration cần Redis đang chạy (`npm run infra:up`); MongoDB của integration là `MongoMemoryReplSet` (không cần container Mongo).
- `npm run test:e2e` cần `infra:up`, `db:indexes`, `db:seed` và trình duyệt Playwright; bắt buộc ở gate milestone có test tầng E và trong CI.

Dev dependency ở gốc (cài một lần, phiên bản được khóa bởi `package-lock.json`, không ghi tay trong spec):

```bash
npm install -D typescript concurrently eslint @eslint/js typescript-eslint eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-import eslint-import-resolver-typescript eslint-config-prettier prettier @redocly/cli
```

### 2.4 Script của từng workspace

`server/package.json` (phần `scripts`):

```json
{
  "scripts": {
    "dev": "tsx watch --env-file=.env src/main.ts",
    "build": "tsup",
    "start": "node --env-file=.env dist/main.js",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "db:indexes": "tsx --env-file=.env src/infra/db/indexes.ts",
    "db:seed": "tsx --env-file=.env src/infra/db/seed.ts",
    "db:migrate": "tsx --env-file=.env src/infra/db/migrate.ts",
    "job:reencrypt": "tsx --env-file=.env src/jobs/reencrypt-messages.ts",
    "user:lock": "tsx --env-file=.env src/jobs/user-lock.ts lock",
    "user:unlock": "tsx --env-file=.env src/jobs/user-lock.ts unlock"
  }
}
```

- `// Xác minh với tài liệu chính thức của tsx: giả định tsx chuyển tiếp cờ Node --env-file cho process con.` Nếu không, thay bằng `process.loadEnvFile('.env')` ở đầu `config/env.ts` khi `NODE_ENV !== 'production'` và file tồn tại.
- `src/jobs/user-lock.ts` `[NEW]`: nhận `lock|unlock <email>`; `lock` gọi `auth.service.lockUser(email)` (kiến trúc §7(a): set `users.status = LOCKED`, thu hồi mọi family với lý do `ACCOUNT_LOCKED`, phát `session:revoked`, ngắt socket, kết thúc cuộc gọi `LOGOUT`); `unlock` set `status = ACTIVE`. Cách dùng: `npm run user:lock -w server -- alice@hustalo.local`. Vì job chạy ở process riêng, việc phát event tới socket đi qua Redis: job publish lên kênh Redis `${REDIS_KEY_PREFIX}ops:user-locked` `{ userId }`, `session.handler` của mọi instance subscribe kênh này và thực hiện `disconnectSockets(true)` cho room `user:{userId}` (DG-03).
- `src/infra/db/migrate.ts` và `src/infra/db/migrations/` theo `database_schema.md` §6.4.

`client/package.json`:

```json
{
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

`packages/shared/package.json`:

```json
{
  "name": "@hustalo/shared",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run"
  }
}
```

### 2.5 `.npmrc` `[NEW]`

```text
engine-strict=true
save-exact=true
fund=false
```

`engine-strict` chặn cài bằng Node khác 22; `save-exact` ghi phiên bản chính xác khi thêm dependency (khóa thư viện Signal theo rủi ro R-04).

---

## 3. Hạ tầng local (Docker Compose)

### 3.1 Cổng và URL

| Dịch vụ | Cổng host | Bind | URL / ghi chú |
|---|---|---|---|
| Client (Vite HTTPS) | 5173 | `0.0.0.0` | `https://localhost:5173`, `https://<LAN-IP>:5173` |
| Server (Express + Socket.IO) | 4000 | `0.0.0.0` (dev) | `http://localhost:4000/api/v1`; trình duyệt dùng qua proxy Vite |
| Metrics | 9464 | `127.0.0.1` | `http://localhost:9464/metrics` |
| MongoDB (rs0) | 27017 | `127.0.0.1` | `mongodb://localhost:27017/hustalo?replicaSet=rs0&directConnection=true` |
| Redis | 6379 | `127.0.0.1` | có mật khẩu |
| coturn | 3478 udp+tcp, 5349 tcp (TLS), 49160–49200 udp (relay) | `0.0.0.0` | chỉ test TURN local |
| mongo-express | 8081 | `127.0.0.1` | chỉ khi `npm run infra:tools` |

Khớp bảng cổng ở `system_architecture.md` §3.

### 3.2 `infra/docker-compose.yml`

```yaml
# infra/docker-compose.yml — CHỈ dùng cho phát triển và test local. Không dùng cho production.
# Chạy qua npm run infra:up (đọc biến từ infra/.env).
name: hustalo

services:
  mongo:
    image: mongo:7.0
    command: ["--replSet", "rs0", "--bind_ip_all", "--port", "27017"]
    ports:
      - "127.0.0.1:27017:27017"
    volumes:
      - mongo-data:/data/db
      - mongo-config:/data/configdb
      - ./mongo/init-replica.js:/scripts/init-replica.js:ro
    healthcheck:
      # Script idempotent: lần đầu gọi rs.initiate rồi trả "chưa khỏe"; các lần sau chỉ khỏe khi node là PRIMARY.
      test: ["CMD", "mongosh", "--quiet", "--norc", "/scripts/init-replica.js"]
      interval: 5s
      timeout: 10s
      start_period: 20s
      retries: 30
    restart: unless-stopped

  redis:
    image: redis:7.2-alpine
    command:
      - redis-server
      - --requirepass
      - ${REDIS_PASSWORD:?Thiếu REDIS_PASSWORD trong infra/.env}
      - --save
      - ""
      - --appendonly
      - "no"
    environment:
      REDISCLI_AUTH: ${REDIS_PASSWORD}
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 20
    restart: unless-stopped

  coturn:
    # Xác minh với tài liệu chính thức của coturn/coturn trên Docker Hub: tag 4.6 tồn tại và entrypoint
    # tự thêm "turnserver" khi tham số đầu tiên bắt đầu bằng "-".
    image: coturn/coturn:4.6
    command:
      - -c
      - /etc/coturn/turnserver.conf
      - --external-ip=${TURN_EXTERNAL_IP:?Thiếu TURN_EXTERNAL_IP trong infra/.env}
      - --user=${TURN_USERNAME:?Thiếu TURN_USERNAME}:${TURN_PASSWORD:?Thiếu TURN_PASSWORD}
    ports:
      - "3478:3478/udp"
      - "3478:3478/tcp"
      - "5349:5349/tcp"
      - "49160-49200:49160-49200/udp"
    volumes:
      - ./coturn/turnserver.conf:/etc/coturn/turnserver.conf:ro
      - ./certs:/certs:ro
    healthcheck:
      # turnutils_stunclient đi kèm gói coturn; gửi STUN Binding tới chính server.
      test: ["CMD", "turnutils_stunclient", "-p", "3478", "127.0.0.1"]
      interval: 10s
      timeout: 5s
      start_period: 5s
      retries: 10
    restart: unless-stopped

  mongo-express:
    # Xác minh với tài liệu chính thức của mongo-express trên Docker Hub: tag 1.0.2 và tên biến ME_CONFIG_*.
    image: mongo-express:1.0.2
    profiles: ["tools"]
    depends_on:
      mongo:
        condition: service_healthy
    environment:
      ME_CONFIG_MONGODB_URL: mongodb://mongo:27017/?replicaSet=rs0
      ME_CONFIG_BASICAUTH: "true"
      ME_CONFIG_BASICAUTH_USERNAME: ${ME_USERNAME:?Thiếu ME_USERNAME}
      ME_CONFIG_BASICAUTH_PASSWORD: ${ME_PASSWORD:?Thiếu ME_PASSWORD}
    ports:
      - "127.0.0.1:8081:8081"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://localhost:8081/ || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10
    restart: unless-stopped

volumes:
  mongo-data:
  mongo-config:
  redis-data:
```

Quyết định thiết kế:
- DG-04 — **MongoDB local không bật xác thực.** Replica set có auth bắt buộc keyfile, phức tạp không cần thiết cho dev; cổng chỉ bind `127.0.0.1`. Production dùng MongoDB có auth + TLS, URI lấy từ secret manager.
- DG-05 — **Member replica set khai báo `mongo:27017`** (khớp `init-replica.js` ở kiến trúc §4.1). Server chạy trên host nên phải kết nối với `directConnection=true`; nếu không, driver khám phá topology và cố phân giải hostname `mongo` → `ENOTFOUND`. Kết nối trực tiếp tới PRIMARY vẫn hỗ trợ transaction. Container khác (mongo-express) dùng `?replicaSet=rs0` vì phân giải được `mongo`.
- DG-06 — Redis local tắt persistence (`--save ""`, `--appendonly no`): Redis chỉ giữ dữ liệu tạm (kiến trúc §9.7); khởi động lại Redis tương đương EC-PRES-005 / EC-INFRA-002, có ích khi test tay.
- DG-07 — Port relay coturn giới hạn 49160–49200 (41 port, đủ cho khoảng 20 cuộc gọi relay đồng thời ở local) để Docker publish được.

### 3.3 `infra/mongo/init-replica.js`

```js
// infra/mongo/init-replica.js — chạy bởi healthcheck của service mongo (mongosh).
// Idempotent: thoát 0 chỉ khi node hiện tại là PRIMARY của rs0.
try {
  const status = rs.status();
  quit(status.myState === 1 ? 0 : 1);
} catch (e) {
  // 94 = NotYetInitialized
  if (e.code === 94 || e.codeName === 'NotYetInitialized') {
    rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
  }
  quit(1);
}
```

Thời gian từ `infra:up` tới khi mongo khỏe thường 10–25 s (lần đầu cần bầu PRIMARY). `docker compose up --wait` chặn tới khi mọi service không thuộc profile tắt đều `healthy`.

### 3.4 `infra/coturn/turnserver.conf`

```text
# infra/coturn/turnserver.conf — CHỈ dùng test TURN local (EC-CALL-NET-003/004, AC-085).
# user và external-ip truyền qua command trong docker-compose.yml (đọc từ infra/.env).
listening-port=3478
tls-listening-port=5349
min-port=49160
max-port=49200
fingerprint
lt-cred-mech
realm=hustalo.local
server-name=hustalo.local
cert=/certs/localhost+lan.pem
pkey=/certs/localhost+lan-key.pem
no-tlsv1
no-tlsv1_1
no-cli
no-multicast-peers
# Cho phép peer loopback để test hai trình duyệt trên cùng máy khi TURN_EXTERNAL_IP=127.0.0.1.
# TUYỆT ĐỐI không bật dòng này ở môi trường thật.
allow-loopback-peers
log-file=stdout
simple-log
```

Production không dùng file này. Nếu tự host coturn làm fallback ở production: bật `denied-peer-ip` cho dải private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16), dùng `use-auth-secret` + `static-auth-secret` (credential ngắn hạn) thay cho `user=`, TLS trên 443.

### 3.5 Xóa dữ liệu và làm lại từ đầu

| Mục đích | Lệnh |
|---|---|
| Dừng container, giữ dữ liệu | `npm run infra:down` |
| Xóa toàn bộ dữ liệu Mongo/Redis | `npm run infra:reset` rồi `npm run infra:up && npm run db:indexes && npm run db:seed` |
| Chỉ xóa Redis (mô phỏng EC-PRES-005) | `docker compose --env-file infra/.env -f infra/docker-compose.yml restart redis` |
| Mô phỏng MongoDB down (EC-INFRA-001, AC-041) | `docker compose --env-file infra/.env -f infra/docker-compose.yml stop mongo`, sau đó `start mongo` |
| Mô phỏng TURN/mạng media đứt (mục 6.5) | `docker compose --env-file infra/.env -f infra/docker-compose.yml pause coturn`, sau đó `unpause coturn` |

---

## 4. Biến môi trường

Có ba file mẫu, đều được commit; file thật (`.env`) bị `.gitignore` chặn (`.env*`, `!.env.example`):

| File mẫu | Copy thành | Ai đọc |
|---|---|---|
| `infra/.env.example` `[NEW]` | `infra/.env` | Docker Compose |
| `server/.env.example` | `server/.env` | `server/src/config/env.ts` |
| `client/.env.example` | `client/.env` | Vite (chỉ biến `VITE_*`) |

### 4.1 `infra/.env.example`

```bash
# infra/.env.example — biến cho Docker Compose. Copy thành infra/.env.
# Sinh giá trị bằng: npm run secrets   (KHÔNG commit infra/.env)

# Mật khẩu Redis (requirepass). Phải trùng phần mật khẩu trong REDIS_URL và REDIS_URL_TEST của server/.env.
REDIS_PASSWORD=replace-with-output-of-npm-run-secrets

# Tài khoản tĩnh của coturn local. Phải trùng TURN_FALLBACK_USERNAME / TURN_FALLBACK_CREDENTIAL của server/.env.
TURN_USERNAME=hustalo
TURN_PASSWORD=replace-with-output-of-npm-run-secrets

# Địa chỉ coturn quảng bá trong relay candidate.
# 127.0.0.1: hai trình duyệt trên cùng máy dev. LAN-IP (vd 192.168.1.23): khi có điện thoại/máy khác tham gia.
TURN_EXTERNAL_IP=127.0.0.1

# Đăng nhập mongo-express (chỉ khi npm run infra:tools).
ME_USERNAME=dev
ME_PASSWORD=replace-with-output-of-npm-run-secrets
```

### 4.2 `server/.env.example`

```bash
# server/.env.example — copy thành server/.env. KHÔNG commit server/.env.
# Giá trị bí mật sinh bằng: npm run secrets (scripts/gen-secrets.mjs). Không có giá trị thật nào trong file này.
# Mọi biến được kiểm tra bằng Zod ở server/src/config/env.ts; sai/thiếu → process thoát ngay (fail-fast).

# ---------- Chung ----------
# development | test | production
NODE_ENV=development
# Cổng HTTP của Express + Socket.IO (Vite proxy tới đây)
PORT=4000
# Số hop proxy tin cậy để đọc req.ip từ X-Forwarded-For (Vite proxy ở dev = 1)
TRUST_PROXY=1
# Origin được phép (CORS REST + Socket.IO), phân tách bằng dấu phẩy, không có dấu "/" cuối.
# Thêm https://<LAN-IP>:5173 khi test từ điện thoại.
CORS_ORIGINS=https://localhost:5173
# trace | debug | info | warn | error | fatal (production: info)
LOG_LEVEL=debug
# Cổng /metrics, chỉ bind 127.0.0.1 (kiến trúc §11.1)
METRICS_PORT=9464

# ---------- MongoDB (bắt buộc replica set, DG-05) ----------
MONGODB_URI=mongodb://localhost:27017/hustalo?replicaSet=rs0&directConnection=true

# ---------- Redis ----------
# Mật khẩu trùng REDIS_PASSWORD trong infra/.env
REDIS_URL=redis://:replace-with-redis-password@localhost:6379/0
# DB riêng cho integration test (bị FLUSHDB trước mỗi file test)
REDIS_URL_TEST=redis://:replace-with-redis-password@localhost:6379/15
# Tiền tố mọi key Redis (database_schema.md §5.1)
REDIS_KEY_PREFIX=hustalo:

# ---------- Auth ----------
# Khóa HS256 cho access token, >= 32 byte ngẫu nhiên (base64url)
JWT_ACCESS_SECRET=replace-with-output-of-npm-run-secrets
JWT_ISSUER=hustalo-api
JWT_AUDIENCE=hustalo-web
# Pepper HMAC-SHA256 cho tokenHash của refresh token, >= 32 byte (base64url)
REFRESH_TOKEN_PEPPER=replace-with-output-of-npm-run-secrets
# true: cookie có cờ Secure (khuyến nghị cả ở dev vì dev chạy HTTPS). false chỉ hợp lệ khi NODE_ENV=development.
COOKIE_SECURE=true

# ---------- Mã hóa lưu trữ AES-256-GCM (kiến trúc §9.2) ----------
# JSON {"<keyId>":"<base64 của đúng 32 byte>"}; keyId khớp ^[A-Za-z0-9_-]{1,32}$
DATA_ENCRYPTION_KEYS={"replace-key-id":"replace-with-output-of-npm-run-secrets"}
# Phải là một keyId có trong DATA_ENCRYPTION_KEYS
DATA_ENCRYPTION_ACTIVE_KEY_ID=replace-key-id

# ---------- Socket.IO (kiến trúc §6.4) ----------
SOCKET_PATH=/socket.io
# ms; mặc định = SOCKET_PING_INTERVAL_MS (25000)
SOCKET_PING_INTERVAL=25000
# ms; mặc định = SOCKET_PING_TIMEOUT_MS (20000)
SOCKET_PING_TIMEOUT=20000
# memory | redis-streams (kiến trúc §10.4, D-13)
SOCKET_ADAPTER=memory

# ---------- WebRTC / ICE (kiến trúc §9.5) ----------
# Danh sách STUN, phân tách bằng dấu phẩy
STUN_URLS=stun:stun.l.google.com:19302
# Xirsys: để trống cả XIRSYS_IDENT và XIRSYS_SECRET → không gọi Xirsys, luôn dùng fallback (source FALLBACK)
XIRSYS_IDENT=
XIRSYS_SECRET=
XIRSYS_CHANNEL=hustalo-dev
# Xác minh với tài liệu chính thức của Xirsys: base URL API hiện hành (giả định https://global.xirsys.net)
XIRSYS_API_URL=https://global.xirsys.net
# Fallback TURN (coturn local). Dùng LAN-IP thay cho localhost khi có thiết bị khác trong LAN.
TURN_FALLBACK_URLS=turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp,turns:localhost:5349?transport=tcp
# Trùng TURN_USERNAME / TURN_PASSWORD trong infra/.env
TURN_FALLBACK_USERNAME=hustalo
TURN_FALLBACK_CREDENTIAL=replace-with-turn-password
# all | relay (relay: ép đi qua TURN để test, AC-085)
ICE_TRANSPORT_POLICY=all
# ms; mặc định 45000 = CALL_RING_TIMEOUT_MS. Chỉ được khác 45000 khi NODE_ENV=development (DG-08)
CALL_RING_TIMEOUT_MS=45000

# ---------- Chỉ dev ----------
# Mật khẩu chung của alice/bob/carol do npm run db:seed tạo. db:seed từ chối chạy khi NODE_ENV=production.
SEED_PASSWORD=hustalo-dev-2026
```

`SEED_PASSWORD=hustalo-dev-2026` là mật khẩu **chỉ dùng cho tài khoản dev cục bộ**, thỏa luật FR-AUTH-001 (8..128 ký tự, có chữ và số, khác email/username); không phải secret.

### 4.3 `client/.env.example`

```bash
# client/.env.example — copy thành client/.env.
# CHỈ biến có tiền tố VITE_ được đưa vào bundle trình duyệt → TUYỆT ĐỐI không đặt secret ở đây.
# scripts/check-bundle-secrets.mjs làm build thất bại nếu có biến VITE_* mang tên nhạy cảm (AC-105).

# Base REST. Đường dẫn tương đối → đi qua proxy Vite (dev) hoặc reverse proxy (production), cùng origin.
VITE_API_URL=/api/v1
# URL Socket.IO. "/" = cùng origin với trang; path cố định /socket.io (kiến trúc §6.4).
VITE_SOCKET_URL=/
```

Quyết định DG-09: client dùng URL **tương đối** để REST, cookie và WebSocket luôn cùng origin với trang (localhost hay LAN-IP đều chạy, không cần build lại).

### 4.4 Kiểm tra env khi khởi động — `server/src/config/env.ts`

```ts
// server/src/config/env.ts
import { z } from 'zod';
import { CALL_RING_TIMEOUT_MS, SOCKET_PING_INTERVAL_MS, SOCKET_PING_TIMEOUT_MS } from '@hustalo/shared';

const csv = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter((x) => x.length > 0));

const base64urlMin32 = z
  .string()
  .refine((s) => Buffer.from(s, 'base64url').length >= 32, 'phải là base64url của tối thiểu 32 byte');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
    CORS_ORIGINS: csv.pipe(z.array(z.string().url()).min(1)),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),

    MONGODB_URI: z.string().startsWith('mongodb').refine((u) => u.includes('replicaSet='), 'phải có replicaSet= (AC-ARCH-003)'),
    REDIS_URL: z.string().startsWith('redis'),
    REDIS_URL_TEST: z.string().startsWith('redis').optional(),
    REDIS_KEY_PREFIX: z.string().regex(/^[a-z0-9_-]+:$/).default('hustalo:'),

    JWT_ACCESS_SECRET: base64urlMin32,
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    REFRESH_TOKEN_PEPPER: base64urlMin32,
    COOKIE_SECURE: z.enum(['true', 'false']).transform((v) => v === 'true'),

    // Chi tiết parse/validate từng key ở infra/crypto/key-ring.ts (AC-ARCH-004); ở đây chỉ kiểm tra JSON object.
    DATA_ENCRYPTION_KEYS: z.string().transform((s, ctx) => {
      try {
        const v: unknown = JSON.parse(s);
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
        return v as Record<string, string>;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DATA_ENCRYPTION_KEYS phải là JSON object' });
        return z.NEVER;
      }
    }),
    DATA_ENCRYPTION_ACTIVE_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),

    SOCKET_PATH: z.string().startsWith('/').default('/socket.io'),
    SOCKET_PING_INTERVAL: z.coerce.number().int().positive().default(SOCKET_PING_INTERVAL_MS),
    SOCKET_PING_TIMEOUT: z.coerce.number().int().positive().default(SOCKET_PING_TIMEOUT_MS),
    SOCKET_ADAPTER: z.enum(['memory', 'redis-streams']).default('memory'),

    STUN_URLS: csv.pipe(z.array(z.string().regex(/^stuns?:/)).min(1)),
    XIRSYS_IDENT: z.string().default(''),
    XIRSYS_SECRET: z.string().default(''),
    XIRSYS_CHANNEL: z.string().default('hustalo-dev'),
    XIRSYS_API_URL: z.string().url().default('https://global.xirsys.net'),
    TURN_FALLBACK_URLS: csv.pipe(z.array(z.string().regex(/^turns?:/))).default(''),
    TURN_FALLBACK_USERNAME: z.string().default(''),
    TURN_FALLBACK_CREDENTIAL: z.string().default(''),
    ICE_TRANSPORT_POLICY: z.enum(['all', 'relay']).default('all'),
    CALL_RING_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(CALL_RING_TIMEOUT_MS),

    SEED_PASSWORD: z.string().min(8).max(128).optional(),
  })
  .superRefine((e, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (e.NODE_ENV !== 'development' && !e.COOKIE_SECURE) fail('COOKIE_SECURE', 'chỉ được false khi NODE_ENV=development');
    if (e.NODE_ENV !== 'development' && e.CALL_RING_TIMEOUT_MS !== CALL_RING_TIMEOUT_MS)
      fail('CALL_RING_TIMEOUT_MS', `ngoài development phải bằng ${CALL_RING_TIMEOUT_MS} (DG-08)`);
    if ((e.XIRSYS_IDENT === '') !== (e.XIRSYS_SECRET === '')) fail('XIRSYS_SECRET', 'XIRSYS_IDENT và XIRSYS_SECRET phải cùng có hoặc cùng trống');
    if (e.TURN_FALLBACK_URLS.length > 0 && (e.TURN_FALLBACK_USERNAME === '' || e.TURN_FALLBACK_CREDENTIAL === ''))
      fail('TURN_FALLBACK_CREDENTIAL', 'có TURN_FALLBACK_URLS thì phải có username và credential');
    if (e.NODE_ENV === 'production' && e.XIRSYS_IDENT === '' && e.TURN_FALLBACK_URLS.length === 0)
      fail('XIRSYS_IDENT', 'production cần ít nhất một nguồn TURN');
    if (e.NODE_ENV === 'production' && e.SEED_PASSWORD !== undefined) fail('SEED_PASSWORD', 'không được đặt ở production');
    if (e.ICE_TRANSPORT_POLICY === 'relay' && e.XIRSYS_IDENT === '' && e.TURN_FALLBACK_URLS.length === 0)
      fail('ICE_TRANSPORT_POLICY', 'relay cần có TURN');
  });

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Chỉ in tên biến và thông điệp — KHÔNG in giá trị (có thể là secret).
  for (const issue of parsed.error.issues) {
    process.stderr.write(`[env] ${issue.path.join('.')}: ${issue.message}\n`);
  }
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;
```

Quy tắc:
- DG-08: `CALL_RING_TIMEOUT_MS` là biến env để dev rút ngắn khi test tay (ví dụ 10000). Ngoài `development` giá trị phải bằng hằng số `CALL_RING_TIMEOUT_MS` của `packages/shared` (45 s). Mọi test AC/EC chạy với giá trị mặc định; test integration dùng `fake-clock.ts` thay vì đổi env.
- DG-10: Xirsys chưa cấu hình (`XIRSYS_IDENT` trống) được coi như "Xirsys lỗi" ở kiến trúc §9.5 bước 3: trả fallback với `source: 'FALLBACK'` nhưng **không** log `warn` và không tăng `hustalo_ice_servers_fallback_total` (vì là cấu hình có chủ đích). Đây là bổ sung cho §9.5, không đổi hợp đồng `IceServersResponse`.
- Lỗi env in **tên** biến, không in giá trị.

### 4.5 Sinh secret — `scripts/gen-secrets.mjs`

```js
#!/usr/bin/env node
// scripts/gen-secrets.mjs
// In ra stdout giá trị bí mật cho môi trường DEV. Không ghi file, không gửi đi đâu, không commit output.
//   node scripts/gen-secrets.mjs             → in toàn bộ khối biến
//   node scripts/gen-secrets.mjs --data-key  → in một cặp "keyId":"base64" để xoay khóa (kiến trúc §9.2.4)
import { randomBytes } from 'node:crypto';

const b64url = (n) => randomBytes(n).toString('base64url');
const hex = (n) => randomBytes(n).toString('hex');
const newKeyId = () => {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `k${ym}${hex(2)}`; // ví dụ k2026103fa9 — khớp ^[A-Za-z0-9_-]{1,32}$
};

if (process.argv.includes('--data-key')) {
  console.log(`"${newKeyId()}":"${randomBytes(32).toString('base64')}"`);
  process.exit(0);
}

const keyId = newKeyId();
const redisPassword = hex(24);
const turnPassword = hex(18);
console.log(
  [
    '# ===== infra/.env =====',
    `REDIS_PASSWORD=${redisPassword}`,
    `TURN_PASSWORD=${turnPassword}`,
    `ME_PASSWORD=${hex(12)}`,
    '',
    '# ===== server/.env =====',
    `REDIS_URL=redis://:${redisPassword}@localhost:6379/0`,
    `REDIS_URL_TEST=redis://:${redisPassword}@localhost:6379/15`,
    `JWT_ACCESS_SECRET=${b64url(48)}`,
    `REFRESH_TOKEN_PEPPER=${b64url(32)}`,
    `DATA_ENCRYPTION_KEYS={"${keyId}":"${randomBytes(32).toString('base64')}"}`,
    `DATA_ENCRYPTION_ACTIVE_KEY_ID=${keyId}`,
    `TURN_FALLBACK_CREDENTIAL=${turnPassword}`,
  ].join('\n'),
);
```

Lệnh tương đương không cần script (khi chỉ cần một giá trị):

| Giá trị | Lệnh |
|---|---|
| `JWT_ACCESS_SECRET` (48 byte base64url) | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `REFRESH_TOKEN_PEPPER` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| Một data key 32 byte | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| Mật khẩu Redis/TURN | `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |

Mở rộng so với kiến trúc §4.1: `gen-secrets.mjs` in thêm `REDIS_PASSWORD`, `TURN_PASSWORD`, `ME_PASSWORD` cho `infra/.env`. Production: mọi secret lấy từ secret manager, không dùng script này.

### 4.6 Chống lọt secret vào bundle — `scripts/check-bundle-secrets.mjs`

Chạy cuối `npm run build` (AC-105, AC-ARCH-011, EC-SEC-006). Hành vi:

1. Đọc `server/.env` (nếu có) và `process.env`; lấy giá trị (độ dài ≥ 8) của các biến `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `XIRSYS_IDENT`, `XIRSYS_SECRET`, `TURN_FALLBACK_CREDENTIAL`, `SEED_PASSWORD`, mật khẩu trong `REDIS_URL`, và từng key base64 trong `DATA_ENCRYPTION_KEYS`.
2. Quét mọi file trong `client/dist/**`; tìm thấy bất kỳ giá trị nào → in tên biến + tên file (không in giá trị), exit 1.
3. Đọc `client/.env*` và `process.env`; tên biến `VITE_*` khớp `/SECRET|PEPPER|PASSWORD|CREDENTIAL|PRIVATE|XIRSYS|DATA_ENCRYPTION|JWT/i` → exit 1.
4. Không có `client/dist` → exit 1 với thông báo "Chưa build client".

```js
#!/usr/bin/env node
// scripts/check-bundle-secrets.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dist = join(root, 'client', 'dist');
const parseEnvFile = (p) =>
  existsSync(p)
    ? Object.fromEntries(
        readFileSync(p, 'utf8')
          .split(/\r?\n/)
          .filter((l) => /^[A-Z0-9_]+=/.test(l))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      )
    : {};

const serverEnv = { ...parseEnvFile(join(root, 'server', '.env')), ...process.env };
const secrets = [];
for (const name of ['JWT_ACCESS_SECRET', 'REFRESH_TOKEN_PEPPER', 'XIRSYS_IDENT', 'XIRSYS_SECRET', 'TURN_FALLBACK_CREDENTIAL', 'SEED_PASSWORD']) {
  if ((serverEnv[name] ?? '').length >= 8) secrets.push([name, serverEnv[name]]);
}
const redisPass = /^redis:\/\/[^:]*:([^@]+)@/.exec(serverEnv.REDIS_URL ?? '')?.[1];
if (redisPass && redisPass.length >= 8) secrets.push(['REDIS_URL(password)', redisPass]);
try {
  for (const [id, key] of Object.entries(JSON.parse(serverEnv.DATA_ENCRYPTION_KEYS ?? '{}'))) {
    secrets.push([`DATA_ENCRYPTION_KEYS.${id}`, String(key)]);
  }
} catch {
  /* env.ts đã chặn JSON sai khi chạy server; ở đây bỏ qua */
}

let failed = false;
const forbiddenName = /SECRET|PEPPER|PASSWORD|CREDENTIAL|PRIVATE|XIRSYS|DATA_ENCRYPTION|JWT/i;
const clientEnvNames = [
  ...['.env', '.env.local', '.env.production', '.env.production.local'].flatMap((f) => Object.keys(parseEnvFile(join(root, 'client', f)))),
  ...Object.keys(process.env),
];
for (const name of new Set(clientEnvNames)) {
  if (name.startsWith('VITE_') && forbiddenName.test(name)) {
    console.error(`[bundle-secrets] Biến client bị cấm: ${name}`);
    failed = true;
  }
}

if (!existsSync(dist)) {
  console.error('[bundle-secrets] Chưa build client (client/dist không tồn tại)');
  process.exit(1);
}
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
for (const file of walk(dist)) {
  const content = readFileSync(file, 'latin1');
  for (const [name, value] of secrets) {
    if (content.includes(value)) {
      console.error(`[bundle-secrets] Giá trị của ${name} xuất hiện trong ${file}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log(`[bundle-secrets] OK — đã quét ${secrets.length} giá trị bí mật`);
```

---

## 5. Quy trình chạy nhanh

### 5.1 Lần đầu

```bash
# 1. Chứng chỉ HTTPS (localhost + LAN-IP)
mkcert -install
npm run certs

# 2. File env
cp infra/.env.example infra/.env
cp server/.env.example server/.env
cp client/.env.example client/.env
npm run secrets            # dán các giá trị in ra vào infra/.env và server/.env

# 3. Hạ tầng
npm run infra:up           # mongo (rs0) + redis + coturn, chờ healthy

# 4. Dữ liệu
npm run db:indexes
npm run db:seed            # alice, bob, carol

# 5. Chạy app
npm run dev                # server :4000 + client https://localhost:5173
```

PowerShell không có `cp`-alias khác hành vi đáng kể; nếu dùng `cmd`, thay `cp` bằng `copy`.

`scripts/make-certs.mjs` `[NEW]`:
- Tìm mọi IPv4 không phải loopback từ `os.networkInterfaces()`.
- Chạy `mkcert -cert-file infra/certs/localhost+lan.pem -key-file infra/certs/localhost+lan-key.pem localhost 127.0.0.1 ::1 <các LAN-IP>`.
- In danh sách IP đã đưa vào chứng chỉ. Đổi mạng Wi-Fi (IP đổi) → chạy lại `npm run certs` và `docker compose ... restart coturn`.
- `mkcert` không có trong PATH → exit 1 với hướng dẫn mục 1.1.

### 5.2 `client/vite.config.ts`

```ts
// client/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const certFile = fileURLToPath(new URL('../infra/certs/localhost+lan.pem', import.meta.url));
const keyFile = fileURLToPath(new URL('../infra/certs/localhost+lan-key.pem', import.meta.url));

if (!existsSync(certFile) || !existsSync(keyFile)) {
  throw new Error('Thiếu chứng chỉ HTTPS trong infra/certs. Chạy: mkcert -install && npm run certs');
}

const API_TARGET = 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,           // lắng nghe 0.0.0.0 để điện thoại trong LAN truy cập được
    port: 5173,
    strictPort: true,
    https: { cert: readFileSync(certFile), key: readFileSync(keyFile) },
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false, xfwd: true },
      '/socket.io': { target: API_TARGET, ws: true, changeOrigin: false, xfwd: true },
    },
  },
  preview: { port: 4173, strictPort: true },
  build: { sourcemap: true, target: 'es2022' },
});
```

`changeOrigin: false` giữ header `Origin` = origin trình duyệt để server so với `CORS_ORIGINS`. `xfwd: true` gửi `X-Forwarded-For` để rate limit theo IP thật (`TRUST_PROXY=1`).

### 5.3 Tài khoản mẫu (`db:seed`, `database_schema.md` §6.5)

| Email | Username | Tên hiển thị | Mật khẩu | Vai trò trong "Nhóm HUSTALO" |
|---|---|---|---|---|
| `alice@hustalo.local` | `alice` | Alice Nguyễn | `SEED_PASSWORD` (mặc định `hustalo-dev-2026`) | OWNER |
| `bob@hustalo.local` | `bob` | Bob Trần | như trên | ADMIN |
| `carol@hustalo.local` | `carol` | Carol Lê | như trên | MEMBER |

Kèm một DIRECT alice–bob có 3 tin mẫu. Seed idempotent theo email; chạy lại không nhân đôi dữ liệu.

### 5.4 Kiểm tra sau khi chạy

| Bước | Lệnh / thao tác | Kỳ vọng |
|---|---|---|
| Health | `curl http://localhost:4000/api/v1/health` | `{"status":"ok","mongo":"up","redis":"up"}` |
| Health qua proxy | Mở `https://localhost:5173/api/v1/health` | Như trên, ổ khóa HTTPS hợp lệ |
| Metrics | `curl http://localhost:9464/metrics` | Có `hustalo_http_request_duration_seconds` |
| Đăng nhập | Mở `https://localhost:5173/login`, đăng nhập alice | Vào `/chats`, thấy DIRECT với bob và "Nhóm HUSTALO" |
| Socket | DevTools → Network → WS | Một kết nối `wss://localhost:5173/socket.io/?EIO=4&transport=websocket` |
| Realtime | Cửa sổ ẩn danh/profile khác đăng nhập bob, gửi tin | alice nhận tin ngay, bubble bob ✓ → ✓✓ |

### 5.5 Test từ điện thoại trong LAN

1. Máy dev và điện thoại cùng mạng Wi-Fi. Lấy LAN-IP (Windows: `ipconfig`; macOS: `ipconfig getifaddr en0`; Linux: `hostname -I`).
2. `npm run certs` (chứng chỉ có LAN-IP).
3. Cài CA của mkcert lên điện thoại: file `rootCA.pem` trong thư mục `mkcert -CAROOT`.
   - iOS: gửi file sang máy (AirDrop/email) → cài profile → Cài đặt → Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng nhận → bật tin cậy hoàn toàn.
   - Android: Cài đặt → Bảo mật → Mã hóa và thông tin xác thực → Cài đặt chứng chỉ → Chứng chỉ CA. `// Xác minh theo hãng máy: đường dẫn menu khác nhau giữa các bản Android.`
4. `server/.env`: thêm `https://<LAN-IP>:5173` vào `CORS_ORIGINS`; đổi `localhost` trong `TURN_FALLBACK_URLS` thành LAN-IP. `infra/.env`: `TURN_EXTERNAL_IP=<LAN-IP>`. Restart: `npm run infra:up` (tạo lại coturn) và `npm run dev`.
5. Mở firewall (mục 1.3). Trên điện thoại vào `https://<LAN-IP>:5173`.

Không bao giờ test cuộc gọi qua `http://<LAN-IP>` — sẽ rơi vào EC-CALL-MEDIA-009 (đúng hành vi, không phải bug).

---

## 6. Test cuộc gọi

### 6.1 Hai người dùng trên một máy

Mỗi người dùng cần một **profile trình duyệt riêng** (cookie, `localStorage` `hustalo.deviceId`, IndexedDB khác nhau). Hai tab cùng profile là cùng một device (hai tab), dùng để test đa tab, không phải hai người.

| Hệ điều hành | Mở Chrome profile tạm cho alice (bob: đổi tên thư mục) |
|---|---|
| Windows (PowerShell) | `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:TEMP\hustalo-alice" --use-fake-device-for-media-stream --use-fake-ui-for-media-stream https://localhost:5173` |
| macOS | `open -na "Google Chrome" --args --user-data-dir=/tmp/hustalo-alice --use-fake-device-for-media-stream --use-fake-ui-for-media-stream https://localhost:5173` |
| Linux | `google-chrome --user-data-dir=/tmp/hustalo-alice --use-fake-device-for-media-stream --use-fake-ui-for-media-stream https://localhost:5173` |

Cờ Chrome:

| Cờ | Tác dụng |
|---|---|
| `--use-fake-device-for-media-stream` | Thay camera/micro thật bằng thiết bị giả (video test pattern, âm beep) — hai cửa sổ không tranh camera thật (tránh EC-CALL-MEDIA-005 giả) |
| `--use-fake-ui-for-media-stream` | Tự cấp quyền, không hiện prompt. **Bỏ cờ này** khi muốn test từ chối quyền (EC-CALL-MEDIA-003/004) |
| `--use-file-for-fake-audio-capture=<path.wav>` | Phát file WAV làm micro (kiểm tra âm thanh hai chiều bằng tai) |
| `--use-file-for-fake-video-capture=<path.y4m>` | Phát file Y4M làm camera |

Cách khác: Chrome cho alice và Firefox cho bob (Firefox: `about:config` → `media.navigator.streams.fake = true`). Kết hợp này còn kiểm được tương thích codec giữa hai engine.

### 6.2 Kịch bản test tay tối thiểu (trước khi đóng M5)

| # | Kịch bản | Kỳ vọng | Liên kết |
|---|---|---|---|
| 1 | alice gọi thoại bob, bob nghe, nói chuyện 30 s, alice cúp | Trạng thái INITIATED → RINGING → ACCEPTED → CONNECTING → CONNECTED → ENDED; SYSTEM "Cuộc gọi thoại · 00:30" | AC-070 |
| 2 | Gọi video, tắt/bật camera, tắt micro | Bên kia thấy avatar khi tắt camera ≤ 2 s | AC-071 |
| 3 | bob mở 2 profile (2 device), alice gọi, bob nghe ở device 1 | Device 2 dừng chuông, toast "Đã trả lời trên thiết bị khác" | AC-076 |
| 4 | Cả hai bấm gọi nhau cùng lúc | Một cuộc gọi duy nhất, tự CONNECTED | AC-077 |
| 5 | bob không nghe 45 s | MISSED, alice "Không có người trả lời" | AC-073 |
| 6 | `ICE_TRANSPORT_POLICY=relay`, gọi video | CONNECTED, candidate pair `relay` | AC-085 |
| 7 | Đang CONNECTED, `docker compose ... pause coturn` 8 s rồi `unpause` (chế độ relay) | RECONNECTING → ICE restart → CONNECTED | AC-081 |
| 8 | Đang CONNECTED, restart `npm run dev:server` | Media không đứt; trạng thái về CONNECTED sau reconnect | AC-092 |
| 9 | Mở bằng `http://<LAN-IP>:5173` trên điện thoại | Thông báo không gian không an toàn, nút gọi bị vô hiệu | EC-CALL-MEDIA-009 |
| 10 | Đóng tab trước khi bấm nghe, mở Chrome mới chưa tương tác rồi nhận cuộc gọi | Nút "Chạm để bật âm thanh" | AC-093 |

### 6.3 Ép relay để kiểm tra TURN

1. `server/.env`: `ICE_TRANSPORT_POLICY=relay`, `XIRSYS_IDENT=` và `XIRSYS_SECRET=` trống (dùng coturn local) hoặc điền Xirsys để test Xirsys thật.
2. Restart server. `GET /api/v1/calls/ice-servers` phải trả `"iceTransportPolicy":"relay"` và `"source":"FALLBACK"` (hoặc `"XIRSYS"`).
3. Gọi video. Trong `chrome://webrtc-internals` cặp candidate được chọn có `candidateType: relay` (AC-085).
4. Chỉ TURN qua TCP (mô phỏng UDP bị chặn, EC-CALL-NET-004): đặt `TURN_FALLBACK_URLS=turn:localhost:3478?transport=tcp,turns:localhost:5349?transport=tcp`, restart server. Kỳ vọng `relayProtocol` (trong `local-candidate`) là `tcp` hoặc `tls`.
5. Xirsys lỗi (EC-CALL-NET-006): đặt `XIRSYS_API_URL=https://127.0.0.1:9` (cổng đóng) cùng `XIRSYS_IDENT`/`XIRSYS_SECRET` bất kỳ → response `source: "FALLBACK"`, metric `hustalo_ice_servers_fallback_total` tăng (AC-090).
6. Trả về `ICE_TRANSPORT_POLICY=all` sau khi test.

Gói miễn phí Xirsys có quota băng thông/kết nối; kiểm tra lại quota hiện hành trước production (rủi ro R-01). `// Xác minh với tài liệu chính thức của Xirsys: giới hạn gói free.`

Lưu ý relay↔relay trên cùng máy: khi cả hai trình duyệt đều ép relay qua cùng một coturn trong Docker Desktop, coturn phải gửi tới chính `external-ip` của nó. Với `TURN_EXTERNAL_IP=127.0.0.1` cần `allow-loopback-peers` (đã có trong `turnserver.conf`). Nếu vẫn không kết nối, đặt `TURN_EXTERNAL_IP=<LAN-IP>` hoặc dùng một thiết bị thứ hai trong LAN (troubleshooting T-07).

### 6.4 Đọc `chrome://webrtc-internals`

| Cần kiểm | Chỗ xem | Giá trị mong đợi |
|---|---|---|
| ICE servers dùng thật | Dòng `RTCPeerConnection` đầu tiên → `iceServers` | Khớp response `/calls/ice-servers` (credential hiển thị ở đây là của chính trình duyệt — không chụp màn hình gửi đi) |
| Trạng thái | `iceConnectionState`, `connectionState`, `signalingState` | Lần lượt `checking → connected`; `stable` sau answer |
| Đường đi | Stats `candidate-pair` có `nominated: true`, `state: succeeded` → `local-candidate.candidateType` | `host`/`srflx` (direct) hoặc `relay` |
| ICE restart | Sự kiện `createOffer` với `iceRestart: true`, ufrag mới | Tối đa 2 lần (`CALL_MAX_ICE_RESTARTS`) |
| Media chạy | `inbound-rtp` audio/video: `bytesReceived`, `framesDecoded` | Tăng đều |
| Chất lượng | `roundTripTime`, `packetsLost`, `jitter` | Dùng cho chỉ báo mạng yếu (`ui_ux_spec.md` §4.3) |

Firefox: `about:webrtc`. Safari: Develop → WebRTC logging.

### 6.5 Mô phỏng sự cố mạng

| Sự cố | Cách tạo | Ghi chú |
|---|---|---|
| Mất cả signaling lẫn media | Tắt Wi-Fi máy/điện thoại; hoặc Playwright `context.setOffline(true)` kết hợp `docker compose ... pause coturn` ở chế độ relay | `// Xác minh với tài liệu Playwright: setOffline chặn HTTP/WebSocket; giả định KHÔNG chặn chắc chắn UDP của WebRTC.` Vì vậy E2E mạng luôn chạy relay-only và pause coturn để cắt media một cách tất định |
| Chỉ mất media (socket còn) | Relay-only + `pause coturn` | Kiểm tra đường ICE restart thuần (EC-CALL-NET-002/010) |
| Chỉ mất socket (media còn) | Restart server (`npm run dev:server` tự reload, hoặc kill process) | EC-CALL-NET-009, AC-092 |
| Đổi mạng Wi-Fi → 4G | Thiết bị thật: tắt Wi-Fi điện thoại giữa cuộc gọi | EC-CALL-NET-001 |
| Mạng chậm (cho REST/socket) | DevTools → Network throttling "Slow 3G" | Không ảnh hưởng media WebRTC |
| MongoDB/Redis down | Mục 3.5 | EC-INFRA-001/002 |

### 6.6 Playwright E2E — `client/playwright.config.ts`

```ts
// client/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const chromiumMediaArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,                 // AC-073/082 cần chờ tới 47 s
  expect: { timeout: 10_000 },
  fullyParallel: false,            // các spec dùng chung DB seed
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'https://localhost:5173',
    ignoreHTTPSErrors: true,       // profile Playwright có thể không tin CA mkcert
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: chromiumMediaArgs }, permissions: ['camera', 'microphone'] },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true },
        },
      },
    },
    {
      // WebKit của Playwright không có thiết bị media giả tin cậy: chỉ chạy spec không gắn tag @media.
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grepInvert: /@media/,
    },
  ],
  webServer: {
    command: 'npm run dev',
    cwd: '..',
    url: 'https://localhost:5173/api/v1/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

Quy ước E2E:
- Tên test bắt đầu bằng Test ID và tag: `test('TC-AC-070 gọi thoại thành công @media', …)`.
- `e2e/fixtures.ts` cung cấp: `loginAs(page, 'alice')` (gọi REST login, nạp token qua `/auth/refresh` như reload thật), `twoUsers()` (2 browser context độc lập), `mockGetUserMediaError(page, name, kinds)` (dùng `page.addInitScript` ném `DOMException(name)` — phục vụ AC-078, AC-080, EC-CALL-MEDIA-001/003/005/013 vì thiết bị giả luôn tồn tại), `setIcePolicyRelay()` (đọc env test của server — E2E mạng chạy với một server riêng khởi bởi `call-network.spec.ts` có `ICE_TRANSPORT_POLICY=relay`), `dockerCompose(cmd, service)` (pause/unpause/stop/start).
- Kiểm tra media bằng `page.evaluate` gọi `pc.getStats()` thông qua hook test `window.__hustaloTest` — hook chỉ được gắn khi `import.meta.env.MODE === 'test'` hoặc `import.meta.env.DEV`; build production không có hook (kiểm trong `check-bundle-secrets` không cần; kiểm bằng unit test của `peer-session.ts`).
- Accessibility: mỗi spec màn hình chính gọi `new AxeBuilder({ page }).analyze()` và assert 0 vi phạm `serious`/`critical` (NFR-11).
- Safari 17 (macOS/iOS) test tay theo mục 6.2 trước mỗi release (rủi ro R-02).

### 6.7 Integration test — cấu hình

- `server/vitest.integration.config.ts`: `globalSetup: './src/test/global-setup.ts'`, `include: ['src/**/*.int.test.ts']`, `pool: 'forks'`, `poolOptions.forks.singleFork: true` (một replica set chung), `testTimeout: 30_000`.
- `global-setup.ts`: nạp `server/.env` bằng `process.loadEnvFile` nếu có; khởi động `MongoMemoryReplSet` 1 node (`replSet: { count: 1, storageEngine: 'wiredTiger' }`), gán `MONGODB_URI` = URI của nó, `REDIS_URL` = `REDIS_URL_TEST`, `NODE_ENV=test`, `LOG_LEVEL=silent` qua logger test; gọi `ensureIndexes()`.
- Mỗi file test: `FLUSHDB` Redis DB 15 và `deleteMany({})` các collection ở `beforeEach`.
- Log capture cho AC-104 / AC-ARCH-010: logger nhận `destination` là stream bộ nhớ trong test, test quét các mẫu cấm (token JWT `eyJ`, `$argon2id$`, `a=fingerprint`, `candidate:`, nội dung tin mẫu).
- Test thời gian dùng `src/test/fake-clock.ts` (bọc `vi.useFakeTimers` + điều khiển `Date.now` cho sweeper), không `sleep` thật quá 2 s.

---

## 7. Lộ trình milestone

Nguyên tắc:
- Làm tuần tự M0 → M7. Một milestone chỉ đóng khi **Definition of Done** (`product_requirements.md` §7) thỏa và mọi Test ID trong **Gate** có test tự động pass.
- "(phần …)" nghĩa là AC được kiểm một phần ở milestone này; phần còn lại kiểm ở milestone ghi trong ngoặc.
- Mỗi milestone: chạy `npm run typecheck && npm run lint && npm test`, `npm run test:e2e` (nếu Gate có tầng E), `npm run trace:check -- --milestone Mx`.
- Chuỗi "Mã hóa đầu-cuối" không xuất hiện trong UI trước khi M7 đóng (CLAUDE.md).

### M0 — Nền tảng

Mục tiêu: repo build/lint/test được; hạ tầng local chạy; hợp đồng dùng chung có mặt.

Checklist:
- [ ] File gốc: `package.json`, `package-lock.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.editorconfig`, `.gitignore`, `.gitattributes`, `.nvmrc`, `.npmrc`.
- [ ] `infra/docker-compose.yml`, `infra/mongo/init-replica.js`, `infra/coturn/turnserver.conf`, `infra/.env.example`; `npm run infra:up` báo cả ba service `healthy`.
- [ ] `scripts/gen-secrets.mjs`, `scripts/check-bundle-secrets.mjs`, `scripts/make-certs.mjs`, `scripts/check-traceability.mjs`.
- [ ] `packages/shared`: `constants.ts`, `enums.ts`, `errors.ts`, `schemas/common.schema.ts`, `schemas/socket.schema.ts` (envelope + ACK), `events/event-names.ts` (đủ 35 event), `events/socket-types.ts`, `utils/text.ts`, `utils/cursor.ts`, `utils/compare.ts` + test.
- [ ] Server: `config/env.ts`, `infra/runtime/is-main.ts`, `infra/logger/logger.ts` (redact §11.3), `infra/db/mongo.ts` (kiểm tra replica set), `infra/db/transaction.ts`, `infra/db/indexes.ts`, `infra/redis/redis.ts`, `infra/redis/keys.ts`, `infra/crypto/key-ring.ts`, `infra/crypto/aes-gcm.ts`, `infra/crypto/random.ts`, `infra/metrics/metrics.ts`, `infra/rate-limit/rate-limiter.ts`, `http/middleware/*` (request-id, security, validate, error-handler), `http/errors/app-error.ts`, `modules/health/*`, `app.ts`, `main.ts` (graceful shutdown §10.3), `realtime/gateway.ts` + `with-ack.ts` + `emitter.ts` + `rooms.ts`.
- [ ] Client: Vite + React + Tailwind, `styles/index.css` (design tokens `ui_ux_spec.md` §1), `tailwind.config.ts`, `public/theme-init.js`, `routes/router.tsx` + guards, `components/layout/AppShell.tsx`, `components/ui/*`, `i18n/vi.ts`, `i18n/errors.ts`, `lib/api/http.ts`, `lib/device/device-id.ts`, `test/setup.ts`.
- [ ] CI `.github/workflows/ci.yml` `[NEW]` (mục 8.7).

Gate: `TC-ARCH-001`, `TC-ARCH-002`, `TC-ARCH-003`, `TC-ARCH-004`, `TC-ARCH-011`, `TC-AC-107`, `TC-DB-001`, `TC-DB-004`, `TC-MSG-001` (phần U: chuẩn hóa text), `TC-MSG-002` (phần U), `TC-MSG-003` (phần U), `TC-AC-100` (phần U: AES-GCM với AAD sai ném lỗi), `TC-SEC-006`.

### M1 — Auth và hồ sơ người dùng

Mục tiêu: đăng ký, đăng nhập, refresh xoay vòng, đăng xuất, đổi mật khẩu, khóa tài khoản, socket handshake có xác thực, `session:expired` / `session:revoked`; tìm kiếm, hồ sơ, endpoint chặn.

FR: FR-AUTH-001, FR-AUTH-002, FR-AUTH-003, FR-AUTH-004 (phần logout; phần cuộc gọi ở M5), FR-AUTH-005, FR-AUTH-006, FR-AUTH-007, FR-USER-001, FR-USER-002, FR-USER-003 (phần endpoint), FR-SEC-004, FR-SEC-005 (rule auth + REST chung), FR-SEC-006 (CSRF, cookie), FR-SEC-008 (authenticate mọi route).

Checklist:
- [ ] `modules/auth/*` (+ `refreshSession.model.ts`), `modules/users/*` (+ `user.model.ts`, `userBlock.model.ts`), `infra/crypto/password.ts`, `infra/jwt/jwt.ts`, `http/middleware/authenticate.ts`, `csrf.ts`, `rate-limit.ts`, `realtime/middleware/socket-auth.ts`, `socket-rate-limit.ts`, `realtime/handlers/session.handler.ts`, `jobs/user-lock.ts`.
- [ ] Client: `features/auth/*` (LoginPage, RegisterPage, AuthCard, SessionModal, `useSessionLifecycle.ts`), `lib/api/refresh.ts` (Web Locks, D-19), `lib/socket/socket.ts`, `lib/socket/emit.ts`, `stores/auth.store.ts`, `stores/socket.store.ts`, `components/layout/ConnectionBanner.tsx`, `features/settings/ProfileSection.tsx`, `BlockedSection.tsx`, `SecuritySection.tsx` (đổi mật khẩu).
- [ ] `npm run db:seed` hoạt động.

Gate: `TC-AC-001`, `TC-AC-002`, `TC-AC-003`, `TC-AC-004`, `TC-AC-005`, `TC-AC-006`, `TC-AC-007`, `TC-AC-009`, `TC-AC-010`, `TC-AC-011` (phần session; phần đồng bộ tin ở M3), `TC-AC-012`, `TC-AC-013`, `TC-AC-102`, `TC-AC-108`, `TC-ARCH-013`, `TC-ARCH-014`, `TC-AUTH-001`, `TC-AUTH-002`, `TC-AUTH-003`, `TC-AUTH-004`, `TC-AUTH-005`, `TC-AUTH-006`, `TC-SEC-004`, `TC-SEC-005`, `TC-DB-002`, `TC-DB-003`, `TC-DB-018`, `TC-DB-019`.

### M2 — Hội thoại và nhóm

Mục tiêu: tạo DIRECT idempotent, nhóm, thêm/xóa/rời/đổi tên/phân quyền, SYSTEM message cho sự kiện nhóm, danh sách hội thoại (chưa có số chưa đọc thật), chống dò ID.

FR: FR-CHAT-001, FR-CHAT-009 (phần danh sách, preview, sắp xếp; `unreadCount` ở M3), FR-CHAT-011 (SYSTEM nhóm), FR-GROUP-001..006, FR-USER-003 (phần thêm vào nhóm), FR-SEC-008.

Checklist:
- [ ] `modules/conversations/*` (+ `conversation.model.ts`, `conversationMember.model.ts`), `modules/messages/message.model.ts` + `messages.service.createSystemMessage`, `realtime/handlers/conversation.handler.ts` (`conversation:join`, `conversation:leave`), phát `conversation:updated`, `conversation:member-removed`.
- [ ] Client: `features/conversations/*` (ChatListPane, ChatListHeader, ConversationList, ConversationListItem, ConversationSearch, NewChatDialog, `useConversationEvents.ts`), `features/groups/*` (CreateGroupDialog, MemberManagerDialog, UserPicker, MemberRow, TransferOwnerDialog), khung `ChatRoomPane` + `RoomNotFound`, `SystemMessage.tsx`.

Gate: `TC-AC-017`, `TC-AC-050`, `TC-AC-051`, `TC-AC-052`, `TC-AC-053`, `TC-AC-054`, `TC-AC-055`, `TC-AC-056`, `TC-AC-058`, `TC-AC-059`, `TC-AC-103`, `TC-GROUP-001`, `TC-GROUP-002`, `TC-GROUP-003`, `TC-GROUP-004`, `TC-GROUP-005`, `TC-GROUP-006`, `TC-SEC-001`, `TC-DB-008`, `TC-DB-012`.

### M3 — Tin nhắn và receipt

Mục tiêu: gửi realtime idempotent, ACK sau commit, AES-256-GCM, lịch sử cursor, delivered/read một chiều, outbox, reconnect + sync, sửa/thu hồi 15 phút, chặn trong 1-1, xoay khóa.

FR: FR-CHAT-002, FR-CHAT-003, FR-CHAT-004, FR-CHAT-006, FR-CHAT-007, FR-CHAT-008, FR-CHAT-009 (phần `unreadCount`), FR-CHAT-010, FR-CHAT-011 (SYSTEM trong lịch sử/preview), FR-USER-003 (phần tin nhắn), FR-SEC-002, FR-SEC-003.

Checklist:
- [ ] `modules/messages/*` (service, `receipts.service.ts`, repository, `messageReceipt.model.ts`, `message.crypto.ts`), `realtime/handlers/message.handler.ts` (`message:send`, `message:delivered`, `message:read`, `message:edit`, `message:delete`; phát `message:new`, `message:status`), `jobs/reencrypt-messages.ts`.
- [ ] Client: `features/chat/*` (MessageList, MessageBubble, MessageStatusIcon, DateDivider, NewMessagesButton, Composer, MessageActions, MessageMeta, ReadByIndicator, BlockedComposerNotice, EmptyRoomPlaceholder, RoomMenu, `useMessages.ts`, `useSendMessage.ts`, `useReadReceipts.ts`), `lib/outbox/*`, `stores/outbox.store.ts`, `lib/socket/event-dedupe.ts`, `lib/socket/sync.ts`, `lib/time/*`, `components/layout/LiveRegions.tsx`, `components/ui/UnreadBadge.tsx`.

Gate: `TC-AC-011` (phần đồng bộ), `TC-AC-014` (phần tin nhắn), `TC-AC-015`, `TC-AC-020`, `TC-AC-021`, `TC-AC-022`, `TC-AC-023`, `TC-AC-024`, `TC-AC-025`, `TC-AC-028`, `TC-AC-029`, `TC-AC-030`, `TC-AC-031`, `TC-AC-032`, `TC-AC-033`, `TC-AC-034`, `TC-AC-035`, `TC-AC-036`, `TC-AC-037`, `TC-AC-039`, `TC-AC-040`, `TC-AC-041`, `TC-AC-042`, `TC-AC-043`, `TC-AC-057`, `TC-AC-100`, `TC-AC-101`, `TC-AC-106`, `TC-ARCH-005`, `TC-ARCH-006`, `TC-MSG-001`, `TC-MSG-002`, `TC-MSG-003`, `TC-MSG-004`, `TC-MSG-005`, `TC-MSG-006`, `TC-MSG-007`, `TC-MSG-008`, `TC-MSG-009`, `TC-MSG-010`, `TC-MSG-011`, `TC-MSG-012`, `TC-MSG-013`, `TC-MSG-014`, `TC-MSG-015`, `TC-MSG-016` (phần DIRECT/GROUP có `ciphertext`), `TC-NET-001`, `TC-NET-002`, `TC-NET-003`, `TC-NET-004`, `TC-NET-005`, `TC-NET-006`, `TC-NET-007`, `TC-NET-008`, `TC-NET-009`, `TC-NET-010`, `TC-SEC-002`, `TC-SEC-003`, `TC-INFRA-001`, `TC-INFRA-003`, `TC-GROUP-007`, `TC-DB-005`, `TC-DB-006`, `TC-DB-007`, `TC-DB-009`, `TC-DB-010`, `TC-DB-011`, `TC-DB-013`, `TC-DB-014`, `TC-DB-020`.

### M4 — Presence và typing

FR: FR-PRES-001, FR-PRES-002, FR-PRES-003, FR-USER-004, FR-CHAT-005.

Checklist:
- [ ] `modules/presence/*` (service, repository, sweeper, `typing.service.ts`), Lua `presence-touch.lua`, `presence-drop.lua`, `realtime/handlers/presence.handler.ts` (`presence:subscribe` → `presence:snapshot`, `presence:update`), `typing.handler.ts` (`typing:start`, `typing:stop` → `typing:update`).
- [ ] Client: `features/presence/*` (OnlineDot, `usePresence.ts`), `stores/presence.store.ts`, `stores/typing.store.ts`, `features/chat/TypingIndicator.tsx`, typing trong preview danh sách, `features/settings/PrivacySection.tsx`.

Gate: `TC-AC-014` (phần typing), `TC-AC-016`, `TC-AC-026`, `TC-AC-027`, `TC-AC-060`, `TC-AC-061`, `TC-AC-062`, `TC-AC-063`, `TC-PRES-001`, `TC-PRES-002`, `TC-PRES-003`, `TC-PRES-004`, `TC-PRES-005`, `TC-DB-024`, `TC-DB-025`.

### M5 — Cuộc gọi voice/video 1-1

FR: FR-CALL-001..011, FR-AUTH-004 (phần cuộc gọi), FR-USER-003 (phần cuộc gọi).

Checklist:
- [ ] Server: `modules/calls/*` (`call.state-machine.ts` thuần + test 100% nhánh, `callState.repository.ts`, `calls.repository.ts`, `call.sweeper.ts`, `iceServers.service.ts`, `callHistory.model.ts`), Lua `call-invite.lua`, `call-transition.lua`, `call-deadlines-claim.lua`, `infra/turn/xirsys.client.ts`, `realtime/handlers/call.handler.ts` (đủ 15 event `call:*`), `jobs/reconcile-calls.ts`, đẩy `call:incoming` khi callee kết nối (D-08).
- [ ] Client: `lib/webrtc/*` (support, media, ice-servers, candidate-queue, peer-session), `stores/call.store.ts`, `features/calls/*` (CallOverlay, IncomingCallScreen, OutgoingCallScreen, InCallScreen, CallControls, CallEndedNotice, CallTopBar, CallStatusText, LocalVideo, RemoteVideo, RemoteAudio, AutoplayUnlockButton, MediaErrorPanel, `useCallController.ts`, `useRingtone.ts`, CallHistoryList), `public/sounds/*`.
- [ ] Test tay mục 6.2 trên Chrome + Firefox + Safari 17.

Gate: `TC-AC-008`, `TC-AC-014` (phần cuộc gọi), `TC-AC-070`, `TC-AC-071`, `TC-AC-072`, `TC-AC-073`, `TC-AC-074`, `TC-AC-075`, `TC-AC-076`, `TC-AC-077`, `TC-AC-078`, `TC-AC-079`, `TC-AC-080`, `TC-AC-081`, `TC-AC-082`, `TC-AC-083`, `TC-AC-084`, `TC-AC-085`, `TC-AC-086`, `TC-AC-087`, `TC-AC-088`, `TC-AC-089`, `TC-AC-090`, `TC-AC-091`, `TC-AC-092`, `TC-AC-093`, `TC-ARCH-007`, `TC-ARCH-008`, `TC-ARCH-015`, `TC-AUTH-007`, `TC-SEC-008`, `TC-CALL-SIG-001`, `TC-CALL-SIG-002`, `TC-CALL-SIG-003`, `TC-CALL-SIG-004`, `TC-CALL-SIG-005`, `TC-CALL-SIG-006`, `TC-CALL-SIG-007`, `TC-CALL-SIG-008`, `TC-CALL-SIG-009`, `TC-CALL-SIG-010`, `TC-CALL-SIG-011`, `TC-CALL-SIG-012`, `TC-CALL-SIG-013`, `TC-CALL-SIG-014`, `TC-CALL-SIG-015`, `TC-CALL-SIG-016`, `TC-CALL-MEDIA-001`, `TC-CALL-MEDIA-002`, `TC-CALL-MEDIA-003`, `TC-CALL-MEDIA-004`, `TC-CALL-MEDIA-005`, `TC-CALL-MEDIA-006`, `TC-CALL-MEDIA-007`, `TC-CALL-MEDIA-008`, `TC-CALL-MEDIA-009`, `TC-CALL-MEDIA-010`, `TC-CALL-MEDIA-011`, `TC-CALL-MEDIA-012`, `TC-CALL-MEDIA-013`, `TC-CALL-NET-001`, `TC-CALL-NET-002`, `TC-CALL-NET-003`, `TC-CALL-NET-004`, `TC-CALL-NET-005`, `TC-CALL-NET-006`, `TC-CALL-NET-007`, `TC-CALL-NET-008`, `TC-CALL-NET-009`, `TC-CALL-NET-010`, `TC-DB-015`, `TC-DB-021`, `TC-DB-022`, `TC-DB-023`.

Ghi chú: `TC-CALL-NET-001` (đổi Wi-Fi → 4G) có test tự động mô phỏng bằng ICE restart cưỡng bức (`pause coturn` + đổi `TURN_FALLBACK_URLS` sang cổng TCP) và **thêm** một lần test tay trên điện thoại thật trước khi đóng M5.

### M6 — Hardening

Mục tiêu: đo và đạt NFR, khóa bảo mật, khả năng vận hành.

FR: FR-SEC-001, FR-SEC-005 (đầy đủ, gồm hành vi Redis down D-10), FR-SEC-006 (CSP/header đầy đủ), FR-SEC-007 (quét log toàn luồng).

Checklist:
- [ ] Load test k6 (`load/` `[NEW]` ở gốc repo: `message-send.js`, `sockets.js`) đạt NFR-01, NFR-09; báo cáo đính kèm PR.
- [ ] Lighthouse CI đạt NFR-05; bundle khởi tạo ≤ 300 KB gzip.
- [ ] Coverage ≥ 80% (`server/src/modules/**`, `packages/shared/src/**`), `call.state-machine.ts` 100% nhánh (NFR-14).
- [ ] `npm audit --omit=dev` không có high/critical (NFR-13).
- [ ] Smoke 2 instance với `SOCKET_ADAPTER=redis-streams` sau proxy sticky: chat + cuộc gọi giữa user ở hai instance.
- [ ] Runbook backup/restore (kiến trúc §9.7) diễn tập một lần trên staging.
- [ ] Toàn bộ Gate M0–M5 chạy lại xanh trên 3 project Playwright.

Gate: `TC-AC-104`, `TC-AC-105`, `TC-AC-107`, `TC-AC-109`, `TC-ARCH-009`, `TC-ARCH-010`, `TC-ARCH-011`, `TC-ARCH-012`, `TC-SEC-006`, `TC-SEC-007`, `TC-INFRA-002`, `TC-DB-026`, và `npm run trace:check -- --strict` cho mọi Test ID của FR ngoài nhóm E2EE.

### M7 — E2EE (Secret Chat)

FR: FR-E2EE-001..008, FR-CHAT-007 và FR-CHAT-008 (phần SECRET: thu hồi được, sửa bị `FORBIDDEN`, D-16).

Checklist:
- [ ] Server: `modules/e2ee/*` (`userDevice.model.ts`, `oneTimePreKey.model.ts`, consume nguyên tử, `e2ee:prekeys-low` với cooldown `e2ee:lowsent:{deviceId}`), kiểm envelope trong `message:send` kind `E2EE`, tạo conversation `SECRET` (D-11), thu hồi device → `session:revoked { DEVICE_REVOKED }`.
- [ ] Client: `lib/e2ee/*` (`signal-adapter.ts` cô lập thư viện D-12, `signal-store.ts`, `device-keys.ts`, `envelope.ts`, `safety-number.ts`), `features/e2ee/*` (`useSecretSession.ts`, IdentityChangedBanner), `features/chat/E2eeBadge.tsx`, `features/settings/DevicesSection.tsx`, `SafetyNumberDialog.tsx`; thư viện Signal tải lười (NFR-05).
- [ ] Review mã nguồn thư viện Signal đã khóa phiên bản (R-04), ghi kết quả vào PR.
- [ ] Bật hiển thị "Mã hóa đầu-cuối" — chỉ trong conversation SECRET đã thiết lập session (AC-122).

Gate: `TC-AC-110`, `TC-AC-111`, `TC-AC-112`, `TC-AC-113`, `TC-AC-114`, `TC-AC-115`, `TC-AC-116`, `TC-AC-117`, `TC-AC-118`, `TC-AC-119`, `TC-AC-120`, `TC-AC-121`, `TC-AC-122`, `TC-E2EE-001`, `TC-E2EE-002`, `TC-E2EE-003`, `TC-E2EE-004`, `TC-E2EE-005`, `TC-E2EE-006`, `TC-E2EE-007`, `TC-E2EE-008`, `TC-MSG-016`, `TC-MSG-017`, `TC-DB-016`, `TC-DB-017`, và `npm run trace:check -- --strict` toàn bộ.

---

## 8. Quy ước code

### 8.1 TypeScript

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`client/tsconfig.json` thêm `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"jsx": "react-jsx"`, `"types": ["vite/client"]`. `server/tsconfig.json` thêm `"types": ["node"]`.

### 8.2 ESLint (flat config) — quy tắc bắt buộc

```js
// eslint.config.js (trích các rule bắt buộc; preset: @eslint/js recommended, typescript-eslint strictTypeChecked, react, react-hooks, import, prettier)
export const hustaloRules = {
  'no-console': 'error',                                      // dùng logger (pino) ở server, không log ở client production
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
  'eslint-comments/require-description': 'off',
  'react/no-danger': 'error',                                 // cấm dangerouslySetInnerHTML (CLAUDE.md, kiến trúc §9.6)
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'error',
  'import/no-cycle': 'error',                                 // AC-ARCH-001
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.property.name='skip']",
      message: 'Cấm phân trang bằng skip — dùng cursor (createdAt, _id) (CLAUDE.md, D-20).',
    },
    {
      selector: "MemberExpression[object.name='localStorage'][property.name=/^(setItem)$/] > Literal[value=/token/i]",
      message: 'Không lưu token vào localStorage (access token chỉ ở RAM).',
    },
  ],
};
```

Ràng buộc import theo thư mục (cấu hình `no-restricted-imports` theo `files`):

| Thư mục | Không được import |
|---|---|
| `packages/shared/**` | `mongoose`, `ioredis`, `express`, `socket.io`, `react`, mọi thứ trong `server/`, `client/` |
| `client/**` | `server/**`, `mongoose`, `ioredis`, `node:*` |
| `server/**` | `client/**`, `react` |
| `server/src/modules/*/**.repository.ts` | `realtime/**` (repository không phát event) |
| `server/src/modules/**` (trừ `*.schema.ts`) | Khai báo `z.object` cho hợp đồng REST/socket — hợp đồng phải nằm ở `@hustalo/shared` (rule `no-restricted-syntax` riêng cho `CallExpression[callee.object.name='z']` trong `*.controller.ts`, `*.handler.ts`) |

Tắt rule bằng `eslint-disable` phải kèm lý do sau `--` và được reviewer chấp nhận (DoD §7.4).

### 8.3 Prettier và EditorConfig

`.prettierrc.json`:

```json
{
  "printWidth": 120,
  "singleQuote": true,
  "trailingComma": "all",
  "semi": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

`.prettierignore` `[NEW]`: `**/dist`, `coverage`, `client/playwright-report`, `client/test-results`, `infra/certs`, `package-lock.json`.

`.editorconfig`: `root = true`, `[*]` `charset = utf-8`, `end_of_line = lf`, `indent_style = space`, `indent_size = 2`, `insert_final_newline = true`, `trim_trailing_whitespace = true`.

### 8.4 Tổ chức shared types

| Nhu cầu | Đặt ở đâu | Ví dụ |
|---|---|---|
| Enum, hằng số, mã lỗi | `packages/shared/src/{enums,constants,errors}.ts` | `CallStatus`, `MESSAGE_MAX_LENGTH`, `ErrorCode` |
| Hợp đồng REST (body, query, DTO) | `packages/shared/src/schemas/<domain>.schema.ts`, export cả schema và `type X = z.infer<typeof XSchema>` | `SendMessagePayloadSchema`, `type Message` |
| Hợp đồng socket | `schemas/socket.schema.ts` + `events/event-names.ts` + `events/socket-types.ts` | `EVENTS.MESSAGE_SEND`, `ClientToServerEvents` |
| Util thuần dùng hai phía | `packages/shared/src/utils/*` | `normalizeMessageText` |
| Type chỉ của server (Mongoose doc, Redis hash) | file `*.model.ts` / `*.repository.ts` của module | `MessageDoc` |
| Type chỉ của client (UI state) | `client/src/stores/*`, `features/*` | `LocalCallPhase` |

- Server `*.schema.ts` chỉ re-export/ghép schema từ shared (kiến trúc §4.2).
- Tên event luôn dùng hằng `EVENTS.*`, không viết chuỗi `'message:send'` trực tiếp ngoài `event-names.ts`.
- Chuỗi UI tiếng Việt chỉ ở `client/src/i18n/vi.ts`; ánh xạ `ErrorCode` → chuỗi ở `client/src/i18n/errors.ts`.

### 8.5 Quy tắc "cập nhật spec trước khi đổi hợp đồng"

Hợp đồng gồm: enum, hằng số, mã lỗi, tên/payload event, endpoint/DTO, collection/index, key Redis, biến môi trường, chuỗi UI trong ma trận trạng thái.

1. Phát hiện cần đổi → **dừng code**.
2. Mở PR (hoặc đề xuất trong phiên làm việc) chỉ sửa `.spec/` + `packages/shared` nếu cần, ghi rõ: ID bị ảnh hưởng (FR/AC/EC/D-xx), lý do, các file spec phải đổi đồng bộ.
3. Chờ người sở hữu spec duyệt.
4. Sau khi duyệt: sửa test theo AC/EC mới → sửa code → cập nhật Traceability Matrix.
5. Không bao giờ để code và spec lệch nhau trên nhánh `main`.

### 8.6 Commit, nhánh, PR

- Commit theo Conventional Commits: `<type>(<scope>): <mô tả ngắn, tiếng Việt hoặc tiếng Anh>`.
  - `type`: `feat`, `fix`, `test`, `refactor`, `perf`, `docs`, `chore`, `build`, `ci`, `spec`.
  - `scope`: `shared`, `server`, `client`, `infra`, `spec`, hoặc tên module (`auth`, `messages`, `calls`, `e2ee`…).
  - Footer bắt buộc khi đổi hành vi: `Refs: FR-CHAT-002, AC-020, EC-NET-004`.
  - Ví dụ: `feat(messages): ACK message:send sau commit transaction` + `Refs: FR-CHAT-002, AC-020, AC-021`.
- Nhánh: `m<số>/<mô-tả>` (ví dụ `m3/outbox-retry`), `fix/<mô-tả>`, `spec/<mô-tả>`.
- PR: mô tả FR/AC/EC đã phủ, danh sách Test ID mới, kết quả `npm run typecheck && npm run lint && npm test` (và `test:e2e` nếu có), ảnh/video cho thay đổi UI, xác nhận không log dữ liệu cấm.
- Không commit: `.env` thật, `infra/certs/*`, file `rootCA*`, dump DB, ảnh chụp `webrtc-internals` có credential.

### 8.7 CI — `.github/workflows/ci.yml` `[NEW]`

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7.2-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-retries 20
    env:
      NODE_ENV: test
      REDIS_URL_TEST: redis://localhost:6379/15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm audit --omit=dev --audit-level=high

  e2e:
    runs-on: ubuntu-latest
    needs: verify
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: sudo apt-get update && sudo apt-get install -y mkcert libnss3-tools
      - run: mkcert -install && npm run certs
      - run: node scripts/ci-env.mjs
      - run: npm run infra:up
      - run: npm run db:indexes && npm run db:seed
      - run: npx playwright install --with-deps
        working-directory: client
      - run: npm run test:e2e
      - run: npm run build
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: client/playwright-report
```

- Redis của job `verify` không có mật khẩu (container dịch vụ CI tạm thời); `REDIS_URL_TEST` khớp. `// Xác minh với tài liệu GitHub Actions: phiên bản major hiện hành của actions/checkout, setup-node, upload-artifact.`
- `scripts/ci-env.mjs` `[NEW]`: sinh `infra/.env`, `server/.env`, `client/.env` từ các file `.env.example` với secret ngẫu nhiên (dùng lại logic `gen-secrets.mjs`), không in giá trị ra log.

### 8.8 Truy vết test — `scripts/check-traceability.mjs` `[NEW]`

- Đọc `.spec/development_guide.md`; thu mọi Test ID khớp `/TC-(?:AC|ARCH|DB|AUTH|NET|MSG|GROUP|PRES|CALL-SIG|CALL-MEDIA|CALL-NET|INFRA|SEC|E2EE)-\d{3}/g`.
  - `--milestone M3`: chỉ lấy ID trong đoạn từ tiêu đề `### M3` tới tiêu đề `###` kế tiếp.
  - Mặc định: lấy ID ở bảng Traceability Matrix.
- Quét `packages/shared/src`, `server/src`, `client/src`, `client/e2e` tìm chuỗi `'TC-…'` hoặc `"TC-…"` hoặc `` `TC-…`` ở **đầu tên** `it(`/`test(`/`describe(`.
- In ID thiếu test. `--strict`: exit 1 nếu thiếu. Không có `--strict`: exit 0 (dùng khi đang làm dở milestone).
- Một test có thể phủ nhiều ID: `it('TC-AC-021 TC-NET-004 retry trùng trả duplicate', …)`.

### 8.9 Log và dữ liệu nhạy cảm

- Chỉ log qua `logger` (pino), field có cấu trúc; redact theo kiến trúc §11.3.
- Cấm log: mật khẩu, access/refresh token, cookie, CSRF token, nội dung tin (`content`, `contentEnc`, `ciphertext`, envelope), SDP, ICE candidate, credential TURN, `XIRSYS_*`, key `DATA_ENCRYPTION_KEYS`, giá trị env.
- Được log: `requestId`, `userId`, `conversationId`, `messageId`, `callId`, `deviceId`, mã lỗi, độ trễ, kích thước payload.

---

## 9. Troubleshooting

| ID | Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|---|
| T-01 | Server thoát: "MongoDB phải chạy replica set (rs0) để dùng transaction"; hoặc lỗi `Transaction numbers are only allowed on a replica set member or mongos` | Replica set chưa khởi tạo, hoặc URI thiếu `replicaSet=rs0` | `docker compose --env-file infra/.env -f infra/docker-compose.yml ps` → mongo phải `healthy`. Chưa healthy sau 60 s: `docker compose ... logs mongo`, rồi chạy tay `docker compose ... exec mongo mongosh --quiet /scripts/init-replica.js`. Kiểm tra `MONGODB_URI` có `replicaSet=rs0&directConnection=true` |
| T-02 | `MongoServerSelectionError: getaddrinfo ENOTFOUND mongo` | Driver khám phá topology và nhận host `mongo:27017` không phân giải được từ host | Thêm `directConnection=true` vào `MONGODB_URI` (DG-05) |
| T-03 | Đăng nhập được nhưng reload trang bị đá về `/login`; `/auth/refresh` trả 401 | Cookie `hustalo_rt` không được gửi: trang mở qua origin khác (ví dụ `http://localhost:4000` thay vì `https://localhost:5173`), hoặc `Secure` cookie trên HTTP LAN | Luôn mở app qua `https://localhost:5173` hoặc `https://<LAN-IP>:5173`. Trong DevTools → Application → Cookies kiểm tra `hustalo_rt` có `Path=/api/v1/auth` |
| T-04 | `/auth/refresh` trả 403 | Thiếu/sai header `X-CSRF-Token` (cookie `hustalo_csrf` không đọc được, ví dụ đã xóa cookie) | Đăng nhập lại để server cấp cặp cookie mới; kiểm tra `lib/api/http.ts` gửi header từ `document.cookie` |
| T-05 | Request bị CORS chặn / socket `connect_error` xhr poll error | Origin không có trong `CORS_ORIGINS` (thường gặp khi mở bằng LAN-IP) | Thêm `https://<LAN-IP>:5173` vào `CORS_ORIGINS`, restart server. Không thêm `*` (cookie credentials không cho phép) |
| T-06 | Socket không kết nối: `connect_error` với `UNAUTHENTICATED` | Access token hết hạn/thu hồi, hoặc `deviceId` handshake khác claim `did` (đổi `localStorage` thủ công) | Đăng xuất/đăng nhập lại; không sửa `hustalo.deviceId` bằng tay. Nếu lỗi `TOKEN_EXPIRED`: client phải refresh rồi reconnect (D-18) — kiểm tra `useSessionLifecycle.ts` |
| T-07 | Socket chỉ chạy long-polling, không có WebSocket | Proxy công ty/antivirus chặn WebSocket, hoặc proxy Vite thiếu `ws: true` | Đây là EC-NET-010, app vẫn chạy bằng polling. Kiểm tra `vite.config.ts` có `ws: true` cho `/socket.io`. Ở production: reverse proxy phải chuyển `Upgrade`/`Connection` header và bật sticky session khi nhiều instance |
| T-08 | `iceConnectionState` → `failed`, cuộc gọi kết thúc `NETWORK_FAILURE` | Không có cặp candidate dùng được: hai bên sau NAT đối xứng mà không có TURN; credential TURN sai; firewall chặn UDP 49160–49200 | `GET /calls/ice-servers` phải có TURN. Kiểm tra `TURN_FALLBACK_*` trùng `infra/.env`. `docker compose ... logs coturn` tìm `401` (sai credential). Test relay riêng (mục 6.3). Với relay↔relay cùng máy: đặt `TURN_EXTERNAL_IP=<LAN-IP>` |
| T-09 | `turns:` không kết nối được | Chứng chỉ trong `infra/certs` thiếu hoặc không chứa host trong URL | `npm run certs`, `docker compose ... restart coturn`; URL `turns:` phải dùng `localhost` hoặc LAN-IP có trong chứng chỉ |
| T-10 | `NotReadableError` / "Thiết bị đang được ứng dụng khác sử dụng" | Camera/micro bị Zoom/Teams/OBS hoặc trình duyệt khác giữ (Windows khóa camera độc quyền) | Đóng ứng dụng kia; khi test hai người trên một máy dùng `--use-fake-device-for-media-stream` (mục 6.1). Đây là EC-CALL-MEDIA-005 |
| T-11 | `navigator.mediaDevices` là `undefined` | Không phải secure context (mở bằng `http://<LAN-IP>`) | Dùng `https://<LAN-IP>:5173` với CA mkcert đã cài trên thiết bị (mục 5.5) |
| T-12 | Console báo Mixed Content; socket gọi `ws://` | `VITE_SOCKET_URL`/`VITE_API_URL` đặt URL tuyệt đối `http://...` trong khi trang là HTTPS | Dùng giá trị tương đối mặc định (`/api/v1`, `/`) — DG-09 |
| T-13 | Không nghe nhạc chuông | Autoplay bị chặn khi trang chưa có tương tác | Đúng thiết kế (EC-CALL-MEDIA-010): bấm "Chạm để bật âm thanh" |
| T-14 | `npm run db:indexes` chạy xong nhưng không làm gì trên Windows | Entry script so `import.meta.url` với `file://${argv[1]}` (sai trên Windows) | Dùng `isMainModule(import.meta.url)` (DG-02) |
| T-15 | `Error: listen EADDRINUSE :::4000` hoặc `5173` | Process cũ còn chạy | Windows: `Get-NetTCPConnection -LocalPort 4000 \| Select-Object OwningProcess` rồi `Stop-Process -Id <pid>`; macOS/Linux: `lsof -i :4000` rồi `kill <pid>` |
| T-16 | Integration test treo/timeout khi khởi động | `mongodb-memory-server` đang tải binary MongoDB lần đầu, hoặc Redis test không chạy | Lần đầu chờ tải xong (cần mạng); kiểm tra `REDIS_URL_TEST` và `npm run infra:up` |
| T-17 | `[env] JWT_ACCESS_SECRET: phải là base64url của tối thiểu 32 byte` | Chưa thay giá trị mẫu trong `server/.env` | `npm run secrets`, dán vào `server/.env` |
| T-18 | `[bundle-secrets] Biến client bị cấm: VITE_…` khi build | Đặt biến nhạy cảm có tiền tố `VITE_` | Xóa biến khỏi `client/.env*`; secret chỉ thuộc server (AC-105) |
| T-19 | coturn không khởi động: lỗi đọc `turnserver.conf` | File có CRLF hoặc thiếu `infra/.env` biến `TURN_*` | Kiểm tra `.gitattributes` (mục 1.4), `git add --renormalize .`; điền `infra/.env` |
| T-20 | Mọi người dùng hiển thị "không xác định" (presence) | Redis down hoặc mất kết nối (EC-PRES-005 / EC-INFRA-002) | `docker compose ... ps redis`; `REDIS_URL` đúng mật khẩu. Trạng thái tự hồi phục sau ≤ 1 chu kỳ heartbeat |

---

## Consistency Check

- [x] **Enum, event, mã lỗi, hằng số khớp mục 2 và 3:** file này không định nghĩa enum/event/mã lỗi mới; các hằng số được dùng đúng tên/giá trị của `constants.ts` (kiến trúc §4.4.1): `CALL_RING_TIMEOUT_MS` 45 s (giá trị mặc định env và ràng buộc DG-08), `SOCKET_PING_INTERVAL_MS` 25 s, `SOCKET_PING_TIMEOUT_MS` 20 s, `CALL_MAX_ICE_RESTARTS` 2, `TURN_CREDENTIAL_TTL_S` 1 h, `PASSWORD_MIN/MAX` 8..128 (seed password). Tên event `call:*`, `session:*`, `e2ee:prekeys-low` dùng đúng danh sách 35 event; không có `message:ack` hay `call:initiate`.
- [x] **FR/AC được tham chiếu bằng ID:** mỗi milestone liệt kê FR và Gate theo `TC-AC-*`; Traceability Matrix phủ đủ 58 FR (56 FR trong registry kiến trúc Phụ lục B + `FR-CHAT-011`, `FR-CALL-011` do PRD bổ sung).
- [x] **Edge case có ID:** đủ 104 EC (`TC-AUTH-001..007`, `TC-NET-001..010`, `TC-MSG-001..017`, `TC-GROUP-001..007`, `TC-PRES-001..005`, `TC-CALL-SIG-001..016`, `TC-CALL-MEDIA-001..013`, `TC-CALL-NET-001..010`, `TC-INFRA-001..003`, `TC-SEC-001..008`, `TC-E2EE-001..008`) đều nằm trong Gate của đúng một hoặc nhiều milestone và trong Traceability Matrix; 26 test database `TC-DB-001..026` và 15 `TC-ARCH-*` cũng được phân vào milestone.
- [x] **Không có secret thật, không chỗ trống:** mọi file `.env.example` dùng giá trị mẫu `replace-…`; `SEED_PASSWORD` là mật khẩu dev cục bộ, bị env.ts cấm ở production; chỗ chưa chắc chắn về công cụ bên thứ ba đều có `// Xác minh với tài liệu chính thức của …` (tsx `--env-file`, tag image coturn/mongo-express, Xirsys base URL và quota, Playwright `setOffline`, GitHub Actions, menu Android).
- [x] **Không mâu thuẫn với file đã sinh — các điểm đã đối chiếu:**
  - Cây thư mục kiến trúc §4.1: dùng đúng `infra/docker-compose.yml`, `infra/mongo/init-replica.js` (host `mongo:27017`), `infra/coturn/turnserver.conf`, `infra/certs/localhost+lan*.pem`, `scripts/gen-secrets.mjs` (có `--data-key` như §9.2.4), `scripts/check-bundle-secrets.mjs`, `server/src/infra/db/{indexes,seed}.ts`, `jobs/reencrypt-messages.ts`, `test/{global-setup,fake-clock}.ts`, `client/{vite,playwright}.config.ts`, `client/e2e/*`.
  - File `[NEW]` bổ sung (không đổi cấu trúc): `.gitattributes`, `.npmrc`, `.prettierignore`, `infra/.env.example`, `scripts/make-certs.mjs`, `scripts/check-traceability.mjs`, `scripts/ci-env.mjs`, `server/src/infra/runtime/is-main.ts`, `server/src/jobs/user-lock.ts`, `.github/workflows/ci.yml`, `load/*.js`.
  - Cổng (kiến trúc §3): 5173, 4000, 9464, 27017, 6379, 3478/5349, 8081 — khớp.
  - Biến môi trường: đủ danh sách gốc + Phụ lục D (`NODE_ENV`, `METRICS_PORT`, `REDIS_KEY_PREFIX`, `REDIS_URL_TEST`, `SOCKET_ADAPTER`, `TRUST_PROXY`) + `SEED_PASSWORD` (`database_schema.md` §6.5).
  - Cookie/CSRF (kiến trúc §6.3), Socket.IO path/ping (§6.4), ICE servers/Xirsys/fallback/`ICE_TRANSPORT_POLICY` (§9.5), Redis/Mongo down (§10.1–10.2), `db:indexes`/`db:migrate`/`db:seed` (`database_schema.md` §6.3–6.5), `user:lock`/`user:unlock` (PRD FR-AUTH-006), `job:reencrypt` (kiến trúc §9.2.4), lint OpenAPI bằng `@redocly/cli` (`api_spec.yaml` header), DoD (PRD §7), NFR-05/09/11/13/14 (PRD §6).
  - Quyết định mới của file này: DG-01..DG-10. DG-03 (job `user:lock` báo instance qua kênh Redis `ops:user-locked`) và DG-10 (Xirsys chưa cấu hình → fallback không cảnh báo) là **bổ sung chi tiết hiện thực**, không đổi hợp đồng API/event.
  - **Đề xuất sửa spec (chờ duyệt, chưa áp dụng vào file khác):** `database_schema.md` §6.3 dùng `if (import.meta.url === \`file://${process.argv[1]}\`)` — điều kiện này luôn sai trên Windows nên `npm run db:indexes` không chạy gì; đề xuất đổi thành `if (isMainModule(import.meta.url))` theo DG-02 và thêm `server/src/infra/runtime/is-main.ts` vào cây kiến trúc §4.1.

---

## Traceability Matrix

Cột "Test ID" liệt kê test bắt buộc; `npm run trace:check -- --strict` kiểm mọi ID trong cột này có test tự động. Màn hình UI tham chiếu `ui_ux_spec.md` §3. Redis key viết không kèm tiền tố `REDIS_KEY_PREFIX`.

| FR | AC | Edge case | API / Event | Collection / Redis | Màn hình UI | Test ID | Milestone |
|---|---|---|---|---|---|---|---|
| FR-AUTH-001 | AC-001, AC-002 | EC-AUTH-001 | `POST /auth/register` (`registerUser`) | `users`, `refreshSessions`; `rl:register:*` | §3.1 RegisterPage | TC-AC-001, TC-AC-002, TC-AUTH-001, TC-DB-002 | M1 |
| FR-AUTH-002 | AC-003, AC-004 | EC-SEC-005 | `POST /auth/login` (`loginUser`) | `users`, `refreshSessions`; `rl:login:*` | §3.1 LoginPage | TC-AC-003, TC-AC-004, TC-SEC-005 | M1 |
| FR-AUTH-003 | AC-005, AC-006, AC-007, AC-ARCH-013 | EC-AUTH-003, EC-AUTH-004, EC-SEC-004 | `POST /auth/refresh` (`refreshSession`); `session:revoked` | `refreshSessions`; `session:revoked:{sid}`, `rl:refresh:*` | §3.9 SessionModal (useSessionLifecycle) | TC-AC-005, TC-AC-006, TC-AC-007, TC-ARCH-013, TC-AUTH-003, TC-AUTH-004, TC-SEC-004, TC-DB-018, TC-DB-019 | M1 |
| FR-AUTH-004 | AC-008 | EC-AUTH-007 | `POST /auth/logout` (`logoutSession`); `call:state` | `refreshSessions`, `callHistory`; `session:revoked:{sid}`, `call:active:{callId}`, `user:incall:{userId}` | §3.8 SettingsPage (Đăng xuất), §3.7 InCallScreen | TC-AC-008, TC-AUTH-007 | M1 (logout), M5 (cuộc gọi) |
| FR-AUTH-005 | AC-009 | EC-AUTH-006 | `POST /auth/change-password` (`changePassword`); `session:revoked` | `users`, `refreshSessions`; `session:revoked:{sid}` | §3.8 SecuritySection | TC-AC-009, TC-AUTH-006 | M1 |
| FR-AUTH-006 | AC-010 | EC-AUTH-005 | Script `user:lock`/`user:unlock`; `session:revoked` | `users`, `refreshSessions`; `session:revoked:{sid}` | §3.9 SessionModal | TC-AC-010, TC-AUTH-005 | M1 |
| FR-AUTH-007 | AC-011, AC-ARCH-014 | EC-AUTH-002 | Handshake `auth.token`; `session:expired` | — (JWT); `session:revoked:{sid}` | §3.0 ConnectionBanner, §3.9 SessionModal | TC-AC-011, TC-ARCH-014, TC-AUTH-002 | M1, M3 (sync) |
| FR-USER-001 | AC-012 | — | `GET /users/search` (`searchUsers`) | `users`, `userBlocks` | §3.2 NewChatDialog, §3.4 UserPicker | TC-AC-012 | M1 |
| FR-USER-002 | AC-013 | — | `PATCH /users/me` (`updateMe`), `GET /auth/me` (`getMe`) | `users` | §3.8 ProfileSection | TC-AC-013 | M1 |
| FR-USER-003 | AC-014, AC-015, AC-033, AC-087 | EC-MSG-011, EC-CALL-SIG-013, EC-GROUP-003 | `POST/DELETE /users/{userId}/block` (`blockUser`, `unblockUser`); ACK `USER_BLOCKED` cho `message:send`, `typing:start`, `call:invite` | `userBlocks`, `conversations` | §3.3 BlockedComposerNotice, §3.8 BlockedSection | TC-AC-014, TC-AC-015, TC-AC-033, TC-AC-087, TC-MSG-011, TC-CALL-SIG-013, TC-GROUP-003 | M1, M3, M4, M5 |
| FR-USER-004 | AC-016 | EC-PRES-004 | `PATCH /users/me` (`privacy.showLastSeen`); `presence:snapshot`, `presence:update` | `users` | §3.8 PrivacySection, §3.3 ChatHeader | TC-AC-016, TC-PRES-004 | M4 |
| FR-CHAT-001 | AC-017 | — | `POST /conversations` type DIRECT (`createConversation`) | `conversations`, `conversationMembers` | §3.2 NewChatDialog | TC-AC-017, TC-DB-008 | M2 |
| FR-CHAT-002 | AC-020, AC-021, AC-029, AC-035, AC-036, AC-ARCH-006 | EC-MSG-001, EC-MSG-002, EC-MSG-005, EC-MSG-006, EC-MSG-010, EC-MSG-012, EC-NET-004, EC-SEC-002, EC-INFRA-003 | `message:send` (ACK), `message:new` | `messages`, `messageReceipts`, `conversations`; `rl:messageSend:*` | §3.3 Composer, MessageBubble | TC-AC-020, TC-AC-021, TC-AC-029, TC-AC-035, TC-AC-036, TC-ARCH-006, TC-MSG-001, TC-MSG-002, TC-MSG-005, TC-MSG-006, TC-MSG-010, TC-MSG-012, TC-NET-004, TC-SEC-002, TC-INFRA-003, TC-DB-005, TC-DB-006, TC-DB-007 | M3 |
| FR-CHAT-003 | AC-037 | EC-NET-007, EC-SEC-001, EC-MSG-013 | `GET /conversations/{id}/messages` (`listMessages`) | `messages` (index `(conversationId, createdAt, _id)`) | §3.3 MessageList, NewMessagesButton | TC-AC-037, TC-NET-007, TC-SEC-001, TC-MSG-013, TC-DB-009 | M3 |
| FR-CHAT-004 | AC-022, AC-023, AC-024, AC-025, AC-042, AC-043 | EC-MSG-008, EC-MSG-009, EC-MSG-014, EC-SEC-003 | `message:delivered`, `message:read`, `message:status`; `POST /conversations/{id}/read` (`markConversationRead`) | `messageReceipts`, `conversationMembers` (cursor) | §3.3 MessageStatusIcon, ReadByIndicator | TC-AC-022, TC-AC-023, TC-AC-024, TC-AC-025, TC-AC-042, TC-AC-043, TC-MSG-008, TC-MSG-009, TC-MSG-014, TC-SEC-003, TC-DB-010, TC-DB-011, TC-DB-014 | M3 |
| FR-CHAT-005 | AC-026 | EC-NET-008, EC-INFRA-002 | `typing:start`, `typing:stop`, `typing:update` | `typing:{conversationId}:{userId}`, `rl:typing:*` | §3.3 TypingIndicator, §3.2 preview | TC-AC-026, TC-NET-008, TC-INFRA-002 | M4 |
| FR-CHAT-006 | AC-040, AC-041 | EC-MSG-007, EC-NET-001, EC-INFRA-001 | `message:send` (retry cùng `clientMessageId`) | IndexedDB `outbox` (client); `messages` | §3.3 bubble PENDING/FAILED | TC-AC-040, TC-AC-041, TC-MSG-007, TC-NET-001, TC-INFRA-001 | M3 |
| FR-CHAT-007 | AC-030, AC-031 | EC-MSG-015, EC-MSG-017 | `message:edit` | `messages` (`editedAt`, `contentEnc`) | §3.3 MessageActions, MessageMeta "Đã chỉnh sửa" | TC-AC-030, TC-AC-031, TC-MSG-015, TC-MSG-017 | M3, M7 (SECRET) |
| FR-CHAT-008 | AC-031, AC-032 | EC-MSG-015 | `message:delete` | `messages` (`deletedAt`, xóa `contentEnc`/`ciphertext`) | §3.3 bubble "Tin nhắn đã bị thu hồi", §3.2 preview | TC-AC-031, TC-AC-032, TC-MSG-015 | M3, M7 (SECRET) |
| FR-CHAT-009 | AC-039 | EC-MSG-014 | `GET /conversations` (`listConversations`); `message:new`, `conversation:updated` | `conversations`, `conversationMembers`, `messages`, `messageReceipts` | §3.2 ChatListPane, UnreadBadge | TC-AC-039, TC-MSG-014, TC-DB-013 | M2, M3 |
| FR-CHAT-010 | AC-028 | EC-NET-001, EC-NET-002, EC-NET-003, EC-NET-005, EC-NET-006, EC-NET-009, EC-NET-010 | Reconnect Socket.IO (`connectionStateRecovery`); `GET /conversations/{id}/messages?after=` | `messages` | §3.0 ConnectionBanner | TC-AC-028, TC-NET-001, TC-NET-002, TC-NET-003, TC-NET-005, TC-NET-006, TC-NET-009, TC-NET-010 | M3 |
| FR-CHAT-011 | AC-050, AC-054, AC-073, AC-091 | — | `message:new` (type SYSTEM) | `messages` (`system.kind`) | §3.3 SystemMessage | TC-AC-050, TC-AC-054, TC-AC-073, TC-AC-091 | M2, M3, M5 |
| FR-GROUP-001 | AC-050 | EC-GROUP-001, EC-GROUP-002, EC-GROUP-003 | `POST /conversations` type GROUP + `Idempotency-Key`; `conversation:updated` | `conversations`, `conversationMembers`, `messages`; `idem:conv:{userId}:{key}` | §3.4 CreateGroupDialog | TC-AC-050, TC-GROUP-001, TC-GROUP-002, TC-GROUP-003 | M2 |
| FR-GROUP-002 | AC-051, AC-052, AC-058 | EC-GROUP-001, EC-GROUP-002, EC-GROUP-003, EC-GROUP-006 | `POST /conversations/{id}/members` (`addConversationMembers`); `conversation:updated` | `conversations` (`memberCount`), `conversationMembers`, `userBlocks` | §3.4 MemberManagerDialog, UserPicker | TC-AC-051, TC-AC-052, TC-AC-058, TC-GROUP-001, TC-GROUP-002, TC-GROUP-003, TC-GROUP-006, TC-DB-012 | M2 |
| FR-GROUP-003 | AC-034, AC-055, AC-057 | EC-GROUP-005, EC-GROUP-007, EC-MSG-010 | `DELETE /conversations/{id}/members/{userId}` (`removeConversationMember`); `conversation:member-removed` | `conversationMembers` (`leftAt`), `conversations` | §3.4 MemberRow, §3.3 RoomNotFound | TC-AC-034, TC-AC-055, TC-AC-057, TC-GROUP-005, TC-GROUP-007, TC-MSG-010 | M2, M3 |
| FR-GROUP-004 | AC-053, AC-054 | EC-GROUP-004 | `PATCH /conversations/{id}/members/{userId}` (`updateConversationMemberRole`, chuyển OWNER), `DELETE …/members/{me}` | `conversationMembers`, `conversations` (`deletedAt`) | §3.4 TransferOwnerDialog | TC-AC-053, TC-AC-054, TC-GROUP-004, TC-DB-012 | M2 |
| FR-GROUP-005 | AC-056 | EC-GROUP-006 | `PATCH /conversations/{id}` (`updateConversation`); `conversation:updated` | `conversations` (`title`), `messages` | §3.4 MemberManagerDialog (đổi tên) | TC-AC-056, TC-GROUP-006 | M2 |
| FR-GROUP-006 | AC-055, AC-059 | EC-GROUP-005 | `PATCH /conversations/{id}/members/{userId}` (`updateConversationMemberRole`) | `conversationMembers` (`role`) | §3.4 MemberRow | TC-AC-055, TC-AC-059, TC-GROUP-005 | M2 |
| FR-PRES-001 | AC-027, AC-060, AC-061, AC-062 | EC-PRES-001, EC-PRES-002, EC-PRES-003, EC-PRES-005 | `presence:update`; handshake/disconnect | `presence:conns:{userId}`, `presence:users`, `presence:offline-pending` | §3.2 OnlineDot, §3.3 ChatHeader | TC-AC-027, TC-AC-060, TC-AC-061, TC-AC-062, TC-PRES-001, TC-PRES-002, TC-PRES-003, TC-PRES-005, TC-DB-024, TC-DB-025 | M4 |
| FR-PRES-002 | AC-061 | EC-PRES-004 | `presence:update` (`lastSeenAt`) | `users` (`lastSeenAt`) | §3.3 ChatHeader "Hoạt động … trước" | TC-AC-061, TC-PRES-004 | M4 |
| FR-PRES-003 | AC-063 | EC-SEC-002 | `presence:subscribe`, `presence:snapshot`; `rl:presenceSubscribe:*` | `conversationMembers`, `userBlocks` | §3.2 ChatListPane | TC-AC-063, TC-SEC-002 | M4 |
| FR-CALL-001 | AC-070 | EC-CALL-SIG-007, EC-CALL-SIG-008, EC-CALL-SIG-009, EC-CALL-SIG-010, EC-CALL-SIG-014 | `call:invite`, `call:incoming`, `call:ringing`, `call:accept`, `call:accepted`, `call:offer`, `call:answer`, `call:ice-candidate`, `call:state`, `call:end` | `callHistory`; `call:active:{callId}`, `user:incall:{userId}`, `call:deadlines`, `rl:callInvite:*` | §3.6 OutgoingCallScreen, §3.5 IncomingCallScreen, §3.7 InCallScreen | TC-AC-070, TC-CALL-SIG-007, TC-CALL-SIG-008, TC-CALL-SIG-009, TC-CALL-SIG-010, TC-CALL-SIG-014, TC-ARCH-008 | M5 |
| FR-CALL-002 | AC-071 | EC-CALL-MEDIA-002, EC-CALL-MEDIA-011 | Như FR-CALL-001 với `callType: VIDEO` | `callHistory`; `call:active:{callId}` | §3.7 InCallScreen (LocalVideo PiP, RemoteVideo) | TC-AC-071, TC-CALL-MEDIA-002, TC-CALL-MEDIA-011 | M5 |
| FR-CALL-003 | AC-076, AC-083, AC-088 | EC-CALL-SIG-001, EC-CALL-SIG-004, EC-CALL-SIG-011, EC-CALL-SIG-016 | `call:incoming` (mọi tab), `call:answered-elsewhere`, ACK `CALL_ALREADY_ANSWERED`, `CALL_NOT_FOUND`, `FORBIDDEN` | `call:active:{callId}` (`acceptedTabId`), `call:pending:{calleeId}` | §3.5 IncomingCallScreen, toast "Đã trả lời trên thiết bị khác" | TC-AC-076, TC-AC-083, TC-AC-088, TC-CALL-SIG-001, TC-CALL-SIG-004, TC-CALL-SIG-011, TC-CALL-SIG-016 | M5 |
| FR-CALL-004 | AC-072, AC-073, AC-074, AC-075, AC-084, AC-089 | EC-CALL-SIG-002, EC-CALL-SIG-005, EC-CALL-SIG-006, EC-CALL-SIG-015 | `call:reject`, `call:cancel`, `call:busy`, `call:end`, `call:state`; ACK `CALL_BUSY`, `CALL_TIMEOUT` | `callHistory`; `call:active:{callId}`, `call:deadlines`, `user:incall:{userId}` | §3.6, §3.5, CallEndedNotice | TC-AC-072, TC-AC-073, TC-AC-074, TC-AC-075, TC-AC-084, TC-AC-089, TC-CALL-SIG-002, TC-CALL-SIG-005, TC-CALL-SIG-006, TC-CALL-SIG-015, TC-ARCH-007, TC-DB-015, TC-DB-022, TC-DB-023 | M5 |
| FR-CALL-005 | AC-077, AC-ARCH-015 | EC-CALL-SIG-003 | `call:invite` (ACK `merged: true`), `call:accepted` | `callHistory`; `call:active:{callId}`, `user:incall:{userId}` (`call-invite.lua`) | §3.6 → §3.7 tự chuyển | TC-AC-077, TC-ARCH-015, TC-CALL-SIG-003, TC-DB-021 | M5 |
| FR-CALL-006 | AC-081, AC-082, AC-092 | EC-CALL-NET-001, EC-CALL-NET-002, EC-CALL-NET-007, EC-CALL-NET-008, EC-CALL-NET-009, EC-CALL-NET-010 | `call:ice-restart`, `call:offer` (revision), `call:state` (RECONNECTING), `call:end` (`NETWORK_FAILURE`) | `call:active:{callId}`, `call:deadlines` (RECONNECT); `callHistory` | §3.7 InCallScreen "Đang kết nối lại…" | TC-AC-081, TC-AC-082, TC-AC-092, TC-CALL-NET-001, TC-CALL-NET-002, TC-CALL-NET-007, TC-CALL-NET-008, TC-CALL-NET-009, TC-CALL-NET-010 | M5 |
| FR-CALL-007 | AC-085, AC-090 | EC-CALL-NET-003, EC-CALL-NET-004, EC-CALL-NET-005, EC-CALL-NET-006, EC-SEC-006 | `GET /calls/ice-servers` (`getIceServers`) | `ice:servers:xirsys` | — (lib/webrtc/ice-servers.ts) | TC-AC-085, TC-AC-090, TC-CALL-NET-003, TC-CALL-NET-004, TC-CALL-NET-005, TC-CALL-NET-006, TC-SEC-006 | M5 |
| FR-CALL-008 | AC-091 | EC-CALL-SIG-015 | `GET /calls` (`listCalls`); `message:new` SYSTEM `CALL_ENDED`/`CALL_MISSED` | `callHistory`, `messages` | §3.3 SystemMessage, CallHistoryList | TC-AC-091, TC-CALL-SIG-015, TC-DB-015 | M5 |
| FR-CALL-009 | AC-078, AC-079, AC-080 | EC-CALL-MEDIA-001, EC-CALL-MEDIA-002, EC-CALL-MEDIA-003, EC-CALL-MEDIA-004, EC-CALL-MEDIA-005, EC-CALL-MEDIA-006, EC-CALL-MEDIA-007, EC-CALL-MEDIA-008, EC-CALL-MEDIA-009, EC-CALL-MEDIA-012, EC-CALL-MEDIA-013 | `call:end` (`MEDIA_FAILURE`); không gửi `call:invite` khi lỗi trước khi gọi | `callHistory` | §3.7 MediaErrorPanel, ma trận UI §4.4 | TC-AC-078, TC-AC-079, TC-AC-080, TC-CALL-MEDIA-001, TC-CALL-MEDIA-003, TC-CALL-MEDIA-004, TC-CALL-MEDIA-005, TC-CALL-MEDIA-006, TC-CALL-MEDIA-007, TC-CALL-MEDIA-008, TC-CALL-MEDIA-009, TC-CALL-MEDIA-012, TC-CALL-MEDIA-013 | M5 |
| FR-CALL-010 | AC-086 | EC-CALL-SIG-012 | `call:invite` → ACK `VALIDATION_ERROR` "Cuộc gọi nhóm chưa được hỗ trợ" | `conversations` (`type`) | §3.3 ChatHeader (ẩn nút gọi trong nhóm) | TC-AC-086, TC-CALL-SIG-012 | M5 |
| FR-CALL-011 | AC-093 | EC-CALL-MEDIA-010 | `call:incoming` | — | §3.5 IncomingCallScreen, AutoplayUnlockButton | TC-AC-093, TC-CALL-MEDIA-010 | M5 |
| FR-SEC-001 | AC-107 | EC-CALL-MEDIA-009 | Toàn bộ REST/WSS qua HTTPS; DTLS-SRTP | — | §4.4 "không gian không an toàn" | TC-AC-107, TC-CALL-MEDIA-009 | M0, M6 |
| FR-SEC-002 | AC-100, AC-ARCH-005 | — | `message:send`, `message:edit`, `GET …/messages` (giải mã khi trả DTO) | `messages` (`contentEnc`) | — | TC-AC-100, TC-ARCH-005, TC-ARCH-004, TC-DB-005 | M0 (crypto), M3 |
| FR-SEC-003 | AC-101 | — | `npm run job:reencrypt -w server` | `messages` (index `reencrypt_keyId`) | — | TC-AC-101, TC-DB-020 | M3 |
| FR-SEC-004 | AC-108 | EC-SEC-005 | `POST /auth/register`, `/auth/login`, `/auth/change-password` | `users` (`passwordHash`, `select: false`) | — | TC-AC-108, TC-SEC-005, TC-DB-003 | M1 |
| FR-SEC-005 | AC-004, AC-109, AC-ARCH-009 | EC-SEC-005, EC-SEC-008, EC-CALL-SIG-014, EC-INFRA-002 | Mọi REST/event có rule `RATE_LIMITS`; 429 `RATE_LIMITED`, 503 `SERVICE_UNAVAILABLE` | `rl:{rule}:{subject}` | Toast lỗi `RATE_LIMITED` (`i18n/errors.ts`) | TC-AC-004, TC-AC-109, TC-ARCH-009, TC-SEC-005, TC-SEC-008, TC-CALL-SIG-014, TC-INFRA-002 | M1, M6 |
| FR-SEC-006 | AC-102, AC-106, AC-107 | EC-SEC-004, EC-MSG-003, EC-MSG-004 | `POST /auth/refresh`, `/auth/logout` (CSRF); header helmet/CSP/CORS | — | §3.3 MessageBubble (`dir="auto"`, escape) | TC-AC-102, TC-AC-106, TC-AC-107, TC-SEC-004, TC-MSG-003, TC-MSG-004 | M1, M3, M6 |
| FR-SEC-007 | AC-104, AC-ARCH-010 | EC-SEC-007 | Toàn bộ (logger redact) | — | — | TC-AC-104, TC-ARCH-010, TC-SEC-007 | M6 |
| FR-SEC-008 | AC-029, AC-083, AC-103, AC-105 | EC-SEC-001, EC-SEC-002, EC-SEC-003, EC-SEC-006, EC-MSG-005, EC-GROUP-007 | Mọi endpoint/event (bảng AUTHZ kiến trúc §6.2); `conversation:join` | `conversationMembers` | §3.3 RoomNotFound | TC-AC-029, TC-AC-083, TC-AC-103, TC-AC-105, TC-SEC-001, TC-SEC-002, TC-SEC-003, TC-SEC-006, TC-MSG-005, TC-GROUP-007, TC-ARCH-001, TC-ARCH-002, TC-ARCH-011 | M0–M6 |
| FR-E2EE-001 | AC-110 | EC-E2EE-006 | `PUT /e2ee/devices/{deviceId}/keys` (`registerDeviceKeys`), `GET /e2ee/devices` (`listMyDevices`) | `userDevices`, `oneTimePreKeys` | §3.8 DevicesSection | TC-AC-110, TC-E2EE-006, TC-DB-017 | M7 |
| FR-E2EE-002 | AC-111, AC-116 | EC-E2EE-002 | `GET /e2ee/users/{userId}/bundles` (`getPreKeyBundles`); `rl:e2eeBundle:*` | `oneTimePreKeys` (`consumedAt`), `userDevices` | — | TC-AC-111, TC-AC-116, TC-E2EE-002, TC-DB-016 | M7 |
| FR-E2EE-003 | AC-115 | EC-E2EE-002 | `e2ee:prekeys-low`, `POST /e2ee/devices/{deviceId}/prekeys` (`uploadOneTimePreKeys`) | `oneTimePreKeys`; `e2ee:lowsent:{deviceId}` | — | TC-AC-115, TC-E2EE-002 | M7 |
| FR-E2EE-004 | AC-111, AC-112, AC-119, AC-121, AC-122 | EC-E2EE-001, EC-E2EE-008, EC-MSG-016 | `POST /conversations` type SECRET; `message:send` kind `E2EE` (envelope), `message:new` tới `device:{deviceId}`; ACK `E2EE_KEYS_UNAVAILABLE`, `CONFLICT`, `VALIDATION_ERROR` | `conversations`, `messages` (`ciphertext`), `userDevices` | §3.3 E2eeBadge "Đang thiết lập mã hóa…" / "Mã hóa đầu-cuối" | TC-AC-111, TC-AC-112, TC-AC-119, TC-AC-121, TC-AC-122, TC-E2EE-001, TC-E2EE-008, TC-MSG-016 | M7 |
| FR-E2EE-005 | AC-120 | EC-E2EE-003 | — (tính phía client từ identity key trong bundle) | `userDevices` (`identityKey`) | §3.8 SafetyNumberDialog | TC-AC-120, TC-E2EE-003 | M7 |
| FR-E2EE-006 | AC-113 | EC-E2EE-003, EC-E2EE-006 | `GET /e2ee/users/{userId}/bundles` (identity mới) | `userDevices` | §3.3 IdentityChangedBanner | TC-AC-113, TC-E2EE-003, TC-E2EE-006 | M7 |
| FR-E2EE-007 | AC-117 | EC-E2EE-005 | `DELETE /e2ee/devices/{deviceId}` (`revokeDevice`); `session:revoked { DEVICE_REVOKED }` | `userDevices` (`status: REVOKED`), `oneTimePreKeys`, `refreshSessions` | §3.8 DevicesSection | TC-AC-117, TC-E2EE-005 | M7 |
| FR-E2EE-008 | AC-114, AC-118 | EC-E2EE-004, EC-E2EE-007 | `GET /conversations/{id}/messages` (envelope không có recipient cho device mới) | `messages` (`ciphertext`) | §3.3 bubble "Không thể giải mã tin nhắn này" / "Tin nhắn được gửi trước khi thiết bị này tham gia" | TC-AC-114, TC-AC-118, TC-E2EE-004, TC-E2EE-007 | M7 |

Bảng phủ AC kiến trúc và test database không gắn FR trực tiếp:

| Test ID | Liên kết | Milestone |
|---|---|---|
| TC-ARCH-003 | AC-ARCH-003 (từ chối khởi động khi không có replica set) | M0 |
| TC-ARCH-012 | AC-ARCH-012, NFR-01 (p95 ACK ≤ 300 ms) | M6 |
| TC-DB-001 | `ensureIndexes()` idempotent | M0 |
| TC-DB-004 | `strict: 'throw'` | M0 |
| TC-DB-026 | TTL index | M6 |
