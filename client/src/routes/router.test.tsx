// client/src/routes/router.test.tsx — /call/:callId vẽ trang nền theo state.backgroundLocation (ui_ux_spec.md §2).
// Hồi quy E2E TC-AC-070: trước đây CallRoute nằm dưới route /call/:callId rồi gọi useRoutes(…, { pathname: '/chats/…' })
// → React Router ném "the location pathname must begin with the portion of the URL pathname that was matched by all
// parent routes" và cả app sập ngay khi bấm gọi.
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';
import { useCallStore } from '../stores/call.store';
import { useUiStore } from '../stores/ui.store';
import { vi as t } from '../i18n/vi';
import { AppRoutes } from './router';

const pages: RouteObject[] = [
  { path: '/chats', element: <p>danh sách</p> },
  { path: '/chats/:conversationId', element: <p>phòng chat</p> },
];

function renderAt(entry: { pathname: string; state?: unknown }) {
  const router = createMemoryRouter([{ path: '*', element: <AppRoutes pages={pages} /> }], {
    initialEntries: [entry],
  });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'tok', bootstrapped: true });
});
afterEach(() => {
  useCallStore.getState().reset();
  useAuthStore.setState({ accessToken: null });
});

describe('AppRoutes — route cuộc gọi (ui_ux_spec.md §2)', () => {
  it('route thường → trang tương ứng', () => {
    renderAt({ pathname: '/chats/abc' });
    expect(screen.getByText('phòng chat')).toBeInTheDocument();
  });

  it('/call/:callId có cuộc gọi khớp → vẽ trang nền backgroundLocation, không sập', () => {
    useCallStore.getState().patch({
      call: {
        callId: 'c1',
        conversationId: 'abc',
        callType: 'VOICE',
        role: 'caller',
        peer: { id: 'u2', displayName: 'Bob', avatarUrl: null },
        status: 'RINGING',
        version: 1,
        endReason: null,
        connectedAt: null,
        ringExpiresAt: null,
      },
    });
    const router = renderAt({ pathname: '/call/c1', state: { backgroundLocation: '/chats/abc' } });
    expect(screen.getByText('phòng chat')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/call/c1');
  });

  it('/call/:callId không có backgroundLocation → nền /chats', () => {
    useCallStore.getState().patch({ ended: { text: 'x', retry: false, closeAfterMs: 1000 } });
    renderAt({ pathname: '/call/c1' });
    expect(screen.getByText('danh sách')).toBeInTheDocument();
  });

  it('/call/:callId không còn cuộc gọi → /chats + toast "Cuộc gọi đã kết thúc"', async () => {
    const router = renderAt({ pathname: '/call/zzz', state: { backgroundLocation: '/chats/abc' } });
    expect(await screen.findByText('danh sách')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/chats');
    expect(useUiStore.getState().toasts.map((x) => x.text)).toContain(t.calls.ended.HANGUP);
  });
});
