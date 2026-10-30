// server/src/realtime/handlers/presence.handler.ts — vòng đời lease theo socket + presence:subscribe → presence:snapshot
// (kiến trúc §4.5, §7(d)). Socket join presence:{u} hoặc presence-nols:{u} theo privacy của người xem, rời room còn lại.
import { EVENTS, PresenceSubscribePayload } from '@hustalo/shared';
import type { Logger } from 'pino';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import type { PresenceService } from '../../modules/presence/presence.service';
import { withMeta } from '../emitter';
import type { HustaloServer } from '../gateway';
import { presenceNoLastSeenRoom, presenceRoom } from '../rooms';
import { withAck } from '../with-ack';

export interface PresenceHandlerDeps {
  presence: Pick<PresenceService, 'connect' | 'disconnect' | 'subscribe'>;
  logger: Logger;
  rateLimiters?: RateLimiters;
}

export function registerPresenceHandlers(io: HustaloServer, deps: PresenceHandlerDeps): void {
  const ackDeps = { logger: deps.logger, ...(deps.rateLimiters ? { rateLimiters: deps.rateLimiters } : {}) };
  io.on('connection', (socket) => {
    const auth = socket.data.auth;
    if (!auth) return;
    const me = auth.userId;
    void deps.presence.connect(me, socket.id);
    socket.on('disconnect', () => {
      void deps.presence.disconnect(me, socket.id);
    });

    socket.on(
      EVENTS.PRESENCE_SUBSCRIBE,
      withAck(ackDeps, socket, { event: EVENTS.PRESENCE_SUBSCRIBE, schema: PresenceSubscribePayload }, async (p) => {
        const snap = await deps.presence.subscribe(me, p.userIds);
        for (const id of snap.accepted) {
          const [join, leave] = snap.viewerShowsLastSeen
            ? [presenceRoom(id), presenceNoLastSeenRoom(id)]
            : [presenceNoLastSeenRoom(id), presenceRoom(id)];
          await socket.leave(leave);
          await socket.join(join);
        }
        socket.emit(EVENTS.PRESENCE_SNAPSHOT, withMeta({ users: snap.users, degraded: snap.degraded }));
        return { accepted: snap.accepted };
      }),
    );
  });
}
