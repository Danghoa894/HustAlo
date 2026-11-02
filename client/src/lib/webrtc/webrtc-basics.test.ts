// Unit: support.ts (EC-CALL-MEDIA-008/009) và candidate-queue.ts (EC-CALL-SIG-008/009/010; kiến trúc §7(e), §7(f)).
import { CALL_ICE_QUEUE_MAX } from '@hustalo/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CandidateQueue, type IceCandidateInit } from './candidate-queue';
import { callSupport } from './support';

const cand = (n: number): IceCandidateInit => ({
  candidate: `candidate:${n} 1 udp 1 10.0.0.${n % 250} 5000 typ host`,
  sdpMid: '0',
  sdpMLineIndex: 0,
  usernameFragment: null,
});

describe('callSupport (EC-CALL-MEDIA-008/009)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('TC-CALL-MEDIA-009 không phải secure context (HTTP qua LAN) → INSECURE_CONTEXT', () => {
    vi.stubGlobal('isSecureContext', false);
    vi.stubGlobal('RTCPeerConnection', vi.fn());
    expect(callSupport({ isSecureContext: false, hasPeerConnection: true, hasGetUserMedia: true })).toEqual({
      ok: false,
      reason: 'INSECURE_CONTEXT',
    });
  });

  it('TC-CALL-MEDIA-008 thiếu RTCPeerConnection hoặc getUserMedia → UNSUPPORTED; đủ cả → ok', () => {
    expect(callSupport({ isSecureContext: true, hasPeerConnection: false, hasGetUserMedia: true })).toEqual({
      ok: false,
      reason: 'UNSUPPORTED',
    });
    expect(callSupport({ isSecureContext: true, hasPeerConnection: true, hasGetUserMedia: false })).toEqual({
      ok: false,
      reason: 'UNSUPPORTED',
    });
    expect(callSupport({ isSecureContext: true, hasPeerConnection: true, hasGetUserMedia: true })).toEqual({
      ok: true,
    });
  });

  it('đọc môi trường thật khi không truyền tham số (jsdom: không có RTCPeerConnection → UNSUPPORTED)', () => {
    vi.stubGlobal('isSecureContext', true);
    expect(callSupport()).toEqual({ ok: false, reason: 'UNSUPPORTED' });
  });
});

describe('CandidateQueue (EC-CALL-SIG-008/009/010)', () => {
  it('TC-CALL-SIG-008 candidate đến trước remote description → xếp hàng; setRemoteDescription xong → xả đúng thứ tự', () => {
    const q = new CandidateQueue();
    expect(q.offer(1, cand(1))).toBe('queued');
    expect(q.offer(1, cand(2))).toBe('queued');
    q.remoteDescriptionSet(1);
    expect(q.drain()).toEqual([cand(1), cand(2)]);
    expect(q.drain()).toEqual([]);
    expect(q.offer(1, cand(3))).toBe('add'); // đã có remote description cùng revision → add ngay
  });

  it(`TC-CALL-SIG-008 hàng đợi tối đa ${CALL_ICE_QUEUE_MAX}: vượt → bỏ candidate mới`, () => {
    const q = new CandidateQueue();
    for (let i = 0; i < CALL_ICE_QUEUE_MAX; i += 1) expect(q.offer(1, cand(i))).toBe('queued');
    expect(q.offer(1, cand(9999))).toBe('dropped');
    q.remoteDescriptionSet(1);
    expect(q.drain()).toHaveLength(CALL_ICE_QUEUE_MAX);
  });

  it('TC-CALL-SIG-009 candidate trùng chuỗi (đang chờ hoặc đã add) → bỏ', () => {
    const q = new CandidateQueue();
    expect(q.offer(1, cand(1))).toBe('queued');
    expect(q.offer(1, cand(1))).toBe('dropped');
    q.remoteDescriptionSet(1);
    expect(q.drain()).toEqual([cand(1)]);
    expect(q.offer(1, cand(1))).toBe('dropped');
    expect(q.offer(1, { ...cand(2), candidate: '' })).toBe('add'); // end-of-candidates luôn qua, không dedupe
    expect(q.offer(1, { ...cand(2), candidate: '' })).toBe('add');
  });

  it('TC-CALL-SIG-010 candidate revision cũ hơn remote description hiện tại → bỏ; revision mới hơn → chờ offer mới (ICE restart)', () => {
    const q = new CandidateQueue();
    q.remoteDescriptionSet(1);
    expect(q.offer(2, cand(5))).toBe('queued'); // offer revision 2 chưa tới
    q.remoteDescriptionSet(2); // reset theo revision 2: bỏ mọi candidate revision cũ, xả revision 2
    expect(q.drain()).toEqual([cand(5)]);
    expect(q.offer(1, cand(6))).toBe('dropped');
    expect(q.offer(2, cand(1))).toBe('add'); // dedupe theo revision: cùng chuỗi ở revision mới vẫn add
  });
});
