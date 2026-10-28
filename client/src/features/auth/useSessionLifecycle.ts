// client/src/features/auth/useSessionLifecycle.ts — vòng đời phiên phía client (kiến trúc §7(a), D-18; ui_ux_spec.md §3.9, §4.1):
// - có token → socket.connect(); token đổi → disconnect + connect (handshake đọc token mới); hết phiên → disconnect.
// - refresh chủ động trước exp ACCESS_TOKEN_REFRESH_SKEW_S.
// - session:expired / connect_error TOKEN_EXPIRED → refresh; refresh 401 → SessionModal EXPIRED.
// - session:revoked: LOGOUT → /login không modal; lý do khác → SessionModal.
import { ACCESS_TOKEN_REFRESH_SKEW_S, EVENTS, type SessionRevokeReason } from '@hustalo/shared';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { queryClient } from '../../lib/api/queryClient';
import { refreshAccessToken } from '../../lib/api/refresh';
import { bindConnectionState, socket } from '../../lib/socket/socket';
import { useAuthStore } from '../../stores/auth.store';
import { useSocketStore } from '../../stores/socket.store';

async function recover(): Promise<void> {
  try {
    const token = await refreshAccessToken();
    if (!token) useAuthStore.getState().endSession('EXPIRED');
  } catch {
    // Lỗi mạng/503: giữ phiên; socket tự reconnect và gặp lại TOKEN_EXPIRED thì thử lần nữa.
  }
}

export function useSessionLifecycle(): void {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.accessToken);
  const expiresAt = useAuthStore((s) => s.expiresAt);
  const prevToken = useRef<string | null>(null);
  /** Token đã dùng cho lần phục hồi sau connect_error UNAUTHENTICATED — tránh vòng lặp refresh vô hạn. */
  const unauthRecoveredFor = useRef<string | null>(null);

  useEffect(() => bindConnectionState(socket), []);

  useEffect(() => {
    const prev = prevToken.current;
    prevToken.current = token;
    if (token === prev) return;
    if (!token) {
      socket.disconnect();
      return;
    }
    if (prev) socket.disconnect();
    socket.connect();
  }, [token]);

  useEffect(() => {
    if (!token || expiresAt === null) return;
    const delay = Math.max(0, expiresAt - ACCESS_TOKEN_REFRESH_SKEW_S * 1000 - Date.now());
    const timer = setTimeout(() => void recover(), delay);
    return () => {
      clearTimeout(timer);
    };
  }, [token, expiresAt]);

  useEffect(() => {
    const onExpired = () => {
      useSocketStore.getState().setConnectionState('expired');
      void recover();
    };
    const onRevoked = ({ reason }: { reason: SessionRevokeReason }) => {
      if (reason === 'LOGOUT') {
        useAuthStore.getState().signOut();
        queryClient.clear();
        navigate('/login', { replace: true });
        return;
      }
      useAuthStore.getState().endSession(reason);
    };
    const onConnectError = (err: Error) => {
      if (err.message === 'TOKEN_EXPIRED') {
        void recover();
      } else if (err.message === 'UNAUTHENTICATED') {
        const current = useAuthStore.getState().accessToken;
        if (!current) return;
        if (unauthRecoveredFor.current === current) {
          useAuthStore.getState().endSession('EXPIRED');
          return;
        }
        unauthRecoveredFor.current = current;
        void recover();
      }
    };
    const onDisconnect = (reason: string) => {
      // Server ngắt (vd. sau session:expired 5 s) không tự reconnect → refresh rồi connect lại theo token mới.
      if (reason === 'io server disconnect' && useAuthStore.getState().accessToken) void recover();
    };

    socket.on(EVENTS.SESSION_EXPIRED, onExpired);
    socket.on(EVENTS.SESSION_REVOKED, onRevoked);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off(EVENTS.SESSION_EXPIRED, onExpired);
      socket.off(EVENTS.SESSION_REVOKED, onRevoked);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
    };
  }, [navigate]);
}
