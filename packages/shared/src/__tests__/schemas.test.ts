import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_HTTP_STATUS, ErrorCode } from '../errors';
import { EVENTS } from '../events/event-names';
import {
  CallIcePayload,
  MessageSendPayload,
  NIL_UUID,
  TypingPayload,
  ackErr,
  ackOk,
  clientEnvelope,
} from '../schemas/socket.schema';

const conversationId = '6720a1b2c3d4e5f601234561';
const uuid = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('hợp đồng socket', () => {
  it('đủ 35 event, tên duy nhất, dạng domain:action', () => {
    const names = Object.values(EVENTS);
    expect(names).toHaveLength(35);
    expect(new Set(names).size).toBe(35);
    for (const n of names) expect(n).toMatch(/^[a-z0-9]+:[a-z-]+$/);
    expect(names).not.toContain('message:ack');
    expect(names).not.toContain('call:initiate');
  });

  it('envelope strict: trường lạ (vd userId) → lỗi', () => {
    const env = clientEnvelope(TypingPayload);
    expect(env.safeParse({ requestId: uuid, payload: { conversationId } }).success).toBe(true);
    expect(env.safeParse({ requestId: uuid, payload: { conversationId }, userId: conversationId }).success).toBe(false);
    expect(env.safeParse({ requestId: uuid, payload: { conversationId, userId: conversationId } }).success).toBe(false);
    expect(env.safeParse({ requestId: 'x', payload: { conversationId } }).success).toBe(false);
  });

  it('ACK ok / lỗi', () => {
    expect(ackOk(z.object({})).safeParse({ ok: true, requestId: uuid, data: {} }).success).toBe(true);
    const err = { ok: false, requestId: NIL_UUID, error: { code: 'VALIDATION_ERROR', message: 'x' } };
    expect(ackErr.safeParse(err).success).toBe(true);
    expect(ackErr.safeParse({ ...err, error: { code: 'NOPE', message: 'x' } }).success).toBe(false);
  });

  it('MessageSendPayload: PLAINTEXT chuẩn hóa content, E2EE kèm content → lỗi', () => {
    const plain = MessageSendPayload.parse({
      kind: 'PLAINTEXT',
      conversationId,
      clientMessageId: uuid,
      content: ' chào ',
    });
    expect(plain.kind === 'PLAINTEXT' ? plain.content : null).toBe('chào');
    const e2ee = {
      kind: 'E2EE',
      conversationId,
      clientMessageId: uuid,
      ciphertext: { v: 1, senderDeviceId: uuid, recipients: [{ deviceId: uuid, type: 3, body: 'QUJD' }] },
    };
    expect(MessageSendPayload.safeParse(e2ee).success).toBe(true);
    expect(MessageSendPayload.safeParse({ ...e2ee, content: 'lộ' }).success).toBe(false);
  });

  it('CallIcePayload chấp nhận end-of-candidates (chuỗi rỗng)', () => {
    const candidate = { candidate: '', sdpMid: null, sdpMLineIndex: null, usernameFragment: null };
    expect(CallIcePayload.safeParse({ callId: conversationId, revision: 1, candidate }).success).toBe(true);
  });

  it('mọi ErrorCode có HTTP status', () => {
    for (const code of Object.values(ErrorCode)) expect(ERROR_HTTP_STATUS[code]).toBeTypeOf('number');
  });
});
