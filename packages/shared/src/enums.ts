// packages/shared/src/enums.ts
export const ConversationType = { DIRECT: 'DIRECT', GROUP: 'GROUP', SECRET: 'SECRET' } as const;
export type ConversationType = (typeof ConversationType)[keyof typeof ConversationType];

export const MemberRole = { OWNER: 'OWNER', ADMIN: 'ADMIN', MEMBER: 'MEMBER' } as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export const MessageType = { TEXT: 'TEXT', SYSTEM: 'SYSTEM' } as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// Chỉ phía client
export const MessageClientStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
} as const;
export type MessageClientStatus = (typeof MessageClientStatus)[keyof typeof MessageClientStatus];

export const CallType = { VOICE: 'VOICE', VIDEO: 'VIDEO' } as const;
export type CallType = (typeof CallType)[keyof typeof CallType];

export const CallStatus = {
  INITIATED: 'INITIATED',
  RINGING: 'RINGING',
  ACCEPTED: 'ACCEPTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  ENDED: 'ENDED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  MISSED: 'MISSED',
  BUSY: 'BUSY',
  FAILED: 'FAILED',
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];
export const CALL_TERMINAL_STATUSES: readonly CallStatus[] = [
  'ENDED',
  'REJECTED',
  'CANCELLED',
  'MISSED',
  'BUSY',
  'FAILED',
];
export const CALL_ACTIVE_STATUSES: readonly CallStatus[] = [
  'INITIATED',
  'RINGING',
  'ACCEPTED',
  'CONNECTING',
  'CONNECTED',
  'RECONNECTING',
];

export const CallEndReason = {
  HANGUP: 'HANGUP',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  TIMEOUT: 'TIMEOUT',
  BUSY: 'BUSY',
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  MEDIA_FAILURE: 'MEDIA_FAILURE',
  ANSWERED_ELSEWHERE: 'ANSWERED_ELSEWHERE',
  PEER_DISCONNECTED: 'PEER_DISCONNECTED',
  SERVER_RESTART: 'SERVER_RESTART',
  LOGOUT: 'LOGOUT',
} as const;
export type CallEndReason = (typeof CallEndReason)[keyof typeof CallEndReason];
// Lý do client được phép gửi trong call:end
export const CLIENT_CALL_END_REASONS = ['HANGUP', 'NETWORK_FAILURE', 'MEDIA_FAILURE'] as const;

export const PresenceStatus = { ONLINE: 'ONLINE', OFFLINE: 'OFFLINE' } as const;
export type PresenceStatus = (typeof PresenceStatus)[keyof typeof PresenceStatus];

// [NEW] báo cáo trạng thái kết nối media trong call:state (client → server)
export const MediaConnectionReport = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed',
} as const;
export type MediaConnectionReport = (typeof MediaConnectionReport)[keyof typeof MediaConnectionReport];

// [NEW] client-only, KHÔNG phải CallStatus: pha cục bộ trước khi có callId / sau khi kết thúc
export const CallLocalPhase = { IDLE: 'IDLE', PREPARING_MEDIA: 'PREPARING_MEDIA', IN_CALL: 'IN_CALL' } as const;
export type CallLocalPhase = (typeof CallLocalPhase)[keyof typeof CallLocalPhase];

// [NEW] phạm vi cập nhật trong message:status
export const ReceiptScope = { MESSAGE: 'MESSAGE', GROUP_AGGREGATE: 'GROUP_AGGREGATE' } as const;
export type ReceiptScope = (typeof ReceiptScope)[keyof typeof ReceiptScope];

// [NEW] loại sự kiện của SYSTEM message
export const SystemEventKind = {
  GROUP_CREATED: 'GROUP_CREATED',
  MEMBER_ADDED: 'MEMBER_ADDED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  MEMBER_LEFT: 'MEMBER_LEFT',
  ROLE_CHANGED: 'ROLE_CHANGED',
  OWNER_TRANSFERRED: 'OWNER_TRANSFERRED',
  TITLE_CHANGED: 'TITLE_CHANGED',
  CALL_MISSED: 'CALL_MISSED',
  CALL_ENDED: 'CALL_ENDED',
} as const;
export type SystemEventKind = (typeof SystemEventKind)[keyof typeof SystemEventKind];

// [NEW] trạng thái tài khoản và thiết bị E2EE
export const UserStatus = { ACTIVE: 'ACTIVE', LOCKED: 'LOCKED' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const DeviceStatus = { ACTIVE: 'ACTIVE', REVOKED: 'REVOKED' } as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

// [NEW] loại ciphertext Signal trong envelope.recipients[].type
export const SignalMessageType = { WHISPER: 1, PREKEY: 3 } as const;
export type SignalMessageType = (typeof SignalMessageType)[keyof typeof SignalMessageType];

// [NEW] lý do session:revoked
export const SessionRevokeReason = {
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  REFRESH_REUSE: 'REFRESH_REUSE',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  DEVICE_REVOKED: 'DEVICE_REVOKED',
} as const;
export type SessionRevokeReason = (typeof SessionRevokeReason)[keyof typeof SessionRevokeReason];
