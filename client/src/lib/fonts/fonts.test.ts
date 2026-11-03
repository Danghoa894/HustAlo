// client/src/lib/fonts/fonts.test.ts — Inter tự host nạp sau lần render đầu (NFR-05, ui_ux_spec.md §1.1).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTER_FACES, registerInterFont, scheduleInterFont } from './fonts';

class FakeFontFace {
  load = vi.fn();
  constructor(
    public family: string,
    public source: string,
    public descriptors: FontFaceDescriptors,
  ) {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('registerInterFont', () => {
  it('đăng ký 3 subset (latin, latin-ext, vietnamese) weight 400–700, swap; KHÔNG gọi load() để trình duyệt tải theo unicode-range', () => {
    const added: FakeFontFace[] = [];
    vi.stubGlobal('FontFace', FakeFontFace);
    const fonts = { add: (f: FakeFontFace) => added.push(f) };
    expect(registerInterFont(fonts as unknown as FontFaceSet)).toBe(true);
    expect(added.map((f) => f.source)).toEqual(INTER_FACES.map((f) => `url(${f.url}) format('woff2')`));
    expect(added.map((f) => f.source)).toEqual([
      "url(/fonts/inter-vietnamese.woff2) format('woff2')",
      "url(/fonts/inter-latin-ext.woff2) format('woff2')",
      "url(/fonts/inter-latin.woff2) format('woff2')",
    ]);
    for (const f of added) {
      expect(f.family).toBe('Inter');
      expect(f.descriptors).toMatchObject({ weight: '400 700', style: 'normal', display: 'swap' });
      expect(f.descriptors.unicodeRange).toMatch(/^U\+/);
      expect(f.load).not.toHaveBeenCalled();
    }
    expect(added[0]?.descriptors.unicodeRange).toContain('U+1EA0-1EF9'); // dải tiếng Việt
  });

  it('trình duyệt không có FontFace / document.fonts → bỏ qua (dùng font fallback)', () => {
    vi.stubGlobal('FontFace', undefined);
    expect(registerInterFont(undefined)).toBe(false);
  });
});

describe('scheduleInterFont', () => {
  /** PerformanceObserver giả: giữ callback để test bắn mục 'first-contentful-paint'. */
  function fakeObserver() {
    const state: { cb?: (list: { getEntriesByName: (n: string) => unknown[] }) => void; disconnected: boolean } = {
      disconnected: false,
    };
    class PO {
      constructor(cb: NonNullable<typeof state.cb>) {
        state.cb = cb;
      }
      observe = vi.fn((o: unknown) => {
        expect(o).toEqual({ type: 'paint', buffered: true });
      });
      disconnect = () => {
        state.disconnected = true;
      };
    }
    const fire = (names: string[]) => {
      state.cb?.({ getEntriesByName: (n: string) => (names.includes(n) ? [{ name: n }] : []) });
    };
    return { PO, fire, state };
  }

  it('chờ first-contentful-paint rồi mới đăng ký lúc rảnh (requestIdleCallback, timeout 2 s) — font không nằm trên đường găng FCP/LCP', () => {
    vi.useFakeTimers();
    const register = vi.fn(() => true);
    const { PO, fire, state } = fakeObserver();
    let idle: (() => void) | undefined;
    const ric = vi.fn((cb: () => void, opts?: { timeout: number }) => {
      idle = cb;
      expect(opts).toEqual({ timeout: 2000 });
      return 1;
    });
    scheduleInterFont({ requestIdleCallback: ric, PerformanceObserver: PO as never }, register);
    fire(['first-paint']); // chưa phải FCP
    expect(ric).not.toHaveBeenCalled();
    fire(['first-contentful-paint']);
    expect(state.disconnected).toBe(true);
    expect(register).not.toHaveBeenCalled();
    idle?.();
    expect(register).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000); // timeout dự phòng không đăng ký lần hai
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('không quan sát được paint → đăng ký sau tối đa 3 s; thiếu requestIdleCallback (Safari) → setTimeout 1 s', () => {
    vi.useFakeTimers();
    const register = vi.fn(() => true);
    scheduleInterFont({}, register);
    vi.advanceTimersByTime(3000 + 999);
    expect(register).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(register).toHaveBeenCalledTimes(1);
  });
});
