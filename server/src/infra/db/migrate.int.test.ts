// TC-DB-027 — runner migrate.ts (database_schema.md §6.4): thứ tự theo id, idempotent, lỗi giữa chừng, danh sách rỗng.
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_COLLECTION, migrateCli, runMigrations, type Migration } from './migrate';
import { MIGRATIONS } from './migrations';
import { connectMongo, disconnectMongo } from './mongo';

const applied = () =>
  mongoose.connection
    .collection<{ _id: string; appliedAt: Date }>(MIGRATIONS_COLLECTION)
    .find()
    .sort({ _id: 1 })
    .toArray();

function fake(id: string, calls: string[], fail = false): Migration {
  return {
    id,
    up: () => {
      calls.push(id);
      return fail ? Promise.reject(new Error(`migration ${id} lỗi`)) : Promise.resolve();
    },
  };
}

describe('TC-DB-027 runner migrate.ts (database_schema.md §6.4)', () => {
  beforeAll(async () => {
    await connectMongo(process.env.MONGODB_URI ?? '');
  });

  beforeEach(async () => {
    await mongoose.connection
      .collection(MIGRATIONS_COLLECTION)
      .drop()
      .catch(() => undefined);
  });

  afterAll(async () => {
    await mongoose.connection
      .collection(MIGRATIONS_COLLECTION)
      .drop()
      .catch(() => undefined);
    await disconnectMongo();
  });

  it('TC-DB-027 _migrations rỗng: chạy theo thứ tự id (không theo thứ tự khai báo), ghi { _id, appliedAt }', async () => {
    const calls: string[] = [];
    const result = await runMigrations([fake('002-b', calls), fake('001-a', calls)]);
    expect(calls).toEqual(['001-a', '002-b']);
    expect(result.applied).toEqual(['001-a', '002-b']);
    const docs = await applied();
    expect(docs.map((d) => d._id)).toEqual(['001-a', '002-b']);
    for (const d of docs) expect(d.appliedAt).toBeInstanceOf(Date);
  });

  it('TC-DB-027 chạy lần hai không chạy lại migration đã áp dụng', async () => {
    const first: string[] = [];
    await runMigrations([fake('001-a', first), fake('002-b', first)]);
    const second: string[] = [];
    const result = await runMigrations([fake('001-a', second), fake('002-b', second), fake('003-c', second)]);
    expect(second).toEqual(['003-c']);
    expect(result.applied).toEqual(['003-c']);
    expect((await applied()).map((d) => d._id)).toEqual(['001-a', '002-b', '003-c']);
  });

  it('TC-DB-027 migration thứ hai throw: thứ nhất đã ghi, thứ hai không ghi, các migration sau không chạy', async () => {
    const calls: string[] = [];
    await expect(
      runMigrations([fake('001-a', calls), fake('002-b', calls, true), fake('003-c', calls)]),
    ).rejects.toThrow(/002-b/);
    expect(calls).toEqual(['001-a', '002-b']);
    expect((await applied()).map((d) => d._id)).toEqual(['001-a']);
  });

  it('TC-DB-027 migrateCli: lỗi → exit code khác 0; danh sách rỗng → "0 migration", exit 0', async () => {
    expect(await migrateCli([fake('001-a', [], true)])).not.toBe(0);
    expect(await applied()).toEqual([]);

    const lines: string[] = [];
    expect(await migrateCli([], (msg) => lines.push(msg))).toBe(0);
    expect(lines).toContain('0 migration');
  });

  it('TC-DB-027 id trùng hoặc sai định dạng NNN-<tên> → từ chối trước khi chạy migration nào', async () => {
    const calls: string[] = [];
    await expect(runMigrations([fake('001-a', calls), fake('001-a', calls)])).rejects.toThrow(/trùng/);
    await expect(runMigrations([fake('1-a', calls)])).rejects.toThrow(/NNN-<tên>/);
    expect(calls).toEqual([]);
    expect(await applied()).toEqual([]);
  });

  it('TC-DB-027 MVP v1.0.0 không có migration nào', () => {
    expect(MIGRATIONS).toEqual([]);
  });
});
