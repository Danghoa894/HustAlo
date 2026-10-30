import { EVENTS } from '@hustalo/shared';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../infra/logger/logger';
import type { Emitter } from '../../realtime/emitter';
import type { PresenceRepository } from './presence.repository';
import { createPresenceService } from './presence.service';

const ALICE = '6720a1b2c3d4e5f601234561';
const BOB = '6720a1b2c3d4e5f601234562';

function setup(opts: { redisHealthy: boolean; viewerShows?: boolean; alive?: number }) {
  const toRooms = vi.fn();
  const aliveMany = vi.fn((ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, opts.alive ?? 0]))));
  const repo = {
    aliveMany,
    aliveCount: vi.fn(() => Promise.resolve(0)),
    touch: vi.fn(() => Promise.resolve(1)),
  } as unknown as PresenceRepository;
  const lastSeenAt = new Date('2026-10-30T08:00:00.000Z');
  const service = createPresenceService({
    repo,
    users: {
      getPrivacy: (ids) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [id, { showLastSeen: id === ALICE ? (opts.viewerShows ?? true) : true, lastSeenAt }]),
          ),
        ),
      setLastSeen: () => Promise.resolve(),
      isBlockedEitherWay: () => Promise.resolve(false),
    },
    conversations: { shareConversation: (_me, others) => Promise.resolve(new Set(others)) },
    emitter: { toRooms } as unknown as Emitter,
    isRedisHealthy: () => opts.redisHealthy,
    logger: createLogger({ level: 'silent' }),
    instanceId: 'i1',
  });
  return { service, toRooms, aliveMany, lastSeenAt };
}

describe('presence.service (FR-PRES-001..003, FR-USER-004)', () => {
  it('TC-PRES-005 Redis không truy cập được → snapshot degraded: true, OFFLINE và lastSeenAt null, không gọi Redis', async () => {
    const { service, aliveMany } = setup({ redisHealthy: false });
    const snap = await service.subscribe(ALICE, [BOB]);
    expect(snap).toMatchObject({
      degraded: true,
      accepted: [BOB],
      users: [{ userId: BOB, status: 'OFFLINE', lastSeenAt: null }],
    });
    expect(aliveMany).not.toHaveBeenCalled();
  });

  it('TC-PRES-004 người xem ẩn lastSeen → nhận lastSeenAt null của người khác (có đi có lại); bật → có lastSeenAt', async () => {
    const hidden = await setup({ redisHealthy: true, viewerShows: false }).service.subscribe(ALICE, [BOB]);
    expect(hidden.viewerShowsLastSeen).toBe(false);
    expect(hidden.users[0]?.lastSeenAt).toBeNull();
    const { service, lastSeenAt } = setup({ redisHealthy: true, viewerShows: true });
    expect((await service.subscribe(ALICE, [BOB])).users[0]?.lastSeenAt).toBe(lastSeenAt.toISOString());
  });

  it('ONLINE không kèm lastSeenAt; kết nối đầu phát ONLINE tới cả presence:{u} và presence-nols:{u}', async () => {
    const { service, toRooms } = setup({ redisHealthy: true, alive: 1 });
    expect((await service.subscribe(ALICE, [BOB])).users[0]).toEqual({
      userId: BOB,
      status: 'ONLINE',
      lastSeenAt: null,
    });
    await service.connect(BOB, 'sock-1');
    expect(toRooms.mock.calls).toEqual([
      [`presence:${BOB}`, EVENTS.PRESENCE_UPDATE, { userId: BOB, status: 'ONLINE', lastSeenAt: null }],
      [`presence-nols:${BOB}`, EVENTS.PRESENCE_UPDATE, { userId: BOB, status: 'ONLINE', lastSeenAt: null }],
    ]);
  });
});
