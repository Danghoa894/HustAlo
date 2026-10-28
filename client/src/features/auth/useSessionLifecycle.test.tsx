import { ACCESS_TOKEN_REFRESH_SKEW_S, EVENTS } from '@hustalo/shared';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth.store';
import { authResponse } from '../../test/fixtures';
import { FakeSocket } from '../../test/fake-socket';

const fake = vi.hoisted(() => ({ socket: null as unknown as FakeSocket }));
vi.mock('../../lib/socket/socket', async () => {
  const { FakeSocket: Fake } = await import('../../test/fake-socket');
  fake.socket = new Fake();
  return { socket: fake.socket, bindConnectionState: () => () => undefined };
});
const refreshMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock('../../lib/api/refresh', () => ({ refreshAccessToken: refreshMock }));

const { useSessionLifecycle } = await import('./useSessionLifecycle');

function Probe() {
  useSessionLifecycle();
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function mount(path = '/chats') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const login = (token = 'tok-1', ttlMs = 15 * 60_000) => {
  act(() => {
    useAuthStore.getState().setSession(authResponse(token, ttlMs));
  });
};
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe('features/auth/useSessionLifecycle (kiến trúc D-18, ui_ux_spec.md §3.9)', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, expiresAt: null, user: null, bootstrapped: true, sessionEnded: null });
    refreshMock.mockReset();
    fake.socket.connect.mockClear();
    fake.socket.disconnect.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('có phiên → socket.connect(); token đổi → disconnect + connect lại với token mới; hết phiên → disconnect', () => {
    mount();
    login('a');
    expect(fake.socket.connect).toHaveBeenCalledTimes(1);
    login('b');
    expect(fake.socket.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.socket.connect).toHaveBeenCalledTimes(2);
    act(() => {
      useAuthStore.getState().clearSession();
    });
    expect(fake.socket.disconnect).toHaveBeenCalledTimes(2);
  });

  it(`refresh chủ động trước exp ${ACCESS_TOKEN_REFRESH_SKEW_S} s (ACCESS_TOKEN_REFRESH_SKEW_S)`, () => {
    vi.useFakeTimers();
    refreshMock.mockResolvedValue('next');
    mount();
    login('a', 5 * 60_000);
    vi.advanceTimersByTime(5 * 60_000 - ACCESS_TOKEN_REFRESH_SKEW_S * 1000 - 1);
    expect(refreshMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('TC-AUTH-002 session:expired → refresh; thành công không mở modal', async () => {
    refreshMock.mockResolvedValue('fresh');
    mount();
    login('a');
    act(() => {
      fake.socket.emit(EVENTS.SESSION_EXPIRED, { reason: 'TOKEN_EXPIRED', expiredAt: new Date().toISOString() });
    });
    await flush();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().sessionEnded).toBeNull();
  });

  it('TC-AUTH-002 session:expired + refresh 401 → SessionModal EXPIRED', async () => {
    refreshMock.mockResolvedValue(null);
    mount();
    login('a');
    act(() => {
      fake.socket.emit(EVENTS.SESSION_EXPIRED, { reason: 'TOKEN_EXPIRED', expiredAt: new Date().toISOString() });
    });
    await flush();
    expect(useAuthStore.getState().sessionEnded).toBe('EXPIRED');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('TC-AUTH-002 connect_error TOKEN_EXPIRED → refresh rồi connect lại', async () => {
    refreshMock.mockImplementation(() => {
      useAuthStore.getState().setSession(authResponse('fresh'));
      return Promise.resolve('fresh');
    });
    mount();
    login('a');
    fake.socket.connect.mockClear();
    act(() => {
      fake.socket.emit('connect_error', new Error('TOKEN_EXPIRED'));
    });
    await flush();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fake.socket.connect).toHaveBeenCalled();
  });

  it.each([
    ['TC-AUTH-004', 'REFRESH_REUSE'],
    ['TC-AUTH-005', 'ACCOUNT_LOCKED'],
    ['TC-AUTH-006', 'PASSWORD_CHANGED'],
    ['TC-AUTH-006', 'DEVICE_REVOKED'],
  ] as const)('%s session:revoked %s → xóa token, mở SessionModal với lý do đó', (_id, reason) => {
    mount();
    login('a');
    act(() => {
      fake.socket.emit(EVENTS.SESSION_REVOKED, { reason });
    });
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().sessionEnded).toBe(reason);
  });

  it('session:revoked LOGOUT (tab khác đăng xuất) → không modal, chuyển thẳng /login', () => {
    mount('/settings');
    login('a');
    act(() => {
      fake.socket.emit(EVENTS.SESSION_REVOKED, { reason: 'LOGOUT' });
    });
    expect(useAuthStore.getState().sessionEnded).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(where()).toBe('/login');
  });

  it('gỡ listener khi unmount', () => {
    const { unmount } = mount();
    expect(fake.socket.listenerCount(EVENTS.SESSION_REVOKED)).toBe(1);
    unmount();
    expect(fake.socket.listenerCount(EVENTS.SESSION_REVOKED)).toBe(0);
    expect(fake.socket.listenerCount(EVENTS.SESSION_EXPIRED)).toBe(0);
  });
});
