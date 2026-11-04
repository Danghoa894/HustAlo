// client/src/lib/e2ee/envelope.ts — encryptFanout / decryptForThisDevice (FR-E2EE-004, FR-E2EE-006..008, kiến trúc
// §7(h), §9.3 "Bản rõ cục bộ").
// - Danh bạ device theo user (bundle lần tải gần nhất, trong RAM): ánh xạ UUID device ↔ địa chỉ Signal
//   `(userId, signalDeviceId)`, phát hiện identity đổi, và biết device nào đã bị thu hồi (không còn trong danh bạ).
// - Gửi: recipients = device ACTIVE của peer ∪ device ACTIVE khác của mình; chưa có session → X3DH từ bundle.
//   Identity đổi của device đã xác minh → IdentityBlockedError (chặn gửi tới khi "Chấp nhận", AC-113).
// - Nhận: bản rõ cục bộ → dùng; không có recipient cho device này → NOT_FOR_DEVICE; device gửi không còn trong danh bạ
//   → REVOKED_DEVICE; giải mã lỗi → DECRYPT_FAILED (E2EE_DECRYPT_FAILED, chỉ phía client). Giải mã được → lưu bản rõ.
import { E2EE_ENVELOPE_VERSION, type DeviceIdentity, type Message, type PreKeyBundle } from '@hustalo/shared';
import { b64ToBuffer } from './codec';
import { addressOf, decryptFrom, encryptFor, hasSession, processBundle } from './signal-adapter';
import type { KnownIdentity, SignalStore } from './signal-store';

/** Port REST: bundle cho mọi device ACTIVE của user; user không có device (422) → []. */
export type FetchBundles = (userId: string) => Promise<PreKeyBundle[]>;
/** Port REST chỉ đọc (GET /e2ee/users/{userId}/identities): không tiêu thụ one-time prekey (FR-E2EE-006, KI-10). */
export type FetchIdentities = (userId: string) => Promise<DeviceIdentity[]>;

export interface E2eeEnvelopeOut {
  v: typeof E2EE_ENVELOPE_VERSION;
  senderDeviceId: string;
  recipients: { deviceId: string; type: 1 | 3; body: string }[];
}

export type Decrypted =
  { kind: 'TEXT'; text: string } | { kind: 'NOT_FOR_DEVICE' } | { kind: 'REVOKED_DEVICE' } | { kind: 'DECRYPT_FAILED' };

export class IdentityBlockedError extends Error {
  override name = 'IdentityBlockedError';
  constructor(readonly addresses: string[]) {
    super('Mã an toàn đã thay đổi, cần xác nhận trước khi gửi');
  }
}

interface DirectoryEntry {
  bundle: PreKeyBundle;
  address: string;
}

/** Khóa bản rõ cục bộ: tin đã có id; tin của mình chưa ACK theo clientMessageId (kiến trúc §9.3). */
export const plainKey = {
  message: (messageId: string) => `m:${messageId}`,
  pending: (clientMessageId: string) => `c:${clientMessageId}`,
};

/** Không tải lại danh bạ của cùng một user quá thường (rate limit e2eeBundle 10/phút/user+target). */
const DIRECTORY_MIN_INTERVAL_MS = 10_000;

export interface SecretCryptoOptions {
  store: SignalStore;
  me: { userId: string; deviceId: string };
  fetchBundles: FetchBundles;
  fetchIdentities?: FetchIdentities;
  now?: () => number;
  /** Có identity vừa đổi của user (banner FR-E2EE-006). */
  onIdentityChanged?: (userId: string) => void;
}

export class SecretCrypto {
  private readonly directory = new Map<string, { entries: DirectoryEntry[]; fetchedAt: number }>();
  private readonly loading = new Map<string, Promise<DirectoryEntry[]>>();
  private readonly now: () => number;

  constructor(private readonly opts: SecretCryptoOptions) {
    this.now = opts.now ?? Date.now;
  }

  get store(): SignalStore {
    return this.opts.store;
  }

  /**
   * Danh bạ của user (chính mình: device khác device này). `refresh`: 'force' luôn tải lại (sau CONFLICT, mở hội thoại);
   * 'soft' tải lại nếu lần trước cách ≥ 10 s (gặp device lạ khi nhận tin) — tránh chạm rate limit e2eeBundle.
   */
  async devicesOf(userId: string, refresh: false | 'soft' | 'force' = false): Promise<DirectoryEntry[]> {
    const cached = this.directory.get(userId);
    const recent = cached !== undefined && this.now() - cached.fetchedAt < DIRECTORY_MIN_INTERVAL_MS;
    if (cached && (!refresh || (refresh === 'soft' && recent))) return cached.entries;
    const running = this.loading.get(userId);
    if (running) return running;
    const job = this.load(userId).finally(() => this.loading.delete(userId));
    this.loading.set(userId, job);
    return job;
  }

  private async load(userId: string): Promise<DirectoryEntry[]> {
    const bundles = (await this.opts.fetchBundles(userId)).filter((b) => b.deviceId !== this.opts.me.deviceId);
    const entries: DirectoryEntry[] = [];
    let changed = false;
    for (const bundle of bundles) {
      const address = addressOf(bundle.userId, bundle.signalDeviceId);
      if (await this.notice(address, bundle.deviceId, bundle.identityKey)) changed = true;
      entries.push({ bundle, address });
    }
    this.directory.set(userId, { entries, fetchedAt: this.now() });
    if (changed) this.opts.onIdentityChanged?.(userId);
    return entries;
  }

  /**
   * Ghi nhận identity hiện tại của một device. Khác bản đã biết (đăng ký lại sau khi xóa IndexedDB, EC-E2EE-003) →
   * đánh dấu changed + needsRebuild (session cũ vô dụng). Trả true nếu đổi.
   */
  private async notice(address: string, deviceId: string, identityKey: string): Promise<boolean> {
    const known = await this.store.getIdentity(address);
    const changed = known !== undefined && known.identityKey !== identityKey;
    if (changed) await this.store.saveIdentity(address, b64ToBuffer(identityKey));
    await this.store.linkDevice(address, deviceId, identityKey);
    return changed;
  }

  /**
   * Mở hội thoại SECRET: kiểm tra identity các device của user bằng endpoint chỉ đọc (không tiêu thụ one-time prekey,
   * KI-10). Có đổi → bỏ danh bạ đang giữ (bundle cũ mang identity cũ) để lần gửi sau tải bundle mới.
   */
  async checkIdentities(userId: string): Promise<boolean> {
    if (!this.opts.fetchIdentities) return false;
    const items = (await this.opts.fetchIdentities(userId)).filter((d) => d.deviceId !== this.opts.me.deviceId);
    let changed = false;
    for (const d of items) {
      if (await this.notice(addressOf(userId, d.signalDeviceId), d.deviceId, d.identityKey)) changed = true;
    }
    if (changed) {
      this.directory.delete(userId);
      this.opts.onIdentityChanged?.(userId);
    }
    return changed;
  }

  /** Device của peer có identity đổi mà bản cũ đã xác minh → chặn gửi. */
  async blockedAddresses(userId: string): Promise<string[]> {
    return (await this.store.identitiesOf(userId)).filter((r) => r.changed && r.wasVerified).map((r) => r.address);
  }

  async changedIdentities(userId: string): Promise<KnownIdentity[]> {
    return (await this.store.identitiesOf(userId)).filter((r) => r.changed);
  }

  /** Badge "Mã hóa đầu-cuối": đã có session với ≥ 1 device của peer (AC-122). */
  async hasSessionWith(userId: string): Promise<boolean> {
    for (const r of await this.store.identitiesOf(userId)) {
      if (await hasSession(this.store, r.address)) return true;
    }
    return false;
  }

  /**
   * Mã hóa cho mọi device ACTIVE của peer và device khác của mình (kiến trúc §7(h)). `refresh` = tải lại danh bạ
   * (sau CONFLICT, EC-E2EE-008). Lưu bản rõ theo clientMessageId để chính device này hiển thị được tin của mình.
   */
  async encryptFanout(
    peerId: string,
    clientMessageId: string,
    plaintext: string,
    refresh = false,
  ): Promise<E2eeEnvelopeOut> {
    const [peer, own] = await Promise.all([
      this.devicesOf(peerId, refresh && 'force'),
      this.devicesOf(this.opts.me.userId, refresh && 'force'),
    ]);
    const blocked = await this.blockedAddresses(peerId);
    if (blocked.length > 0) throw new IdentityBlockedError(blocked);
    await this.store.putPlaintext(plainKey.pending(clientMessageId), plaintext);
    const recipients: E2eeEnvelopeOut['recipients'] = [];
    for (const entry of [...peer, ...own]) {
      const rebuild = (await this.store.getIdentity(entry.address))?.needsRebuild === true;
      if (rebuild || !(await hasSession(this.store, entry.address))) {
        await processBundle(this.store, entry.bundle); // thư viện verify chữ ký signed prekey
        await this.store.clearRebuild(entry.address);
      }
      const out = await encryptFor(this.store, entry.address, plaintext);
      recipients.push({ deviceId: entry.bundle.deviceId, ...out });
    }
    return { v: E2EE_ENVELOPE_VERSION, senderDeviceId: this.opts.me.deviceId, recipients };
  }

  /** ACK ok: bản rõ chuyển từ clientMessageId sang messageId. */
  async confirmSent(clientMessageId: string, messageId: string): Promise<void> {
    const text = await this.store.getPlaintext(plainKey.pending(clientMessageId));
    if (text === undefined) return;
    await this.store.putPlaintext(plainKey.message(messageId), text);
    await this.store.deletePlaintext(plainKey.pending(clientMessageId));
  }

  /** Địa chỉ Signal của device gửi theo UUID; chưa biết → tải lại danh bạ người gửi một lần. */
  private async senderAddress(senderId: string, senderDeviceId: string): Promise<string | null> {
    const linked = await this.store.identityByDevice(senderDeviceId);
    const inDirectory = (entries: DirectoryEntry[]) => entries.find((e) => e.bundle.deviceId === senderDeviceId);
    const cached = this.directory.get(senderId)?.entries;
    if (linked && cached && inDirectory(cached)) return linked.address;
    const entries = await this.devicesOf(senderId, 'soft').catch(() => cached ?? []);
    return inDirectory(entries)?.address ?? null;
  }

  /** Nội dung tin SECRET cho device này (thứ tự tạo: gọi tuần tự theo createdAt). */
  async decryptForThisDevice(m: Message): Promise<Decrypted> {
    if (!m.ciphertext || m.deletedAt) return { kind: 'NOT_FOR_DEVICE' };
    const local = await this.store.getPlaintext(plainKey.message(m.id));
    if (local !== undefined) return { kind: 'TEXT', text: local };
    const mine = m.senderId === this.opts.me.userId;
    if (mine && m.clientMessageId) {
      const pending = await this.store.getPlaintext(plainKey.pending(m.clientMessageId));
      if (pending !== undefined) {
        await this.confirmSent(m.clientMessageId, m.id);
        return { kind: 'TEXT', text: pending };
      }
    }
    const recipient = m.ciphertext.recipients.find((r) => r.deviceId === this.opts.me.deviceId);
    if (!recipient) return { kind: 'NOT_FOR_DEVICE' }; // EC-E2EE-006/007: gửi trước khi device này tham gia
    const address = await this.senderAddress(m.senderId, m.ciphertext.senderDeviceId);
    if (!address) return { kind: 'REVOKED_DEVICE' }; // EC-E2EE-005
    try {
      const text = await decryptFrom(this.store, address, recipient.type, recipient.body);
      await this.store.putPlaintext(plainKey.message(m.id), text);
      if (recipient.type === 3) {
        // PreKey message vừa lập session với identity hiện tại của device gửi → không cần X3DH lại khi trả lời.
        await this.store.clearRebuild(address);
        // PreKey message từ identity mới của device đã biết (peer đăng ký lại) → thư viện vừa ghi nhận đổi.
        if ((await this.store.getIdentity(address))?.changed) this.opts.onIdentityChanged?.(m.senderId);
      }
      return { kind: 'TEXT', text };
    } catch {
      // Device đã xóa IndexedDB và sinh khóa mới (cùng deviceId): tin trước đó có recipient nhưng thuộc bộ khóa cũ
      // → hành vi thiết kế, không phải lỗi (EC-E2EE-006). Ngược lại: giải mã thất bại thật (EC-E2EE-004).
      const keysCreatedAt = (await this.store.getMeta())?.createdAt;
      if (keysCreatedAt !== undefined && Date.parse(m.createdAt) < keysCreatedAt) return { kind: 'NOT_FOR_DEVICE' };
      return { kind: 'DECRYPT_FAILED' };
    }
  }

  /** Tin bị thu hồi → xóa bản rõ cục bộ (kiến trúc §9.3). */
  async forget(messageId: string): Promise<void> {
    await this.store.deletePlaintext(plainKey.message(messageId));
  }
}
