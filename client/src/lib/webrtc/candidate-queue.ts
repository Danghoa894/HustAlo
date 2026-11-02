// client/src/lib/webrtc/candidate-queue.ts — ICE candidate đến trước remote description (kiến trúc §7(e)):
// xếp hàng tối đa CALL_ICE_QUEUE_MAX, dedupe theo chuỗi candidate trong cùng revision, candidate revision cũ bị bỏ
// (EC-CALL-SIG-008/009/010). `remoteDescriptionSet(revision)` được gọi sau setRemoteDescription của offer/answer
// revision đó (ICE restart → revision mới, reset hàng đợi).
import { CALL_ICE_QUEUE_MAX } from '@hustalo/shared';

export interface IceCandidateInit {
  candidate: string; // "" = end-of-candidates
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
}

export type OfferResult = 'add' | 'queued' | 'dropped';

export class CandidateQueue {
  private remoteRevision = 0; // revision của remote description đã set (0 = chưa có)
  private pending: { revision: number; cand: IceCandidateInit }[] = [];
  private seen = new Set<string>(); // `${revision}|${candidate}`

  /** Quyết định cho một candidate nhận từ bên kia. 'add' → người gọi addIceCandidate ngay. */
  offer(revision: number, cand: IceCandidateInit): OfferResult {
    if (revision < this.remoteRevision) return 'dropped';
    if (cand.candidate !== '') {
      const key = `${revision}|${cand.candidate}`;
      if (this.seen.has(key)) return 'dropped';
      if (revision === this.remoteRevision) {
        this.seen.add(key);
        return 'add';
      }
      if (this.pending.length >= CALL_ICE_QUEUE_MAX) return 'dropped';
      this.seen.add(key);
    } else if (revision === this.remoteRevision) {
      return 'add';
    }
    this.pending.push({ revision, cand });
    return 'queued';
  }

  /** Remote description revision `revision` vừa set: bỏ candidate revision cũ hơn, giữ lại để xả. */
  remoteDescriptionSet(revision: number): void {
    this.remoteRevision = revision;
    this.pending = this.pending.filter((p) => p.revision >= revision);
    this.seen = new Set([...this.seen].filter((k) => Number(k.slice(0, k.indexOf('|'))) >= revision));
  }

  /** Lấy ra các candidate của revision hiện tại để addIceCandidate. */
  drain(): IceCandidateInit[] {
    const ready = this.pending.filter((p) => p.revision === this.remoteRevision);
    this.pending = this.pending.filter((p) => p.revision !== this.remoteRevision);
    return ready.map((p) => p.cand);
  }

  clear(): void {
    this.pending = [];
    this.seen.clear();
    this.remoteRevision = 0;
  }
}
