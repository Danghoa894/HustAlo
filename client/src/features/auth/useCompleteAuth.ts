// client/src/features/auth/useCompleteAuth.ts — sau login/register thành công (ui_ux_spec.md §3.1):
// setSession (useSessionLifecycle tự socket.connect()) → nạp Q['me'] → navigate(next hợp lệ ?? /chats)
import type { AuthResponse } from '@hustalo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEFAULT_AUTHED_PATH, safeNext } from '../../routes/guards/safe-next';
import { useAuthStore } from '../../stores/auth.store';
import { ME_QUERY_KEY } from './auth.api';

export function useCompleteAuth(): (res: AuthResponse) => void {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  return useCallback(
    (res: AuthResponse) => {
      useAuthStore.getState().setSession(res);
      queryClient.setQueryData(ME_QUERY_KEY, res.user);
      navigate(safeNext(params.get('next')) ?? DEFAULT_AUTHED_PATH, { replace: true });
    },
    [navigate, params, queryClient],
  );
}
