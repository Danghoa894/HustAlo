// server/src/infra/turn/xirsys.client.ts — gọi Xirsys REST lấy TURN credential ngắn hạn (kiến trúc §9.5).
// Secret chỉ ở server, không bao giờ log hay trả về client.
import { TURN_CREDENTIAL_TTL_S, type IceServer } from '@hustalo/shared';
import { z } from 'zod';

export interface XirsysConfig {
  ident: string;
  secret: string;
  channel: string;
  apiUrl: string;
  timeoutMs: number;
}

/** Lý do lỗi dùng làm nhãn metric `hustalo_ice_servers_fallback_total{reason}`. */
export class XirsysError extends Error {
  constructor(public readonly reason: 'TIMEOUT' | 'NETWORK' | 'PARSE' | `HTTP_${number}`) {
    super(`xirsys: ${reason}`);
  }
}

const url = z.string().regex(/^(stun|turn|turns):/);
const entry = z.object({
  urls: z.union([url, z.array(url).min(1)]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
// "v.iceServers có thể là object hoặc mảng tùy phiên bản API" — chấp nhận cả hai.
const responseSchema = z.object({
  s: z.literal('ok'),
  v: z.object({ iceServers: z.union([entry, z.array(entry).min(1)]) }),
});

export function parseXirsysResponse(body: unknown): { iceServers: IceServer[] } {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new XirsysError('PARSE');
  const list = Array.isArray(parsed.data.v.iceServers) ? parsed.data.v.iceServers : [parsed.data.v.iceServers];
  return {
    iceServers: list.map((e) => ({
      urls: Array.isArray(e.urls) ? e.urls : [e.urls],
      ...(e.username !== undefined ? { username: e.username } : {}),
      ...(e.credential !== undefined ? { credential: e.credential } : {}),
    })),
  };
}

// Xác minh với tài liệu chính thức của Xirsys: PUT /_turn/{channel}, body {"format":"urls","expire":3600}.
export async function fetchXirsysIceServers(cfg: XirsysConfig): Promise<{ iceServers: IceServer[] }> {
  const auth = Buffer.from(`${cfg.ident}:${cfg.secret}`).toString('base64');
  let res: Response;
  try {
    res = await fetch(`${cfg.apiUrl.replace(/\/$/, '')}/_turn/${encodeURIComponent(cfg.channel)}`, {
      method: 'PUT',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'urls', expire: TURN_CREDENTIAL_TTL_S }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (err) {
    throw new XirsysError((err as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK');
  }
  if (!res.ok) throw new XirsysError(`HTTP_${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new XirsysError('PARSE');
  }
  return parseXirsysResponse(body);
}
