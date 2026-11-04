// client/src/lib/outbox/outbox.db.ts — lưu outbox trong IndexedDB (idb) theo userId (kiến trúc §4.1; FR-CHAT-006:
// "Outbox sống qua reload"). Nội dung tin chỉ nằm trên máy người gửi tới khi server ACK.
import type { ErrorCode } from '@hustalo/shared';
import { openDB, type IDBPDatabase } from 'idb';

export interface OutboxItem {
  clientMessageId: string;
  userId: string;
  conversationId: string;
  content: string;
  status: 'PENDING' | 'FAILED';
  error: ErrorCode | null;
  createdLocalAt: number;
  attempts: number;
  /** SECRET (M7): người nhận — tin được mã hóa lúc gửi (FR-E2EE-004); không có = PLAINTEXT. */
  peerId?: string;
}

export interface OutboxStorage {
  list(userId: string): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(clientMessageId: string): Promise<void>;
}

const DB_NAME = 'hustalo';
const STORE = 'outbox';

let dbPromise: Promise<IDBPDatabase> | null = null;
const db = () =>
  (dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      const store = d.createObjectStore(STORE, { keyPath: 'clientMessageId' });
      store.createIndex('userId', 'userId');
    },
  }));

export function idbStorage(): OutboxStorage {
  return {
    list: async (userId) => (await (await db()).getAllFromIndex(STORE, 'userId', userId)) as OutboxItem[],
    put: async (item) => {
      await (await db()).put(STORE, item);
    },
    remove: async (id) => {
      await (await db()).delete(STORE, id);
    },
  };
}

/** Bản trong RAM cho test / trình duyệt chặn IndexedDB. */
export function memoryStorage(): OutboxStorage {
  const items = new Map<string, OutboxItem>();
  return {
    list: (userId) => Promise.resolve([...items.values()].filter((i) => i.userId === userId).map((i) => ({ ...i }))),
    put: (item) => {
      items.set(item.clientMessageId, { ...item });
      return Promise.resolve();
    },
    remove: (id) => {
      items.delete(id);
      return Promise.resolve();
    },
  };
}
