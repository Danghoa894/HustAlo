// client/src/lib/api/queryClient.ts — TanStack Query: cache dữ liệu REST (kiến trúc §2)
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './http';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Không retry lỗi 4xx (quyền, không tồn tại, dữ liệu sai); lỗi mạng/5xx thử lại tối đa 2 lần.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});
