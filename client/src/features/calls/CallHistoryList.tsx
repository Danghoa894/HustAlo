// client/src/features/calls/CallHistoryList.tsx — tab "Cuộc gọi" (ui_ux_spec.md §3.2): icon hướng/nhỡ, tên, loại cuộc gọi,
// thời lượng mm:ss hoặc nhãn kết cục, thời gian, nút "Gọi lại cho {tên}".
import type { CallRecord } from '@hustalo/shared';
import { useQuery } from '@tanstack/react-query';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { vi } from '../../i18n/vi';
import { formatDuration, formatListTime } from '../../lib/time/format';
import { callsApi, callsKey } from './calls.api';
import { useCallActions } from './useCallController';

function outcome(c: CallRecord): string {
  if (c.durationSec !== null) return formatDuration(c.durationSec);
  const o = vi.calls.outcome as Record<string, string>;
  return o[c.status] ?? o.FAILED ?? '';
}

function Row({ c }: { c: CallRecord }) {
  const actions = useCallActions();
  const missed = c.direction === 'INCOMING' && (c.status === 'MISSED' || c.status === 'BUSY');
  const Icon = missed ? PhoneMissed : c.direction === 'INCOMING' ? PhoneIncoming : PhoneOutgoing;
  const name = c.peer.displayName;
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <Avatar name={name} size={40} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate font-medium ${missed ? 'text-danger' : 'text-text'}`} dir="auto">
          {name}
        </span>
        <span className="flex items-center gap-1 text-sm text-text-secondary">
          <Icon size={14} aria-hidden="true" className={missed ? 'text-danger' : ''} />
          <span>{c.callType === 'VIDEO' ? vi.calls.video : vi.calls.voice}</span>
          <span aria-hidden="true">·</span>
          <span>{outcome(c)}</span>
        </span>
      </div>
      <time className="text-xs text-text-secondary" dateTime={c.createdAt}>
        {formatListTime(c.createdAt)}
      </time>
      <button
        type="button"
        aria-label={vi.calls.callBack(name)}
        title={vi.calls.callBack(name)}
        onClick={() => {
          void actions.startCall({
            conversationId: c.conversationId,
            callType: c.callType,
            peer: { id: c.peer.id, displayName: name, avatarUrl: c.peer.avatarUrl },
          });
        }}
        className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-primary hover:bg-surface-3"
      >
        {c.callType === 'VIDEO' ? <Video size={18} aria-hidden="true" /> : <Phone size={18} aria-hidden="true" />}
      </button>
    </li>
  );
}

export function CallHistoryList() {
  const q = useQuery({ queryKey: callsKey, queryFn: () => callsApi.page() });
  if (q.isPending) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  const items = q.data?.items ?? [];
  if (items.length === 0) return <p className="px-4 py-8 text-center text-text-secondary">{vi.calls.historyEmpty}</p>;
  return (
    <ul role="list" className="flex flex-col">
      {items.map((c) => (
        <Row key={c.id} c={c} />
      ))}
    </ul>
  );
}
