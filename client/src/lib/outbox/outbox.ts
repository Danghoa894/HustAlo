// client/src/lib/outbox/outbox.ts — hàng đợi gửi tin (FR-CHAT-006, kiến trúc §7(b) nhánh lỗi):
// - Tối đa CLIENT_OUTBOX_MAX tin PENDING/FAILED mỗi user; đầy → không nhận tin mới (EC-MSG-007).
// - Mỗi hội thoại gửi tuần tự theo thứ tự tạo, tối đa 1 tin in-flight; các hội thoại chạy song song.
// - ACK timeout / SERVICE_UNAVAILABLE / RATE_LIMITED / mất kết nối → giữ PENDING, thử lại cùng clientMessageId theo
//   backoff 1s, 2s, 4s, 8s rồi nhân đôi, trần OUTBOX_RETRY_MAX_DELAY_MS. Lỗi vĩnh viễn → FAILED ngay.
// - Quá OUTBOX_MAX_AGE_MS chưa gửi được → FAILED. "Thử lại" gửi lại cùng clientMessageId; "Xóa" bỏ tin.
import {
  CLIENT_OUTBOX_MAX,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_RETRY_BACKOFF_MS,
  OUTBOX_RETRY_MAX_DELAY_MS,
} from '@hustalo/shared';
import type { AckResponse, ErrorCode, Message } from '@hustalo/shared';
import type { OutboxItem, OutboxStorage } from './outbox.db';

export const PERMANENT_ERRORS: ReadonlySet<ErrorCode> = new Set([
  'VALIDATION_ERROR',
  'NOT_A_MEMBER',
  'NOT_FOUND',
  'USER_BLOCKED',
  'FORBIDDEN',
  'E2EE_KEYS_UNAVAILABLE',
  // message:send chỉ trả CONFLICT cho SECRET, sau khi secret-send đã tự mã hóa lại 2 lần (EC-E2EE-008).
  'CONFLICT',
]);

/** Độ trễ trước lần thử thứ `attempt` (bắt đầu từ 1). */
export function backoffDelay(attempt: number): number {
  const fixed = OUTBOX_RETRY_BACKOFF_MS[attempt - 1];
  if (fixed !== undefined) return fixed;
  const last = OUTBOX_RETRY_BACKOFF_MS[OUTBOX_RETRY_BACKOFF_MS.length - 1] ?? 1000;
  return Math.min(last * 2 ** (attempt - OUTBOX_RETRY_BACKOFF_MS.length), OUTBOX_RETRY_MAX_DELAY_MS);
}

export type SendAck = AckResponse<{ message: Message; duplicate: boolean }>;

export interface OutboxOptions {
  userId: string;
  storage: OutboxStorage;
  /** Gửi message:send; reject (AckTimeoutError, mất kết nối) = lỗi tạm thời. */
  send: (item: OutboxItem) => Promise<SendAck>;
  isOnline: () => boolean;
  onSent?: (item: OutboxItem, message: Message) => void;
  /** Lỗi vĩnh viễn (ví dụ USER_BLOCKED → tải lại hội thoại để composer đổi sang BlockedComposerNotice, AC-033). */
  onFailed?: (item: OutboxItem, code: ErrorCode) => void;
  onChange?: (items: OutboxItem[]) => void;
}

export class Outbox {
  private list: OutboxItem[] = [];
  private readonly inFlight = new Set<string>(); // conversationId
  private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>(); // conversationId → timer backoff

  constructor(private readonly opts: OutboxOptions) {}

  items(): OutboxItem[] {
    return this.list;
  }

  async load(): Promise<void> {
    this.list = (await this.opts.storage.list(this.opts.userId)).sort((a, b) => a.createdLocalAt - b.createdLocalAt);
    this.changed();
  }

  async enqueue(conversationId: string, content: string, opts: { peerId?: string } = {}): Promise<'QUEUED' | 'FULL'> {
    if (this.list.length >= CLIENT_OUTBOX_MAX) return 'FULL';
    const item: OutboxItem = {
      ...(opts.peerId ? { peerId: opts.peerId } : {}),
      clientMessageId: crypto.randomUUID(),
      userId: this.opts.userId,
      conversationId,
      content,
      status: 'PENDING',
      error: null,
      createdLocalAt: Date.now(),
      attempts: 0,
    };
    this.list = [...this.list, item];
    this.changed();
    await this.opts.storage.put(item);
    this.flush();
    return 'QUEUED';
  }

  /** Gửi tin đầu hàng của mỗi hội thoại đang rảnh (gọi khi connect, online, visible, sau mỗi ACK). */
  flush(): void {
    if (!this.opts.isOnline()) return;
    const heads = new Map<string, OutboxItem>();
    for (const item of this.list) {
      if (item.status === 'PENDING' && !heads.has(item.conversationId)) heads.set(item.conversationId, item);
    }
    for (const [conversationId, item] of heads) {
      if (this.inFlight.has(conversationId) || this.waiting.has(conversationId)) continue;
      void this.sendOne(item);
    }
  }

  async retry(clientMessageId: string): Promise<void> {
    await this.update(clientMessageId, { status: 'PENDING', error: null, attempts: 0, createdLocalAt: Date.now() });
    this.flush();
  }

  async remove(clientMessageId: string): Promise<void> {
    this.list = this.list.filter((i) => i.clientMessageId !== clientMessageId);
    this.changed();
    await this.opts.storage.remove(clientMessageId);
  }

  /** Dừng mọi hẹn giờ (đăng xuất / đổi user). */
  dispose(): void {
    for (const t of this.waiting.values()) clearTimeout(t);
    this.waiting.clear();
  }

  private async sendOne(item: OutboxItem): Promise<void> {
    const conv = item.conversationId;
    if (Date.now() - item.createdLocalAt > OUTBOX_MAX_AGE_MS) {
      await this.update(item.clientMessageId, { status: 'FAILED', error: null });
      this.flush();
      return;
    }
    this.inFlight.add(conv);
    let res: SendAck | null = null;
    try {
      res = await this.opts.send(item);
    } catch {
      res = null; // timeout / mất kết nối
    } finally {
      this.inFlight.delete(conv);
    }

    if (res?.ok) {
      await this.remove(item.clientMessageId);
      this.opts.onSent?.(item, res.data.message);
      this.flush();
      return;
    }
    if (res && PERMANENT_ERRORS.has(res.error.code)) {
      await this.update(item.clientMessageId, { status: 'FAILED', error: res.error.code });
      this.opts.onFailed?.(item, res.error.code);
      this.flush();
      return;
    }
    const attempts = item.attempts + 1;
    await this.update(item.clientMessageId, { attempts });
    this.waiting.set(
      conv,
      setTimeout(() => {
        this.waiting.delete(conv);
        this.flush();
      }, backoffDelay(attempts)),
    );
  }

  private async update(clientMessageId: string, patch: Partial<OutboxItem>): Promise<void> {
    let updated: OutboxItem | undefined;
    this.list = this.list.map((i) => {
      if (i.clientMessageId !== clientMessageId) return i;
      updated = { ...i, ...patch };
      return updated;
    });
    this.changed();
    if (updated) await this.opts.storage.put(updated);
  }

  private changed(): void {
    this.opts.onChange?.(this.list);
  }
}
