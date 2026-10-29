// server/src/modules/conversations/conversations.service.ts — FR-CHAT-001, FR-CHAT-009, FR-GROUP-001..006, FR-SEC-008
// (AUTHZ-2). Ghi trong transaction, phát event realtime SAU commit. Gọi users/messages chỉ qua service (kiến trúc §5.2).
import {
  ConversationChange,
  EVENTS,
  GROUP_MAX_MEMBERS,
  SYSTEM_PREVIEW_TARGETS_MAX,
  decodeCursor,
  encodeCursor,
} from '@hustalo/shared';
import type {
  Conversation,
  ConversationPage,
  ConversationSummary,
  LastMessagePreview,
  Member,
  MemberRole,
  SkippedMember,
  SystemPreview,
  UserPublic,
} from '@hustalo/shared';
import { Types, type ClientSession } from 'mongoose';
import { AppError } from '../../http/errors/app-error';
import { withTxn } from '../../infra/db/transaction';
import type { RedisHandle } from '../../infra/redis/redis';
import { keys } from '../../infra/redis/keys';
import type { Emitter } from '../../realtime/emitter';
import { convRoom, userRoom } from '../../realtime/rooms';
import type { MessagePreviewRecord, MessagesService, SystemInput } from '../messages/messages.service';
import type { UsersService } from '../users/users.service';
import { directKeyOf } from './conversation.model';
import {
  conversationsRepository as repo,
  type ConversationRecord,
  type MemberRecord,
} from './conversations.repository';

const IDEMPOTENCY_TTL_S = 24 * 60 * 60; // FR-GROUP-001: cùng Idempotency-Key trong 24 h

const MSG = {
  notFound: 'Không tìm thấy cuộc trò chuyện',
  notMember: 'Bạn không còn là thành viên của cuộc trò chuyện này',
  forbidden: 'Bạn không có quyền thực hiện thao tác này',
  full: `Nhóm đã đạt tối đa ${GROUP_MAX_MEMBERS} thành viên`,
  ownerMustTransfer: 'Bạn cần chuyển quyền trưởng nhóm trước khi rời nhóm',
  targetNotMember: 'Người này không còn trong nhóm',
  groupOnly: 'Thao tác chỉ áp dụng cho nhóm',
} as const;

const isDuplicateKey = (err: unknown, index?: string): boolean =>
  err instanceof Error && 'code' in err && err.code === 11000 && (index === undefined || err.message.includes(index));

const dedupe = (ids: string[]) => [...new Set(ids)];

export interface ConversationsDeps {
  emitter: Emitter;
  users: Pick<UsersService, 'getPublicMany' | 'isBlockedEitherWay' | 'blockedByMeAmong' | 'blockersOf'>;
  messages: Pick<MessagesService, 'createSystemMessage' | 'previewsFor'>;
  redis: RedisHandle;
}

export function createConversationsService(deps: ConversationsDeps) {
  const { emitter, users, messages, redis } = deps;

  /** AUTHZ-2: chưa từng là thành viên hoặc không tồn tại → NOT_FOUND (giống hệt nhau); đã rời → NOT_A_MEMBER. */
  async function assertMember(conversationId: string, userId: string) {
    const [conv, member] = await Promise.all([
      Types.ObjectId.isValid(conversationId) ? repo.findById(conversationId) : null,
      Types.ObjectId.isValid(conversationId) ? repo.findMember(conversationId, userId) : null,
    ]);
    if (!conv || conv.deletedAt || !member) throw new AppError('NOT_FOUND', MSG.notFound);
    if (member.leftAt) throw new AppError('NOT_A_MEMBER', MSG.notMember);
    return { conv, member };
  }

  const assertGroup = (conv: ConversationRecord) => {
    if (conv.type !== 'GROUP') throw new AppError('VALIDATION_ERROR', MSG.groupOnly);
  };

  /** Tạo SYSTEM và đặt nó làm tin cuối, trong transaction của người gọi. */
  async function addSystem(conversationId: Types.ObjectId, input: SystemInput, session: ClientSession) {
    const msg = await messages.createSystemMessage(String(conversationId), input, session);
    await repo.setLastMessage(
      conversationId,
      { messageId: msg.id, senderId: msg.senderId, type: 'SYSTEM', createdAt: msg.createdAt },
      session,
    );
  }

  const toMember = (m: MemberRecord, user: UserPublic): Member => ({
    userId: String(m.userId),
    user,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    lastDeliveredMessageId: m.lastDeliveredMessageId ? String(m.lastDeliveredMessageId) : null,
    lastReadMessageId: m.lastReadMessageId ? String(m.lastReadMessageId) : null,
  });

  /** DTO `Conversation` theo góc nhìn `viewerId` (blockedByMe/canMessage chỉ có nghĩa với DIRECT/SECRET). */
  async function toDTO(conv: ConversationRecord, viewerId: string): Promise<Conversation> {
    const members = await repo.activeMembers(conv._id);
    const profiles = await users.getPublicMany(members.map((m) => String(m.userId)));
    let blockedByMe = false;
    let canMessage = true;
    if (conv.type !== 'GROUP') {
      const peer = members.find((m) => String(m.userId) !== viewerId);
      if (peer) {
        const peerId = String(peer.userId);
        const [mine, either] = await Promise.all([
          users.blockedByMeAmong(viewerId, [peerId]),
          users.isBlockedEitherWay(viewerId, peerId),
        ]);
        blockedByMe = mine.length > 0;
        canMessage = !either;
      }
    }
    return {
      id: String(conv._id),
      type: conv.type,
      title: conv.title,
      createdBy: String(conv.createdBy),
      memberCount: conv.memberCount,
      members: members.flatMap((m) => {
        const p = profiles.get(String(m.userId));
        return p ? [toMember(m, p.user)] : [];
      }),
      lastMessageAt: conv.lastMessageAt.toISOString(),
      blockedByMe,
      canMessage,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
    };
  }

  async function reload(conversationId: Types.ObjectId): Promise<ConversationRecord> {
    const conv = await repo.findById(conversationId);
    if (!conv) throw new AppError('NOT_FOUND', MSG.notFound);
    return conv;
  }

  /** Event cập nhật hội thoại tới user room của mọi thành viên hiện tại (GROUP: DTO không phụ thuộc người xem). */
  async function emitUpdated(conversationId: Types.ObjectId, change: ConversationChange, actorId: string) {
    const dto = await toDTO(await reload(conversationId), actorId);
    emitter.toRooms(
      dto.members.map((m) => userRoom(m.userId)),
      EVENTS.CONVERSATION_UPDATED,
      { conversation: dto, change },
    );
    return dto;
  }

  /** Phân loại ứng viên thêm vào nhóm theo thứ tự đầu vào (FR-GROUP-001/002). */
  async function classify(actorId: string, candidates: string[], activeIds: Set<string>) {
    const pending = candidates.filter((id) => !activeIds.has(id));
    const [profiles, blockers] = await Promise.all([users.getPublicMany(pending), users.blockersOf(actorId, pending)]);
    const blockerSet = new Set(blockers);
    const toAdd: string[] = [];
    const skipped: SkippedMember[] = [];
    for (const id of candidates) {
      if (activeIds.has(id)) skipped.push({ userId: id, code: 'CONFLICT' });
      else if (!profiles.get(id)?.active) skipped.push({ userId: id, code: 'NOT_FOUND' });
      else if (blockerSet.has(id)) skipped.push({ userId: id, code: 'USER_BLOCKED' });
      else toAdd.push(id);
    }
    return { toAdd, skipped };
  }

  // ---- preview SYSTEM cho danh sách (api_spec SystemPreview) ----
  function systemPreview(msg: MessagePreviewRecord, names: Map<string, { user: UserPublic }>): SystemPreview | null {
    const sys = msg.system;
    if (!sys) return null;
    const ref = (id: Types.ObjectId) => ({
      id: String(id),
      displayName: names.get(String(id))?.user.displayName ?? '',
    });
    return {
      kind: sys.kind,
      actor: ref(sys.actorId),
      targets: sys.targetUserIds.slice(0, SYSTEM_PREVIEW_TARGETS_MAX).map(ref),
      targetCount: sys.targetUserIds.length,
      title: sys.title,
      role: sys.role,
      callType: sys.callType,
      durationSec: sys.durationSec,
    };
  }

  /** DB §4.3: DIRECT/SECRET duy nhất theo cặp, an toàn khi đua (D-11). */
  async function getOrCreatePair(type: 'DIRECT' | 'SECRET', me: string, other: string) {
    const directKey = directKeyOf(me, other);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await withTxn(async (session) => {
          const { conv, created } = await repo.upsertPair(type, directKey, me, session);
          if (created) {
            await repo.insertMembers(
              conv._id,
              [
                { userId: me, role: 'MEMBER', addedBy: null },
                { userId: other, role: 'MEMBER', addedBy: null },
              ],
              session,
            );
          }
          return { id: String(conv._id), created };
        });
      } catch (err) {
        // Hai upsert đồng thời: một bên E11000 trên type_directKey_unique → thử lại sẽ tìm thấy bản đã có.
        if (isDuplicateKey(err) && attempt < 2) continue;
        throw err;
      }
    }
  }

  return {
    assertMember,

    getOrCreatePair,

    /** FR-CHAT-001 (DIRECT) và SECRET (M2: luôn 422 E2EE_KEYS_UNAVAILABLE vì chưa có khóa nào — M7). */
    async createPair(type: 'DIRECT' | 'SECRET', me: string, otherId: string) {
      if (otherId === me) throw new AppError('VALIDATION_ERROR', 'Không thể tạo cuộc trò chuyện với chính mình');
      const other = (await users.getPublicMany([otherId])).get(otherId);
      if (!other?.active) throw new AppError('NOT_FOUND', 'Không tìm thấy người dùng');
      if (type === 'SECRET') {
        throw new AppError('E2EE_KEYS_UNAVAILABLE', 'Người nhận chưa bật trò chuyện bí mật');
      }
      const existing = await repo.findByDirectKey(type, directKeyOf(me, otherId));
      if (!existing && (await users.isBlockedEitherWay(me, otherId))) {
        throw new AppError('USER_BLOCKED', 'Không thể tạo cuộc trò chuyện với người này');
      }
      const { id, created } = existing
        ? { id: String(existing._id), created: false }
        : await getOrCreatePair(type, me, otherId);
      return { conversation: await toDTO(await reload(new Types.ObjectId(id)), me), skipped: [], created };
    },

    /** FR-GROUP-001: OWNER là người tạo; idempotent theo Idempotency-Key (Redis fast path + unique index DB). */
    async createGroup(me: string, input: { title: string; memberIds: string[] }, idempotencyKey: string) {
      const replay = async () => {
        const cachedId = await redis.client.get(keys.idemConversation(me, idempotencyKey)).catch(() => null);
        const conv =
          (cachedId ? await repo.findById(cachedId) : null) ?? (await repo.findByIdempotencyKey(me, idempotencyKey));
        return conv ? { conversation: await toDTO(conv, me), skipped: [], created: false } : null;
      };
      const previous = await replay();
      if (previous) return previous;

      const { toAdd, skipped } = await classify(
        me,
        dedupe(input.memberIds).filter((id) => id !== me),
        new Set(),
      );
      if (toAdd.length === 0) throw new AppError('VALIDATION_ERROR', 'Cần ít nhất một thành viên hợp lệ');
      if (toAdd.length + 1 > GROUP_MAX_MEMBERS) throw new AppError('CONVERSATION_FULL', MSG.full);

      let convId: Types.ObjectId;
      try {
        convId = await withTxn(async (session) => {
          const id = await repo.createGroup(
            { title: input.title, createdBy: me, idempotencyKey, memberCount: toAdd.length + 1 },
            session,
          );
          await repo.insertMembers(
            id,
            [
              { userId: me, role: 'OWNER', addedBy: null },
              ...toAdd.map((userId) => ({ userId, role: 'MEMBER' as const, addedBy: me })),
            ],
            session,
          );
          await addSystem(id, { kind: 'GROUP_CREATED', actorId: me }, session);
          await addSystem(id, { kind: 'MEMBER_ADDED', actorId: me, targetUserIds: toAdd }, session);
          return id;
        });
      } catch (err) {
        if (isDuplicateKey(err, 'creator_idem_unique')) {
          const again = await replay();
          if (again) return again;
        }
        throw err;
      }
      await redis.client
        .set(keys.idemConversation(me, idempotencyKey), String(convId), 'EX', IDEMPOTENCY_TTL_S, 'NX')
        .catch(() => undefined); // chỉ là fast path; DB unique index là nguồn sự thật
      const conversation = await emitUpdated(convId, ConversationChange.CREATED, me);
      return { conversation, skipped, created: true };
    },

    async get(me: string, conversationId: string): Promise<Conversation> {
      const { conv } = await assertMember(conversationId, me);
      return toDTO(conv, me);
    },

    /** Socket join hội thoại: AUTHZ-2; số chưa đọc (M3) và typing (M4) chưa có → 0 / []. */
    async join(me: string, conversationId: string) {
      const { conv } = await assertMember(conversationId, me);
      return { conversation: await toDTO(conv, me), unreadCount: 0, typingUserIds: [] as string[] };
    },

    /** FR-CHAT-009 (DB §4.1). `unreadCount` thật ở M3. */
    async list(me: string, query: { cursor?: string | undefined; limit: number }): Promise<ConversationPage> {
      let cursor: { at: Date; id: Types.ObjectId } | null = null;
      if (query.cursor) {
        try {
          const c = decodeCursor(query.cursor);
          cursor = { at: new Date(c.createdAt), id: new Types.ObjectId(c.id) };
        } catch {
          throw new AppError('VALIDATION_ERROR', 'Cursor không hợp lệ');
        }
      }
      const memberships = await repo.activeMembershipsOf(me);
      const byConv = new Map(memberships.map((m) => [String(m.conversationId), m]));
      const rows = await repo.page(
        me,
        memberships.map((m) => m.conversationId),
        cursor,
        query.limit,
      );
      const page = rows.slice(0, query.limit);

      const pairIds = page.filter((c) => c.type !== 'GROUP').map((c) => c._id);
      const [peers, previews] = await Promise.all([
        repo.otherMembers(pairIds, me),
        messages.previewsFor(page.flatMap((c) => (c.lastMessage ? [c.lastMessage.messageId] : []))),
      ]);
      const peerOf = new Map(peers.map((p) => [String(p.conversationId), String(p.userId)]));
      const peerIds = [...new Set(peerOf.values())];
      const nameIds = [...previews.values()].flatMap((m) => [
        String(m.senderId),
        ...(m.system
          ? [m.system.actorId, ...m.system.targetUserIds.slice(0, SYSTEM_PREVIEW_TARGETS_MAX)].map(String)
          : []),
      ]);
      const [profiles, blockedByMe, blockers] = await Promise.all([
        users.getPublicMany([...peerIds, ...nameIds]),
        users.blockedByMeAmong(me, peerIds),
        users.blockersOf(me, peerIds),
      ]);
      const mine = new Set(blockedByMe);
      const theirs = new Set(blockers);

      const items: ConversationSummary[] = page.map((c) => {
        const id = String(c._id);
        const membership = byConv.get(id);
        const peerId = peerOf.get(id);
        const peer = peerId ? profiles.get(peerId)?.user : undefined;
        const msg = c.lastMessage ? previews.get(String(c.lastMessage.messageId)) : undefined;
        const lastMessage: LastMessagePreview | null = msg
          ? {
              id: String(msg._id),
              senderId: String(msg.senderId),
              sender: {
                id: String(msg.senderId),
                displayName: profiles.get(String(msg.senderId))?.user.displayName ?? '',
              },
              type: msg.type,
              preview: null, // TEXT (giải mã) ở M3; SYSTEM: client dựng từ `system`
              system: systemPreview(msg, profiles),
              createdAt: msg.createdAt.toISOString(),
              deletedAt: msg.deletedAt ? msg.deletedAt.toISOString() : null,
            }
          : null;
        const blocked = peerId !== undefined && mine.has(peerId);
        return {
          id,
          type: c.type,
          title: c.title,
          avatarUrl: peer?.avatarUrl ?? null,
          ...(peer ? { peer } : {}),
          memberCount: c.memberCount,
          lastMessage,
          lastMessageAt: c.lastMessageAt.toISOString(),
          unreadCount: 0,
          myLastDeliveredMessageId: membership?.lastDeliveredMessageId
            ? String(membership.lastDeliveredMessageId)
            : null,
          myLastReadMessageId: membership?.lastReadMessageId ? String(membership.lastReadMessageId) : null,
          blockedByMe: blocked,
          canMessage: c.type === 'GROUP' || !(blocked || (peerId !== undefined && theirs.has(peerId))),
        };
      });

      const last = page.at(-1);
      const nextCursor =
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.lastMessageAt.toISOString(), id: String(last._id) })
          : null;
      return { items, nextCursor };
    },

    /** FR-GROUP-005. */
    async rename(me: string, conversationId: string, title: string): Promise<Conversation> {
      const { conv, member } = await assertMember(conversationId, me);
      assertGroup(conv);
      if (member.role === 'MEMBER') throw new AppError('FORBIDDEN', MSG.forbidden);
      if (conv.title === title) return toDTO(conv, me);
      await withTxn(async (session) => {
        await repo.setTitle(conv._id, title, session);
        await addSystem(conv._id, { kind: 'TITLE_CHANGED', actorId: me, title }, session);
      });
      return emitUpdated(conv._id, ConversationChange.TITLE, me);
    },

    /** FR-GROUP-002 (DB §4.7): tất cả hoặc không; tăng memberCount có điều kiện trong transaction. */
    async addMembers(me: string, conversationId: string, userIds: string[]) {
      const { conv } = await assertMember(conversationId, me);
      assertGroup(conv);
      const result = await withTxn(async (session) => {
        const actor = await repo.findMember(conv._id, me, session);
        if (!actor || actor.leftAt) throw new AppError('NOT_A_MEMBER', MSG.notMember);
        if (actor.role === 'MEMBER') throw new AppError('FORBIDDEN', MSG.forbidden);
        const active = await repo.activeMembers(conv._id, session);
        const { toAdd, skipped } = await classify(me, dedupe(userIds), new Set(active.map((m) => String(m.userId))));
        if (toAdd.length === 0) return { toAdd, skipped };
        if (!(await repo.incMemberCountIfRoom(conv._id, toAdd.length, session))) {
          throw new AppError('CONVERSATION_FULL', MSG.full);
        }
        await repo.upsertMembers(conv._id, toAdd, me, session);
        await addSystem(conv._id, { kind: 'MEMBER_ADDED', actorId: me, targetUserIds: toAdd }, session);
        return { toAdd, skipped };
      });
      if (result.toAdd.length === 0) return { added: [] as Member[], skipped: result.skipped };
      const dto = await emitUpdated(conv._id, ConversationChange.MEMBERS, me);
      const addedSet = new Set(result.toAdd);
      return { added: dto.members.filter((m) => addedSet.has(m.userId)), skipped: result.skipped };
    },

    /** FR-GROUP-003 (xóa người khác) và FR-GROUP-004 (tự rời). */
    async removeMember(me: string, conversationId: string, targetId: string): Promise<void> {
      const { conv } = await assertMember(conversationId, me);
      assertGroup(conv);
      const leaving = targetId === me;
      const outcome = await withTxn(async (session) => {
        const actor = await repo.findMember(conv._id, me, session);
        if (!actor || actor.leftAt) throw new AppError('NOT_A_MEMBER', MSG.notMember);
        if (leaving) {
          if (actor.role === 'OWNER') {
            const others = (await repo.activeMembers(conv._id, session)).filter((m) => String(m.userId) !== me);
            if (others.length > 0) throw new AppError('CONFLICT', MSG.ownerMustTransfer);
            // OWNER là thành viên duy nhất → soft delete, không còn hiển thị với ai (D-23).
            await repo.setLeft(conv._id, me, session);
            await repo.softDelete(conv._id, session);
            return 'DELETED' as const;
          }
        } else {
          if (actor.role === 'MEMBER') throw new AppError('FORBIDDEN', MSG.forbidden);
          const target = await repo.findMember(conv._id, targetId, session);
          if (!target || target.leftAt) throw new AppError('NOT_A_MEMBER', MSG.targetNotMember);
          if (target.role === 'OWNER' || (target.role === 'ADMIN' && actor.role !== 'OWNER')) {
            throw new AppError('FORBIDDEN', MSG.forbidden);
          }
        }
        if ((await repo.setLeft(conv._id, targetId, session)) === 0) {
          throw new AppError('NOT_A_MEMBER', MSG.targetNotMember);
        }
        await repo.decMemberCount(conv._id, session);
        await addSystem(
          conv._id,
          leaving
            ? { kind: 'MEMBER_LEFT', actorId: me }
            : { kind: 'MEMBER_REMOVED', actorId: me, targetUserIds: [targetId] },
          session,
        );
        return 'LEFT' as const;
      });

      const remaining = outcome === 'DELETED' ? [] : await repo.activeMembers(conv._id);
      emitter.leaveRoom(userRoom(targetId), convRoom(String(conv._id)));
      emitter.toRooms(
        [...remaining.map((m) => userRoom(String(m.userId))), userRoom(targetId)],
        EVENTS.CONVERSATION_MEMBER_REMOVED,
        { conversationId: String(conv._id), userId: targetId, removedBy: me, reason: leaving ? 'LEFT' : 'REMOVED' },
      );
    },

    /** FR-GROUP-006 (ADMIN/MEMBER) và FR-GROUP-004 (role OWNER = chuyển quyền, DB §4.9). */
    async changeRole(me: string, conversationId: string, targetId: string, role: MemberRole): Promise<Conversation> {
      const { conv, member } = await assertMember(conversationId, me);
      assertGroup(conv);
      if (member.role !== 'OWNER') throw new AppError('FORBIDDEN', MSG.forbidden);
      if (targetId === me) {
        throw new AppError('VALIDATION_ERROR', 'Trưởng nhóm không tự đổi vai trò, hãy chuyển quyền cho người khác');
      }

      if (role === 'OWNER') {
        await withTxn(async (session) => {
          const demoted = await repo.setRole(conv._id, me, 'ADMIN', session, 'OWNER');
          if (demoted.modified === 0) throw new AppError('FORBIDDEN', MSG.forbidden);
          const promoted = await repo.setRole(conv._id, targetId, 'OWNER', session);
          if (promoted.matched === 0) throw new AppError('NOT_A_MEMBER', MSG.targetNotMember);
          await addSystem(conv._id, { kind: 'OWNER_TRANSFERRED', actorId: me, targetUserIds: [targetId] }, session);
        });
        return emitUpdated(conv._id, ConversationChange.OWNER, me);
      }

      const changed = await withTxn(async (session) => {
        const actor = await repo.findMember(conv._id, me, session);
        if (actor?.role !== 'OWNER' || actor.leftAt) throw new AppError('FORBIDDEN', MSG.forbidden);
        const target = await repo.findMember(conv._id, targetId, session);
        if (!target || target.leftAt) throw new AppError('NOT_A_MEMBER', MSG.targetNotMember);
        if (target.role === 'OWNER') throw new AppError('FORBIDDEN', MSG.forbidden);
        if (target.role === role) return false;
        await repo.setRole(conv._id, targetId, role, session);
        await addSystem(conv._id, { kind: 'ROLE_CHANGED', actorId: me, targetUserIds: [targetId], role }, session);
        return true;
      });
      if (!changed) return toDTO(await reload(conv._id), me);
      return emitUpdated(conv._id, ConversationChange.ROLE, me);
    },
  };
}

export type ConversationsService = ReturnType<typeof createConversationsService>;
