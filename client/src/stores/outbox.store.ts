// client/src/stores/outbox.store.ts — bản sao trạng thái outbox để render bubble PENDING/FAILED (kiến trúc §4.1)
import { create } from 'zustand';
import type { OutboxItem } from '../lib/outbox/outbox.db';

interface OutboxState {
  items: OutboxItem[];
  setItems: (items: OutboxItem[]) => void;
}

export const useOutboxStore = create<OutboxState>((set) => ({
  items: [],
  setItems: (items) => {
    set({ items });
  },
}));
