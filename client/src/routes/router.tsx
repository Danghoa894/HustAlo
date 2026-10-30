// client/src/routes/router.tsx — bảng route ui_ux_spec.md §2.
// RootLayout bọc mọi route: useSessionLifecycle (socket + refresh + session:*) và SessionModal cần router để điều hướng.
// Overlay /call/:callId (Routes thứ hai theo backgroundLocation) thêm ở M5.
import { Navigate, Outlet, createBrowserRouter, useParams, type RouteObject } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { ConnectionBanner } from '../components/layout/ConnectionBanner';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { SessionModal } from '../features/auth/SessionModal';
import { useSessionLifecycle } from '../features/auth/useSessionLifecycle';
import { LiveRegions } from '../components/layout/LiveRegions';
import { useChatRuntime } from '../features/chat/useChatRuntime';
import { ChatRoomPane } from '../features/chat/ChatRoomPane';
import { EmptyRoomPlaceholder } from '../features/chat/EmptyRoomPlaceholder';
import { ChatListPane } from '../features/conversations/ChatListPane';
import { useConversationEvents } from '../features/conversations/useConversationEvents';
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

/** /chats, /chats/:id: cột trái ChatListPane; mobile chỉ hiện phòng khi có :conversationId (ui_ux_spec.md §2). */
function ChatsLayout() {
  const { conversationId } = useParams();
  useConversationEvents();
  return (
    <AppShell sidebar={<ChatListPane />} banner={<ConnectionBanner />} detailActive={conversationId !== undefined} />
  );
}

function RootLayout() {
  useSessionLifecycle();
  useChatRuntime(); // outbox tiếp tục gửi cả khi đang ở /settings
  return (
    <>
      <Outlet />
      <SessionModal />
      <LiveRegions />
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
        <ChatsLayout />
      </RequireAuth>
    ),
    children: [
      { path: '/chats', element: <EmptyRoomPlaceholder /> },
      { path: '/chats/:conversationId', element: <ChatRoomPane /> },
    ],
  },
  {
    element: (
      <RequireAuth>
        <AppShell banner={<ConnectionBanner />} />
      </RequireAuth>
    ),
    children: [
      { path: '/settings', element: <SettingsPage /> },
      { path: '/settings/:section', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const createAppRouter = () =>
  createBrowserRouter([{ element: <RootLayout />, children: routes }], { future: ROUTER_FUTURE_FLAGS });
