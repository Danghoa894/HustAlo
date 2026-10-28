import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocketStore } from '../../stores/socket.store';
import { FakeSocket } from '../../test/fake-socket';
import { bindConnectionState, type ConnectionSource } from './socket';

describe('lib/socket bindConnectionState (ui_ux_spec.md §4.1)', () => {
  let s: FakeSocket;
  let unbind: () => void;
  const state = () => useSocketStore.getState().connectionState;

  beforeEach(() => {
    useSocketStore.setState({ connectionState: 'connecting' });
    s = new FakeSocket();
    unbind = bindConnectionState(s as unknown as ConnectionSource);
  });

  afterEach(() => {
    unbind();
    vi.restoreAllMocks();
  });

  it('connect → connected', () => {
    s.emit('connect');
    expect(state()).toBe('connected');
  });

  it('TC-NET-002 mất kết nối không do người dùng, còn mạng → reconnecting', () => {
    s.emit('connect');
    s.emit('disconnect', 'transport close');
    expect(state()).toBe('reconnecting');
  });

  it('mất kết nối khi navigator.onLine = false → offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    s.emit('connect');
    s.emit('disconnect', 'transport close');
    expect(state()).toBe('offline');
  });

  it('TC-AUTH-002 connect_error TOKEN_EXPIRED → expired', () => {
    s.emit('connect_error', new Error('TOKEN_EXPIRED'));
    expect(state()).toBe('expired');
  });

  it('sự kiện offline → offline; online → reconnecting (chưa connect lại)', () => {
    window.dispatchEvent(new Event('offline'));
    expect(state()).toBe('offline');
    window.dispatchEvent(new Event('online'));
    expect(state()).toBe('reconnecting');
  });

  it('client chủ động ngắt (đổi token) → connecting, không hiện "mất kết nối"', () => {
    s.emit('connect');
    s.emit('disconnect', 'io client disconnect');
    expect(state()).toBe('connecting');
  });
});
