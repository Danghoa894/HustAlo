// client/src/lib/webrtc/support.ts — kiểm tra trình duyệt gọi được không (kiến trúc §7(e), EC-CALL-MEDIA-008/009):
// cần secure context (HTTPS hoặc localhost), RTCPeerConnection và mediaDevices.getUserMedia. Thiếu → ẩn/khóa nút gọi.
export type CallSupport = { ok: true } | { ok: false; reason: 'INSECURE_CONTEXT' | 'UNSUPPORTED' };

export interface SupportEnv {
  isSecureContext: boolean;
  hasPeerConnection: boolean;
  hasGetUserMedia: boolean;
}

function readEnv(): SupportEnv {
  return {
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext,
    hasPeerConnection: typeof RTCPeerConnection !== 'undefined',
    hasGetUserMedia:
      typeof navigator !== 'undefined' &&
      typeof (navigator.mediaDevices as MediaDevices | undefined)?.getUserMedia === 'function',
  };
}

export function callSupport(env: SupportEnv = readEnv()): CallSupport {
  if (!env.isSecureContext) return { ok: false, reason: 'INSECURE_CONTEXT' };
  if (!env.hasPeerConnection || !env.hasGetUserMedia) return { ok: false, reason: 'UNSUPPORTED' };
  return { ok: true };
}
