// server/src/modules/presence/presence.service.ts — online/offline đa thiết bị, lastSeen, subscribe (FR-PRES-001..003,
// FR-USER-004; kiến trúc §7(d)):
// - Mỗi socket một lease `{instanceId}:{socketId}` trong presence:conns:{u}; chỉ phát presence:update khi 0 ↔ ≥ 1.
// - Socket cuối ngắt → OFFLINE sau PRESENCE_OFFLINE_GRACE_MS (sweeper claim presence:offline-pending), ghi lastSeenAt.
// - Heartbeat mỗi PRESENCE_HEARTBEAT_MS gia hạn lease mọi socket local; Redis mất dữ liệu → touch trả 1 → ONLINE lại
//   (EC-PRES-005). Instance chết → lease hết hạn, sweeper instance khác claim presence:users (EC-PRES-003).
// - presence:update bản đầy đủ tới presence:{u}; bản lastSeenAt null tới presence-nols:{u} (có đi có lại, §7(d)).
// - Redis không truy cập được → snapshot `degraded: true`, mọi trạng thái OFFLINE + lastSeenAt null.
import { randomUUID } from 'node:crypto';
import {
  EVENTS,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_LEASE_TTL_MS,
  PRESENCE_OFFLINE_GRACE_MS,
  PRESENCE_SWEEP_INTERVAL_MS,
  PresenceStatus,
} from '@hustalo/shared';
import type { PresenceEntry } from '@hustalo/shared';
import type { Logger } from 'pino';
import type { Emitter } from '../../realtime/emitter';
import { presenceNoLastSeenRoom, presenceRoom } from '../../realtime/rooms';
import type { PresenceRepository } from './presence.repository';

const SWEEP_BATCH = 200;

export interface PresenceUsersPort {
  getPrivacy(ids: string[]): Promise<Map<string, { showLastSeen: boolean; lastSeenAt: Date | null }>>;
  setLastSeen(id: string, at: Date): Promise<void>;
  isBlockedEitherWay(a: string, b: string): Promise<boolean>;
}

export interface PresenceConversationsPort {
  shareConversation(me: string, others: string[]): Promise<Set<string>>;
}

export interface PresenceTiming {
  leaseMs: number;
  graceMs: number;
  heartbeatMs: number;
  sweepMs: number;
}

export interface PresenceDeps {
  repo: PresenceRepository;
  users: PresenceUsersPort;
  conversations: PresenceConversationsPort;
  emitter: Emitter;
  isRedisHealthy: () => boolean;
  logger: Logger;
  timing?: Partial<PresenceTiming>;
  now?: () => number;
  instanceId?: string;
}

export interface PresenceSnapshot {
  accepted: string[];
  users: PresenceEntry[];
  degraded: boolean;
  /** privacy.showLastSeen của người xem: chọn room presence:{u} hay presence-nols:{u}. */
  viewerShowsLastSeen: boolean;
}

export function createPresenceService(deps: PresenceDeps) {
  const { repo, users, conversations, emitter, logger } = deps;
  const timing: PresenceTiming = {
    leaseMs: PRESENCE_LEASE_TTL_MS,
    graceMs: PRESENCE_OFFLINE_GRACE_MS,
    heartbeatMs: PRESENCE_HEARTBEAT_MS,
    sweepMs: PRESENCE_SWEEP_INTERVAL_MS,
    ...deps.timing,
  };
  const now = deps.now ?? Date.now;
  const instanceId = deps.instanceId ?? randomUUID();
  const local = new Map<string, string>(); // connId → userId (socket trên instance này)
  const timers: NodeJS.Timeout[] = [];

  const connIdOf = (socketId: string) => `${instanceId}:${socketId}`;

  function publish(userId: string, status: PresenceStatus, lastSeenAt: string | null, subjectShows: boolean) {
    emitter.toRooms(presenceRoom(userId), EVENTS.PRESENCE_UPDATE, {
      userId,
      status,
      lastSeenAt: subjectShows ? lastSeenAt : null,
    });
    emitter.toRooms(presenceNoLastSeenRoom(userId), EVENTS.PRESENCE_UPDATE, { userId, status, lastSeenAt: null });
  }

  async function touch(userId: string, connId: string): Promise<void> {
    const became = await repo.touch(userId, connId, now(), timing.leaseMs);
    if (became === 1) publish(userId, PresenceStatus.ONLINE, null, false);
  }

  /** Ghi lastSeenAt + phát OFFLINE nếu user thật sự không còn kết nối nào. */
  async function goOffline(userId: string, at: Date): Promise<void> {
    if ((await repo.aliveCount(userId, now())) > 0) return;
    await users.setLastSeen(userId, at);
    const shows = (await users.getPrivacy([userId])).get(userId)?.showLastSeen ?? false;
    publish(userId, PresenceStatus.OFFLINE, at.toISOString(), shows);
  }

  async function sweep(): Promise<void> {
    const t = now();
    const pending = await repo.claimOfflinePending(t, SWEEP_BATCH);
    // offline-pending có score = lúc ngắt + grace → lúc ngắt ≈ now - grace (AC-061).
    for (const userId of pending) await goOffline(userId, new Date(t - timing.graceMs));
    const expired = await repo.claimExpiredLeases(t, SWEEP_BATCH);
    // presence:users có score = hạn lease → lần gia hạn cuối ≈ now - lease (EC-PRES-003, instance chết).
    for (const userId of expired) await goOffline(userId, new Date(t - timing.leaseMs));
  }

  async function heartbeat(): Promise<void> {
    for (const [connId, userId] of local) await touch(userId, connId);
  }

  const safe = (name: string, fn: () => Promise<void>) => () => {
    fn().catch((err: unknown) => {
      logger.warn({ err: (err as Error).message, job: name }, 'presence job lỗi');
    });
  };

  return {
    instanceId,

    /** Socket vừa handshake thành công. Redis lỗi → bỏ qua (chat vẫn chạy, presence degraded). */
    async connect(userId: string, socketId: string): Promise<void> {
      const connId = connIdOf(socketId);
      local.set(connId, userId);
      await touch(userId, connId).catch(() => undefined);
    },

    async disconnect(userId: string, socketId: string): Promise<void> {
      const connId = connIdOf(socketId);
      local.delete(connId);
      try {
        const last = await repo.drop(userId, connId, now(), timing.graceMs);
        if (last === 1) await repo.forgetLease(userId);
      } catch {
        // Redis lỗi: lease tự hết hạn ≤ PRESENCE_LEASE_TTL_MS, sweeper phát OFFLINE.
      }
    },

    /** presence:subscribe — lọc im lặng người không chung hội thoại hoặc bị chặn hai chiều (AC-063, EC-SEC-002). */
    async subscribe(viewerId: string, userIds: string[]): Promise<PresenceSnapshot> {
      const shared = await conversations.shareConversation(viewerId, userIds);
      const candidates = [...shared];
      const blocked = await Promise.all(candidates.map((id) => users.isBlockedEitherWay(viewerId, id)));
      const accepted = candidates.filter((_, i) => !blocked[i]);
      const privacy = await users.getPrivacy([viewerId, ...accepted]);
      const viewerShowsLastSeen = privacy.get(viewerId)?.showLastSeen ?? true;

      let alive: Map<string, number> | null = null;
      if (deps.isRedisHealthy()) alive = await repo.aliveMany(accepted, now()).catch(() => null);
      const degraded = alive === null;
      const entries = accepted.map((userId): PresenceEntry => {
        const online = (alive?.get(userId) ?? 0) > 0;
        const p = privacy.get(userId);
        const showsLastSeen = !degraded && !online && viewerShowsLastSeen && (p?.showLastSeen ?? false);
        return {
          userId,
          status: online ? PresenceStatus.ONLINE : PresenceStatus.OFFLINE,
          lastSeenAt: showsLastSeen && p?.lastSeenAt ? p.lastSeenAt.toISOString() : null,
        };
      });
      return { accepted, users: entries, degraded, viewerShowsLastSeen };
    },

    /** Chạy heartbeat + sweeper (main.ts / test). */
    start(): void {
      timers.push(setInterval(safe('heartbeat', heartbeat), timing.heartbeatMs));
      timers.push(setInterval(safe('sweep', sweep), timing.sweepMs));
    },

    stop(): void {
      for (const t of timers.splice(0)) clearInterval(t);
    },

    /** Test: chạy ngay một vòng. */
    runHeartbeat: heartbeat,
    runSweep: sweep,
  };
}

export type PresenceService = ReturnType<typeof createPresenceService>;
