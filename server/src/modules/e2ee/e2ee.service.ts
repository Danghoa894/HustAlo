// server/src/modules/e2ee/e2ee.service.ts — FR-E2EE-001..004, FR-E2EE-007 (kiến trúc §7(h), §9.3; DB §2.9, §2.10, §4.8).
// Module khác chỉ được gọi qua port truyền vào (ma trận §5.2): auth (thu hồi phiên theo device, userAgent), và quyền P24
// (sharesActiveSecret của conversations, isBlockedEitherWay của users) — main.ts tiêm, không import module khác.
import {
  DeviceStatus,
  E2EE_MAX_DEVICES_PER_USER,
  E2EE_PREKEY_LOW_THRESHOLD,
  E2EE_PREKEYS_LOW_NOTIFY_COOLDOWN_S,
  EVENTS,
  type Device,
  type DeviceKeysResponse,
  type OneTimePreKey,
  type PreKeyBundle,
  type PreKeyBundlesResponse,
  type RegisterDeviceKeysRequest,
} from '@hustalo/shared';
import { AppError } from '../../http/errors/app-error';
import { withTxn } from '../../infra/db/transaction';
import { keys } from '../../infra/redis/keys';
import type { RedisHandle } from '../../infra/redis/redis';
import type { Emitter } from '../../realtime/emitter';
import { e2eeRepository as repo, type DeviceRecord } from './e2ee.repository';

export interface E2eeAuthPort {
  /** Thu hồi mọi session family của device, reason DEVICE_REVOKED (phát session:revoked, ngắt socket). */
  revokeDeviceSessions(userId: string, deviceId: string): Promise<void>;
  /** refreshSessions.userAgent của thế hệ mới nhất theo (userId, deviceId); không có → ''. */
  latestUserAgent(userId: string, deviceId: string): Promise<string>;
}

export interface BundleAccessPort {
  /** Có chung hội thoại SECRET (chưa xóa) mà cả hai còn là thành viên. */
  sharesActiveSecret(me: string, other: string): Promise<boolean>;
  isBlockedEitherWay(a: string, b: string): Promise<boolean>;
}

export interface E2eeDeps {
  auth: E2eeAuthPort;
  access: BundleAccessPort;
  emitter: Emitter;
  redis: RedisHandle;
  now?: () => Date;
}

export interface DeviceAuth {
  userId: string;
  deviceId: string;
}

/** Envelope đã qua Zod (E2eeEnvelope). */
export interface EnvelopeInput {
  senderDeviceId: string;
  recipients: { deviceId: string }[];
}

const MSG = {
  notOwnDevice: 'Chỉ đăng ký được khóa cho thiết bị đang dùng',
  firstNeedsPreKeys: 'Lần đăng ký đầu cần gửi one-time prekey',
  tooMany: `Đã có ${E2EE_MAX_DEVICES_PER_USER} thiết bị dùng trò chuyện bí mật. Hãy thu hồi một thiết bị khác`,
  duplicateKeyId: 'keyId của prekey đã tồn tại',
  deviceInactive: 'Thiết bị này chưa đăng ký hoặc đã bị thu hồi',
  deviceNotFound: 'Không tìm thấy thiết bị',
  notFound: 'Không tìm thấy người dùng',
  blocked: 'Không thể trò chuyện bí mật với người này',
  noKeys: 'Người nhận chưa bật trò chuyện bí mật',
  revokedSender: 'Tin nhắn từ thiết bị đã bị thu hồi',
  changed: 'Danh sách thiết bị đã thay đổi',
  duplicateRecipient: 'Mỗi thiết bị chỉ được nhận một bản mã',
} as const;

const SIGNAL_DEVICE_ID_RETRIES = 3;

const isDuplicateKey = (err: unknown, index: string) =>
  err instanceof Error && 'code' in err && err.code === 11000 && err.message.includes(index);

export function createE2eeService(deps: E2eeDeps) {
  const { auth, access, emitter, redis } = deps;
  const now = deps.now ?? (() => new Date());

  /** AUTHZ-7: deviceId trên path phải là `did` của token. */
  function assertOwnDevice(me: DeviceAuth, deviceId: string) {
    if (deviceId !== me.deviceId) throw new AppError('FORBIDDEN', MSG.notOwnDevice);
  }

  /**
   * Một lượt đăng ký trong transaction (DB §2.9 quy tắc nghiệp vụ). Trả signalDeviceId.
   * - Chưa có: cần oneTimePreKeys; đếm ACTIVE khác ≥ 5 → CONFLICT; signalDeviceId = max + 1.
   * - Đã có, identity/registrationId đổi (IndexedDB bị xóa, EC-E2EE-006): ghi đè, xóa prekey cũ, giữ signalDeviceId.
   * - Đã có, cùng identity: xoay signed prekey (giữ createdAt nếu không đổi), thêm prekey nếu có.
   * REVOKED → ACTIVE (đăng nhập lại cùng deviceId) cũng phải còn chỗ (< 5 ACTIVE khác).
   */
  async function registerOnce(me: DeviceAuth, body: RegisterDeviceKeysRequest): Promise<number> {
    return withTxn(async (session) => {
      const existing = await repo.findDevice(me.userId, me.deviceId, session);
      const activating = !existing || existing.status !== DeviceStatus.ACTIVE;
      if (activating && (await repo.countActiveExcept(me.userId, me.deviceId, session)) >= E2EE_MAX_DEVICES_PER_USER) {
        throw new AppError('CONFLICT', MSG.tooMany);
      }
      const devKeys = {
        registrationId: body.registrationId,
        identityKey: body.identityKey,
        signedPreKey: body.signedPreKey,
      };
      if (!existing) {
        if (!body.oneTimePreKeys) throw new AppError('VALIDATION_ERROR', MSG.firstNeedsPreKeys);
        const signalDeviceId = (await repo.maxSignalDeviceId(me.userId, session)) + 1;
        await repo.insertDevice(me.userId, me.deviceId, signalDeviceId, devKeys, session);
        await repo.insertPreKeys(me.userId, me.deviceId, body.oneTimePreKeys, session);
        return signalDeviceId;
      }
      const identityChanged =
        existing.identityKey !== body.identityKey || existing.registrationId !== body.registrationId;
      const sameSigned =
        !identityChanged &&
        existing.signedPreKey.keyId === body.signedPreKey.keyId &&
        existing.signedPreKey.publicKey === body.signedPreKey.publicKey;
      await repo.updateDeviceKeys(
        me.userId,
        me.deviceId,
        { ...devKeys, signedPreKeyCreatedAt: sameSigned ? existing.signedPreKey.createdAt : now() },
        session,
      );
      if (identityChanged) await repo.deletePreKeys(me.userId, me.deviceId, session);
      await repo.insertPreKeys(me.userId, me.deviceId, body.oneTimePreKeys ?? [], session);
      return existing.signalDeviceId;
    });
  }

  /** e2ee:prekeys-low tối đa 1 lần / cooldown; Redis lỗi → bỏ qua cooldown, vẫn phát (kiến trúc §10.2). */
  async function notifyLow(deviceId: string, remaining: number) {
    let first = true;
    if (redis.isHealthy()) {
      try {
        first =
          (await redis.client.set(keys.e2eeLowSent(deviceId), '1', 'EX', E2EE_PREKEYS_LOW_NOTIFY_COOLDOWN_S, 'NX')) ===
          'OK';
      } catch {
        first = true;
      }
    }
    if (first) emitter.toDevice(deviceId, EVENTS.E2EE_PREKEYS_LOW, { deviceId, remaining });
  }

  async function bundleOf(d: DeviceRecord, consumer: string): Promise<PreKeyBundle> {
    const otpk = await repo.consumeOneTimePreKey(d.userId, d.deviceId, consumer);
    const remaining = await repo.countAvailable(d.userId, d.deviceId);
    if (remaining < E2EE_PREKEY_LOW_THRESHOLD) await notifyLow(d.deviceId, remaining);
    return {
      userId: String(d.userId),
      deviceId: d.deviceId,
      signalDeviceId: d.signalDeviceId,
      registrationId: d.registrationId,
      identityKey: d.identityKey,
      signedPreKey: {
        keyId: d.signedPreKey.keyId,
        publicKey: d.signedPreKey.publicKey,
        signature: d.signedPreKey.signature,
      },
      oneTimePreKey: otpk ? { keyId: otpk.keyId, publicKey: otpk.publicKey } : null,
    };
  }

  return {
    /** PUT /e2ee/devices/{deviceId}/keys (FR-E2EE-001, AC-110, EC-E2EE-006, TC-DB-017). */
    async registerDevice(
      me: DeviceAuth,
      deviceId: string,
      body: RegisterDeviceKeysRequest,
    ): Promise<DeviceKeysResponse> {
      assertOwnDevice(me, deviceId);
      for (let attempt = 1; ; attempt += 1) {
        try {
          const signalDeviceId = await registerOnce(me, body);
          return {
            deviceId,
            signalDeviceId,
            oneTimePreKeyCount: await repo.countAvailable(me.userId, deviceId),
          };
        } catch (err) {
          if (isDuplicateKey(err, 'device_key_unique')) throw new AppError('CONFLICT', MSG.duplicateKeyId);
          // Đua cấp signalDeviceId, hoặc hai tab cùng device đăng ký lần đầu → lượt sau thấy bản đã có.
          const race = isDuplicateKey(err, 'user_signalDevice_unique') || isDuplicateKey(err, 'user_device_unique');
          if (race && attempt < SIGNAL_DEVICE_ID_RETRIES) continue;
          throw err;
        }
      }
    },

    /** POST /e2ee/devices/{deviceId}/prekeys (FR-E2EE-003, AC-115): trùng keyId → CONFLICT, không thêm khóa nào. */
    async uploadPreKeys(me: DeviceAuth, deviceId: string, preKeys: OneTimePreKey[]) {
      assertOwnDevice(me, deviceId);
      try {
        return await withTxn(async (session) => {
          const device = await repo.findDevice(me.userId, deviceId, session);
          if (device?.status !== DeviceStatus.ACTIVE) throw new AppError('FORBIDDEN', MSG.deviceInactive);
          await repo.insertPreKeys(me.userId, deviceId, preKeys, session);
          return { oneTimePreKeyCount: await repo.countAvailable(me.userId, deviceId, session) };
        });
      } catch (err) {
        if (isDuplicateKey(err, 'device_key_unique')) throw new AppError('CONFLICT', MSG.duplicateKeyId);
        throw err;
      }
    },

    /**
     * GET /e2ee/users/{userId}/bundles (FR-E2EE-002, AC-111, AC-116). Quyền P24: chính mình (trả device khác device
     * hiện tại) hoặc có chung SECRET (không → 404), không bị chặn (403). Không có device ACTIVE → 422.
     */
    async getBundles(me: DeviceAuth, targetId: string): Promise<PreKeyBundlesResponse> {
      const self = targetId === me.userId;
      if (!self) {
        if (!(await access.sharesActiveSecret(me.userId, targetId))) throw new AppError('NOT_FOUND', MSG.notFound);
        if (await access.isBlockedEitherWay(me.userId, targetId)) throw new AppError('USER_BLOCKED', MSG.blocked);
      }
      const devices = (await repo.activeDevices(targetId)).filter((d) => !self || d.deviceId !== me.deviceId);
      if (devices.length === 0) throw new AppError('E2EE_KEYS_UNAVAILABLE', MSG.noKeys);
      const bundles: PreKeyBundle[] = [];
      for (const d of devices) bundles.push(await bundleOf(d, me.userId));
      return { userId: targetId, bundles };
    },

    /** GET /e2ee/devices (FR-E2EE-001, FR-E2EE-007). */
    async listDevices(me: DeviceAuth): Promise<{ items: Device[] }> {
      const devices = await repo.allDevices(me.userId);
      const items = await Promise.all(
        devices.map(async (d) => ({
          deviceId: d.deviceId,
          signalDeviceId: d.signalDeviceId,
          status: d.status,
          isCurrent: d.deviceId === me.deviceId,
          userAgent: (await auth.latestUserAgent(me.userId, d.deviceId)).slice(0, 512),
          oneTimePreKeyCount: await repo.countAvailable(me.userId, d.deviceId),
          createdAt: d.createdAt.toISOString(),
          revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
        })),
      );
      return { items };
    },

    /**
     * DELETE /e2ee/devices/{deviceId} (FR-E2EE-007, AC-117, EC-E2EE-005): REVOKED + xóa prekey + thu hồi phiên của
     * device (DEVICE_REVOKED). Device không thuộc mình → NOT_FOUND giống hệt không tồn tại (FR-SEC-008); đã thu hồi → no-op.
     */
    async revokeDevice(me: DeviceAuth, deviceId: string): Promise<void> {
      const device = await repo.findDevice(me.userId, deviceId);
      if (!device) throw new AppError('NOT_FOUND', MSG.deviceNotFound);
      if (!(await repo.markRevoked(me.userId, deviceId, now()))) return;
      await repo.deletePreKeys(me.userId, deviceId);
      await auth.revokeDeviceSessions(me.userId, deviceId);
    },

    // ---- port cho conversations / messages (ma trận §5.2) ----
    hasActiveDevice: async (userId: string) => (await repo.activeDevices(userId)).length > 0,

    isDeviceActive: async (userId: string, deviceId: string) =>
      (await repo.findDevice(userId, deviceId))?.status === DeviceStatus.ACTIVE,

    /**
     * Kiến trúc §7(h): device gửi ACTIVE (FORBIDDEN, EC-E2EE-005); recipients đúng bằng (device ACTIVE của peer) ∪
     * (device ACTIVE khác của người gửi), lệch → CONFLICT (EC-E2EE-008); peer không còn device → E2EE_KEYS_UNAVAILABLE.
     * Trả tập device theo chủ để fan-out mỗi device chỉ nhận phần của mình.
     */
    async assertEnvelopeRecipients(
      sender: DeviceAuth,
      peerId: string,
      envelope: EnvelopeInput,
    ): Promise<{ ownDeviceIds: string[]; peerDeviceIds: string[] }> {
      if (envelope.senderDeviceId !== sender.deviceId) throw new AppError('FORBIDDEN', MSG.revokedSender);
      const [own, peer] = await Promise.all([repo.activeDevices(sender.userId), repo.activeDevices(peerId)]);
      if (!own.some((d) => d.deviceId === sender.deviceId)) throw new AppError('FORBIDDEN', MSG.revokedSender);
      if (peer.length === 0) throw new AppError('E2EE_KEYS_UNAVAILABLE', MSG.noKeys);
      const ownDeviceIds = own.map((d) => d.deviceId).filter((id) => id !== sender.deviceId);
      const peerDeviceIds = peer.map((d) => d.deviceId);
      const got = envelope.recipients.map((r) => r.deviceId);
      if (new Set(got).size !== got.length) throw new AppError('VALIDATION_ERROR', MSG.duplicateRecipient);
      const expected = new Set([...ownDeviceIds, ...peerDeviceIds]);
      if (got.length !== expected.size || got.some((id) => !expected.has(id))) {
        throw new AppError('CONFLICT', MSG.changed);
      }
      return { ownDeviceIds, peerDeviceIds };
    },
  };
}

export type E2eeService = ReturnType<typeof createE2eeService>;
