// server/src/infra/redis/keys.ts
import { env } from '../../config/env';
const p = env.REDIS_KEY_PREFIX; // 'hustalo:'
export const keys = {
  presenceConns: (userId: string) => `${p}presence:conns:${userId}`,
  presenceUsers: () => `${p}presence:users`,
  presenceOfflinePending: () => `${p}presence:offline-pending`,
  typing: (conversationId: string, userId: string) => `${p}typing:${conversationId}:${userId}`,
  rateLimitPrefix: (rule: string) => `${p}rl:${rule}`,
  sessionRevoked: (sid: string) => `${p}session:revoked:${sid}`,
  callActive: (callId: string) => `${p}call:active:${callId}`,
  userInCall: (userId: string) => `${p}user:incall:${userId}`,
  callDeadlines: () => `${p}call:deadlines`,
  callPending: (calleeId: string) => `${p}call:pending:${calleeId}`,
  iceServersXirsys: () => `${p}ice:servers:xirsys`,
  e2eeLowSent: (deviceId: string) => `${p}e2ee:lowsent:${deviceId}`,
  idemConversation: (userId: string, key: string) => `${p}idem:conv:${userId}:${key}`,
  opsUserLocked: () => `${p}ops:user-locked`, // kênh Pub/Sub, không phải key
  prefix: p,
} as const;
