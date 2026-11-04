// client/src/features/chat/MessageActions.tsx — menu "Sao chép", "Sửa", "Thu hồi" của bubble (ui_ux_spec.md §3.3).
// "Sửa"/"Thu hồi" chỉ khi canEditOrRecall theo giờ server ước lượng; "Thu hồi" hỏi xác nhận.
import type { Message } from '@hustalo/shared';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Menu, type MenuItem } from '../../components/ui/Menu';
import { vi } from '../../i18n/vi';
import { serverNow } from '../../lib/time/server-clock';
import { canEditOrRecall } from './message-state';

export interface MessageActionsProps {
  message: Message;
  meId: string;
  onEdit: (m: Message) => void;
  onRecall: (m: Message) => Promise<boolean>;
}

export function MessageActions({ message, meId, onEdit, onRecall }: MessageActionsProps) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const own = canEditOrRecall(message, meId, serverNow());
  const items: MenuItem[] = [];
  if (message.content !== null && message.deletedAt === null) {
    items.push({
      label: vi.chat.copy,
      onSelect: () => {
        if (typeof navigator.clipboard === 'object') {
          void navigator.clipboard.writeText(message.content ?? '').catch(() => undefined);
        }
      },
    });
  }
  if (own) {
    // Tin SECRET (có ciphertext) không sửa được — chỉ thu hồi (FR-CHAT-007, D-16, EC-MSG-017).
    if (message.ciphertext === null) {
      items.push({
        label: vi.chat.edit,
        onSelect: () => {
          onEdit(message);
        },
      });
    }
    items.push({
      label: vi.chat.recall,
      danger: true,
      onSelect: () => {
        setConfirm(true);
      },
    });
  }
  if (items.length === 0) return null;
  return (
    <>
      <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Menu label={vi.chat.messageActions} items={items} />
      </span>
      <ConfirmDialog
        open={confirm}
        title={vi.chat.confirmRecall}
        confirmLabel={vi.chat.recall}
        loading={busy}
        onCancel={() => {
          setConfirm(false);
        }}
        onConfirm={() => {
          setBusy(true);
          void onRecall(message).finally(() => {
            setBusy(false);
            setConfirm(false);
          });
        }}
      />
    </>
  );
}
