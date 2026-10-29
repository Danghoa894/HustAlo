// client/src/features/conversations/ConversationSearch.tsx — ô tìm kiếm danh sách chat (ui_ux_spec.md §3.2):
// ≥ 2 ký tự (debounce 300 ms) → "Cuộc trò chuyện" (lọc cục bộ, bỏ dấu) + "Người dùng" (/users/search);
// chọn người dùng → tạo DIRECT; Esc xóa ô tìm kiếm.
import { normalizeForSearch, USER_SEARCH_MIN_QUERY, type UserPublic } from '@hustalo/shared';
import { Search } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { vi } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { ConversationListItem } from './ConversationListItem';
import { useConversationList } from './ConversationList';
import { conversationName } from './summary';
import { useStartDirect } from './useStartDirect';
import { useUserSearch } from './useUserSearch';

export function UserRow({ user, action }: { user: UserPublic; action?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <Avatar name={user.displayName} size={40} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span dir="auto" className="truncate text-base text-text">
          {user.displayName}
        </span>
        <span className="truncate text-sm text-text-secondary">@{user.username}</span>
      </span>
      {action}
    </span>
  );
}

export function ConversationSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputId = useId();
  return (
    <div className="px-4 pb-2">
      <label htmlFor={inputId} className="sr-only">
        {vi.conversations.search}
      </label>
      <div className="relative">
        <Search
          size={20}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
        />
        <input
          id={inputId}
          type="search"
          value={value}
          placeholder={vi.conversations.search}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onChange('');
          }}
          className="min-h-[44px] w-full rounded-pill border border-border-strong bg-surface pl-10 pr-3 text-base text-text placeholder:text-text-secondary"
        />
      </div>
    </div>
  );
}

/** Kết quả thay cho danh sách khi đang tìm (≥ 2 ký tự). */
export function SearchResults({ query, onDone }: { query: string; onDone: () => void }) {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const list = useConversationList();
  const { q, enabled, users, isFetching } = useUserSearch(query);
  const start = useStartDirect(onDone);
  if (query.trim().length < USER_SEARCH_MIN_QUERY) return null;

  const needle = normalizeForSearch(query);
  const convs = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((c) =>
    normalizeForSearch(conversationName(c)).includes(needle),
  );
  const pending = !enabled || isFetching;
  if (convs.length === 0 && users.length === 0 && !pending) {
    return <p className="p-4 text-center text-sm text-text-secondary">{vi.conversations.noResults(q)}</p>;
  }
  return (
    <div>
      {convs.length > 0 ? (
        <section aria-label={vi.conversations.sectionConversations}>
          <h2 className="px-4 pt-2 text-xs font-semibold uppercase text-text-secondary">
            {vi.conversations.sectionConversations}
          </h2>
          <ul role="list">
            {convs.map((c) => (
              <ConversationListItem key={c.id} c={c} meId={meId} />
            ))}
          </ul>
        </section>
      ) : null}
      {users.length > 0 ? (
        <section aria-label={vi.conversations.sectionUsers}>
          <h2 className="px-4 pt-2 text-xs font-semibold uppercase text-text-secondary">
            {vi.conversations.sectionUsers}
          </h2>
          <ul role="list">
            {users.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={start.isPending}
                  onClick={() => {
                    start.mutate(u.id);
                  }}
                  className="flex min-h-[56px] w-full items-center px-4 py-2 hover:bg-surface-3"
                >
                  <UserRow user={u} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
