// client/src/features/conversations/ConversationList.tsx — Q['conversations'] (infinite), cuộn tới cuối tải trang tiếp,
// ↑/↓ chuyển mục; skeleton 8 dòng / trống / lỗi (ui_ux_spec.md §3.2).
import type { ConversationPage } from '@hustalo/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { vi } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { conversationKeys, conversationsApi } from './conversations.api';
import { useWatchPresence } from '../presence/usePresence';
import { ConversationListItem } from './ConversationListItem';

export function useConversationList() {
  return useInfiniteQuery({
    queryKey: conversationKeys.list,
    queryFn: ({ pageParam }) => conversationsApi.list(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ConversationPage) => last.nextCursor,
  });
}

function Skeleton() {
  return (
    <div role="status" aria-label={vi.app.loading}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-3 px-4 py-2">
          <span className="h-12 w-12 animate-pulse rounded-pill bg-surface-3" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3 w-1/2 animate-pulse rounded-sm bg-surface-3" />
            <span className="h-3 w-3/4 animate-pulse rounded-sm bg-surface-3" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function ConversationList({ onStartChat }: { onStartChat: () => void }) {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const q = useConversationList();
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  // Theo dõi presence peer DIRECT/SECRET đang có trong danh sách (FR-PRES-003).
  const peers = (q.data?.pages ?? []).flatMap((p) =>
    p.items.flatMap((c) => (c.type !== 'GROUP' && c.peer ? [c.peer.id] : [])),
  );
  useWatchPresence(peers);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (q.isPending) return <Skeleton />;
  if (q.isError) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-text-secondary">{vi.conversations.loadError}</p>
        <Button variant="secondary" onClick={() => void q.refetch()}>
          {vi.common.retry}
        </Button>
      </div>
    );
  }
  const items = q.data.pages.flatMap((p) => p.items);
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-text-secondary">{vi.conversations.empty}</p>
        <Button onClick={onStartChat}>{vi.conversations.startChat}</Button>
      </div>
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-conversation-link]'));
    const i = links.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    links[e.key === 'ArrowDown' ? Math.min(i + 1, links.length - 1) : Math.max(i - 1, 0)]?.focus();
  };

  return (
    <>
      <ul role="list" aria-label={vi.conversations.sectionConversations} onKeyDown={onKeyDown}>
        {items.map((c) => (
          <ConversationListItem key={c.id} c={c} meId={meId} />
        ))}
      </ul>
      <div ref={sentinel} className="flex justify-center p-2">
        {isFetchingNextPage ? <Spinner size={20} /> : null}
      </div>
    </>
  );
}
