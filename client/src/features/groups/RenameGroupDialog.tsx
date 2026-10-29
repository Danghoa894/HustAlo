// client/src/features/groups/RenameGroupDialog.tsx — "Đổi tên nhóm" (FR-GROUP-005, ui_ux_spec.md §3.4): PATCH /conversations/{id}
import { countCodePoints, groupTitleSchema, type Conversation } from '@hustalo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { TextField } from '../../components/ui/TextField';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { useUiStore } from '../../stores/ui.store';
import { formErrorMessage } from '../auth/form';
import { syncConversation } from '../conversations/cache';
import { conversationsApi } from '../conversations/conversations.api';

export function RenameGroupDialog({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const [title, setTitle] = useState(conversation.title ?? '');
  const [error, setError] = useState<string | undefined>();
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const parsed = groupTitleSchema.safeParse(title);

  const rename = useMutation({
    mutationFn: () => conversationsApi.rename(conversation.id, title),
    onSuccess: async (conv) => {
      await syncConversation(queryClient, conv);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'FORBIDDEN') {
        pushToast('error', vi.groups.forbidden);
        onClose();
      } else {
        setError(formErrorMessage(err));
      }
    },
  });

  return (
    <Modal
      open
      title={vi.groups.rename}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {vi.common.cancel}
          </Button>
          <Button
            loading={rename.isPending}
            disabled={!parsed.success}
            onClick={() => {
              rename.mutate();
            }}
          >
            {vi.common.save}
          </Button>
        </>
      }
    >
      <TextField
        label={vi.groups.title}
        value={title}
        error={error ?? (parsed.success || title === '' ? undefined : parsed.error.issues[0]?.message)}
        hint={vi.groups.titleCounter(countCodePoints(title.trim()))}
        onChange={(e) => {
          setTitle(e.target.value);
          setError(undefined);
        }}
      />
    </Modal>
  );
}
