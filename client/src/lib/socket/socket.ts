// client/src/lib/socket/socket.ts — Socket.IO client (kiến trúc §6.4): autoConnect false, WS trước rồi polling
// (EC-NET-010); handshake auth {token, deviceId, tabId} đọc lại mỗi lần connect nên token mới tự được dùng.
// Vòng đời connect/disconnect theo phiên do features/auth/useSessionLifecycle.ts điều khiển.
import type { ClientToServerEvents, ServerToClientEvents } from '@hustalo/shared';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../../stores/auth.store';
import { useSocketStore } from '../../stores/socket.store';
import { getDeviceId, getTabId } from '../device/device-id';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: AppSocket = io(import.meta.env.VITE_SOCKET_URL ?? '', {
  path: '/socket.io',
  autoConnect: false,
  transports: ['websocket', 'polling'],
  tryAllTransports: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
  auth: (cb) => {
    cb({ token: useAuthStore.getState().accessToken, deviceId: getDeviceId(), tabId: getTabId() });
  },
});

/** Phần của socket mà bindConnectionState cần (test truyền socket giả). */
export type ConnectionSource = Pick<AppSocket, 'connected' | 'on' | 'off'>;

/** Ánh xạ event socket + online/offline của trình duyệt → socket.store.connectionState (ui_ux_spec.md §4.1). */
export function bindConnectionState(source: ConnectionSource): () => void {
  const set = useSocketStore.getState().setConnectionState;
  const lost = () => {
    set(navigator.onLine ? 'reconnecting' : 'offline');
  };

  const onConnect = () => {
    set('connected');
  };
  const onDisconnect = (reason: string) => {
    // Chủ động ngắt để connect lại với token mới: chưa phải "mất kết nối".
    if (reason === 'io client disconnect') set('connecting');
    else lost();
  };
  const onConnectError = (err: Error) => {
    if (err.message === 'TOKEN_EXPIRED') set('expired');
    else if (!navigator.onLine) set('offline');
    else if (useSocketStore.getState().connectionState === 'connected') set('reconnecting');
  };
  const onOffline = () => {
    set('offline');
  };
  const onOnline = () => {
    if (source.connected) set('connected');
    else set('reconnecting');
  };

  source.on('connect', onConnect);
  source.on('disconnect', onDisconnect);
  source.on('connect_error', onConnectError);
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  return () => {
    source.off('connect', onConnect);
    source.off('disconnect', onDisconnect);
    source.off('connect_error', onConnectError);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
  };
}
