// client/src/features/groups/CreateGroupDialog.tsx — tạo nhóm (FR-GROUP-001, ui_ux_spec.md §3.4): tên (đếm "{n}/100"),
// UserPicker tối đa 99; Idempotency-Key sinh một lần khi mở dialog; người bị bỏ qua → toast "Không thể thêm {tên}".
import { GROUP_MAX_MEMBERS, countCodePoints, groupTitleSchema, type UserPublic } from '@hustalo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { TextField } from '../../components/ui/TextField';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { useUiStore } from '../../stores/ui.store';
import { FormError } from '../auth/FormError';
import { formErrorMessage } from '../auth/form';
import { syncConversation } from '../conversations/cache';
import { conversationsApi } from '../conversations/conversations.api';
import { UserPicker } from './UserPicker';

export function CreateGroupDialog({ onClose }: { onClose: () => void }) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState('');
  const [members, setMembers] = useState<UserPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);

  const titleOk = groupTitleSchema.safeParse(title).success;
  const titleLen = countCodePoints(title.trim());

  const create = useMutation({
    mutationFn: () =>
      conversationsApi.create({ type: 'GROUP', title, memberIds: members.map((m) => m.id) }, idempotencyKey),
    onSuccess: async ({ conversation, skipped }) => {
      const names = new Map(members.map((m) => [m.id, m.displayName]));
      for (const s of skipped) {
        if (s.code !== 'CONFLICT') pushToast('warning', vi.groups.cannotAdd(names.get(s.userId) ?? ''));
      }
      await syncConversation(queryClient, conversation);
      onClose();
      navigate(`/chats/${conversation.id}`);
    },
    onError: (err) => {
      setError(err instanceof ApiError && err.code === 'CONVERSATION_FULL' ? vi.groups.full : formErrorMessage(err));
    },
  });

  return (
    <Modal
      open
      title={vi.groups.create}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {vi.common.cancel}
          </Button>
          <Button
            loading={create.isPending}
            disabled={!titleOk || members.length === 0}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            {vi.groups.create}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={vi.groups.title}
          value={title}
          hint={vi.groups.titleCounter(titleLen)}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <UserPicker selected={members} onChange={setMembers} max={GROUP_MAX_MEMBERS - 1} />
        <FormError message={error} />
      </div>
    </Modal>
  );
}
