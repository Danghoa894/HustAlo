// client/src/features/conversations/useUserSearch.ts — Q['users','search',q] sau debounce 300 ms, chỉ khi q ≥ 2 ký tự
// (ui_ux_spec.md §3.2; FR-USER-001 USER_SEARCH_MIN_QUERY), staleTime 30 s.
import { USER_SEARCH_MIN_QUERY } from '@hustalo/shared';
import { useQuery } from '@tanstack/react-query';
import { useDebounced } from '../../lib/hooks/useDebounced';
import { USER_SEARCH_STALE_MS, conversationKeys, conversationsApi } from './conversations.api';

export const SEARCH_DEBOUNCE_MS = 300;

export function useUserSearch(raw: string) {
  const q = useDebounced(raw.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = q.length >= USER_SEARCH_MIN_QUERY;
  const query = useQuery({
    queryKey: conversationKeys.userSearch(q),
    queryFn: () => conversationsApi.searchUsers(q),
    enabled,
    staleTime: USER_SEARCH_STALE_MS,
  });
  return { q, enabled, users: query.data?.items ?? [], isFetching: query.isFetching };
}
