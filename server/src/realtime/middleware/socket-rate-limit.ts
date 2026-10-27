// server/src/realtime/middleware/socket-rate-limit.ts — rule rate limit cho từng event C→S (cột "Rate limit"
// bảng event kiến trúc §4.5). withAck dùng ruleForEvent khi handler không chỉ định rule.
import { EVENTS } from '@hustalo/shared';
import type { RateRule } from '../../infra/rate-limit/rate-limiter';

export const EVENT_RATE_RULES: Readonly<Record<string, RateRule>> = {
  [EVENTS.CONVERSATION_JOIN]: 'socketGeneric',
  [EVENTS.CONVERSATION_LEAVE]: 'socketGeneric',
  [EVENTS.MESSAGE_SEND]: 'messageSend',
  [EVENTS.MESSAGE_DELIVERED]: 'socketGeneric',
  [EVENTS.MESSAGE_READ]: 'socketGeneric',
  [EVENTS.MESSAGE_EDIT]: 'socketGeneric',
  [EVENTS.MESSAGE_DELETE]: 'socketGeneric',
  [EVENTS.TYPING_START]: 'typing',
  [EVENTS.TYPING_STOP]: 'typing',
  [EVENTS.PRESENCE_SUBSCRIBE]: 'presenceSubscribe',
  [EVENTS.CALL_INVITE]: 'callInvite',
  [EVENTS.CALL_ACCEPT]: 'socketGeneric',
  [EVENTS.CALL_REJECT]: 'socketGeneric',
  [EVENTS.CALL_CANCEL]: 'socketGeneric',
  [EVENTS.CALL_END]: 'socketGeneric',
  [EVENTS.CALL_OFFER]: 'callSignal',
  [EVENTS.CALL_ANSWER]: 'callSignal',
  [EVENTS.CALL_ICE_CANDIDATE]: 'callSignal',
  [EVENTS.CALL_ICE_RESTART]: 'callSignal',
  [EVENTS.CALL_STATE]: 'callSignal',
};

export const ruleForEvent = (event: string): RateRule | undefined => EVENT_RATE_RULES[event];
