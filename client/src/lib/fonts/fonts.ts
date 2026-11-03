// client/src/lib/fonts/fonts.ts — font Inter tự host (ui_ux_spec.md §1.1, NFR-05). Không khai báo @font-face trong CSS:
// đăng ký bằng FontFace API sau lần render đầu (lúc trình duyệt rảnh) để file font không tranh băng thông với JS khởi tạo;
// không gọi load() → trình duyệt chỉ tải subset có ký tự đang hiển thị (unicode-range). Trước đó chữ dùng font fallback
// (system-ui…), sau đó đổi sang Inter (font-display: swap). File woff2 + giấy phép SIL OFL 1.1 ở public/fonts/.

export const INTER_FACES = [
  {
    url: '/fonts/inter-vietnamese.woff2',
    unicodeRange:
      'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, ' +
      'U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
  },
  {
    url: '/fonts/inter-latin-ext.woff2',
    unicodeRange:
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, ' +
      'U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
  {
    url: '/fonts/inter-latin.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, ' +
      'U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
] as const;

const IDLE_TIMEOUT_MS = 2000;
const FALLBACK_DELAY_MS = 1000;
/** Không quan sát được FCP (trình duyệt cũ, tab nền) → vẫn đăng ký sau tối đa chừng này. */
const FCP_WAIT_MAX_MS = 3000;

/** document.fonts — kiểu DOM khai báo luôn có, nhưng trình duyệt cũ (và môi trường không có document) thì không. */
function documentFonts(): FontFaceSet | undefined {
  if (typeof document === 'undefined') return undefined;
  return (document as { fonts?: FontFaceSet }).fonts;
}

/** Đăng ký 3 subset Inter vào `fonts` (document.fonts). false nếu trình duyệt không hỗ trợ FontFace. */
export function registerInterFont(fonts: FontFaceSet | undefined = documentFonts()): boolean {
  if (typeof FontFace === 'undefined' || fonts === undefined) return false;
  for (const f of INTER_FACES) {
    fonts.add(
      new FontFace('Inter', `url(${f.url}) format('woff2')`, {
        weight: '400 700',
        style: 'normal',
        display: 'swap',
        unicodeRange: f.unicodeRange,
      }),
    );
  }
  return true;
}

type IdleHost = {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  PerformanceObserver?: typeof PerformanceObserver;
};

/**
 * Gọi sau createRoot().render(): chờ mốc first-contentful-paint (PerformanceObserver 'paint', tối đa 3 s) rồi đăng ký
 * font lúc rảnh (requestIdleCallback tối đa 2 s; thiếu API → sau 1 s). Đăng ký trước FCP (ví dụ lúc chờ /auth/refresh)
 * sẽ đưa request font vào đường găng của FCP/LCP.
 */
export function scheduleInterFont(host: IdleHost = window, register: () => boolean = () => registerInterFont()): void {
  let done = false;
  const whenIdle = () => {
    if (done) return;
    done = true;
    const run = () => {
      register();
    };
    if (typeof host.requestIdleCallback === 'function') host.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(run, FALLBACK_DELAY_MS);
  };
  const fallback = setTimeout(whenIdle, FCP_WAIT_MAX_MS);
  const PO = host.PerformanceObserver;
  if (typeof PO !== 'function') return;
  try {
    const po = new PO((list) => {
      if (list.getEntriesByName('first-contentful-paint').length === 0) return;
      po.disconnect();
      clearTimeout(fallback);
      whenIdle();
    });
    po.observe({ type: 'paint', buffered: true });
  } catch {
    // trình duyệt không hỗ trợ entry 'paint' → để timeout dự phòng lo
  }
}
