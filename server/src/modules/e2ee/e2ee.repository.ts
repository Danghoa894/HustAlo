// server/src/modules/e2ee/e2ee.repository.ts — truy vấn userDevices, oneTimePreKeys (database_schema.md §2.9, §2.10,
// §4.8). Không có quy tắc nghiệp vụ.
import { DeviceStatus, type OneTimePreKey, type SignedPreKey } from '@hustalo/shared';
import { Types, type ClientSession } from 'mongoose';
import { OneTimePreKeyModel } from './oneTimePreKey.model';
import { UserDeviceModel } from './userDevice.model';

export interface DeviceRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  deviceId: string;
  signalDeviceId: number;
  registrationId: number;
  identityKey: string;
  signedPreKey: SignedPreKey & { createdAt: Date };
  status: DeviceStatus;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceKeys {
  registrationId: number;
  identityKey: string;
  signedPreKey: SignedPreKey;
}

const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);
const opts = (session?: ClientSession) => (session ? { session } : {});

export const e2eeRepository = {
  findDevice: (userId: string, deviceId: string, session?: ClientSession) =>
    UserDeviceModel.findOne({ userId: oid(userId), deviceId }, null, opts(session))
      .lean<DeviceRecord>()
      .exec(),

  /** Index user_status. */
  activeDevices: (userId: string, session?: ClientSession) =>
    UserDeviceModel.find({ userId: oid(userId), status: DeviceStatus.ACTIVE }, null, opts(session))
      .sort({ signalDeviceId: 1 })
      .lean<DeviceRecord[]>()
      .exec(),

  allDevices: (userId: string) =>
    UserDeviceModel.find({ userId: oid(userId) })
      .sort({ signalDeviceId: 1 })
      .lean<DeviceRecord[]>()
      .exec(),

  countActiveExcept: (userId: string, deviceId: string, session: ClientSession) =>
    UserDeviceModel.countDocuments(
      { userId: oid(userId), status: DeviceStatus.ACTIVE, deviceId: { $ne: deviceId } },
      { session },
    ).exec(),

  /** Index user_signalDevice_unique (sort desc, lấy 1). */
  async maxSignalDeviceId(userId: string, session: ClientSession): Promise<number> {
    const top = await UserDeviceModel.findOne({ userId: oid(userId) }, { signalDeviceId: 1 }, { session })
      .sort({ signalDeviceId: -1 })
      .lean<{ signalDeviceId: number }>()
      .exec();
    return top?.signalDeviceId ?? 0;
  },

  async insertDevice(
    userId: string,
    deviceId: string,
    signalDeviceId: number,
    keys: DeviceKeys,
    session: ClientSession,
  ): Promise<void> {
    await UserDeviceModel.create(
      [{ userId: oid(userId), deviceId, signalDeviceId, ...keys, signedPreKey: { ...keys.signedPreKey } }],
      { session },
    );
  },

  /** Ghi đè khóa (đăng ký lại / xoay signed prekey) và đưa device về ACTIVE. */
  async updateDeviceKeys(
    userId: string,
    deviceId: string,
    keys: DeviceKeys & { signedPreKeyCreatedAt: Date },
    session: ClientSession,
  ): Promise<void> {
    await UserDeviceModel.updateOne(
      { userId: oid(userId), deviceId },
      {
        $set: {
          registrationId: keys.registrationId,
          identityKey: keys.identityKey,
          signedPreKey: { ...keys.signedPreKey, createdAt: keys.signedPreKeyCreatedAt },
          status: DeviceStatus.ACTIVE,
          revokedAt: null,
        },
      },
      { session },
    ).exec();
  },

  /** ACTIVE → REVOKED có điều kiện; false nếu đã REVOKED (idempotent). */
  async markRevoked(userId: string, deviceId: string, now: Date): Promise<boolean> {
    const res = await UserDeviceModel.updateOne(
      { userId: oid(userId), deviceId, status: DeviceStatus.ACTIVE },
      { $set: { status: DeviceStatus.REVOKED, revokedAt: now } },
    ).exec();
    return res.modifiedCount === 1;
  },

  // ---- oneTimePreKeys ----
  async insertPreKeys(userId: string, deviceId: string, keys: OneTimePreKey[], session: ClientSession): Promise<void> {
    if (keys.length === 0) return;
    await OneTimePreKeyModel.insertMany(
      keys.map((k) => ({ userId: oid(userId), deviceId, keyId: k.keyId, publicKey: k.publicKey })),
      { session, ordered: true },
    );
  },

  async deletePreKeys(userId: string, deviceId: string, session?: ClientSession): Promise<void> {
    await OneTimePreKeyModel.deleteMany({ userId: oid(userId), deviceId }, opts(session)).exec();
  },

  /** DB §4.8: nguyên tử trên một document, index `available`; null → hết prekey (EC-E2EE-002). */
  consumeOneTimePreKey: (userId: Types.ObjectId, deviceId: string, consumer: string) =>
    OneTimePreKeyModel.findOneAndUpdate(
      { userId, deviceId, consumedAt: null },
      { $set: { consumedAt: new Date(), consumedBy: oid(consumer) } },
      { sort: { keyId: 1 }, new: true, projection: { _id: 0, keyId: 1, publicKey: 1 } },
    )
      .lean<OneTimePreKey>()
      .exec(),

  countAvailable: (userId: string | Types.ObjectId, deviceId: string, session?: ClientSession) =>
    OneTimePreKeyModel.countDocuments({ userId: oid(userId), deviceId, consumedAt: null }, opts(session)).exec(),
};

export type E2eeRepository = typeof e2eeRepository;
