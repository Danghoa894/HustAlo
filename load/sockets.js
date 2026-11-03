// load/sockets.js — NFR-09 / NFR-ARCH-06: 1.000 socket đồng thời trên một instance, trong đó 200 cuộc gọi signaling
// đồng thời (400 user: invite → incoming ACK → accept → offer → answer → call:state connected → CONNECTED), giữ
// HOLD rồi kết thúc; RAM server ≤ 1 GB (đọc process_resident_memory_bytes trên /metrics ở cuối).
//
// Chạy (server dev :4000 + metrics :9464; k6 bằng Docker):
//   docker run --rm -i -v "$PWD/load:/load" -e BASE_URL=http://host.docker.internal:4000 \
//     -e METRICS_URL=http://host.docker.internal:9464/metrics grafana/k6 run /load/sockets.js
// Tham số: SOCKETS (1000), CALLS (200), HOLD_S (120), RAMP_S (60 — thời gian mở dần các socket).
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import { SocketIo, directConversation, registerUsers, socketUrl, uuidV4 } from './lib.js';

const SOCKETS = Number(__ENV.SOCKETS || 1000);
const CALLS = Math.min(Number(__ENV.CALLS || 200), Math.floor(SOCKETS / 2));
const HOLD_S = Number(__ENV.HOLD_S || 120);
const RAMP_S = Number(__ENV.RAMP_S || 60);
const MAX_RSS = 1024 * 1024 * 1024; // NFR-09: RAM server ≤ 1 GB

const connected = new Counter('sockets_connected');
const connectFailed = new Counter('sockets_connect_failed');
const callsConnected = new Counter('calls_connected');
const callSetupMs = new Trend('call_setup_ms', true);

export const options = {
  setupTimeout: '900s',
  scenarios: {
    hold: {
      executor: 'per-vu-iterations',
      vus: SOCKETS,
      iterations: 1,
      maxDuration: `${RAMP_S + HOLD_S + 120}s`,
    },
  },
  thresholds: {
    sockets_connected: [`count>=${SOCKETS}`],
    sockets_connect_failed: ['count==0'],
    calls_connected: [`count>=${CALLS}`],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const users = registerUsers(SOCKETS);
  const convs = [];
  for (let i = 0; i < CALLS; i += 1) convs.push(directConversation(users[2 * i], users[2 * i + 1]));
  return { users, convs };
}

export default function (data) {
  const me = exec.vu.idInTest - 1;
  const user = data.users[me];
  const pair = me < CALLS * 2 ? Math.floor(me / 2) : -1;
  const caller = pair >= 0 && me % 2 === 0;
  const callee = pair >= 0 && me % 2 === 1;
  const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n';
  // Mở dần socket trong RAMP_S; cuộc gọi bắt đầu sau khi mọi socket đã mở (đỉnh tải: 1.000 socket + 200 cuộc gọi).
  const openAt = (me / SOCKETS) * RAMP_S * 1000;
  const endAt = (RAMP_S + HOLD_S) * 1000;

  let callId = null;
  let invitedAt = 0;
  let isConnected = false;
  sleep(openAt / 1000);

  const res = ws.connect(socketUrl(), {}, (socket) => {
    const io = new SocketIo(
      socket,
      { token: user.token, deviceId: user.deviceId, tabId: uuidV4() },
      {
        connected: () => {
          connected.add(1);
          if (caller) {
            socket.setTimeout(
              () => {
                invitedAt = Date.now();
                io.emit('call:invite', { conversationId: data.convs[pair], callType: 'VOICE' }, (ack) => {
                  if (check(ack, { 'invite ok': (a) => a && a.ok === true })) callId = ack.data.callId;
                });
              },
              Math.max(0, RAMP_S * 1000 - openAt) + Math.random() * 5000,
            );
          }
          socket.setTimeout(() => {
            if (caller && callId) io.emit('call:end', { callId, reason: 'HANGUP' }, () => socket.close());
            else socket.setTimeout(() => socket.close(), 2000);
          }, endAt - openAt);
        },
        connectError: (e) => {
          connectFailed.add(1);
          console.error(`connect_error VU ${me}: ${e}`);
          socket.close();
        },
        'call:incoming': (p, ack) => {
          if (!callee) return;
          ack({ ok: true });
          callId = p.callId;
          io.emit('call:accept', { callId }, (a) => check(a, { 'accept ok': (x) => x && x.ok === true }));
        },
        'call:accepted': (p) => {
          if (!caller || p.callId !== callId) return;
          io.emit('call:offer', { callId, revision: 1, sdp }, (a) => check(a, { 'offer ok': (x) => x && x.ok === true }));
        },
        'call:offer': (p) => {
          if (!callee || p.callId !== callId) return;
          io.emit('call:answer', { callId, revision: p.revision, sdp }, (a) => {
            check(a, { 'answer ok': (x) => x && x.ok === true });
            io.emit('call:state', { callId, connectionState: 'connected' }, () => undefined);
          });
        },
        'call:answer': (p) => {
          if (!caller || p.callId !== callId) return;
          io.emit('call:state', { callId, connectionState: 'connected' }, () => undefined);
        },
        'call:state': (p) => {
          if (!caller || p.callId !== callId || p.status !== 'CONNECTED' || isConnected) return;
          isConnected = true;
          callsConnected.add(1);
          callSetupMs.add(Date.now() - invitedAt);
        },
      },
    );
    socket.on('error', (e) => console.error(`ws error VU ${me}: ${e.error()}`));
  });
  check(res, { 'ws 101': (r) => r && r.status === 101 });
}

export function teardown() {
  const url = __ENV.METRICS_URL;
  if (!url) return;
  const res = http.get(url, { tags: { name: 'metrics' } });
  const m = /resident_memory_bytes\s+(\d+(?:\.\d+)?(?:e\+\d+)?)/.exec(res.body || '');
  const rss = m ? Number(m[1]) : NaN;
  console.log(`RSS server sau tải: ${(rss / 1024 / 1024).toFixed(1)} MB`);
  check(rss, { 'RSS server ≤ 1 GB (NFR-09)': (v) => v > 0 && v <= MAX_RSS });
}
