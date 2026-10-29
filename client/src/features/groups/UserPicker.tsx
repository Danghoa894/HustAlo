// client/src/features/groups/UserPicker.tsx — tìm người dùng (Q['users','search',q]) và chọn nhiều, chip đã chọn;
// không cho chọn quá `max` (EC-GROUP-001: chặn chọn quá số chỗ còn lại), bỏ người đã trong nhóm (ui_ux_spec.md §3.4).
import type { UserPublic } from '@hustalo/shared';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { vi } from '../../i18n/vi';
import { UserRow } from '../conversations/ConversationSearch';
import { useUserSearch } from '../conversations/useUserSearch';

export interface UserPickerProps {
  selected: UserPublic[];
  onChange: (users: UserPublic[]) => void;
  max: number;
  excludeIds?: ReadonlySet<string>;
}

export function UserPicker({ selected, onChange, max, excludeIds }: UserPickerProps) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const { users } = useUserSearch(query);
  const chosen = new Set(selected.map((u) => u.id));
  const full = selected.length >= max;
  const results = users.filter((u) => !excludeIds?.has(u.id));

  const toggle = (u: UserPublic) => {
    if (chosen.has(u.id)) onChange(selected.filter((s) => s.id !== u.id));
    else if (!full) onChange([...selected, u]);
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-text">
        {vi.groups.addMembers}
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        placeholder={vi.groups.searchUsers}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        className="min-h-[44px] rounded-md border border-border-strong bg-surface px-3 text-base text-text placeholder:text-text-secondary"
      />
      {selected.length > 0 ? (
        <ul role="list" className="flex flex-wrap gap-2">
          {selected.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                aria-label={vi.groups.removeChip(u.displayName)}
                onClick={() => {
                  toggle(u);
                }}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-pill bg-surface-3 px-3 text-sm text-text"
              >
                <span dir="auto">{u.displayName}</span>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ul role="list" className="max-h-64 overflow-y-auto">
        {results.map((u) => (
          <li key={u.id}>
            <label className="flex min-h-[52px] cursor-pointer items-center gap-3 px-1">
              <input
                type="checkbox"
                checked={chosen.has(u.id)}
                disabled={full && !chosen.has(u.id)}
                onChange={() => {
                  toggle(u);
                }}
                className="h-5 w-5 accent-primary"
              />
              <UserRow user={u} />
            </label>
          </li>
        ))}
      </ul>
      <p className="text-sm text-text-secondary" aria-live="polite">
        {vi.groups.selected(selected.length, max)}
      </p>
    </div>
  );
}
