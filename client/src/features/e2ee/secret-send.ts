// client/src/features/e2ee/secret-send.ts — gửi tin SECRET qua outbox (FR-E2EE-004, kiến trúc §7(h)):
// mã hóa cho mọi device → message:send kind E2EE; ACK CONFLICT (danh sách device đổi, EC-E2EE-008 / AC-121) → tải lại
// bundle và mã hóa lại, tối đa 2 lần rồi trả CONFLICT để outbox chuyển FAILED. Bubble giữ PENDING trong lúc đó.
// Identity đã xác minh bị đổi → IdentityBlockedError (ném = lỗi tạm thời, outbox giữ PENDING tới khi "Chấp nhận").
import { EVENTS } from '@hustalo/shared';
import type { SendAck } from '../../lib/outbox/outbox';
import type { OutboxItem } from '../../lib/outbox/outbox.db';
import { emitWithAck } from '../../lib/socket/emit';
import { useE2eeStore } from '../../stores/e2ee.store';
import { getSecretCrypto, whenDeviceKeysReady } from './e2ee-runtime';

/** PRD FR-E2EE-004: "tải lại bundle và mã hóa lại tự động (tối đa 2 lần, sau đó FAILED)". */
const CONFLICT_RETRIES = 2;

export async function sendSecret(item: OutboxItem & { peerId: string }): Promise<SendAck> {
  const crypto = await getSecretCrypto();
  if (!crypto || !(await whenDeviceKeysReady())) throw new Error('Thiết bị chưa sẵn sàng trò chuyện bí mật');
  for (let attempt = 0; ; attempt += 1) {
    const ciphertext = await crypto.encryptFanout(item.peerId, item.clientMessageId, item.content, attempt > 0);
    const ack: SendAck = await emitWithAck(EVENTS.MESSAGE_SEND, {
      kind: 'E2EE',
      conversationId: item.conversationId,
      clientMessageId: item.clientMessageId,
      ciphertext,
    });
    if (ack.ok) {
      await crypto.confirmSent(item.clientMessageId, ack.data.message.id);
      useE2eeStore.getState().bump(); // tin đầu vừa lập session phía mình
      return { ...ack, data: { ...ack.data, message: { ...ack.data.message, content: item.content } } };
    }
    if (ack.error.code !== 'CONFLICT' || attempt >= CONFLICT_RETRIES) return ack;
  }
}
