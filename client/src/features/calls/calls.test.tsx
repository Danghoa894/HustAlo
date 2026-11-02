// Unit UI cuộc gọi (ui_ux_spec.md §3.2 tab Cuộc gọi, §3.3 nút gọi, §3.5–3.7, §4.3, §4.4). Controller giả: kiểm màn
// hình đọc S.call đúng và gọi đúng hành động; logic điều phối nằm ở call-controller.test.ts.
import type { CallPage, Conversation } from '@hustalo/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth.store';
import { useCallStore, type ActiveCall } from '../../stores/call.store';
import { jsonResponse, urlOf, userMe } from '../../test/fixtures';
import { renderPage } from '../../test/render';

vi.mock('../../lib/socket/socket', async () => {
  const { FakeSocket } = await import('../../test/fake-socket');
  return { socket: new FakeSocket(), bindConnectionState: () => () => undefined };
});
vi.mock('../../lib/socket/emit', () => ({ emitWithAck: vi.fn(() => Promise.resolve({ ok: true, data: {} })) }));
const support = vi.hoisted(() => {
  const holder: { value: { ok: true } | { ok: false; reason: 'INSECURE_CONTEXT' | 'UNSUPPORTED' } } = {
    value: { ok: true },
  };
  return holder;
});
vi.mock('../../lib/webrtc/support', () => ({ callSupport: () => support.value }));

const { CallOverlay } = await import('./CallOverlay');
const { IncomingCallScreen } = await import('./IncomingCallScreen');
const { RemoteAudio } = await import('./RemoteAudio');
const { RemoteVideo } = await import('./RemoteVideo');
const { CallHistoryList } = await import('./CallHistoryList');
const { ChatHeader } = await import('../chat/ChatHeader');
const { setCallControllerForTest } = await import('./useCallController');
const { formatCallClock } = await import('../../lib/time/format');

const ME = userMe().id;
const BOB = { id: '6720a1b2c3d4e5f601234562', displayName: 'Bob', avatarUrl: null };
const CALL = '6720d1b2c3d4e5f601234701';
const CONV = '6720b1b2c3d4e5f601234501';

const actions = {
  startCall: vi.fn(() => Promise.resolve()),
  answer: vi.fn(() => Promise.resolve()),
  reject: vi.fn(() => Promise.resolve()),
  hangup: vi.fn(),
  toggleMic: vi.fn(),
  toggleCam: vi.fn(),
  dismiss: vi.fn(),
  retry: vi.fn(() => Promise.resolve()),
  callAgain: vi.fn(() => Promise.resolve()),
};

const active = (over: Partial<ActiveCall> = {}): ActiveCall => ({
  callId: CALL,
  conversationId: CONV,
  callType: 'VIDEO',
  role: 'caller',
  peer: BOB,
  status: 'INITIATED',
  version: 1,
  endReason: null,
  connectedAt: null,
  ringExpiresAt: null,
  ...over,
});

const track = (kind: 'audio' | 'video', muted = false) => {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    kind,
    muted,
    addEventListener: (ev: string, fn: () => void) => (listeners[ev] = [...(listeners[ev] ?? []), fn]),
    removeEventListener: (ev: string, fn: () => void) =>
      (listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn)),
    fire(ev: string) {
      this.muted = ev === 'mute';
      for (const f of listeners[ev] ?? []) f();
    },
  };
};
const stream = (...tracks: ReturnType<typeof track>[]) =>
  ({
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((x) => x.kind === 'video'),
    getAudioTracks: () => tracks.filter((x) => x.kind === 'audio'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }) as unknown as MediaStream;

beforeEach(() => {
  useCallStore.getState().reset();
  for (const f of Object.values(actions)) f.mockClear();
  setCallControllerForTest(actions);
  support.value = { ok: true };
  useAuthStore.setState({ user: userMe(), accessToken: 'tok' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('IncomingCallScreen (§3.5)', () => {
  it('cuộc gọi video đến: alertdialog có tên + "Cuộc gọi video đến"; Trả lời / Trả lời bằng âm thanh / Từ chối gọi đúng hành động', () => {
    useCallStore.getState().patch({
      incoming: {
        callId: CALL,
        conversationId: CONV,
        callType: 'VIDEO',
        caller: BOB,
        ringExpiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
    render(<IncomingCallScreen />);
    const dlg = screen.getByRole('alertdialog');
    expect(dlg).toHaveTextContent('Bob');
    expect(dlg).toHaveTextContent('Cuộc gọi video đến');
    fireEvent.click(screen.getByRole('button', { name: 'Trả lời cuộc gọi từ Bob' }));
    expect(actions.answer).toHaveBeenCalledWith({ audioOnly: false });
    fireEvent.click(screen.getByRole('button', { name: 'Trả lời chỉ bằng âm thanh' }));
    expect(actions.answer).toHaveBeenCalledWith({ audioOnly: true });
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối cuộc gọi từ Bob' }));
    expect(actions.reject).toHaveBeenCalled();
  });

  it('cuộc gọi thoại: không có "Trả lời bằng âm thanh"; đang chuẩn bị media → "Đang chuẩn bị micro/camera…"', () => {
    useCallStore.getState().patch({
      incoming: {
        callId: CALL,
        conversationId: CONV,
        callType: 'VOICE',
        caller: BOB,
        ringExpiresAt: '2099-01-01T00:00:00.000Z',
      },
      localPhase: 'PREPARING_MEDIA',
    });
    render(<IncomingCallScreen />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Cuộc gọi thoại đến');
    expect(screen.queryByRole('button', { name: 'Trả lời chỉ bằng âm thanh' })).toBeNull();
    expect(screen.getByText('Đang chuẩn bị micro/camera…')).toBeInTheDocument();
  });

  it('TC-CALL-MEDIA-003 callee bị từ chối quyền → panel "HUSTALO cần quyền…" + "Hướng dẫn cấp quyền", "Đóng"', () => {
    useCallStore.getState().patch({
      incoming: {
        callId: CALL,
        conversationId: CONV,
        callType: 'VIDEO',
        caller: BOB,
        ringExpiresAt: '2099-01-01T00:00:00.000Z',
      },
      mediaError: 'PERMISSION_DENIED',
    });
    render(<IncomingCallScreen />);
    expect(
      screen.getByText('HUSTALO cần quyền dùng micro/camera. Hãy cấp quyền trong cài đặt trình duyệt.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hướng dẫn cấp quyền' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(actions.dismiss).toHaveBeenCalled();
  });
});

describe('CallOverlay — gọi đi (§3.6)', () => {
  it('TC-CALL-MEDIA-004 PREPARING_MEDIA: "Đang chuẩn bị…", quá 3 s "Đang chờ cấp quyền…"; nút "Hủy cuộc gọi" luôn bấm được', () => {
    useCallStore.getState().patch({ call: active({ callId: null, status: null }), localPhase: 'PREPARING_MEDIA' });
    const { rerender } = render(<CallOverlay />);
    expect(screen.getByText('Đang chuẩn bị micro/camera…')).toBeInTheDocument();
    act(() => {
      useCallStore.getState().patch({ waitingPermission: true });
    });
    rerender(<CallOverlay />);
    expect(screen.getByText('Đang chờ cấp quyền micro/camera…')).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Hủy cuộc gọi' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(actions.hangup).toHaveBeenCalled();
  });

  it('INITIATED "Đang gọi…", RINGING "Đang đổ chuông…" (aria-live assertive)', () => {
    useCallStore.getState().patch({ call: active(), localPhase: 'IN_CALL' });
    const { rerender } = render(<CallOverlay />);
    expect(screen.getByText('Đang gọi…').closest('[aria-live]')).toHaveAttribute('aria-live', 'assertive');
    act(() => {
      useCallStore.getState().patch({ call: active({ status: 'RINGING' }) });
    });
    rerender(<CallOverlay />);
    expect(screen.getByText('Đang đổ chuông…')).toBeInTheDocument();
  });

  it('TC-AC-078 TC-CALL-MEDIA-001 không có micro → panel "Không tìm thấy micro…" với "Thử lại" và "Đóng"', () => {
    useCallStore.getState().patch({ call: active({ callId: null, status: null }), mediaError: 'MIC_NOT_FOUND' });
    render(<CallOverlay />);
    expect(screen.getByText('Không tìm thấy micro. Hãy kết nối micro và thử lại.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(actions.retry).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(actions.dismiss).toHaveBeenCalled();
  });

  it('CallEndedNotice: chuỗi §8.6 + "Gọi lại" khi có retry', () => {
    useCallStore.getState().patch({
      call: active({ status: 'MISSED' }),
      ended: { text: 'Không có người trả lời', retry: true, closeAfterMs: 4000 },
    });
    render(<CallOverlay />);
    expect(screen.getByText('Không có người trả lời')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gọi lại' }));
    expect(actions.callAgain).toHaveBeenCalled();
  });
});

describe('CallOverlay — đang gọi (§3.7)', () => {
  it('ACCEPTED → "Đang kết nối…"; RECONNECTING → "Đang kết nối lại…"; CONNECTED → đồng hồ từ connectedAt; poor → "Kết nối yếu"', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-27T10:03:12.000Z') });
    useCallStore.getState().patch({ call: active({ status: 'ACCEPTED' }), localPhase: 'IN_CALL', hasLocalVideo: true });
    const { rerender } = render(<CallOverlay />);
    expect(screen.getByText('Đang kết nối…')).toBeInTheDocument();
    act(() => {
      useCallStore.getState().patch({
        call: active({ status: 'CONNECTED', connectedAt: '2026-10-27T10:00:00.000Z' }),
        networkQuality: 'poor',
      });
    });
    rerender(<CallOverlay />);
    expect(screen.getByText('03:12')).toBeInTheDocument();
    expect(screen.getByText('Kết nối yếu')).toBeInTheDocument();
    act(() => {
      useCallStore
        .getState()
        .patch({ call: active({ status: 'RECONNECTING', connectedAt: '2026-10-27T10:00:00.000Z' }) });
    });
    rerender(<CallOverlay />);
    expect(screen.getByText('Đang kết nối lại…')).toBeInTheDocument();
  });

  it('nút Mic / Camera có aria-pressed + phím M / V; "Kết thúc cuộc gọi" → hangup', () => {
    useCallStore
      .getState()
      .patch({ call: active({ status: 'CONNECTED' }), localPhase: 'IN_CALL', hasLocalVideo: true });
    render(<CallOverlay />);
    const mic = screen.getByRole('button', { name: 'Tắt micro' });
    expect(mic).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(mic);
    expect(actions.toggleMic).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'm' });
    expect(actions.toggleMic).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: 'v' });
    expect(actions.toggleCam).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Kết thúc cuộc gọi' }));
    expect(actions.hangup).toHaveBeenCalled();
  });

  it('VOICE: không có nút camera', () => {
    useCallStore.getState().patch({ call: active({ status: 'CONNECTED', callType: 'VOICE' }), localPhase: 'IN_CALL' });
    render(<CallOverlay />);
    expect(screen.queryByRole('button', { name: 'Tắt camera' })).toBeNull();
  });

  it('đồng hồ ≥ 1 giờ dùng h:mm:ss', () => {
    expect(formatCallClock(59)).toBe('00:59');
    expect(formatCallClock(3725)).toBe('1:02:05');
  });
});

describe('Media phía nhận (§4.3, §4.4)', () => {
  it('TC-CALL-MEDIA-010 audio.play() bị chặn autoplay → nút "Chạm để bật âm thanh"; bấm → play lại, nút ẩn', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(new DOMException('chặn', 'NotAllowedError'))
      .mockResolvedValue(undefined);
    useCallStore.getState().patch({ call: active({ status: 'CONNECTED' }), localPhase: 'IN_CALL' });
    render(
      <>
        <RemoteAudio stream={stream(track('audio'))} />
        <CallOverlay />
      </>,
    );
    const unlock = await screen.findByRole('button', { name: 'Chạm để bật âm thanh' });
    fireEvent.click(unlock);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Chạm để bật âm thanh' })).toBeNull();
    });
    expect(play).toHaveBeenCalledTimes(2);
    play.mockRestore();
  });

  it('TC-CALL-MEDIA-011 track video bên kia mute (chuyển app) → Avatar + "Camera đang tạm dừng"; unmute → hiện lại video', () => {
    const v = track('video');
    render(<RemoteVideo stream={stream(track('audio'), v)} peer={BOB} />);
    expect(screen.queryByText('Camera đang tạm dừng')).toBeNull();
    act(() => {
      v.fire('mute');
    });
    expect(screen.getByText('Camera đang tạm dừng')).toBeInTheDocument();
    act(() => {
      v.fire('unmute');
    });
    expect(screen.queryByText('Camera đang tạm dừng')).toBeNull();
  });

  it('không có track video (VIDEO nhưng người kia thiếu camera) → Avatar + "Camera đang tạm dừng"', () => {
    render(<RemoteVideo stream={stream(track('audio'))} peer={BOB} />);
    expect(screen.getByText('Camera đang tạm dừng')).toBeInTheDocument();
  });
});

describe('Nút gọi trong ChatHeader (§3.3, §6.2)', () => {
  const conv = (over: Partial<Conversation> = {}): Conversation => ({
    id: CONV,
    type: 'DIRECT',
    title: null,
    createdBy: ME,
    memberCount: 2,
    members: [
      {
        userId: ME,
        user: { ...BOB, id: ME, username: 'alice', displayName: 'Alice' },
        role: 'MEMBER',
        joinedAt: '2026-10-01T00:00:00.000Z',
        lastDeliveredMessageId: null,
        lastReadMessageId: null,
      },
      {
        userId: BOB.id,
        user: { ...BOB, username: 'bob' },
        role: 'MEMBER',
        joinedAt: '2026-10-01T00:00:00.000Z',
        lastDeliveredMessageId: null,
        lastReadMessageId: null,
      },
    ],
    lastMessageAt: '2026-10-01T00:00:00.000Z',
    blockedByMe: false,
    canMessage: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  });

  it('DIRECT: "Gọi thoại cho Bob" / "Gọi video cho Bob" → startCall với đúng loại', () => {
    renderPage(<ChatHeader conversation={conv()} />, { path: '/chats/:id', at: `/chats/${CONV}` });
    fireEvent.click(screen.getByRole('button', { name: 'Gọi video cho Bob' }));
    expect(actions.startCall).toHaveBeenCalledWith({ conversationId: CONV, callType: 'VIDEO', peer: BOB });
    fireEvent.click(screen.getByRole('button', { name: 'Gọi thoại cho Bob' }));
    expect(actions.startCall).toHaveBeenLastCalledWith({ conversationId: CONV, callType: 'VOICE', peer: BOB });
  });

  it('TC-AC-086 TC-CALL-SIG-012 GROUP: không có nút gọi (D-22)', () => {
    renderPage(<ChatHeader conversation={conv({ type: 'GROUP', title: 'Nhóm', memberCount: 3 })} />, {
      path: '/chats/:id',
      at: `/chats/${CONV}`,
    });
    expect(screen.queryByRole('button', { name: /Gọi thoại cho/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Gọi video cho/ })).toBeNull();
  });

  it('TC-CALL-MEDIA-009 TC-CALL-MEDIA-008 TC-CALL-SIG-013 thiếu HTTPS / WebRTC / bị chặn → nút aria-disabled + tooltip lý do, bấm không gọi', () => {
    for (const [setup, tip] of [
      [() => (support.value = { ok: false, reason: 'INSECURE_CONTEXT' }), 'Cần kết nối HTTPS để gọi điện'],
      [() => (support.value = { ok: false, reason: 'UNSUPPORTED' }), 'Trình duyệt không hỗ trợ gọi điện'],
    ] as const) {
      setup();
      const { unmount } = renderPage(<ChatHeader conversation={conv()} />, {
        path: '/chats/:id',
        at: `/chats/${CONV}`,
      });
      const btn = screen.getByRole('button', { name: 'Gọi thoại cho Bob' });
      expect(btn).toHaveAttribute('aria-disabled', 'true');
      expect(btn).toHaveAttribute('title', tip);
      fireEvent.click(btn);
      unmount();
    }
    support.value = { ok: true };
    renderPage(<ChatHeader conversation={conv({ canMessage: false })} />, { path: '/chats/:id', at: `/chats/${CONV}` });
    expect(screen.getByRole('button', { name: 'Gọi video cho Bob' })).toHaveAttribute(
      'title',
      'Không thể gọi cho người này',
    );
    expect(actions.startCall).not.toHaveBeenCalled();
  });
});

describe('CallHistoryList (§3.2)', () => {
  it('trống → "Chưa có cuộc gọi nào"; dòng: loại cuộc gọi, thời lượng hoặc nhãn kết cục, nút "Gọi lại cho {tên}"', async () => {
    const page = (items: CallPage['items']): CallPage => ({ items, nextCursor: null });
    const fetchMock = vi.fn((input: unknown) =>
      Promise.resolve(urlOf(input).startsWith('/api/v1/calls') ? jsonResponse(200, page([])) : jsonResponse(404, {})),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderPage(<CallHistoryList />, { path: '/chats' });
    expect(await screen.findByText('Chưa có cuộc gọi nào')).toBeInTheDocument();
    unmount();
    const peer = { ...BOB, username: 'bob' };
    const base = {
      conversationId: CONV,
      peer,
      createdAt: '2026-10-27T09:00:00.000Z',
      connectedAt: null,
      endedAt: null,
    };
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          200,
          page([
            {
              ...base,
              id: 'a'.repeat(24),
              callType: 'VIDEO',
              direction: 'OUTGOING',
              status: 'ENDED',
              endReason: 'HANGUP',
              durationSec: 192,
            },
            {
              ...base,
              id: 'b'.repeat(24),
              callType: 'VOICE',
              direction: 'INCOMING',
              status: 'MISSED',
              endReason: 'TIMEOUT',
              durationSec: null,
            },
          ]),
        ),
      ),
    );
    renderPage(<CallHistoryList />, { path: '/chats' });
    expect(await screen.findByText('03:12')).toBeInTheDocument();
    expect(screen.getByText('Nhỡ')).toBeInTheDocument();
    expect(screen.getByText('Cuộc gọi video')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Gọi lại cho Bob' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Gọi lại cho Bob' })[1] as HTMLElement);
    expect(actions.startCall).toHaveBeenCalledWith({ conversationId: CONV, callType: 'VOICE', peer: BOB });
  });
});
