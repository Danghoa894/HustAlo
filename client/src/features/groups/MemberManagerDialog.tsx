// client/src/features/groups/MemberManagerDialog.tsx — "Thành viên ({n}/100)" (ui_ux_spec.md §3.4): thêm (OWNER/ADMIN,
// tối đa min(50, 100 - memberCount)), menu theo quyền, xác nhận xóa / chuyển quyền, "Rời nhóm".
import {
  GROUP_ADD_BATCH_MAX,
  GROUP_MAX_MEMBERS,
  type AddMembersResponse,
  type Conversation,
  type Member,
  type UserPublic,
} from '@hustalo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { FormError } from '../auth/FormError';
import { formErrorMessage } from '../auth/form';
import { syncConversation } from '../conversations/cache';
import { conversationKeys, conversationsApi } from '../conversations/conversations.api';
import { MemberRow, type MemberAction } from './MemberRow';
import { UserPicker } from './UserPicker';

/** Toast kết quả thêm thành viên (EC-GROUP-002/003). */
export function addResultToasts(res: AddMembersResponse, names: Map<string, string>): { text: string; ok: boolean }[] {
  const out: { text: string; ok: boolean }[] = [];
  const conflicts = res.skipped.filter((s) => s.code === 'CONFLICT').length;
  if (res.added.length > 0) {
    out.push({
      text: vi.groups.added(res.added.length) + (conflicts > 0 ? vi.groups.alreadyIn(conflicts) : ''),
      ok: true,
    });
  }
  for (const s of res.skipped) {
    if (s.code !== 'CONFLICT') out.push({ text: vi.groups.cannotAdd(names.get(s.userId) ?? ''), ok: false });
  }
  return out;
}

export function MemberManagerDialog({
  conversation,
  onClose,
  onLeave,
}: {
  conversation: Conversation;
  onClose: () => void;
  onLeave: () => void;
}) {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const myRole = conversation.members.find((m) => m.userId === meId)?.role ?? 'MEMBER';
  const canAdd = myRole !== 'MEMBER';
  const room = Math.min(GROUP_ADD_BATCH_MAX, GROUP_MAX_MEMBERS - conversation.memberCount);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<UserPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: MemberAction; member: Member } | null>(null);
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const onFail = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'FORBIDDEN') pushToast('error', vi.groups.forbidden);
    else if (err instanceof ApiError && err.code === 'CONVERSATION_FULL') setError(vi.groups.full);
    else pushToast('error', formErrorMessage(err));
  };
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: conversationKeys.one(conversation.id) });
    await queryClient.invalidateQueries({ queryKey: conversationKeys.list });
  };

  const add = useMutation({
    mutationFn: () =>
      conversationsApi.addMembers(
        conversation.id,
        picked.map((u) => u.id),
      ),
    onSuccess: async (res) => {
      for (const t of addResultToasts(res, new Map(picked.map((u) => [u.id, u.displayName])))) {
        pushToast(t.ok ? 'success' : 'warning', t.text);
      }
      setPicked([]);
      setAdding(false);
      await refresh();
    },
    onError: onFail,
  });

  const act = useMutation({
    mutationFn: async ({ action, member }: { action: MemberAction; member: Member }) => {
      if (action === 'REMOVE') {
        await conversationsApi.removeMember(conversation.id, member.userId);
        return null;
      }
      const role = action === 'MAKE_ADMIN' ? 'ADMIN' : action === 'REMOVE_ADMIN' ? 'MEMBER' : 'OWNER';
      return conversationsApi.changeRole(conversation.id, member.userId, role);
    },
    onSuccess: async (conv) => {
      setPending(null);
      if (conv) await syncConversation(queryClient, conv);
      else await refresh();
    },
    onError: (err) => {
      setPending(null);
      onFail(err);
    },
  });

  const onAction = (action: MemberAction, member: Member) => {
    if (action === 'REMOVE' || action === 'TRANSFER') setPending({ action, member });
    else act.mutate({ action, member });
  };

  return (
    <>
      <Modal open title={vi.groups.members(conversation.memberCount)} onClose={onClose}>
        <div className="flex flex-col gap-3">
          {canAdd && !adding ? (
            <div>
              <Button
                variant="secondary"
                disabled={room <= 0}
                onClick={() => {
                  setAdding(true);
                }}
              >
                <UserPlus size={20} aria-hidden="true" />
                {vi.groups.addMembers}
              </Button>
            </div>
          ) : null}
          {adding ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <UserPicker
                selected={picked}
                onChange={setPicked}
                max={room}
                excludeIds={new Set(conversation.members.map((m) => m.userId))}
              />
              <FormError message={error} />
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAdding(false);
                    setPicked([]);
                    setError(null);
                  }}
                >
                  {vi.common.cancel}
                </Button>
                <Button
                  loading={add.isPending}
                  disabled={picked.length === 0}
                  onClick={() => {
                    setError(null);
                    add.mutate();
                  }}
                >
                  {vi.groups.addMembers}
                </Button>
              </div>
            </div>
          ) : null}
          <ul role="list" aria-label={vi.groups.members(conversation.memberCount)} className="max-h-96 overflow-y-auto">
            {conversation.members.map((m) => (
              <MemberRow key={m.userId} member={m} meId={meId} myRole={myRole} onAction={onAction} />
            ))}
          </ul>
          <div className="border-t border-border pt-3">
            <Button variant="danger" onClick={onLeave}>
              {vi.groups.leave}
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={pending !== null}
        title={
          pending
            ? pending.action === 'REMOVE'
              ? vi.groups.confirmRemove(pending.member.user.displayName)
              : vi.groups.confirmTransfer(pending.member.user.displayName)
            : ''
        }
        confirmLabel={pending?.action === 'REMOVE' ? vi.groups.remove : vi.groups.transfer}
        loading={act.isPending}
        onConfirm={() => {
          if (pending) act.mutate(pending);
        }}
        onCancel={() => {
          setPending(null);
        }}
      />
    </>
  );
}
