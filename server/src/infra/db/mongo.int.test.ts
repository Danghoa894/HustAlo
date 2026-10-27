import { MongoMemoryServer } from 'mongodb-memory-server';
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
