// client/src/features/groups/useLeaveGroup.tsx — luồng "Rời nhóm" (FR-GROUP-004, ui_ux_spec.md §3.4):
// OWNER còn thành viên khác → không gửi request, mở TransferOwnerDialog "Bạn cần chuyển quyền trưởng nhóm trước khi
// rời nhóm" → chuyển quyền rồi rời (EC-GROUP-004); còn lại → xác nhận "Rời nhóm {tên nhóm}?". Xong → /chats.
import type { Conversation } from '@hustalo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { formErrorMessage } from '../auth/form';
import { dropFromList } from '../conversations/cache';
import { conversationKeys, conversationsApi } from '../conversations/conversations.api';
import { TransferOwnerDialog } from './TransferOwnerDialog';

export function useLeaveGroup(conversation: Conversation): { requestLeave: () => void; dialog: ReactNode } {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const [step, setStep] = useState<'idle' | 'confirm' | 'transfer'>('idle');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const me = conversation.members.find((m) => m.userId === meId);
  const others = conversation.members.filter((m) => m.userId !== meId);

  const leave = useMutation({
    mutationFn: async (newOwner: string | null) => {
      if (newOwner) await conversationsApi.changeRole(conversation.id, newOwner, 'OWNER');
      await conversationsApi.removeMember(conversation.id, meId);
    },
    onSuccess: () => {
      setStep('idle');
      void dropFromList(queryClient, conversation.id);
      queryClient.removeQueries({ queryKey: conversationKeys.one(conversation.id) });
      navigate('/chats', { replace: true });
    },
    onError: (err) => {
      setStep('idle');
      pushToast(
        'error',
        err instanceof ApiError && err.code === 'CONFLICT' ? vi.groups.ownerMustTransfer : formErrorMessage(err),
      );
    },
  });

  const requestLeave = () => {
    setStep(me?.role === 'OWNER' && others.length > 0 ? 'transfer' : 'confirm');
  };

  const dialog =
    step === 'transfer' ? (
      <TransferOwnerDialog
        title={vi.groups.ownerMustTransfer}
        candidates={others}
        loading={leave.isPending}
        onConfirm={(userId) => {
          leave.mutate(userId);
        }}
        onCancel={() => {
          setStep('idle');
        }}
      />
    ) : (
      <ConfirmDialog
        open={step === 'confirm'}
        title={vi.groups.confirmLeave(conversation.title ?? '')}
        confirmLabel={vi.groups.leave}
        loading={leave.isPending}
        onConfirm={() => {
          leave.mutate(null);
        }}
        onCancel={() => {
          setStep('idle');
        }}
      />
    );
  return { requestLeave, dialog };
}
