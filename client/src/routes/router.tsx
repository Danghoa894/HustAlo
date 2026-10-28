// client/src/routes/router.tsx — bảng route ui_ux_spec.md §2.
// RootLayout bọc mọi route: useSessionLifecycle (socket + refresh + session:*) và SessionModal cần router để điều hướng.
// Overlay /call/:callId (Routes thứ hai theo backgroundLocation) thêm ở M5.
import { Navigate, Outlet, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { ConnectionBanner } from '../components/layout/ConnectionBanner';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { SessionModal } from '../features/auth/SessionModal';
import { useSessionLifecycle } from '../features/auth/useSessionLifecycle';
import { EmptyRoomPlaceholder } from '../features/chat/EmptyRoomPlaceholder';
import { SettingsPage } from '../features/settings/SettingsPage';
import { RedirectIfAuthed } from './guards/RedirectIfAuthed';
import { RequireAuth } from './guards/RequireAuth';
import { NotFoundPage } from './NotFoundPage';

/** React Router v7 future flags: bật hết để không còn cảnh báo khi chạy (không dùng action/fetcher nên không đổi hành vi). */
export const ROUTER_FUTURE_FLAGS = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;
export const ROUTER_PROVIDER_FUTURE = { v7_startTransition: true } as const;

function RootLayout() {
  useSessionLifecycle();
  return (
    <>
      <Outlet />
      <SessionModal />
    </>
  );
}

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/chats" replace /> },
  {
    path: '/login',
    element: (
      <RedirectIfAuthed>
        <LoginPage />
      </RedirectIfAuthed>
    ),
  },
  {
    path: '/register',
    element: (
      <RedirectIfAuthed>
        <RegisterPage />
      </RedirectIfAuthed>
    ),
  },
  {
    element: (
      <RequireAuth>
        <AppShell banner={<ConnectionBanner />} />
      </RequireAuth>
    ),
    children: [
      { path: '/chats', element: <EmptyRoomPlaceholder /> },
      { path: '/chats/:conversationId', element: <EmptyRoomPlaceholder /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/settings/:section', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const createAppRouter = () =>
  createBrowserRouter([{ element: <RootLayout />, children: routes }], { future: ROUTER_FUTURE_FLAGS });
