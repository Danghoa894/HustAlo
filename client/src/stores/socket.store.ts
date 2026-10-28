// client/src/stores/socket.store.ts — trạng thái kết nối realtime cho ConnectionBanner (ui_ux_spec.md §3.0, §4.1)
import { create } from 'zustand';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'expired';

interface SocketState {
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;
}

export const useSocketStore = create<SocketState>((set) => ({
  connectionState: 'connecting',
  setConnectionState: (connectionState) => {
    set({ connectionState });
  },
}));
