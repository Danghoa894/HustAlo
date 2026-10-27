// packages/shared/src/constants.ts
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---- Tin nhắn ----
export const MESSAGE_MAX_LENGTH = 4000; // code point, sau NFC + trim (D-17)
export const MESSAGE_EDIT_WINDOW_MS = 15 * MINUTE; // [NEW] sửa/thu hồi trong 15 phút kể từ createdAt server
export const HISTORY_PAGE_DEFAULT = 30;
export const HISTORY_PAGE_MAX = 100;
export const CONVERSATION_PAGE_DEFAULT = 20; // [NEW] GET /conversations
export const CONVERSATION_PAGE_MAX = 50; // [NEW]
export const UNREAD_COUNT_CAP = 99; // [NEW] server đếm tối đa 100, UI hiển thị "99+"

// ---- Người dùng / nhóm ----
export const GROUP_MAX_MEMBERS = 100;
export const GROUP_TITLE_MAX = 100;
export const DISPLAY_NAME_MAX = 80;
export const USERNAME_MIN = 3; // [NEW]
export const USERNAME_MAX = 30; // [NEW]
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/; // [NEW]
export const PASSWORD_MIN = 8; // [NEW]
export const PASSWORD_MAX = 128; // [NEW]
export const USER_SEARCH_MIN_QUERY = 2; // [NEW]
export const USER_SEARCH_LIMIT = 20; // [NEW]
export const USER_SEARCH_MAX_QUERY = 100; // [NEW] độ dài tối đa q sau trim
export const BLOCKED_LIST_MAX = 1000; // [NEW] số blockedUserIds tối đa trả trong GET /auth/me
export const GROUP_ADD_BATCH_MAX = 50; // [NEW] số userId tối đa mỗi lần POST members

// ---- Auth ----
export const ACCESS_TOKEN_TTL_S = 15 * 60; // 15m
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60; // 30d
export const REFRESH_REUSE_GRACE_S = 10; // [NEW] D-19
export const ACCESS_TOKEN_REFRESH_SKEW_S = 60; // [NEW] client refresh trước exp 60s
export const SESSION_EXPIRED_DISCONNECT_DELAY_MS = 5 * SECOND; // [NEW] D-18

// ---- Presence / typing ----
export const PRESENCE_LEASE_TTL_MS = 60 * SECOND;
export const PRESENCE_HEARTBEAT_MS = 20 * SECOND;
export const PRESENCE_OFFLINE_GRACE_MS = 10 * SECOND;
export const PRESENCE_SUBSCRIBE_MAX = 200; // [NEW] userId tối đa mỗi presence:subscribe
export const PRESENCE_SWEEP_INTERVAL_MS = 1 * SECOND; // [NEW]
export const TYPING_TTL_MS = 5 * SECOND;
export const TYPING_CLIENT_THROTTLE_MS = 3 * SECOND;

// ---- Cuộc gọi ----
export const CALL_RING_TIMEOUT_MS = 45 * SECOND;
export const CALL_CONNECT_TIMEOUT_MS = 30 * SECOND; // ACCEPTED → CONNECTED
export const CALL_RECONNECT_GRACE_MS = 20 * SECOND;
export const CALL_MAX_ICE_RESTARTS = 2; // kiểm trong state machine (T30), KHÔNG ở Zod
export const CALL_INCOMING_ACK_TIMEOUT_MS = 5 * SECOND; // [NEW] chờ device ack call:incoming
export const ICE_DISCONNECTED_GRACE_MS = 3 * SECOND; // [NEW] 'disconnected' kéo dài > 3s mới coi là mất
export const CALL_STATE_TTL_S = 6 * 60 * 60; // [NEW] TTL tối đa call:active / user:incall
export const CALL_DEADLINE_SWEEP_INTERVAL_MS = 1 * SECOND; // [NEW] D-05
export const CALL_SDP_MAX_LENGTH = 20000; // [NEW] ký tự
export const CALL_ICE_CANDIDATE_MAX_LENGTH = 1024; // [NEW]
export const CALL_ICE_QUEUE_MAX = 200; // [NEW] candidate chờ remote description
export const TURN_CREDENTIAL_TTL_S = 60 * 60; // 1h
export const TURN_REFRESH_BEFORE_S = 5 * 60; // làm mới trước hết hạn 5 phút
export const ICE_SERVERS_CACHE_TTL_S = 5 * 60; // [NEW] cache Xirsys trong Redis
export const XIRSYS_TIMEOUT_MS = 3 * SECOND; // [NEW]
export const CALL_PAGE_DEFAULT = 20; // [NEW] GET /calls
export const CALL_PAGE_MAX = 50; // [NEW]

// ---- Client outbox / socket ----
export const CLIENT_OUTBOX_MAX = 200;
export const OUTBOX_RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000] as const; // sau đó nhân đôi, chặn trần
export const OUTBOX_RETRY_MAX_DELAY_MS = 30 * SECOND;
export const OUTBOX_MAX_AGE_MS = 24 * HOUR;
export const SOCKET_ACK_TIMEOUT_MS = 10 * SECOND; // [NEW]
export const SOCKET_PING_INTERVAL_MS = 25 * SECOND;
export const SOCKET_PING_TIMEOUT_MS = 20 * SECOND;
export const SOCKET_RECOVERY_MAX_DISCONNECT_MS = 2 * MINUTE;
export const SOCKET_MAX_PAYLOAD_BYTES = 256 * 1024; // [NEW] maxHttpBufferSize
export const REST_BODY_LIMIT_BYTES = 256 * 1024; // [NEW] vượt → 413 VALIDATION_ERROR
export const CLIENT_EVENT_DEDUPE_SIZE = 1000; // [NEW]
export const CLIENT_PENDING_RECEIPTS_MAX = 500; // [NEW] receipt đến trước tin (EC-MSG-008)
export const CLIENT_PENDING_RECEIPT_TTL_MS = 60 * SECOND; // [NEW]

// ---- Mã hóa ----
export const DATA_ENCRYPTION_VERSION = 1; // [NEW] contentEnc.v
export const E2EE_ENVELOPE_VERSION = 1; // [NEW] envelope.v
export const E2EE_ONE_TIME_PREKEY_BATCH = 100; // [NEW]
export const E2EE_PREKEY_LOW_THRESHOLD = 20; // [NEW]
export const E2EE_MAX_DEVICES_PER_USER = 5; // [NEW]
export const E2EE_SIGNED_PREKEY_ROTATION_MS = 7 * DAY; // [NEW]
export const E2EE_PREKEYS_LOW_NOTIFY_COOLDOWN_S = 60 * 60; // [NEW] chống spam e2ee:prekeys-low

// ---- DB ----
export const MONGO_TXN_MAX_RETRIES = 3; // [NEW]

// ---- Rate limit (Redis atomic) ----
export const RATE_LIMITS = {
  login: { points: 5, windowSec: 60, key: 'ip+email' },
  register: { points: 3, windowSec: 60, key: 'ip' },
  refresh: { points: 30, windowSec: 60, key: 'ip' }, // [NEW]
  messageSend: { points: 20, windowSec: 10, key: 'user' },
  callInvite: { points: 5, windowSec: 60, key: 'user' },
  typing: { points: 20, windowSec: 10, key: 'user' },
  rest: { points: 100, windowSec: 60, key: 'user' },
  callSignal: { points: 100, windowSec: 10, key: 'socket' }, // [NEW] offer/answer/ice/ice-restart/state
  socketGeneric: { points: 60, windowSec: 10, key: 'socket' }, // [NEW] join/leave/delivered/read/edit/delete/accept/reject/cancel/end
  presenceSubscribe: { points: 10, windowSec: 60, key: 'user' }, // [NEW]
  e2eeBundle: { points: 10, windowSec: 60, key: 'user+target' }, // [NEW] chống rút cạn one-time prekey
  changePassword: { points: 5, windowSec: 15 * 60, key: 'user' }, // [NEW] POST /auth/change-password, Redis down → fail-closed như auth
} as const;
