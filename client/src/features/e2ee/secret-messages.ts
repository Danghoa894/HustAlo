// client/src/features/e2ee/secret-messages.ts — điền nội dung tin SECRET trước khi vào cache Q['messages', id]
// (kiến trúc §9.3 "Bản rõ cục bộ"; ui_ux_spec.md §3.3 nội dung đặc biệt của bubble):
// - có bản rõ cục bộ / giải mã được → `content` = bản rõ;
// - không → `content` null + placeholder trong e2ee.store (NOT_FOR_DEVICE / REVOKED_DEVICE / DECRYPT_FAILED);
// - tin bị thu hồi → xóa bản rõ cục bộ.
// Tuần tự theo thứ tự đầu vào (tăng dần theo thời gian) để ratchet nhận tin đúng thứ tự.
import type { Message } from '@hustalo/shared';
import { useE2eeStore } from '../../stores/e2ee.store';
import { getSecretCrypto } from './e2ee-runtime';

let chain: Promise<unknown> = Promise.resolve();

const isSecret = (m: Message) => m.ciphertext !== null || (m.type === 'TEXT' && m.content === null);

async function resolveAll(messages: Message[]): Promise<Message[]> {
  if (!messages.some(isSecret)) return messages;
  const crypto = await getSecretCrypto();
  if (!crypto) return messages;
  const ui = useE2eeStore.getState();
  let sessionsChanged = false;
  const out: Message[] = [];
  for (const m of messages) {
    if (m.deletedAt !== null) {
      ui.setPlaceholder(m.id, null);
      await crypto.forget(m.id).catch(() => undefined);
      out.push(m);
      continue;
    }
    if (m.ciphertext === null || m.content !== null) {
      out.push(m);
      continue;
    }
    const r = await crypto.decryptForThisDevice(m).catch(() => ({ kind: 'DECRYPT_FAILED' as const }));
    if (r.kind === 'TEXT') {
      ui.setPlaceholder(m.id, null);
      if (m.ciphertext.recipients[0]?.type === 3) sessionsChanged = true;
      out.push({ ...m, content: r.text });
    } else {
      ui.setPlaceholder(m.id, r.kind);
      out.push(m);
    }
  }
  if (sessionsChanged) ui.bump(); // session mới từ PreKey message → badge "Mã hóa đầu-cuối" (AC-122)
  return out;
}

/** Điền nội dung cho các tin (giữ thứ tự). Không phải SECRET → trả nguyên. */
export function resolveSecretMessages(messages: Message[]): Promise<Message[]> {
  const run = chain.then(
    () => resolveAll(messages),
    () => resolveAll(messages),
  );
  chain = run.catch(() => undefined);
  return run;
}
