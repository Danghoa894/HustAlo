// Unit e2ee.service với repository giả: nhánh khó dựng ở integration (Redis lỗi → bỏ cooldown, đua signalDeviceId).
import { EVENTS } from '@hustalo/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Emitter } from '../../realtime/emitter';
import type { RedisHandle } from '../../infra/redis/redis';

const repo = vi.hoisted(() => ({
  findDevice: vi.fn(),
  activeDevices: vi.fn(),
  allDevices: vi.fn(),
  countActiveExcept: vi.fn(),
  maxSignalDeviceId: vi.fn(),
  insertDevice: vi.fn(),
  updateDeviceKeys: vi.fn(),
  markRevoked: vi.fn(),
  insertPreKeys: vi.fn(),
  deletePreKeys: vi.fn(),
  consumeOneTimePreKey: vi.fn(),
  countAvailable: vi.fn(),
}));
vi.mock('./e2ee.repository', () => ({ e2eeRepository: repo }));
vi.mock('../../infra/db/transaction', () => ({ withTxn: (fn: (s: unknown) => unknown) => fn({}) }));

const { createE2eeService } = await import('./e2ee.service');

const userId = '6720a1b2c3d4e5f601234563';
const me = { userId: '6720a1b2c3d4e5f601234560', deviceId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' };
const peerDevice = {
  userId,
  deviceId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
  signalDeviceId: 1,
  registrationId: 7,
  identityKey: 'k',
  signedPreKey: { keyId: 1, publicKey: 'p', signature: 's', createdAt: new Date() },
};

function setup(redisSet: () => Promise<unknown>, healthy = true) {
  const toDevice = vi.fn();
  const emitter = { toDevice } as unknown as Emitter;
  const redis = { client: { set: vi.fn(redisSet) }, isHealthy: () => healthy } as unknown as RedisHandle;
  const svc = createE2eeService({
    auth: { revokeDeviceSessions: vi.fn(), latestUserAgent: vi.fn() },
    access: { sharesActiveSecret: () => Promise.resolve(true), isBlockedEitherWay: () => Promise.resolve(false) },
    emitter,
    redis,
  });
  return { svc, toDevice };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.activeDevices.mockResolvedValue([peerDevice]);
  repo.consumeOneTimePreKey.mockResolvedValue(null);
  repo.countAvailable.mockResolvedValue(0);
});

describe('e2ee:prekeys-low (FR-E2EE-003, kiến trúc §10.2)', () => {
  it('SET NX thành công → phát; đã có cooldown → không phát', async () => {
    const ok = setup(() => Promise.resolve('OK'));
    await ok.svc.getBundles(me, userId);
    expect(ok.toDevice).toHaveBeenCalledWith(peerDevice.deviceId, EVENTS.E2EE_PREKEYS_LOW, {
      deviceId: peerDevice.deviceId,
      remaining: 0,
    });
    const cooling = setup(() => Promise.resolve(null));
    await cooling.svc.getBundles(me, userId);
    expect(cooling.toDevice).not.toHaveBeenCalled();
  });

  it('Redis lỗi hoặc không healthy → bỏ qua cooldown, vẫn phát', async () => {
    const failing = setup(() => Promise.reject(new Error('down')));
    await failing.svc.getBundles(me, userId);
    expect(failing.toDevice).toHaveBeenCalledTimes(1);
    const unhealthy = setup(() => Promise.resolve(null), false);
    await unhealthy.svc.getBundles(me, userId);
    expect(unhealthy.toDevice).toHaveBeenCalledTimes(1);
  });

  it('còn ≥ 20 → không phát', async () => {
    repo.countAvailable.mockResolvedValue(20);
    const { svc, toDevice } = setup(() => Promise.resolve('OK'));
    await svc.getBundles(me, userId);
    expect(toDevice).not.toHaveBeenCalled();
  });
});

describe('registerDevice (DB §2.9)', () => {
  const keys = {
    registrationId: 1,
    identityKey: 'i',
    signedPreKey: { keyId: 1, publicKey: 'p', signature: 's' },
    oneTimePreKeys: [{ keyId: 1, publicKey: 'o' }],
  };
  const e11000 = (index: string) =>
    Object.assign(new Error(`E11000 duplicate key error index: ${index}`), { code: 11000 });

  it('E11000 trên user_signalDevice_unique → thử lại, cấp max + 1 mới', async () => {
    repo.findDevice.mockResolvedValue(null);
    repo.countActiveExcept.mockResolvedValue(1);
    repo.maxSignalDeviceId.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    repo.insertDevice.mockRejectedValueOnce(e11000('user_signalDevice_unique')).mockResolvedValueOnce(undefined);
    repo.countAvailable.mockResolvedValue(1);
    const { svc } = setup(() => Promise.resolve('OK'));
    await expect(svc.registerDevice(me, me.deviceId, keys)).resolves.toEqual({
      deviceId: me.deviceId,
      signalDeviceId: 3,
      oneTimePreKeyCount: 1,
    });
  });

  it('đua liên tục quá 3 lần → ném lỗi gốc', async () => {
    repo.findDevice.mockResolvedValue(null);
    repo.countActiveExcept.mockResolvedValue(0);
    repo.maxSignalDeviceId.mockResolvedValue(0);
    repo.insertDevice.mockRejectedValue(e11000('user_signalDevice_unique'));
    const { svc } = setup(() => Promise.resolve('OK'));
    await expect(svc.registerDevice(me, me.deviceId, keys)).rejects.toMatchObject({ code: 11000 });
    expect(repo.insertDevice).toHaveBeenCalledTimes(3);
  });
});
