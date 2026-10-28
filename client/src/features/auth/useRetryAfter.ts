// client/src/features/auth/useRetryAfter.ts — đếm ngược Retry-After (giây) sau 429 RATE_LIMITED (EC-SEC-005, EC-AUTH-008)
import { useCallback, useEffect, useState } from 'react';

/** Mặc định khi server không gửi Retry-After: cửa sổ ngắn nhất của rule auth (login 60 s). */
export const DEFAULT_RETRY_AFTER_SEC = 60;

export function useRetryAfter(): { remaining: number; start: (seconds: number | undefined) => void } {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => {
      setRemaining((n) => n - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [remaining]);

  const start = useCallback((seconds: number | undefined) => {
    setRemaining(seconds && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SEC);
  }, []);

  return { remaining, start };
}
