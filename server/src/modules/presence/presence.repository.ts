// server/src/modules/presence/presence.repository.ts — Redis presence:* và typing:* (DB Phụ lục A; kiến trúc §7(d)).
// Mọi thao tác nhiều bước chạy trong Lua (presence-touch / presence-drop / claim) để nguyên tử giữa các instance.
import type { Redis } from 'ioredis';
import { keys } from '../../infra/redis/keys';
import { withScripts } from '../../infra/redis/scripts';

const SCAN_COUNT = 200;

export function createPresenceRepository(client: Redis) {
  const r = withScripts(client);
  return {
    /** 1 khi user vừa chuyển 0 → ≥ 1 kết nối (phát ONLINE). */
    touch: (userId: string, connId: string, nowMs: number, leaseMs: number) =>
      r.presenceTouch(
        keys.presenceConns(userId),
        keys.presenceUsers(),
        keys.presenceOfflinePending(),
        connId,
        nowMs,
        leaseMs,
        userId,
      ),

    /** 1 khi kết nối cuối vừa ngắt (đã xếp OFFLINE sau grace vào presence:offline-pending). */
    drop: (userId: string, connId: string, nowMs: number, graceMs: number) =>
      r.presenceDrop(keys.presenceConns(userId), keys.presenceOfflinePending(), connId, nowMs, graceMs, userId),

    /** Bỏ user khỏi presence:users sau khi đã xếp OFFLINE: lease hết hạn sau đó không phát OFFLINE lần hai. */
    forgetLease: async (userId: string) => {
      await r.zrem(keys.presenceUsers(), userId);
    },

    claimOfflinePending: (nowMs: number, limit: number) => r.claimDue(keys.presenceOfflinePending(), nowMs, limit),
    claimExpiredLeases: (nowMs: number, limit: number) => r.claimDue(keys.presenceUsers(), nowMs, limit),

    aliveCount: (userId: string, nowMs: number) => r.zcount(keys.presenceConns(userId), nowMs, '+inf'),

    /** Trạng thái theo lô: userId → số kết nối còn lease. */
    async aliveMany(userIds: string[], nowMs: number): Promise<Map<string, number>> {
      if (userIds.length === 0) return new Map();
      const pipe = r.pipeline();
      for (const id of userIds) pipe.zcount(keys.presenceConns(id), nowMs, '+inf');
      const res = (await pipe.exec()) ?? [];
      return new Map(userIds.map((id, i) => [id, Number(res[i]?.[1] ?? 0)]));
    },

    setTyping: async (conversationId: string, userId: string, ttlMs: number) => {
      await r.set(keys.typing(conversationId, userId), '1', 'PX', ttlMs);
    },
    /** true khi key typing tồn tại và đã bị xóa. */
    clearTyping: async (conversationId: string, userId: string) =>
      (await r.del(keys.typing(conversationId, userId))) > 0,

    /** userId đang gõ trong hội thoại (SCAN typing:{conversationId}:*). */
    async typingUsers(conversationId: string): Promise<string[]> {
      const prefix = keys.typing(conversationId, '');
      const out: string[] = [];
      let cursor = '0';
      do {
        const [next, found] = await r.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', SCAN_COUNT);
        cursor = next;
        for (const k of found) out.push(k.slice(prefix.length));
      } while (cursor !== '0');
      return out;
    },
  };
}

export type PresenceRepository = ReturnType<typeof createPresenceRepository>;
