// client/src/features/settings/BlockedSection.tsx — "Người đã chặn" (ui_ux_spec.md §3.8; GET /users/blocked,
// DELETE /users/{userId}/block; FR-USER-004). Rỗng → "Bạn chưa chặn ai".
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { vi } from '../../i18n/vi';
import { blockedKey, useToggleBlock, usersApi } from '../users/users.api';
import { SectionSkeleton } from './SectionSkeleton';

export function BlockedSection() {
  const q = useQuery({ queryKey: blockedKey, queryFn: usersApi.blocked });
  const toggle = useToggleBlock();
  return (
    <section aria-labelledby="blocked-title" className="max-w-xl">
      <h2 id="blocked-title" className="mb-4 text-xl font-semibold">
        {vi.settings.sections.blocked}
      </h2>
      {q.isPending ? (
        <SectionSkeleton />
      ) : (q.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-text-secondary">{vi.settings.blockedEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data?.items.map((u) => (
            <li key={u.id} className="flex items-center gap-3">
              <Avatar name={u.displayName} size={40} />
              <span dir="auto" className="min-w-0 flex-1 truncate">
                {u.displayName}
              </span>
              <Button
                variant="secondary"
                loading={toggle.isPending && toggle.variables.userId === u.id}
                onClick={() => {
                  toggle.mutate({ userId: u.id, block: false });
                }}
              >
                {vi.chat.unblock}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
