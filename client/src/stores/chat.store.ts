// client/src/stores/chat.store.ts — hội thoại đang mở (sync sau reconnect tải tin mới cho phòng này, kiến trúc §7(c))
import { create } from 'zustand';

interface ChatState {
  openConversationId: string | null;
  setOpenConversation: (id: string | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  openConversationId: null,
  setOpenConversation: (openConversationId) => {
    set({ openConversationId });
  },
}));
