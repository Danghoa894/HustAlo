// client/src/lib/socket/emit.ts — emitWithAck(event, payload) → envelope {requestId, payload} (kiến trúc §4.5),
// chờ ACK tối đa SOCKET_ACK_TIMEOUT_MS; quá hạn → AckTimeoutError (người gọi quyết định retry, ví dụ outbox M3).
import { SOCKET_ACK_TIMEOUT_MS, type AckCallback, type AckResponse, type ClientToServerEvents } from '@hustalo/shared';
import { socket } from './socket';

export class AckTimeoutError extends Error {
  override name = 'AckTimeoutError';
}

type EventName = keyof ClientToServerEvents;
type PayloadOf<E extends EventName> = Parameters<ClientToServerEvents[E]>[0]['payload'];
type AckDataOf<E extends EventName> = Parameters<ClientToServerEvents[E]>[1] extends AckCallback<infer D> ? D : never;

/** Phần tối thiểu của socket.timeout(ms).emit(…) (để test bằng emitter giả). */
export interface AckEmitter {
  timeout(ms: number): {
    emit(event: string, envelope: unknown, cb: (err: Error | null, res: unknown) => void): unknown;
  };
}

export function emitWithAck<E extends EventName>(
  event: E,
  payload: PayloadOf<E>,
  target: AckEmitter = socket as unknown as AckEmitter,
): Promise<AckResponse<AckDataOf<E>>> {
  const envelope = { requestId: crypto.randomUUID(), payload };
  return new Promise((resolve, reject) => {
    target.timeout(SOCKET_ACK_TIMEOUT_MS).emit(event, envelope, (err, res) => {
      if (err) reject(new AckTimeoutError(`${event}: không nhận được ACK`));
      else resolve(res as AckResponse<AckDataOf<E>>);
    });
  });
}
