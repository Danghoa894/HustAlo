// TC-DB-001 / TC-DB-004 trên model fixture (M0 chưa có model domain; ALL_MODELS được bổ sung từ M1,
// global setup đã chạy ensureIndexes() cho mọi model thật — gap G1 trong kế hoạch M0).
import mongoose, { Schema } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseSchemaOptions } from './schema-options';
import { ALL_MODELS, ensureIndexes } from './indexes';
import { connectMongo, disconnectMongo } from './mongo';

const fixtureSchema = new Schema(
  {
    email: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    clientId: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { ...baseSchemaOptions, collection: 'm0IndexFixtures' },
);
fixtureSchema.index({ email: 1 }, { unique: true, name: 'email_unique' });
fixtureSchema.index(
  { ownerId: 1, clientId: 1 },
  { unique: true, name: 'owner_client_unique', partialFilterExpression: { clientId: { $type: 'string' } } },
);
fixtureSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' });

const FixtureModel = mongoose.model('M0IndexFixture', fixtureSchema);

type IndexInfo = Record<string, unknown> & { name: string };

async function listIndexes(): Promise<IndexInfo[]> {
  const list = (await FixtureModel.collection.listIndexes().toArray()) as IndexInfo[];
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

describe('ensureIndexes', () => {
  beforeAll(async () => {
    await connectMongo(process.env.MONGODB_URI ?? '');
    await FixtureModel.collection.drop().catch(() => undefined);
  });

  afterAll(async () => {
    await FixtureModel.collection.drop().catch(() => undefined);
    await disconnectMongo();
  });

  it('TC-DB-001 chạy hai lần liên tiếp: lần 2 không tạo/xóa index; index đúng option unique/partial/TTL', async () => {
    await ensureIndexes([FixtureModel]);
    const first = await listIndexes();
    await ensureIndexes([FixtureModel]);
    const second = await listIndexes();
    expect(second).toEqual(first);

    const byName = new Map(second.map((i) => [i.name, i]));
    expect(byName.get('email_unique')?.unique).toBe(true);
    expect(byName.get('owner_client_unique')?.partialFilterExpression).toEqual({ clientId: { $type: 'string' } });
    expect(byName.get('expires_ttl')?.expireAfterSeconds).toBe(0);
  });

  it('TC-DB-001 syncIndexes xóa index lạ không khai báo trong schema', async () => {
    await FixtureModel.collection.createIndex({ clientId: 1 }, { name: 'stray_index' });
    await ensureIndexes([FixtureModel]);
    expect((await listIndexes()).map((i) => i.name)).not.toContain('stray_index');
  });

  it('TC-DB-001 ALL_MODELS (model thật) đã đồng bộ ở global setup, chạy lại không lỗi', async () => {
    await expect(ensureIndexes(ALL_MODELS)).resolves.toBeUndefined();
  });

  it('TC-DB-004 ghi trường không khai báo → ném lỗi (strict: throw)', async () => {
    const doc = { email: 'a@hustalo.local', ownerId: new mongoose.Types.ObjectId(), expiresAt: new Date(), lạ: 1 };
    await expect(FixtureModel.create(doc)).rejects.toThrow(/not in schema/);
    await expect(
      FixtureModel.updateOne({ email: 'x' }, { $set: { khongKhaiBao: true } }, { strict: 'throw' }),
    ).rejects.toThrow();
  });
});
