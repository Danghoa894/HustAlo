import { type ErrorResponse, type UserMe, type UserSearchResponse } from '@hustalo/shared';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RefreshSessionModel } from '../auth/refreshSession.model';
import { createUser, login, startTestServer, type Session, type TestServer } from '../../test/factories';
import { UserModel } from './user.model';
import { UserBlockModel } from './userBlock.model';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.reset();
});

const bearer = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });
const items = (res: { body: unknown }) => (res.body as UserSearchResponse).items;
const errorOf = (res: { body: unknown }) => (res.body as ErrorResponse).error;

describe('GET /users/search (FR-USER-001)', () => {
  it('TC-AC-012 q=binh và q=nguyen trả Bình; q=c → 400; q=carol không trả carol (carol đã chặn alice)', async () => {
    const alice = await createUser({ username: 'alice' });
    const binh = await createUser({ username: 'binh.nv', displayName: 'Nguyễn Văn Bình' });
    const carol = await createUser({ username: 'carol', displayName: 'Carol Lê' });
    await UserBlockModel.create({ blockerId: carol.id, blockedId: alice.id });
    const s = await login(server, alice.email);
    const search = (q: string) => server.http().get('/api/v1/users/search').query({ q }).set(bearer(s));

    for (const q of ['binh', 'nguyen', 'NGUYỄN văn']) {
      const res = await search(q);
      expect(res.status).toBe(200);
      expect(items(res).map((u) => u.id)).toEqual([binh.id]);
    }
    const short = await search('c');
    expect(short.status).toBe(400);
    expect(errorOf(short).code).toBe('VALIDATION_ERROR');
    expect(items(await search('carol'))).toEqual([]);
  });

  it('khớp email chính xác; loại chính mình và user LOCKED; người mình chặn có blockedByMe: true; ký tự regex được escape', async () => {
    const me = await createUser({ username: 'minh' });
    const target = await createUser({ username: 'minhanh', displayName: 'Minh Anh' });
    const locked = await createUser({ username: 'minhkhoa' });
    await UserModel.updateOne({ _id: locked.id }, { $set: { status: 'LOCKED' } });
    await UserBlockModel.create({ blockerId: me.id, blockedId: target.id });
    const s = await login(server, me.email);
    const search = (q: string) => server.http().get('/api/v1/users/search').query({ q }).set(bearer(s));

    const res = items(await search('minh'));
    expect(res.map((u) => u.id)).toEqual([target.id]);
    expect(res[0]).toMatchObject({ username: 'minhanh', blockedByMe: true });
    expect(items(await search(target.email.toUpperCase())).map((u) => u.id)).toEqual([target.id]);
    expect(items(await search('m.*'))).toEqual([]);
  });

  it('thứ hạng: username trùng hoàn toàn → tiền tố username → tiền tố displayName', async () => {
    const me = await createUser({ username: 'toi' });
    const byName = await createUser({ username: 'zzz1', displayName: 'An Bình' });
    const prefix = await createUser({ username: 'anh', displayName: 'Zed' });
    const exact = await createUser({ username: 'an', displayName: 'Yên' });
    const s = await login(server, me.email);
    const res = await server.http().get('/api/v1/users/search').query({ q: 'an' }).set(bearer(s));
    expect(items(res).map((u) => u.id)).toEqual([exact.id, prefix.id, byName.id]);
  });
});

describe('PATCH /users/me (FR-USER-002)', () => {
  it('TC-AC-013 displayName 81 ký tự → 400; avatarUrl http:// → 400; displayName hợp lệ → 200 và /auth/me trả tên mới', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const patch = (body: object) => server.http().patch('/api/v1/users/me').set(bearer(s)).send(body);

    expect((await patch({ displayName: 'a'.repeat(81) })).status).toBe(400);
    expect((await patch({ avatarUrl: 'http://x' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    const ok = await patch({ displayName: '  Alice Mới  ' });
    expect(ok.status).toBe(200);
    expect((ok.body as UserMe).displayName).toBe('Alice Mới');
    const me = await server.http().get('/api/v1/auth/me').set(bearer(s));
    expect((me.body as UserMe).displayName).toBe('Alice Mới');
    expect((await UserModel.findById(u.id).lean().exec())?.displayNameNormalized).toBe('alice moi');
  });

  it('avatarUrl https / null và privacy.showLastSeen cập nhật được', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const res = await server
      .http()
      .patch('/api/v1/users/me')
      .set(bearer(s))
      .send({ avatarUrl: 'https://cdn.hustalo.local/a.png', privacy: { showLastSeen: false } });
    expect(res.status).toBe(200);
    expect(res.body as UserMe).toMatchObject({ avatarUrl: 'https://cdn.hustalo.local/a.png', privacy: { showLastSeen: false } });
    const cleared = await server.http().patch('/api/v1/users/me').set(bearer(s)).send({ avatarUrl: null });
    expect((cleared.body as UserMe).avatarUrl).toBeNull();
  });
});

describe('POST/DELETE /users/{userId}/block (FR-USER-003, phần endpoint)', () => {
  it('chặn idempotent → 204, /auth/me trả blockedUserIds; bỏ chặn idempotent → 204', async () => {
    const me = await createUser();
    const other = await createUser();
    const s = await login(server, me.email);
    const block = () => server.http().post(`/api/v1/users/${other.id}/block`).set(bearer(s));
    expect((await block()).status).toBe(204);
    expect((await block()).status).toBe(204);
    expect(await UserBlockModel.countDocuments({ blockerId: me.id })).toBe(1);
    const meRes = await server.http().get('/api/v1/auth/me').set(bearer(s));
    expect((meRes.body as UserMe).blockedUserIds).toEqual([other.id]);
    const unblock = () => server.http().delete(`/api/v1/users/${other.id}/block`).set(bearer(s));
    expect((await unblock()).status).toBe(204);
    expect((await unblock()).status).toBe(204);
    expect(await UserBlockModel.countDocuments({ blockerId: me.id })).toBe(0);
  });

  it('chặn chính mình → 400; user không tồn tại → 404; id sai định dạng → 400', async () => {
    const me = await createUser();
    const s = await login(server, me.email);
    expect((await server.http().post(`/api/v1/users/${me.id}/block`).set(bearer(s))).status).toBe(400);
    const missing = await server.http().post(`/api/v1/users/${String(new Types.ObjectId())}/block`).set(bearer(s));
    expect(missing.status).toBe(404);
    expect(errorOf(missing).code).toBe('NOT_FOUND');
    expect((await server.http().post('/api/v1/users/khong-hop-le/block').set(bearer(s))).status).toBe(400);
  });
});

describe('model (database_schema.md §7)', () => {
  it('TC-DB-002 hai UserModel.create song song cùng email → đúng một thành công, một E11000 trên email_unique', async () => {
    const base = { passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$x$y', displayName: 'X', displayNameNormalized: 'x' };
    const results = await Promise.allSettled([
      UserModel.create({ ...base, email: 'dup@hustalo.local', username: 'dup1' }),
      UserModel.create({ ...base, email: 'dup@hustalo.local', username: 'dup2' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' ? (rejected.reason as { code?: number; message: string }) : null).toMatchObject({
      code: 11000,
      message: expect.stringContaining('email_unique') as unknown,
    });
  });

  it('TC-DB-003 passwordHash, tokenHash, parentHash không có trong find() mặc định; có khi select(+…)', async () => {
    const u = await createUser();
    await login(server, u.email);
    const plain = await UserModel.findById(u.id).lean().exec();
    expect(plain).not.toHaveProperty('passwordHash');
    expect(await UserModel.findById(u.id).select('+passwordHash').lean().exec()).toHaveProperty('passwordHash');
    const rs = await RefreshSessionModel.findOne({ userId: u.id }).lean().exec();
    expect(rs).not.toHaveProperty('tokenHash');
    expect(rs).not.toHaveProperty('parentHash');
    const withHash = await RefreshSessionModel.findOne({ userId: u.id }).select('+tokenHash +parentHash').lean().exec();
    expect(withHash).toHaveProperty('tokenHash');
    expect(withHash).toHaveProperty('parentHash');
  });

  it('userBlocks: blockerId = blockedId bị từ chối ở model', async () => {
    const id = new Types.ObjectId();
    await expect(UserBlockModel.create({ blockerId: id, blockedId: id })).rejects.toThrow(/khác nhau/);
  });
});
