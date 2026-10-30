// client/src/features/users/users.api.ts — chặn / bỏ chặn và danh sách đã chặn (api_spec.yaml /users/{userId}/block,
// GET /users/blocked; FR-USER-004). Sau thao tác: tải lại hội thoại (canMessage/blockedByMe) và danh sách đã chặn.
import type { BlockedUsersResponse } from '@hustalo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '../../lib/api/http';
import { useUiStore } from '../../stores/ui.store';
import { formErrorMessage } from '../auth/form';

export const blockedKey = ['users', 'blocked'] as const;

const blockPath = (userId: string) => `/users/${encodeURIComponent(userId)}/block`;

export const usersApi = {
  block: (userId: string) => http<undefined>(blockPath(userId), { method: 'POST' }),
  unblock: (userId: string) => http<undefined>(blockPath(userId), { method: 'DELETE' }),
  blocked: () => http<BlockedUsersResponse>('/users/blocked'),
};

export function useToggleBlock() {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  return useMutation({
    mutationFn: ({ userId, block }: { userId: string; block: boolean }) =>
      block ? usersApi.block(userId) : usersApi.unblock(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: blockedKey });
    },
    onError: (err) => {
      pushToast('error', formErrorMessage(err));
    },
  });
}
