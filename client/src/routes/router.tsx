// client/src/routes/router.tsx — bảng route ui_ux_spec.md §2. M0: khung + guard; trang thật thay placeholder từ M1.
// Overlay /call/:callId (Routes thứ hai theo backgroundLocation) thêm ở M5.
import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { EmptyRoomPlaceholder } from '../features/chat/EmptyRoomPlaceholder';
import { vi } from '../i18n/vi';
import { RedirectIfAuthed } from './guards/RedirectIfAuthed';
import { RequireAuth } from './guards/RequireAuth';
import { NotFoundPage } from './NotFoundPage';
import { PagePlaceholder } from './PagePlaceholder';

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/chats" replace /> },
  {
    path: '/login',
    element: (
      <RedirectIfAuthed>
        <PagePlaceholder title={vi.auth.loginTitle} />
      </RedirectIfAuthed>
    ),
  },
  {
    path: '/register',
    element: (
      <RedirectIfAuthed>
        <PagePlaceholder title={vi.auth.registerTitle} />
      </RedirectIfAuthed>
    ),
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: '/chats', element: <EmptyRoomPlaceholder /> },
      { path: '/chats/:conversationId', element: <EmptyRoomPlaceholder /> },
      { path: '/settings', element: <PagePlaceholder title={vi.settings.title} /> },
      { path: '/settings/:section', element: <PagePlaceholder title={vi.settings.title} /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const createAppRouter = () => createBrowserRouter(routes);
