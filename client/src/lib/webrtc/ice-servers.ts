// client/src/lib/webrtc/ice-servers.ts — GET /calls/ice-servers (kiến trúc §9.5): cache tới expiresAt -
// TURN_REFRESH_BEFORE_S; trước mỗi ICE restart gọi forRestart() để có credential còn hạn rồi pc.setConfiguration
// (EC-CALL-NET-005). Lỗi không cache; các lời gọi đồng thời dùng chung một request.
import { TURN_REFRESH_BEFORE_S, type IceServersResponse } from '@hustalo/shared';
import { http } from '../api/http';

export interface IceServersCacheDeps {
  fetch: () => Promise<IceServersResponse>;
  now?: () => number;
}

export function createIceServersCache(deps: IceServersCacheDeps) {
  const now = deps.now ?? (() => Date.now());
  let current: IceServersResponse | null = null;
  let inflight: Promise<IceServersResponse> | null = null;

  const fresh = (r: IceServersResponse | null): r is IceServersResponse =>
    !!r && Date.parse(r.expiresAt) - now() >= TURN_REFRESH_BEFORE_S * 1000;

  async function load(): Promise<IceServersResponse> {
    if (inflight) return inflight;
    inflight = deps
      .fetch()
      .then((r) => {
        current = r;
        return r;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return {
    get: (): Promise<IceServersResponse> => (fresh(current) ? Promise.resolve(current) : load()),
    /** Như get(): credential còn ≥ 5 phút thì dùng lại, ngược lại lấy mới. */
    forRestart: (): Promise<IceServersResponse> => (fresh(current) ? Promise.resolve(current) : load()),
    clear: () => {
      current = null;
    },
  };
}

export const iceServers = createIceServersCache({
  fetch: () => http<IceServersResponse>('/calls/ice-servers'),
});
