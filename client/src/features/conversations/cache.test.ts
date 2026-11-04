// KI-13: rời/bị xóa khỏi nhóm (AC-055) — lần tải danh sách đang bay (khởi chạy trước khi bị xóa) không được ghi đè cache
// sau khi đã bỏ hội thoại; sau đó danh sách tải lại từ server.
import type { ConversationPage, ConversationSummary } from '@hustalo/shared';
import { InfiniteQueryObserver, QueryClient, type InfiniteData } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { dropFromList } from './cache';
import { conversationKeys } from './conversations.api';

const summary = (id: string) => ({ id }) as unknown as ConversationSummary;
const page = (...ids: string[]): ConversationPage => ({ items: ids.map(summary), nextCursor: null });
const ids = (qc: QueryClient) =>
  qc
    .getQueryData<InfiniteData<ConversationPage>>(conversationKeys.list)
    ?.pages.flatMap((p) => p.items.map((c) => c.id));

describe('dropFromList (KI-13, AC-055)', () => {
  it('TC-AC-055 hủy lần tải danh sách đang bay rồi bỏ hội thoại; lần tải lại sau đó lấy bản mới từ server', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let server = page('g1', 'd1');
    const resolvers: (() => void)[] = [];
    const observer = new InfiniteQueryObserver(qc, {
      queryKey: conversationKeys.list,
      initialPageParam: null as string | null,
      getNextPageParam: (last: ConversationPage) => last.nextCursor,
      queryFn: ({ signal }) => {
        const snapshot = server; // server trả dữ liệu tại thời điểm nhận request
        return new Promise<ConversationPage>((resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
          resolvers.push(() => {
            resolve(snapshot);
          });
        });
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    resolvers.shift()?.();
    await vi.waitFor(() => {
      expect(ids(qc)).toEqual(['g1', 'd1']);
    });

    void qc.invalidateQueries({ queryKey: conversationKeys.list }); // ví dụ conversation:updated (ROLE) — còn g1
    server = page('d1'); // server xóa thành viên rồi mới phát conversation:member-removed
    const dropped = dropFromList(qc, 'g1');
    resolvers.shift()?.(); // phản hồi cũ (còn g1) về muộn → phải bị bỏ qua
    await new Promise((r) => setTimeout(r, 0));
    expect(ids(qc)).toEqual(['d1']);
    await vi.waitFor(() => {
      expect(resolvers).toHaveLength(1); // đã khởi chạy lần tải lại
    });

    resolvers.shift()?.(); // lần tải lại sau khi bỏ: bản mới từ server
    await dropped;
    expect(qc.getQueryState(conversationKeys.list)?.fetchStatus).toBe('idle');
    expect(ids(qc)).toEqual(['d1']);
    unsubscribe();
  });
});
