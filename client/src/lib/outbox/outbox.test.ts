import { CLIENT_OUTBOX_MAX, OUTBOX_MAX_AGE_MS, type AckResponse, type ErrorCode } from '@hustalo/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AckTimeoutError } from '../socket/emit';
import { memoryStorage, type OutboxItem } from './outbox.db';
import { Outbox, backoffDelay } from './outbox';

const CONV_A = '6720a1b2c3d4e5f6012345aa';
const CONV_B = '6720a1b2c3d4e5f6012345bb';
type Ack = AckResponse<{ message: { id: string }; duplicate: boolean }>;
const ok = (item: OutboxItem): Ack => ({
  ok: true,
  requestId: 'r',
  data: { message: { id: `m-${item.clientMessageId}` }, duplicate: false },
});
const fail = (code: ErrorCode): Ack => ({ ok: false, requestId: 'r', error: { code, message: 'x' } });

function setup(opts: { online?: boolean; send?: (item: OutboxItem) => Promise<Ack> } = {}) {
  const sent: OutboxItem[] = [];
  const delivered: string[] = [];
  let online = opts.online ?? true;
  const send = vi.fn(async (item: OutboxItem) => {
    sent.push(item);
    return opts.send ? opts.send(item) : ok(item);
  });
  const box = new Outbox({
    userId: 'u1',
    storage: memoryStorage(),
    send: send as never,
    isOnline: () => online,
    onSent: (item) => delivered.push(item.content),
  });
  return { box, send, sent, delivered, setOnline: (v: boolean) => (online = v) };
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('outbox (FR-CHAT-006)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('backoff 1s, 2s, 4s, 8s rồi nhân đôi, trần 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('TC-AC-040 TC-MSG-007 đầy 200 tin → tin thứ 201 bị từ chối (FULL), 200 tin cũ giữ nguyên', async () => {
    const { box } = setup({ online: false });
    for (let i = 0; i < CLIENT_OUTBOX_MAX; i += 1) expect(await box.enqueue(CONV_A, `t${String(i)}`)).toBe('QUEUED');
    expect(await box.enqueue(CONV_A, 'thứ 201')).toBe('FULL');
    expect(box.items()).toHaveLength(CLIENT_OUTBOX_MAX);
    expect(box.items().every((i) => i.status === 'PENDING')).toBe(true);
  });

  it('TC-NET-001 mất mạng: tin mới PENDING, không gửi; có mạng lại → flush gửi đúng thứ tự', async () => {
    const { box, send, setOnline, delivered } = setup({ online: false });
    await box.enqueue(CONV_A, 'một');
    await box.enqueue(CONV_A, 'hai');
    box.flush();
    await settle();
    expect(send).not.toHaveBeenCalled();
    setOnline(true);
    box.flush();
    await vi.runAllTimersAsync();
    expect(delivered).toEqual(['một', 'hai']);
    expect(box.items()).toEqual([]);
  });

  it('mỗi hội thoại tối đa 1 tin đang gửi; hai hội thoại chạy song song', async () => {
    const resolvers: (() => void)[] = [];
    const { box, sent } = setup({
      send: (item) =>
        new Promise((resolve) => {
          resolvers.push(() => resolve(ok(item)));
        }),
    });
    await box.enqueue(CONV_A, 'a1');
    await box.enqueue(CONV_A, 'a2');
    await box.enqueue(CONV_B, 'b1');
    box.flush();
    await settle();
    expect(sent.map((i) => i.content).sort()).toEqual(['a1', 'b1']);
    resolvers[0]?.();
    await settle();
    expect(sent.map((i) => i.content)).toContain('a2');
  });

  it('TC-AC-041 TC-INFRA-001 ACK timeout / SERVICE_UNAVAILABLE / RATE_LIMITED → giữ PENDING, thử lại cùng clientMessageId theo backoff', async () => {
    const replies: (() => Promise<Ack>)[] = [
      () => Promise.reject(new AckTimeoutError('timeout')),
      () => Promise.resolve(fail('SERVICE_UNAVAILABLE')),
      () => Promise.resolve(fail('RATE_LIMITED')),
    ];
    const { box, sent, delivered } = setup({
      send: (item) => (replies.shift() ?? (() => Promise.resolve(ok(item))))(),
    });
    await box.enqueue(CONV_A, 'kiên nhẫn');
    box.flush();
    await settle();
    expect(box.items()[0]?.status).toBe('PENDING');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(delivered).toEqual(['kiên nhẫn']);
    expect(new Set(sent.map((i) => i.clientMessageId)).size).toBe(1);
  });

  it.each([
    ['TC-AC-033 TC-MSG-011', 'USER_BLOCKED'],
    ['TC-MSG-010', 'NOT_A_MEMBER'],
    ['TC-MSG-006', 'VALIDATION_ERROR'],
  ] as const)(
    '%s lỗi vĩnh viễn %s → FAILED ngay, không tự retry; "Thử lại" gửi lại cùng clientMessageId',
    async (_id, code) => {
      let attempt = 0;
      const { box, sent } = setup({ send: (item) => Promise.resolve(attempt++ === 0 ? fail(code) : ok(item)) });
      await box.enqueue(CONV_A, 'bị từ chối');
      box.flush();
      await vi.runAllTimersAsync();
      expect(box.items()[0]).toMatchObject({ status: 'FAILED', error: code });
      expect(sent).toHaveLength(1);
      await box.retry(box.items()[0]?.clientMessageId ?? '');
      await vi.runAllTimersAsync();
      expect(sent).toHaveLength(2);
      expect(sent[1]?.clientMessageId).toBe(sent[0]?.clientMessageId);
      expect(box.items()).toEqual([]);
    },
  );

  it('quá OUTBOX_MAX_AGE_MS (24 h) chưa gửi được → FAILED; "Xóa" bỏ khỏi outbox', async () => {
    const { box, send, setOnline } = setup({ online: false });
    await box.enqueue(CONV_A, 'cũ');
    await vi.advanceTimersByTimeAsync(OUTBOX_MAX_AGE_MS + 1);
    setOnline(true);
    box.flush();
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(box.items()[0]).toMatchObject({ status: 'FAILED' });
    await box.remove(box.items()[0]?.clientMessageId ?? '');
    expect(box.items()).toEqual([]);
  });

  it('outbox sống qua reload: load() đọc lại tin từ storage theo user', async () => {
    const storage = memoryStorage();
    const first = new Outbox({ userId: 'u1', storage, send: vi.fn() as never, isOnline: () => false });
    await first.enqueue(CONV_A, 'còn đây');
    const second = new Outbox({ userId: 'u1', storage, send: vi.fn() as never, isOnline: () => false });
    await second.load();
    expect(second.items().map((i) => i.content)).toEqual(['còn đây']);
    const other = new Outbox({ userId: 'u2', storage, send: vi.fn() as never, isOnline: () => false });
    await other.load();
    expect(other.items()).toEqual([]);
  });
});
