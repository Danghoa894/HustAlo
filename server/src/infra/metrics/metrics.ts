// server/src/infra/metrics/metrics.ts — prom-client registry + metric kiến trúc §11.1; /metrics chỉ bind 127.0.0.1
import { createServer, type Server } from 'node:http';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'hustalo_process_' });

const latency = [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5];

export const metrics = {
  httpRequestDuration: new Histogram({
    name: 'hustalo_http_request_duration_seconds',
    help: 'Độ trễ REST (route template, không chứa id)',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: latency,
    registers: [registry],
  }),
  socketConnections: new Gauge({
    name: 'hustalo_socket_connections',
    help: 'Socket đang kết nối',
    registers: [registry],
  }),
  socketEvents: new Counter({
    name: 'hustalo_socket_events_total',
    help: 'Số event C→S',
    labelNames: ['event', 'result', 'code'] as const,
    registers: [registry],
  }),
  messageSendAck: new Histogram({
    name: 'hustalo_message_send_ack_seconds',
    help: 'Độ trễ message:send tới ACK (NFR-ARCH-01)',
    labelNames: ['type'] as const,
    buckets: latency,
    registers: [registry],
  }),
  messageFanoutRecipients: new Histogram({
    name: 'hustalo_message_fanout_recipients',
    help: 'Số user nhận fan-out',
    labelNames: ['type'] as const,
    buckets: [1, 2, 5, 10, 25, 50, 100],
    registers: [registry],
  }),
  messageDuplicates: new Counter({
    name: 'hustalo_message_duplicates_total',
    help: 'Số lần DUPLICATE_MESSAGE',
    registers: [registry],
  }),
  contentDecryptFailures: new Counter({
    name: 'hustalo_content_decrypt_failures_total',
    help: 'Giải mã AES thất bại',
    labelNames: ['keyId'] as const,
    registers: [registry],
  }),
  callTransitions: new Counter({
    name: 'hustalo_call_transitions_total',
    help: 'Chuyển trạng thái cuộc gọi',
    labelNames: ['from', 'to', 'endReason'] as const,
    registers: [registry],
  }),
  callSetup: new Histogram({
    name: 'hustalo_call_setup_seconds',
    help: 'ACCEPTED → CONNECTED (NFR-ARCH-03)',
    labelNames: ['callType'] as const,
    buckets: [0.5, 1, 2, 3, 5, 8, 13, 20, 30],
    registers: [registry],
  }),
  callIceRestarts: new Counter({
    name: 'hustalo_call_ice_restarts_total',
    help: 'ICE restart',
    labelNames: ['result'] as const,
    registers: [registry],
  }),
  iceServersFallback: new Counter({
    name: 'hustalo_ice_servers_fallback_total',
    help: 'Xirsys lỗi → fallback',
    labelNames: ['reason'] as const,
    registers: [registry],
  }),
  rateLimited: new Counter({
    name: 'hustalo_rate_limited_total',
    help: 'Bị rate limit',
    labelNames: ['rule'] as const,
    registers: [registry],
  }),
  presenceOnlineUsers: new Gauge({
    name: 'hustalo_presence_online_users',
    help: 'User online (ước lượng từ ZSET presence:users)',
    registers: [registry],
  }),
  dependencyUp: new Gauge({
    name: 'hustalo_dependency_up',
    help: '1 = phụ thuộc hoạt động, 0 = down',
    labelNames: ['dep'] as const,
    registers: [registry],
  }),
  refreshReuseDetected: new Counter({
    name: 'hustalo_refresh_reuse_detected_total',
    help: 'Phát hiện tái sử dụng refresh token (EC-AUTH-004)',
    registers: [registry],
  }),
  txnRetries: new Counter({
    name: 'hustalo_txn_retries_total',
    help: 'Retry transaction',
    labelNames: ['op'] as const,
    registers: [registry],
  }),
};

export function startMetricsServer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      registry
        .metrics()
        .then((body) => {
          res.writeHead(200, { 'Content-Type': registry.contentType });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(500).end();
        });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
