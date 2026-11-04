import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPLICA_SET_REQUIRED_MESSAGE, connectMongo, disconnectMongo, pingMongo } from './mongo';

describe('connectMongo (AC-ARCH-003)', () => {
  let standalone: MongoMemoryServer;

  beforeAll(async () => {
    standalone = await MongoMemoryServer.create();
  });

  afterAll(async () => {
    await standalone.stop();
  });

  it('TC-ARCH-003 MongoDB standalone (không replica set) → lỗi "MongoDB phải chạy replica set (rs0) để dùng transaction"', async () => {
    await expect(connectMongo(standalone.getUri(), { serverSelectionTimeoutMS: 5000 })).rejects.toThrow(
      REPLICA_SET_REQUIRED_MESSAGE,
    );
    expect(REPLICA_SET_REQUIRED_MESSAGE).toBe('MongoDB phải chạy replica set (rs0) để dùng transaction');
    expect(mongoose.connection.readyState).toBe(mongoose.ConnectionStates.disconnected);
  });

  it('replica set (global setup) → kết nối được, pingMongo = true', async () => {
    await connectMongo(process.env.MONGODB_URI ?? '');
    expect(await pingMongo()).toBe(true);
    await disconnectMongo();
    expect(await pingMongo()).toBe(false);
  });
});

// Như production (development_guide.md §9.3): replica set bật --auth + keyFile, user app chỉ có readWrite trên DB
// hustalo (infra/mongo/init-prod.js). Kiểm tra replica set không được đòi quyền cluster (replSetGetStatus →
// Unauthorized làm server crash-loop với thông báo AC-ARCH-003 dù Mongo thật sự là replica set).
describe('connectMongo với user app least-privilege (development_guide.md §9.3)', () => {
  let secured: MongoMemoryReplSet;

  beforeAll(async () => {
    secured = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: 'wiredTiger',
        auth: {
          enable: true,
          extraUsers: [
            {
              createUser: 'hustalo-app',
              pwd: 'app-pass',
              database: 'hustalo',
              roles: [{ role: 'readWrite', db: 'hustalo' }],
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await secured.stop();
  });

  it('TC-ARCH-003 user chỉ readWrite trên replica set có auth → kết nối được, pingMongo = true', async () => {
    const url = new URL(secured.getUri('hustalo'));
    url.username = 'hustalo-app';
    url.password = 'app-pass';
    url.searchParams.set('authSource', 'hustalo');
    await connectMongo(url.toString(), { serverSelectionTimeoutMS: 5000 });
    expect(await pingMongo()).toBe(true);
    await disconnectMongo();
  });
});
