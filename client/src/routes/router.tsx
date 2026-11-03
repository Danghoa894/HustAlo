// client/src/routes/router.tsx — bảng route ui_ux_spec.md §2.
// RootLayout bọc mọi route: useSessionLifecycle (socket + refresh + session:*) và SessionModal cần router để điều hướng.
// M5: useCallController + CallOverlay / IncomingCallScreen trong RootLayout (lớp phủ đọc S.call trên mọi route);
// /call/:callId giữ URL cuộc gọi và vẽ trang nền theo state.backgroundLocation (ui_ux_spec.md §2) — xem AppRoutes.
import { useEffect, type ReactNode } from 'react';
import {
  Navigate,
  createBrowserRouter,
  matchPath,
  useLocation,
  useParams,
  useRoutes,
  type RouteObject,
} from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { ConnectionBanner } from '../components/layout/ConnectionBanner';
import { LoginPage } from '../features/auth/LoginPage';
import { CallOverlay } from '../features/calls/CallOverlay';
import { IncomingCallScreen } from '../features/calls/IncomingCallScreen';
import { useCallController } from '../features/calls/useCallController';
import { vi } from '../i18n/vi';
import { useCallStore } from '../stores/call.store';
import { useUiStore } from '../stores/ui.store';
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
  useCallController();
  return (
    <>
      <AppRoutes />
      <CallOverlay />
      <IncomingCallScreen />
      <SessionModal />
      <LiveRegions />
    </>
  );
}

const pageRoutes: RouteObject[] = [
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

/** /call/:callId: không có cuộc gọi khớp trong S.call → /chats + toast "Cuộc gọi đã kết thúc" (CallRouteGuard, §2). */
function CallRouteGuard({ callId, children }: { callId: string | undefined; children: ReactNode }) {
  const active = useCallStore((s) => (callId !== undefined && s.call?.callId === callId) || s.ended !== null);
  useEffect(() => {
    if (!active) useUiStore.getState().pushToast('call', vi.calls.ended.HANGUP);
  }, [active]);
  if (!active) return <Navigate to="/chats" replace />;
  return <>{children}</>;
}

/**
 * Bảng route của app. /call/:callId không phải route cha của trang nền: useRoutes(…, location khác) đòi pathname bắt
 * đầu bằng phần URL mà route cha đã khớp, nên trang nền (state.backgroundLocation, mặc định /chats) được vẽ từ chính
 * cấp này — router gốc chỉ có một route `*`.
 */
export function AppRoutes({ pages = pageRoutes }: { pages?: RouteObject[] }) {
  const location = useLocation();
  const call = matchPath('/call/:callId', location.pathname);
  const bg = (location.state as { backgroundLocation?: string } | null)?.backgroundLocation ?? '/chats';
  const page = useRoutes(pages, call ? { pathname: bg.startsWith('/call/') ? '/chats' : bg } : location);
  if (!call) return page;
  return (
    <RequireAuth>
      <CallRouteGuard callId={call.params.callId}>{page}</CallRouteGuard>
    </RequireAuth>
  );
}

export const createAppRouter = () =>
  createBrowserRouter([{ path: '*', element: <RootLayout /> }], { future: ROUTER_FUTURE_FLAGS });
