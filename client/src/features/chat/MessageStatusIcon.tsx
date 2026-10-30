// client/src/features/chat/MessageStatusIcon.tsx — ✓ / ✓✓ / ✓✓ xanh / 🕒 cho tin của mình (ui_ux_spec.md §3.3, §6.4)
import { Check, CheckCheck, Clock } from 'lucide-react';
import { vi } from '../../i18n/vi';
import type { OwnStatus } from './message-state';

export function MessageStatusIcon({ status }: { status: OwnStatus | 'PENDING' }) {
  const label = vi.chat.status[status];
  const common = { size: 14, role: 'img', 'aria-label': label } as const;
  if (status === 'PENDING') return <Clock {...common} className="text-text-secondary" />;
  if (status === 'SENT') return <Check {...common} className="text-text-secondary" />;
  return <CheckCheck {...common} className={status === 'READ' ? 'text-primary' : 'text-text-secondary'} />;
}
