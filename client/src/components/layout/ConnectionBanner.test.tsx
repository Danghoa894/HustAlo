import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useSocketStore, type ConnectionState } from '../../stores/socket.store';
import { BANNER_DELAY_MS, ConnectionBanner } from './ConnectionBanner';

const setState = (s: ConnectionState) => {
  act(() => {
    useSocketStore.getState().setConnectionState(s);
  });
};
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('ConnectionBanner (ui_ux_spec.md §3.0, §4.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSocketStore.setState({ connectionState: 'connecting' });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('BANNER_DELAY_MS là 2 s', () => {
    expect(BANNER_DELAY_MS).toBe(2000);
  });

  it('connecting lần đầu < 2 s: không hiển thị; ≥ 2 s: "Đang kết nối lại…" (role=status)', () => {
    render(<ConnectionBanner />);
    advance(1999);
    expect(screen.queryByText(t.connection.reconnecting)).toBeNull();
    advance(1);
    expect(screen.getByText(t.connection.reconnecting)).toBeInTheDocument();
    expect(screen.getByText(t.connection.reconnecting).closest('[role="status"]')).not.toBeNull();
  });

  it('TC-NET-002 reconnect nhanh (< 2 s) không làm banner nhấp nháy', () => {
    useSocketStore.setState({ connectionState: 'connected' });
    render(<ConnectionBanner />);
    setState('reconnecting');
    advance(1500);
    setState('connected');
    advance(5000);
    expect(screen.queryByText(t.connection.reconnecting)).toBeNull();
  });

  it('TC-AUTH-002 expired: refresh xong trong 2 s không hiện gì; quá 2 s → banner reconnecting', () => {
    useSocketStore.setState({ connectionState: 'connected' });
    render(<ConnectionBanner />);
    setState('expired');
    advance(1000);
    setState('connected');
    advance(3000);
    expect(screen.queryByText(t.connection.reconnecting)).toBeNull();
    setState('expired');
    advance(2000);
    expect(screen.getByText(t.connection.reconnecting)).toBeInTheDocument();
  });

  it('chuyển reconnecting → expired không đặt lại bộ đếm 2 s', () => {
    useSocketStore.setState({ connectionState: 'connected' });
    render(<ConnectionBanner />);
    setState('reconnecting');
    advance(1500);
    setState('expired');
    advance(500);
    expect(screen.getByText(t.connection.reconnecting)).toBeInTheDocument();
  });

  it('offline → banner "Không có kết nối mạng" ngay lập tức', () => {
    useSocketStore.setState({ connectionState: 'connected' });
    render(<ConnectionBanner />);
    setState('offline');
    expect(screen.getByText(t.connection.offline)).toBeInTheDocument();
  });

  it('connected → ẩn', () => {
    render(<ConnectionBanner />);
    advance(2000);
    setState('connected');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
