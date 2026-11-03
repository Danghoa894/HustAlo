// load/message-send.js — NFR-01 / AC-ARCH-012 (TC-ARCH-012): 50 user đồng thời, tổng 5 msg/s trong 5 phút;
// p95 ACK `message:send` ≤ 300 ms. Mỗi VU = một user giữ một socket, gửi 1 tin / 10 s cho bạn cặp đôi.
// Đo hai phía: Trend `message_send_ack_ms` (client k6) + đối chiếu histogram server `hustalo_message_send_ack_seconds`
// trên /metrics (METRICS_PORT) sau khi chạy.
//
// Chạy (server dev đang chạy ở :4000, TRUST_PROXY=1; k6 chạy bằng Docker — không cần cài k6):
//   docker run --rm -i -v "$PWD/load:/load" -e BASE_URL=http://host.docker.internal:4000 grafana/k6 run /load/message-send.js
// Tham số: USERS (mặc định 50), DURATION (mặc định 5m), INTERVAL_S (mặc định 10 → 50/10 = 5 msg/s).
import ws from 'k6/ws';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import { SocketIo, directConversation, registerUser, socketUrl, uuidV4 } from './lib.js';

const USERS = Number(__ENV.USERS || 50);
const DURATION = __ENV.DURATION || '5m';
const INTERVAL_S = Number(__ENV.INTERVAL_S || 10);
const durationS = (() => {
  const m = /^(\d+)(s|m)$/.exec(DURATION);
  return m ? Number(m[1]) * (m[2] === 'm' ? 60 : 1) : 300;
})();

const ackMs = new Trend('message_send_ack_ms', true);
const ackFailed = new Counter('message_send_ack_failed');

export const options = {
  setupTimeout: '300s',
  scenarios: {
    chat: { executor: 'per-vu-iterations', vus: USERS, iterations: 1, maxDuration: `${durationS + 60}s` },
  },
  thresholds: {
    message_send_ack_ms: ['p(95)<=300'], // NFR-01
    message_send_ack_failed: ['count==0'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const users = [];
  for (let i = 0; i < USERS; i += 1) users.push(registerUser(i));
  const convs = [];
  for (let i = 0; i + 1 < USERS; i += 2) {
    const id = directConversation(users[i], users[i + 1]);
    convs[i] = id;
    convs[i + 1] = id;
  }
  return { users, convs };
}

export default function (data) {
  const me = exec.vu.idInTest - 1;
  const user = data.users[me];
  const conversationId = data.convs[me];
  if (!conversationId) return; // USERS lẻ: user cuối không có cặp
  const res = ws.connect(socketUrl(), {}, (socket) => {
    const io = new SocketIo(
      socket,
      { token: user.token, deviceId: user.deviceId, tabId: uuidV4() },
      {
        connected: () => {
          // Rải đều thời điểm gửi giữa các VU để tổng tải ~USERS/INTERVAL_S msg/s.
          socket.setTimeout(
            () => {
              socket.setInterval(() => {
                const t0 = Date.now();
                io.emit(
                  'message:send',
                  { kind: 'PLAINTEXT', conversationId, clientMessageId: uuidV4(), content: `load ${Date.now()}` },
                  (ack) => {
                    ackMs.add(Date.now() - t0);
                    if (!check(ack, { 'ACK ok': (a) => a && a.ok === true })) ackFailed.add(1);
                  },
                );
              }, INTERVAL_S * 1000);
            },
            (me % INTERVAL_S) * 1000 + Math.random() * 1000,
          );
          socket.setTimeout(() => socket.close(), durationS * 1000);
        },
        connectError: (e) => {
          check(null, { 'socket connect ok': () => false });
          console.error(`connect_error VU ${me}: ${e}`);
          socket.close();
        },
      },
    );
  });
  check(res, { 'ws 101': (r) => r && r.status === 101 });
}
