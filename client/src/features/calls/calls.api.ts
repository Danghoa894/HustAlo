// client/src/features/calls/calls.api.ts — GET /calls (FR-CALL-008), cache Q['calls'] cho tab "Cuộc gọi"
import type { CallPage } from '@hustalo/shared';
import { http } from '../../lib/api/http';

export const callsKey = ['calls'] as const;

export const callsApi = {
  page: (cursor?: string) => http<CallPage>(`/calls${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
};
