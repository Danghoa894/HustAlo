// client/e2e/fixtures.ts — helper E2E (development_guide.md §6.6)
// - newUser(): tài khoản mới duy nhất cho mỗi test (không phụ thuộc seed, không đụng mật khẩu của alice/bob/carol).
// - registerViaApi / loginAs: tạo và đăng nhập qua REST rồi nạp token bằng /auth/refresh như reload thật.
//   deviceId của REST login được ghi vào localStorage trước khi trang chạy, để claim `did` khớp handshake socket.
// - clearRateLimits(): xóa khóa {prefix}rl:* trong Redis dev trước mỗi test (register chỉ 3/phút/IP). Chỉ chạy local;
//   với E2E_BASE_URL (môi trường đã deploy) thì bỏ qua.
// - M5: twoUsers(), mockGetUserMediaError(), recordCallStates(), recordSent(), callStats() (window.__hustaloCallStats),
//   dockerCompose(), setIcePolicyRelay() (server :4100 + Vite :5174 riêng cho call-network.spec.ts).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type WebSocket,
} from '@playwright/test';
import { Redis } from 'ioredis';
import { vi as t } from '../src/i18n/vi';

export interface E2eUser {
  email: string;
  username: string;
  displayName: string;
  password: string;
}

let seq = 0;
export function newUser(): E2eUser {
  seq += 1;
  const tag = `${Date.now().toString(36)}${seq}${Math.floor(Math.random() * 1e4).toString(36)}`;
  return {
    email: `e2e.${tag}@hustalo.test`,
    username: `e2e_${tag}`,
    displayName: `E2E ${tag}`,
    password: `Secret${tag}9`,
  };
}

function redisUrl(): string | undefined {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const envFile = fileURLToPath(new URL('../../server/.env', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return process.env.REDIS_URL;
}

export async function clearRateLimits(): Promise<void> {
  if (process.env.E2E_BASE_URL) return;
  const url = redisUrl();
  if (!url) throw new Error('E2E cần REDIS_URL (server/.env) để xóa khóa rate limit rl:*');
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', '*rl:*', 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}

export async function registerViaApi(request: APIRequestContext, user: E2eUser): Promise<void> {
  const res = await request.post('/api/v1/auth/register', {
    data: {
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      password: user.password,
      deviceId: randomUUID(),
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** Đăng nhập REST bằng cookie của context `page`, rồi mở `path` — RequireAuth tự refresh như khi reload. */
export async function loginAs(page: Page, user: E2eUser, path = '/chats'): Promise<void> {
  const deviceId = randomUUID();
  await page.addInitScript((id) => {
    localStorage.setItem('hustalo.deviceId', id);
  }, deviceId);
  const res = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password, deviceId },
  });
  expect(res.status(), await res.text()).toBe(200);
  await page.goto(path);
}

/** Chờ handshake Socket.IO thành công (gói CONNECT "40{…}" từ server) trên WebSocket mở sau lời gọi này. */
export async function waitForSocketConnected(page: Page): Promise<void> {
  const ws: WebSocket = await page.waitForEvent('websocket', (w) => w.url().includes('/socket.io/'));
  await ws.waitForEvent('framereceived', (f) => typeof f.payload === 'string' && f.payload.startsWith('40'));
}

/** Chờ socket nối lại thành công sau khi server khởi động lại: bỏ qua các lần thử WebSocket lỗi trong lúc server tắt. */
export async function waitForSocketReconnected(page: Page, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const left = until - Date.now();
    if (left <= 0) throw new Error('socket không nối lại được');
    const ws = await page.waitForEvent('websocket', {
      predicate: (w) => w.url().includes('/socket.io/'),
      timeout: left,
    });
    try {
      await ws.waitForEvent('framereceived', {
        predicate: (f) => typeof f.payload === 'string' && f.payload.startsWith('40'),
        timeout: left,
      });
      return;
    } catch {
      // lần thử này lỗi (server chưa lên) — chờ WebSocket kế tiếp
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// M5 — cuộc gọi (development_guide.md §6.6)
// ---------------------------------------------------------------------------------------------------------------------

export interface CallFrame {
  /** `call:state` từ server, hoặc ACK có `data.callId` + `data.status` (ví dụ ACK `call:invite` → INITIATED). */
  source: 'state' | 'ack';
  status: string;
  /** Date.now() phía test khi frame tới. */
  at: number;
  body: Record<string, unknown>;
}

export interface CallParty {
  user: E2eUser;
  ctx: BrowserContext;
  page: Page;
  /** Mọi trạng thái cuộc gọi trang nhận được, theo thứ tự — kể cả trạng thái UI lướt qua rất nhanh. */
  frames: CallFrame[];
  /** Event `call:*` trang gửi lên (payload trong envelope), theo thứ tự. */
  sent: SentFrame[];
}

export interface SentFrame {
  event: string;
  payload: Record<string, unknown>;
}

export const statuses = (p: CallParty): string[] => p.frames.map((f) => f.status);

/** Ghi lại `call:state` (gói "42[…]") và ACK cuộc gọi (gói "43<id>[…]") server gửi xuống trang. */
export function recordCallStates(page: Page): CallFrame[] {
  const frames: CallFrame[] = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/socket.io/')) return;
    ws.on('framereceived', (f) => {
      if (typeof f.payload !== 'string') return;
      const at = Date.now();
      try {
        if (f.payload.startsWith('42')) {
          const [name, body] = JSON.parse(f.payload.slice(2)) as [string, Record<string, unknown>];
          if (name === 'call:state' && typeof body.status === 'string')
            frames.push({ source: 'state', status: body.status, at, body });
        } else if (f.payload.startsWith('43')) {
          const json = f.payload.slice(2).replace(/^\d+/, '');
          const [res] = JSON.parse(json) as [{ ok?: boolean; data?: Record<string, unknown> }];
          const data = res.data;
          if (res.ok && data && typeof data.callId === 'string' && typeof data.status === 'string')
            frames.push({ source: 'ack', status: data.status, at, body: data });
        }
      } catch {
        // không phải event JSON — bỏ qua
      }
    });
  });
  return frames;
}

/** Mở trang cho `user` trong context mới, chờ socket kết nối. `before` chạy trước khi tải trang (addInitScript). */
export async function openParty(
  browser: Browser,
  user: E2eUser,
  path: string,
  opts: { contextOptions?: BrowserContextOptions; before?: (page: Page) => Promise<void> } = {},
): Promise<CallParty> {
  const ctx = await browser.newContext(opts.contextOptions);
  const page = await ctx.newPage();
  if (opts.before) await opts.before(page);
  const frames = recordCallStates(page);
  const sent = recordSent(page, (name) => name.startsWith('call:'));
  const connected = waitForSocketConnected(page);
  await loginAs(page, user, path);
  await connected;
  return { user, ctx, page, frames, sent };
}

/**
 * Hai người dùng mới ở hai browser context độc lập, đã đăng nhập; alice mở phòng 1-1 với bob, bob mở cùng phòng.
 * `request` phải trỏ tới cùng baseURL với `contextOptions.baseURL` (nếu có).
 */
export async function twoUsers(
  browser: Browser,
  request: APIRequestContext,
  opts: {
    contextOptions?: BrowserContextOptions;
    before?: (page: Page, who: 'alice' | 'bob') => Promise<void>;
  } = {},
): Promise<{ alice: CallParty; bob: CallParty; conversationId: string }> {
  const [aliceUser, bobUser] = [newUser(), newUser()];
  for (const u of [aliceUser, bobUser]) await registerViaApi(request, u);
  const partyOpts = (who: 'alice' | 'bob') => ({
    ...(opts.contextOptions ? { contextOptions: opts.contextOptions } : {}),
    ...(opts.before ? { before: (p: Page) => opts.before?.(p, who) ?? Promise.resolve() } : {}),
  });
  const alice = await openParty(browser, aliceUser, '/chats', partyOpts('alice'));
  await alice.page.getByLabel(t.conversations.search).fill(bobUser.username);
  await alice.page
    .getByRole('region', { name: t.conversations.sectionUsers })
    .getByRole('button', { name: new RegExp(bobUser.displayName) })
    .click();
  await expect(alice.page).toHaveURL(/\/chats\/[a-f0-9]{24}$/);
  const conversationId = alice.page.url().split('/').at(-1) ?? '';
  const bob = await openParty(browser, bobUser, `/chats/${conversationId}`, partyOpts('bob'));
  return { alice, bob, conversationId };
}

/**
 * getUserMedia ném `DOMException(name)` khi constraints xin một trong `kinds`. Thiết bị giả của trình duyệt luôn tồn tại,
 * nên đây là cách mô phỏng thiếu camera/micro hoặc bị từ chối quyền (AC-078, AC-079, AC-080).
 */
export async function mockGetUserMediaError(page: Page, name: string, kinds: ('audio' | 'video')[]): Promise<void> {
  await page.addInitScript(
    ({ errName, errKinds }) => {
      const md = navigator.mediaDevices as MediaDevices | undefined;
      if (!md) return;
      const original = md.getUserMedia.bind(md);
      md.getUserMedia = (c?: MediaStreamConstraints) => {
        const wants = (k: 'audio' | 'video') => !!c && c[k] !== undefined && c[k] !== false;
        if (errKinds.some(wants)) return Promise.reject(new DOMException('e2e mock', errName));
        return original(c);
      };
    },
    { errName: name, errKinds: kinds },
  );
}

type Stat = Record<string, unknown>;

/** `pc.getStats()` của cuộc gọi hiện tại qua hook dev `window.__hustaloCallStats` (DG §6.6); [] khi chưa có cuộc gọi. */
export async function callStats(page: Page): Promise<Stat[]> {
  return page.evaluate(async () => {
    const w = window as unknown as { __hustaloCallStats?: () => Promise<unknown[]> };
    return ((await w.__hustaloCallStats?.()) ?? []) as Record<string, unknown>[];
  });
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const inbound = (stats: Stat[], kind: 'audio' | 'video') =>
  stats.filter((s) => s.type === 'inbound-rtp' && s.kind === kind);

/** Tổng `bytesReceived` của inbound-rtp theo kind. */
export async function inboundBytes(page: Page, kind: 'audio' | 'video'): Promise<number> {
  return inbound(await callStats(page), kind).reduce((n, s) => n + num(s.bytesReceived), 0);
}

/** Tổng `framesDecoded` của inbound-rtp video. */
export async function framesDecoded(page: Page): Promise<number> {
  return inbound(await callStats(page), 'video').reduce((n, s) => n + num(s.framesDecoded), 0);
}

/** Chờ `bytesReceived` của `kind` tăng so với lúc gọi hàm (media đang chảy về `page`). */
export async function expectMediaFlowing(page: Page, kind: 'audio' | 'video', timeout = 15_000): Promise<void> {
  const start = await inboundBytes(page, kind);
  await expect.poll(() => inboundBytes(page, kind), { timeout }).toBeGreaterThan(start);
}

/** Candidate cục bộ của cặp đang dùng (transport.selectedCandidatePairId, hoặc candidate-pair nominated + succeeded). */
export async function selectedLocalCandidate(page: Page): Promise<Stat | null> {
  const stats = await callStats(page);
  const byId = new Map(stats.map((s) => [String(s.id), s]));
  const transport = stats.find((s) => s.type === 'transport' && typeof s.selectedCandidatePairId === 'string');
  const pair =
    (transport ? byId.get(String(transport.selectedCandidatePairId)) : undefined) ??
    stats.find((s) => s.type === 'candidate-pair' && s.selected === true) ?? // Firefox
    stats.find((s) => s.type === 'candidate-pair' && s.nominated === true && s.state === 'succeeded');
  if (!pair) return null;
  return byId.get(String(pair.localCandidateId)) ?? null;
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** `docker compose <cmd> <service>` trên stack dev (`infra/docker-compose.yml`). */
export function dockerCompose(cmd: 'pause' | 'unpause' | 'stop' | 'start', service: string): void {
  execFileSync('docker', ['compose', '--env-file', 'infra/.env', '-f', 'infra/docker-compose.yml', cmd, service], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
}

/** Gói Socket.IO client gửi lên (`42<ackId>["event",{requestId,payload}]`) — phải gắn trước khi trang mở socket. */
export function recordSent(page: Page, match: (event: string) => boolean): SentFrame[] {
  const out: SentFrame[] = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/socket.io/')) return;
    ws.on('framesent', (f) => {
      if (typeof f.payload !== 'string' || !f.payload.startsWith('42')) return;
      try {
        const [name, env] = JSON.parse(f.payload.slice(2).replace(/^\d+/, '')) as [string, { payload?: unknown }];
        if (match(name) && env.payload && typeof env.payload === 'object')
          out.push({ event: name, payload: env.payload as Record<string, unknown> });
      } catch {
        // bỏ qua
      }
    });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stack mạng riêng cho call-network.spec.ts: server :4100 (ICE_TRANSPORT_POLICY=relay) + Vite :5174 proxy tới nó.
// Server chạy trực tiếp `node --import tsx` (một process) để restart được giữa cuộc gọi (AC-092).
// ---------------------------------------------------------------------------------------------------------------------

export interface RelayStack {
  baseURL: string;
  /** Dừng đột ngột process server (như sự cố) rồi chạy lại với cùng env (Redis/Mongo giữ nguyên). */
  restartServer(env?: Record<string, string>): Promise<void>;
  stop(): Promise<void>;
}

async function waitHealthy(url: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // chưa lên
    }
    if (Date.now() > until) throw new Error(`hết giờ chờ ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function killTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.pid === undefined) {
      resolve();
      return;
    }
    child.once('exit', () => {
      resolve();
    });
    if (process.platform === 'win32')
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  });
}

/**
 * Khởi động server riêng với `ICE_TRANSPORT_POLICY=relay` (+ `env` ghi đè, ví dụ TURN_FALLBACK_URLS chỉ TCP) và Vite
 * :5174 (DG §6.6 `setIcePolicyRelay`). Gọi `stop()` trong afterAll.
 */
export async function setIcePolicyRelay(env: Record<string, string> = {}): Promise<RelayStack> {
  const serverPort = 4100;
  const clientPort = 5174;
  const baseURL = `http://localhost:${clientPort}`;
  let serverEnv = env;
  const startServer = (): ChildProcess => {
    const child = spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', 'src/main.ts'], {
      cwd: `${repoRoot}server`,
      env: {
        ...process.env,
        PORT: String(serverPort),
        METRICS_PORT: '9465',
        ICE_TRANSPORT_POLICY: 'relay',
        CORS_ORIGINS: baseURL,
        LOG_LEVEL: 'warn',
        ...serverEnv,
      },
      stdio: 'ignore',
    });
    return child;
  };
  let server = startServer();
  const vite = spawn(
    process.execPath,
    [`${repoRoot}node_modules/vite/bin/vite.js`, '--config', 'e2e/vite.network.config.ts', '--strictPort'],
    { cwd: `${repoRoot}client`, env: process.env, stdio: 'ignore' },
  );
  await waitHealthy(`http://localhost:${serverPort}/api/v1/health`, 60_000);
  await waitHealthy(`${baseURL}/api/v1/health`, 60_000);
  return {
    baseURL,
    async restartServer(next) {
      if (next) serverEnv = next;
      await killTree(server);
      server = startServer();
      await waitHealthy(`http://localhost:${serverPort}/api/v1/health`, 60_000);
    },
    async stop() {
      await Promise.all([killTree(server), killTree(vite)]);
    },
  };
}
