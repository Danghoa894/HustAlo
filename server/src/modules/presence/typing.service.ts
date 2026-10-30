// server/src/modules/presence/typing.service.ts — typing:start / typing:stop → typing:update (FR-CHAT-005; DB Phụ lục A).
// AUTHZ: thành viên hiện tại (NOT_FOUND / NOT_A_MEMBER); DIRECT/SECRET bị chặn hai chiều → USER_BLOCKED (AC-014).
// Fan-out tới user room của thành viên hiện tại trừ người gõ (D-09) để preview danh sách chat cũng thấy.
import { EVENTS, TYPING_TTL_MS } from '@hustalo/shared';
import type { Types } from 'mongoose';
import { AppError } from '../../http/errors/app-error';
import type { Emitter } from '../../realtime/emitter';
import { userRoom } from '../../realtime/rooms';
import type { PresenceRepository } from './presence.repository';

export interface TypingConversationsPort {
  assertMember(conversationId: string, userId: string): Promise<{ conv: { _id: Types.ObjectId; type: string } }>;
  activeMemberIds(conversationId: Types.ObjectId): Promise<string[]>;
}

export interface TypingDeps {
  repo: PresenceRepository;
  conversations: TypingConversationsPort;
  users: { isBlockedEitherWay(a: string, b: string): Promise<boolean> };
  emitter: Emitter;
  ttlMs?: number;
}

export function createTypingService(deps: TypingDeps) {
  const { repo, conversations, users, emitter } = deps;
  const ttlMs = deps.ttlMs ?? TYPING_TTL_MS;

  async function authorize(me: string, conversationId: string): Promise<string[]> {
    const { conv } = await conversations.assertMember(conversationId, me);
    const members = await conversations.activeMemberIds(conv._id);
    const others = members.filter((id) => id !== me);
    if (conv.type !== 'GROUP') {
      const peer = others[0];
      if (peer && (await users.isBlockedEitherWay(me, peer))) {
        throw new AppError('USER_BLOCKED', 'Không thể gửi tin nhắn tới người này');
      }
    }
    return others;
  }

  const fanOut = (others: string[], conversationId: string, userId: string, isTyping: boolean) => {
    if (others.length > 0) {
      emitter.toRooms(others.map(userRoom), EVENTS.TYPING_UPDATE, { conversationId, userId, isTyping });
    }
  };

  return {
    async start(me: string, conversationId: string): Promise<Record<string, never>> {
      const others = await authorize(me, conversationId);
      await repo.setTyping(conversationId, me, ttlMs);
      fanOut(others, conversationId, me, true);
      return {};
    },

    async stop(me: string, conversationId: string): Promise<Record<string, never>> {
      const others = await authorize(me, conversationId);
      if (await repo.clearTyping(conversationId, me)) fanOut(others, conversationId, me, false);
      return {};
    },

    /** typingUserIds cho ACK conversation:join (trừ chính mình); Redis lỗi → []. */
    async activeTypers(conversationId: string, me: string): Promise<string[]> {
      try {
        return (await repo.typingUsers(conversationId)).filter((id) => id !== me);
      } catch {
        return [];
      }
    },
  };
}

export type TypingService = ReturnType<typeof createTypingService>;
