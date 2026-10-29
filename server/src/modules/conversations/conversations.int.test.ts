import { randomUUID } from 'node:crypto';
import {
  EVENTS,
  type AddMembersResponse,
  type Conversation,
  type ConversationPage,
  type CreateConversationResponse,
  type ErrorResponse,
} from '@hustalo/shared';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../test/db';
import { createUser, createUsers, login, startTestServer, type Session, type TestServer } from '../../test/factories';
import { connectAs, waitFor } from '../../test/socket-client';
import { ConversationModel } from './conversation.model';
import { ConversationMemberModel } from './conversationMember.model';

let server: TestServer;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.reset();
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});

const bearer = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });
const errorOf = (res: { body: unknown }) => (res.body as ErrorResponse).error;
const api = () => server.http();

async function userWithSession(username: string) {
  const u = await createUser({ username, displayName: username });
  return { ...u, s: await login(server, u.email) };
}

const createConv = (s: Session, body: object, key: string = randomUUID()) =>
  api().post('/api/v1/conversations').set(bearer(s)).set('Idempotency-Key', key).send(body);

async function createGroup(owner: Session, memberIds: string[], title = 'Dự án') {
  const res = await createConv(owner, { type: 'GROUP', title, memberIds });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as CreateConversationResponse).conversation;
}

const getConv = (s: Session, id: string) => api().get(`/api/v1/conversations/${id}`).set(bearer(s));
const patchMember = (s: Session, convId: string, userId: string, role: string) =>
  api().patch(`/api/v1/conversations/${convId}/members/${userId}`).set(bearer(s)).send({ role });
const removeMember = (s: Session, convId: string, userId: string) =>
  api().delete(`/api/v1/conversations/${convId}/members/${userId}`).set(bearer(s));
const addMembers = (s: Session, convId: string, userIds: string[]) =>
  api().post(`/api/v1/conversations/${convId}/members`).set(bearer(s)).send({ userIds });

const systemKinds = (convId: string) => testDb.systemMessages(convId);

/** Thêm thẳng thành viên MEMBER vào DB để dựng nhóm lớn. */
async function fillGroup(convId: string, total: number) {
  const conv = await ConversationModel.findById(convId).lean<{ memberCount: number }>();
  const missing = total - (conv?.memberCount ?? 0);
  const users = await createUsers(missing);
  await ConversationMemberModel.insertMany(users.map((u) => ({ conversationId: convId, userId: u.id })));
  await ConversationModel.updateOne({ _id: convId }, { $set: { memberCount: total } });
  return users;
}

async function socketOf(s: Session) {
  const sock = await connectAs(server.url, { token: s.accessToken, deviceId: s.deviceId });
  sockets.push(sock);
  return sock;
}

describe('POST /conversations DIRECT (FR-CHAT-001)', () => {
  it('TC-AC-017 alice và bob đồng thời tạo DIRECT cho nhau → cùng conversationId, một 201 một 200, DB 1 DIRECT', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const [a, b] = await Promise.all([
      createConv(alice.s, { type: 'DIRECT', memberIds: [bob.id] }),
      createConv(bob.s, { type: 'DIRECT', memberIds: [alice.id] }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const idA = (a.body as CreateConversationResponse).conversation.id;
    expect((b.body as CreateConversationResponse).conversation.id).toBe(idA);
    expect(await ConversationModel.countDocuments({ type: 'DIRECT' })).toBe(1);
    expect(await ConversationMemberModel.countDocuments({ conversationId: idA })).toBe(2);
    expect(await testDb.countMessages(idA)).toBe(0);
  });

  it('với chính mình → 400; user không tồn tại hoặc LOCKED → 404; thiếu Idempotency-Key → 400', async () => {
    const alice = await userWithSession('alice');
    expect((await createConv(alice.s, { type: 'DIRECT', memberIds: [alice.id] })).status).toBe(400);
    const ghost = await createConv(alice.s, { type: 'DIRECT', memberIds: ['6720a1b2c3d4e5f601234599'] });
    expect(ghost.status).toBe(404);
    const noKey = await api()
      .post('/api/v1/conversations')
      .set(bearer(alice.s))
      .send({ type: 'DIRECT', memberIds: ['6720a1b2c3d4e5f601234599'] });
    expect(noKey.status).toBe(400);
  });

  it('bị chặn khi chưa có DIRECT → 403 USER_BLOCKED; DIRECT đã có → trả về với canMessage: false', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const carol = await userWithSession('carol');
    await api().post(`/api/v1/users/${alice.id}/block`).set(bearer(bob.s));
    const blocked = await createConv(alice.s, { type: 'DIRECT', memberIds: [bob.id] });
    expect(blocked.status).toBe(403);
    expect(errorOf(blocked).code).toBe('USER_BLOCKED');

    const first = await createConv(alice.s, { type: 'DIRECT', memberIds: [carol.id] });
    await api().post(`/api/v1/users/${carol.id}/block`).set(bearer(alice.s));
    const again = await createConv(alice.s, { type: 'DIRECT', memberIds: [carol.id] });
    expect(again.status).toBe(200);
    const conv = (again.body as CreateConversationResponse).conversation;
    expect(conv.id).toBe((first.body as CreateConversationResponse).conversation.id);
    expect(conv).toMatchObject({ blockedByMe: true, canMessage: false });
  });

  it('SECRET trước M7 → 422 E2EE_KEYS_UNAVAILABLE', async () => {
    const alice = await userWithSession('alice');
    const bob = await createUser({ username: 'bob' });
    const res = await createConv(alice.s, { type: 'SECRET', memberIds: [bob.id] });
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('E2EE_KEYS_UNAVAILABLE');
  });

  it('TC-DB-008 getOrCreatePair song song 20 lần cùng cặp → 1 conversation, 2 member, đúng 1 created', async () => {
    const a = await createUser();
    const b = await createUser();
    const svc = server.runtime.conversations;
    const results = await Promise.all(Array.from({ length: 20 }, () => svc.getOrCreatePair('DIRECT', a.id, b.id)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await ConversationModel.countDocuments({})).toBe(1);
    expect(await ConversationMemberModel.countDocuments({})).toBe(2);
  });
});

describe('POST /conversations GROUP (FR-GROUP-001)', () => {
  it('TC-AC-050 tạo nhóm [bob, carol, bob] → 201, OWNER/MEMBER, SYSTEM GROUP_CREATED + MEMBER_ADDED, bob/carol nhận conversation:updated CREATED', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const carol = await createUser({ username: 'carol' });
    const bobSock = await socketOf(bob.s);
    const updated = waitFor<{ change: string; conversation: Conversation }>(bobSock, EVENTS.CONVERSATION_UPDATED);

    const res = await createConv(alice.s, { type: 'GROUP', title: '  Dự án ', memberIds: [bob.id, carol.id, bob.id] });
    expect(res.status).toBe(201);
    const { conversation: conv, skipped } = res.body as CreateConversationResponse;
    expect(skipped).toEqual([]);
    expect(conv).toMatchObject({ type: 'GROUP', title: 'Dự án', memberCount: 3, createdBy: alice.id });
    const roles = Object.fromEntries(conv.members.map((m) => [m.userId, m.role]));
    expect(roles).toEqual({ [alice.id]: 'OWNER', [bob.id]: 'MEMBER', [carol.id]: 'MEMBER' });

    const sys = await systemKinds(conv.id);
    expect(sys.map((x) => x?.kind)).toEqual(['GROUP_CREATED', 'MEMBER_ADDED']);
    expect(sys[1]?.targetUserIds.map(String)).toEqual([bob.id, carol.id]);
    expect(sys.every((x) => String(x?.actorId) === alice.id)).toBe(true);

    const ev = await updated;
    expect(ev.change).toBe('CREATED');
    expect(ev.conversation.id).toBe(conv.id);
  });

  it('cùng Idempotency-Key → 200 trả lại nhóm đã tạo, không tạo thêm', async () => {
    const alice = await userWithSession('alice');
    const bob = await createUser();
    const key = randomUUID();
    const body = { type: 'GROUP', title: 'G', memberIds: [bob.id] };
    const first = await createConv(alice.s, body, key);
    await server.redis.client.flushdb(); // mất fast path Redis → vẫn idempotent nhờ unique index DB
    const second = await createConv(alice.s, body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((second.body as CreateConversationResponse).conversation.id).toBe(
      (first.body as CreateConversationResponse).conversation.id,
    );
    expect(await ConversationModel.countDocuments({ type: 'GROUP' })).toBe(1);
  });

  it('TC-GROUP-003 người đã chặn người tạo / không tồn tại bị bỏ qua trong skipped; không còn ai → 400', async () => {
    const alice = await userWithSession('alice');
    const dave = await userWithSession('dave');
    const bob = await createUser();
    await api().post(`/api/v1/users/${alice.id}/block`).set(bearer(dave.s));
    const ghost = '6720a1b2c3d4e5f601234599';
    const res = await createConv(alice.s, { type: 'GROUP', title: 'G', memberIds: [bob.id, dave.id, ghost] });
    expect(res.status).toBe(201);
    expect((res.body as CreateConversationResponse).skipped).toEqual([
      { userId: dave.id, code: 'USER_BLOCKED' },
      { userId: ghost, code: 'NOT_FOUND' },
    ]);
    const none = await createConv(alice.s, { type: 'GROUP', title: 'G', memberIds: [dave.id] });
    expect(none.status).toBe(400);
  });
});

describe('Thành viên nhóm (FR-GROUP-002..006)', () => {
  it('TC-AC-051 TC-GROUP-001 nhóm 98 người, ADMIN thêm 3 → 422 CONVERSATION_FULL, không ai được thêm', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const conv = await createGroup(alice.s, [bob.id]);
    await patchMember(alice.s, conv.id, bob.id, 'ADMIN');
    await fillGroup(conv.id, 98);
    const extra = await createUsers(3);
    const res = await addMembers(
      bob.s,
      conv.id,
      extra.map((u) => u.id),
    );
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('CONVERSATION_FULL');
    expect((await ConversationModel.findById(conv.id).lean())?.memberCount).toBe(98);
    expect(await ConversationMemberModel.countDocuments({ conversationId: conv.id, leftAt: null })).toBe(98);
  });

  it('TC-AC-052 TC-GROUP-002 thêm [bob, dave, frank, frank] → added [frank], skipped bob CONFLICT, dave USER_BLOCKED', async () => {
    const alice = await userWithSession('alice');
    const bob = await createUser({ username: 'bob' });
    const dave = await userWithSession('dave');
    const frank = await createUser({ username: 'frank' });
    await api().post(`/api/v1/users/${alice.id}/block`).set(bearer(dave.s));
    const conv = await createGroup(alice.s, [bob.id]);
    const res = await addMembers(alice.s, conv.id, [bob.id, dave.id, frank.id, frank.id]);
    expect(res.status).toBe(200);
    const body = res.body as AddMembersResponse;
    expect(body.added.map((m) => m.userId)).toEqual([frank.id]);
    expect(body.skipped).toEqual([
      { userId: bob.id, code: 'CONFLICT' },
      { userId: dave.id, code: 'USER_BLOCKED' },
    ]);
    const sys = await systemKinds(conv.id);
    expect(sys.at(-1)).toMatchObject({ kind: 'MEMBER_ADDED' });
    expect(sys.at(-1)?.targetUserIds.map(String)).toEqual([frank.id]);
  });

  it('MEMBER thêm thành viên → 403 FORBIDDEN; người được thêm lại sau khi rời thấy lại nhóm', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const carol = await createUser();
    const conv = await createGroup(alice.s, [bob.id]);
    expect((await addMembers(bob.s, conv.id, [carol.id])).status).toBe(403);
    expect((await removeMember(bob.s, conv.id, bob.id)).status).toBe(204);
    expect((await getConv(bob.s, conv.id)).status).toBe(403);
    expect((await addMembers(alice.s, conv.id, [bob.id])).status).toBe(200);
    expect((await getConv(bob.s, conv.id)).status).toBe(200);
  });

  it('TC-AC-053 TC-GROUP-004 OWNER rời khi còn thành viên → 409 "Bạn cần chuyển quyền trưởng nhóm trước khi rời nhóm"', async () => {
    const alice = await userWithSession('alice');
    const bob = await createUser();
    const carol = await createUser();
    const conv = await createGroup(alice.s, [bob.id, carol.id]);
    const res = await removeMember(alice.s, conv.id, alice.id);
    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'CONFLICT',
      message: 'Bạn cần chuyển quyền trưởng nhóm trước khi rời nhóm',
    });
    const owner = await ConversationMemberModel.findOne({ conversationId: conv.id, userId: alice.id }).lean();
    expect(owner?.role).toBe('OWNER');
  });

  it('TC-AC-054 chuyển OWNER cho bob rồi rời → bob OWNER, SYSTEM OWNER_TRANSFERRED + MEMBER_LEFT, member-removed LEFT', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const carol = await createUser();
    const conv = await createGroup(alice.s, [bob.id, carol.id]);
    const bobSock = await socketOf(bob.s);

    const transfer = await patchMember(alice.s, conv.id, bob.id, 'OWNER');
    expect(transfer.status).toBe(200);
    const roles = Object.fromEntries((transfer.body as Conversation).members.map((m) => [m.userId, m.role]));
    expect(roles[bob.id]).toBe('OWNER');
    expect(roles[alice.id]).toBe('ADMIN');

    const removed = waitFor<{ userId: string; reason: string; removedBy: string }>(
      bobSock,
      EVENTS.CONVERSATION_MEMBER_REMOVED,
    );
    expect((await removeMember(alice.s, conv.id, alice.id)).status).toBe(204);
    expect(await removed).toMatchObject({ userId: alice.id, reason: 'LEFT', removedBy: alice.id });
    const sys = (await systemKinds(conv.id)).slice(-2);
    expect(sys.map((x) => x?.kind)).toEqual(['OWNER_TRANSFERRED', 'MEMBER_LEFT']);
    expect(sys[0]?.targetUserIds.map(String)).toEqual([bob.id]);
    expect((await ConversationModel.findById(conv.id).lean())?.memberCount).toBe(2);
  });

  it('OWNER là thành viên duy nhất rời → hội thoại bị soft delete, biến khỏi danh sách', async () => {
    const alice = await userWithSession('alice');
    const bob = await createUser();
    const conv = await createGroup(alice.s, [bob.id]);
    await removeMember(alice.s, conv.id, bob.id);
    expect((await removeMember(alice.s, conv.id, alice.id)).status).toBe(204);
    expect((await ConversationModel.findById(conv.id).lean())?.deletedAt).not.toBeNull();
    const list = await api().get('/api/v1/conversations').set(bearer(alice.s));
    expect((list.body as ConversationPage).items).toEqual([]);
  });

  it('TC-AC-055 TC-GROUP-005 ADMIN xóa OWNER, hạ quyền OWNER, xóa ADMIN khác → cả ba 403', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const dan = await createUser();
    const conv = await createGroup(alice.s, [bob.id, dan.id]);
    await patchMember(alice.s, conv.id, bob.id, 'ADMIN');
    await patchMember(alice.s, conv.id, dan.id, 'ADMIN');
    for (const res of [
      await removeMember(bob.s, conv.id, alice.id),
      await patchMember(bob.s, conv.id, alice.id, 'MEMBER'),
      await removeMember(bob.s, conv.id, dan.id),
    ]) {
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
    }
  });

  it('TC-AC-059 OWNER đặt carol ADMIN rồi MEMBER → 200 + ROLE_CHANGED kèm role; ADMIN làm tương tự → 403', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const carol = await createUser();
    const conv = await createGroup(alice.s, [bob.id, carol.id]);
    await patchMember(alice.s, conv.id, bob.id, 'ADMIN');
    expect((await patchMember(alice.s, conv.id, carol.id, 'ADMIN')).status).toBe(200);
    expect((await patchMember(alice.s, conv.id, carol.id, 'MEMBER')).status).toBe(200);
    const roleMsgs = (await systemKinds(conv.id)).filter((x) => x?.kind === 'ROLE_CHANGED').slice(-2);
    expect(roleMsgs.map((x) => x?.role)).toEqual(['ADMIN', 'MEMBER']);
    expect((await patchMember(bob.s, conv.id, carol.id, 'ADMIN')).status).toBe(403);
    // Role không đổi → 200 không SYSTEM; OWNER tự đổi role → 400
    const before = (await systemKinds(conv.id)).length;
    expect((await patchMember(alice.s, conv.id, carol.id, 'MEMBER')).status).toBe(200);
    expect((await systemKinds(conv.id)).length).toBe(before);
    expect((await patchMember(alice.s, conv.id, alice.id, 'ADMIN')).status).toBe(400);
  });

  it('TC-AC-056 đổi tên: 101 ký tự → 400; "Nhóm mới" → 200 + SYSTEM + conversation:updated TITLE; MEMBER → 403; tên cũ → 200 không SYSTEM', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const carol = await userWithSession('carol');
    const conv = await createGroup(alice.s, [bob.id, carol.id]);
    await patchMember(alice.s, conv.id, bob.id, 'ADMIN');
    const carolSock = await socketOf(carol.s);
    const rename = (s: Session, title: string) =>
      api().patch(`/api/v1/conversations/${conv.id}`).set(bearer(s)).send({ title });

    expect((await rename(bob.s, 'a'.repeat(101))).status).toBe(400);
    const updated = waitFor<{ change: string; conversation: Conversation }>(carolSock, EVENTS.CONVERSATION_UPDATED);
    const ok = await rename(bob.s, 'Nhóm mới');
    expect(ok.status).toBe(200);
    expect((ok.body as Conversation).title).toBe('Nhóm mới');
    expect(await updated).toMatchObject({ change: 'TITLE', conversation: { title: 'Nhóm mới' } });
    expect((await systemKinds(conv.id)).at(-1)).toMatchObject({ kind: 'TITLE_CHANGED', title: 'Nhóm mới' });
    expect((await rename(carol.s, 'X')).status).toBe(403);
    const count = (await systemKinds(conv.id)).length;
    expect((await rename(bob.s, 'Nhóm mới')).status).toBe(200);
    expect((await systemKinds(conv.id)).length).toBe(count);
  });

  it('đổi tên DIRECT → 400', async () => {
    const alice = await userWithSession('alice');
    const bob = await createUser();
    const res = await createConv(alice.s, { type: 'DIRECT', memberIds: [bob.id] });
    const id = (res.body as CreateConversationResponse).conversation.id;
    const r = await api().patch(`/api/v1/conversations/${id}`).set(bearer(alice.s)).send({ title: 'x' });
    expect(r.status).toBe(400);
  });

  it('TC-AC-058 TC-GROUP-006 nhóm 97 người, OWNER và ADMIN cùng lúc thêm 2 người khác nhau → đúng một thành công (99)', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const conv = await createGroup(alice.s, [bob.id]);
    await patchMember(alice.s, conv.id, bob.id, 'ADMIN');
    await fillGroup(conv.id, 97);
    const [x, y] = [await createUsers(2), await createUsers(2)];
    const results = await Promise.all([
      addMembers(
        alice.s,
        conv.id,
        x.map((u) => u.id),
      ),
      addMembers(
        bob.s,
        conv.id,
        y.map((u) => u.id),
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    const after = await ConversationModel.findById(conv.id).lean();
    expect(after?.memberCount).toBe(99);
    expect(await ConversationMemberModel.countDocuments({ conversationId: conv.id, leftAt: null })).toBe(99);
  });

  it('TC-DB-012 transferOwner và hai addMembers song song ở 97 thành viên → đúng 1 OWNER, memberCount khớp và ≤ 100', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const conv = await createGroup(alice.s, [bob.id]);
    await patchMember(alice.s, conv.id, bob.id, 'ADMIN');
    await fillGroup(conv.id, 97);
    const [x, y] = [await createUsers(2), await createUsers(2)];
    await Promise.all([
      patchMember(alice.s, conv.id, bob.id, 'OWNER'),
      addMembers(
        alice.s,
        conv.id,
        x.map((u) => u.id),
      ),
      addMembers(
        bob.s,
        conv.id,
        y.map((u) => u.id),
      ),
    ]);
    const active = await ConversationMemberModel.find({ conversationId: conv.id, leftAt: null }).lean<
      { role: string }[]
    >();
    expect(active.filter((m) => m.role === 'OWNER')).toHaveLength(1);
    const after = await ConversationModel.findById(conv.id).lean();
    expect(after?.memberCount).toBe(active.length);
    expect(active.length).toBeLessThanOrEqual(100);
  });

  it('xóa thành viên → member-removed tới người bị xóa và người còn lại; người bị xóa nhận 403 NOT_A_MEMBER, socket rời room', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const carol = await userWithSession('carol');
    const conv = await createGroup(alice.s, [bob.id, carol.id]);
    const [bobSock, carolSock] = [await socketOf(bob.s), await socketOf(carol.s)];
    const join = (await carolSock.timeout(5000).emitWithAck(EVENTS.CONVERSATION_JOIN, {
      requestId: randomUUID(),
      payload: { conversationId: conv.id },
    })) as unknown;
    expect(join).toMatchObject({
      ok: true,
      data: { conversation: { id: conv.id }, unreadCount: 0, typingUserIds: [] },
    });

    const toCarol = waitFor(carolSock, EVENTS.CONVERSATION_MEMBER_REMOVED);
    const toBob = waitFor(bobSock, EVENTS.CONVERSATION_MEMBER_REMOVED);
    expect((await removeMember(alice.s, conv.id, carol.id)).status).toBe(204);
    expect(await toCarol).toMatchObject({ userId: carol.id, reason: 'REMOVED', removedBy: alice.id });
    expect(await toBob).toMatchObject({ userId: carol.id, reason: 'REMOVED' });

    const get = await getConv(carol.s, conv.id);
    expect(get.status).toBe(403);
    expect(errorOf(get).code).toBe('NOT_A_MEMBER');
    const rooms = await server.runtime.io.in(`conv:${conv.id}`).fetchSockets();
    expect(rooms.map((s) => s.data.auth?.userId)).not.toContain(carol.id);
    const rejoin = (await carolSock.timeout(5000).emitWithAck(EVENTS.CONVERSATION_JOIN, {
      requestId: randomUUID(),
      payload: { conversationId: conv.id },
    })) as unknown;
    expect(rejoin).toMatchObject({ ok: false, error: { code: 'NOT_A_MEMBER' } });
    expect((await systemKinds(conv.id)).at(-1)).toMatchObject({ kind: 'MEMBER_REMOVED' });
  });
});

describe('GET /conversations, GET /conversations/{id} (FR-CHAT-009, FR-SEC-008)', () => {
  it('TC-AC-103 TC-SEC-001 người chưa từng là thành viên: hội thoại có thật và id ngẫu nhiên → 404 giống hệt', async () => {
    const alice = await userWithSession('alice');
    const bob = await createUser();
    const carol = await userWithSession('carol');
    const conv = await createGroup(alice.s, [bob.id]);
    const real = await getConv(carol.s, conv.id);
    const fake = await getConv(carol.s, '6720a1b2c3d4e5f601234598');
    expect(real.status).toBe(404);
    expect(fake.status).toBe(404);
    const strip = (b: unknown) => ({ ...(b as ErrorResponse).error, requestId: undefined });
    expect(strip(real.body)).toEqual(strip(fake.body));
    const join = (await (await socketOf(carol.s)).timeout(5000).emitWithAck(EVENTS.CONVERSATION_JOIN, {
      requestId: randomUUID(),
      payload: { conversationId: conv.id },
    })) as unknown;
    expect(join).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('danh sách: sắp theo lastMessageAt giảm dần, cursor phân trang, DIRECT chỉ hiện với người tạo khi chưa có tin, preview SYSTEM kèm tên', async () => {
    const alice = await userWithSession('alice');
    const bob = await userWithSession('bob');
    const carol = await createUser({ username: 'carol', displayName: 'Carol Lê' });
    const direct = await createConv(alice.s, { type: 'DIRECT', memberIds: [bob.id] });
    const directId = (direct.body as CreateConversationResponse).conversation.id;
    const g1 = await createGroup(alice.s, [bob.id, carol.id], 'Nhóm 1');
    const g2 = await createGroup(alice.s, [bob.id], 'Nhóm 2');

    const page1 = await api().get('/api/v1/conversations').query({ limit: 2 }).set(bearer(alice.s));
    expect(page1.status).toBe(200);
    const p1 = page1.body as ConversationPage;
    expect(p1.items.map((c) => c.id)).toEqual([g2.id, g1.id]);
    expect(p1.nextCursor).not.toBeNull();
    const page2 = await api()
      .get('/api/v1/conversations')
      .query({ limit: 2, cursor: p1.nextCursor })
      .set(bearer(alice.s));
    const p2 = page2.body as ConversationPage;
    expect(p2.items.map((c) => c.id)).toEqual([directId]);
    expect(p2.nextCursor).toBeNull();
    expect(p2.items[0]).toMatchObject({ type: 'DIRECT', peer: { id: bob.id }, lastMessage: null, canMessage: true });

    const bobList = (await api().get('/api/v1/conversations').set(bearer(bob.s))).body as ConversationPage;
    expect(bobList.items.map((c) => c.id)).toEqual([g2.id, g1.id]);
    const g1Summary = bobList.items[1];
    expect(g1Summary).toMatchObject({ title: 'Nhóm 1', memberCount: 3, unreadCount: 0 });
    expect(g1Summary?.lastMessage).toMatchObject({
      type: 'SYSTEM',
      sender: { id: alice.id, displayName: 'alice' },
      preview: null,
      system: {
        kind: 'MEMBER_ADDED',
        actor: { id: alice.id, displayName: 'alice' },
        targets: [
          { id: bob.id, displayName: 'bob' },
          { id: carol.id, displayName: 'Carol Lê' },
        ],
        targetCount: 2,
      },
    });
  });

  it('cursor không hợp lệ → 400; limit > 50 → 400', async () => {
    const alice = await userWithSession('alice');
    expect((await api().get('/api/v1/conversations').query({ cursor: 'xx' }).set(bearer(alice.s))).status).toBe(400);
    expect((await api().get('/api/v1/conversations').query({ limit: 51 }).set(bearer(alice.s))).status).toBe(400);
  });
});
