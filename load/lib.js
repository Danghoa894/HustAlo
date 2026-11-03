// load/lib.js — helper dùng chung cho load test k6 (development_guide.md §7 M6; NFR-01, NFR-09).
// - registerUser(): POST /auth/register với X-Forwarded-For riêng mỗi user (server dev bật TRUST_PROXY=1) để không
//   chạm rate limit register 3/phút/IP. CHỈ dùng trên môi trường test, không bao giờ trỏ vào production.
// - SocketIo: client Socket.IO v4 tối giản trên k6/ws (engine.io v4: "0" open, "2"/"3" ping/pong, "40" connect,
//   "42" event, "43" ack). Đủ cho handshake auth {token, deviceId, tabId}, emit kèm ACK và nhận event.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

export const BASE = __ENV.BASE_URL || 'http://localhost:4000';
export const WS_BASE = BASE.replace(/^http/, 'ws');
const RUN = __ENV.RUN_ID || String(Date.now());

function uuidV4() {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i += 1) {
    let r = Math.floor(Math.random() * 16);
    if (i === 12) r = 4;
    if (i === 16) r = (r & 0x3) | 0x8;
    s += h[r];
  }
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export { uuidV4 };

// Lệch dải IP theo lượt chạy để hai lượt liên tiếp không chung bucket register (3/phút/IP).
const IP_OFFSET = Number(RUN) % 4_000_000;
const fakeIp = (n) => {
  const v = n + IP_OFFSET + 1;
  return `10.${(v >> 16) & 255}.${(v >> 8) & 255}.${v & 255}`;
};

function registerRequest(n) {
  const deviceId = uuidV4();
  const username = `load_${RUN.slice(-6)}_${n}`;
  return {
    deviceId,
    req: {
      method: 'POST',
      url: `${BASE}/api/v1/auth/register`,
      body: JSON.stringify({
        email: `${username}@load.hustalo.test`,
        username,
        displayName: `Load ${n}`,
        password: `LoadTest-${RUN}-pw`,
        deviceId,
      }),
      params: {
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fakeIp(n) },
        tags: { name: 'register' },
        timeout: '60s',
      },
    },
  };
}

function toUser(n, res, deviceId) {
  check(res, { 'register 201': (r) => r.status === 201 });
  if (res.status !== 201) exec.test.abort(`register ${n} thất bại: ${res.status} ${res.body}`);
  const body = res.json();
  return { id: body.user.id, token: body.accessToken, deviceId };
}

/** Đăng ký user thứ `n` của lượt chạy; trả { id, token, deviceId }. */
export function registerUser(n) {
  const { deviceId, req } = registerRequest(n);
  return toUser(n, http.request(req.method, req.url, req.body, req.params), deviceId);
}

/** Đăng ký `count` user, song song theo lô `batch` request (argon2 ở server là phần chậm). */
export function registerUsers(count, batch = 20) {
  const users = [];
  for (let start = 0; start < count; start += batch) {
    const items = [];
    for (let n = start; n < Math.min(count, start + batch); n += 1) items.push({ n, ...registerRequest(n) });
    const responses = http.batch(items.map((i) => i.req));
    items.forEach((i, k) => users.push(toUser(i.n, responses[k], i.deviceId)));
  }
  return users;
}

/** Tạo/lấy conversation DIRECT giữa `a` và `b` (REST, bearer của a). */
export function directConversation(a, b) {
  const res = http.post(`${BASE}/api/v1/conversations`, JSON.stringify({ type: 'DIRECT', memberIds: [b.id] }), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}`, 'Idempotency-Key': uuidV4() },
    tags: { name: 'createConversation' },
  });
  check(res, { 'conversation 200/201': (r) => r.status === 200 || r.status === 201 });
  if (res.status !== 200 && res.status !== 201) exec.test.abort(`tạo conversation thất bại: ${res.status} ${res.body}`);
  return res.json().conversation.id;
}

/**
 * Bọc socket k6/ws: gọi trong callback của ws.connect. `onConnected` chạy khi nhận "40" (handshake auth thành công).
 */
export class SocketIo {
  constructor(socket, auth, handlers = {}) {
    this.socket = socket;
    this.nextAck = 1;
    this.acks = {};
    this.handlers = handlers;
    socket.on('message', (data) => this.onFrame(String(data)));
    socket.on('open', () => undefined);
    this.auth = auth;
  }

  onFrame(f) {
    if (f[0] === '0') {
      this.socket.send(`40${JSON.stringify(this.auth)}`);
    } else if (f === '2') {
      this.socket.send('3');
    } else if (f.startsWith('40')) {
      if (this.handlers.connected) this.handlers.connected();
    } else if (f.startsWith('44')) {
      if (this.handlers.connectError) this.handlers.connectError(f.slice(2));
    } else if (f.startsWith('43')) {
      const m = /^43(\d+)(.*)$/.exec(f);
      if (!m) return;
      const cb = this.acks[m[1]];
      delete this.acks[m[1]];
      if (cb) cb(JSON.parse(m[2])[0]);
    } else if (f.startsWith('42')) {
      const m = /^42(\d*)(.*)$/.exec(f);
      if (!m) return;
      const [event, payload] = JSON.parse(m[2]);
      // Server emit kèm ack (ví dụ call:incoming) → trả lời "43<id>[res]".
      const ack = m[1] ? (res) => this.socket.send(`43${m[1]}${JSON.stringify([res])}`) : () => undefined;
      const h = this.handlers[event];
      if (h) h(payload, ack);
    }
  }

  /** emit event kèm envelope {requestId, payload}; `cb(res)` khi có ACK. */
  emit(event, payload, cb) {
    const id = this.nextAck;
    this.nextAck += 1;
    this.acks[String(id)] = cb;
    this.socket.send(`42${id}${JSON.stringify([event, { requestId: uuidV4(), payload }])}`);
  }
}

export const socketUrl = () => `${WS_BASE}/socket.io/?EIO=4&transport=websocket`;
