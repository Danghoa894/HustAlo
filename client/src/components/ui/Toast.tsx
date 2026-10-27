// client/src/components/ui/Toast.tsx — ToastViewport: góc dưới phải (desktop), dưới giữa (mobile); lỗi dùng role="alert"
import { useEffect } from 'react';
import { vi } from '../../i18n/vi';
import { TOAST_DURATION_MS, useUiStore, type ToastItem } from '../../stores/ui.store';

const TONES: Record<ToastItem['tone'], string> = {
  success: 'border-success',
  warning: 'border-warning',
  error: 'border-danger',
  call: 'border-primary',
};

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  useEffect(() => {
    const timer = setTimeout(() => {
      dismiss(toast.id);
    }, TOAST_DURATION_MS[toast.tone]);
    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, toast.tone, dismiss]);

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-md border-l-4 bg-surface-2 px-4 py-3 text-sm text-text shadow-md ${TONES[toast.tone]}`}
    >
      <span className="flex-1">{toast.text}</span>
      <button
        type="button"
        aria-label={vi.common.close}
        onClick={() => {
          dismiss(toast.id);
        }}
        className="text-text-secondary hover:text-text"
      >
        ×
      </button>
    </div>
  );
}

export function ToastViewport() {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(16px+var(--safe-bottom))] z-toast flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-4 md:items-end">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto w-full max-w-sm">
          <ToastCard toast={t} />
        </div>
      ))}
    </div>
  );
}
