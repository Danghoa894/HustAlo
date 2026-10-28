// client/src/features/auth/FormError.tsx — lỗi chung của form, role="alert" (ui_ux_spec.md §3.1)
import { AlertCircle } from 'lucide-react';

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-danger">
      <AlertCircle size={20} aria-hidden="true" className="shrink-0" />
      <span>{message}</span>
    </p>
  );
}
