// client/src/stores/typing.store.ts — S.typing: ai đang gõ trong hội thoại nào (FR-CHAT-005, ui_ux_spec.md §4.2).
// Tự ẩn sau TYPING_TTL_MS không có isTyping:true mới; ẩn ngay khi isTyping:false hoặc có tin mới từ người đó.
import { TYPING_TTL_MS } from '@hustalo/shared';
import { create } from 'zustand';

interface TypingState {
  /** conversationId → userId đang gõ (theo thứ tự bắt đầu gõ). */
  byConversation: Record<string, string[]>;
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void;
  reset: () => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const timerKey = (c: string, u: string) => `${c}:${u}`;

export const useTypingStore = create<TypingState>((set, get) => ({
  byConversation: {},
  setTyping: (conversationId, userId, isTyping) => {
    const key = timerKey(conversationId, userId);
    clearTimeout(timers.get(key));
    timers.delete(key);
    const current = get().byConversation[conversationId] ?? [];
    if (isTyping) {
      timers.set(
        key,
        setTimeout(() => {
          get().setTyping(conversationId, userId, false);
        }, TYPING_TTL_MS),
      );
      if (current.includes(userId)) return;
      set((s) => ({ byConversation: { ...s.byConversation, [conversationId]: [...current, userId] } }));
      return;
    }
    if (!current.includes(userId)) return;
    set((s) => ({
      byConversation: { ...s.byConversation, [conversationId]: current.filter((id) => id !== userId) },
    }));
  },
  reset: () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    set({ byConversation: {} });
  },
}));
