// client/src/features/chat/message-state.ts — hàm thuần cho danh sách tin trong cache (ui_ux_spec.md §3.3, §4.2):
// hợp nhất + sắp theo (createdAt, id) (EC-NET-005/006), receipt một chiều không hạ cấp, receipt chờ (EC-MSG-008),
// trạng thái tin của mình, quyền sửa/thu hồi theo giờ server (EC-MSG-012, EC-MSG-015).
import {
  CLIENT_PENDING_RECEIPTS_MAX,
  CLIENT_PENDING_RECEIPT_TTL_MS,
  MESSAGE_EDIT_WINDOW_MS,
  compareMessageOrder,
  type Message,
} from '@hustalo/shared';

export type ReceiptStatus = 'DELIVERED' | 'READ';
export type OwnStatus = 'SENT' | ReceiptStatus;

/** Hợp nhất theo id (bản đến sau thay bản trước — sửa/thu hồi), trả mảng tăng dần theo (createdAt, id). */
export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(compareMessageOrder);
}

export function ownStatus(m: Message | undefined): OwnStatus {
  if (m?.receipt?.readAt) return 'READ';
  if (m?.receipt?.deliveredAt) return 'DELIVERED';
  return 'SENT';
}

/** Áp receipt lên tin (chỉ nâng, không hạ); trả thêm id chưa có trong danh sách để giữ chờ. */
export function applyStatus(
  messages: readonly Message[],
  ev: { scope: 'MESSAGE'; messageIds: string[]; status: ReceiptStatus; byUserId: string; at: string },
): { messages: Message[]; unmatched: string[] } {
  const wanted = new Set(ev.messageIds);
  const found = new Set<string>();
  const next = messages.map((m) => {
    if (!wanted.has(m.id)) return m;
    found.add(m.id);
    return withReceipt(m, ev.status, ev.at);
  });
  return { messages: next, unmatched: ev.messageIds.filter((id) => !found.has(id)) };
}

export function withReceipt(m: Message, status: ReceiptStatus, at: string): Message {
  const r = m.receipt ?? { deliveredAt: null, readAt: null };
  return {
    ...m,
    receipt: {
      deliveredAt: r.deliveredAt ?? at,
      readAt: status === 'READ' ? (r.readAt ?? at) : r.readAt,
    },
  };
}

/** Receipt đến trước tin (EC-MSG-008): giữ tối đa `max` mục trong `ttlMs`, áp khi tin tới. */
export class PendingReceipts {
  private items = new Map<string, { status: ReceiptStatus; at: string; addedAt: number }>();

  constructor(
    private readonly max: number = CLIENT_PENDING_RECEIPTS_MAX,
    private readonly ttlMs: number = CLIENT_PENDING_RECEIPT_TTL_MS,
  ) {}

  add(ids: string[], status: ReceiptStatus, at: string, now: number = Date.now()): void {
    for (const id of ids) {
      const prev = this.items.get(id);
      const merged = prev?.status === 'READ' ? prev.status : status;
      this.items.delete(id);
      this.items.set(id, { status: merged, at, addedAt: now });
      if (this.items.size > this.max) {
        const oldest = this.items.keys().next().value;
        if (oldest !== undefined) this.items.delete(oldest);
      }
    }
  }

  take(id: string, now: number = Date.now()): { status: ReceiptStatus; at: string } | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;
    this.items.delete(id);
    return now - item.addedAt > this.ttlMs ? undefined : { status: item.status, at: item.at };
  }
}

/** "Sửa"/"Thu hồi" chỉ cho tin TEXT của mình, chưa thu hồi, trong 15 phút theo giờ server ước lượng. */
export function canEditOrRecall(m: Message, meId: string, serverNowMs: number): boolean {
  return (
    m.type === 'TEXT' &&
    m.senderId === meId &&
    m.deletedAt === null &&
    serverNowMs - Date.parse(m.createdAt) < MESSAGE_EDIT_WINDOW_MS
  );
}
