// server/src/infra/db/mongo.ts — kết nối Mongo bắt buộc replica set (AC-ARCH-003), health ping
import mongoose from 'mongoose';

export const REPLICA_SET_REQUIRED_MESSAGE = 'MongoDB phải chạy replica set (rs0) để dùng transaction';

export class ReplicaSetRequiredError extends Error {
  override name = 'ReplicaSetRequiredError';
  constructor() {
    super(REPLICA_SET_REQUIRED_MESSAGE);
  }
}

export async function connectMongo(uri: string, opts: { serverSelectionTimeoutMS?: number } = {}): Promise<void> {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: opts.serverSelectionTimeoutMS ?? 10_000,
    autoIndex: false,
    autoCreate: false,
  });
  try {
    await assertReplicaSet();
  } catch (err) {
    await mongoose.disconnect();
    throw err;
  }
}

/** `replSetGetStatus` ném lỗi trên standalone (NoReplicationEnabled) → không dùng được transaction. */
export async function assertReplicaSet(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new ReplicaSetRequiredError();
  try {
    const status = (await db.admin().command({ replSetGetStatus: 1 })) as { ok?: number };
    if (status.ok !== 1) throw new ReplicaSetRequiredError();
  } catch {
    throw new ReplicaSetRequiredError();
  }
}

export async function pingMongo(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected || !db) return false;
  try {
    await db.admin().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
