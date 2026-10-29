// client/src/lib/hooks/useDebounced.ts — giá trị trễ `ms` (tìm kiếm debounce 300 ms, ui_ux_spec.md §3.2)
import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setV(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return v;
}
