import { TYPING_TTL_MS } from '@hustalo/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTypingStore } from '../../stores/typing.store';
import { formatLastSeen, typingText } from './presence-text';

describe('lastSeen (FR-PRES-002, ui_ux_spec.md §5.3)', () => {
  const now = new Date(2026, 9, 30, 12, 0).getTime();
  it('"Vừa mới truy cập" / "Truy cập {n} phút trước" / "{n} giờ trước" / "lúc HH:mm DD/MM"', () => {
    expect(formatLastSeen(new Date(now - 30_000).toISOString(), now)).toBe('Vừa mới truy cập');
    expect(formatLastSeen(new Date(now - 5 * 60_000).toISOString(), now)).toBe('Truy cập 5 phút trước');
    expect(formatLastSeen(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('Truy cập 3 giờ trước');
    expect(formatLastSeen(new Date(2026, 9, 28, 8, 5).toISOString(), now)).toBe('Truy cập lúc 08:05 28/10');
  });
});

describe('typing (FR-CHAT-005)', () => {
  afterEach(() => {
    useTypingStore.getState().reset();
    vi.useRealTimers();
  });

  it('DIRECT "đang soạn tin…"; GROUP 1–2 tên, từ 3 người "Nhiều người đang soạn tin…"', () => {
    expect(typingText('DIRECT', ['Bob'])).toBe('đang soạn tin…');
    expect(typingText('GROUP', ['An'])).toBe('An đang soạn tin…');
    expect(typingText('GROUP', ['An', 'Bình'])).toBe('An, Bình đang soạn tin…');
    expect(typingText('GROUP', ['An', 'Bình', 'Chi'])).toBe('Nhiều người đang soạn tin…');
    expect(typingText('GROUP', [])).toBeNull();
  });

  it('tự ẩn sau TYPING_TTL_MS không có isTyping:true mới; isTyping:true mới gia hạn', () => {
    vi.useFakeTimers();
    const s = useTypingStore.getState();
    s.setTyping('c1', 'u1', true);
    vi.advanceTimersByTime(TYPING_TTL_MS - 1000);
    s.setTyping('c1', 'u1', true);
    vi.advanceTimersByTime(TYPING_TTL_MS - 1000);
    expect(useTypingStore.getState().byConversation.c1).toEqual(['u1']);
    vi.advanceTimersByTime(1000);
    expect(useTypingStore.getState().byConversation.c1).toEqual([]);
  });
});
