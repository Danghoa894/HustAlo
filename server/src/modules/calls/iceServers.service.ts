// server/src/modules/calls/iceServers.service.ts — GET /calls/ice-servers (kiến trúc §9.5, DG-10):
// cache Redis ice:servers:xirsys 5 phút → Xirsys → lỗi/chưa cấu hình thì fallback STUN_URLS + coturn (không cache).
import {
  ICE_SERVERS_CACHE_TTL_S,
  TURN_CREDENTIAL_TTL_S,
  type IceServer,
  type IceServersResponse,
} from '@hustalo/shared';
import { keys } from '../../infra/redis/keys';
import { XirsysError, type XirsysConfig } from '../../infra/turn/xirsys.client';

export interface IceConfig {
  stunUrls: string[];
  xirsys: XirsysConfig;
  turnFallback: { urls: string[]; username: string; credential: string };
  iceTransportPolicy: 'all' | 'relay';
}

export interface IceCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlS: number): Promise<void>;
}

export interface IceServersDeps {
  config: IceConfig;
  cache: IceCache;
  fetchXirsys: (cfg: XirsysConfig) => Promise<{ iceServers: IceServer[] }>;
  /** Xirsys đã cấu hình nhưng lỗi: metric + log warn (không gọi khi chưa cấu hình — DG-10). */
  onFallback?: (reason: string) => void;
  now?: () => Date;
}

interface Cached {
  iceServers: IceServer[];
  fetchedAt: string;
}

export function createIceServersService(deps: IceServersDeps) {
  const { config, cache } = deps;
  const now = deps.now ?? (() => new Date());
  const expiresFrom = (fetchedAt: Date) => new Date(fetchedAt.getTime() + TURN_CREDENTIAL_TTL_S * 1000).toISOString();
  const configured = config.xirsys.ident !== '' && config.xirsys.secret !== '';

  function fallback(): IceServersResponse {
    const servers: IceServer[] = [{ urls: config.stunUrls }];
    if (config.turnFallback.urls.length > 0) {
      servers.push({
        urls: config.turnFallback.urls,
        username: config.turnFallback.username,
        credential: config.turnFallback.credential,
      });
    }
    return {
      iceServers: servers,
      iceTransportPolicy: config.iceTransportPolicy,
      expiresAt: expiresFrom(now()),
      source: 'FALLBACK',
    };
  }

  async function readCache(): Promise<Cached | null> {
    try {
      const raw = await cache.get(keys.iceServersXirsys());
      if (!raw) return null;
      const v = JSON.parse(raw) as Cached;
      return Array.isArray(v.iceServers) && typeof v.fetchedAt === 'string' ? v : null;
    } catch {
      return null; // Redis lỗi hoặc cache hỏng → gọi Xirsys
    }
  }

  return {
    async get(): Promise<IceServersResponse> {
      if (!configured) return fallback();
      const cached = await readCache();
      if (cached) {
        return {
          iceServers: cached.iceServers,
          iceTransportPolicy: config.iceTransportPolicy,
          expiresAt: expiresFrom(new Date(cached.fetchedAt)),
          source: 'XIRSYS',
        };
      }
      try {
        const { iceServers } = await deps.fetchXirsys(config.xirsys);
        const fetchedAt = now();
        const entry: Cached = { iceServers, fetchedAt: fetchedAt.toISOString() };
        await cache.set(keys.iceServersXirsys(), JSON.stringify(entry), ICE_SERVERS_CACHE_TTL_S).catch(() => undefined);
        return {
          iceServers,
          iceTransportPolicy: config.iceTransportPolicy,
          expiresAt: expiresFrom(fetchedAt),
          source: 'XIRSYS',
        };
      } catch (err) {
        deps.onFallback?.(err instanceof XirsysError ? err.reason : 'UNKNOWN');
        return fallback();
      }
    },
  };
}

export type IceServersService = ReturnType<typeof createIceServersService>;
